/**
 * Adversarial probes for settings residual (verification harness, in-repo).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OFFICIAL_APP_PREFERENCE_DEFAULTS,
  OFFICIAL_APP_PREFERENCE_KEYS,
  mergeAppPreferences,
} from "./appPreferencesDefaults";
import { validateAppPreference } from "./appPreferencesSchema";
import {
  applyKeepAwakeEnabled,
  claimKeepAwake,
  getKeepAwakeClaimsForTests,
  KEEP_AWAKE_PREFERENCE_CLAIM,
  KEEP_AWAKE_WAKE_SCHEDULER_CLAIM,
  releaseKeepAwake,
  resetKeepAwakeForTests,
  syncKeepAwakeFromPreferences,
} from "./keepAwake";
import { getMicrophoneBeforeUseDeniedCopy, listDialogLocales } from "./desktopDialogI18n";
import { parseOfficialAppConfig } from "./officialConfigSchema";
import { SettingsStore } from "./settingsStore";
import {
  cancelWakes,
  getWakeSchedulerStatus,
  scheduleWake,
  WAKE_SCHEDULER_NO_API_ERROR,
} from "./wakeScheduler";
import { resolveCoworkRequireFullVmSandbox } from "../coworkHostLoop/coworkHostLoopMode";

const tempFiles: string[] = [];

afterEach(() => {
  resetKeepAwakeForTests();
  for (const file of tempFiles.splice(0)) {
    try {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function mkStore(): SettingsStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-adv-"));
  const file = path.join(dir, "desktop-shell-settings.json");
  tempFiles.push(file);
  return new SettingsStore(file);
}

describe("adversarial: SSA bag vs official anchors", () => {
  it("48 keys; critical defaults match SSA", () => {
    expect(OFFICIAL_APP_PREFERENCE_KEYS.length).toBe(48);
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.keepAwakeEnabled).toBe(false);
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.allowAllBrowserActions).toBe(false);
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.sidebarMode).toBe("chat");
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.vmMemoryGB).toBe(0);
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.vmCpuCount).toBe(0);
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.coworkWebSearchEnabled).toBe(true);
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.chicagoEnabled).toBe(false);
    // require is NOT an SSA default — never invent true
    expect(
      Object.prototype.hasOwnProperty.call(
        OFFICIAL_APP_PREFERENCE_DEFAULTS,
        "requireCoworkFullVmSandbox",
      ),
    ).toBe(false);
  });
});

describe("adversarial: validate + store", () => {
  it("rejects unknown / invalid; accepts residual require boolean only", () => {
    expect(validateAppPreference("totallyUnknown", 1).ok).toBe(false);
    expect(validateAppPreference("keepAwakeEnabled", "true").ok).toBe(false);
    expect(validateAppPreference("requireCoworkFullVmSandbox", "true").ok).toBe(
      false,
    );
    expect(validateAppPreference("requireCoworkFullVmSandbox", 1).ok).toBe(
      false,
    );
    expect(validateAppPreference("requireCoworkFullVmSandbox", true).ok).toBe(
      true,
    );

    const store = mkStore();
    expect(store.setPreference("nope", true)).toBe(false);
    expect(store.setPreference("sidebarMode", "banana")).toBe(false);
    expect(store.setPreference("requireCoworkFullVmSandbox", "1" as never)).toBe(
      false,
    );
    expect(store.getPreferences().requireCoworkFullVmSandbox).toBeUndefined();
    expect(store.setPreference("requireCoworkFullVmSandbox", true)).toBe(true);
    expect(store.getPreferences().requireCoworkFullVmSandbox).toBe(true);
  });

  it("sparse disk still bLA-merges SSA", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-adv-"));
    const file = path.join(dir, "desktop-shell-settings.json");
    tempFiles.push(file);
    fs.writeFileSync(
      file,
      JSON.stringify({ preferences: { locale: "zh-CN" } }),
    );
    const store = new SettingsStore(file);
    const prefs = store.getPreferences();
    expect(prefs.locale).toBe("zh-CN");
    expect(prefs.keepAwakeEnabled).toBe(false);
    expect(prefs.sidebarMode).toBe("chat");
    expect(mergeAppPreferences({}).menuBarEnabled).toBe(true);
  });
});

describe("adversarial: keepAwake multi-claim", () => {
  beforeEach(() => resetKeepAwakeForTests());

  it("other claim survives preference release", () => {
    claimKeepAwake(KEEP_AWAKE_WAKE_SCHEDULER_CLAIM);
    applyKeepAwakeEnabled(true);
    applyKeepAwakeEnabled(false);
    expect(getKeepAwakeClaimsForTests().has(KEEP_AWAKE_WAKE_SCHEDULER_CLAIM))
      .toBe(true);
    expect(getKeepAwakeClaimsForTests().has(KEEP_AWAKE_PREFERENCE_CLAIM)).toBe(
      false,
    );
    releaseKeepAwake(KEEP_AWAKE_WAKE_SCHEDULER_CLAIM);
    expect(getKeepAwakeClaimsForTests().size).toBe(0);
  });

  it("sync requires === true", () => {
    syncKeepAwakeFromPreferences({ keepAwakeEnabled: "true" as never });
    expect(getKeepAwakeClaimsForTests().size).toBe(0);
    syncKeepAwakeFromPreferences({ keepAwakeEnabled: true });
    expect(getKeepAwakeClaimsForTests().has(KEEP_AWAKE_PREFERENCE_CLAIM)).toBe(
      true,
    );
  });
});

describe("adversarial: require policy never invents true", () => {
  it("resolveCoworkRequireFullVmSandbox preference === true only", () => {
    expect(resolveCoworkRequireFullVmSandbox({ env: {} })).toBe(false);
    expect(
      resolveCoworkRequireFullVmSandbox({ env: {}, preferenceValue: false }),
    ).toBe(false);
    expect(
      resolveCoworkRequireFullVmSandbox({ env: {}, preferenceValue: "true" }),
    ).toBe(false);
    expect(
      resolveCoworkRequireFullVmSandbox({ env: {}, preferenceValue: 1 }),
    ).toBe(false);
    expect(
      resolveCoworkRequireFullVmSandbox({ env: {}, preferenceValue: true }),
    ).toBe(true);
  });
});

describe("adversarial: wake pvi / Fxe i18n / Hne schema", () => {
  it("scheduleWake without API never invents success", async () => {
    expect(await scheduleWake(1)).toBe(WAKE_SCHEDULER_NO_API_ERROR);
    expect(await cancelWakes()).toBe(WAKE_SCHEDULER_NO_API_ERROR);
    const status = await getWakeSchedulerStatus({
      platform: "darwin",
      getApi: () => null,
    });
    expect(status.enabled).toBe(false);
    expect(status.status).toBe("notFound");
  });

  it("Fxe dialog tree has zh-CN mic copy", () => {
    const zh = getMicrophoneBeforeUseDeniedCopy("zh-CN");
    expect(zh.message.length).toBeGreaterThan(0);
    expect(zh.detail).toContain("麦克风");
    expect(listDialogLocales().length).toBeGreaterThanOrEqual(12);
  });

  it("Hne rejects inventing hosted deploymentMode into parsed bag", () => {
    const r = parseOfficialAppConfig({
      deploymentMode: "hosted",
      mcpServers: { x: { command: "echo" } },
    });
    // Invalid enum → usedFallback empty or stripped; never materialize hosted.
    if (r.ok) {
      expect(r.data.deploymentMode).not.toBe("hosted");
    } else {
      expect(r.usedFallback).toBe(true);
    }
  });
});
