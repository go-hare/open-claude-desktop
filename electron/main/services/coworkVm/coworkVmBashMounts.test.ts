import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeCoworkHostLoopBashMounts,
  hostPathToCoworkVmGuestPath,
  resolveCoworkWorkspaceMountMode,
} from "./coworkVmBashMounts";

describe("resolveCoworkWorkspaceMountMode (Cq)", () => {
  it("uses rwd only when mount is delete-approved", () => {
    expect(resolveCoworkWorkspaceMountMode("outputs", null)).toBe("rw");
    expect(resolveCoworkWorkspaceMountMode("outputs", [])).toBe("rw");
    expect(resolveCoworkWorkspaceMountMode("outputs", ["outputs"])).toBe("rwd");
    expect(resolveCoworkWorkspaceMountMode("outputs", ["outputs"], true)).toBe(
      "rw",
    );
  });
});

describe("hostPathToCoworkVmGuestPath (_o)", () => {
  it("maps posix absolute paths relative to root", () => {
    if (process.platform === "win32") return;
    expect(hostPathToCoworkVmGuestPath("/Users/me/work")).toBe("Users/me/work");
    expect(hostPathToCoworkVmGuestPath("/tmp/out")).toBe("tmp/out");
  });
});

describe("computeCoworkHostLoopBashMounts (j1i)", () => {
  it("defaults cwd to outputs when no user folders", () => {
    const result = computeCoworkHostLoopBashMounts({
      hostOutputsDir: "/tmp/sess/outputs",
      hostUploadsDir: "/tmp/sess/uploads",
      sessionStorageDir: "/tmp/sess",
      userSelectedFolders: [],
      vmProcessName: "vm-abc",
    });
    expect(result.vmCwd).toBe("/sessions/vm-abc/mnt/outputs");
    expect(result.vmCwdMountName).toBe("outputs");
    expect(result.mounts.outputs).toMatchObject({
      mode: "rw",
      path:
        process.platform === "win32"
          ? expect.any(String)
          : "tmp/sess/outputs",
    });
    expect(result.mounts.uploads?.mode).toBe("ro");
    expect(result.mounts[".claude/projects"]?.mode).toBe("ro");
  });

  it("uses first user folder as cwd and applies rwd approval", () => {
    const folder = path.join("/Users", "me", "Project");
    const result = computeCoworkHostLoopBashMounts({
      fileDeleteApprovedMounts: ["Project", "outputs"],
      hostOutputsDir: "/tmp/sess/outputs",
      hostUploadsDir: "/tmp/sess/uploads",
      sessionStorageDir: "/tmp/sess",
      userSelectedFolders: [folder],
      vmProcessName: "p1",
    });
    expect(result.vmCwd).toBe("/sessions/p1/mnt/Project");
    expect(result.mounts.Project?.mode).toBe("rwd");
    expect(result.mounts.outputs?.mode).toBe("rwd");
    expect(result.nameByFolder.get(folder)).toBe("Project");
  });

  it("skips network-drive folders for user mounts", () => {
    const local = "/Users/me/local";
    const net = "/Volumes/share";
    const result = computeCoworkHostLoopBashMounts({
      hostOutputsDir: "/tmp/o",
      networkDriveFolders: [net],
      userSelectedFolders: [local, net],
      vmProcessName: "p2",
    });
    expect(result.nameByFolder.has(local)).toBe(true);
    // network still in name map but not mounted
    expect(result.mounts[path.basename(net)]).toBeUndefined();
    expect(Object.keys(result.mounts).some((k) => k.includes("share"))).toBe(
      false,
    );
  });

  it("mounts auto-memory as ro .auto-memory", () => {
    const result = computeCoworkHostLoopBashMounts({
      autoMemoryDir: "/tmp/mem",
      hostOutputsDir: "/tmp/o",
      vmProcessName: "p3",
    });
    expect(result.mounts[".auto-memory"]).toMatchObject({ mode: "ro" });
  });
});
