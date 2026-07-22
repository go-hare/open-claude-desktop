import { describe, expect, it } from "vitest";
import {
  mergeAppPreferences,
  OFFICIAL_APP_PREFERENCE_DEFAULTS,
  OFFICIAL_APP_PREFERENCE_KEYS,
} from "./appPreferencesDefaults";

describe("OFFICIAL_APP_PREFERENCE_DEFAULTS (SSA residual)", () => {
  it("includes official keepAwake / allowAll / sidebar / vm defaults", () => {
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.keepAwakeEnabled).toBe(false);
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.allowAllBrowserActions).toBe(false);
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.sidebarMode).toBe("chat");
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.vmMemoryGB).toBe(0);
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.vmCpuCount).toBe(0);
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.coworkWebSearchEnabled).toBe(true);
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.epitaxyPrefs).toEqual({});
    expect(OFFICIAL_APP_PREFERENCE_DEFAULTS.chicagoEnabled).toBe(false);
  });

  it("has full SSA key count (48)", () => {
    expect(OFFICIAL_APP_PREFERENCE_KEYS.length).toBe(48);
  });

  it("bLA merge: stored overrides defaults; missing keys stay SSA", () => {
    const merged = mergeAppPreferences({
      sidebarMode: "code",
      locale: "zh-CN",
    });
    expect(merged.sidebarMode).toBe("code");
    expect(merged.keepAwakeEnabled).toBe(false);
    expect(merged.locale).toBe("zh-CN");
    expect(merged.allowAllBrowserActions).toBe(false);
  });

  it("empty stored still yields full SSA bag", () => {
    const merged = mergeAppPreferences({});
    expect(merged.menuBarEnabled).toBe(true);
    expect(merged.quickEntryShortcut).toBe("double-tap-option");
  });
});
