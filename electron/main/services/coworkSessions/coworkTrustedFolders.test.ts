import { expect, it } from "vitest";
import type { SettingsStore } from "../settings/settingsStore";
import { CoworkTrustedFolders } from "./coworkTrustedFolders";

function settingsStore(initial: string[] = []): SettingsStore {
  const preferences: Record<string, unknown> = {
    localAgentModeTrustedFolders: initial,
  };
  return {
    getPreferences: () => ({ ...preferences }),
    setPreference: (key: string, value: unknown) => {
      preferences[key] = value;
      return true;
    },
  } as unknown as SettingsStore;
}

it("trusts a selected folder and its descendants", () => {
  const trusted = new CoworkTrustedFolders(settingsStore(["/tmp/project"]));

  expect(trusted.isTrusted("/tmp/project")).toBe(true);
  expect(trusted.isTrusted("/tmp/project/src/file.ts")).toBe(true);
  expect(trusted.isTrusted("/tmp/project-other")).toBe(false);
});

it("deduplicates trailing separators and removes the normalized folder", () => {
  const trusted = new CoworkTrustedFolders(settingsStore());

  trusted.add("/tmp/project/");
  trusted.add("/tmp/project");
  expect(trusted.getAll()).toEqual(["/tmp/project/"]);

  trusted.remove("/tmp/project");
  expect(trusted.getAll()).toEqual([]);
});

it("retains only the latest 300 trusted folders", () => {
  const trusted = new CoworkTrustedFolders(settingsStore());
  for (let index = 0; index < 305; index += 1) {
    trusted.add(`/tmp/folder-${index}`);
  }

  expect(trusted.getAll()).toHaveLength(300);
  expect(trusted.getAll()[0]).toBe("/tmp/folder-5");
});
