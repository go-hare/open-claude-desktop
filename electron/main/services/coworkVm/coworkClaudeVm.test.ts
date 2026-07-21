import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCoworkClaudeVmService,
  isCoworkVmBundleReady,
  resolveCoworkSmolBinPath,
  resolveCoworkVmArch,
  resolveCoworkVmBundlePath,
  resetCoworkClaudeVmServiceForTests,
  type CoworkSwiftVmApi,
} from "./coworkClaudeVm";

afterEach(() => {
  resetCoworkClaudeVmServiceForTests();
});

describe("coworkClaudeVm pure path helpers", () => {
  it("maps arch and bundle path like official RHA+aGi", () => {
    expect(resolveCoworkVmArch("arm64")).toBe("arm64");
    expect(resolveCoworkVmArch("x64")).toBe("x64");
    expect(resolveCoworkVmBundlePath("/tmp/ud")).toBe(
      path.join("/tmp/ud", "vm_bundles", "claudevm.bundle"),
    );
  });

  it("resolves smol-bin from Resources", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-smol-"));
    try {
      const img = path.join(root, "smol-bin.arm64.img");
      fs.writeFileSync(img, "x");
      expect(resolveCoworkSmolBinPath(root, "arm64", "darwin")).toBe(img);
      expect(resolveCoworkSmolBinPath(root, "x64", "darwin")).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects rootfs bundle readiness (legacy bare + exact origin sha)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-bundle-"));
    try {
      expect(isCoworkVmBundleReady(root)).toBe(false);
      fs.writeFileSync(path.join(root, "rootfs.img"), "img");
      // Legacy bare rootfs without origin: accepted residual.
      expect(isCoworkVmBundleReady(root)).toBe(true);
      // Stale origin sha must NOT be ready (official JZe version_mismatch).
      fs.writeFileSync(path.join(root, ".rootfs.img.origin"), "stale-sha-not-Hn");
      expect(isCoworkVmBundleReady(root)).toBe(false);
      fs.writeFileSync(
        path.join(root, ".rootfs.img.origin"),
        "5680b11bcdab215cccf07e0c0bd1bd9213b0c25d",
      );
      expect(isCoworkVmBundleReady(root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("createCoworkClaudeVmService", () => {
  it("reports missing bundle without inventing running", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-ud-"));
    const resources = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-res-"));
    const startVM = vi.fn();
    const vm: CoworkSwiftVmApi = {
      startVM,
      isRunning: async () => false,
      isGuestConnected: async () => false,
    };
    try {
      const service = createCoworkClaudeVmService({
        platform: "darwin",
        arch: "arm64",
        getUserDataPath: () => userData,
        getResourcesPath: () => resources,
        loadSwiftVm: async () => vm,
        log: () => {},
      });
      const snap = await service.startVM();
      expect(snap.bundleReady).toBe(false);
      expect(snap.runningStatus).toBe("failed");
      expect(snap.error).toMatch(/rootfs/i);
      expect(startVM).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(resources, { recursive: true, force: true });
    }
  });

  it("starts swift VM when rootfs present and waits for guest", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-ud-"));
    const resources = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-res-"));
    const bundle = resolveCoworkVmBundlePath(userData);
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(path.join(bundle, "rootfs.img"), "img");
    fs.writeFileSync(path.join(resources, "smol-bin.arm64.img"), "smol");

    let connected = false;
    const startVM = vi.fn(async () => {
      connected = true;
    });
    const vm: CoworkSwiftVmApi = {
      startVM,
      isRunning: async () => connected,
      isGuestConnected: async () => connected,
    };
    try {
      const service = createCoworkClaudeVmService({
        platform: "darwin",
        arch: "arm64",
        getUserDataPath: () => userData,
        getResourcesPath: () => resources,
        loadSwiftVm: async () => vm,
        log: () => {},
      });
      const snap = await service.startVM({ memoryGB: 4 });
      expect(startVM).toHaveBeenCalled();
      expect(snap.runningStatus).toBe("running");
      expect(snap.connected).toBe(true);
      expect(snap.mode).toBe("vm");
      expect(snap.smolBinPath).toContain("smol-bin.arm64.img");
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(resources, { recursive: true, force: true });
    }
  });

  it("does not invent VM on non-darwin", async () => {
    const service = createCoworkClaudeVmService({
      platform: "linux",
      loadSwiftVm: async () => null,
      getUserDataPath: () => "/tmp/x",
      getResourcesPath: () => "/tmp/y",
      log: () => {},
    });
    const snap = await service.startVM();
    expect(snap.runningStatus).toBe("offline");
    expect(snap.error).toMatch(/not implemented/i);
  });
});
