import { describe, expect, it, vi } from "vitest";
import {
  createWin32Executor,
  cropRawPatchFromJpeg,
  DEFAULT_CU_SUB_GATES,
  resolveComputerUseHostBundleId,
} from "./computerUseDarwinExecutor";

describe("computerUseDarwinExecutor residual helpers", () => {
  it("DEFAULT_CU_SUB_GATES matches official CTi residual", () => {
    expect(DEFAULT_CU_SUB_GATES).toEqual({
      pixelValidation: false,
      clipboardPasteMultiline: true,
      mouseAnimation: true,
      hideBeforeAction: true,
      autoTargetDisplay: true,
      clipboardGuard: true,
    });
  });

  it("resolveComputerUseHostBundleId returns string (oFi residual)", () => {
    const id = resolveComputerUseHostBundleId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("cropRawPatchFromJpeg returns null on garbage (no invent)", () => {
    expect(
      cropRawPatchFromJpeg("not-valid-base64!!!", {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    ).toBeNull();
  });

  it("createWin32Executor throws platform guard residual off win32 (official r5e)", () => {
    // This suite runs on darwin/linux CI; official r5e throws when not win32.
    if (process.platform === "win32") {
      // On win32 host, construction succeeds with r5e residual body.
      expect(() =>
        createWin32Executor({
          getMouseAnimationEnabled: () => true,
          getHideBeforeActionEnabled: () => true,
          hostBundleId: "test.host",
        }),
      ).not.toThrow();
      return;
    }
    expect(() =>
      createWin32Executor({
        getMouseAnimationEnabled: () => true,
        getHideBeforeActionEnabled: () => true,
        hostBundleId: "test.host",
      }),
    ).toThrow(/Use createDarwinExecutor on macOS|createWin32Executor called/i);
  });

  it("createWin32Executor residual body exposes win32 capabilities when constructed", () => {
    if (process.platform !== "win32") {
      // Platform guard is the residual body off-win32; skip body assert.
      expect(process.platform).not.toBe("win32");
      return;
    }
    const ex = createWin32Executor({
      getMouseAnimationEnabled: () => false,
      getHideBeforeActionEnabled: () => false,
      hostBundleId: "test.host",
    });
    expect(ex.capabilities.platform).toBe("win32");
    // Official QZe residual — win32 mask capture (desktopCapturer + excluded rects).
    expect(ex.capabilities.screenshotFiltering).toBe("mask");
  });
});
