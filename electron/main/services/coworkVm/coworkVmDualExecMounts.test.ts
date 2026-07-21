import { describe, expect, it } from "vitest";
import {
  computeCoworkDualExecMounts,
  pluginMountsFromReadOnlyPaths,
} from "./coworkVmDualExecMounts";

describe("computeCoworkDualExecMounts", () => {
  it("uses Ym mount names and /sessions cwd root", () => {
    const result = computeCoworkDualExecMounts({
      hostClaudeConfigDir: "/tmp/sess/.claude",
      hostOutputsDir: "/tmp/sess/outputs",
      hostUploadsDir: "/tmp/sess/uploads",
      userSelectedFolders: ["/Users/me/Project"],
      vmProcessName: "vm-1",
    });
    expect(result.sessionRoot).toBe("/sessions/vm-1");
    expect(result.additionalDirectories).toEqual([
      "/sessions/vm-1/mnt/Project",
    ]);
    expect(result.mounts.Project?.mode).toBe("rw");
    expect(result.mounts[".claude"]?.mode).toBe("rwd");
    expect(result.mounts.uploads?.mode).toBe("ro");
  });

  it("defaults to outputs mount when no user folders", () => {
    const result = computeCoworkDualExecMounts({
      hostOutputsDir: "/tmp/o",
      userSelectedFolders: [],
      vmProcessName: "vm-2",
    });
    expect(result.mounts.outputs).toBeTruthy();
    expect(result.additionalDirectories).toEqual([]);
  });

  it("skips network drives", () => {
    const result = computeCoworkDualExecMounts({
      networkDriveFolders: ["/Volumes/share"],
      userSelectedFolders: ["/Users/me/a", "/Volumes/share"],
      vmProcessName: "vm-3",
    });
    expect(result.additionalDirectories).toHaveLength(1);
    expect(result.additionalDirectories[0]).toContain("/mnt/");
  });

  it("mounts readOnlyPluginPaths as ro plugin mounts without inventing roots", () => {
    const pluginMounts = pluginMountsFromReadOnlyPaths([
      "/plugins/one",
      "/plugins/two",
      "/other/one",
      "",
    ]);
    expect(pluginMounts).toEqual([
      { hostPath: "/plugins/one", mountName: "one" },
      { hostPath: "/plugins/two", mountName: "two" },
      { hostPath: "/other/one", mountName: "one-2" },
    ]);
    const result = computeCoworkDualExecMounts({
      pluginMounts,
      userSelectedFolders: [],
      hostOutputsDir: "/tmp/o",
      vmProcessName: "vm-p",
    });
    expect(result.mounts.one?.mode).toBe("ro");
    expect(result.mounts.two?.mode).toBe("ro");
    expect(result.mounts["one-2"]?.mode).toBe("ro");
  });
});
