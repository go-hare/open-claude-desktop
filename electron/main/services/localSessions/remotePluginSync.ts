/**
 * Official NCr / _Cr RemotePluginSync residual (app.asar index.js):
 *
 *   NZ = ".claude/remote/plugins"
 *   $st = new Set(["hooks", ".mcpb-cache"])
 *   Wst(localRoot) → file entries (no symlink / path escape; strip $st at top)
 *   Zst(entries) → sha256 slice 16
 *   _Cr(controller, localRoots):
 *     dest = `${remoteHome}/${NZ}/${hash}`
 *     if dest/.synced exists → reuse
 *     else tar.gz → SFTP `${NZ}/${hash}.tar.gz` → extractTar → dest
 *
 * Official controller is FI RemoteServerController (ssh2 SFTP + RPC extract_tar).
 * Product SSH is host-pipe (ssh/scp), same surface: remoteHome / statFile /
 * withSftp / extractTar. Do not invent RPC heartbeat / createSpawnFunction.
 */
import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";

/** Official NZ */
export const REMOTE_PLUGIN_SYNC_ROOT = ".claude/remote/plugins";

/** Official $st */
export const STRIPPED_TOP_LEVEL_DIRS = new Set(["hooks", ".mcpb-cache"]);

export type PluginSyncEntry = {
  abs: string;
  rel: string;
};

export type RemotePluginSftp = {
  fastPut: (local: string, remote: string, opts: { mode: number }) => Promise<void>;
  mkdir: (remote: string, opts: { mode: number }) => Promise<void>;
};

export type RemotePluginSyncController = {
  extractTar: (
    archivePath: string,
    destDir: string,
  ) => Promise<{ error?: string; fileCount?: number; success: boolean }>;
  remoteHome: string | null;
  statFile: (remotePath: string) => Promise<{ exists: boolean }>;
  withSftp: (fn: (sftp: RemotePluginSftp) => Promise<void>) => Promise<void>;
};

function posixJoin(left: string, right: string): string {
  return path.posix.join(left.replace(/\\/g, "/"), right.replace(/\\/g, "/"));
}

/**
 * Official Wst — collect files under a plugin root.
 * Throws on symlink, path escape, invalid JSON, or plugin.json `hooks`.
 */
export async function collectPluginEntries(localRoot: string): Promise<PluginSyncEntry[]> {
  const out: PluginSyncEntry[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const nextRel = posixJoin(rel, ent.name);
      const normalized = path.posix.normalize(nextRel);
      if (normalized.startsWith("..") || path.posix.isAbsolute(normalized) || normalized !== nextRel) {
        throw new Error(`RemotePluginSync: refusing entry that escapes plugin root: ${nextRel}`);
      }
      if (ent.isSymbolicLink()) {
        throw new Error(`RemotePluginSync: refusing symlink in plugin directory: ${nextRel}`);
      }
      if (ent.isDirectory()) {
        if (rel === "" && STRIPPED_TOP_LEVEL_DIRS.has(ent.name)) continue;
        await walk(abs, nextRel);
        continue;
      }
      if (ent.isFile()) out.push({ abs, rel: nextRel });
    }
  };
  await walk(localRoot, "");
  const manifest = out.find((row) => row.rel.toLowerCase() === ".claude-plugin/plugin.json");
  if (manifest) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(manifest.abs, "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`RemotePluginSync: plugin manifest is not valid JSON: ${localRoot}`);
      }
      throw error;
    }
    if (parsed && typeof parsed === "object" && "hooks" in parsed && parsed.hooks !== undefined) {
      throw new Error(`RemotePluginSync: refusing plugin that relocates hooks via manifest: ${localRoot}`);
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Official Zst */
export async function contentHash(entries: readonly PluginSyncEntry[]): Promise<string> {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.rel);
    hash.update("\0");
    await new Promise<void>((resolve, reject) => {
      createReadStream(entry.abs)
        .on("data", (chunk) => hash.update(chunk as string | Uint8Array))
        .on("end", () => resolve())
        .on("error", reject);
    });
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 16);
}

/** Official SCr — mkdir parents; SFTP code 4 treated as exists. */
async function mkdirParents(sftp: RemotePluginSftp, remote: string): Promise<void> {
  const parts = remote.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await sftp.mkdir(current, { mode: 0o700 });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== 4 && code !== "EEXIST") throw error;
    }
  }
}

/**
 * Official _Cr — map local plugin roots to `${remoteHome}/.claude/remote/plugins/${hash}`.
 */
export async function syncPluginDirsToRemote(
  controller: RemotePluginSyncController,
  localRoots: readonly string[],
): Promise<Map<string, string>> {
  const mapped = new Map<string, string>();
  if (localRoots.length === 0) return mapped;
  const remoteHome = controller.remoteHome;
  if (!remoteHome) {
    throw new Error("RemotePluginSync: controller.remoteHome unset (ensureReady not called?)");
  }
  const prepared = await Promise.all(
    localRoots.map(async (localRoot) => {
      const entries = await collectPluginEntries(localRoot);
      const hash = await contentHash(entries);
      const sftpRoot = `${REMOTE_PLUGIN_SYNC_ROOT}/${hash}`;
      const absRoot = `${remoteHome.replace(/\\/g, "/")}/${sftpRoot}`;
      return { absRoot, archive: "", entries, localRoot, sftpRoot };
    }),
  );
  const pending: Array<{
    absRoot: string;
    archive: string;
    entries: PluginSyncEntry[];
    localRoot: string;
    sftpRoot: string;
  }> = [];
  for (const row of prepared) {
    const { exists } = await controller.statFile(`${row.absRoot}/.synced`);
    if (exists) mapped.set(row.localRoot, row.absRoot);
    else pending.push(row);
  }
  if (pending.length === 0) return mapped;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-plugin-"));
  try {
    for (const row of pending) {
      row.archive = path.join(tmp, `${path.basename(row.sftpRoot)}.tar.gz`);
      await tar.create(
        { cwd: row.localRoot, file: row.archive, gzip: true, portable: true },
        row.entries.map((entry) => entry.rel),
      );
    }
    await controller.withSftp(async (sftp) => {
      await mkdirParents(sftp, REMOTE_PLUGIN_SYNC_ROOT);
      for (const row of pending) {
        await sftp.fastPut(row.archive, `${REMOTE_PLUGIN_SYNC_ROOT}/${path.basename(row.archive)}`, {
          mode: 0o600,
        });
      }
    });
    for (const row of pending) {
      const archiveAbs = `${remoteHome.replace(/\\/g, "/")}/${REMOTE_PLUGIN_SYNC_ROOT}/${path.basename(row.archive)}`;
      const extracted = await controller.extractTar(archiveAbs, row.absRoot);
      if (!extracted.success) {
        throw new Error(`RemotePluginSync: extract failed for ${row.localRoot}: ${extracted.error}`);
      }
      mapped.set(row.localRoot, row.absRoot);
    }
  } finally {
    await fs.rm(tmp, { force: true, recursive: true });
  }
  return mapped;
}
