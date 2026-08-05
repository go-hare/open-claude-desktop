import { describe, expect, it, vi } from "vitest";
import {
  attachSimulatorSessionResidual,
  buildSimulatorAttachmentAmA,
  gestureSimulatorResidual,
  installAndLaunchIosSimulator,
  parseSimulatorAttachRequest,
  parseSimulatorInstallRequest,
} from "./simulatorSessionResidual";

describe("simulatorSessionResidual", () => {
  it("Ysr parse requires udid + appPath", () => {
    expect(parseSimulatorInstallRequest(null)).toBeNull();
    expect(parseSimulatorInstallRequest({})).toBeNull();
    expect(
      parseSimulatorInstallRequest({ udid: "U", appPath: "/App.app" }),
    ).toEqual({ udid: "U", appPath: "/App.app", bundleId: undefined, kind: undefined });
    expect(
      parseSimulatorInstallRequest({
        udid: "U",
        appPath: "/App.app",
        bundleId: "com.a",
        kind: "ios",
      }),
    ).toEqual({
      udid: "U",
      appPath: "/App.app",
      bundleId: "com.a",
      kind: "ios",
    });
  });

  it("non-darwin throws unsupported_platform", async () => {
    await expect(
      installAndLaunchIosSimulator(
        { udid: "U", appPath: "/App.app" },
        { platform: "linux", pathExists: async () => true },
      ),
    ).rejects.toThrow(/unsupported_platform/);
  });

  it("android kind throws not productized", async () => {
    await expect(
      installAndLaunchIosSimulator(
        { udid: "android-avd:Pixel", appPath: "/a.apk", kind: "android" },
        { platform: "darwin", pathExists: async () => true },
      ),
    ).rejects.toThrow(/android emulator/);
  });

  it("missing appPath throws", async () => {
    await expect(
      installAndLaunchIosSimulator(
        { udid: "U", appPath: "/missing.app" },
        { platform: "darwin", pathExists: async () => false },
      ),
    ).rejects.toThrow(/appPath not found/);
  });

  it("runs boot+install(+launch) via simctl inject", async () => {
    const calls: string[][] = [];
    await installAndLaunchIosSimulator(
      { udid: "UDID-1", appPath: "/App.app", bundleId: "com.demo" },
      {
        platform: "darwin",
        pathExists: async () => true,
        simctl: async (args) => {
          calls.push(args);
          return { stdout: "", stderr: "" };
        },
      },
    );
    expect(calls).toEqual([
      ["boot", "UDID-1"],
      ["install", "UDID-1", "/App.app"],
      ["launch", "UDID-1", "com.demo"],
    ]);
  });

  it("boot already-booted is non-fatal", async () => {
    const calls: string[][] = [];
    await installAndLaunchIosSimulator(
      { udid: "U", appPath: "/App.app" },
      {
        platform: "darwin",
        pathExists: async () => true,
        simctl: async (args) => {
          calls.push(args);
          if (args[0] === "boot") {
            throw new Error("Unable to boot device in current state: Booted");
          }
          return { stdout: "", stderr: "" };
        },
      },
    );
    expect(calls[0]).toEqual(["boot", "U"]);
    expect(calls[1]).toEqual(["install", "U", "/App.app"]);
  });

  it("attach/gesture never invent success", () => {
    expect(() => attachSimulatorSessionResidual()).toThrow(/attach residual unavailable/);
    expect(() =>
      attachSimulatorSessionResidual({ udid: "U-1" }),
    ).toThrow(/udid=U-1/);
    expect(() => gestureSimulatorResidual()).toThrow(/gesture residual unavailable/);
  });

  it("parseSimulatorAttachRequest accepts string or bag", () => {
    expect(parseSimulatorAttachRequest(null)).toBeNull();
    expect(parseSimulatorAttachRequest("  ")).toBeNull();
    expect(parseSimulatorAttachRequest("UDID-9")).toEqual({ udid: "UDID-9" });
    expect(
      parseSimulatorAttachRequest({ udid: "U", deviceName: "iPhone", kind: "ios" }),
    ).toEqual({ udid: "U", deviceName: "iPhone", kind: "ios" });
    // AmA never invents without streamUrl + dimensions
    expect(buildSimulatorAttachmentAmA({ udid: "U", deviceName: "n" })).toBeNull();
    expect(
      buildSimulatorAttachmentAmA({
        udid: "U",
        deviceName: "n",
        streamUrl: "ws://127.0.0.1:1",
        pointWidth: 390,
        pointHeight: 844,
      }),
    ).toMatchObject({
      udid: "U",
      streamUrl: "ws://127.0.0.1:1",
      pointWidth: 390,
      pointHeight: 844,
    });
  });
});
