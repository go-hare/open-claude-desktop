import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectPluginEntries,
  contentHash,
  STRIPPED_TOP_LEVEL_DIRS,
  syncPluginDirsToRemote,
  type RemotePluginSyncController,
} from "./remotePluginSync";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-sync-"));
  temps.push(dir);
  return dir;
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("remotePluginSync (official Wst / Zst / _Cr)", () => {
  it("strips top-level hooks and mcpb-cache", async () => {
    const root = mkDir();
    write(path.join(root, "skills", "a", "SKILL.md"), "hi");
    write(path.join(root, "hooks", "hooks.json"), "{}");
    write(path.join(root, ".mcpb-cache", "x"), "x");
    const entries = await collectPluginEntries(root);
    expect(entries.map((row) => row.rel)).toEqual(["skills/a/SKILL.md"]);
    expect(STRIPPED_TOP_LEVEL_DIRS.has("hooks")).toBe(true);
  });

  it("refuses plugin.json that relocates hooks", async () => {
    const root = mkDir();
    write(
      path.join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "x", hooks: { PreToolUse: [] } }),
    );
    await expect(collectPluginEntries(root)).rejects.toThrow(/relocates hooks/);
  });

  it("contentHash is 16 hex chars", async () => {
    const root = mkDir();
    write(path.join(root, "a.txt"), "one");
    const entries = await collectPluginEntries(root);
    const hash = await contentHash(entries);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    const again = createHash("sha256");
    again.update("a.txt");
    again.update("\0");
    again.update("one");
    again.update("\n");
    expect(hash).toBe(again.digest("hex").slice(0, 16));
  });

  it("reuses dest when .synced exists and uploads otherwise", async () => {
    const root = mkDir();
    write(path.join(root, "f.txt"), "body");
    const entries = await collectPluginEntries(root);
    const hash = await contentHash(entries);
    const uploads: string[] = [];
    const extracts: string[] = [];
    const synced = new Set<string>();
    const controller: RemotePluginSyncController = {
      remoteHome: "/home/u",
      statFile: async (remotePath) => ({ exists: synced.has(remotePath) }),
      withSftp: async (fn) => {
        await fn({
          mkdir: async () => undefined,
          fastPut: async (local, remote) => {
            uploads.push(remote);
            void local;
          },
        });
      },
      extractTar: async (archive, dest) => {
        extracts.push(dest);
        synced.add(`${dest}/.synced`);
        void archive;
        return { success: true, fileCount: 1 };
      },
    };
    const first = await syncPluginDirsToRemote(controller, [root]);
    expect(first.get(root)).toBe(`/home/u/.claude/remote/plugins/${hash}`);
    expect(uploads).toHaveLength(1);
    expect(extracts).toHaveLength(1);
    const second = await syncPluginDirsToRemote(controller, [root]);
    expect(second.get(root)).toBe(`/home/u/.claude/remote/plugins/${hash}`);
    expect(uploads).toHaveLength(1);
    expect(extracts).toHaveLength(1);
  });

  it("empty local roots returns empty map", async () => {
    const controller: RemotePluginSyncController = {
      remoteHome: "/home/u",
      statFile: async () => ({ exists: false }),
      withSftp: async () => undefined,
      extractTar: async () => ({ success: true }),
    };
    expect(await syncPluginDirsToRemote(controller, [])).toEqual(new Map());
  });

  it("throws when remoteHome is unset", async () => {
    const controller: RemotePluginSyncController = {
      remoteHome: null,
      statFile: async () => ({ exists: false }),
      withSftp: async () => undefined,
      extractTar: async () => ({ success: true }),
    };
    await expect(syncPluginDirsToRemote(controller, ["/tmp/x"])).rejects.toThrow(
      /remoteHome unset/,
    );
  });
});
