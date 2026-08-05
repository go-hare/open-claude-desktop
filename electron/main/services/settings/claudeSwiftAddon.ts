/**
 * Official Y9i residual load path for `@ant/claude-swift` full SwiftAddon (nr):
 *   nr = (await import("@ant/claude-swift")).default
 *   nr.quickAccess.overlay.toggle / setLoggedIn / setRecentChats / setActiveChatId
 *   nr.api.setCredentials(baseUrl, cookieHeader, orgUuid)
 *   nr.quickAccess.dictation.setLanguage
 *   nr.on("quickEntrySubmitted" | "navigateToChat" | ...)
 *
 * Product residual: load from original-runtime-node_modules (same roots as coworkClaudeVm).
 * Never invents overlay success without a real loaded module + quickAccess.overlay.
 */
import { app } from "electron";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { configureOriginalRuntimeModules } from "../originalRuntime/originalRuntimeModules";

/** Official AUe residual: { chatId, chatName } — not uuid/name. */
export type ClaudeSwiftRecentChatItem = {
  chatId: string;
  chatName: string;
};

export type ClaudeSwiftQuickAccessOverlay = {
  toggle: () => void | Promise<void>;
  setLoggedIn?: (loggedIn: boolean) => void;
  setRecentChats?: (chats: ClaudeSwiftRecentChatItem[]) => void;
  setActiveChatId?: (chatId: string | null) => void;
};

/**
 * Official fE residual surface: `nr.computerUse` from computer_use.node.
 * Separate from quickAccess.overlay — CU must load even when overlay gate fails.
 */
export type ClaudeSwiftComputerUse = {
  apps?: {
    prepareDisplay?: (
      allowlist: string[],
      hostBundleId: string,
      displayId?: number,
    ) => Promise<{ hidden: string[]; activated?: string }>;
    previewHideSet?: (
      allowlist: string[],
      displayId?: number,
    ) => Promise<Array<{ bundleId: string; displayName: string }>>;
    findWindowDisplays?: (
      bundleIds: string[],
    ) => Promise<Array<{ bundleId: string; displayIds: number[] }>>;
    appUnderPoint?: (
      x: number,
      y: number,
    ) => Promise<{ bundleId: string; displayName: string } | null>;
    listInstalled?: () => Promise<
      Array<{
        bundleId: string;
        displayName: string;
        path: string;
        iconDataUrl?: string;
      }>
    >;
    listRunning?: () => Promise<
      Array<{ bundleId: string; displayName: string; pid?: number }>
    >;
    open?: (bundleId: string) => Promise<void> | void;
    unhide?: (bundleIds: string[]) => Promise<void> | void;
    iconDataUrl?: (path: string) => string | null | undefined;
  };
  display?: {
    getSize?: (displayId?: number) => {
      displayId: number;
      width: number;
      height: number;
      scaleFactor: number;
      originX: number;
      originY: number;
      isPrimary?: boolean;
      label?: string;
    };
    listAll?: () => Array<{
      displayId: number;
      width: number;
      height: number;
      scaleFactor: number;
      originX: number;
      originY: number;
      isPrimary?: boolean;
      label?: string;
    }>;
  };
  screenshot?: {
    captureExcluding?: (
      allowedBundleIds: string[],
      quality: number,
      width: number,
      height: number,
      displayId?: number,
    ) => Promise<{
      base64: string;
      width: number;
      height: number;
      displayWidth: number;
      displayHeight: number;
      originX: number;
      originY: number;
      displayId?: number;
    }>;
    captureRegion?: (
      allowedBundleIds: string[],
      x: number,
      y: number,
      w: number,
      h: number,
      outW: number,
      outH: number,
      quality: number,
      displayId?: number,
    ) => Promise<{ base64: string; width: number; height: number }>;
  };
  resolvePrepareCapture?: (
    allowedBundleIds: string[],
    hostBundleId: string,
    quality: number,
    width: number,
    height: number,
    preferredDisplayId?: number,
    autoResolve?: boolean,
    doHide?: boolean,
  ) => Promise<{
    base64: string;
    width: number;
    height: number;
    displayWidth: number;
    displayHeight: number;
    originX: number;
    originY: number;
    displayId: number;
    hidden: string[];
    activated?: string;
    captureError?: string;
  }>;
  tcc?: {
    checkAccessibility?: () => boolean;
    checkScreenRecording?: () => boolean;
  };
};

export type ClaudeSwiftAddon = EventEmitter & {
  quickAccess?: {
    overlay?: ClaudeSwiftQuickAccessOverlay;
    /**
     * Official nr.quickAccess.dictation residual:
     *   setLanguage(code) / show(mode) / toggle(mode) / stop()
     * mode: "caps-lock" | "custom" (uit residual).
     */
    dictation?: {
      setLanguage?: (lang: string) => void;
      show?: (mode: "caps-lock" | "custom" | string) => void | Promise<void>;
      toggle?: (mode: "caps-lock" | "custom" | string) => void | Promise<void>;
      stop?: () => void | Promise<void>;
    };
  };
  /** Official PwA residual target. */
  api?: {
    setCredentials?: (baseUrl: string, cookieHeader: string, orgUuid: string) => void;
  };
  /**
   * Official hkA residual: `(nr?.wakeScheduler) ?? null`.
   * Native handle for pvi.getApi / scheduleWake / install (NAPIBindings+WakeScheduler).
   * Product types the residual surface; does not invent methods if native omits them.
   */
  wakeScheduler?: {
    status?: () => Promise<string> | string;
    requiresSetup?: boolean;
    approvedThisCycle?: () => boolean;
    openSettings?: () => void;
    install?: () => Promise<{ success: boolean; error?: string }>;
    uninstall?: () => Promise<void> | void;
    scheduleWake?: (when: unknown) => Promise<number> | number;
    cancelWakes?: () => Promise<number> | number;
    /** Official bridge PSS residual when native exposes prevent-sleep asserts. */
    createPreventSystemSleepAssertion?: (reason: string) => number;
    releaseAssertion?: (id: number) => void;
  };
  midnightOwl?: { setEnabled?: (enabled: boolean) => void };
  hotkey?: unknown;
  vm?: unknown;
  /**
   * Official fE residual: computer_use.node namespace (optional — soft-fail load).
   */
  computerUse?: ClaudeSwiftComputerUse;
};

let cached: ClaudeSwiftAddon | null | undefined;
let loadPromise: Promise<ClaudeSwiftAddon | null> | null = null;
/** Official fE residual cache — computerUse namespace only (no overlay gate). */
let computerUseCached: ClaudeSwiftComputerUse | null | undefined;
let computerUseLoadPromise: Promise<ClaudeSwiftComputerUse | null> | null = null;
/** Raw loaded SwiftAddon (may lack overlay) — shared by CU load path. */
let rawAddonCached: ClaudeSwiftAddon | null | undefined;

function runtimeRoots(): string[] {
  return [
    process.env.CLAUDE_ORIGINAL_RUNTIME_NODE_MODULES,
    process.resourcesPath
      ? path.join(process.resourcesPath, "original-runtime-node_modules", "node_modules")
      : null,
    app.isPackaged
      ? null
      : path.join(app.getAppPath(), "resources", "original-runtime-node_modules", "node_modules"),
    path.join(app.getAppPath(), "node_modules"),
    path.resolve(process.cwd(), "resources/original-runtime-node_modules/node_modules"),
  ].filter((v): v is string => Boolean(v));
}

function isUsableAddon(mod: unknown): mod is ClaudeSwiftAddon {
  if (!mod || typeof mod !== "object") return false;
  const overlay = (mod as ClaudeSwiftAddon).quickAccess?.overlay;
  return Boolean(overlay && typeof overlay.toggle === "function");
}

/**
 * Load raw SwiftAddon without overlay usability gate.
 * Used by both quickAccess path and official fE computerUse residual.
 */
async function loadRawClaudeSwiftAddon(
  options: { forceReload?: boolean } = {},
): Promise<ClaudeSwiftAddon | null> {
  if (!options.forceReload && rawAddonCached !== undefined) return rawAddonCached;
  if (process.platform !== "darwin") {
    rawAddonCached = null;
    return null;
  }
  try {
    configureOriginalRuntimeModules();
    let mod: unknown = null;
    for (const root of runtimeRoots()) {
      const pkgJson = path.join(root, "@ant/claude-swift", "package.json");
      if (!fs.existsSync(pkgJson)) continue;
      const nodePath = path.join(
        root,
        "@ant/claude-swift",
        "build",
        "Release",
        "swift_addon.node",
      );
      if (!fs.existsSync(nodePath)) {
        console.warn("[claudeSwiftAddon] swift_addon.node missing under", root);
        continue;
      }
      try {
        const runtimeRequire = createRequire(pkgJson);
        mod = runtimeRequire(path.dirname(pkgJson));
        break;
      } catch (error) {
        console.warn("[claudeSwiftAddon] require failed", root, error);
      }
    }
    if (!mod) {
      try {
        const fallbackRequire = createRequire(
          path.join(app.getAppPath(), "package.json"),
        );
        mod = fallbackRequire("@ant/claude-swift");
      } catch (error) {
        console.warn("[claudeSwiftAddon] fallback @ant/claude-swift failed", error);
        rawAddonCached = null;
        return null;
      }
    }
    // CJS: module.exports = new SwiftAddon(); ESM interop may wrap .default
    const candidate =
      mod &&
      typeof mod === "object" &&
      "default" in (mod as object) &&
      (mod as { default: unknown }).default
        ? (mod as { default: unknown }).default
        : mod;
    if (!candidate || typeof candidate !== "object") {
      rawAddonCached = null;
      return null;
    }
    rawAddonCached = candidate as ClaudeSwiftAddon;
    return rawAddonCached;
  } catch (error) {
    console.warn("[claudeSwiftAddon] load failed", error);
    rawAddonCached = null;
    return null;
  }
}

/**
 * Load official SwiftAddon (nr). Returns null on non-darwin / missing binary / load failure.
 * Caches success and failure for the process lifetime unless forceReload.
 * Requires quickAccess.overlay.toggle (Y9i residual).
 */
export async function loadClaudeSwiftAddon(
  options: { forceReload?: boolean } = {},
): Promise<ClaudeSwiftAddon | null> {
  if (!options.forceReload && cached !== undefined) return cached;
  if (!options.forceReload && loadPromise) return loadPromise;

  loadPromise = (async () => {
    const candidate = await loadRawClaudeSwiftAddon(options);
    if (!isUsableAddon(candidate)) {
      if (candidate) {
        console.warn(
          "[claudeSwiftAddon] loaded module missing quickAccess.overlay.toggle",
        );
      }
      cached = null;
      return null;
    }
    cached = candidate;
    return candidate;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

/**
 * Official fE residual: load `nr.computerUse` from computer_use.node.
 * Does NOT require quickAccess.overlay — CU and overlay are independent soft-fail loads.
 * Throws nothing; returns null when namespace/binary missing.
 */
export async function loadClaudeSwiftComputerUse(
  options: { forceReload?: boolean } = {},
): Promise<ClaudeSwiftComputerUse | null> {
  if (!options.forceReload && computerUseCached !== undefined) {
    return computerUseCached;
  }
  if (!options.forceReload && computerUseLoadPromise) {
    return computerUseLoadPromise;
  }

  computerUseLoadPromise = (async () => {
    const addon = await loadRawClaudeSwiftAddon(options);
    const cu = addon?.computerUse;
    if (!cu || typeof cu !== "object") {
      console.warn(
        "[claudeSwiftAddon] computerUse namespace missing — computer_use.node not built?",
      );
      computerUseCached = null;
      return null;
    }
    computerUseCached = cu;
    return cu;
  })();

  try {
    return await computerUseLoadPromise;
  } finally {
    computerUseLoadPromise = null;
  }
}

export function getClaudeSwiftAddonCached(): ClaudeSwiftAddon | null {
  return cached ?? null;
}

/** Test helper — clear process cache. */
export function resetClaudeSwiftAddonForTests(): void {
  cached = undefined;
  loadPromise = null;
  computerUseCached = undefined;
  computerUseLoadPromise = null;
  rawAddonCached = undefined;
}

/** Official i2A residual: nr !== null && feature supported (caller supplies feature). */
export function isNativeQuickEntryRuntimeReady(featureSupported: boolean): boolean {
  return Boolean(cached && featureSupported);
}
