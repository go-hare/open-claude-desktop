import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  containedRealpath,
  disambiguateSessionFile,
  expandHomePath,
  gitLinesMatchingName,
  isPathInsideRoot,
  isRejectedUncPath,
  listSessionDirectoryEntries,
  mimeTypeForSessionImage,
  resolveSessionContainedPath,
  resolveSessionFilePath,
  SESSION_FILE_MAX_BYTES,
  SESSION_IMAGE_MAX_BYTES,
} from "./sessionFilePath";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccd-session-file-"));
  tempDirs.push(dir);
  return dir;
}

/** Official `dw`/`cQ` return realpath; macOS `/var` → `/private/var`. */
function realOf(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    const missing: string[] = [];
    let cursor = filePath;
    while (cursor !== path.dirname(cursor)) {
      missing.unshift(path.basename(cursor));
      cursor = path.dirname(cursor);
      try {
        return path.join(fs.realpathSync(cursor), ...missing);
      } catch {
        // walk up
      }
    }
    return filePath;
  }
}

describe("official Hs / gC / IMAGE_EXT residual", () => {
  it("Hs rejects non-WSL UNC and allows WSL + local paths", () => {
    expect(isRejectedUncPath("\\\\server\\share\\file.ts")).toBe(true);
    expect(isRejectedUncPath("//server/share/file.ts")).toBe(true);
    expect(isRejectedUncPath("\\\\wsl$\\Ubuntu\\home\\a.ts")).toBe(false);
    expect(isRejectedUncPath("\\\\wsl.localhost\\Ubuntu\\home\\a.ts")).toBe(false);
    expect(isRejectedUncPath("/Users/apple/proj/a.ts")).toBe(false);
    expect(isRejectedUncPath("src/a.ts")).toBe(false);
  });

  it("gC expands ~ and ~/ ", () => {
    expect(expandHomePath("~")).toBe(os.homedir());
    expect(expandHomePath("~/src/a.ts")).toBe(path.join(os.homedir(), "src/a.ts"));
    expect(expandHomePath("src/a.ts")).toBe("src/a.ts");
  });

  it("IMAGE_EXT_TO_MIME matches official map; unknown ext is null", () => {
    expect(mimeTypeForSessionImage("shot.png")).toBe("image/png");
    expect(mimeTypeForSessionImage("shot.bmp")).toBe("image/bmp");
    expect(mimeTypeForSessionImage("shot.apng")).toBeNull();
    expect(mimeTypeForSessionImage("notes.md")).toBeNull();
  });

  it("official session file/image caps are 10MiB", () => {
    expect(SESSION_FILE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(SESSION_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("git unique-name fallback (resolveSessionFilePath residual)", () => {
  it("gitLinesMatchingName matches basename or */basename", () => {
    const listed = "src/a.ts\nlib/a.ts\nREADME.md\n";
    expect(gitLinesMatchingName(listed, "a.ts")).toEqual(["src/a.ts", "lib/a.ts"]);
    expect(gitLinesMatchingName(listed, "README.md")).toEqual(["README.md"]);
    expect(gitLinesMatchingName(listed, "./README.md")).toEqual(["README.md"]);
  });

  it("single ls-files hit returns that path", async () => {
    const git = async (args: string[]) => {
      if (args.includes("ls-files") && !args.includes("--others") && !args.includes("--modified")) {
        return "src/unique.ts\nlib/other.ts\n";
      }
      return "";
    };
    await expect(disambiguateSessionFile("/repo", "unique.ts", undefined, git)).resolves.toBe("src/unique.ts");
  });

  it("falls back to untracked --exclude-standard", async () => {
    const git = async (args: string[]) => {
      if (args.includes("--others")) return "tmp/scratch.ts\n";
      if (args.includes("ls-files")) return "src/a.ts\n";
      return "";
    };
    await expect(disambiguateSessionFile("/repo", "scratch.ts", undefined, git)).resolves.toBe(
      "tmp/scratch.ts",
    );
  });

  it("multiple hits prefer the one in sourceBranch diff", async () => {
    const git = async (args: string[]) => {
      if (args.some((arg) => arg.includes("..."))) return "lib/a.ts\n";
      if (args.includes("ls-files") && !args.includes("--others") && !args.includes("--modified")) {
        return "src/a.ts\nlib/a.ts\n";
      }
      return "";
    };
    await expect(disambiguateSessionFile("/repo", "a.ts", "main", git)).resolves.toBe("lib/a.ts");
  });

  it("multiple hits use longest changed-path prefix when no unique overlap", async () => {
    const git = async (args: string[]) => {
      if (args.includes("--modified")) return "pkg/foo/changed.ts\n";
      if (args.includes("ls-files") && !args.includes("--others") && !args.includes("--modified")) {
        return "pkg/foo/a.ts\npkg/bar/a.ts\n";
      }
      return "";
    };
    await expect(disambiguateSessionFile("/repo", "a.ts", undefined, git)).resolves.toBe("pkg/foo/a.ts");
  });

  it("git failure skips unique-name (official ls-files catch)", async () => {
    const git = async () => null;
    await expect(disambiguateSessionFile("/repo", "only-me.ts", undefined, git)).resolves.toBeNull();
  });
});

describe("resolveSessionFilePath / resolveSessionContainedPath", () => {
  it("ssh sessions and UNC paths return null", async () => {
    const session = { cwd: "/repo", sshConfig: { host: "x" } };
    await expect(resolveSessionFilePath(session, "a.ts")).resolves.toBeNull();
    await expect(resolveSessionContainedPath(session, "a.ts")).resolves.toBeNull();
    await expect(
      resolveSessionContainedPath({ cwd: "/repo" }, "\\\\server\\share\\a.ts"),
    ).resolves.toBeNull();
  });

  it("read path requires an existing file; write/list containment does not", async () => {
    const root = makeRoot();
    const nested = path.join(root, "src");
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, "a.ts"), "export {}\n");
    const session = { cwd: root };
    await expect(resolveSessionFilePath(session, "src/a.ts")).resolves.toBe(path.join(nested, "a.ts"));
    await expect(resolveSessionFilePath(session, "src")).resolves.toBeNull();
    await expect(resolveSessionFilePath(session, "missing.ts")).resolves.toBeNull();
    await expect(resolveSessionContainedPath(session, "src")).resolves.toBe(realOf(nested));
    await expect(resolveSessionContainedPath(session, "new/file.ts")).resolves.toBe(
      realOf(path.join(root, "new", "file.ts")),
    );
    await expect(resolveSessionContainedPath(session, "../escape.ts")).resolves.toBeNull();
    expect(isPathInsideRoot(root, path.join(root, "src", "a.ts"))).toBe(true);
    expect(isPathInsideRoot(root, path.join(root, "..", "outside"))).toBe(false);
  });

  it("git unique-name resolves a missing relative basename", async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "only.ts"), "ok");
    const git = async (args: string[]) => {
      if (args.includes("ls-files") && !args.includes("--others") && !args.includes("--modified")) {
        return "src/only.ts\n";
      }
      return "";
    };
    await expect(resolveSessionFilePath({ cwd: root }, "only.ts", git)).resolves.toBe(
      path.join(root, "src", "only.ts"),
    );
  });

  it("cQ denies a symlink that hops outside the session root", async () => {
    const root = makeRoot();
    const outside = makeRoot();
    fs.writeFileSync(path.join(outside, "secret.ts"), "nope");
    fs.symlinkSync(path.join(outside, "secret.ts"), path.join(root, "alias.ts"));
    const session = { cwd: root };
    await expect(resolveSessionContainedPath(session, "alias.ts")).resolves.toBeNull();
    await expect(containedRealpath(path.join(root, "alias.ts"), root)).resolves.toBeNull();
    await expect(resolveSessionFilePath(session, "alias.ts")).resolves.toBe(path.join(root, "alias.ts"));
  });

  it("cQ allows a symlink that stays inside the session root", async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "a.ts"), "ok");
    fs.symlinkSync(path.join(root, "src", "a.ts"), path.join(root, "link.ts"));
    const session = { cwd: root };
    await expect(resolveSessionContainedPath(session, "link.ts")).resolves.toBe(
      realOf(path.join(root, "src", "a.ts")),
    );
  });

  it("listSessionDirectory skips dotfiles and returns unresolved join paths", async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "a.ts"), "ok");
    fs.writeFileSync(path.join(root, ".hidden"), "x");
    const entries = await listSessionDirectoryEntries({ cwd: root }, ".");
    expect(entries.map((entry) => entry.name).sort()).toEqual(["src"]);
    expect(entries[0]).toEqual({
      name: "src",
      path: path.join(root, "src"),
      isDirectory: true,
    });
    const nested = await listSessionDirectoryEntries({ cwd: root }, "src");
    expect(nested).toEqual([
      { name: "a.ts", path: path.join(root, "src", "a.ts"), isDirectory: false },
    ]);
  });
});
