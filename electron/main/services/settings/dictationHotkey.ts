/**
 * Official dictation global-hotkey residual (app.asar index.js):
 *
 *   Jd.DICTATION = 1
 *   Nme(Jd.DICTATION, () => uit("toggle"))
 *   d = h =>
 *     h === "off" || h === "capslock" || h === "double-tap-capslock"
 *       ? PR(Jd.DICTATION, null)
 *       : PR(Jd.DICTATION, h.accelerator) && xn("quickEntryDictationShortcut", SSA.default)
 *   d(gi("quickEntryDictationShortcut")); Rh.on("quickEntryDictationShortcut", d)
 *
 *   async function uit(e) {
 *     await Fxe(HOTKEY, gi(...)) && (await dit(),
 *       e === "show"
 *         ? nr.quickAccess.dictation.show(mode)
 *         : nr.quickAccess.dictation.toggle(mode))
 *     // mode = capslock → "caps-lock" : "custom"
 *   }
 *
 *   function x9i(){ return t2A() && gi(...) !== "off" }
 *   function swe(){ remove capsLockChanged; x9i() && on(capsLockChanged, nwe) }
 *   async function nwe(on) {
 *     capslock: show on press / stop on release
 *     double-tap-capslock: show if second tap < 600ms
 *   }
 *
 * Product: multi-slot PR only for DICTATION (QE keeps its own register path).
 * Never invents dictation without real nr.quickAccess.dictation.show|toggle.
 */
import { globalShortcut } from "electron";
import { isValidElectronAccelerator } from "./electronAccelerator";
import {
  checkMicrophoneAccessForDictationHotkey,
} from "./preferenceEffects";
import type { DictationShortcutValue } from "./desktopDialogI18n";
import {
  getClaudeSwiftAddonCached,
  loadClaudeSwiftAddon,
  type ClaudeSwiftAddon,
} from "./claudeSwiftAddon";
import { isNativeQuickEntryFeatureSupported } from "./nativeQuickEntryFeature";
import { configureSwiftDictationLanguage } from "./quickEntryNative";

/** Official Jd residual — only DICTATION slot used here. */
export const GlobalShortcutSlot = {
  DICTATION: 1,
} as const;

export type GlobalShortcutSlotId =
  (typeof GlobalShortcutSlot)[keyof typeof GlobalShortcutSlot];

/** Official SSA.quickEntryDictationShortcut residual default. */
export const DEFAULT_DICTATION_SHORTCUT: DictationShortcutValue = "off";

type SlotHandler = () => void | Promise<void>;

const slotHandlers: Partial<Record<GlobalShortcutSlotId, SlotHandler>> = {};
const slotAccelerators: Partial<Record<GlobalShortcutSlotId, string>> = {};

let capsLockWired: ClaudeSwiftAddon | null = null;
/** Official HwA residual — last double-tap capsLock timestamp. */
let lastCapsLockTapMs: number | null = null;

export type DictationHotkeyDeps = {
  getDictationShortcut: () => DictationShortcutValue;
  /** Official xn residual — used when PR fails to reset to SSA default. */
  setDictationShortcut: (value: DictationShortcutValue) => boolean | Promise<boolean>;
  isDictationFeatureSupported: () => boolean;
  getLocale?: () => string | null | undefined;
  openClaudeSettings?: () => void;
  openSystemSettings?: () => void;
};

let deps: DictationHotkeyDeps | null = null;

/**
 * Official Nme residual: store callback for a global-shortcut slot.
 */
export function setGlobalShortcutSlotHandler(
  slot: GlobalShortcutSlotId,
  handler: SlotHandler | null,
): void {
  if (handler === null) {
    delete slotHandlers[slot];
    return;
  }
  slotHandlers[slot] = handler;
}

/**
 * Official PR residual for one slot:
 *   unregister previous; if A && handler → validate ent + register
 * Returns null on success, or "invalid-accelerator" / "registration-failed".
 * Official also early-returns null when menubar helper owns shortcuts (w2A) —
 * product does not use menubar helper ownership yet, so always registers here.
 */
export function registerGlobalShortcutSlot(
  slot: GlobalShortcutSlotId,
  accelerator: string | null,
): null | "invalid-accelerator" | "registration-failed" {
  const previous = slotAccelerators[slot];
  if (previous) {
    try {
      globalShortcut.unregister(previous);
    } catch {
      /* ignore unregister race */
    }
    delete slotAccelerators[slot];
  }

  if (!accelerator) return null;
  const handler = slotHandlers[slot];
  if (!handler) return null;

  if (!isValidElectronAccelerator(accelerator)) {
    console.warn(
      "[dictationHotkey] Skipping invalid accelerator — contains keys not supported by Electron",
      { accelerator, slot },
    );
    return "invalid-accelerator";
  }

  try {
    // Official PR: gA.globalShortcut.register(A, YkA[e]); az[e]=A — catch → registration-failed
    const ok = globalShortcut.register(accelerator, () => {
      void Promise.resolve(handler()).catch((error) => {
        console.warn("[dictationHotkey] slot handler failed", slot, error);
      });
    });
    if (!ok) {
      console.warn("Failed to register global shortcut", { accelerator, slot });
      return "registration-failed";
    }
    slotAccelerators[slot] = accelerator;
    return null;
  } catch (error) {
    console.warn("Failed to register global shortcut", { accelerator, slot, error });
    return "registration-failed";
  }
}

export function getDictationSlotAcceleratorForTests(): string | null {
  return slotAccelerators[GlobalShortcutSlot.DICTATION] ?? null;
}

/**
 * Official mode residual for dictation.show|toggle:
 *   gi(...) == "capslock" ? "caps-lock" : "custom"
 */
export function resolveDictationMode(
  shortcut: DictationShortcutValue,
): "caps-lock" | "custom" {
  return shortcut === "capslock" ? "caps-lock" : "custom";
}

function dictationApi(
  nr: ClaudeSwiftAddon | null,
): {
  show?: (mode: string) => unknown;
  toggle?: (mode: string) => unknown;
  stop?: () => unknown;
  setLanguage?: (lang: string) => unknown;
} | null {
  return nr?.quickAccess?.dictation ?? null;
}

/**
 * Official uit residual (exact order):
 *   await Fxe(HOTKEY, gi(...)) && (
 *     await dit(),
 *     e==="show"
 *       ? nr.quickAccess.dictation.show(mode)
 *       : nr.quickAccess.dictation.toggle(mode)
 *   )
 * mode = gi(...)=="capslock" ? "caps-lock" : "custom"
 *
 * Official does NOT call PwA inside uit — PwA is Y9i boot / account residual only.
 */
export async function invokeDictationFromHotkey(
  action: "show" | "toggle" = "toggle",
): Promise<boolean> {
  if (!deps) return false;
  const shortcut = deps.getDictationShortcut();

  // Official Fxe(LLA.HOTKEY, gi("quickEntryDictationShortcut"))
  const micOk = await checkMicrophoneAccessForDictationHotkey(shortcut, {
    openClaudeSettings: deps.openClaudeSettings,
    openSystemSettings: deps.openSystemSettings,
    getLocale: deps.getLocale,
  });
  if (!micOk) return false;

  const nr = getClaudeSwiftAddonCached() ?? (await loadClaudeSwiftAddon());
  // Official: await dit() then nr?.dictation.show|toggle — soft-null if nr missing.
  // dit only needs getLocale from QuickEntryNativeDeps; pass a minimal bag.
  // Official does NOT call PwA inside uit (Y9i boot only). Still log whether
  // credentials were ever pushed — Swift shows DictationBar only when session
  // actually starts (_isRecording); "Dictation not configured" / no claude.ai
  // connection fails soft with no Electron throw.
  configureSwiftDictationLanguage(
    {
      getLocale: deps.getLocale,
      getMainWindow: () => null,
      getMainViewWebContents: () => null,
      account: {
        getAccountDetails: () => null,
        subscribe: () => () => {},
      } as never,
      onSubmit: () => {},
    },
    nr,
  );

  const api = dictationApi(nr);
  const mode = resolveDictationMode(shortcut);
  console.info("[dictationHotkey] uit residual", {
    action,
    mode,
    hasShow: typeof api?.show === "function",
    hasToggle: typeof api?.toggle === "function",
    hasNr: Boolean(nr),
  });
  try {
    if (action === "show") {
      if (typeof api?.show !== "function") {
        console.warn("[dictationHotkey] uit: dictation.show missing — no DictationBar");
        return false;
      }
      const result = api.show(mode);
      if (result && typeof (result as Promise<unknown>).then === "function") await result;
      console.info("[dictationHotkey] uit: dictation.show resolved (Swift DictationBar is native)");
      return true;
    }
    if (typeof api?.toggle !== "function") {
      console.warn("[dictationHotkey] uit: dictation.toggle missing — no DictationBar");
      return false;
    }
    const result = api.toggle(mode);
    if (result && typeof (result as Promise<unknown>).then === "function") await result;
    console.info("[dictationHotkey] uit: dictation.toggle resolved (Swift DictationBar is native)");
    return true;
  } catch (error) {
    console.warn("[dictationHotkey] uit dictation call failed", error);
    return false;
  }
}

/**
 * Official nwe residual — capsLockChanged payload is boolean on/off.
 */
export async function handleCapsLockChanged(isOn: unknown): Promise<void> {
  if (!deps) return;
  const on = Boolean(isOn);
  console.info("[dictationHotkey] capsLockChanged (official nwe)", on ? "on" : "off");
  const shortcut = deps.getDictationShortcut();
  let shouldShow = false;
  let shouldStop = false;

  if (shortcut === "capslock") {
    shouldShow = on;
    shouldStop = !on;
  } else if (shortcut === "double-tap-capslock") {
    const now = Date.now();
    if (lastCapsLockTapMs !== null && now - lastCapsLockTapMs < 600) {
      shouldShow = true;
    }
    lastCapsLockTapMs = now;
  } else {
    return;
  }

  if (shouldShow) {
    await invokeDictationFromHotkey("show");
  }
  if (shouldStop) {
    try {
      const nr = getClaudeSwiftAddonCached() ?? (await loadClaudeSwiftAddon());
      const stop = dictationApi(nr)?.stop;
      if (typeof stop === "function") {
        const result = stop.call(dictationApi(nr));
        if (result && typeof (result as Promise<unknown>).then === "function") {
          await result;
        }
      }
    } catch (error) {
      console.warn("[dictationHotkey] dictation.stop failed", error);
    }
  }
}

/**
 * Official x9i residual: native QE supported && shortcut !== "off".
 */
export function shouldListenForCapsLockDictation(
  shortcut: DictationShortcutValue = deps?.getDictationShortcut() ?? "off",
  featureSupported: boolean = deps?.isDictationFeatureSupported()
    ?? isNativeQuickEntryFeatureSupported(),
): boolean {
  // Official x9i uses t2A() (native quick entry feature), not mvi alone.
  // Caps lock events come from the same Swift addon as QE.
  return featureSupported && shortcut !== "off";
}

/**
 * Official swe residual: (re)wire capsLockChanged when dictation not off.
 */
export function ensureCapsLockDictationListener(
  nr: ClaudeSwiftAddon | null = getClaudeSwiftAddonCached(),
): void {
  if (!nr || typeof nr.removeListener !== "function" || typeof nr.on !== "function") {
    return;
  }
  try {
    nr.removeListener(
      "capsLockChanged",
      onCapsLockChanged as (...args: unknown[]) => void,
    );
  } catch {
    /* ignore */
  }
  capsLockWired = null;

  if (!shouldListenForCapsLockDictation()) return;

  nr.on("capsLockChanged", onCapsLockChanged);
  capsLockWired = nr;
  console.info("[dictationHotkey] swe residual: capsLockChanged → nwe");
}

function onCapsLockChanged(isOn: unknown): void {
  void handleCapsLockChanged(isOn);
}

/**
 * Official d() residual for quickEntryDictationShortcut preference.
 * Custom accelerator → PR(DICTATION, accelerator); off/capslock/double-tap → PR null.
 * PR truthy failure → reset preference to SSA default ("off").
 */
export async function applyDictationShortcutPreference(
  value: DictationShortcutValue = deps?.getDictationShortcut() ?? "off",
): Promise<null | "invalid-accelerator" | "registration-failed" | "reset"> {
  if (
    value === "off"
    || value === "capslock"
    || value === "double-tap-capslock"
  ) {
    registerGlobalShortcutSlot(GlobalShortcutSlot.DICTATION, null);
    ensureCapsLockDictationListener();
    return null;
  }

  const accelerator =
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as { accelerator?: unknown }).accelerator === "string"
      ? (value as { accelerator: string }).accelerator
      : null;

  if (!accelerator) {
    registerGlobalShortcutSlot(GlobalShortcutSlot.DICTATION, null);
    ensureCapsLockDictationListener();
    return null;
  }

  const result = registerGlobalShortcutSlot(
    GlobalShortcutSlot.DICTATION,
    accelerator,
  );
  ensureCapsLockDictationListener();

  // Official: PR(...) && xn(..., SSA.quickEntryDictationShortcut)
  // Any non-null PR result is truthy → reset to default.
  if (result) {
    if (deps?.setDictationShortcut) {
      try {
        await deps.setDictationShortcut(DEFAULT_DICTATION_SHORTCUT);
      } catch (error) {
        console.warn(
          "[dictationHotkey] failed to reset dictation shortcut after PR failure",
          error,
        );
      }
    }
    return "reset";
  }
  return null;
}

/**
 * Boot residual when quickEntryDictation feature is supported:
 *   Nme(DICTATION, () => uit("toggle")); d(gi(...)); Rh.on(...)
 */
export async function bootDictationHotkeys(
  next: DictationHotkeyDeps,
): Promise<void> {
  deps = next;
  if (!next.isDictationFeatureSupported()) {
    registerGlobalShortcutSlot(GlobalShortcutSlot.DICTATION, null);
    return;
  }

  // Official: Nme(Jd.DICTATION, () => uit("toggle"))
  setGlobalShortcutSlotHandler(GlobalShortcutSlot.DICTATION, () =>
    invokeDictationFromHotkey("toggle"),
  );

  // Official Y9i loads Swift then owe()/swe(); product ensureNativeQuickEntry does that.
  // Here only DICTATION PR boot: d(gi(...)) — Fxe BEFORE_USE is eZt on setPreference only,
  // not re-run on every process start (official residual).
  try {
    await loadClaudeSwiftAddon();
  } catch {
    /* soft */
  }

  await applyDictationShortcutPreference(next.getDictationShortcut());
}

/** Test helper. */
export function resetDictationHotkeyForTests(): void {
  const prev = slotAccelerators[GlobalShortcutSlot.DICTATION];
  if (prev) {
    try {
      globalShortcut.unregister(prev);
    } catch {
      /* ignore */
    }
  }
  delete slotAccelerators[GlobalShortcutSlot.DICTATION];
  delete slotHandlers[GlobalShortcutSlot.DICTATION];
  lastCapsLockTapMs = null;
  capsLockWired = null;
  deps = null;
}

/** Expose for tests — avoid unused warning on capsLockWired in production. */
export function getCapsLockWiredForTests(): ClaudeSwiftAddon | null {
  return capsLockWired;
}
