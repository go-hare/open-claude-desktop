/**
 * Official CoworkMemory residual (app.asar rxt / lze / Bze / yLi / SLi / RLi / _Li / MLi):
 *
 *   n() = { accountId: $I(), orgId: await dr() } or null
 *   AFA = RB/memory
 *   feA = AFA/CLAUDE.md          // global instructions
 *   GL  = AFA/memory             // account memory/*.md (exclude memory.md)
 *   ZrA = RB/spaces/<id>/memory  // cleared on resetMemories
 *
 * Product: on-disk under userData/local-agent-mode-sessions/{account}/{org}/…
 * Never invents content without identity; never invents success without real IO.
 * writeAccountMemory matches official mLi(..., createIfMissing=false).
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  coworkAccountMemoryBaseDir,
  coworkAccountStorageDir,
  coworkRadarMemoryDir,
  coworkSpaceMemoryDir,
} from "./coworkAutoMemoryPaths";

/** Official DLi = 256 * 1024 — max bytes when reading a memory file. */
export const COWORK_MEMORY_MAX_READ_BYTES = 256 * 1024;

export type CoworkMemoryIdentity = {
  accountId: string;
  orgId: string;
};

export type CoworkMemoryFile = {
  path: string;
  content: string;
  updatedAt?: string;
};

export type CoworkMemoryFs = {
  access: (p: string) => Promise<void>;
  readFile: (p: string, encoding: "utf-8") => Promise<string>;
  writeFile: (p: string, data: string, opts?: { encoding: "utf-8" }) => Promise<void>;
  mkdir: (p: string, opts?: { recursive: boolean }) => Promise<string | undefined>;
  readdir: (p: string, opts?: { withFileTypes: true }) => Promise<Array<{ name: string; isDirectory: () => boolean; isFile?: () => boolean }>>;
  lstat: (p: string) => Promise<{ isFile: () => boolean; mtime: Date; size: number }>;
  unlink: (p: string) => Promise<void>;
  rm: (p: string, opts?: { recursive?: boolean; force?: boolean }) => Promise<void>;
};

const defaultFs: CoworkMemoryFs = {
  access: (p) => fs.access(p),
  readFile: (p, encoding) => fs.readFile(p, encoding),
  writeFile: (p, data, opts) => fs.writeFile(p, data, opts),
  mkdir: (p, opts) => fs.mkdir(p, opts),
  readdir: (p, opts) => fs.readdir(p, opts) as Promise<
    Array<{ name: string; isDirectory: () => boolean; isFile?: () => boolean }>
  >,
  lstat: (p) => fs.lstat(p),
  unlink: (p) => fs.unlink(p),
  rm: (p, opts) => fs.rm(p, opts),
};

export type CoworkMemoryStoreDeps = {
  userDataPath: string;
  /** Official n() — null when account/org missing. */
  resolveIdentity: () => Promise<CoworkMemoryIdentity | null> | CoworkMemoryIdentity | null;
  fs?: CoworkMemoryFs;
  log?: { warn?: (...args: unknown[]) => void };
};

function accountRoot(deps: CoworkMemoryStoreDeps, id: CoworkMemoryIdentity): string {
  return coworkAccountStorageDir(deps.userDataPath, id.accountId, id.orgId);
}

/** Official feA — global instructions file. */
export function coworkGlobalMemoryPath(accountStorageDir: string): string {
  return path.join(coworkAccountMemoryBaseDir(accountStorageDir), "CLAUDE.md");
}

/** Official GL — account memory directory (list/delete target). */
export function coworkAccountMemoryListDir(accountStorageDir: string): string {
  return coworkRadarMemoryDir(accountStorageDir);
}

function isSafeMemoryBasename(name: string): boolean {
  if (!name || name.includes("\0") || name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === ".." || name !== path.basename(name)) return false;
  if (!name.endsWith(".md")) return false;
  if (name.toLowerCase() === "memory.md") return false;
  return true;
}

async function readTextFileCapped(
  filePath: string,
  io: CoworkMemoryFs,
): Promise<{ content: string; mtime: Date } | null> {
  try {
    const st = await io.lstat(filePath);
    if (!st.isFile()) return null;
    // Official Cze caps at DLi; oversized → skip (honest, no partial invent).
    if (st.size > COWORK_MEMORY_MAX_READ_BYTES) return null;
    const content = await io.readFile(filePath, "utf-8");
    return { content, mtime: st.mtime };
  } catch {
    return null;
  }
}

/**
 * Official lze — read global CLAUDE.md or null.
 */
export async function readGlobalMemory(deps: CoworkMemoryStoreDeps): Promise<string | null> {
  const id = await deps.resolveIdentity();
  if (!id) return null;
  const file = coworkGlobalMemoryPath(accountRoot(deps, id));
  try {
    await (deps.fs ?? defaultFs).access(file);
    return await (deps.fs ?? defaultFs).readFile(file, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Official Bze — mkdir AFA + write CLAUDE.md.
 */
export async function writeGlobalMemory(
  deps: CoworkMemoryStoreDeps,
  content: string,
): Promise<boolean> {
  const id = await deps.resolveIdentity();
  if (!id) return false;
  const io = deps.fs ?? defaultFs;
  const root = accountRoot(deps, id);
  const base = coworkAccountMemoryBaseDir(root);
  const file = coworkGlobalMemoryPath(root);
  try {
    await io.mkdir(base, { recursive: true });
    await io.writeFile(file, String(content ?? ""), { encoding: "utf-8" });
    return true;
  } catch (error) {
    deps.log?.warn?.("[CoworkMemory] writeGlobalMemory failed", error);
    return false;
  }
}

/**
 * Official yLi — list GL *.md except memory.md; newest updatedAt first.
 */
export async function listAccountMemories(
  deps: CoworkMemoryStoreDeps,
  withContent = true,
): Promise<CoworkMemoryFile[]> {
  const id = await deps.resolveIdentity();
  if (!id) return [];
  const io = deps.fs ?? defaultFs;
  const dir = coworkAccountMemoryListDir(accountRoot(deps, id));
  let names: string[];
  try {
    const entries = await io.readdir(dir, { withFileTypes: true });
    names = entries.map((e) => e.name);
  } catch {
    return [];
  }
  const out: CoworkMemoryFile[] = [];
  for (const name of names) {
    if (!isSafeMemoryBasename(name)) continue;
    const filePath = path.join(dir, name);
    try {
      if (withContent) {
        const read = await readTextFileCapped(filePath, io);
        if (!read) continue;
        out.push({
          path: name,
          content: read.content,
          updatedAt: read.mtime.toISOString(),
        });
      } else {
        const st = await io.lstat(filePath);
        if (!st.isFile()) continue;
        out.push({ path: name, content: "", updatedAt: st.mtime.toISOString() });
      }
    } catch {
      /* skip unreadable */
    }
  }
  out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return out;
}

/**
 * Official SLi — read one account memory file or null.
 */
export async function readAccountMemory(
  deps: CoworkMemoryStoreDeps,
  memoryPath: string,
): Promise<CoworkMemoryFile | null> {
  const id = await deps.resolveIdentity();
  if (!id) return null;
  const base = path.basename(String(memoryPath ?? ""));
  if (!isSafeMemoryBasename(base)) return null;
  const filePath = path.join(coworkAccountMemoryListDir(accountRoot(deps, id)), base);
  const read = await readTextFileCapped(filePath, deps.fs ?? defaultFs);
  if (!read) return null;
  return {
    path: base,
    content: read.content,
    updatedAt: read.mtime.toISOString(),
  };
}

/**
 * Official RLi / mLi(createIfMissing=false) — update existing file only.
 */
export async function writeAccountMemory(
  deps: CoworkMemoryStoreDeps,
  memoryPath: string,
  content: string,
): Promise<boolean> {
  const id = await deps.resolveIdentity();
  if (!id) return false;
  const base = path.basename(String(memoryPath ?? ""));
  if (!isSafeMemoryBasename(base)) return false;
  const io = deps.fs ?? defaultFs;
  const filePath = path.join(coworkAccountMemoryListDir(accountRoot(deps, id)), base);
  try {
    const st = await io.lstat(filePath).catch(() => null);
    if (!st || !st.isFile()) return false;
    await io.writeFile(filePath, String(content ?? ""), { encoding: "utf-8" });
    return true;
  } catch (error) {
    deps.log?.warn?.("[CoworkMemory] writeAccountMemory failed", error);
    return false;
  }
}

/**
 * Official _Li — unlink account memory file.
 */
export async function deleteAccountMemory(
  deps: CoworkMemoryStoreDeps,
  memoryPath: string,
): Promise<boolean> {
  const id = await deps.resolveIdentity();
  if (!id) return false;
  const base = path.basename(String(memoryPath ?? ""));
  if (!isSafeMemoryBasename(base)) return false;
  const io = deps.fs ?? defaultFs;
  const filePath = path.join(coworkAccountMemoryListDir(accountRoot(deps, id)), base);
  try {
    const st = await io.lstat(filePath);
    if (!st.isFile()) return false;
    await io.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Official EBe + MLi — clear GL and each spaces/<id>/memory, re-mkdir empty.
 */
export async function resetMemories(deps: CoworkMemoryStoreDeps): Promise<boolean> {
  const id = await deps.resolveIdentity();
  if (!id) return false;
  const io = deps.fs ?? defaultFs;
  const root = accountRoot(deps, id);
  const clearDir = async (dir: string) => {
    try {
      await io.rm(dir, { recursive: true, force: true });
      await io.mkdir(dir, { recursive: true });
    } catch (error) {
      deps.log?.warn?.(`[CoworkMemory] failed to clear memory dir ${dir}:`, error);
    }
  };
  await clearDir(coworkAccountMemoryListDir(root));
  const spacesRoot = path.join(root, "spaces");
  let spaceEntries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    spaceEntries = await io.readdir(spacesRoot, { withFileTypes: true });
  } catch {
    spaceEntries = [];
  }
  for (const entry of spaceEntries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name || entry.name.includes("/") || entry.name.includes("\\")) continue;
    await clearDir(coworkSpaceMemoryDir(root, entry.name));
  }
  return true;
}

/**
 * One-shot migrate of legacy featureState `memories` map (global + path keys)
 * into official on-disk layout when identity is available and disk is empty.
 * Does not overwrite existing CLAUDE.md / account files.
 */
export async function migrateLegacyMemoriesMap(
  deps: CoworkMemoryStoreDeps,
  legacy: Map<string, string> | Iterable<[string, string]>,
): Promise<{ migratedGlobal: boolean; migratedAccount: number }> {
  const id = await deps.resolveIdentity();
  if (!id) return { migratedGlobal: false, migratedAccount: 0 };
  const entries = legacy instanceof Map ? [...legacy.entries()] : [...legacy];
  let migratedGlobal = false;
  let migratedAccount = 0;
  const existingGlobal = await readGlobalMemory(deps);
  for (const [key, value] of entries) {
    if (key === "global") {
      if (existingGlobal == null && value) {
        if (await writeGlobalMemory(deps, value)) migratedGlobal = true;
      }
      continue;
    }
    if (!isSafeMemoryBasename(path.basename(key))) continue;
    const existing = await readAccountMemory(deps, key);
    if (existing) continue;
    // Official writeAccountMemory won't create — migrate creates once.
    const io = deps.fs ?? defaultFs;
    const dir = coworkAccountMemoryListDir(accountRoot(deps, id));
    const base = path.basename(key);
    try {
      await io.mkdir(dir, { recursive: true });
      await io.writeFile(path.join(dir, base), value, { encoding: "utf-8" });
      migratedAccount += 1;
    } catch {
      /* skip */
    }
  }
  return { migratedGlobal, migratedAccount };
}
