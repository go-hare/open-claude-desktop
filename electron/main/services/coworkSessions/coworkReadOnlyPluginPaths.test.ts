import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectCoworkReadOnlyPluginPaths,
  coworkInstalledPluginsFile,
  parseInstalledPluginInstallPaths,
} from "./coworkReadOnlyPluginPaths";
import { resolveCoworkHostloopPluginsStagingDir } from "./coworkPluginPathStage";
import { resolveCoworkUserDataFromSessionStorage } from "./coworkSessionRuntimeController";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkTemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-plugins-"));
  tempDirs.push(dir);
  return dir;
}

describe("parseInstalledPluginInstallPaths", () => {
  it("reads installPath entries from official plugins map", () => {
    const paths = parseInstalledPluginInstallPaths({
      version: 2,
      plugins: {
        "foo@local": [
          { installPath: "/tmp/plugins/foo", scope: "user" },
          { installPath: "", scope: "user" },
        ],
        "bar@mp": [{ installPath: "/tmp/plugins/bar", scope: "user" }],
      },
    });
    expect(paths).toEqual([
      path.resolve("/tmp/plugins/foo"),
      path.resolve("/tmp/plugins/bar"),
    ]);
  });

  it("returns empty for missing/invalid manifests", () => {
    expect(parseInstalledPluginInstallPaths(null)).toEqual([]);
    expect(parseInstalledPluginInstallPaths({})).toEqual([]);
  });
});

describe("collectCoworkReadOnlyPluginPaths", () => {
  it("returns empty when no on-disk installs (does not invent roots)", () => {
    // Still scans local-desktop fallback layout; empty when nothing installed.
    expect(
      collectCoworkReadOnlyPluginPaths({
        userDataPath: mkTemp(),
      }),
    ).toEqual([]);
  });

  it("collects fallback local-desktop installs without login identity", () => {
    const userData = mkTemp();
    const pluginDir = path.join(userData, "plugin-local");
    fs.mkdirSync(pluginDir, { recursive: true });
    const file = coworkInstalledPluginsFile(
      userData,
      "local-desktop",
      "local-default",
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        plugins: {
          "demo@local-desktop-app-uploads": [
            { installPath: pluginDir, scope: "user" },
          ],
        },
      }),
    );
    const collected = collectCoworkReadOnlyPluginPaths({
      userDataPath: userData,
      remotePluginPathsEnabled: false,
    });
    expect(collected).toContain(path.resolve(pluginDir));
  });

  it("collects existing install paths from installed_plugins.json", () => {
    const userData = mkTemp();
    const pluginA = path.join(userData, "plugin-a");
    const pluginB = path.join(userData, "plugin-b");
    fs.mkdirSync(pluginA, { recursive: true });
    fs.mkdirSync(pluginB, { recursive: true });
    const missing = path.join(userData, "missing-plugin");
    const file = coworkInstalledPluginsFile(userData, "acct", "org");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        plugins: {
          a: [{ installPath: pluginA, scope: "user" }],
          b: [{ installPath: pluginB, scope: "user" }],
          c: [{ installPath: missing, scope: "user" }],
        },
      }),
    );
    const collected = collectCoworkReadOnlyPluginPaths({
      accountId: "acct",
      orgId: "org",
      userDataPath: userData,
    });
    expect(collected).toEqual([pluginA, pluginB]);
  });

  it("collects remote dirs with .claude-plugin/plugin.json when H6e on", () => {
    const userData = mkTemp();
    const remote = path.join(
      userData,
      "local-agent-mode-sessions",
      "acct",
      "org",
      "rpm",
      "marketplace",
      "tool",
    );
    fs.mkdirSync(path.join(remote, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(remote, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "tool" }),
    );
    const collected = collectCoworkReadOnlyPluginPaths({
      accountId: "acct",
      orgId: "org",
      userDataPath: userData,
      remotePluginPathsEnabled: true,
    });
    expect(collected).toEqual([remote]);
  });

  it("H6e off skips remote rpm dirs without inventing", () => {
    const userData = mkTemp();
    const remote = path.join(
      userData,
      "local-agent-mode-sessions",
      "acct",
      "org",
      "rpm",
      "marketplace",
      "tool",
    );
    fs.mkdirSync(path.join(remote, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(remote, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "tool" }),
    );
    expect(
      collectCoworkReadOnlyPluginPaths({
        accountId: "acct",
        orgId: "org",
        userDataPath: userData,
        remotePluginPathsEnabled: false,
      }),
    ).toEqual([]);
  });

  it("kK-stages install paths that contain spaces and appends staging root", () => {
    const userData = mkTemp();
    const stagingTmp = mkTemp();
    const plugin = path.join(userData, "My Plugins", "space-tool");
    fs.mkdirSync(plugin, { recursive: true });
    const file = coworkInstalledPluginsFile(userData, "acct", "org");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        plugins: {
          space: [{ installPath: plugin, scope: "user" }],
        },
      }),
    );
    const collected = collectCoworkReadOnlyPluginPaths({
      accountId: "acct",
      orgId: "org",
      userDataPath: userData,
      stageDeps: { tmpdir: stagingTmp },
    });
    const stagingRoot = resolveCoworkHostloopPluginsStagingDir(stagingTmp);
    expect(collected.some((p) => p.includes(" "))).toBe(false);
    expect(collected.some((p) => p.startsWith(stagingRoot + path.sep))).toBe(
      true,
    );
    expect(collected).toContain(stagingRoot);
  });

  it("includes skillsPluginPath residual without inventing when missing", () => {
    const userData = mkTemp();
    const skills = path.join(userData, "skills-root");
    fs.mkdirSync(skills, { recursive: true });
    expect(
      collectCoworkReadOnlyPluginPaths({
        userDataPath: userData,
        skillsPluginPath: skills,
      }),
    ).toEqual([skills]);
    expect(
      collectCoworkReadOnlyPluginPaths({
        userDataPath: userData,
        skillsPluginPath: path.join(userData, "nope"),
      }),
    ).toEqual([]);
  });
});

describe("resolveCoworkUserDataFromSessionStorage", () => {
  it("strips local-agent-mode-sessions segment", () => {
    expect(
      resolveCoworkUserDataFromSessionStorage(
        "/Users/x/Library/Application Support/App/local-agent-mode-sessions/a/o/agent/sid",
      ),
    ).toBe("/Users/x/Library/Application Support/App");
  });

  it("returns null when marker missing", () => {
    expect(resolveCoworkUserDataFromSessionStorage("/tmp/other")).toBeNull();
    expect(resolveCoworkUserDataFromSessionStorage(null)).toBeNull();
  });
});
