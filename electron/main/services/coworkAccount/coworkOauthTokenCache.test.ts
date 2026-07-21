import { afterEach, describe, expect, it } from "vitest";
import {
  clearCoworkOauthTokenCache,
  getCoworkOauthCachedToken,
  getCoworkOauthTokenCacheGeneration,
  getCoworkOauthTokenCacheSize,
  resetCoworkOauthTokenCacheForTests,
  setCoworkOauthCachedToken,
} from "./coworkOauthTokenCache";

afterEach(() => {
  resetCoworkOauthTokenCacheForTests();
});

describe("coworkOauthTokenCache residual (Lm)", () => {
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
});
