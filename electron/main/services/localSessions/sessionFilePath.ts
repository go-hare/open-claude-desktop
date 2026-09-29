/**
 * Official LocalSessionManager file-path residual (app.asar `hE`):
 *   resolveSessionFilePath / listSessionDirectory / writeSessionFile /
 *   readSessionImageAsDataUrl
 *
 * `Hs` is UNC rejection (`QRA && !LL`), not workspace-root escape.
 * list / write / image use `cQ` (`dw` realpath + `t4` relative) in `worktreePath ?? cwd`.
 * read uses resolveSessionFilePath (`Uc` hop check, git unique-name, isFile).
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** Official `hE.SESSION_FILE_MAX_BYTES` / `SESSION_IMAGE_MAX_BYTES`. */
export const SESSION_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const SESSION_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Official `Uc` hop cap (`Wni`). */
export const SYMLINK_HOP_LIMIT = 40;

/** Official `hE.IMAGE_EXT_TO_MIME`. Unknown ext → image IPC returns null. */
export const IMAGE_EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

export type SessionFileContext = {
  cwd?: string;
  sourceBranch?: string;
  sshConfig?: unknown;
  worktreePath?: string;
};

export type GitRunner = (args: string[], cwd: string) => Promise<string | null>;

export type SessionDirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

const WSL_UNC = /^[\\/]{2}(wsl\$|wsl\.localhost)(?=[\\/]|$)/i;
const PATH_SPLIT = process.platform === "win32" ? /[\\/]+/ : /\/+/;

class UncPathError extends Error {}
class SymlinkHopLimitError extends Error {}

/** Official `gC`: expand `~` / `~/` / `~\`. */
export function expandHomePath(filePath: string): string {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(homedir(), filePath.slice(2));
  }
  return filePath;
}

/** Official `LL` (`jni`). */
export function isWslUncPath(filePath: string): boolean {
  return WSL_UNC.test(filePath);
}

/**
 * Official `aE`: WSL UNC slash-normalize + `\\wsl.localhost` host lowercasing.
 * Non-WSL paths are returned unchanged.
 */
export function normalizeWslUnc(filePath: string): string {
  if (!isWslUncPath(filePath)) return filePath;
  return filePath
    .replace(/\//g, "\\")
    .replace(
      /^\\\\(wsl\$|wsl\.localhost)(\\[^\\]+)?/i,
      (_all, _kind: string, rest = "") => `\\\\wsl.localhost${String(rest).toLowerCase()}`,
    );
}

/** Official `QRA`: normalized path starts with `\\` or `//`. */
export function isUncNormalized(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  return normalized.startsWith("\\\\") || normalized.startsWith("//");
}

/**
 * Official `Hs` (`QRA && !LL`). Also reject raw `//` / `\\` because posix
 * `path.normalize("//server/share")` eats the UNC prefix.
 */
export function isRejectedUncPath(filePath: string): boolean {
  if (!filePath) return false;
  if (isWslUncPath(filePath)) return false;
  const normalized = path.normalize(filePath);
  const isUnc =
    filePath.startsWith("\\\\")
    || filePath.startsWith("//")
    || normalized.startsWith("\\\\")
    || normalized.startsWith("//");
  return isUnc && !isWslUncPath(normalized);
}

/**
 * Official `t4(target, root, {allowEqual})`.
 * `path.relative(root, target)` must stay inside root (not `..`).
 */
export function isRelativeInside(
  target: string,
  root: string,
  options?: { allowEqual?: boolean },
): boolean {
  const relative = path.relative(root, target);
  if (relative.length === 0) return options?.allowEqual ?? true;
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/** Sync `t4` on `path.resolve` (no realpath). Prefer `containedRealpath` at IPC. */
export function isPathInsideRoot(root: string, target: string, options?: { allowEqual?: boolean }): boolean {
  return isRelativeInside(path.resolve(target), path.resolve(root), options);
}

export function sessionWorkspaceRoot(session: SessionFileContext | null | undefined): string | null {
  if (!session) return null;
  const root = session.worktreePath ?? session.cwd;
  return root && root.length > 0 ? root : null;
}

/**
 * Official `Uc`: walk components with `lstat`; reject UNC (incl. symlink-to-UNC);
 * hop cap 40. Missing path returns (write of new files).
 */
export async function assertNoUncSymlinkHops(filePath: string): Promise<void> {
  let current = path.resolve(normalizeWslUnc(filePath));
  if (isRejectedUncPath(normalizeWslUnc(filePath))) {
    throw new UncPathError(`UNC path not allowed: ${filePath}`);
  }
  let hops = 0;
  for (;;) {
    if (isRejectedUncPath(current)) {
      throw new UncPathError(`UNC path not allowed: ${current}`);
    }
    const { root } = path.parse(current);
    const parts = current.slice(root.length).split(PATH_SPLIT).filter(Boolean);
    let cursor = root;
    let index = 0;
    for (; index < parts.length; index += 1) {
      cursor = path.join(cursor, parts[index]!);
      const stat = await fs.lstat(cursor).catch(() => null);
      if (!stat) return;
      if (stat.isSymbolicLink()) break;
    }
    if (index === parts.length) return;
    hops += 1;
    if (hops > SYMLINK_HOP_LIMIT) {
      throw new SymlinkHopLimitError(`Symlink hop limit exceeded: ${filePath}`);
    }
    const link = normalizeWslUnc(String(await fs.readlink(cursor)));
    if (isRejectedUncPath(link)) {
      throw new UncPathError(`Symlink to UNC target: ${cursor} -> ${link}`);
    }
    current = path.resolve(path.dirname(cursor), link, ...parts.slice(index + 1));
  }
}

/**
 * Official `dw`: `Uc` then `realpath`, reconstructing missing suffix under the
 * deepest existing real parent (write of new files).
 */
export async function canonicalSessionPath(filePath: string): Promise<string> {
  const normalized = normalizeWslUnc(filePath);
  await assertNoUncSymlinkHops(normalized);
  const resolved = path.resolve(normalized);
  try {
    return await fs.realpath(resolved);
  } catch {
    // continue reconstruction
  }
  const missing: string[] = [];
  let cursor = resolved;
  while (cursor !== path.dirname(cursor)) {
    const stat = await fs.lstat(cursor).catch(() => null);
    if (stat?.isSymbolicLink()) {
      const link = String(await fs.readlink(cursor));
      const parentReal = await fs.realpath(path.dirname(cursor));
      return canonicalSessionPath(path.resolve(parentReal, link, ...missing));
    }
    missing.unshift(path.basename(cursor));
    cursor = path.dirname(cursor);
    try {
      const real = await fs.realpath(cursor);
      return path.join(real, ...missing);
    } catch {
      // walk up
    }
  }
  return resolved;
}

/**
 * Official `cQ` / `isSafeWriteDestination`: realpath both sides, then `t4`.
 * Returns the canonical target or null.
 */
export async function containedRealpath(
  target: string,
  root: string,
  options?: { allowEqual?: boolean },
): Promise<string | null> {
  try {
    const realTarget = await canonicalSessionPath(normalizeWslUnc(target));
    const realRoot = await canonicalSessionPath(normalizeWslUnc(root));
    return isRelativeInside(realTarget, realRoot, options) ? realTarget : null;
  } catch {
    return null;
  }
}

export function gitLinesMatchingName(stdout: string, requested: string): string[] {
  const bare = requested.replace(/^\.\//, "");
  const suffix = `/${bare}`;
  return [...new Set(stdout.split("\n").filter((line) => line === bare || line.endsWith(suffix)))];
}

async function defaultGit(args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(String(stdout ?? ""));
    });
  });
}

/**
 * Official unique-name fallback when cwd/relative does not exist.
 * ls-files, then untracked --exclude-standard. Multiple hits prefer the one
 * also in the branch/worktree diff; else the path sharing the longest prefix
 * with changed files.
 *
 * Official: `ls-files` catch → skip unique-name (no filesystem walk).
 */
export async function disambiguateSessionFile(
  root: string,
  requested: string,
  sourceBranch?: string,
  git: GitRunner = defaultGit,
): Promise<string | null> {
  const listed = await git(["-c", "core.quotepath=false", "ls-files"], root);
  if (listed === null) return null;
  let matches = gitLinesMatchingName(listed, requested);
  if (matches.length === 0) {
    const untracked = await git(
      ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard"],
      root,
    );
    if (untracked) matches = gitLinesMatchingName(untracked, requested);
  }
  if (matches.length === 1) return matches[0] ?? null;
  if (matches.length === 0) return null;

  let changed: string[] | null = null;
  if (sourceBranch) {
    const diff = await git(
      ["-c", "core.quotepath=false", "diff", "--name-only", "--relative", `${sourceBranch}...HEAD`, "--"],
      root,
    );
    if (diff) changed = diff.split("\n").filter(Boolean);
  }
  if (!changed?.length) {
    const dirty = await git(
      ["-c", "core.quotepath=false", "ls-files", "--modified", "--others", "--exclude-standard"],
      root,
    );
    if (dirty) changed = dirty.split("\n").filter(Boolean);
  }
  if (!changed?.length) return null;

  const changedSet = new Set(changed);
  const overlap = matches.filter((line) => changedSet.has(line));
  if (overlap.length === 1) return overlap[0] ?? null;

  const changedParts = changed.filter((line) => !matches.includes(line)).map((line) => line.split("/"));
  if (changedParts.length === 0) return null;
  const score = (candidate: string) => {
    const parts = candidate.split("/");
    let best = 0;
    for (const other of changedParts) {
      let i = 0;
      const limit = Math.min(parts.length - 1, other.length - 1);
      while (i < limit && parts[i] === other[i]) i += 1;
      if (i > best) best = i;
    }
    return best;
  };
  const ranked = matches.map((line) => ({ line, score: score(line) })).sort((a, b) => b.score - a.score);
  const first = ranked[0];
  const second = ranked[1];
  if (first && second && first.score > 0 && first.score > second.score) return first.line;
  return null;
}

/**
 * Official `resolveSessionFilePath`:
 * ssh / missing session → null; `Hs` UNC → null; `Uc` hop fail → null;
 * missing file → null (side pane "File could not be read").
 * Git unique-name only when the direct path misses. `ls-files` catch skips it.
 */
export async function resolveSessionFilePath(
  session: SessionFileContext | null | undefined,
  filePath: string,
  git: GitRunner = defaultGit,
): Promise<string | null> {
  if (!session || session.sshConfig) return null;
  const root = sessionWorkspaceRoot(session);
  if (!root) return null;
  const expanded = expandHomePath(filePath);
  if (isRejectedUncPath(expanded)) return null;
  let resolved = path.resolve(root, expanded);
  try {
    await assertNoUncSymlinkHops(resolved);
  } catch {
    return null;
  }
  let stat = await fs.stat(resolved).catch(() => null);
  if (!stat && !path.isAbsolute(expanded)) {
    const match = await disambiguateSessionFile(root, filePath, session.sourceBranch, git);
    if (match) {
      resolved = path.resolve(root, match);
      try {
        await assertNoUncSymlinkHops(resolved);
      } catch {
        return null;
      }
      stat = await fs.stat(resolved).catch(() => null);
    }
  }
  return stat?.isFile() ? resolved : null;
}

/**
 * Official listSessionDirectory / writeSessionFile / readSessionImageAsDataUrl:
 * `cQ` containment under `worktreePath ?? cwd`. Does not require the path to exist
 * (write creates) and does not require isFile (list is a directory).
 */
export async function resolveSessionContainedPath(
  session: SessionFileContext | null | undefined,
  filePath: string,
  options: { expandHome?: boolean } = {},
): Promise<string | null> {
  if (!session || session.sshConfig) return null;
  const root = sessionWorkspaceRoot(session);
  if (!root) return null;
  if (isRejectedUncPath(filePath)) return null;
  const next = options.expandHome === false ? filePath : expandHomePath(filePath);
  if (isRejectedUncPath(next)) return null;
  const resolved = path.resolve(root, next);
  return containedRealpath(resolved, root);
}

/**
 * Official `listSessionDirectory`: `Hs` → []; `cQ` then readdir; skip dot names;
 * `{name, path: join(unresolved, name), isDirectory}`.
 */
export async function listSessionDirectoryEntries(
  session: SessionFileContext | null | undefined,
  dirPath: string,
): Promise<SessionDirectoryEntry[]> {
  if (!session || session.sshConfig) return [];
  if (isRejectedUncPath(dirPath)) return [];
  const root = sessionWorkspaceRoot(session);
  if (!root) return [];
  const unresolved = path.resolve(root, expandHomePath(dirPath));
  try {
    const contained = await containedRealpath(unresolved, root);
    if (!contained) return [];
    const entries = await fs.readdir(contained, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => ({
        name: entry.name,
        path: path.join(unresolved, entry.name),
        isDirectory: entry.isDirectory(),
      }));
  } catch {
    return [];
  }
}

export function mimeTypeForSessionImage(filePath: string): string | null {
  return IMAGE_EXT_TO_MIME[path.extname(filePath).toLowerCase()] ?? null;
}
