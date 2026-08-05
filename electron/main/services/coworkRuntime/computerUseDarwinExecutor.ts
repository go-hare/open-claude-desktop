/**
 * Official createDarwinExecutor / cTi residual (app.asar):
 *   cTi({ getMouseAnimationEnabled, getHideBeforeActionEnabled, hostBundleId })
 *   → ComputerExecutor using:
 *     fE()  → claude-swift.computerUse
 *     Su()  → claude-native (keys / mouse / type)
 *     Hu()  → BrowserWindow.setIgnoreMouseEvents during click/drag/scroll
 *     gTi() → clipboard paste via cmd+v
 *     qv/gK → targetImageSize(API_RESIZE_PARAMS)
 *
 * Product: residual-honest. Throws / returns empty when natives missing —
 * never invents screenshots or fake mouse success.
 */
import {
  app,
  BrowserWindow,
  clipboard,
  nativeImage,
  screen,
  shell,
} from "electron";
import {
  API_RESIZE_PARAMS,
  targetImageSize,
  type ComputerExecutor,
  type ComputerUseHostAdapter,
  type CuSubGates,
  type Logger,
  ALL_SUB_GATES_ON,
} from "@ant/computer-use-mcp";
import {
  loadClaudeSwiftComputerUse,
  type ClaudeSwiftComputerUse,
} from "../settings/claudeSwiftAddon";
import {
  maybeGetClaudeNative,
  requireClaudeNative,
  type ClaudeNativeAddon,
} from "../settings/claudeNativeAddon";
import { getComputerUseTccState } from "../tcc/computerUseTcc";
import { markModelSynthesizedEscape } from "./computerUseLock";

/** Official ATi residual delay before mouse actions with ignoreMouseEvents. */
const IGNORE_MOUSE_EVENTS_MS = 50;
/** Official dZe residual settle after mouse move. */
const MOUSE_SETTLE_MS = 50;

/** Windows that must keep ignoreMouseEvents=true (official H_A set). */
const permanentIgnoreMouseWindows = new Set<number>();

export type CreateDarwinExecutorOptions = {
  getMouseAnimationEnabled: () => boolean;
  getHideBeforeActionEnabled: () => boolean;
  hostBundleId: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Official oFi residual: host bundle id for prepareDisplay host exclusion. */
export function resolveComputerUseHostBundleId(): string {
  if (process.platform === "win32") {
    try {
      const native = maybeGetClaudeNative();
      return native?.cuGetOwnBundleId?.() ?? process.execPath;
    } catch {
      return process.execPath;
    }
  }
  // Vitest / non-electron contexts may not have app.isPackaged.
  try {
    return app?.isPackaged
      ? "com.anthropic.claudefordesktop"
      : "com.github.Electron";
  } catch {
    return "com.github.Electron";
  }
}

/** Official fle residual: escape key sequences absorb via zv counter. */
function isEscapeKeySequence(parts: string[]): boolean {
  if (parts.length !== 1) return false;
  const key = parts[0]?.toLowerCase();
  return key === "escape" || key === "esc";
}

/** Official zv residual — shared with Wki Esc handler in computerUseLock. */
function markModelEscape(): void {
  markModelSynthesizedEscape();
}

/** Official Hu residual: ignore mouse events on all BrowserWindows during OS click. */
async function withIgnoreMouseEvents<T>(fn: () => Promise<T>): Promise<T> {
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  for (const w of windows) w.setIgnoreMouseEvents(true);
  await sleep(IGNORE_MOUSE_EVENTS_MS);
  try {
    return await fn();
  } finally {
    for (const w of windows) {
      if (!w.isDestroyed() && !permanentIgnoreMouseWindows.has(w.id)) {
        w.setIgnoreMouseEvents(false);
      }
    }
  }
}

async function holdModifiers(
  native: ClaudeNativeAddon,
  modifiers: string[],
  fn: () => Promise<void>,
): Promise<void> {
  if (!native.key) {
    // Fall back to keys() combo if individual press/release missing.
    await fn();
    return;
  }
  for (const mod of modifiers) await Promise.resolve(native.key(mod, "press"));
  try {
    await fn();
  } finally {
    for (const mod of [...modifiers].reverse()) {
      try {
        await Promise.resolve(native.key(mod, "release"));
      } catch {
        // residual: swallow release errors
      }
    }
  }
}

async function animateMouseMove(
  native: ClaudeNativeAddon,
  x: number,
  y: number,
  durationSec: number,
): Promise<void> {
  if (!native.mouseLocation || !native.moveMouse) {
    await Promise.resolve(native.moveMouse?.(x, y, false));
    return;
  }
  const loc = await Promise.resolve(native.mouseLocation());
  const startX = loc.x;
  const startY = loc.y;
  const dx = x - startX;
  const dy = y - startY;
  if (Math.sqrt(dx * dx + dy * dy) < 1) return;
  const fps = 60;
  const frameMs = 1000 / fps;
  const frames = Math.floor(durationSec * fps);
  if (frames <= 0) {
    await Promise.resolve(native.moveMouse(x, y, false));
    return;
  }
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    const ease = 1 - Math.pow(1 - t, 3);
    const nx = startX + dx * ease;
    const ny = startY + dy * ease;
    await Promise.resolve(
      native.moveMouse(Math.round(nx), Math.round(ny), false),
    );
    if (i < frames) await sleep(frameMs);
  }
}

/** Official gv residual: teleport + settle. */
async function moveMouseInstant(
  native: ClaudeNativeAddon,
  x: number,
  y: number,
): Promise<void> {
  await Promise.resolve(native.moveMouse?.(x, y, false));
  await sleep(MOUSE_SETTLE_MS);
}

/** Official aTi residual: animated glide when gate on. */
async function moveMouseMaybeAnimated(
  native: ClaudeNativeAddon,
  x: number,
  y: number,
  animated: boolean,
): Promise<void> {
  if (!animated) {
    await moveMouseInstant(native, x, y);
    return;
  }
  if (!native.mouseLocation) {
    await moveMouseInstant(native, x, y);
    return;
  }
  const loc = await Promise.resolve(native.mouseLocation());
  const dist = Math.hypot(x - loc.x, y - loc.y);
  const duration = Math.min(dist / 2000, 0.5);
  if (duration < 0.03) {
    await moveMouseInstant(native, x, y);
    return;
  }
  await animateMouseMove(native, x, y, duration);
  await sleep(MOUSE_SETTLE_MS);
}

/** Official gTi residual: clipboard paste via cmd+v. */
async function typeViaClipboard(text: string): Promise<void> {
  const native = requireClaudeNative();
  let previous: string | undefined;
  try {
    previous = clipboard.readText();
  } catch {
    // proceed without restore
  }
  try {
    clipboard.writeText(text);
    if (clipboard.readText() !== text) {
      throw new Error("Clipboard write did not round-trip.");
    }
    await Promise.resolve(native.keys?.(["command", "v"]));
    await sleep(100);
  } finally {
    if (typeof previous === "string") {
      try {
        clipboard.writeText(previous);
      } catch {
        // residual
      }
    }
  }
}

async function getComputerUse(): Promise<ClaudeSwiftComputerUse> {
  const cu = await loadClaudeSwiftComputerUse();
  if (!cu) {
    throw new Error(
      "claude-swift computerUse namespace is missing — computer_use.node not built?",
    );
  }
  return cu;
}

/**
 * Official cTi / createDarwinExecutor residual.
 * Throws if called on non-darwin (match official).
 */
export function createDarwinExecutor(
  options: CreateDarwinExecutorOptions,
): ComputerExecutor {
  if (process.platform !== "darwin") {
    throw new Error(
      `createDarwinExecutor called on ${process.platform}. Use createWin32Executor for Windows.`,
    );
  }
  const {
    getMouseAnimationEnabled,
    getHideBeforeActionEnabled,
    hostBundleId,
  } = options;

  const iconCache = new Map<string, string | undefined>();

  const executor: ComputerExecutor = {
    capabilities: {
      screenshotFiltering: "native",
      platform: "darwin",
      hostBundleId,
    },

    async prepareForAction(allowlistBundleIds, displayId) {
      if (!getHideBeforeActionEnabled()) return [];
      try {
        const cu = await getComputerUse();
        const result = await cu.apps?.prepareDisplay?.(
          allowlistBundleIds,
          hostBundleId,
          displayId,
        );
        return result?.hidden ?? [];
      } catch (error) {
        console.warn(
          "[computer-use] prepareForAction failed; continuing to action",
          error,
        );
        return [];
      }
    },

    async previewHideSet(allowlistBundleIds, displayId) {
      const cu = await getComputerUse();
      return (
        (await cu.apps?.previewHideSet?.(
          [...allowlistBundleIds, hostBundleId],
          displayId,
        )) ?? []
      );
    },

    async findWindowDisplays(bundleIds) {
      const cu = await getComputerUse();
      return (await cu.apps?.findWindowDisplays?.(bundleIds)) ?? [];
    },

    async getDisplaySize(displayId) {
      const cu = await getComputerUse();
      const size = cu.display?.getSize?.(displayId);
      if (!size) {
        throw new Error("computerUse.display.getSize unavailable");
      }
      return size;
    },

    async listDisplays() {
      const cu = await getComputerUse();
      return (cu.display?.listAll?.() ?? []).map((n) => ({
        displayId: n.displayId,
        width: n.width,
        height: n.height,
        scaleFactor: n.scaleFactor,
        originX: n.originX,
        originY: n.originY,
        isPrimary: n.isPrimary,
        label: n.label,
      }));
    },

    async screenshot(opts) {
      const cu = await getComputerUse();
      const o = cu.display?.getSize?.(opts.displayId);
      if (!o || !cu.screenshot?.captureExcluding) {
        throw new Error("computerUse screenshot surface unavailable");
      }
      const physW = Math.round(o.width * o.scaleFactor);
      const physH = Math.round(o.height * o.scaleFactor);
      const [tw, th] = targetImageSize(physW, physH, API_RESIZE_PARAMS);
      return cu.screenshot.captureExcluding(
        opts.allowedBundleIds,
        0.75,
        tw,
        th,
        opts.displayId,
      );
    },

    async resolvePrepareCapture(opts) {
      const cu = await getComputerUse();
      if (!cu.resolvePrepareCapture || !cu.display?.getSize) {
        throw new Error("computerUse resolvePrepareCapture unavailable");
      }
      const o = cu.display.getSize(opts.preferredDisplayId);
      const physW = Math.round(o.width * o.scaleFactor);
      const physH = Math.round(o.height * o.scaleFactor);
      const [tw, th] = targetImageSize(physW, physH, API_RESIZE_PARAMS);
      return cu.resolvePrepareCapture(
        opts.allowedBundleIds,
        hostBundleId,
        0.75,
        tw,
        th,
        opts.preferredDisplayId,
        opts.autoResolve,
        opts.doHide,
      );
    },

    async zoom(regionLogical, allowedBundleIds, displayId) {
      const cu = await getComputerUse();
      if (!cu.screenshot?.captureRegion || !cu.display?.getSize) {
        throw new Error("computerUse zoom surface unavailable");
      }
      const a = cu.display.getSize(displayId);
      const g = Math.round(regionLogical.w * a.scaleFactor);
      const c = Math.round(regionLogical.h * a.scaleFactor);
      const [outW, outH] = targetImageSize(g, c, API_RESIZE_PARAMS);
      return cu.screenshot.captureRegion(
        allowedBundleIds,
        regionLogical.x,
        regionLogical.y,
        regionLogical.w,
        regionLogical.h,
        outW,
        outH,
        0.75,
        displayId,
      );
    },

    async key(keySequence, repeat) {
      const native = requireClaudeNative();
      const parts = keySequence.split("+").filter((p) => p.length > 0);
      const escape = isEscapeKeySequence(parts);
      const times = repeat ?? 1;
      if (times <= 1) {
        if (escape) markModelEscape();
        await Promise.resolve(native.keys?.(parts));
        return;
      }
      for (let i = 0; i < times; i++) {
        if (i > 0) await sleep(8);
        if (escape) markModelEscape();
        await Promise.resolve(native.keys?.(parts));
      }
    },

    async holdKey(keyNames, durationMs) {
      const native = requireClaudeNative();
      if (isEscapeKeySequence(keyNames)) markModelEscape();
      await holdModifiers(native, keyNames, async () => {
        const end = Date.now() + durationMs;
        while (Date.now() < end) {
          await sleep(Math.min(50, end - Date.now()));
        }
      });
    },

    async type(text, opts) {
      if (opts.viaClipboard) {
        await typeViaClipboard(text);
        return;
      }
      const native = requireClaudeNative();
      await Promise.resolve(native.typeText?.(text));
    },

    async readClipboard() {
      return clipboard.readText();
    },

    async writeClipboard(text) {
      clipboard.writeText(text);
    },

    async moveMouse(x, y) {
      const native = requireClaudeNative();
      await moveMouseInstant(native, x, y);
    },

    async click(x, y, button, count, modifiers) {
      const native = requireClaudeNative();
      console.debug(
        `[computer-use] click x=${x} y=${y} button=${button} count=${count}`,
      );
      await withIgnoreMouseEvents(async () => {
        await moveMouseInstant(native, x, y);
        if (modifiers && modifiers.length > 0) {
          await holdModifiers(native, modifiers, async () => {
            await Promise.resolve(
              native.mouseButton?.(button, "click", count),
            );
          });
        } else {
          await Promise.resolve(native.mouseButton?.(button, "click", count));
        }
      });
    },

    async mouseDown() {
      const native = requireClaudeNative();
      await withIgnoreMouseEvents(async () => {
        await Promise.resolve(native.mouseButton?.("left", "press"));
      });
    },

    async mouseUp() {
      const native = requireClaudeNative();
      await withIgnoreMouseEvents(async () => {
        await Promise.resolve(native.mouseButton?.("left", "release"));
      });
    },

    async getCursorPosition() {
      // Official cTi uses screen.getCursorScreenPoint (not native mouseLocation).
      const point = screen.getCursorScreenPoint();
      return { x: point.x, y: point.y };
    },

    async drag(from, to) {
      const native = requireClaudeNative();
      await withIgnoreMouseEvents(async () => {
        if (from !== undefined) {
          await moveMouseInstant(native, from.x, from.y);
        }
        await Promise.resolve(native.mouseButton?.("left", "press"));
        await sleep(50);
        try {
          await moveMouseMaybeAnimated(
            native,
            to.x,
            to.y,
            getMouseAnimationEnabled(),
          );
        } finally {
          await Promise.resolve(native.mouseButton?.("left", "release"));
        }
      });
    },

    async scroll(x, y, dx, dy) {
      const native = requireClaudeNative();
      await withIgnoreMouseEvents(async () => {
        await moveMouseInstant(native, x, y);
        if (dy !== 0) {
          await Promise.resolve(native.mouseScroll?.(dy, "vertical"));
        }
        if (dx !== 0) {
          await Promise.resolve(native.mouseScroll?.(dx, "horizontal"));
        }
      });
    },

    async getFrontmostApp() {
      const native = requireClaudeNative();
      const info = native.getFrontmostAppInfo?.();
      if (!info || !info.bundleId) return null;
      return {
        bundleId: info.bundleId,
        displayName: info.appName ?? info.bundleId,
      };
    },

    async appUnderPoint(x, y) {
      const cu = await getComputerUse();
      return (await cu.apps?.appUnderPoint?.(x, y)) ?? null;
    },

    async listInstalledApps() {
      const cu = await getComputerUse();
      return (await cu.apps?.listInstalled?.()) ?? [];
    },

    async getAppIcon(appPath) {
      if (iconCache.has(appPath)) return iconCache.get(appPath);
      const cu = await getComputerUse();
      let icon: string | undefined;
      try {
        icon = cu.apps?.iconDataUrl?.(appPath) ?? undefined;
      } catch {
        icon = undefined;
      }
      iconCache.set(appPath, icon);
      return icon;
    },

    async listRunningApps() {
      const cu = await getComputerUse();
      return (await cu.apps?.listRunning?.()) ?? [];
    },

    async openApp(bundleId) {
      const cu = await getComputerUse();
      await Promise.resolve(cu.apps?.open?.(bundleId));
    },
  };

  return executor;
}

/** Official CTi default sub-gates residual. */
export const DEFAULT_CU_SUB_GATES: CuSubGates = {
  pixelValidation: false,
  clipboardPasteMultiline: true,
  mouseAnimation: true,
  hideBeforeAction: true,
  autoTargetDisplay: true,
  clipboardGuard: true,
};

/**
 * Official dMA residual: ensureOsPermissions via computerUse.tcc when available,
 * else Electron systemPreferences (product TCC helper).
 */
export async function ensureComputerUseOsPermissions(): Promise<
  | { granted: true }
  | { granted: false; accessibility: boolean; screenRecording: boolean }
> {
  if (process.platform === "win32") return { granted: true };
  try {
    const cu = await loadClaudeSwiftComputerUse();
    if (cu?.tcc?.checkAccessibility && cu?.tcc?.checkScreenRecording) {
      const accessibility = cu.tcc.checkAccessibility();
      const screenRecording = cu.tcc.checkScreenRecording();
      if (accessibility && screenRecording) return { granted: true };
      return { granted: false, accessibility, screenRecording };
    }
  } catch (error) {
    console.error(
      "[computer-use] ensureOsPermissions: claude-swift computerUse unavailable",
      error,
    );
  }
  // Fallback: Electron systemPreferences residual (same as getComputerUseTccState).
  const tcc = getComputerUseTccState();
  const accessibility = tcc.accessibility === "granted";
  const screenRecording = tcc.screenRecording === "granted";
  if (accessibility && screenRecording) return { granted: true };
  return { granted: false, accessibility, screenRecording };
}

/** Official cropRawPatch residual via nativeImage. */
export function cropRawPatchFromJpeg(
  jpegBase64: string,
  rect: { x: number; y: number; width: number; height: number },
): Buffer | null {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(jpegBase64, "base64"));
    if (img.isEmpty()) return null;
    const cropped = img.crop(rect);
    if (cropped.isEmpty()) return null;
    return cropped.toBitmap();
  } catch {
    return null;
  }
}

const defaultLogger: Logger = {
  info: (msg, detail) => console.info(msg, detail ?? ""),
  error: (msg, detail) => console.error(msg, detail ?? ""),
  warn: (msg, detail) => console.warn(msg, detail ?? ""),
  debug: (msg, detail) => console.debug(msg, detail ?? ""),
  silly: (msg, detail) => console.debug(msg, detail ?? ""),
};

export type ComputerUseHostAdapterOptions = {
  /** Official YM residual — when false, adapter.isDisabled() is true. */
  isChicagoEnabled: () => boolean;
  getAutoUnhideEnabled?: () => boolean;
  getSubGates?: () => CuSubGates;
  serverName?: string;
  logger?: Logger;
};

/**
 * Official createWin32Executor residual (app.asar r5e / oTi input subset).
 *
 * asar:
 *   if (platform !== "win32") throw Use createDarwinExecutor on macOS
 *   capabilities QZe = { screenshotFiltering:"mask", platform:"win32" }
 *   prepareForAction / listRunningApps / openApp via Ha() native
 *   input methods via oTi(Ha)
 *
 * Product residual: same control flow. Product ComputerExecutor type only
 * allows screenshotFiltering "native"|"none" → use "none" (win32 has no
 * native compositor filter in product type). Methods require claude-native;
 * missing native → throw at call site (never invent mouse/screenshot success).
 *
 * data-official-source: app.asar r5e / oTi / QZe / koA
 */
export function createWin32Executor(
  options: CreateDarwinExecutorOptions,
): ComputerExecutor {
  if (process.platform !== "win32") {
    throw new Error(
      `createWin32Executor called on ${process.platform}. Use createDarwinExecutor on macOS.`,
    );
  }
  const {
    getMouseAnimationEnabled,
    getHideBeforeActionEnabled,
    hostBundleId,
  } = options;

  const iconCache = new Map<string, string | undefined>();
  const ICON_CACHE_MAX = 64;

  const executor: ComputerExecutor = {
    capabilities: {
      // Official QZe uses "mask"; product type is native|none → none residual.
      screenshotFiltering: "none",
      platform: "win32",
      hostBundleId,
    },

    async prepareForAction(allowlistBundleIds, _displayId) {
      if (!getHideBeforeActionEnabled()) return [];
      const allowed = new Set(allowlistBundleIds);
      allowed.add(hostBundleId);
      const hidden: string[] = [];
      try {
        const native = requireClaudeNative() as ClaudeNativeAddon & {
          cuListRunningApps?: () => Array<{ bundleId: string; pid?: number }>;
          cuHideApps?: (ids: string[]) => Promise<string[]> | string[];
        };
        const list = native.cuListRunningApps?.() ?? [];
        const toHide = list
          .map((a) => a.bundleId)
          .filter((id) => id && !allowed.has(id));
        if (toHide.length > 0 && native.cuHideApps) {
          console.debug(
            `[computer-use] prepareForAction: hiding ${toHide.length} id(s) not in allowlist(${allowlistBundleIds.length}). hiding=[${toHide.join(", ")}] allowed=[${allowlistBundleIds.join(", ")}]`,
          );
          const hid = await Promise.resolve(native.cuHideApps(toHide));
          for (const id of hid ?? []) hidden.push(id);
        }
        const focused = BrowserWindow.getFocusedWindow();
        if (focused && !focused.isDestroyed()) {
          focused.blur();
          await sleep(200);
        }
      } catch (err) {
        console.warn(
          "[computer-use] prepareForAction failed; continuing to action",
          err,
        );
      }
      return hidden;
    },

    async previewHideSet(allowlistBundleIds, _displayId) {
      const allowed = new Set([...allowlistBundleIds, hostBundleId]);
      try {
        const native = requireClaudeNative() as ClaudeNativeAddon & {
          cuListRunningApps?: () => Array<{
            bundleId: string;
            displayName?: string;
          }>;
        };
        return (native.cuListRunningApps?.() ?? [])
          .filter((a) => a.bundleId && !allowed.has(a.bundleId))
          .map((a) => ({
            bundleId: a.bundleId,
            displayName: a.displayName ?? a.bundleId,
          }));
      } catch {
        return [];
      }
    },

    async findWindowDisplays(bundleIds) {
      // Official r5e: Ha().cuDisplayForPid — residual empty when native missing.
      void bundleIds;
      return [];
    },

    async getDisplaySize(displayId) {
      const displays = screen.getAllDisplays();
      const match =
        displays.find((d) => d.id === displayId) ??
        displays.find((d) => d.bounds.x === 0 && d.bounds.y === 0) ??
        displays[0];
      if (!match) throw new Error("No displays enumerated");
      return {
        displayId: match.id,
        width: match.size.width,
        height: match.size.height,
        scaleFactor: match.scaleFactor,
        originX: match.bounds.x,
        originY: match.bounds.y,
        isPrimary: match.bounds.x === 0 && match.bounds.y === 0,
      };
    },

    async listDisplays() {
      return screen.getAllDisplays().map((d) => ({
        displayId: d.id,
        width: d.size.width,
        height: d.size.height,
        scaleFactor: d.scaleFactor,
        originX: d.bounds.x,
        originY: d.bounds.y,
        isPrimary: d.bounds.x === 0 && d.bounds.y === 0,
      }));
    },

    async screenshot(_opts) {
      // Official YQe mask capture — without native mask path, do not invent pixels.
      throw new Error(
        "computerUse win32 screenshot surface unavailable (native mask capture residual)",
      );
    },

    async resolvePrepareCapture(opts) {
      let hidden: string[] = [];
      if (opts.doHide ?? true) {
        hidden = await this.prepareForAction(
          opts.allowedBundleIds,
          opts.preferredDisplayId,
        );
      }
      try {
        // No invent base64 success — same throw path as screenshot residual.
        await this.screenshot({
          displayId: opts.preferredDisplayId ?? 0,
          allowedBundleIds: opts.allowedBundleIds,
        });
        return {
          base64: "",
          width: 0,
          height: 0,
          displayWidth: 0,
          displayHeight: 0,
          displayId: opts.preferredDisplayId ?? 0,
          originX: 0,
          originY: 0,
          hidden,
          activated: null,
        };
      } catch (err) {
        return {
          base64: "",
          width: 0,
          height: 0,
          displayWidth: 0,
          displayHeight: 0,
          displayId: opts.preferredDisplayId ?? 0,
          originX: 0,
          originY: 0,
          hidden,
          activated: null,
          captureError:
            err instanceof Error ? err.message : "Screenshot capture failed",
        };
      }
    },

    async zoom(_region, _allowed, _displayId) {
      throw new Error(
        "computerUse win32 zoom surface unavailable (native mask capture residual)",
      );
    },

    // Official oTi residual — same input path as darwin via Ha()/claude-native.
    async key(keySequence, repeat) {
      const native = requireClaudeNative();
      const parts = keySequence.split("+").filter((p) => p.length > 0);
      const escape = isEscapeKeySequence(parts);
      const times = repeat ?? 1;
      if (times <= 1) {
        if (escape) markModelEscape();
        await Promise.resolve(native.keys?.(parts));
        return;
      }
      for (let i = 0; i < times; i++) {
        if (i > 0) await sleep(8);
        if (escape) markModelEscape();
        await Promise.resolve(native.keys?.(parts));
      }
    },

    async holdKey(keyNames, durationMs) {
      const native = requireClaudeNative();
      if (isEscapeKeySequence(keyNames)) markModelEscape();
      await holdModifiers(native, keyNames, async () => {
        const end = Date.now() + durationMs;
        while (Date.now() < end) {
          await sleep(Math.min(50, end - Date.now()));
        }
      });
    },

    async type(text, opts) {
      if (opts.viaClipboard) {
        await typeViaClipboard(text);
        return;
      }
      const native = requireClaudeNative();
      await Promise.resolve(native.typeText?.(text));
    },

    async readClipboard() {
      return clipboard.readText();
    },

    async writeClipboard(text) {
      clipboard.writeText(text);
    },

    async moveMouse(x, y) {
      const native = requireClaudeNative();
      await moveMouseInstant(native, x, y);
    },

    async click(x, y, button, count, modifiers) {
      const native = requireClaudeNative();
      console.debug(
        `[computer-use] click x=${x} y=${y} button=${button} count=${count}`,
      );
      await withIgnoreMouseEvents(async () => {
        await moveMouseInstant(native, x, y);
        if (modifiers && modifiers.length > 0) {
          await holdModifiers(native, modifiers, async () => {
            await Promise.resolve(
              native.mouseButton?.(button, "click", count),
            );
          });
        } else {
          await Promise.resolve(native.mouseButton?.(button, "click", count));
        }
      });
    },

    async mouseDown() {
      const native = requireClaudeNative();
      await withIgnoreMouseEvents(async () => {
        await Promise.resolve(native.mouseButton?.("left", "press"));
      });
    },

    async mouseUp() {
      const native = requireClaudeNative();
      await withIgnoreMouseEvents(async () => {
        await Promise.resolve(native.mouseButton?.("left", "release"));
      });
    },

    async getCursorPosition() {
      const point = screen.getCursorScreenPoint();
      return { x: point.x, y: point.y };
    },

    async drag(from, to) {
      const native = requireClaudeNative();
      await withIgnoreMouseEvents(async () => {
        if (from !== undefined) {
          await moveMouseInstant(native, from.x, from.y);
        }
        await Promise.resolve(native.mouseButton?.("left", "press"));
        await sleep(50);
        try {
          await moveMouseMaybeAnimated(
            native,
            to.x,
            to.y,
            getMouseAnimationEnabled(),
          );
        } finally {
          await Promise.resolve(native.mouseButton?.("left", "release"));
        }
      });
    },

    async scroll(x, y, dx, dy) {
      const native = requireClaudeNative();
      await withIgnoreMouseEvents(async () => {
        await moveMouseInstant(native, x, y);
        if (dy !== 0) {
          await Promise.resolve(native.mouseScroll?.(dy, "vertical"));
        }
        if (dx !== 0) {
          await Promise.resolve(native.mouseScroll?.(dx, "horizontal"));
        }
      });
    },

    async getFrontmostApp() {
      const native = requireClaudeNative();
      const info = native.getFrontmostAppInfo?.();
      if (!info || !info.bundleId) return null;
      return {
        bundleId: info.bundleId,
        displayName: info.appName ?? info.bundleId,
      };
    },

    async appUnderPoint(x, y) {
      const native = requireClaudeNative() as ClaudeNativeAddon & {
        cuAppUnderPoint?: (
          x: number,
          y: number,
        ) =>
          | Promise<{ bundleId: string; displayName?: string } | null>
          | { bundleId: string; displayName?: string }
          | null;
      };
      if (!native.cuAppUnderPoint) return null;
      const a = await Promise.resolve(
        native.cuAppUnderPoint(Math.round(x), Math.round(y)),
      );
      return a
        ? { bundleId: a.bundleId, displayName: a.displayName ?? a.bundleId }
        : null;
    },

    async listInstalledApps() {
      return [];
    },

    async getAppIcon(appPath) {
      if (iconCache.has(appPath)) {
        const cached = iconCache.get(appPath);
        iconCache.delete(appPath);
        iconCache.set(appPath, cached);
        return cached;
      }
      const native = requireClaudeNative() as ClaudeNativeAddon & {
        cuGetAppIcon?: (id: string) => string | null | undefined;
      };
      let icon: string | undefined;
      try {
        icon = native.cuGetAppIcon?.(appPath) ?? undefined;
      } catch {
        icon = undefined;
      }
      if (iconCache.size >= ICON_CACHE_MAX) {
        const first = iconCache.keys().next().value;
        if (first !== undefined) iconCache.delete(first);
      }
      iconCache.set(appPath, icon);
      return icon;
    },

    async listRunningApps() {
      try {
        const native = requireClaudeNative() as ClaudeNativeAddon & {
          cuListRunningApps?: () => Array<{
            bundleId: string;
            displayName?: string;
            pid?: number;
          }>;
        };
        return (native.cuListRunningApps?.() ?? []).map((a) => ({
          bundleId: a.bundleId,
          displayName: a.displayName ?? a.bundleId,
          pid: a.pid,
        }));
      } catch {
        return [];
      }
    },

    async openApp(target) {
      // Official r5e: AUMID / path resolve via Ha() native; product residual
      // uses shell.openPath for filesystem targets. Unresolved id → throw
      // (same honesty as missing native launch — no invent success).
      const looksLikePath =
        target.includes("\\") ||
        target.includes("/") ||
        /^[a-zA-Z]:/.test(target);
      if (looksLikePath) {
        const errMsg = await shell.openPath(target);
        if (errMsg) {
          throw new Error(`Failed to launch "${target}": ${errMsg}`);
        }
        return;
      }
      // Try native launch residual if present (AUMID / app id).
      try {
        const native = requireClaudeNative() as ClaudeNativeAddon & {
          cuOpenApp?: (id: string) => Promise<void> | void;
        };
        if (typeof native.cuOpenApp === "function") {
          await Promise.resolve(native.cuOpenApp(target));
          return;
        }
      } catch {
        /* fall through to unresolved */
      }
      throw new Error(`Could not resolve "${target}" to a launchable app.`);
    },
  };

  return executor;
}

/**
 * Official koA residual host adapter singleton factory.
 * asar: platform win32 → PUi(); r5e(e); else cTi(e)
 * Returns null only when executor construction throws (natives missing etc).
 */
export function createComputerUseHostAdapter(
  options: ComputerUseHostAdapterOptions,
): ComputerUseHostAdapter | null {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return null;
  }

  const getSubGates = options.getSubGates ?? (() => DEFAULT_CU_SUB_GATES);
  let executor: ComputerExecutor;
  try {
    const execOpts: CreateDarwinExecutorOptions = {
      getMouseAnimationEnabled: () => getSubGates().mouseAnimation,
      getHideBeforeActionEnabled: () => getSubGates().hideBeforeAction,
      hostBundleId: resolveComputerUseHostBundleId(),
    };
    // Official koA: win32 → r5e; darwin → cTi
    executor =
      process.platform === "win32"
        ? createWin32Executor(execOpts)
        : createDarwinExecutor(execOpts);
  } catch (error) {
    console.warn(
      `[computer-use] create${process.platform === "win32" ? "Win32" : "Darwin"}Executor failed`,
      error,
    );
    return null;
  }

  return {
    serverName: options.serverName ?? "computer-use",
    logger: options.logger ?? defaultLogger,
    executor,
    ensureOsPermissions: ensureComputerUseOsPermissions,
    isDisabled: () => !options.isChicagoEnabled(),
    getAutoUnhideEnabled: () => options.getAutoUnhideEnabled?.() ?? true,
    getSubGates,
    cropRawPatch: cropRawPatchFromJpeg,
  };
}

/**
 * Probe whether Darwin CU natives are loadable (honest availability).
 * Does not invent true when .node missing.
 */
export async function isComputerUseNativeAvailable(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const native = maybeGetClaudeNative();
  if (!native) return false;
  const cu = await loadClaudeSwiftComputerUse();
  return Boolean(cu);
}

export { ALL_SUB_GATES_ON, permanentIgnoreMouseWindows };
