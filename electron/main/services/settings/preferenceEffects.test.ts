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

  it("dictation not-determined asks then follows result (official sole ask site)", async () => {
    const askYes = vi.fn(async () => true);
    const askNo = vi.fn(async () => false);
    expect(
      await checkMicrophoneAccessForDictation({
        getMediaAccessStatus: () => "not-determined",
        askForMediaAccess: askYes,
      }),
    ).toBe(true);
    expect(askYes).toHaveBeenCalledWith("microphone");
    expect(
      await checkMicrophoneAccessForDictation({
        getMediaAccessStatus: () => "not-determined",
        askForMediaAccess: askNo,
      }),
    ).toBe(false);
    expect(askNo).toHaveBeenCalledWith("microphone");
  });

  it("dictation granted never re-asks (official Fxe default branch)", async () => {
    const ask = vi.fn(async () => false);
    expect(
      await checkMicrophoneAccessForDictation({
        getMediaAccessStatus: () => "granted",
        askForMediaAccess: ask,
      }),
    ).toBe(true);
    expect(ask).not.toHaveBeenCalled();
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

  it("launchPreviewPersistSession false clears persisted workspaces (iOi residual)", async () => {
    const { setLaunchPreviewPersistPreferenceAccess } = await import(
      "./preferenceEffects"
    );
    let workspaces = ["abc", "def"];
    setLaunchPreviewPersistPreferenceAccess({
      getPersistedWorkspaces: () => workspaces,
      setPersistedWorkspaces: (keys) => {
        workspaces = keys;
      },
    });
    await runPreferencePostWriteEffects("launchPreviewPersistSession", false, true);
    expect(workspaces).toEqual([]);
    workspaces = ["x"];
    await runPreferencePostWriteEffects("launchPreviewPersistSession", true, false);
    expect(workspaces).toEqual(["x"]);
    setLaunchPreviewPersistPreferenceAccess(null);
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
