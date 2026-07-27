import { expect, it } from "vitest";
import { parseGitWorktreePorcelain } from "./worktreePaths";

it("parseGitWorktreePorcelain: official porcelain entries", () => {
  const text = [
    "worktree /repo",
    "HEAD abc",
    "branch refs/heads/main",
    "",
    "worktree /repo/.claude/worktrees/feature-x",
    "HEAD def",
    "branch refs/heads/feature-x",
    "",
    "worktree /repo/bare",
    "bare",
    "",
  ].join("\n");
  const entries = parseGitWorktreePorcelain(text);
  expect(entries).toEqual([
    { path: "/repo", head: "abc", branch: "main" },
    { path: "/repo/.claude/worktrees/feature-x", head: "def", branch: "feature-x" },
    { path: "/repo/bare", bare: true },
  ]);
});
