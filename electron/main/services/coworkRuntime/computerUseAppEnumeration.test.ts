import { afterEach, describe, expect, it } from "vitest";
import {
  formatInstalledAppNamesForTools,
  PRIORITY_APP_BUNDLE_IDS,
  resetComputerUseAppEnumerationForTests,
  enumerateInstalledAppNamesForTools,
} from "./computerUseAppEnumeration";

describe("computerUseAppEnumeration residual GUi/sFi", () => {
  afterEach(() => {
    resetComputerUseAppEnumerationForTests();
  });

  it("PRIORITY_APP_BUNDLE_IDS includes Notes + Finder residual", () => {
    expect(PRIORITY_APP_BUNDLE_IDS.has("com.apple.Notes")).toBe(true);
    expect(PRIORITY_APP_BUNDLE_IDS.has("com.apple.finder")).toBe(true);
  });

  it("GUi residual: priority first, noise filtered, running floated", () => {
    const names = formatInstalledAppNamesForTools(
      [
        {
          bundleId: "com.example.Helper",
          displayName: "Foo Helper",
          path: "/Applications/Foo Helper.app",
        },
        {
          bundleId: "com.apple.Notes",
          displayName: "Notes",
          path: "/System/Applications/Notes.app",
        },
        {
          bundleId: "com.example.Bar",
          displayName: "Bar",
          path: "/Applications/Bar.app",
        },
        {
          bundleId: "com.example.Home",
          displayName: "HomeBrewApp",
          path: "/opt/homebrew/Caskroom/HomeBrewApp.app",
        },
      ],
      {
        homeDir: "/Users/test",
        platform: "darwin",
        runningBundleIds: ["com.example.Bar"],
      },
    );
    // Bar running floats front; Notes priority; helper noise + non-app path dropped.
    expect(names[0]).toBe("Bar");
    expect(names).toContain("Notes");
    expect(names).not.toContain("Foo Helper");
    expect(names).not.toContain("HomeBrewApp");
  });

  it("sFi residual: timeout returns undefined", async () => {
    const names = await enumerateInstalledAppNamesForTools(
      {
        listInstalledApps: () =>
          new Promise(() => {
            /* never resolves */
          }),
      },
      { timeoutMs: 20 },
    );
    expect(names).toBeUndefined();
  });

  it("sFi residual: maps installed list", async () => {
    const names = await enumerateInstalledAppNamesForTools(
      {
        listInstalledApps: async () => [
          {
            bundleId: "com.apple.Notes",
            displayName: "Notes",
            path: "/System/Applications/Notes.app",
          },
        ],
        listRunningApps: async () => [],
      },
      { homeDir: "/Users/test", platform: "darwin", timeoutMs: 200 },
    );
    expect(names).toEqual(["Notes"]);
  });
});
