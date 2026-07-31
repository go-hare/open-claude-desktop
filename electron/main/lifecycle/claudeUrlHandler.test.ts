import { afterEach, expect, it, vi } from "vitest";
import {
  handleClaudeDeepLink,
  parseMagicLinkHash,
  queuePendingClaudeOpenUrl,
  resetClaudeUrlHandlerForTests,
  takePendingClaudeOpenUrl,
} from "./claudeUrlHandler";

afterEach(() => {
  resetClaudeUrlHandlerForTests();
});

function mockWebContents() {
  const loadURL = vi.fn().mockResolvedValue(undefined);
  const cookiesSet = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn();
  return {
    isDestroyed: () => false,
    loadURL,
    send,
    session: {
      cookies: {
        set: cookiesSet,
      },
    },
  };
}

it("parseMagicLinkHash strips leading # residual", () => {
  expect(parseMagicLinkHash("#nonce123:ZW1haWw=")).toEqual({
    nonce: "nonce123",
    encodedEmail: "ZW1haWw=",
  });
  expect(parseMagicLinkHash("nonce123:ZW1haWw=")).toEqual({
    nonce: "nonce123",
    encodedEmail: "ZW1haWw=",
  });
  expect(parseMagicLinkHash("#onlyone")).toBeNull();
});

it("magic-link residual loads https://claude.ai/magic-link#nonce:email", async () => {
  const wc = mockWebContents();
  const result = handleClaudeDeepLink(
    "claude://claude.ai/magic-link?anon_id=abc#token123:sig456",
    wc as never,
  );
  expect(result).toEqual({ handled: true, kind: "magic-link" });
  expect(wc.session.cookies.set).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "_cross_domain_anonymous_id",
      value: "abc",
    }),
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(wc.loadURL).toHaveBeenCalledWith("https://claude.ai/magic-link#token123:sig456");
});

it("magic-link without anon_id loads immediately", () => {
  const wc = mockWebContents();
  const result = handleClaudeDeepLink(
    "claude://claude.ai/magic-link#tok:sig",
    wc as never,
  );
  expect(result.handled).toBe(true);
  expect(wc.session.cookies.set).not.toHaveBeenCalled();
  expect(wc.loadURL).toHaveBeenCalledWith("https://claude.ai/magic-link#tok:sig");
});

it("duplicate magic-link delivery is suppressed", () => {
  const wc = mockWebContents();
  const url = "claude://claude.ai/magic-link#a:b";
  expect(handleClaudeDeepLink(url, wc as never).handled).toBe(true);
  expect(wc.loadURL).toHaveBeenCalledTimes(1);
  expect(handleClaudeDeepLink(url, wc as never).handled).toBe(true);
  expect(wc.loadURL).toHaveBeenCalledTimes(1);
});

it("google-auth residual sends googleAuthCode binding event", async () => {
  const wc = mockWebContents();
  const result = handleClaudeDeepLink(
    "claude://login/google-auth?code=oauth-code-1&anon_id=anon9",
    wc as never,
  );
  expect(result).toEqual({ handled: true, kind: "google-auth" });
  expect(wc.session.cookies.set).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "_cross_domain_anonymous_id",
      value: "anon9",
    }),
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(wc.send).toHaveBeenCalledWith("googleAuthCode", { code: "oauth-code-1" });
  expect(wc.loadURL).not.toHaveBeenCalled();
});

it("sso-callback residual loads https sso-callback without anon_id", async () => {
  const wc = mockWebContents();
  const result = handleClaudeDeepLink(
    "claude://claude.ai/sso-callback?state=xyz&anon_id=a1",
    wc as never,
  );
  expect(result).toEqual({ handled: true, kind: "sso-callback" });
  await Promise.resolve();
  await Promise.resolve();
  expect(wc.loadURL).toHaveBeenCalledWith("https://claude.ai/sso-callback?state=xyz");
});

it("non-magic deep links are not handled here", () => {
  const wc = mockWebContents();
  const result = handleClaudeDeepLink("claude://claude.ai/task/new", wc as never);
  expect(result.handled).toBe(false);
  expect(wc.loadURL).not.toHaveBeenCalled();
});

it("pending open-url queue is single-slot residual", () => {
  queuePendingClaudeOpenUrl("claude://claude.ai/magic-link#a:b");
  queuePendingClaudeOpenUrl("claude://claude.ai/magic-link#c:d");
  expect(takePendingClaudeOpenUrl()).toBe("claude://claude.ai/magic-link#c:d");
  expect(takePendingClaudeOpenUrl()).toBeNull();
});
