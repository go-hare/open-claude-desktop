import { describe, expect, it } from "vitest";
import {
  isNativeQuickEntryFeatureSupported,
  resolveMacOsMajor,
  resolveNativeQuickEntryFeature,
} from "./nativeQuickEntryFeature";

describe("nativeQuickEntryFeature Dvi residual", () => {
  it("unavailable off darwin", () => {
    expect(resolveNativeQuickEntryFeature({ platform: "win32", macOsMajor: 26 })).toEqual({
      status: "unavailable",
    });
    expect(resolveNativeQuickEntryFeature({ platform: "linux", macOsMajor: 26 })).toEqual({
      status: "unavailable",
    });
  });

  it("unsupported below macOS 13", () => {
    const result = resolveNativeQuickEntryFeature({ platform: "darwin", macOsMajor: 12 });
    expect(result.status).toBe("unsupported");
    expect(result.unsupportedCode).toBe("unknown");
  });

  it("supported on darwin macOS 13+", () => {
    expect(resolveNativeQuickEntryFeature({ platform: "darwin", macOsMajor: 13 })).toEqual({
      status: "supported",
    });
    expect(resolveNativeQuickEntryFeature({ platform: "darwin", macOsMajor: 26 })).toEqual({
      status: "supported",
    });
  });

  it("parses major from system version string", () => {
    expect(resolveMacOsMajor("26.5.0")).toBe(26);
    expect(resolveMacOsMajor("13.0")).toBe(13);
    expect(resolveMacOsMajor("")).toBe(0);
  });

  it("t2A residual helper", () => {
    expect(isNativeQuickEntryFeatureSupported({ platform: "darwin", macOsMajor: 14 })).toBe(true);
    expect(isNativeQuickEntryFeatureSupported({ platform: "win32", macOsMajor: 14 })).toBe(false);
  });
});
