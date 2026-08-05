/**
 * Residual: maybeGetClaudeNative / Jn() for Win32 Computer Use.
 * Delegates to settings/claudeNativeAddon (original-runtime PE load) so
 * createWin32Executor and createDarwinExecutor share one loader.
 */
import {
  maybeGetClaudeNative as loadClaudeNativeAddon,
  requireClaudeNative as requireClaudeNativeAddon,
  resetClaudeNativeAddonForTests,
  type ClaudeNativeAddon,
} from "../../settings/claudeNativeAddon";

/**
 * Win PE binding surface used by createWin32Executor / win32Capture / win32Input.
 * Extends the shared addon with required CU members (callers still null-check).
 */
export type ClaudeNativeModule = ClaudeNativeAddon & {
  key: (key: string, action: "press" | "release") => Promise<void> | void;
  keys: (keys: string[]) => Promise<void> | void;
  typeText: (text: string) => Promise<void> | void;
  typeTextPaced?: (text: string, opts?: unknown) => Promise<void> | void;
  moveMouse: (
    x: number,
    y: number,
    animate?: boolean,
  ) => Promise<void> | void;
  mouseButton: (
    button: string,
    action: "press" | "release" | "click",
    count?: number,
  ) => Promise<void> | void;
  mouseScroll: (
    amount: number,
    axis: "vertical" | "horizontal",
  ) => Promise<void> | void;
  mouseLocation: () =>
    | Promise<{ x: number; y: number }>
    | { x: number; y: number };
  cuHideApps: (bundleIds: string[]) => Promise<string[]> | string[];
  cuUnhideApps: (bundleIds: string[]) => Promise<void> | void;
  cuGetAppIcon: (pathOrBundle: string) => string | null | undefined;
  cuListDisplays: () => Array<{
    displayId: number;
    width: number;
    height: number;
    scaleFactor: number;
    originX: number;
    originY: number;
    isPrimary?: boolean;
    label?: string;
  }>;
  cuAppUnderPoint: (
    x: number,
    y: number,
  ) =>
    | Promise<{ bundleId: string; displayName: string } | null>
    | { bundleId: string; displayName: string }
    | null;
  cuDisplayForPid: (pid: number) => number | null;
  cuGetOwnBundleId: () => string | null | undefined;
  cuListRunningApps: () => Array<{
    bundleId: string;
    displayName: string;
    pid?: number;
  }>;
  cuExcludedWindowRects: (
    bundleIds: string[],
  ) => Array<{ x: number; y: number; width: number; height: number }>;
  cuListInstalledApps: () => Array<{
    displayName?: string;
    aumid?: string;
    targetPath?: string;
  }>;
};

function isWinPeSurface(mod: ClaudeNativeAddon | null): mod is ClaudeNativeModule {
  if (!mod) return false;
  // Real PE residual exposes CU list APIs; Darwin PE may only have keys/mouse.
  return (
    typeof mod.cuListDisplays === "function" ||
    typeof mod.cuListRunningApps === "function" ||
    typeof mod.moveMouse === "function"
  );
}

export function maybeGetClaudeNative(): ClaudeNativeModule | null {
  const mod = loadClaudeNativeAddon();
  if (!isWinPeSurface(mod)) return null;
  return mod;
}

export function requireClaudeNative(): ClaudeNativeModule {
  const native = maybeGetClaudeNative();
  if (!native) {
    // Prefer shared Su residual message when PE missing entirely.
    requireClaudeNativeAddon();
    throw new Error(
      "claude-native PE CU surface unavailable. Computer control is not available.",
    );
  }
  return native;
}

export function resetClaudeNativeCacheForTests(): void {
  resetClaudeNativeAddonForTests();
}
