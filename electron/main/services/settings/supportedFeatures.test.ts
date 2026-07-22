import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => `/tmp/hare-code-settings-test/${name}`,
  },
}));

import { SettingsStore } from "./settingsStore";

describe("SettingsStore.getSupportedFeatures", () => {
  it("returns official { status } map and never invents native supported", () => {
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

    for (const key of [
      "nativeQuickEntry",
      "quickEntryDictation",
      "customQuickEntryDictationShortcut",
      "wakeScheduler",
    ]) {
      expect(features[key]).toEqual({ status: "unavailable" });
    }
  });
});
