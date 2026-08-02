import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getWorktreeBranchName,
  getWorktreeParentDir,
} from "./worktreePaths";
import {
  availableCodePermissionModes,
  clampCodePermissionMode,
} from "./codePermissionModePolicy";
import {
  areAllPrsTerminal,
  isTerminalPrState,
} from "./codeAutoArchiveEngine";

describe("getWorktreeParentDir (official chillingSlothLocation residual)", () => {
  it("default → baseRepo/.claude/worktrees", () => {
    const expected = path.join(path.resolve("/repo/project"), ".claude", "worktrees");
    expect(getWorktreeParentDir("/repo/project", "default")).toBe(expected);
  });

  it("customPath → join(customPath, basename(baseRepo))", () => {
    const expected = path.join(path.resolve("/worktrees-root"), "my-app");
    expect(
      getWorktreeParentDir("/repo/my-app", {
        customPath: "/worktrees-root",
      }),
    ).toBe(expected);
  });
});

describe("getWorktreeBranchName (official ccBranchPrefix residual)", () => {
  it("prefix claude → claude/name", () => {
    expect(getWorktreeBranchName("fox-run-abc", "claude")).toBe("claude/fox-run-abc");
  });

  it("strips slashes from prefix", () => {
    expect(getWorktreeBranchName("wt", "feat/")).toBe("feat/wt");
  });

  it("empty prefix → bare name", () => {
    expect(getWorktreeBranchName("wt", "")).toBe("wt");
    expect(getWorktreeBranchName("wt", null)).toBe("wt");
  });
});

describe("clampCodePermissionMode (official bypassPermissionsModeEnabled residual)", () => {
  it("clamps bypass → acceptEdits when pref off", () => {
    expect(clampCodePermissionMode("bypassPermissions", false)).toBe("acceptEdits");
  });

  it("keeps bypass when pref on", () => {
    expect(clampCodePermissionMode("bypassPermissions", true)).toBe("bypassPermissions");
  });

  it("passes other modes", () => {
    expect(clampCodePermissionMode("plan", false)).toBe("plan");
    expect(clampCodePermissionMode("default", true)).toBe("default");
  });
});

describe("availableCodePermissionModes", () => {
  it("omits bypass when disabled (includes auto residual)", () => {
    expect(availableCodePermissionModes(false)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
    ]);
  });

  it("includes bypass when enabled", () => {
    expect(availableCodePermissionModes(true)).toContain("bypassPermissions");
    expect(availableCodePermissionModes(true)).toContain("auto");
  });
});

describe("isTerminalPrState", () => {
  it("matches official TJ residual", () => {
    expect(isTerminalPrState("merged")).toBe(true);
    expect(isTerminalPrState("CLOSED")).toBe(true);
    expect(isTerminalPrState("open")).toBe(false);
    expect(isTerminalPrState(null)).toBe(false);
  });
});

describe("areAllPrsTerminal (official session.prs residual)", () => {
  it("false for empty / missing", () => {
    expect(areAllPrsTerminal(undefined)).toBe(false);
    expect(areAllPrsTerminal([])).toBe(false);
  });

  it("true when every PR is merged/closed", () => {
    expect(
      areAllPrsTerminal([
        { number: 1, state: "merged" },
        { number: 2, state: "CLOSED" },
      ]),
    ).toBe(true);
    expect(areAllPrsTerminal([{ number: 3, merged: true, state: "closed" }])).toBe(
      true,
    );
  });

  it("false when any PR still open", () => {
    expect(
      areAllPrsTerminal([
        { number: 1, state: "merged" },
        { number: 2, state: "open" },
      ]),
    ).toBe(false);
  });
});
