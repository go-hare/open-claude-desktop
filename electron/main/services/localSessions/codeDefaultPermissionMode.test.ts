import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadClaudeSettingsLayers,
  resolveDefaultPermissionMode,
  resolveDefaultPermissionModeFromLayers,
  type SettingsLayer,
} from "./codeDefaultPermissionMode";

const tempRoots: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-default-perm-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveDefaultPermissionModeFromLayers", () => {
  it("returns null when no settings", () => {
    expect(resolveDefaultPermissionModeFromLayers([])).toBeNull();
  });

  it("reads user permissions.defaultMode", () => {
    const layers: SettingsLayer[] = [
      {
        tier: "user",
        path: "u",
        settings: { permissions: { defaultMode: "acceptEdits" } },
      },
    ];
    expect(resolveDefaultPermissionModeFromLayers(layers)).toBe("acceptEdits");
  });

  it("project local overrides project and user for non-restricted modes", () => {
    const layers: SettingsLayer[] = [
      {
        tier: "user",
        path: "u",
        settings: { permissions: { defaultMode: "default" } },
      },
      {
        tier: "project",
        path: "p",
        settings: { permissions: { defaultMode: "plan" } },
      },
      {
        tier: "projectLocal",
        path: "pl",
        settings: { permissions: { defaultMode: "acceptEdits" } },
      },
    ];
    expect(resolveDefaultPermissionModeFromLayers(layers)).toBe("acceptEdits");
  });

  it("ignores project auto/bypass (official srt + project tier rule)", () => {
    const layers: SettingsLayer[] = [
      {
        tier: "user",
        path: "u",
        settings: { permissions: { defaultMode: "default" } },
      },
      {
        tier: "project",
        path: "p",
        settings: { permissions: { defaultMode: "bypassPermissions" } },
      },
      {
        tier: "projectLocal",
        path: "pl",
        settings: { permissions: { defaultMode: "auto" } },
      },
    ];
    expect(resolveDefaultPermissionModeFromLayers(layers)).toBe("default");
  });

  it("allows user auto/bypass", () => {
    expect(
      resolveDefaultPermissionModeFromLayers([
        {
          tier: "user",
          path: "u",
          settings: { permissions: { defaultMode: "auto" } },
        },
      ]),
    ).toBe("auto");
    expect(
      resolveDefaultPermissionModeFromLayers([
        {
          tier: "user",
          path: "u",
          settings: { permissions: { defaultMode: "bypassPermissions" } },
        },
      ]),
    ).toBe("bypassPermissions");
  });

  it("ignores invalid modes", () => {
    expect(
      resolveDefaultPermissionModeFromLayers([
        {
          tier: "user",
          path: "u",
          settings: { permissions: { defaultMode: "not-a-mode" } },
        },
      ]),
    ).toBeNull();
  });
});

describe("loadClaudeSettingsLayers + resolveDefaultPermissionMode", () => {
  it("reads project settings from cwd", () => {
    const root = tempDir();
    const claude = path.join(root, ".claude");
    fs.mkdirSync(claude, { recursive: true });
    fs.writeFileSync(
      path.join(claude, "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "plan" } }),
      "utf8",
    );
    // Stub user home to empty so user layer has no settings.
    const home = tempDir();
    vi.spyOn(os, "homedir").mockReturnValue(home);

    const layers = loadClaudeSettingsLayers(root);
    expect(resolveDefaultPermissionModeFromLayers(layers)).toBe("plan");
    expect(resolveDefaultPermissionMode(root)).toBe("plan");
  });

  it("clamps user bypass when pref is off", () => {
    const home = tempDir();
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }),
      "utf8",
    );
    vi.spyOn(os, "homedir").mockReturnValue(home);

    expect(
      resolveDefaultPermissionMode(undefined, { bypassPermissionsModeEnabled: false }),
    ).toBe("acceptEdits");
    expect(
      resolveDefaultPermissionMode(undefined, { bypassPermissionsModeEnabled: true }),
    ).toBe("bypassPermissions");
  });
});
