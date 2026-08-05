import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import {
  installDxtArchive,
  listInstalledExtensions,
} from "./desktopExtensions";

describe("installDxtArchive mcpb/dxt unpack residual", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const r of roots) {
      fs.rmSync(r, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  function tempUserData(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-install-"));
    roots.push(dir);
    return dir;
  }

  it("unpacks .mcpb zip and reads real manifest (not basename invent)", async () => {
    const userData = tempUserData();
    const pkgDir = path.join(userData, "pkg");
    fs.mkdirSync(pkgDir, { recursive: true });
    const manifest = {
      manifest_version: "0.2",
      name: "demo-server",
      version: "1.2.3",
      description: "demo",
      author: { name: "Acme" },
      server: { type: "node", entry_point: "server/index.js" },
    };
    const zipBytes = zipSync({
      "manifest.json": Buffer.from(JSON.stringify(manifest), "utf8"),
      "server/index.js": Buffer.from("export default {}", "utf8"),
    });
    const mcpbPath = path.join(userData, "demo.mcpb");
    fs.writeFileSync(mcpbPath, zipBytes);

    const installed = await installDxtArchive(userData, mcpbPath);
    expect(installed.id.startsWith("local.mcpb.")).toBe(true);
    expect(installed.manifest.name).toBe("demo-server");
    expect(installed.manifest.version).toBe("1.2.3");
    expect(installed.manifest.server.entry_point).toBe("server/index.js");
    expect(fs.existsSync(path.join(installed.path, "manifest.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(installed.path, "server/index.js"))).toBe(
      true,
    );

    const listed = await listInstalledExtensions(userData);
    expect(listed.some((e) => e.id === installed.id)).toBe(true);
  });

  it("strips single top-level folder in archive", async () => {
    const userData = tempUserData();
    const manifest = {
      manifest_version: "0.2",
      name: "nested-pkg",
      version: "0.1.0",
      description: "n",
      author: { name: "Z" },
      server: { type: "node", entry_point: "main.js" },
    };
    const zipBytes = zipSync({
      "wrapper/manifest.json": Buffer.from(JSON.stringify(manifest), "utf8"),
      "wrapper/main.js": Buffer.from("//", "utf8"),
    });
    const dxtPath = path.join(userData, "nested.dxt");
    fs.writeFileSync(dxtPath, zipBytes);

    const installed = await installDxtArchive(userData, dxtPath);
    expect(installed.id.startsWith("local.dxt.")).toBe(true);
    expect(fs.existsSync(path.join(installed.path, "manifest.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(installed.path, "main.js"))).toBe(true);
  });

  it("rejects empty / invalid zip honestly", async () => {
    const userData = tempUserData();
    const empty = path.join(userData, "empty.mcpb");
    fs.writeFileSync(empty, Buffer.alloc(0));
    await expect(installDxtArchive(userData, empty)).rejects.toThrow(/empty/i);

    const bad = path.join(userData, "bad.dxt");
    fs.writeFileSync(bad, Buffer.from("not-a-zip"));
    await expect(installDxtArchive(userData, bad)).rejects.toThrow(/Invalid|zip/i);
  });

  it("rejects zip without real manifest.json (no basename invent)", async () => {
    const userData = tempUserData();
    const zipBytes = zipSync({
      "readme.txt": Buffer.from("no manifest", "utf8"),
      "server/index.js": Buffer.from("export default {}", "utf8"),
    });
    const p = path.join(userData, "ghost.mcpb");
    fs.writeFileSync(p, zipBytes);
    await expect(installDxtArchive(userData, p)).rejects.toThrow(
      /No manifest\.json found/i,
    );
    // No invented install under extensions/
    const extRoot = path.join(userData, "extensions");
    if (fs.existsSync(extRoot)) {
      const kids = fs.readdirSync(extRoot).filter((n) => !n.startsWith(".stage-"));
      expect(kids).toEqual([]);
    }
  });

  it("rejects manifest missing name / version fields", async () => {
    const userData = tempUserData();
    const zipBytes = zipSync({
      "manifest.json": Buffer.from(JSON.stringify({ description: "x" }), "utf8"),
    });
    const p = path.join(userData, "noval.dxt");
    fs.writeFileSync(p, zipBytes);
    await expect(installDxtArchive(userData, p)).rejects.toThrow(/Invalid manifest|name/i);
  });

  it("skips path-traversal entries and still requires root manifest", async () => {
    const userData = tempUserData();
    const manifest = {
      manifest_version: "0.2",
      name: "safe-pkg",
      version: "1.0.0",
      description: "s",
      author: { name: "A" },
      server: { type: "node", entry_point: "main.js" },
    };
    const zipBytes = zipSync({
      "manifest.json": Buffer.from(JSON.stringify(manifest), "utf8"),
      "main.js": Buffer.from("//ok", "utf8"),
      "../escape.js": Buffer.from("bad", "utf8"),
      "nested/../../outside.js": Buffer.from("bad2", "utf8"),
    });
    const p = path.join(userData, "safe.dxt");
    fs.writeFileSync(p, zipBytes);
    const installed = await installDxtArchive(userData, p);
    expect(installed.manifest.name).toBe("safe-pkg");
    expect(fs.existsSync(path.join(installed.path, "main.js"))).toBe(true);
    expect(fs.existsSync(path.join(installed.path, "escape.js"))).toBe(false);
    expect(fs.existsSync(path.join(installed.path, "outside.js"))).toBe(false);
  });
});
