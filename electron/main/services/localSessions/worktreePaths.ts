/**
 * Official LocalSessionManager worktree path residual helpers.
 *
 * After a worktree is leased/created, official sets:
 *   session.cwd = worktreePath
 *   session.worktreePath = path
 *   session.worktreeName = name
 *   session.originCwd = original repo (kept for release / fallback)
 *
 * Product spawns CLI with `--worktree [name]`; the CLI (or desktop) must then
 * resolve the absolute path so resolveProjectDirForSession / PTY / release work.
 */

import { execFile } from "node:child_process";
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
    const byBranch = entries.find((entry) => entry.branch === name);
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
