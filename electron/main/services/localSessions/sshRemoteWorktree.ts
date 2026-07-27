/**
 * Official remote worktree residual (product host-pipe subset):
 *
 * Full official path: remote harness RPC
 *   createWorktree → rpcClient.call("git.worktree_create", { baseRepo, branchName, worktreePath, sourceBranch })
 *   createRemoteWorktree → path `${baseRepo}/.claude/worktrees/${name}`
 *
 * Product subset (no RPC harness): run the same git operations over `ssh` exec:
 *   git -C <base> worktree add [-B branch] <path> [sourceBranch]
 *   git -C <base> worktree remove [--force] <path>
 *
 * Session fields after lease (same as local attachWorktree):
 *   cwd = worktreePath (remote absolute)
 *   originCwd = base repo
 *   worktreeName / useWorktree
 */

import { randomBytes } from "node:crypto";
import {
  defaultExecSsh,
  shellQuote,
  type SessionSshConfig,
  type SshExecResult,
} from "./sshTranscriptSync";

export type RemoteWorktreeLease = {
  name: string;
  path: string;
  baseRepo: string;
  branch: string;
  sourceBranch?: string;
};

export type RemoteWorktreeResult =
  | { success: true; worktree: RemoteWorktreeLease }
  | { success: false; error: string; skipped?: boolean };

function sanitizeWorktreeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "wt";
}

export function generateRemoteWorktreeName(prefix = "ccd"): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

export function defaultRemoteWorktreePath(baseRepo: string, name: string): string {
  const base = baseRepo.replace(/\/+$/, "") || ".";
  return `${base}/.claude/worktrees/${name}`;
}

async function execRemote(
  sshConfig: SessionSshConfig,
  remoteCommand: string,
  execSsh: (config: SessionSshConfig, cmd: string) => Promise<SshExecResult>,
): Promise<SshExecResult> {
  return execSsh(sshConfig, `sh -c ${shellQuote(remoteCommand)}`);
}

/**
 * Create a remote git worktree (official createRemoteWorktree subset via host ssh).
 */
export async function createRemoteWorktree(options: {
  sshConfig: SessionSshConfig;
  baseRepo: string;
  /** Optional explicit worktree name; otherwise generated. */
  worktreeName?: string;
  /** Branch to create/cut (defaults to worktree name). */
  branchName?: string;
  /** Source ref (defaults HEAD). */
  sourceBranch?: string;
  /** Absolute remote path; default baseRepo/.claude/worktrees/<name>. */
  worktreePath?: string;
  execSsh?: (config: SessionSshConfig, cmd: string) => Promise<SshExecResult>;
}): Promise<RemoteWorktreeResult> {
  const baseRepo = options.baseRepo.trim();
  if (!baseRepo) return { success: false, error: "missing baseRepo" };
  const name = sanitizeWorktreeName(options.worktreeName || generateRemoteWorktreeName());
  const branch = sanitizeWorktreeName(options.branchName || name);
  const worktreePath = (options.worktreePath || defaultRemoteWorktreePath(baseRepo, name)).trim();
  const source = options.sourceBranch?.trim();
  const execSsh = options.execSsh ?? defaultExecSsh;

  // Ensure parent dir exists; git worktree add will create the leaf.
  const parent = worktreePath.replace(/\/[^/]+\/?$/, "") || ".";
  await execRemote(
    options.sshConfig,
    `mkdir -p ${shellQuote(parent)}`,
    execSsh,
  );

  // Probe git repo — official skips with not-a-git-repo.
  const probe = await execRemote(
    options.sshConfig,
    `git -C ${shellQuote(baseRepo)} rev-parse --is-inside-work-tree 2>/dev/null`,
    execSsh,
  );
  if (probe.exitCode !== 0 || !probe.stdout.trim().includes("true")) {
    return {
      success: false,
      error: `${baseRepo} is not a git repository`,
      skipped: true,
    };
  }

  const addArgs = [
    "git",
    "-C",
    shellQuote(baseRepo),
    "worktree",
    "add",
    "-B",
    shellQuote(branch),
    shellQuote(worktreePath),
  ];
  if (source) addArgs.push(shellQuote(source));
  const created = await execRemote(options.sshConfig, addArgs.join(" "), execSsh);
  if (created.exitCode !== 0) {
    return {
      success: false,
      error: created.stderr.trim() || created.stdout.trim() || "git worktree add failed",
    };
  }

  return {
    success: true,
    worktree: {
      name,
      path: worktreePath,
      baseRepo,
      branch,
      sourceBranch: source,
    },
  };
}

/**
 * Remove a remote git worktree (official removeWorktree subset via host ssh).
 */
export async function removeRemoteWorktree(options: {
  sshConfig: SessionSshConfig;
  baseRepo: string;
  worktreePath: string;
  branchName?: string;
  force?: boolean;
  execSsh?: (config: SessionSshConfig, cmd: string) => Promise<SshExecResult>;
}): Promise<{ ok: boolean; error?: string }> {
  const baseRepo = options.baseRepo.trim();
  const worktreePath = options.worktreePath.trim();
  if (!baseRepo || !worktreePath) return { ok: false, error: "missing baseRepo/worktreePath" };
  if (baseRepo === worktreePath) return { ok: false, error: "refusing to remove origin cwd as worktree" };

  const execSsh = options.execSsh ?? defaultExecSsh;
  const force = options.force !== false ? "--force" : "";
  const remove = await execRemote(
    options.sshConfig,
    `git -C ${shellQuote(baseRepo)} worktree remove ${force} ${shellQuote(worktreePath)}`.replace(/\s+/g, " ").trim(),
    execSsh,
  );
  if (remove.exitCode !== 0) {
    // Best-effort prune + rm if worktree remove fails (stale registration).
    await execRemote(
      options.sshConfig,
      `git -C ${shellQuote(baseRepo)} worktree prune 2>/dev/null; rm -rf ${shellQuote(worktreePath)}`,
      execSsh,
    );
  }

  if (options.branchName) {
    await execRemote(
      options.sshConfig,
      `git -C ${shellQuote(baseRepo)} branch -D ${shellQuote(options.branchName)} 2>/dev/null || true`,
      execSsh,
    );
  }

  return { ok: true };
}

/**
 * List remote worktrees via `git worktree list --porcelain` over SSH.
 */
export async function listRemoteWorktrees(options: {
  sshConfig: SessionSshConfig;
  baseRepo: string;
  execSsh?: (config: SessionSshConfig, cmd: string) => Promise<SshExecResult>;
}): Promise<Array<{ path: string; branch?: string; bare?: boolean }>> {
  const execSsh = options.execSsh ?? defaultExecSsh;
  const result = await execRemote(
    options.sshConfig,
    `git -C ${shellQuote(options.baseRepo)} worktree list --porcelain 2>/dev/null`,
    execSsh,
  );
  if (result.exitCode !== 0) return [];
  const entries: Array<{ path: string; branch?: string; bare?: boolean }> = [];
  let current: { path: string; branch?: string; bare?: boolean } | null = null;
  for (const line of result.stdout.split(/\r?\n/)) {
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
    else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  return entries;
}
