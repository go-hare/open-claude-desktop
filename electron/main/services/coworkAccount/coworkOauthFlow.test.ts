import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COWORK_OAUTH_CLIENT_ID_PRODUCTION,
  COWORK_OAUTH_DEFAULT_API_HOST,
  COWORK_SESSIONS_BRIDGE_OAUTH_SCOPE,
  resolveCoworkSessionsBridgeOauthConfig,
} from "./coworkOauthConfigs";
import {
  exchangeCoworkOauthFromCookies,
  getCoworkApiToken,
  getSessionsBridgeOAuthToken,
  performCoworkOauthFlow,
  setCoworkOauthFlowDepsForTests,
} from "./coworkOauthFlow";
import {
  buildCoworkOauthCacheKey,
  resetCoworkOauthTokenCacheForTests,
  setCoworkOauthCachedToken,
  setCoworkOauthTokenCachePersistDepsForTests,
  getCoworkOauthCachedToken,
  peekCoworkOauthCachedToken,
} from "./coworkOauthTokenCache";

const ORG = "11111111-1111-1111-1111-111111111111";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
    json: async () => body,
  };
}

function baseConfig() {
  return resolveCoworkSessionsBridgeOauthConfig({
    apiHost: COWORK_OAUTH_DEFAULT_API_HOST,
  });
}

afterEach(() => {
  resetCoworkOauthTokenCacheForTests();
  setCoworkOauthFlowDepsForTests(null);
  setCoworkOauthTokenCachePersistDepsForTests(null);
});

describe("coworkOauthConfigs residual (h7 / II / G5t)", () => {
  it("sessions bridge config uses COWORK clientId + sessions scope", () => {
    const c = resolveCoworkSessionsBridgeOauthConfig();
    expect(c.clientId).toBe(COWORK_OAUTH_CLIENT_ID_PRODUCTION);
    expect(c.scope).toBe(COWORK_SESSIONS_BRIDGE_OAUTH_SCOPE);
    expect(c.apiHost).toBe(COWORK_OAUTH_DEFAULT_API_HOST);
  });

  it("G5t key shape matches official", () => {
    expect(
      buildCoworkOauthCacheKey("cid", ORG, "https://api.anthropic.com", "s"),
    ).toBe(`cid:${ORG}:https://api.anthropic.com:s`);
  });
});

describe("coworkOauthFlow residual (UHe / O5t / F5t)", () => {
  it("O5t fails honestly without lastActiveOrg cookie", async () => {
    setCoworkOauthFlowDepsForTests({
      cookieUrl: "https://claude.ai",
      getCookies: async () => [],
      fetch: async () => {
        throw new Error("should not fetch");
      },
    });
    const r = await exchangeCoworkOauthFromCookies(baseConfig());
    expect(r).toMatchObject({
      type: "not_logged_in",
      detail: "no lastActiveOrg cookie found",
    });
  });

  it("O5t fails honestly without sessionKey cookie", async () => {
    setCoworkOauthFlowDepsForTests({
      cookieUrl: "https://claude.ai",
      getCookies: async ({ name }) => {
        if (name === "lastActiveOrg") return [{ name, value: ORG }];
        return [];
      },
      fetch: async () => {
        throw new Error("should not fetch");
      },
    });
    const r = await exchangeCoworkOauthFromCookies(baseConfig());
    expect(r).toMatchObject({
      type: "not_logged_in",
      detail: "no sessionKey cookie found",
    });
  });

  it("O5t authorize+token success path caches via UHe", async () => {
    const calls: string[] = [];
    setCoworkOauthTokenCachePersistDepsForTests({
      isEncryptionAvailable: () => false,
      encryptString: (s) => s,
      decryptString: (s) => s,
      getStored: () => undefined,
      setStored: () => undefined,
    });
    setCoworkOauthFlowDepsForTests({
      cookieUrl: "https://claude.ai",
      getCookies: async ({ name }) => {
        if (name === "lastActiveOrg") return [{ name, value: ORG }];
        if (name === "sessionKey") return [{ name, value: "sk-test" }];
        return [];
      },
      randomPkce: async () => ["verifier", "challenge", "statexyz"],
      fetchProfile: async () => ({
        subscriptionType: "pro",
        rateLimitTier: "default",
      }),
      fetch: async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (String(url).includes("/authorize")) {
          return jsonResponse(200, {
            redirect_uri:
              "https://console.anthropic.com/oauth/code/callback?code=authcode",
          });
        }
        if (String(url).includes("/v1/oauth/token")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            grant_type?: string;
            code_verifier?: string;
          };
          expect(body.grant_type).toBe("authorization_code");
          expect(body.code_verifier).toBe("verifier");
          // sessions scope: no expires_in invent field required
          expect(
            Object.prototype.hasOwnProperty.call(body, "expires_in"),
          ).toBe(false);
          return jsonResponse(200, {
            access_token: "access-from-exchange",
            refresh_token: "refresh-from-exchange",
            expires_in: 3600,
          });
        }
        throw new Error(`unexpected url ${url}`);
      },
    });

    const result = await performCoworkOauthFlow(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toBe("access-from-exchange");
      expect(result.subscriptionType).toBe("pro");
    }
    const key = buildCoworkOauthCacheKey(
      COWORK_OAUTH_CLIENT_ID_PRODUCTION,
      ORG,
      COWORK_OAUTH_DEFAULT_API_HOST,
      COWORK_SESSIONS_BRIDGE_OAUTH_SCOPE,
    );
    expect(getCoworkOauthCachedToken(key)?.token).toBe("access-from-exchange");
    expect(calls.some((c) => c.includes("/authorize"))).toBe(true);
    expect(calls.some((c) => c.includes("/v1/oauth/token"))).toBe(true);
  });

  it("UHe cache hit skips network", async () => {
    setCoworkOauthTokenCachePersistDepsForTests({
      isEncryptionAvailable: () => false,
      encryptString: (s) => s,
      decryptString: (s) => s,
      getStored: () => undefined,
      setStored: () => undefined,
    });
    const key = buildCoworkOauthCacheKey(
      COWORK_OAUTH_CLIENT_ID_PRODUCTION,
      ORG,
      COWORK_OAUTH_DEFAULT_API_HOST,
      COWORK_SESSIONS_BRIDGE_OAUTH_SCOPE,
    );
    setCoworkOauthCachedToken({
      token: "cached-live",
      key,
      expiresAt: Date.now() + 60_000,
      subscriptionType: "max",
      rateLimitTier: null,
    });
    const fetch = vi.fn(async () => {
      throw new Error("no network on cache hit");
    });
    setCoworkOauthFlowDepsForTests({
      cookieUrl: "https://claude.ai",
      getCookies: async ({ name }) =>
        name === "lastActiveOrg" ? [{ name, value: ORG }] : [],
      fetch,
    });
    const r = await performCoworkOauthFlow(baseConfig());
    expect(r).toEqual({
      ok: true,
      token: "cached-live",
      subscriptionType: "max",
      rateLimitTier: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("UHe refresh path uses F5t when access expired", async () => {
    setCoworkOauthTokenCachePersistDepsForTests({
      isEncryptionAvailable: () => false,
      encryptString: (s) => s,
      decryptString: (s) => s,
      getStored: () => undefined,
      setStored: () => undefined,
    });
    const key = buildCoworkOauthCacheKey(
      COWORK_OAUTH_CLIENT_ID_PRODUCTION,
      ORG,
      COWORK_OAUTH_DEFAULT_API_HOST,
      COWORK_SESSIONS_BRIDGE_OAUTH_SCOPE,
    );
    setCoworkOauthCachedToken({
      token: "old-access",
      refreshToken: "rt-1",
      key,
      expiresAt: 1,
      subscriptionType: "pro",
      rateLimitTier: "default",
    });
    // peek keeps expired residual for refresh
    expect(peekCoworkOauthCachedToken(key)?.refreshToken).toBe("rt-1");
    expect(getCoworkOauthCachedToken(key)).toBeNull();

    setCoworkOauthFlowDepsForTests({
      cookieUrl: "https://claude.ai",
      getCookies: async ({ name }) =>
        name === "lastActiveOrg" ? [{ name, value: ORG }] : [],
      fetchProfile: async () => null,
      fetch: async (url, init) => {
        expect(String(url)).toContain("/v1/oauth/token");
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          grant_type?: string;
          refresh_token?: string;
        };
        expect(body.grant_type).toBe("refresh_token");
        expect(body.refresh_token).toBe("rt-1");
        return jsonResponse(200, {
          access_token: "refreshed-access",
          refresh_token: "rt-2",
          expires_in: 7200,
        });
      },
    });

    const r = await performCoworkOauthFlow(baseConfig());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.token).toBe("refreshed-access");
    expect(getCoworkOauthCachedToken(key)?.token).toBe("refreshed-access");
  });

  it("UHe not_logged_in without org cookie (no invent)", async () => {
    setCoworkOauthTokenCachePersistDepsForTests({
      isEncryptionAvailable: () => false,
      encryptString: (s) => s,
      decryptString: (s) => s,
      getStored: () => undefined,
      setStored: () => undefined,
    });
    setCoworkOauthFlowDepsForTests({
      cookieUrl: "https://claude.ai",
      getCookies: async () => [],
      fetch: async () => {
        throw new Error("no");
      },
    });
    const r = await performCoworkOauthFlow(baseConfig());
    expect(r).toEqual({
      ok: false,
      reason: {
        type: "not_logged_in",
        detail: "no active organization",
      },
    });
    expect(await getCoworkApiToken(baseConfig())).toBeNull();
  });

  it("getSessionsBridgeOAuthToken throws when flow fails", async () => {
    setCoworkOauthTokenCachePersistDepsForTests({
      isEncryptionAvailable: () => false,
      encryptString: (s) => s,
      decryptString: (s) => s,
      getStored: () => undefined,
      setStored: () => undefined,
    });
    setCoworkOauthFlowDepsForTests({
      cookieUrl: "https://claude.ai",
      getCookies: async () => [],
      fetch: async () => {
        throw new Error("no");
      },
    });
    await expect(getSessionsBridgeOAuthToken()).rejects.toThrow(
      /No OAuth access token available/,
    );
  });
});
