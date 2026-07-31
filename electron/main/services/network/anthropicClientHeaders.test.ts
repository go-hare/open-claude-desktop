import { afterEach, expect, it } from "vitest";
import {
  installAnthropicDesktopUserAgent,
  isAnthropicClientHeaderHost,
  parseClaudeExtraHeadersToken,
  resetAnthropicClientRequestHeadersForTests,
} from "./anthropicClientHeaders";

afterEach(() => {
  resetAnthropicClientRequestHeadersForTests();
  delete process.env.CLAUDE_CDP_AUTH;
  delete process.env.CLAUDE_USER_DATA_DIR;
});

it("GQ residual matches claude.ai and .com twin", () => {
  expect(isAnthropicClientHeaderHost("claude.ai", "claude.ai")).toBe(true);
  expect(isAnthropicClientHeaderHost("claude.com", "claude.ai")).toBe(true);
  expect(isAnthropicClientHeaderHost("claude.ai", "claude.com")).toBe(true);
  expect(isAnthropicClientHeaderHost("evil.com", "claude.ai")).toBe(false);
  expect(isAnthropicClientHeaderHost("preview.claude.ai", "claude.ai")).toBe(false);
});

it("GQ residual honors CLAUDE_AI_URL origin host", () => {
  expect(isAnthropicClientHeaderHost("preview.claude.ai", "preview.claude.ai")).toBe(true);
  expect(isAnthropicClientHeaderHost("preview.claude.com", "preview.claude.ai")).toBe(true);
});

it("staging host only with CDP residual env", () => {
  expect(isAnthropicClientHeaderHost("claude-ai.staging.ant.dev", "claude.ai")).toBe(false);
  process.env.CLAUDE_CDP_AUTH = "x";
  process.env.CLAUDE_USER_DATA_DIR = "/tmp/x";
  expect(isAnthropicClientHeaderHost("claude-ai.staging.ant.dev", "claude.ai")).toBe(true);
});

it("extra headers token accepts bare JSON map for tests", () => {
  expect(parseClaudeExtraHeadersToken('{"X-Test":"1"}')).toEqual({ "X-Test": "1" });
  expect(parseClaudeExtraHeadersToken("not-json")).toEqual({});
  expect(parseClaudeExtraHeadersToken(undefined)).toEqual({});
});

it("desktop UA residual injects Claude/ when product name is Claudex", () => {
  let ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claudex/1.6608.2-claudex.0 Chrome/140.0.0.0 Electron/41.5.0 Safari/537.36";
  installAnthropicDesktopUserAgent({
    getUserAgent: () => ua,
    setUserAgent: (value) => {
      ua = value;
    },
    getVersion: () => "1.6608.2-claudex.0",
  });
  expect(ua.toLowerCase()).toContain("claude/");
  expect(ua).toContain("Claude/1.6608.2-claudex.0");
  expect(ua).toContain("Claudex/1.6608.2-claudex.0");
});

it("desktop UA residual is a no-op when Claude/ already present", () => {
  let ua =
    "Mozilla/5.0 ... Claude/1.6608.2 Chrome/140.0.0.0 Electron/41.5.0 Safari/537.36";
  const before = ua;
  installAnthropicDesktopUserAgent({
    getUserAgent: () => ua,
    setUserAgent: (value) => {
      ua = value;
    },
    getVersion: () => "9.9.9",
  });
  expect(ua).toBe(before);
});
