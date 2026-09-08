import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cliInstalledPluginsFile,
  cliPluginsDir,
  isValidCliPluginPath,
  listCliLocalPlugins,
  mergeCliEnabledPluginsMap,
  resolveClaudeConfigDir,
} from "./cliLocalPluginsResolver";

describe("cliLocalPluginsResolver (official SI / DkA / ZLi)", () => {
  it("SI() is ~/.claude unless CLAUDE_CONFIG_DIR is set", () => {
    const home = "/Users/demo";
    expect(resolveClaudeConfigDir({ homedir: home, env: {} })).toBe(
      path.join(home, ".claude"),
    );
    expect(
      resolveClaudeConfigDir({
        homedir: home,
        env: { CLAUDE_CONFIG_DIR: "~/alt" },
      }),
    ).toBe(path.join(home, "alt"));
    expect(
      resolveClaudeConfigDir({
        homedir: home,
        env: { CLAUDE_CONFIG_DIR: "/opt/claude-config" },
      }),
    ).toBe("/opt/claude-config");
    expect(cliPluginsDir({ homedir: home, env: {} })).toBe(
      path.join(home, ".claude", "plugins"),
    );
    expect(cliInstalledPluginsFile({ homedir: home, env: {} })).toBe(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
    );
  });

  it("isValidPluginPath rejects relative and .. paths", () => {
    const pluginsDir = path.join(os.homedir(), ".claude", "plugins");
    expect(isValidCliPluginPath("plugins/foo", pluginsDir)).toBeUndefined();
    expect(
      isValidCliPluginPath(`${pluginsDir}${path.sep}..${path.sep}escape`, pluginsDir),
    ).toBeUndefined();
    expect(
      isValidCliPluginPath(path.join(pluginsDir, "demo"), pluginsDir),
    ).toBe(pluginsDir);
  });

  it("ccd lists user plugins and project plugins matching workspace", () => {
    const home = path.resolve(os.tmpdir(), "cli-plug-home");
    const pluginsDir = path.join(home, ".claude", "plugins");
    const workspace = path.resolve(os.tmpdir(), "cli-plug-proj");
    const other = path.resolve(os.tmpdir(), "cli-plug-other");
    const userInstall = path.join(pluginsDir, "user-plug");
    const projInstall = path.join(workspace, ".claude", "plugins", "proj-plug");
    const files: Record<string, string> = {
      [path.join(home, ".claude", "plugins", "installed_plugins.json")]: JSON.stringify({
        version: 2,
        plugins: {
          "user-plug@cli": [{ installPath: userInstall, scope: "user" }],
          "proj-plug@cli": [
            { installPath: projInstall, scope: "project", projectPath: workspace },
          ],
          "other-proj@cli": [
            {
              installPath: path.join(other, ".claude", "plugins", "x"),
              scope: "project",
              projectPath: other,
            },
          ],
        },
      }),
      [path.join(home, ".claude", "settings.json")]: JSON.stringify({
        enabledPlugins: { "user-plug@cli": true },
      }),
      [path.join(workspace, ".claude", "settings.json")]: JSON.stringify({
        enabledPlugins: { "proj-plug@cli": true },
      }),
    };
    const present = new Set([userInstall, projInstall]);
    const deps = {
      homedir: home,
      env: {} as NodeJS.ProcessEnv,
      orgPluginsRoot: null,
      readFile: (file: string) => {
        const text = files[path.resolve(file)] ?? files[file];
        if (text == null) throw new Error("ENOENT");
        return text;
      },
      exists: (file: string) => present.has(path.resolve(file)),
    };
    const listed = listCliLocalPlugins(workspace, deps);
    expect(listed.map((row) => row.id).sort()).toEqual([
      "proj-plug@cli",
      "user-plug@cli",
    ]);
    expect(listed.find((row) => row.id === "user-plug@cli")?.enabled).toBe(true);
    expect(listed.find((row) => row.id === "proj-plug@cli")?.scope).toBe("project");
    expect(mergeCliEnabledPluginsMap(workspace, deps)["proj-plug@cli"]).toBe(true);
  });

  it("missing enabledPlugins key is not enabled (official i[id]===true)", () => {
    const home = path.resolve(os.tmpdir(), "cli-plug-home2");
    const pluginsDir = path.join(home, ".claude", "plugins");
    const install = path.join(pluginsDir, "off");
    const files: Record<string, string> = {
      [path.join(home, ".claude", "plugins", "installed_plugins.json")]: JSON.stringify({
        plugins: {
          "off@cli": [{ installPath: install, scope: "user" }],
        },
      }),
    };
    const listed = listCliLocalPlugins(null, {
      homedir: home,
      env: {},
      orgPluginsRoot: null,
      readFile: (file) => {
        const text = files[path.resolve(file)] ?? files[file];
        if (text == null) throw new Error("ENOENT");
        return text;
      },
      exists: (file) => path.resolve(file) === path.resolve(install),
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.enabled).toBe(false);
  });

  it("GAr folds managed-settings.json last", () => {
    const home = path.resolve(os.tmpdir(), "cli-plug-managed");
    const managedDir = path.resolve(os.tmpdir(), "cli-plug-managed-settings");
    const files: Record<string, string> = {
      [path.join(home, ".claude", "settings.json")]: JSON.stringify({
        enabledPlugins: { "user-plug@cli": true },
      }),
      [path.join(managedDir, "managed-settings.json")]: JSON.stringify({
        enabledPlugins: { "user-plug@cli": false, "org-plug@cli": true },
      }),
    };
    const deps = {
      homedir: home,
      env: { CLAUDE_CODE_MANAGED_SETTINGS_PATH: managedDir } as NodeJS.ProcessEnv,
      orgPluginsRoot: null,
      readFile: (file: string) => {
        const text = files[path.resolve(file)] ?? files[file];
        if (text == null) throw new Error("ENOENT");
        return text;
      },
      exists: () => false,
    };
    const map = mergeCliEnabledPluginsMap(null, deps);
    expect(map["user-plug@cli"]).toBe(false);
    expect(map["org-plug@cli"]).toBe(true);
  });
});
