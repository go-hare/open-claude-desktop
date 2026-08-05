import { describe, expect, it } from "vitest";
import {
  askClaudeError,
  getClaudeCodeInstallStatus,
  grandPrixPairResidual,
  grandPrixStatusResidual,
  prepareClaudeCodeInstall,
  resolveClaudeCodeBinaryPath,
  restartAfterVmpInstallResidual,
  simulatorAttachmentStateResidual,
} from "./shellSoftTrueResidual";

describe("shellSoftTrueResidual honesty", () => {
  it("askClaudeError matches official cz() / k2i shape (no ok invent)", () => {
    expect(askClaudeError("Artifact inference is not enabled.")).toEqual({
      text: "Artifact inference is not enabled.",
      isError: true,
    });
  });

  it("ClaudeCode getStatus/prepare never invent ready without absolute binary", () => {
    const missing = getClaudeCodeInstallStatus(
      ["/tmp/does-not-exist-claude-bin", "claude"],
      () => false,
    );
    expect(missing).toBe("not_installed");
    expect(
      prepareClaudeCodeInstall(["/tmp/does-not-exist-claude-bin"], () => false),
    ).toEqual({
      success: false,
      error: "Claude Code binary not installed",
    });
  });

  it("ClaudeCode ready only when absolute path exists", () => {
    const path = "/opt/claude/bin/claude";
    expect(resolveClaudeCodeBinaryPath([path, "claude"], (p) => p === path)).toBe(path);
    expect(getClaudeCodeInstallStatus([path], (p) => p === path)).toBe("ready");
    expect(prepareClaudeCodeInstall([path], (p) => p === path)).toEqual({ success: true });
  });

  it("ClaudeCode ignores bare PATH names even if exists probe would pass", () => {
    expect(
      resolveClaudeCodeBinaryPath(["claude", "claude.exe"], () => true),
    ).toBeNull();
    expect(getClaudeCodeInstallStatus(["claude"], () => true)).toBe("not_installed");
  });

  it("GrandPrix pair residual never invents paired/connected", () => {
    expect(grandPrixPairResidual("partner-a", "darwin")).toEqual({
      paired: false,
      error: "unknownPartner",
    });
    expect(grandPrixPairResidual("partner-a", "win32")).toEqual({
      paired: false,
      error: "featureDisabled",
    });
    expect(grandPrixPairResidual("", "darwin")).toEqual({
      paired: false,
      error: "unknownPartner",
    });
    expect(grandPrixPairResidual(null, "darwin")).toEqual({
      paired: false,
      error: "unknownPartner",
    });
    // Known partner without native transport → transportUnavailable (not invent paired)
    expect(
      grandPrixPairResidual("partner-a", "darwin", {
        isKnownPartner: () => true,
        hasNativeTransport: false,
      }),
    ).toEqual({ paired: false, error: "transportUnavailable" });
  });

  it("GrandPrix status store is { paired: Record } (ucA/OFt), not boolean+status", () => {
    expect(grandPrixStatusResidual()).toEqual({ paired: {} });
    expect(grandPrixStatusResidual({ "p-1": true, "p-2": false })).toEqual({
      paired: { "p-1": true, "p-2": false },
    });
    // strip non-boolean invent
    expect(grandPrixStatusResidual({ bad: "connected" as never })).toEqual({ paired: {} });
  });

  it("Simulator attachment store residual is array (AmA[]), empty by default", () => {
    expect(simulatorAttachmentStateResidual()).toEqual([]);
    expect(simulatorAttachmentStateResidual(null)).toEqual([]);
    expect(simulatorAttachmentStateResidual([{ udid: "x" }])).toEqual([{ udid: "x" }]);
  });

  it("restartAfterVMPInstall residual is boolean false unless armed", () => {
    expect(restartAfterVmpInstallResidual(false)).toBe(false);
    expect(restartAfterVmpInstallResidual(true)).toBe(true);
  });
});
