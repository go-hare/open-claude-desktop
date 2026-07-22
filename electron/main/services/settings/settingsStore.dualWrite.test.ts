import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OFFICIAL_APP_CONFIG_FILENAME } from "./officialConfigJson";
import { SettingsStore } from "./settingsStore";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-dual-"));
  temps.push(dir);
  return {
    dir,
    shell: path.join(dir, "desktop-shell-settings.json"),
    official: path.join(dir, OFFICIAL_APP_CONFIG_FILENAME),
  };
}

describe("SettingsStore dual-write / dual-read residual", () => {
  it("setPreference writes shell + official config preferences", () => {
    const { shell, official } = mkPaths();
    const store = new SettingsStore(shell, official);
    expect(store.setPreference("sidebarMode", "code")).toBe(true);
    expect(store.getPreferences().sidebarMode).toBe("code");

    const officialRaw = JSON.parse(fs.readFileSync(official, "utf8")) as {
      preferences: { sidebarMode: string };
    };
    expect(officialRaw.preferences.sidebarMode).toBe("code");
  });

  it("reads official preferences when shell sparse", () => {
    const { shell, official, dir } = mkPaths();
    fs.writeFileSync(
      official,
      JSON.stringify({
        preferences: { locale: "zh-CN", sidebarMode: "task" },
        mcpServers: { keep: { command: "echo" } },
      }),
    );
    // no shell file
    const store = new SettingsStore(shell, official);
    expect(store.getPreferences().locale).toBe("zh-CN");
    expect(store.getPreferences().sidebarMode).toBe("task");
    expect(store.getPreferences().keepAwakeEnabled).toBe(false);
    expect(store.getOfficialConfigPath()).toBe(
      path.join(dir, OFFICIAL_APP_CONFIG_FILENAME),
    );
  });

  it("rejects invalid accelerator object on preference set", () => {
    const { shell, official } = mkPaths();
    const store = new SettingsStore(shell, official);
    expect(
      store.setPreference("quickEntryShortcut", {
        accelerator: "NotARealModifier+Q",
      }),
    ).toBe(false);
    expect(
      store.setPreference("quickEntryShortcut", {
        accelerator: "CommandOrControl+Shift+K",
      }),
    ).toBe(true);
  });
});
