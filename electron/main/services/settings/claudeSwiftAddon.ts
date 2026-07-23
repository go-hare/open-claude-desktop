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

export type ClaudeSwiftAddon = EventEmitter & {
  quickAccess?: {
    overlay?: ClaudeSwiftQuickAccessOverlay;
    dictation?: {
      setLanguage?: (lang: string) => void;
    };
  };
  /** Official PwA residual target. */
  api?: {
    setCredentials?: (baseUrl: string, cookieHeader: string, orgUuid: string) => void;
  };
  wakeScheduler?: unknown;
  midnightOwl?: { setEnabled?: (enabled: boolean) => void };
  hotkey?: unknown;
  vm?: unknown;
};

let cached: ClaudeSwiftAddon | null | undefined;
let loadPromise: Promise<ClaudeSwiftAddon | null> | null = null;

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
 * Load official SwiftAddon (nr). Returns null on non-darwin / missing binary / load failure.
 * Caches success and failure for the process lifetime unless forceReload.
 */
export async function loadClaudeSwiftAddon(
  options: { forceReload?: boolean } = {},
): Promise<ClaudeSwiftAddon | null> {
  if (!options.forceReload && cached !== undefined) return cached;
  if (!options.forceReload && loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (process.platform !== "darwin") {
      cached = null;
      return null;
    }
    try {
      configureOriginalRuntimeModules();
      let mod: unknown = null;
      for (const root of runtimeRoots()) {
        const pkgJson = path.join(root, "@ant/claude-swift", "package.json");
        if (!fs.existsSync(pkgJson)) continue;
        const nodePath = path.join(root, "@ant/claude-swift", "build", "Release", "swift_addon.node");
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
          const fallbackRequire = createRequire(path.join(app.getAppPath(), "package.json"));
          mod = fallbackRequire("@ant/claude-swift");
        } catch (error) {
          console.warn("[claudeSwiftAddon] fallback @ant/claude-swift failed", error);
          cached = null;
          return null;
        }
      }
      // CJS: module.exports = new SwiftAddon(); ESM interop may wrap .default
      const candidate =
        mod && typeof mod === "object" && "default" in (mod as object) && (mod as { default: unknown }).default
          ? (mod as { default: unknown }).default
          : mod;
      if (!isUsableAddon(candidate)) {
        console.warn("[claudeSwiftAddon] loaded module missing quickAccess.overlay.toggle");
        cached = null;
        return null;
      }
      cached = candidate;
      return candidate;
    } catch (error) {
      console.warn("[claudeSwiftAddon] load failed", error);
      cached = null;
      return null;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

export function getClaudeSwiftAddonCached(): ClaudeSwiftAddon | null {
  return cached ?? null;
}

/** Test helper — clear process cache. */
export function resetClaudeSwiftAddonForTests(): void {
  cached = undefined;
  loadPromise = null;
}

/** Official i2A residual: nr !== null && feature supported (caller supplies feature). */
export function isNativeQuickEntryRuntimeReady(featureSupported: boolean): boolean {
  return Boolean(cached && featureSupported);
}
