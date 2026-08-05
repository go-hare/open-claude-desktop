import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearBootstrapOidcToken,
  fetchEnterpriseBootstrapConfig,
  NeedsBootstrapAuthError,
  resetBootstrapCacheForTests,
  resolveBootstrapOidcAccessToken,
} from "./enterpriseBootstrapOidc";
import {
  readEnterpriseSecretJson,
  resetEnterpriseSecretsForTests,
  writeEnterpriseSecretJson,
  ENTERPRISE_SECRET_KEYS,
} from "./enterpriseSecureStore";

const localOnly = (bag: Record<string, unknown>) => ({
  getManagedConfig: () => ({}),
  getLocalConfig: () => bag,
});

describe("enterpriseBootstrapOidc (r5t residual)", () => {
  afterEach(() => {
    resetBootstrapCacheForTests();
    resetEnterpriseSecretsForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns unconfigured when bootstrapUrl absent", async () => {
    const result = await fetchEnterpriseBootstrapConfig(localOnly({}));
    expect(result).toEqual({ ok: false, kind: "unconfigured" });
  });

  it("returns auth when bootstrapOidc needs interactive and non-interactive", async () => {
    process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT = "1";
    const deps = localOnly({
      bootstrapUrl: "https://corp.example/bootstrap",
      bootstrapOidc: {
        clientId: "cli",
        authorizationUrl: "https://idp.example/auth",
        tokenUrl: "https://idp.example/token",
      },
    });
    const result = await fetchEnterpriseBootstrapConfig(deps, {
      interactive: false,
    });
    expect(result).toEqual({ ok: false, kind: "auth" });
    delete process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT;
  });

  it("fetches bootstrap JSON and applies remote tier when no OIDC", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          config: { inferenceProvider: "gateway", inferenceGatewayBaseUrl: "https://gw" },
          expiresAt: Date.now() + 60_000,
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEnterpriseBootstrapConfig(
      localOnly({
        bootstrapUrl: "https://corp.example/user/bootstrap",
        bootstrapEnabled: true,
      }),
      { interactive: false, applyRemoteTier: false },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.config.inferenceProvider).toBe("gateway");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses cached OIDC access token when not expired", async () => {
    process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT = "1";
    writeEnterpriseSecretJson(ENTERPRISE_SECRET_KEYS.bootstrapOidc, {
      accessToken: "cached-tok",
      expiresAt: Date.now() + 120_000,
      clientId: "cli",
    });
    const token = await resolveBootstrapOidcAccessToken(
      localOnly({
        bootstrapOidc: {
          clientId: "cli",
          authorizationUrl: "https://idp.example/auth",
          tokenUrl: "https://idp.example/token",
        },
      }),
      false,
    );
    expect(token).toBe("cached-tok");
    expect(
      readEnterpriseSecretJson(ENTERPRISE_SECRET_KEYS.bootstrapOidc),
    ).toMatchObject({ accessToken: "cached-tok" });
    clearBootstrapOidcToken();
    delete process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT;
  });

  it("NeedsBootstrapAuthError name is stable", () => {
    const err = new NeedsBootstrapAuthError();
    expect(err.name).toBe("NeedsBootstrapAuthError");
  });
});
