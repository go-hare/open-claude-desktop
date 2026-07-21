import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCoworkAccountOauthIdentityWatcher,
  createCoworkGrowthBookAccountRefreshWatcher,
} from "./coworkAccountIdentityEffects";
import { resetCoworkOauthTokenCacheForTests } from "./coworkOauthTokenCache";

afterEach(() => {
  resetCoworkOauthTokenCacheForTests();
});

describe("createCoworkAccountOauthIdentityWatcher", () => {
  it("seeds baseline without clearing oauth", () => {
    const clearOauthCache = vi.fn(() => 0);
    const watch = createCoworkAccountOauthIdentityWatcher({ clearOauthCache });
    const change = watch({
      accountUuid: "a1",
      isLoggedOut: false,
    });
    expect(change?.uuidChanged).toBe(false);
    expect(clearOauthCache).not.toHaveBeenCalled();
  });

  it("clears oauth on accountUuid change (both defined)", () => {
    const clearOauthCache = vi.fn(() => 1);
    const watch = createCoworkAccountOauthIdentityWatcher({ clearOauthCache });
    watch({ accountUuid: "a1", isLoggedOut: false });
    watch({ accountUuid: "a2", isLoggedOut: false });
    expect(clearOauthCache).toHaveBeenCalledTimes(1);
  });

  it("clears oauth on loggedOut flip", () => {
    const clearOauthCache = vi.fn(() => 0);
    const watch = createCoworkAccountOauthIdentityWatcher({ clearOauthCache });
    watch({ accountUuid: "a1", isLoggedOut: false });
    watch({ accountUuid: "a1", isLoggedOut: true });
    expect(clearOauthCache).toHaveBeenCalledTimes(1);
  });

  it("does not clear on incomplete logged-in payload without uuid", () => {
    const clearOauthCache = vi.fn(() => 0);
    const watch = createCoworkAccountOauthIdentityWatcher({ clearOauthCache });
    watch({ accountUuid: "a1", isLoggedOut: false });
    expect(watch({ isLoggedOut: false })).toBeNull();
    expect(clearOauthCache).not.toHaveBeenCalled();
  });

  it("does not clear when uuid stays same", () => {
    const clearOauthCache = vi.fn(() => 0);
    const watch = createCoworkAccountOauthIdentityWatcher({ clearOauthCache });
    watch({ accountUuid: "a1", isLoggedOut: false });
    watch({
      accountUuid: "a1",
      isLoggedOut: false,
      displayName: "Alice",
    });
    expect(clearOauthCache).not.toHaveBeenCalled();
  });
});

describe("createCoworkGrowthBookAccountRefreshWatcher", () => {
  it("calls I9t residual when lifecycle present", async () => {
    const refreshForAccountChange = vi.fn(async () => ({ kind: "hardcoded" }));
    const watch = createCoworkGrowthBookAccountRefreshWatcher(() => ({
      refreshForAccountChange,
    }));
    watch({ accountUuid: "a1", isLoggedOut: false });
    await Promise.resolve();
    expect(refreshForAccountChange).toHaveBeenCalledTimes(1);
  });

  it("no-ops when lifecycle absent", async () => {
    const watch = createCoworkGrowthBookAccountRefreshWatcher(() => null);
    expect(() =>
      watch({ accountUuid: "a1", isLoggedOut: false }),
    ).not.toThrow();
  });
});
