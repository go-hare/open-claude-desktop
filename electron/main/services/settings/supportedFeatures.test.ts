import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => `/tmp/hare-code-settings-test/${name}`,
  },
}));

import { SettingsStore } from "./settingsStore";
import { resolveNativeQuickEntryFeature } from "./nativeQuickEntryFeature";

describe("SettingsStore.getSupportedFeatures", () => {
  it("returns official { status } map; nativeQuickEntry follows Dvi residual", () => {
    const store = new SettingsStore("/tmp/hare-code-settings-test/desktop-shell-settings.json");
    const features = store.getSupportedFeatures();

    for (const key of [
      "localSessions",
      "scheduledTasks",
      "findInPage",
      "fileSystem",
      "desktopNotifications",
      "secondaryWindows",
      "customProtocols",
    ]) {
      expect(features[key]).toEqual({ status: "supported" });
    }

    // Official Dvi: darwin + macOS 13+ → supported; else unavailable/unsupported.
    // Must match resolveNativeQuickEntryFeature() — never invent beyond Dvi.
    expect(features.nativeQuickEntry?.status).toBe(resolveNativeQuickEntryFeature().status);

    for (const key of [
      "quickEntryDictation",
      "customQuickEntryDictationShortcut",
      "wakeScheduler",
    ]) {
      expect(features[key]).toEqual({ status: "unavailable" });
    }
  });
});
