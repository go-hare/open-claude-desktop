import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCoworkOauthCacheKey,
  clearCoworkOauthTokenCache,
  ensureCoworkOauthTokenCacheLoaded,
  getCoworkOauthCachedToken,
  getCoworkOauthCachedTokenAsync,
  getCoworkOauthTokenCacheGeneration,
  getCoworkOauthTokenCacheSize,
  loadCoworkOauthTokenCacheFromDisk,
  persistCoworkOauthTokenCache,
  resetCoworkOauthTokenCacheForTests,
  setCoworkOauthCachedToken,
  setCoworkOauthTokenCachePersistDepsForTests,
  COWORK_OAUTH_TOKEN_CACHE_STORE_KEY,
} from "./coworkOauthTokenCache";

afterEach(() => {
  resetCoworkOauthTokenCacheForTests();
});

describe("coworkOauthTokenCache residual (qu / Lm / l5 / L5t / G5t)", () => {
  it("G5t builds official cache key", () => {
    expect(
      buildCoworkOauthCacheKey("cid", "org", "https://api.example", "scope"),
    ).toBe("cid:org:https://api.example:scope");
    expect(COWORK_OAUTH_TOKEN_CACHE_STORE_KEY).toBe("oauth:tokenCache");
  });

  it("stores and returns tokens without inventing", () => {
    expect(getCoworkOauthCachedToken()).toBeNull();
    setCoworkOauthCachedToken({ token: "tok-1", key: "env-a" });
    expect(getCoworkOauthCachedToken("env-a")?.token).toBe("tok-1");
    expect(getCoworkOauthCachedToken("other")).toBeNull();
  });

  it("Lm clears all tokens and bumps generation", () => {
    setCoworkOauthCachedToken({ token: "a" });
    setCoworkOauthCachedToken({ token: "b", key: "x" });
    expect(getCoworkOauthTokenCacheSize()).toBe(2);
    const gen = getCoworkOauthTokenCacheGeneration();
    expect(clearCoworkOauthTokenCache()).toBe(2);
    expect(getCoworkOauthTokenCacheSize()).toBe(0);
    expect(getCoworkOauthTokenCacheGeneration()).toBe(gen + 1);
    expect(getCoworkOauthCachedToken()).toBeNull();
  });

  it("drops expired tokens on get", () => {
    setCoworkOauthCachedToken({
      token: "old",
      expiresAtMs: Date.now() - 1_000,
    });
    expect(getCoworkOauthCachedToken()).toBeNull();
  });

  it("l5/L5t persist + load via safeStorage residual (no invent)", async () => {
    let stored: string | undefined;
    const plainBag: Record<string, unknown> = {};
    setCoworkOauthTokenCachePersistDepsForTests({
      isEncryptionAvailable: () => true,
      encryptString: (plain) => {
        // Test "encrypt" = base64 of plain
        return Buffer.from(plain, "utf8").toString("base64");
      },
      decryptString: (b64) => Buffer.from(b64, "base64").toString("utf8"),
      getStored: () => stored,
      setStored: (b64) => {
        stored = b64;
      },
      path: "/tmp/test-oauth-store",
    });

    setCoworkOauthCachedToken({
      token: "persist-me",
      key: "k1",
      refreshToken: "rt",
      expiresAt: Date.now() + 60_000,
      subscriptionType: "pro",
    });
    await persistCoworkOauthTokenCache();
    expect(stored).toBeTruthy();

    // Simulate process restart: wipe memory, keep disk
    resetCoworkOauthTokenCacheForTests();
    setCoworkOauthTokenCachePersistDepsForTests({
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(plain, "utf8").toString("base64"),
      decryptString: (b64) => Buffer.from(b64, "base64").toString("utf8"),
      getStored: () => stored,
      setStored: (b64) => {
        stored = b64;
      },
      path: "/tmp/test-oauth-store",
    });

    expect(getCoworkOauthCachedToken("k1")).toBeNull(); // not loaded yet
    await loadCoworkOauthTokenCacheFromDisk();
    expect(getCoworkOauthCachedToken("k1")?.token).toBe("persist-me");
    expect(getCoworkOauthCachedToken("k1")?.refreshToken).toBe("rt");
    expect(getCoworkOauthCachedToken("k1")?.subscriptionType).toBe("pro");
    void plainBag;
  });

  it("L5t warns and skips when encryption unavailable (no invent decrypt)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setCoworkOauthTokenCachePersistDepsForTests({
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error("no");
      },
      decryptString: () => {
        throw new Error("no");
      },
      getStored: () => "deadbeef",
      setStored: () => undefined,
    });
    await loadCoworkOauthTokenCacheFromDisk();
    expect(getCoworkOauthTokenCacheSize()).toBe(0);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("cannot decrypt tokens"),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it("ensureCoworkOauthTokenCacheLoaded is idempotent (poe)", async () => {
    let loads = 0;
    setCoworkOauthTokenCachePersistDepsForTests({
      isEncryptionAvailable: () => true,
      encryptString: (p) => Buffer.from(p, "utf8").toString("base64"),
      decryptString: (b) => Buffer.from(b, "base64").toString("utf8"),
      getStored: () => {
        loads += 1;
        return undefined;
      },
      setStored: () => undefined,
    });
    await ensureCoworkOauthTokenCacheLoaded();
    await ensureCoworkOauthTokenCacheLoaded();
    expect(loads).toBe(1);
  });

  it("getCoworkOauthCachedTokenAsync loads disk then returns", async () => {
    const payload = Buffer.from(
      JSON.stringify({ def: { token: "from-disk" } }),
      "utf8",
    ).toString("base64");
    setCoworkOauthTokenCachePersistDepsForTests({
      isEncryptionAvailable: () => true,
      encryptString: (p) => Buffer.from(p, "utf8").toString("base64"),
      decryptString: (b) => Buffer.from(b, "base64").toString("utf8"),
      getStored: () => payload,
      setStored: () => undefined,
    });
    const t = await getCoworkOauthCachedTokenAsync("def");
    expect(t?.token).toBe("from-disk");
  });
});
