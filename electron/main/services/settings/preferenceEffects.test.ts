import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkMicrophoneAccessForDictation,
  preWriteQuickEntryDictationShortcut,
  runPreferencePostWriteEffects,
  runPreferencePreWriteHook,
  setPreferencePreWriteHookForTests,
} from "./preferenceEffects";
import {
  getKeepAwakeClaimsForTests,
  KEEP_AWAKE_PREFERENCE_CLAIM,
  resetKeepAwakeForTests,
} from "./keepAwake";
import {
  getActiveCoworkGrowthBookLifecycle,
  setActiveCoworkGrowthBookLifecycle,
} from "../coworkHostLoop/coworkGrowthBookLifecycle";

afterEach(() => {
  resetKeepAwakeForTests();
  setPreferencePreWriteHookForTests("quickEntryDictationShortcut", null);
  // restore default by re-setting real hook via re-import path — register again:
  setPreferencePreWriteHookForTests(
    "quickEntryDictationShortcut",
    (value, previous) => preWriteQuickEntryDictationShortcut(value, previous),
  );
  setActiveCoworkGrowthBookLifecycle(null);
});

describe("preferenceEffects eZt / xn residual", () => {
  it("dictation off always pre-writes", async () => {
    expect(await preWriteQuickEntryDictationShortcut("off", "capslock")).toBe(
      true,
    );
  });

  it("dictation denied blocks write", async () => {
    const ok = await preWriteQuickEntryDictationShortcut(
      "capslock",
      "off",
      {
        getMediaAccessStatus: () => "denied",
        showDeniedDialog: () => {},
      },
    );
    expect(ok).toBe(false);
  });

  it("dictation not-determined asks then follows result", async () => {
    expect(
      await checkMicrophoneAccessForDictation({
        getMediaAccessStatus: () => "not-determined",
        askForMediaAccess: async () => true,
      }),
    ).toBe(true);
    expect(
      await checkMicrophoneAccessForDictation({
        getMediaAccessStatus: () => "not-determined",
        askForMediaAccess: async () => false,
      }),
    ).toBe(false);
  });

  it("keepAwake post-write claims", async () => {
    await runPreferencePostWriteEffects("keepAwakeEnabled", true, false);
    expect(getKeepAwakeClaimsForTests().has(KEEP_AWAKE_PREFERENCE_CLAIM)).toBe(
      true,
    );
    await runPreferencePostWriteEffects("keepAwakeEnabled", false, true);
    expect(getKeepAwakeClaimsForTests().has(KEEP_AWAKE_PREFERENCE_CLAIM)).toBe(
      false,
    );
  });

  it("chicagoEnabled triggers GrowthBook UrA/y7 refresh when lifecycle active", async () => {
    const refresh = vi.fn(async () => ({ kind: "hardcoded" as const }));
    setActiveCoworkGrowthBookLifecycle({
      refresh,
      refreshForAccountChange: refresh,
      scheduleNext: () => {},
      stop: () => {},
      isRefreshing: () => false,
    });
    await runPreferencePostWriteEffects("chicagoEnabled", true, false);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getActiveCoworkGrowthBookLifecycle()).not.toBeNull();
  });

  it("pre-write hook default path for other keys is allow", async () => {
    expect(await runPreferencePreWriteHook("sidebarMode", "chat", "code")).toBe(
      true,
    );
  });

  it("wakeSchedulerEnabled post-write triggers reconcile residual (no invent)", async () => {
    // Without active controller / API, reconcile is honest no-op.
    await expect(
      runPreferencePostWriteEffects("wakeSchedulerEnabled", true, false),
    ).resolves.toBeUndefined();
  });
});
