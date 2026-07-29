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

  it("setMcpServersConfig dual-writes official mcpServers + reveal path is official file", () => {
    const { shell, official, dir } = mkPaths();
    const store = new SettingsStore(shell, official);
    expect(store.getMcpConfigFile()).toBe(official);
    expect(
      store.setMcpServersConfig({
        echo: { command: "node", args: ["-e", "1"], env: { A: "1" } },
      }),
    ).toBe(true);
    expect(store.getMcpServersConfig()).toEqual({
      echo: { command: "node", args: ["-e", "1"], env: { A: "1" } },
    });
    const officialRaw = JSON.parse(fs.readFileSync(official, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(officialRaw.mcpServers).toEqual({
      echo: { command: "node", args: ["-e", "1"], env: { A: "1" } },
    });
    // Legacy mirror still written for diagnostics.
    const mirror = path.join(dir, "mcp-servers.json");
    expect(JSON.parse(fs.readFileSync(mirror, "utf8"))).toEqual({
      echo: { command: "node", args: ["-e", "1"], env: { A: "1" } },
    });
  });

  it("reads official mcpServers when shell empty; reload picks external edit", () => {
    const { shell, official } = mkPaths();
    fs.writeFileSync(
      official,
      JSON.stringify({
        preferences: { sidebarMode: "task" },
        mcpServers: { fromOfficial: { command: "echo" } },
      }),
    );
    const store = new SettingsStore(shell, official);
    expect(store.getMcpServersConfig()).toEqual({
      fromOfficial: { command: "echo" },
    });
    // External edit
    fs.writeFileSync(
      official,
      JSON.stringify({
        preferences: { sidebarMode: "task" },
        mcpServers: {
          fromOfficial: { command: "echo" },
          extra: { command: "node", args: ["a.js"] },
        },
      }),
    );
    const reloaded = store.reloadMcpServersConfigFromOfficial();
    expect(reloaded).toEqual({
      fromOfficial: { command: "echo" },
      extra: { command: "node", args: ["a.js"] },
    });
  });
});
