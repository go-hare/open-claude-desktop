import { afterEach, describe, expect, it } from "vitest";
import {
  applyKeepAwakeEnabled,
  claimKeepAwake,
  getKeepAwakeClaimsForTests,
  isKeepAwakeActive,
  KEEP_AWAKE_PREFERENCE_CLAIM,
  KEEP_AWAKE_WAKE_SCHEDULER_CLAIM,
  releaseKeepAwake,
  resetKeepAwakeForTests,
  syncKeepAwakeFromPreferences,
} from "./keepAwake";

afterEach(() => {
  resetKeepAwakeForTests();
});

describe("keepAwake multi-claim (UZe/z5 residual)", () => {
  it("preference claim starts and stops blocker", () => {
    applyKeepAwakeEnabled(true);
    expect(getKeepAwakeClaimsForTests().has(KEEP_AWAKE_PREFERENCE_CLAIM)).toBe(
      true,
    );
    expect(isKeepAwakeActive()).toBe(true);

    applyKeepAwakeEnabled(false);
    expect(getKeepAwakeClaimsForTests().has(KEEP_AWAKE_PREFERENCE_CLAIM)).toBe(
      false,
    );
    expect(getKeepAwakeClaimsForTests().size).toBe(0);
  });

  it("releasing preference does not drop other claims", () => {
    claimKeepAwake(KEEP_AWAKE_WAKE_SCHEDULER_CLAIM);
    applyKeepAwakeEnabled(true);
    expect(getKeepAwakeClaimsForTests().size).toBe(2);

    applyKeepAwakeEnabled(false);
    expect(getKeepAwakeClaimsForTests().has(KEEP_AWAKE_WAKE_SCHEDULER_CLAIM))
      .toBe(true);
    expect(getKeepAwakeClaimsForTests().has(KEEP_AWAKE_PREFERENCE_CLAIM)).toBe(
      false,
    );
    expect(isKeepAwakeActive()).toBe(true);

    releaseKeepAwake(KEEP_AWAKE_WAKE_SCHEDULER_CLAIM);
    expect(getKeepAwakeClaimsForTests().size).toBe(0);
  });

  it("sync from preferences uses === true only", () => {
    syncKeepAwakeFromPreferences({ keepAwakeEnabled: true });
    expect(isKeepAwakeActive()).toBe(true);
    resetKeepAwakeForTests();
    syncKeepAwakeFromPreferences({ keepAwakeEnabled: "true" as unknown as boolean });
    expect(getKeepAwakeClaimsForTests().size).toBe(0);
    syncKeepAwakeFromPreferences({});
    expect(getKeepAwakeClaimsForTests().size).toBe(0);
  });
});
