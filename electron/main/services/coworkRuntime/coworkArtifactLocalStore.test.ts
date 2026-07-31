import { describe, expect, it, vi } from "vitest";
import {
  createCoworkArtifactLocal,
  deleteCoworkArtifactLocal,
  embedCoworkArtifactMeta,
  isCoworkMcpToolName,
  parseCoworkArtifactMeta,
  restoreCoworkArtifactVersionLocal,
  slugifyCoworkArtifactId,
  stripCoworkArtifactMeta,
  titleFromCoworkArtifactSlug,
  updateCoworkArtifactLocal,
} from "./coworkArtifactLocalStore";

describe("coworkArtifactLocalStore residual", () => {
  it("slugifyCoworkArtifactId matches official PM residual", () => {
    expect(slugifyCoworkArtifactId("Sprint Velocity")).toBe("sprint-velocity");
    expect(slugifyCoworkArtifactId("  Hello_World  ")).toBe("hello_world");
    expect(() => slugifyCoworkArtifactId("---")).toThrow(/alphanumeric/);
  });

  it("titleFromCoworkArtifactSlug title-cases kebab", () => {
    expect(titleFromCoworkArtifactSlug("sprint-velocity")).toBe("Sprint Velocity");
  });

  it("embed/parse/strip meta residual", () => {
    const html = "<!DOCTYPE html><html><body>hi</body></html>";
    const embedded = embedCoworkArtifactMeta(html, { name: "Demo", schemaVersion: 1 });
    expect(embedded).toContain('id="cowork-artifact-meta"');
    expect(embedded.startsWith("<!DOCTYPE html>")).toBe(true);
    const meta = parseCoworkArtifactMeta(embedded);
    expect(meta?.name).toBe("Demo");
    expect(stripCoworkArtifactMeta(embedded)).not.toContain("cowork-artifact-meta");
  });

  it("isCoworkMcpToolName residual", () => {
    expect(isCoworkMcpToolName("mcp__abc__tool")).toBe(true);
    expect(isCoworkMcpToolName("tool")).toBe(false);
  });

  it("createCoworkArtifactLocal writes index.html under injected root", async () => {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const getDocumentsPath = () => "/Users/me/Documents";
    const access = vi.fn(async (p: string) => {
      if (files.has(p) || dirs.has(p)) return;
      throw new Error("ENOENT");
    });
    const mkdir = vi.fn(async (p: string) => {
      dirs.add(String(p));
    });
    const writeFile = vi.fn(async (p: string, data: string) => {
      files.set(String(p), String(data));
    });
    const rm = vi.fn(async () => undefined);

    const row = await createCoworkArtifactLocal(
      "demo-board",
      "<!DOCTYPE html><html><body>x</body></html>",
      { description: "Demo", createdBySessionId: "s1" },
      { getDocumentsPath, access, mkdir, writeFile, rm },
    );
    expect(row.id).toBe("demo-board");
    expect(row.isStarred).toBe(true);
    expect(String(row.indexHtmlPath)).toContain("/Claude/Artifacts/demo-board/index.html");
    const written = files.get(String(row.indexHtmlPath));
    expect(written).toContain("cowork-artifact-meta");
    expect(written).toContain("Demo Board");
  });

  it("createCoworkArtifactLocal rejects taken slug", async () => {
    const access = vi.fn(async () => undefined); // dir exists
    await expect(
      createCoworkArtifactLocal("taken", "<html></html>", {}, {
        getDocumentsPath: () => "/Users/me/Documents",
        access,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("updateCoworkArtifactLocal rewrites existing index", async () => {
    const indexPath = "/Users/me/Documents/Claude/Artifacts/demo/index.html";
    const files = new Map<string, string>([
      [indexPath, embedCoworkArtifactMeta("<html>old</html>", { name: "Demo", schemaVersion: 1 })],
    ]);
    const access = vi.fn(async (p: string) => {
      if (files.has(String(p)) || String(p).includes("/versions")) return;
      if (String(p).endsWith("index.html") && files.has(indexPath)) return;
      throw new Error("ENOENT");
    });
    const readFile = vi.fn(async (p: string) => {
      const v = files.get(String(p));
      if (v === undefined) throw new Error("ENOENT");
      return v;
    });
    const writeFile = vi.fn(async (p: string, data: string) => {
      files.set(String(p), String(data));
    });
    const mkdir = vi.fn(async () => undefined);
    const copyFile = vi.fn(async (from: string, to: string) => {
      files.set(String(to), files.get(String(from)) ?? "");
    });
    const rm = vi.fn(async () => undefined);

    const row = await updateCoworkArtifactLocal(
      "demo",
      "<!DOCTYPE html><html><body>new</body></html>",
      { description: "Updated" },
      {
        getDocumentsPath: () => "/Users/me/Documents",
        access,
        readFile,
        writeFile,
        mkdir,
        copyFile,
        rm,
      },
    );
    expect(row.id).toBe("demo");
    expect(typeof row.updatedAt).toBe("number");
    expect(files.get(indexPath)).toContain("new");
  });

  it("deleteCoworkArtifactLocal removeFiles clears disk dir", async () => {
    const dir = "/Users/me/Documents/Claude/Artifacts/demo-board";
    const indexPath = `${dir}/index.html`;
    const files = new Map<string, string>([[indexPath, "<html>x</html>"]]);
    const dirs = new Set<string>([dir]);
    const access = vi.fn(async (p: string) => {
      if (files.has(String(p)) || dirs.has(String(p))) return;
      throw new Error("ENOENT");
    });
    const rm = vi.fn(async (p: string) => {
      const key = String(p);
      dirs.delete(key);
      for (const f of [...files.keys()]) {
        if (f === key || f.startsWith(`${key}/`)) files.delete(f);
      }
    });

    const ok = await deleteCoworkArtifactLocal(
      "demo-board",
      { removeFiles: true },
      { getDocumentsPath: () => "/Users/me/Documents", access, rm },
    );
    expect(ok).toBe(true);
    expect(rm).toHaveBeenCalled();
    expect(files.has(indexPath)).toBe(false);
  });

  it("deleteCoworkArtifactLocal without bag/disk returns false", async () => {
    const access = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    await expect(
      deleteCoworkArtifactLocal("ghost", { removeFiles: true }, {
        getDocumentsPath: () => "/Users/me/Documents",
        access,
      }),
    ).resolves.toBe(false);
  });

  it("restoreCoworkArtifactVersionLocal rewrites index from versions snapshot", async () => {
    const dir = "/Users/me/Documents/Claude/Artifacts/demo";
    const indexPath = `${dir}/index.html`;
    const versionStamp = 1_700_000_000_000;
    const versionPath = `${dir}/versions/${versionStamp}.html`;
    const oldHtml = embedCoworkArtifactMeta("<html>old</html>", {
      name: "Demo",
      schemaVersion: 1,
    });
    const currentHtml = embedCoworkArtifactMeta("<html>current</html>", {
      name: "Demo",
      schemaVersion: 1,
    });
    const files = new Map<string, string>([
      [indexPath, currentHtml],
      [versionPath, oldHtml],
    ]);
    const access = vi.fn(async (p: string) => {
      if (files.has(String(p))) return;
      throw new Error("ENOENT");
    });
    const readFile = vi.fn(async (p: string) => {
      const v = files.get(String(p));
      if (v === undefined) throw new Error("ENOENT");
      return v;
    });
    const writeFile = vi.fn(async (p: string, data: string) => {
      files.set(String(p), String(data));
    });
    const mkdir = vi.fn(async () => undefined);
    const copyFile = vi.fn(async () => undefined);
    const rm = vi.fn(async () => undefined);

    // Bag with versions list (official membership check).
    const bag = new Map<string, Record<string, unknown>>([
      [
        "demo",
        {
          id: "demo",
          name: "Demo",
          createdAt: versionStamp,
          versions: [versionStamp],
          indexHtmlPath: indexPath,
        },
      ],
    ]);
    const featureState = {
      loadMap: () => bag,
      saveMap: (_key: string, map: Map<string, Record<string, unknown>>) => {
        bag.clear();
        for (const [k, v] of map) bag.set(k, v);
      },
    };

    const ok = await restoreCoworkArtifactVersionLocal("demo", versionStamp, {
      getDocumentsPath: () => "/Users/me/Documents",
      access,
      readFile,
      writeFile,
      mkdir,
      copyFile,
      rm,
      featureState: featureState as never,
    });
    expect(ok).toBe(true);
    expect(files.get(indexPath)).toContain("old");
    // viaRestore must not invent a new version snapshot of "current".
    expect(copyFile).not.toHaveBeenCalled();
  });
});
