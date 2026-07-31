import { afterEach, expect, it, vi } from "vitest";
import {
  isAnthropicProductHost,
  isAsWebAuthEligibleUrl,
  resetDoAuthInBrowserResidualForTests,
  rewriteClaudeAiAuthUrl,
} from "./doAuthInBrowserResidual";

afterEach(() => {
  resetDoAuthInBrowserResidualForTests();
  vi.restoreAllMocks();
});

it("AZt residual rewrites claude.ai login paths to claude.com/cai", () => {
  expect(rewriteClaudeAiAuthUrl("https://claude.ai/login/app-google-auth?open_in_browser=1")).toBe(
    "https://claude.com/cai/login/app-google-auth?open_in_browser=1",
  );
  expect(rewriteClaudeAiAuthUrl("https://claude.ai")).toBe("https://claude.com/cai/");
  expect(rewriteClaudeAiAuthUrl("https://example.com/login")).toBe("https://example.com/login");
});

it("Dai residual allows product login hosts and workos sso", () => {
  expect(isAsWebAuthEligibleUrl(new URL("https://claude.ai/login/app-google-auth"))).toBe(true);
  expect(isAsWebAuthEligibleUrl(new URL("https://claude.com/login/popup-google-auth"))).toBe(true);
  expect(isAsWebAuthEligibleUrl(new URL("https://api.workos.com/sso/authorize"))).toBe(true);
  expect(isAsWebAuthEligibleUrl(new URL("https://claude.ai/new"))).toBe(false);
  expect(isAsWebAuthEligibleUrl(new URL("https://evil.example/login/x"))).toBe(false);
});

it("GQ residual treats .ai and .com product hosts as peers", () => {
  expect(isAnthropicProductHost("claude.ai")).toBe(true);
  expect(isAnthropicProductHost("claude.com")).toBe(true);
  expect(isAnthropicProductHost("evil.com")).toBe(false);
});

it("Dai residual requires /login/ prefix (not bare /login) and rejects non-login paths", () => {
  // Official Dai: pathname.startsWith("/login/") — bare /login is false.
  expect(isAsWebAuthEligibleUrl(new URL("https://claude.ai/login"))).toBe(false);
  expect(isAsWebAuthEligibleUrl(new URL("https://claude.ai/login/app-google-auth"))).toBe(true);
  // rewritten claude.com/cai host is not anthropic product host residual (GQ is .ai↔.com bare host)
  expect(isAsWebAuthEligibleUrl(new URL("https://claude.com/login/app-google-auth"))).toBe(true);
  expect(isAsWebAuthEligibleUrl(new URL("https://claude.ai/api/auth"))).toBe(false);
});
