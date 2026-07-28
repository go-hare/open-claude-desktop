/**
 * Official LocalSessionManager worktree path residual helpers.
 *
 * After a worktree is leased/created, official sets:
 *   session.cwd = worktreePath
 *   session.worktreePath = path
 *   session.worktreeName = name
 *   session.originCwd = original repo (kept for release / fallback)
 *
 * Official WorktreeManager residual (app.asar):
 *   getWorktreeParentDir(baseRepo) ← gi("chillingSlothLocation")
 *     object.customPath → join(customPath, basename(baseRepo))
 *     else → join(baseRepo, ".claude", "worktrees")
 *   getBranchName(name) ← gi("ccBranchPrefix").replace(/\//g,"") → `${prefix}/${name}` or name
 *   createWorktree → mkdir parent + git worktree add [-b branch] path [source]
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorktreeListEntry = {
  path: string;
  bare?: boolean;
  head?: string;
  branch?: string;
};

export type ChillingSlothLocation =
  | "default"
  | string
  | { customPath: string }
  | null
  | undefined;

export type LocalWorktreeLease = {
  name: string;
  path: string;
  baseRepo: string;
  branch: string;
  sourceBranch?: string;
};

export type CreateLocalWorktreeResult =
  | { success: true; worktree: LocalWorktreeLease }
  | { success: false; error: string; skipped?: boolean };

/** Parse `git worktree list --porcelain` (official worktree inventory shape). */
export function parseGitWorktreePorcelain(text: string): WorktreeListEntry[] {
  const entries: WorktreeListEntry[] = [];
  let current: WorktreeListEntry | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      current = null;
      continue;
    }
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length) };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    if (line === "bare") current.bare = true;
    else if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      current.branch = ref.replace(/^refs\/heads\//, "");
    }
  }
  return entries;
}

async function gitWorktreeList(repoCwd: string): Promise<WorktreeListEntry[]> {
  try {
    const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoCwd,
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return parseGitWorktreePorcelain(String(stdout ?? ""));
  } catch {
    return [];
  }
}

/**
 * Official getWorktreeParentDir residual:
 *   const t = gi("chillingSlothLocation");
 *   if (typeof t === "object" && "customPath" in t)
 *     return join(t.customPath, basename(baseRepo));
 *   return join(baseRepo, ".claude", "worktrees");
 */
export function getWorktreeParentDir(
  baseRepo: string,
  chillingSlothLocation: ChillingSlothLocation = "default",
): string {
  const repo = path.resolve(baseRepo);
  if (
    chillingSlothLocation
    && typeof chillingSlothLocation === "object"
    && "customPath" in chillingSlothLocation
    && typeof chillingSlothLocation.customPath === "string"
    && chillingSlothLocation.customPath.trim()
  ) {
    return path.join(
      path.resolve(chillingSlothLocation.customPath),
      path.basename(repo),
    );
  }
  return path.join(repo, ".claude", "worktrees");
}

/**
 * Official getBranchName residual:
 *   const t = gi("ccBranchPrefix").replace(/\//g, "");
 *   return t ? `${t}/${name}` : name;
 */
export function getWorktreeBranchName(
  worktreeName: string,
  ccBranchPrefix: string | null | undefined = "claude",
): string {
  const prefix = String(ccBranchPrefix ?? "").replace(/\//g, "").trim();
  return prefix ? `${prefix}/${worktreeName}` : worktreeName;
}

/** Product subset of official generateWorktreeName (adjective-noun-hex → ccd-hex). */
export function generateLocalWorktreeName(): string {
  return `ccd-${randomBytes(3).toString("hex")}`;
}

function sanitizeWorktreeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "wt";
}

/**
 * Official createWorktree residual (local host subset):
 *   parent = getWorktreeParentDir(baseRepo)
 *   path = join(parent, name)
 *   branch = getBranchName(name)
 *   git worktree add [-b branch] path [sourceBranch]
 */
export async function createLocalWorktree(options: {
  baseRepo: string;
  worktreeName?: string;
  branchName?: string;
  sourceBranch?: string;
  chillingSlothLocation?: ChillingSlothLocation;
  ccBranchPrefix?: string | null;
}): Promise<CreateLocalWorktreeResult> {
  const baseRepo = path.resolve(options.baseRepo);
  if (!baseRepo || !fs.existsSync(baseRepo)) {
    return { success: false, error: "missing baseRepo" };
  }

  // Official skips non-git repos rather than failing the turn hard.
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd: baseRepo, timeout: 10_000 },
    );
    if (String(stdout ?? "").trim() !== "true") {
      return { success: false, error: `${baseRepo} is not a git repository`, skipped: true };
    }
  } catch {
    return { success: false, error: `${baseRepo} is not a git repository`, skipped: true };
  }

  const name = sanitizeWorktreeName(options.worktreeName || generateLocalWorktreeName());
  // Branch may contain prefix/name; sanitize segments only, keep single slash
  // (official getBranchName returns `${prefix}/${name}`).
  const rawBranch = options.branchName || getWorktreeBranchName(name, options.ccBranchPrefix);
  const branchSafe =
    rawBranch
      .split("/")
      .map((part) => sanitizeWorktreeName(part))
      .filter(Boolean)
      .join("/") || name;
  const parent = getWorktreeParentDir(baseRepo, options.chillingSlothLocation);
  const worktreePath = path.join(parent, name);
  const source = options.sourceBranch?.trim();

  try {
    fs.mkdirSync(parent, { recursive: true });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create worktree parent directory",
    };
  }

  if (fs.existsSync(worktreePath)) {
    // Already present (pool / prior lease) — treat as success attach target.
    return {
      success: true,
      worktree: {
        name,
        path: worktreePath,
        baseRepo,
        branch: branchSafe,
        sourceBranch: source,
      },
    };
  }

  const args = [
    "-c",
    "core.longpaths=true",
    "worktree",
    "add",
    "-b",
    branchSafe,
    worktreePath,
  ];
  if (source) args.push(source);

  try {
    await execFileAsync("git", args, {
      cwd: baseRepo,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    return {
      success: false,
      error: err.stderr?.trim() || err.message || "git worktree add failed",
    };
  }

  return {
    success: true,
    worktree: {
      name,
      path: worktreePath,
      baseRepo,
      branch: branchSafe,
      sourceBranch: source,
    },
  };
}

/**
 * Resolve absolute worktree path for a session that only has worktreeName / useWorktree.
 * Prefer exact basename / branch match; fall back to newest non-main worktree under repo.
 */
export async function resolveWorktreePath(options: {
  originCwd?: string;
  cwd?: string;
  worktreeName?: string;
  worktreePath?: string;
}): Promise<string | null> {
  if (options.worktreePath && fs.existsSync(options.worktreePath)) {
    return path.resolve(options.worktreePath);
  }

  const repo = options.originCwd || options.cwd;
  if (!repo || !fs.existsSync(repo)) return null;

  const entries = (await gitWorktreeList(repo)).filter((entry) => !entry.bare && entry.path);
  if (entries.length === 0) return null;

  const name = options.worktreeName?.trim();
  if (name) {
    const byBranch = entries.find((entry) => entry.branch === name || entry.branch?.endsWith(`/${name}`));
    if (byBranch) return path.resolve(byBranch.path);
    const byBasename = entries.find((entry) => path.basename(entry.path) === name);
    if (byBasename) return path.resolve(byBasename.path);
    const byIncludes = entries.find((entry) => entry.path.includes(name));
    if (byIncludes) return path.resolve(byIncludes.path);
  }

  // If cwd already points at a listed worktree that is not the main repo, keep it.
  if (options.cwd) {
    const resolvedCwd = path.resolve(options.cwd);
    const hit = entries.find((entry) => path.resolve(entry.path) === resolvedCwd);
    if (hit && path.resolve(hit.path) !== path.resolve(repo)) return path.resolve(hit.path);
  }

  return null;
}

/**
 * Official releaseWorktree residual (subset):
 * remove the git worktree (when requested) and point session back at originCwd.
 */
export async function removeGitWorktree(options: {
  originCwd: string;
  worktreePath: string;
  force?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const origin = options.originCwd;
  const target = options.worktreePath;
  if (!origin || !target) return { ok: false, error: "missing originCwd/worktreePath" };
  if (path.resolve(origin) === path.resolve(target)) {
    return { ok: false, error: "refusing to remove origin cwd as worktree" };
  }
  try {
    const args = ["worktree", "remove", ...(options.force === false ? [] : ["--force"]), target];
    await execFileAsync("git", args, {
      cwd: origin,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true };
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    // Already gone → success for release UX.
    if (!fs.existsSync(target)) return { ok: true };
    return { ok: false, error: err.stderr || err.message || "git worktree remove failed" };
  }
}
