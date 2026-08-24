import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { isManagedWorktreePath, parseGitWorktreePorcelain } from "./worktreePaths";

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

it("isManagedWorktreePath: only under .claude/worktrees or custom chillingSloth parent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccd-managed-wt-"));
  try {
    const repo = path.join(root, "repo");
    const managed = path.join(repo, ".claude", "worktrees", "ccd-abc");
    const outside = path.join(repo, "src");
    fs.mkdirSync(managed, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    await expect(isManagedWorktreePath(managed, repo)).resolves.toBe(await fs.promises.realpath(managed));
    await expect(isManagedWorktreePath(outside, repo)).resolves.toBe(false);
    await expect(isManagedWorktreePath(repo, repo)).resolves.toBe(false);

    const customRoot = path.join(root, "custom-sloth");
    const customParent = path.join(customRoot, "repo");
    const customWt = path.join(customParent, "ccd-xyz");
    fs.mkdirSync(customWt, { recursive: true });
    await expect(
      isManagedWorktreePath(customWt, repo, { customPath: customRoot }),
    ).resolves.toBe(await fs.promises.realpath(customWt));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
