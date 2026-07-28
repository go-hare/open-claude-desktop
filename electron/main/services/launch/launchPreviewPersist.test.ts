import { describe, expect, it } from "vitest";
import {
  hashLaunchPreviewWorkspace,
  launchPreviewPartitionName,
  recordLaunchPreviewPersistedWorkspace,
  LAUNCH_PREVIEW_DEFAULT_PARTITION,
} from "./launchPreviewPersist";

describe("launchPreviewPersist residual (ZHA / AOi / D5e)", () => {
  it("ZHA: md5(cwd).slice(0,12)", () => {
    const a = hashLaunchPreviewWorkspace("/repo/app");
    const b = hashLaunchPreviewWorkspace("/repo/app");
    const c = hashLaunchPreviewWorkspace("/other");
    expect(a).toHaveLength(12);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(/^[0-9a-f]{12}$/.test(a)).toBe(true);
  });

  it("AOi partition names", () => {
    expect(launchPreviewPartitionName("abc123def456", true)).toBe(
      "persist:launch-preview-abc123def456",
    );
    expect(launchPreviewPartitionName("abc123def456", false)).toBe(
      "launch-preview-abc123def456",
    );
    expect(launchPreviewPartitionName(null, true)).toBe(
      LAUNCH_PREVIEW_DEFAULT_PARTITION,
    );
    expect(launchPreviewPartitionName(undefined, false)).toBe(
      LAUNCH_PREVIEW_DEFAULT_PARTITION,
    );
  });

  it("D5e appends workspace once", () => {
    const list: string[] = [];
    const store = {
      getPersistedWorkspaces: () => list,
      setPersistedWorkspaces: (next: string[]) => {
        list.splice(0, list.length, ...next);
      },
    };
    recordLaunchPreviewPersistedWorkspace("aaa", store);
    recordLaunchPreviewPersistedWorkspace("aaa", store);
    recordLaunchPreviewPersistedWorkspace("bbb", store);
    expect(list).toEqual(["aaa", "bbb"]);
  });
});
