/**
 * Official residual NoA() host adapter factory for computer-use-mcp.
 * Win: createWin32Executor + ensureOsPermissions always granted.
 * Darwin: not wired here yet (still needs claude-swift computer_use.node).
 */
import { nativeImage } from "electron";
import type {
  ComputerExecutor,
  ComputerUseHostAdapter,
  CuSubGates,
} from "@ant/computer-use-mcp";
import { ALL_SUB_GATES_ON } from "@ant/computer-use-mcp";
import {
  createWin32Executor,
  getWin32HostBundleId,
  warmWin32InstalledAppsCache,
} from "./createWin32Executor";
import { maybeGetClaudeNative } from "./claudeNative";

export type ComputerUseHostAdapterOptions = {
  /** Official chicagoEnabled kill-switch inverse: isDisabled = !chicagoEnabled. */
  isDisabled: () => boolean;
  getAutoUnhideEnabled?: () => boolean;
  getSubGates?: () => CuSubGates;
  getMouseAnimationEnabled?: () => boolean;
  getHideBeforeActionEnabled?: () => boolean;
  logger?: {
    debug: (...args: unknown[]) => void;
    info?: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
};

let cached: ComputerUseHostAdapter | undefined;

function defaultLogger() {
  return {
    debug: (...args: unknown[]) => console.debug("[computer-use]", ...args),
    info: (...args: unknown[]) => console.info("[computer-use]", ...args),
    warn: (...args: unknown[]) => console.warn("[computer-use]", ...args),
    error: (...args: unknown[]) => console.error("[computer-use]", ...args),
  };
}

function buildWinExecutor(
  options: ComputerUseHostAdapterOptions,
): ComputerExecutor {
  return createWin32Executor({
    getMouseAnimationEnabled:
      options.getMouseAnimationEnabled ?? (() => true),
    getHideBeforeActionEnabled:
      options.getHideBeforeActionEnabled ?? (() => true),
    hostBundleId: getWin32HostBundleId(),
  });
}

/**
 * Residual NoA — process-lifetime ComputerUseHostAdapter singleton.
 * Returns null when platform/native cannot host CU actions.
 */
export function getComputerUseHostAdapter(
  options: ComputerUseHostAdapterOptions,
): ComputerUseHostAdapter | null {
  if (cached) {
    // Keep live preference getters by rebuilding thin wrappers would require
    // mutating options; residual freezes gates via closures on first build.
    // Product re-reads isDisabled/getSubGates from options each call below.
  }

  if (process.platform !== "win32" && process.platform !== "darwin") {
    return null;
  }

  if (process.platform === "win32" && !maybeGetClaudeNative()) {
    console.warn(
      "[computer-use] Win PE @ant/claude-native unavailable — action executor not created",
    );
    return null;
  }

  if (process.platform === "darwin") {
    // Darwin residual uses @ant/claude-swift computerUse — not PE on this host.
    console.warn(
      "[computer-use] createDarwinExecutor residual not wired in product host-loop yet",
    );
    return null;
  }

  if (cached) return cached;

  const logger = options.logger ?? defaultLogger();
  warmWin32InstalledAppsCache();

  const executor = buildWinExecutor(options);

  cached = {
    serverName: "computer-use",
    logger: {
      debug: (message: string, detail?: unknown) =>
        logger.debug(message, detail),
      info: (message: string, detail?: unknown) =>
        (logger.info ?? logger.debug)(message, detail),
      warn: (message: string, detail?: unknown) =>
        logger.warn(message, detail),
      error: (message: string, detail?: unknown) =>
        logger.error(message, detail),
      silly: (message: string, detail?: unknown) =>
        logger.debug(message, detail),
    },
    executor,
    async ensureOsPermissions() {
      // Residual BMA: win32 always granted (no TCC).
      if (process.platform === "win32") return { granted: true as const };
      return { granted: false, accessibility: false, screenRecording: false };
    },
    // Live getters — re-read prefs/gates every call (residual NoA).
    isDisabled: () => options.isDisabled(),
    getAutoUnhideEnabled: () => options.getAutoUnhideEnabled?.() ?? true,
    getSubGates: () => options.getSubGates?.() ?? ALL_SUB_GATES_ON,
    cropRawPatch(jpegBase64, rect) {
      try {
        const image = nativeImage.createFromBuffer(
          Buffer.from(jpegBase64, "base64"),
        );
        if (image.isEmpty()) return null;
        const cropped = image.crop(rect);
        return cropped.isEmpty() ? null : cropped.toBitmap();
      } catch {
        return null;
      }
    },
  };

  return cached;
}

export function resetComputerUseHostAdapterForTests(): void {
  cached = undefined;
}

export function getOfficialScreenshotFiltering(
  platform: NodeJS.Platform = process.platform,
): "native" | "mask" | "none" {
  // Residual I9e / E9e
  if (platform === "darwin") return "native";
  if (platform === "win32") return "mask";
  return "none";
}
