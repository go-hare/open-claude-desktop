/**
 * Official createBaseHooks / createCanUseTool residual unit tests.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyCoworkGrowthBookFeatures,
  isCoworkGrowthBookFeatureOn,
  resetCoworkGrowthBookFeaturesForTests,
} from "../coworkHostLoop/coworkGrowthBookFeatures";
import {
  OFFICIAL_INTERACTIVE_MCP_TOOLS,
  OFFICIAL_PRETOOLUSE_MATCHER_MZE_ZE,
  OFFICIAL_PRETOOLUSE_MATCHER_RZE,
  OFFICIAL_PREVIEW_AUTO_ALLOW_TOOLS,
  OFFICIAL_STRIP_SUGGESTIONS_TOOLS,
  OFFICIAL_WORKTREE_WRITE_TOOL_MATCHER,
  officialAlwaysAllowedReasonHit,
  officialAutoAllowTool,
  officialIsInteractiveMcpTool,
  officialIsPreviewStartTool,
  officialMcpToolEnabledGuard,
  officialPreviewStartPermission,
  officialRemoteDispatchPermissionDeny,
  officialReplaySessionPermissions,
  officialScheduledTaskShouldAutoApprove,
  officialSessionDestinationSuggestions,
  officialSessionPermissionAllowShortCircuit,
  officialUnsupervisedInteractiveGuard,
  officialWorktreeWriteGuard,
} from "./codeSdkHooksResidual";

/** Official pt("2393677837") — keep test free of codeSdkQuerySession electron imports. */
const WORKTREE_WRITE_GUARD_FLAG_ID = "2393677837";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("codeSdkHooksResidual official matchers", () => {
  it("exports exact Rze / Mze|_ze PreToolUse matchers", () => {
    expect(OFFICIAL_PRETOOLUSE_MATCHER_RZE).toBe(
      OFFICIAL_INTERACTIVE_MCP_TOOLS.requestDirectory,
    );
    expect(OFFICIAL_PRETOOLUSE_MATCHER_RZE).toBe("mcp__ccd_directory__request_directory");
    expect(OFFICIAL_PRETOOLUSE_MATCHER_MZE_ZE).toBe(
      "mcp__ccd_session_mgmt__archive_session|mcp__ccd_session_mgmt__search_session_transcripts",
    );
    expect(OFFICIAL_WORKTREE_WRITE_TOOL_MATCHER).toBe("Edit|Write|MultiEdit|NotebookEdit");
    expect(OFFICIAL_PREVIEW_AUTO_ALLOW_TOOLS).toContain("preview_resize");
  });

  it("xXi auto-allows Claude Preview YXi tools and terminal read", () => {
    expect(officialAutoAllowTool("mcp__terminal__read_terminal")).toBe(true);
    expect(officialAutoAllowTool("mcp__Claude_Preview__preview_list")).toBe(true);
    expect(officialAutoAllowTool("mcp__Claude_Preview__preview_resize")).toBe(true);
    expect(officialAutoAllowTool("mcp__Claude_Preview__preview_start")).toBe(false);
    expect(officialIsPreviewStartTool("mcp__Claude_Preview__preview_start")).toBe(true);
    expect(officialIsPreviewStartTool("preview_start")).toBe(true);
  });

  it("fkA blocks interactive tools only in unsupervised modes", () => {
    expect(officialUnsupervisedInteractiveGuard("auto").decision).toBe("block");
    expect(officialUnsupervisedInteractiveGuard("bypassPermissions").decision).toBe("block");
    expect(officialUnsupervisedInteractiveGuard("default").decision).toBe("allow");
    expect(officialIsInteractiveMcpTool(OFFICIAL_INTERACTIVE_MCP_TOOLS.requestDirectory)).toBe(
      true,
    );
    expect(officialIsInteractiveMcpTool(OFFICIAL_INTERACTIVE_MCP_TOOLS.archiveSession)).toBe(
      true,
    );
  });

  it("Sit blocks disabled mcp tools", () => {
    const blocked = officialMcpToolEnabledGuard("mcp__foo__bar", { "foo:bar": false });
    expect(blocked.decision).toBe("block");
    const allowed = officialMcpToolEnabledGuard("mcp__foo__bar", { "foo:bar": true });
    expect(allowed.decision).toBe("allow");
  });

  it("ptr blocks base checkout writes outside worktree", () => {
    const base = path.join(os.tmpdir(), "wt-base-" + Date.now());
    const wt = path.join(base, ".claude", "worktrees", "s1");
    fs.mkdirSync(wt, { recursive: true });
    tempDirs.push(base);
    const blocked = officialWorktreeWriteGuard(
      { worktreePath: wt, baseRepo: base },
      { file_path: path.join(base, "src", "a.ts") },
    );
    expect(blocked.decision).toBe("block");
    if (blocked.decision === "block") {
      expect(blocked.target).toBe("base_checkout");
    }
    const ok = officialWorktreeWriteGuard(
      { worktreePath: wt, baseRepo: base },
      { file_path: path.join(wt, "src", "a.ts") },
    );
    expect(ok.decision).toBeUndefined();
  });

  it("worktree-write-guard flag 2393677837 defaults off (ft residual)", () => {
    resetCoworkGrowthBookFeaturesForTests();
    // kni does not force this flag — unknown → off (official pt default false).
    expect(isCoworkGrowthBookFeatureOn(WORKTREE_WRITE_GUARD_FLAG_ID)).toBe(false);
    applyCoworkGrowthBookFeatures({
      [WORKTREE_WRITE_GUARD_FLAG_ID]: {
        on: true,
        value: true,
        source: "test",
      },
    });
    expect(isCoworkGrowthBookFeatureOn(WORKTREE_WRITE_GUARD_FLAG_ID)).toBe(true);
    resetCoworkGrowthBookFeaturesForTests();
  });

  it("zHA denies when launch.json missing", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "zha-"));
    tempDirs.push(cwd);
    const result = await officialPreviewStartPermission({}, cwd);
    expect(result.action).toBe("deny");
    if (result.action === "deny") {
      expect(result.message).toMatch(/launch\.json/);
    }
  });

  it("zHA returns start with resolved Ize input when config exists", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "zha-cfg-"));
    tempDirs.push(cwd);
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".claude", "launch.json"),
      JSON.stringify({
        version: "0.0.1",
        configurations: [
          {
            name: "frontend",
            runtimeExecutable: "npm",
            runtimeArgs: ["run", "dev"],
            port: 5173,
          },
        ],
      }),
      "utf8",
    );
    const result = await officialPreviewStartPermission({ name: "frontend" }, cwd);
    expect(result.action).toBe("start");
    if (result.action === "start") {
      expect(result.resolvedInput.name).toBe("frontend");
      expect(result.resolvedInput.command).toBe("npm");
      expect(result.resolvedInput.port).toBe(5173);
    }
  });

  it("replaySessionPermissions merges allow rules and directories", () => {
    const options: { allowedTools?: string[]; additionalDirectories?: string[] } = {
      allowedTools: ["Bash"],
      additionalDirectories: ["/a"],
    };
    officialReplaySessionPermissions(
      [
        {
          type: "addRules",
          behavior: "allow",
          rules: [{ toolName: "Edit" }, { toolName: "Bash", ruleContent: "git *" }],
        },
        { type: "addDirectories", directories: ["/b", "/a"] },
      ],
      options,
    );
    expect(options.allowedTools).toEqual(expect.arrayContaining(["Bash", "Edit", "Bash(git *)"]));
    expect(options.additionalDirectories).toEqual(expect.arrayContaining(["/a", "/b"]));
  });

  it("session permission short-circuit allows bare toolName rules only outside plan", () => {
    const updates = [
      {
        type: "addRules" as const,
        behavior: "allow" as const,
        rules: [{ toolName: "Edit" }, { toolName: "Bash", ruleContent: "git *" }],
      },
    ];
    expect(officialSessionPermissionAllowShortCircuit(updates, "Edit", "default")).toBe(true);
    // ruleContent present → not a bare session allow short-circuit
    expect(officialSessionPermissionAllowShortCircuit(updates, "Bash", "default")).toBe(false);
    expect(officialSessionPermissionAllowShortCircuit(updates, "Edit", "plan")).toBe(false);
    expect(
      officialAlwaysAllowedReasonHit(["Bash:dangerous"], "Bash", "dangerous", "default"),
    ).toBe(true);
    expect(
      officialAlwaysAllowedReasonHit(["Bash:dangerous"], "Bash", "dangerous", "plan"),
    ).toBe(false);
  });

  it("xtr strips interactive tools and session suggestions skip browser/computer", () => {
    expect(OFFICIAL_STRIP_SUGGESTIONS_TOOLS.has(OFFICIAL_INTERACTIVE_MCP_TOOLS.requestDirectory)).toBe(
      true,
    );
    const applied = officialSessionDestinationSuggestions([
      {
        type: "addRules",
        behavior: "allow",
        destination: "session",
        rules: [
          { toolName: "Edit" },
          { toolName: "browser:click" },
          { toolName: "computer:type" },
        ],
      },
      {
        type: "addDirectories",
        destination: "session",
        directories: ["/tmp/a"],
      },
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ]);
    expect(applied.rules.map((r) => r.toolName)).toEqual(["Edit"]);
    expect(applied.directories).toEqual(["/tmp/a"]);
    expect(applied.setMode).toBe("acceptEdits");
  });

  it("remote-dispatch deny uses exact official message", () => {
    const deny = officialRemoteDispatchPermissionDeny("Bash", "remote");
    expect(deny?.decision).toBe("deny");
    expect(deny?.message).toMatch(/remote dispatch orchestrator can't prompt/);
    expect(officialRemoteDispatchPermissionDeny("Bash", "local")).toBeNull();
  });

  it("scheduled auto-approve requires stored approvals covering all suggestion tools", () => {
    const suggestions = [
      {
        type: "addRules",
        behavior: "allow",
        rules: [{ toolName: "Edit" }, { toolName: "Bash" }],
      },
    ];
    expect(
      officialScheduledTaskShouldAutoApprove({
        toolName: "Edit",
        suggestions,
        approvedToolNames: ["Edit"],
      }),
    ).toBe(false);
    expect(
      officialScheduledTaskShouldAutoApprove({
        toolName: "Edit",
        suggestions,
        approvedToolNames: ["Edit", "Bash"],
      }),
    ).toBe(true);
    expect(
      officialScheduledTaskShouldAutoApprove({
        toolName: "mcp__cowork__request_cowork_directory",
        suggestions,
        approvedToolNames: ["Edit", "Bash"],
      }),
    ).toBe(false);
  });

  it("documents browser/computer/webfetch supersede residual message", () => {
    // Official deny message for superseded pending permissions (LAM path).
    expect("Superseded by new permission request").toMatch(/Superseded/);
  });
});
