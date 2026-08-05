/**
 * Official residual createWin32Executor (XZe) + AUMID helpers.
 * Capabilities: screenshotFiltering "mask", platform "win32".
 */
import { BrowserWindow, shell } from "electron";
import type { ComputerExecutor } from "@ant/computer-use-mcp";
import {
  maybeGetClaudeNative,
  requireClaudeNative,
} from "./claudeNative";
import {
  captureDisplayScreenshot,
  captureZoomRegion,
  listDisplayGeometries,
  mapNativeDisplayIdToElectron,
} from "./win32Capture";
import { createWin32InputSurface } from "./win32Input";

const WINDIR = `${process.env.WINDIR ?? "C:\\Windows"}\\`.toLowerCase();
const EXPLORER_EXE = `${WINDIR}explorer.exe`;
const EXPLORER_AUMID = "Microsoft.Windows.Explorer";
const AUMID_CACHE_TTL_MS = 300 * 1000;
const AUMID_FAIL_COOLDOWN_MS = 60 * 1000;

const SYSTEM_PROCESS_STEMS = new Set([
  "dwm",
  "winlogon",
  "csrss",
  "smss",
  "wininit",
  "services",
  "lsass",
  "svchost",
  "spoolsv",
  "taskhost",
  "taskhostw",
  "conhost",
  "audiodg",
  "fontdrvhost",
  "sihost",
  "runtimebroker",
  "searchui",
  "searchapp",
  "searchhost",
  "startmenuexperiencehost",
  "shellexperiencehost",
  "applicationframehost",
]);

type AumidCache = {
  byName: Map<string, string>;
  aumidByBundleId: Map<string, string>;
  installed: Array<{ bundleId: string; displayName: string; path: string }>;
  lastUpdated: number;
};

let aumidCache: AumidCache | null = null;
let aumidLoadPromise: Promise<void> | null = null;
let aumidFailAt = 0;
const hiddenDuringSession = new Set<string>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function asPromise<T>(value: T | Promise<T>): Promise<T> {
  return value;
}

function normalizeBundleId(
  aumid: string,
  targetPath: string | undefined,
): string {
  if (aumid === EXPLORER_AUMID) return EXPLORER_EXE;
  if (targetPath?.includes("\\")) return targetPath.toLowerCase();
  if (aumid.includes("\\")) return aumid.toLowerCase();
  return aumid;
}

function isSystemProcess(bundleId: string): boolean {
  const stem = bundleId
    .toLowerCase()
    .replace(/\.exe$/i, "")
    .split(/[\\/]/)
    .pop();
  return stem ? SYSTEM_PROCESS_STEMS.has(stem) : false;
}

function isHostBundle(bundleId: string, hostBundleId: string): boolean {
  return bundleId.toLowerCase() === hostBundleId.toLowerCase();
}

function buildAumidCache(
  rows: Array<{ displayName?: string; aumid?: string; targetPath?: string }>,
): AumidCache {
  const byName = new Map<string, string>();
  const aumidByBundleId = new Map<string, string>();
  const installed: AumidCache["installed"] = [];
  for (const row of rows) {
    const displayName = row.displayName;
    const aumid = row.aumid;
    if (!displayName || !aumid) continue;
    const bundleId = normalizeBundleId(aumid, row.targetPath);
    byName.set(displayName.toLowerCase(), bundleId);
    aumidByBundleId.set(bundleId, aumid);
    installed.push({
      bundleId,
      displayName,
      path: aumid,
    });
  }
  return {
    byName,
    aumidByBundleId,
    installed,
    lastUpdated: Date.now(),
  };
}

async function loadAumidCache(): Promise<AumidCache> {
  const native = maybeGetClaudeNative();
  if (!native?.cuListInstalledApps) {
    throw new Error("cuListInstalledApps not available in claude-native");
  }
  return buildAumidCache(native.cuListInstalledApps());
}

async function ensureAumidCache(): Promise<void> {
  const now = Date.now();
  if (aumidCache && now - aumidCache.lastUpdated < AUMID_CACHE_TTL_MS) return;
  if (now - aumidFailAt < AUMID_FAIL_COOLDOWN_MS) return;
  if (aumidLoadPromise) {
    try {
      await aumidLoadPromise;
    } catch {
      /* residual */
    }
    return;
  }
  aumidLoadPromise = (async () => {
    aumidCache = await loadAumidCache();
  })();
  try {
    await aumidLoadPromise;
  } catch (error) {
    aumidFailAt = Date.now();
    console.warn(
      "[computer-use] AUMID cache load failed — app enumeration degraded; core CU still functional.",
      error,
    );
  } finally {
    aumidLoadPromise = null;
  }
}

/** Residual FUi — warm AUMID cache once. */
export function warmWin32InstalledAppsCache(): void {
  void ensureAumidCache().catch((error) => {
    console.warn("[computer-use] AUMID cache warmup failed", error);
  });
}

/**
 * Residual _fA — bundle ids to mask (running apps not in allowlist, not host, not system).
 */
function deniedBundleIdsForMask(
  allowedBundleIds: string[],
  hostBundleId: string,
): string[] {
  const native = requireClaudeNative();
  const allowed = new Set(allowedBundleIds.map((id) => id.toLowerCase()));
  return native
    .cuListRunningApps()
    .map((app) => app.bundleId)
    .filter(
      (id) =>
        !allowed.has(id.toLowerCase()) &&
        !isHostBundle(id, hostBundleId) &&
        !isSystemProcess(id),
    );
}

function isAumid(value: string): boolean {
  return (
    /^[\w.-]+\.[\w.-]+_[\w]+(!.*)?$/.test(value) ||
    /^[\w.-]+_[\w]+$/.test(value)
  );
}

async function openAumid(aumid: string): Promise<void> {
  const err = await shell.openPath(`shell:AppsFolder\\${aumid}`);
  if (err) throw new Error(`Failed to launch ${aumid}: ${err}`);
}

function stripExe(name: string): string {
  return name.toLowerCase().replace(/\.exe$/i, "").trim();
}

function fuzzyAumid(
  byName: Map<string, string>,
  query: string,
): string | null {
  if (!query) return null;
  const exact = byName.get(query);
  if (exact) return exact;
  let best: { aumid: string; score: number } | undefined;
  for (const [name, aumid] of byName) {
    let score: number | undefined;
    if (name.includes(query)) score = 10_000 - name.length;
    else if (query.includes(name)) score = name.length;
    if (score !== undefined && (!best || score > best.score)) {
      best = { aumid, score };
    }
  }
  return best?.aumid ?? null;
}

export type CreateWin32ExecutorOptions = {
  getMouseAnimationEnabled: () => boolean;
  getHideBeforeActionEnabled: () => boolean;
  hostBundleId: string;
};

/**
 * Residual XZe — createWin32Executor.
 * Throws if called off win32 (callers must gate).
 */
export function createWin32Executor(
  options: CreateWin32ExecutorOptions,
): ComputerExecutor {
  if (process.platform !== "win32") {
    throw new Error(
      `createWin32Executor called on ${process.platform}. Use createDarwinExecutor on macOS.`,
    );
  }
  // Official r5e constructs even when PE is cold; call sites requireClaudeNative().
  // Host adapter (koA) still fails closed if construction throws for other reasons.

  const {
    getMouseAnimationEnabled,
    getHideBeforeActionEnabled,
    hostBundleId,
  } = options;
  const input = createWin32InputSurface({ getMouseAnimationEnabled });
  warmWin32InstalledAppsCache();

  const executor: ComputerExecutor = {
    capabilities: {
      // Official E9e residual — win32 mask filtering (not "none").
      screenshotFiltering: "mask",
      platform: "win32",
      hostBundleId,
    },

    async prepareForAction(allowlistBundleIds, _displayId?) {
      void _displayId;
      if (!getHideBeforeActionEnabled()) return [];
      const allow = new Set(allowlistBundleIds.map((id) => id.toLowerCase()));
      allow.add(hostBundleId.toLowerCase());
      const hidden = new Set<string>();
      try {
        const native = requireClaudeNative();
        const running = native.cuListRunningApps();
        const toHide: string[] = [];
        for (const app of running) {
          if (
            allow.has(app.bundleId.toLowerCase()) ||
            isSystemProcess(app.bundleId) ||
            isHostBundle(app.bundleId, hostBundleId)
          ) {
            continue;
          }
          toHide.push(app.bundleId);
        }
        if (toHide.length > 0) {
          const actuallyHidden = await asPromise(native.cuHideApps(toHide));
          for (const id of actuallyHidden) hiddenDuringSession.add(id);
          for (const id of toHide) {
            if (actuallyHidden.includes(id) || actuallyHidden.length > 0) {
              hidden.add(id);
            }
          }
          for (let i = 0; i < 5; i++) {
            const front = native.getFrontmostAppInfo?.();
            if (
              !front?.bundleId ||
              allow.has(front.bundleId.toLowerCase()) ||
              isSystemProcess(front.bundleId) ||
              isHostBundle(front.bundleId, hostBundleId)
            ) {
              break;
            }
            const more = await asPromise(native.cuHideApps([front.bundleId]));
            if (more.length === 0) break;
            for (const id of more) hiddenDuringSession.add(id);
            hidden.add(front.bundleId);
          }
        }
        const focused = BrowserWindow.getFocusedWindow();
        if (focused && !focused.isDestroyed()) {
          focused.blur();
          await delay(200);
        }
      } catch (error) {
        console.warn(
          "[computer-use] prepareForAction failed; continuing to action",
          error,
        );
      }
      return [...hidden];
    },

    async previewHideSet(allowlistBundleIds, _displayId?) {
      void _displayId;
      const allow = new Set(
        [...allowlistBundleIds, hostBundleId].map((id) => id.toLowerCase()),
      );
      return requireClaudeNative()
        .cuListRunningApps()
        .filter(
          (app) =>
            !allow.has(app.bundleId.toLowerCase()) &&
            !isSystemProcess(app.bundleId) &&
            !isHostBundle(app.bundleId, hostBundleId),
        )
        .map((app) => ({
          bundleId: app.bundleId,
          displayName: app.displayName,
        }));
    },

    async findWindowDisplays(bundleIds) {
      const native = requireClaudeNative();
      const running = native.cuListRunningApps();
      const out: Array<{ bundleId: string; displayIds: number[] }> = [];
      for (const bundleId of bundleIds) {
        const displayIds = new Set<number>();
        for (const app of running) {
          if (app.bundleId !== bundleId || app.pid == null) continue;
          const nativeDisplay = native.cuDisplayForPid(app.pid);
          if (nativeDisplay === null) continue;
          const electronId = mapNativeDisplayIdToElectron(nativeDisplay);
          if (electronId !== null) displayIds.add(electronId);
        }
        if (displayIds.size > 0) {
          out.push({ bundleId, displayIds: [...displayIds] });
        }
      }
      return out;
    },

    async getDisplaySize(displayId) {
      const all = listDisplayGeometries();
      const hit =
        all.find((d) => d.displayId === displayId) ??
        all.find((d) => d.isPrimary) ??
        all[0];
      if (!hit) throw new Error("No displays enumerated");
      return hit;
    },

    async listDisplays() {
      return listDisplayGeometries();
    },

    async screenshot(opts) {
      return captureDisplayScreenshot(
        opts.displayId,
        deniedBundleIdsForMask(opts.allowedBundleIds, hostBundleId),
      );
    },

    async resolvePrepareCapture(opts) {
      let hidden: string[] = [];
      if (opts.doHide ?? true) {
        hidden = await executor.prepareForAction(
          opts.allowedBundleIds,
          opts.preferredDisplayId,
        );
      }
      const preferred = opts.preferredDisplayId;
      try {
        const shot = await captureDisplayScreenshot(
          preferred,
          deniedBundleIdsForMask(opts.allowedBundleIds, hostBundleId),
        );
        return {
          ...shot,
          displayId: shot.displayId,
          hidden,
          activated: undefined,
        };
      } catch (error) {
        return {
          base64: "",
          width: 0,
          height: 0,
          displayWidth: 0,
          displayHeight: 0,
          displayId: preferred ?? 0,
          originX: 0,
          originY: 0,
          hidden,
          activated: undefined,
          captureError:
            error instanceof Error
              ? error.message
              : "Screenshot capture failed",
        };
      }
    },

    async zoom(regionLogical, allowedBundleIds, displayId) {
      return captureZoomRegion(
        regionLogical,
        displayId,
        deniedBundleIdsForMask(allowedBundleIds, hostBundleId),
      );
    },

    ...input,

    async getFrontmostApp() {
      const info = requireClaudeNative().getFrontmostAppInfo?.();
      if (!info?.bundleId) return null;
      return {
        bundleId: info.bundleId,
        displayName: info.appName ?? info.bundleId,
      };
    },

    async appUnderPoint(x, y) {
      const native = requireClaudeNative();
      const hit = await asPromise(
        native.cuAppUnderPoint(Math.round(x), Math.round(y)),
      );
      return hit
        ? { bundleId: hit.bundleId, displayName: hit.displayName }
        : null;
    },

    async listInstalledApps() {
      await ensureAumidCache();
      return (aumidCache?.installed ?? []).map((app) => ({
        bundleId: app.bundleId,
        displayName: app.displayName,
        path: app.path,
      }));
    },

    getAppIcon: (() => {
      const cache = new Map<string, string | undefined>();
      const max = 64;
      return async (appPath: string) => {
        if (cache.has(appPath)) {
          const hit = cache.get(appPath);
          cache.delete(appPath);
          cache.set(appPath, hit);
          return hit;
        }
        let icon: string | undefined;
        try {
          icon = requireClaudeNative().cuGetAppIcon(appPath) ?? undefined;
        } catch {
          icon = undefined;
        }
        if (cache.size >= max) cache.delete(cache.keys().next().value!);
        cache.set(appPath, icon);
        return icon;
      };
    })(),

    async listRunningApps() {
      return requireClaudeNative()
        .cuListRunningApps()
        .filter(
          (app) =>
            !isSystemProcess(app.bundleId) &&
            !isHostBundle(app.bundleId, hostBundleId),
        )
        .map((app) => ({
          bundleId: app.bundleId,
          displayName: app.displayName,
          pid: app.pid,
        }));
    },

    async openApp(bundleIdOrName) {
      const aumidFromCache = aumidCache?.aumidByBundleId.get(bundleIdOrName);
      if (aumidFromCache) {
        await openAumid(aumidFromCache);
        return;
      }
      if (isAumid(bundleIdOrName)) {
        await openAumid(bundleIdOrName);
        return;
      }
      if (bundleIdOrName.includes("\\") || /^[a-z]:/i.test(bundleIdOrName)) {
        const err = await shell.openPath(bundleIdOrName);
        if (err) {
          throw new Error(`Failed to launch "${bundleIdOrName}": ${err}`);
        }
        return;
      }
      await ensureAumidCache();
      const query = stripExe(bundleIdOrName);
      const resolved = aumidCache
        ? fuzzyAumid(aumidCache.byName, query)
        : null;
      if (resolved && resolved !== bundleIdOrName) {
        await executor.openApp(resolved);
        return;
      }
      throw new Error(
        `Could not resolve "${bundleIdOrName}" to a launchable app.`,
      );
    },
  };

  return executor;
}

/** Residual XUi — unhide apps hidden during the session. */
export async function unhideComputerUseAppsWin32(
  extraBundleIds: string[] = [],
): Promise<void> {
  if (process.platform !== "win32") return;
  const ids = [...hiddenDuringSession, ...extraBundleIds];
  hiddenDuringSession.clear();
  if (ids.length === 0) return;
  try {
    await asPromise(requireClaudeNative().cuUnhideApps(ids));
  } catch (error) {
    console.warn("[computer-use] unhideComputerUseAppsWin32 failed", error);
  }
}

/** Residual eFi host bundle id on win32. */
export function getWin32HostBundleId(): string {
  const native = maybeGetClaudeNative();
  return (
    native?.cuGetOwnBundleId?.() ??
    process.execPath
  );
}
