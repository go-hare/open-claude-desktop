import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OFFICIAL_APP_PREFERENCE_DEFAULTS } from "./appPreferencesDefaults";
import { SettingsStore } from "./settingsStore";

const tempFiles: string[] = [];

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    try {
      fs.rmSync(file, { force: true });
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function mkStoreFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-store-"));
  const file = path.join(dir, "desktop-shell-settings.json");
  tempFiles.push(file);
  return file;
}

describe("SettingsStore AppPreferences residual", () => {
  it("getPreferences merges full SSA defaults", () => {
    const store = new SettingsStore(mkStoreFile());
    const prefs = store.getPreferences();
    expect(prefs.keepAwakeEnabled).toBe(false);
    expect(prefs.sidebarMode).toBe("chat");
    expect(prefs.vmMemoryGB).toBe(0);
    expect(prefs.allowAllBrowserActions).toBe(false);
    for (const key of Object.keys(OFFICIAL_APP_PREFERENCE_DEFAULTS)) {
      expect(prefs).toHaveProperty(key);
    }
  });

  it("setPreference validates and persists official key", () => {
    const file = mkStoreFile();
    const store = new SettingsStore(file);
    expect(store.setPreference("sidebarMode", "code")).toBe(true);
    expect(store.getPreferences().sidebarMode).toBe("code");
    expect(store.setPreference("sidebarMode", "nope")).toBe(false);
    expect(store.getPreferences().sidebarMode).toBe("code");

    const reloaded = new SettingsStore(file);
    expect(reloaded.getPreferences().sidebarMode).toBe("code");
    expect(reloaded.getPreferences().keepAwakeEnabled).toBe(false);
  });

  it("accepts residual requireCoworkFullVmSandbox boolean only", () => {
    const store = new SettingsStore(mkStoreFile());
    expect(store.setPreference("requireCoworkFullVmSandbox", true)).toBe(true);
    expect(store.getPreferences().requireCoworkFullVmSandbox).toBe(true);
    expect(store.setPreference("requireCoworkFullVmSandbox", "1" as unknown as boolean)).toBe(
      false,
    );
    expect(store.getPreferences().requireCoworkFullVmSandbox).toBe(true);
  });

  it("rejects unknown keys", () => {
    const store = new SettingsStore(mkStoreFile());
    expect(store.setPreference("totallyUnknownPref", 1)).toBe(false);
    expect(store.getPreferences().totallyUnknownPref).toBeUndefined();
  });

  it("isLocalDevMcpEnabled defaults true (InA); feature false disables", () => {
    const store = new SettingsStore(mkStoreFile());
    // Absent enterprise + features → enabled (never Boolean(undefined)).
    expect(store.isLocalDevMcpEnabled()).toBe(true);
    expect(store.isDxtEnabled()).toBe(true);

    expect(store.setAppFeature("isLocalDevMcpEnabled", false)).toBe(true);
    expect(store.isLocalDevMcpEnabled()).toBe(false);
    expect(store.setAppFeature("isLocalDevMcpEnabled", true)).toBe(true);
    expect(store.isLocalDevMcpEnabled()).toBe(true);

    expect(store.setAppFeature("isDxtEnabled", false)).toBe(true);
    expect(store.isDxtEnabled()).toBe(false);
  });

  it("deletePreference clears residual deploymentMode (jsA undefined / clear)", () => {
    const file = mkStoreFile();
    const store = new SettingsStore(file);
    expect(store.setPreference("deploymentMode", "3p")).toBe(true);
    expect(store.getPreferences().deploymentMode).toBe("3p");
    expect(store.deletePreference("deploymentMode")).toBe(true);
    expect(store.getPreferences().deploymentMode).toBeUndefined();
    const reloaded = new SettingsStore(file);
    expect(reloaded.getPreferences().deploymentMode).toBeUndefined();
    // Unknown keys still rejected.
    expect(store.deletePreference("totallyUnknownPref")).toBe(false);
  });

  it("loads sparse on-disk prefs under SSA defaults", () => {
    const file = mkStoreFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        preferences: { locale: "zh-CN", sidebarMode: "task" },
      }),
    );
    const store = new SettingsStore(file);
    const prefs = store.getPreferences();
    expect(prefs.locale).toBe("zh-CN");
    expect(prefs.sidebarMode).toBe("task");
    expect(prefs.keepAwakeEnabled).toBe(false);
    expect(prefs.coworkWebSearchEnabled).toBe(true);
  });
});
