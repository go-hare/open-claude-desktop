import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_IN_CHROME_AGENT_SERVER_NAME,
  CLAUDE_IN_CHROME_MCP_SERVER_NAME,
  defaultChromeBridgeSocketPath,
  ensureClaudeInChromeMcp,
  isClaudeInChromeMcpServerName,
  listChromeBridgeSocketPaths,
  resetClaudeInChromeMcpForTests,
} from "./claudeInChromeMcp";

afterEach(() => {
  resetClaudeInChromeMcpForTests();
});

describe("claudeInChromeMcp residual", () => {
  it("official LM / Lai server names", () => {
    expect(CLAUDE_IN_CHROME_MCP_SERVER_NAME).toBe("Claude in Chrome");
    expect(CLAUDE_IN_CHROME_AGENT_SERVER_NAME).toBe("Claude_in_Chrome");
    expect(isClaudeInChromeMcpServerName("Claude in Chrome")).toBe(true);
    expect(isClaudeInChromeMcpServerName("Claude_in_Chrome")).toBe(true);
    expect(isClaudeInChromeMcpServerName("computer-use")).toBe(false);
  });

  it("bir default socket path under /tmp/claude-mcp-browser-bridge-<user>", () => {
    expect(defaultChromeBridgeSocketPath("alice", "darwin")).toBe(
      "/tmp/claude-mcp-browser-bridge-alice/0.sock",
    );
    expect(defaultChromeBridgeSocketPath("bob", "win32")).toBe(
      "\\\\.\\pipe\\claude-mcp-browser-bridge-bob",
    );
  });

  it("Uir win32 returns single named pipe", () => {
    expect(listChromeBridgeSocketPaths("carol", "win32")).toEqual([
      "\\\\.\\pipe\\claude-mcp-browser-bridge-carol",
    ]);
  });

  it("ensureClaudeInChromeMcp refreshes preference callbacks on re-entry", () => {
    let enabled = true;
    let deviceId: string | undefined = "first";
    const first = ensureClaudeInChromeMcp({
      isEnabled: () => enabled,
      getPersistedDeviceId: () => deviceId,
    });
    expect(first.context.isDisabled?.()).toBe(false);
    expect(first.context.getPersistedDeviceId?.()).toBe("first");

    // Simulate handler race then Kir (or later tool call) re-ensuring with new getters.
    let laterEnabled = false;
    let laterId: string | undefined = "later";
    const second = ensureClaudeInChromeMcp({
      isEnabled: () => laterEnabled,
      getPersistedDeviceId: () => laterId,
    });
    expect(second).toBe(first);
    expect(second.context.isDisabled?.()).toBe(true);
    expect(second.context.getPersistedDeviceId?.()).toBe("later");
    laterEnabled = true;
    laterId = "mutated";
    expect(second.context.isDisabled?.()).toBe(false);
    expect(second.context.getPersistedDeviceId?.()).toBe("mutated");
  });
});
