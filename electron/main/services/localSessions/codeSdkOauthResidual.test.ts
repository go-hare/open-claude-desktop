/**
 * Official getOAuthToken residual — never forges tokens.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  resetCoworkOauthTokenCacheForTests,
  setCoworkOauthCachedToken,
} from "../coworkAccount/coworkOauthTokenCache";
import { refreshCodeSdkOAuthTokenResidual } from "./codeSdkOauthResidual";

afterEach(() => {
  resetCoworkOauthTokenCacheForTests();
});

describe("refreshCodeSdkOAuthTokenResidual", () => {
  it("returns null when cache empty (no invent)", async () => {
    await expect(refreshCodeSdkOAuthTokenResidual()).resolves.toBeNull();
  });

  it("returns live cached token when present", async () => {
    setCoworkOauthCachedToken({
      token: "test-access-token",
      expiresAt: Date.now() + 60_000,
    });
    await expect(refreshCodeSdkOAuthTokenResidual()).resolves.toBe("test-access-token");
  });

  it("returns null for expired cached token", async () => {
    setCoworkOauthCachedToken({
      token: "expired-token",
      expiresAt: Date.now() - 1_000,
    });
    await expect(refreshCodeSdkOAuthTokenResidual()).resolves.toBeNull();
  });
});
