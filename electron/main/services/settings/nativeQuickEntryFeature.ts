/**
 * Official pw().nativeQuickEntry residual (app.asar `Dvi`):
 *
 *   function Dvi(){
 *     return process.platform!=="darwin"
 *       ? {status:"unavailable"}
 *       : M1().major<13
 *         ? {status:"unsupported", reason: macOS 13+, unsupportedCode:"unknown"}
 *         : {status:"supported"}
 *   }
 *
 * Feature flag is OS/platform only — does not require Swift already loaded.
 * Runtime gate for overlay is still i2A: nr!==null && t2A().
 */

export type NativeFeatureStatus = {
  status: "supported" | "unavailable" | "unsupported";
  reason?: string;
  unsupportedCode?: string;
};

export function resolveMacOsMajor(release: string = process.getSystemVersion?.() ?? ""): number {
  // process.getSystemVersion() → "26.5.0"; process.platform darwin only.
  const major = Number.parseInt(String(release).split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : 0;
}

/** Official Dvi residual. */
export function resolveNativeQuickEntryFeature(options: {
  platform?: NodeJS.Platform;
  macOsMajor?: number;
} = {}): NativeFeatureStatus {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return { status: "unavailable" };
  }
  const major =
    options.macOsMajor ??
    resolveMacOsMajor(
      typeof process.getSystemVersion === "function" ? process.getSystemVersion() : "",
    );
  if (major < 13) {
    return {
      status: "unsupported",
      reason: "This feature requires macOS 13.0 or higher",
      unsupportedCode: "unknown",
    };
  }
  return { status: "supported" };
}

/** Official t2A residual: pw().nativeQuickEntry.status === "supported". */
export function isNativeQuickEntryFeatureSupported(options?: {
  platform?: NodeJS.Platform;
  macOsMajor?: number;
}): boolean {
  return resolveNativeQuickEntryFeature(options).status === "supported";
}
