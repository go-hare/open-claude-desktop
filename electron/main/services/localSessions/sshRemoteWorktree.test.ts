import { expect, it } from "vitest";
import {
  createRemoteWorktree,
  defaultRemoteWorktreePath,
  generateRemoteWorktreeName,
  listRemoteWorktrees,
  removeRemoteWorktree,
} from "./sshRemoteWorktree";
import type { SessionSshConfig, SshExecResult } from "./sshTranscriptSync";

const config: SessionSshConfig = { host: "devbox", remoteCwd: "/home/u/proj" };

it("defaultRemoteWorktreePath nests under .claude/worktrees", () => {
  expect(defaultRemoteWorktreePath("/home/u/proj", "ccd-ab12")).toBe(
    "/home/u/proj/.claude/worktrees/ccd-ab12",
  );
});

it("generateRemoteWorktreeName: stable prefix", () => {
  expect(generateRemoteWorktreeName("ccd")).toMatch(/^ccd-[a-f0-9]{8}$/);
});

it("createRemoteWorktree: success path via fake exec", async () => {
  const commands: string[] = [];
  const execSsh = async (_c: SessionSshConfig, remoteCommand: string): Promise<SshExecResult> => {
    commands.push(remoteCommand);
    if (remoteCommand.includes("rev-parse")) {
      return { stdout: "true\n", stderr: "", exitCode: 0 };
    }
    if (remoteCommand.includes("worktree add")) {
      return { stdout: "Preparing worktree\n", stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  const result = await createRemoteWorktree({
    sshConfig: config,
    baseRepo: "/home/u/proj",
    worktreeName: "ccd-test1",
    sourceBranch: "main",
    execSsh,
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.worktree.path).toBe("/home/u/proj/.claude/worktrees/ccd-test1");
    expect(result.worktree.branch).toBe("ccd-test1");
    expect(result.worktree.sourceBranch).toBe("main");
  }
  expect(commands.some((c) => c.includes("worktree add"))).toBe(true);
});

it("createRemoteWorktree: non-git base is skipped", async () => {
  const execSsh = async (): Promise<SshExecResult> => ({
    stdout: "",
    stderr: "not a git repository",
    exitCode: 128,
  });
  const result = await createRemoteWorktree({
    sshConfig: config,
    baseRepo: "/tmp/not-git",
    execSsh,
  });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.skipped).toBe(true);
});

it("listRemoteWorktrees: parses porcelain over ssh", async () => {
  const porcelain = [
    "worktree /home/u/proj",
    "HEAD abc",
    "branch refs/heads/main",
    "",
    "worktree /home/u/proj/.claude/worktrees/ccd-1",
    "HEAD def",
    "branch refs/heads/ccd-1",
    "",
  ].join("\n");
  const execSsh = async (): Promise<SshExecResult> => ({
    stdout: porcelain,
    stderr: "",
    exitCode: 0,
  });
  const entries = await listRemoteWorktrees({
    sshConfig: config,
    baseRepo: "/home/u/proj",
    execSsh,
  });
  expect(entries).toHaveLength(2);
  expect(entries[1]?.branch).toBe("ccd-1");
});

it("removeRemoteWorktree: issues worktree remove", async () => {
  const commands: string[] = [];
  const execSsh = async (_c: SessionSshConfig, remoteCommand: string): Promise<SshExecResult> => {
    commands.push(remoteCommand);
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  const result = await removeRemoteWorktree({
    sshConfig: config,
    baseRepo: "/home/u/proj",
    worktreePath: "/home/u/proj/.claude/worktrees/ccd-1",
    branchName: "ccd-1",
    execSsh,
  });
  expect(result.ok).toBe(true);
  expect(commands.some((c) => c.includes("worktree remove"))).toBe(true);
});
