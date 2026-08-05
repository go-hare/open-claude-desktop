import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import {
  PLUGIN_OAUTH_CALLBACK_TIMEOUT_MS,
  PLUGIN_OAUTH_DEFAULT_EXPIRES_MS,
  PLUGIN_OAUTH_TOKEN_TIMEOUT_MS,
  validatePublicHttpsUrl,
  runPluginOAuthAuthorizationCodeFlow,
  resetPluginOAuthInflightForTests,
  runPluginOAuthI6t,
} from "./localPluginOAuthFlow";

const openExternal = vi.fn(async () => undefined);
const netFetch = vi.fn();

vi.mock("electron", () => ({
  shell: {
    openExternal: (...args: unknown[]) => openExternal(...args),
  },
  net: {
    fetch: (...args: unknown[]) => netFetch(...args),
  },
}));

describe("localPluginOAuthFlow residual (NbA / R7 / i6t)", () => {
  beforeEach(() => {
    openExternal.mockReset();
    openExternal.mockResolvedValue(undefined);
    netFetch.mockReset();
    resetPluginOAuthInflightForTests();
  });

  afterEach(() => {
    resetPluginOAuthInflightForTests();
  });

  it("R7 rejects non-https and private hosts", () => {
    expect(validatePublicHttpsUrl(undefined, "authorizationUrl")).toMatch(
      /required/,
    );
    expect(validatePublicHttpsUrl("not-a-url", "authorizationUrl")).toMatch(
      /valid URL/,
    );
    expect(
      validatePublicHttpsUrl("http://example.com/a", "authorizationUrl"),
    ).toMatch(/https/);
    expect(
      validatePublicHttpsUrl("https://localhost/a", "authorizationUrl"),
    ).toMatch(/public host/);
    expect(
      validatePublicHttpsUrl("https://127.0.0.1/a", "tokenUrl"),
    ).toMatch(/public host/);
    expect(
      validatePublicHttpsUrl("https://192.168.1.1/a", "tokenUrl"),
    ).toMatch(/public host/);
    expect(
      validatePublicHttpsUrl("https://oauth.example.com/authorize", "authorizationUrl"),
    ).toBeNull();
  });

  it("exports residual timeouts", () => {
    expect(PLUGIN_OAUTH_CALLBACK_TIMEOUT_MS).toBe(120_000);
    expect(PLUGIN_OAUTH_TOKEN_TIMEOUT_MS).toBe(30_000);
    expect(PLUGIN_OAUTH_DEFAULT_EXPIRES_MS).toBe(3_600_000);
  });

  it("NbA: loopback + PKCE + token exchange writes camelCase credentials", async () => {
    netFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        access_token: "at-1",
        refresh_token: "rt-1",
        expires_in: 3600,
        scope: "a b",
      }),
    }));

    // Capture authorize URL when openExternal is called, then hit callback.
    openExternal.mockImplementation(async (url: string) => {
      const u = new URL(url);
      expect(u.searchParams.get("response_type")).toBe("code");
      expect(u.searchParams.get("code_challenge_method")).toBe("S256");
      expect(u.searchParams.get("code_challenge")).toBeTruthy();
      expect(u.searchParams.get("client_id")).toBe("cid");
      expect(u.searchParams.get("access_type")).toBe("offline");
      expect(u.searchParams.get("prompt")).toBe("consent");
      const redirect = u.searchParams.get("redirect_uri")!;
      const state = u.searchParams.get("state")!;
      // openExternal resolves before waitForCallback attaches — delay so n6t is listening.
      setTimeout(() => {
        http
          .get(`${redirect}?code=authcode&state=${state}`, (res) => {
            res.resume();
          })
          .on("error", () => undefined);
      }, 30);
    });

    const creds = await runPluginOAuthAuthorizationCodeFlow({
      authorizationUrl: "https://oauth.example.com/authorize",
      tokenUrl: "https://oauth.example.com/token",
      clientId: "cid",
      clientSecret: "sec",
      scopes: ["a", "b"],
      googleOfflineAccess: true,
    });

    expect(creds.accessToken).toBe("at-1");
    expect(creds.refreshToken).toBe("rt-1");
    expect(creds.clientId).toBe("cid");
    expect(creds.clientSecret).toBe("sec");
    expect(creds.tokenUrl).toBe("https://oauth.example.com/token");
    expect(creds.grantedScopes).toEqual(["a", "b"]);
    expect(typeof creds.expiresAt).toBe("number");

    expect(netFetch).toHaveBeenCalled();
    const [, init] = netFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    const body = String(init.body);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=authcode");
    expect(body).toContain("code_verifier=");
    expect(body).toContain("client_secret=sec");
  });

  it("i6t validates public https endpoints before exchange", async () => {
    await expect(
      runPluginOAuthI6t("plug", "default", {
        clientId: "c",
        authorizationUrl: "https://localhost/a",
        tokenUrl: "https://oauth.example.com/t",
      }),
    ).rejects.toThrow(/public host|authorizationUrl/);

    await expect(
      runPluginOAuthI6t("plug", "default", {
        clientId: "c",
        authorizationUrl: "https://oauth.example.com/a",
        tokenUrl: "http://oauth.example.com/t",
      }),
    ).rejects.toThrow(/https/);
  });

  it("NbA rejects token response missing access_token (no fake success)", async () => {
    netFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ refresh_token: "rt-only", expires_in: 60 }),
    });
    openExternal.mockImplementation(async (url: string) => {
      const u = new URL(url);
      const redirect = u.searchParams.get("redirect_uri")!;
      const state = u.searchParams.get("state")!;
      setTimeout(() => {
        http
          .get(`${redirect}?code=authcode&state=${state}`, (res) => {
            res.resume();
          })
          .on("error", () => undefined);
      }, 30);
    });
    await expect(
      runPluginOAuthAuthorizationCodeFlow({
        authorizationUrl: "https://oauth.example.com/authorize",
        tokenUrl: "https://oauth.example.com/token",
        clientId: "cid",
      }),
    ).rejects.toThrow(/access_token/);
  });

  it("i6t single-flight reuses in-flight promise for same plugin:cli", async () => {
    let resolveToken!: (v: unknown) => void;
    const tokenGate = new Promise((resolve) => {
      resolveToken = resolve;
    });
    let tokenCalls = 0;
    netFetch.mockImplementation(async () => {
      tokenCalls += 1;
      await tokenGate;
      return {
        ok: true,
        json: async () => ({
          access_token: "at-shared",
          refresh_token: "rt-shared",
          expires_in: 3600,
        }),
      };
    });
    openExternal.mockImplementation(async (url: string) => {
      const u = new URL(url);
      const redirect = u.searchParams.get("redirect_uri")!;
      const state = u.searchParams.get("state")!;
      setTimeout(() => {
        http
          .get(`${redirect}?code=authcode&state=${state}`, (res) => {
            res.resume();
          })
          .on("error", () => undefined);
      }, 20);
    });

    const a = runPluginOAuthI6t("plug-sf", "default", {
      clientId: "cid",
      authorizationUrl: "https://oauth.example.com/authorize",
      tokenUrl: "https://oauth.example.com/token",
    });
    // second call while first in-flight must share
    const b = runPluginOAuthI6t("plug-sf", "default", {
      clientId: "cid",
      authorizationUrl: "https://oauth.example.com/authorize",
      tokenUrl: "https://oauth.example.com/token",
    });
    resolveToken(undefined);
    const [ca, cb] = await Promise.all([a, b]);
    expect(ca.accessToken).toBe("at-shared");
    expect(cb.accessToken).toBe("at-shared");
    expect(ca).toBe(cb);
    expect(tokenCalls).toBe(1);
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});
