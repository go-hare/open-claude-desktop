/**
 * Official xn / setPreference side-effect residual (app.asar):
 *
 *   eZt = {
 *     quickEntryDictationShortcut: async e =>
 *       e === "off" ? true : await Fxe(BEFORE_USE, gi("quickEntryDictationShortcut")),
 *   }
 *   xn = async (key, value) => {
 *     if (eZt[key] && await eZt[key](value) === false) return; // no write
 *     write; Rh.emit(key, value); preferencesChanged(bLA(...))
 *   }
 *   setPreference: await xn(...); if (key === "chicagoEnabled") UrA() // y7 refresh
 *   keepAwake: Rh.on("keepAwakeEnabled", ble) via hvi
 *   wakeSchedulerEnabled: Rh.on → reconcile()
 *
 * Product residual: pre-write hooks + post-write effects. Fxe dialog copy uses
 * official i18n message tree (desktopDialogI18n). Does not invent native wake
 * install success without API.
 */
import { dialog, shell, systemPreferences } from "electron";
import {
  getMicrophoneBeforeUseDeniedCopy,
  getMicrophoneHotkeyDeniedCopy,
  type DictationShortcutValue,
} from "./desktopDialogI18n";
import { applyKeepAwakeEnabled } from "./keepAwake";
import { applyMenuBarEnabled } from "./menuBarTray";
import { getActiveCoworkGrowthBookLifecycle } from "../coworkHostLoop/coworkGrowthBookLifecycle";
import { reconcileWakeScheduler } from "./wakeScheduler";

export type PreferencePreWriteHook = (
  value: unknown,
  previous: unknown,
) => boolean | Promise<boolean>;

export type PreferencePostWriteEffect = (
  value: unknown,
  previous: unknown,
) => void | Promise<void>;

/** Official LLA residual. */
export const DictationMicCheckReason = {
  BEFORE_USE: 0,
  HOTKEY: 1,
} as const;

export type DictationMicCheckReasonCode =
  (typeof DictationMicCheckReason)[keyof typeof DictationMicCheckReason];

export type MicrophoneAccessDeps = {
  getMediaAccessStatus?: (media: "microphone") => string;
  askForMediaAccess?: (media: "microphone") => Promise<boolean>;
  openSystemSettings?: () => void;
  openClaudeSettings?: () => void;
  showDeniedDialog?: () => void;
  /**
   * Official Fxe reason: BEFORE_USE (preference set) vs HOTKEY (runtime).
   * Default BEFORE_USE for eZt pre-write.
   */
  reason?: DictationMicCheckReasonCode;
  /** Official gi("quickEntryDictationShortcut") for HOTKEY copy. */
  currentShortcut?: DictationShortcutValue;
  /** Product locale residual (preference locale / app locale). */
  locale?: string | null;
  getLocale?: () => string | null | undefined;
};

/**
 * Official Fxe residual for dictation:
 *   denied + BEFORE_USE → i18n dialog (Open System Settings / Cancel) → false
 *   denied + HOTKEY → i18n 3-button dialog → false
 *   restricted → false
 *   not-determined → askForMediaAccess
 *   granted / unknown → true
 */
export async function checkMicrophoneAccessForDictation(
  deps: MicrophoneAccessDeps = {},
): Promise<boolean> {
  const getStatus =
    deps.getMediaAccessStatus
    ?? ((media: "microphone") => {
      try {
        return systemPreferences.getMediaAccessStatus(media);
      } catch {
        return "granted";
      }
    });
  const ask =
    deps.askForMediaAccess
    ?? (async (media: "microphone") => {
      try {
        if (process.platform === "darwin") {
          return await systemPreferences.askForMediaAccess(media);
        }
        return true;
      } catch {
        return false;
      }
    });
  const openSettings =
    deps.openSystemSettings
    ?? (() => {
      void shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      );
    });
  const locale = deps.locale ?? deps.getLocale?.() ?? null;
  const reason = deps.reason ?? DictationMicCheckReason.BEFORE_USE;

  const showDenied =
    deps.showDeniedDialog
    ?? (() => {
      if (reason === DictationMicCheckReason.HOTKEY) {
        if (deps.currentShortcut === "off") return;
        const copy = getMicrophoneHotkeyDeniedCopy(
          deps.currentShortcut,
          locale,
        );
        void dialog
          .showMessageBox({
            type: "info",
            message: copy.message,
            detail: copy.detail,
            buttons: [...copy.buttons],
          })
          .then((result) => {
            if (result.response === 0) openSettings();
            else if (result.response === 1) deps.openClaudeSettings?.();
          })
          .catch(() => {
            /* ignore */
          });
        return;
      }
      const copy = getMicrophoneBeforeUseDeniedCopy(locale);
      void dialog
        .showMessageBox({
          type: "info",
          message: copy.message,
          detail: copy.detail,
          buttons: [...copy.buttons],
        })
        .then((result) => {
          if (result.response === 0) openSettings();
        })
        .catch(() => {
          /* ignore */
        });
    });

  const status = getStatus("microphone");
  switch (status) {
    case "denied":
      showDenied();
      return false;
    case "restricted":
      return false;
    case "not-determined":
      return await ask("microphone");
    default:
      // granted / unknown → allow (official returns true)
      return true;
  }
}

/**
 * Official eZt.quickEntryDictationShortcut residual.
 * value === "off" always allowed; otherwise need mic access (BEFORE_USE).
 */
export async function preWriteQuickEntryDictationShortcut(
  value: unknown,
  _previous: unknown,
  deps?: MicrophoneAccessDeps,
): Promise<boolean> {
  if (value === "off") return true;
  return checkMicrophoneAccessForDictation({
    ...deps,
    reason: deps?.reason ?? DictationMicCheckReason.BEFORE_USE,
  });
}

/**
 * Official Fxe(HOTKEY, shortcut) residual for runtime hotkey path.
 */
export async function checkMicrophoneAccessForDictationHotkey(
  currentShortcut: DictationShortcutValue,
  deps: MicrophoneAccessDeps = {},
): Promise<boolean> {
  return checkMicrophoneAccessForDictation({
    ...deps,
    reason: DictationMicCheckReason.HOTKEY,
    currentShortcut,
  });
}

const PRE_WRITE_HOOKS: Record<string, PreferencePreWriteHook> = {
  quickEntryDictationShortcut: (value, previous) =>
    preWriteQuickEntryDictationShortcut(value, previous),
};

/**
 * Post-write effects (after successful store write).
 * keepAwakeEnabled → ble claim residual.
 * menuBarEnabled → Rh.on → lKA tray residual.
 * chicagoEnabled → UrA / y7 GrowthBook refresh residual.
 * wakeSchedulerEnabled → pvi.reconcile residual (no-op without API).
 */
export async function runPreferencePostWriteEffects(
  key: string,
  value: unknown,
  _previous: unknown,
): Promise<void> {
  if (key === "keepAwakeEnabled") {
    applyKeepAwakeEnabled(value === true);
    return;
  }
  if (key === "menuBarEnabled") {
    // Official Rh.on("menuBarEnabled", () => lKA())
    applyMenuBarEnabled(value === true);
    return;
  }
  if (key === "chicagoEnabled") {
    // Official: setPreference → xn then UrA() which is y7() refresh.
    const lifecycle = getActiveCoworkGrowthBookLifecycle();
    if (lifecycle) {
      void lifecycle.refresh().catch(() => {
        /* network residual may fail offline — do not invent success */
      });
    }
    return;
  }
  if (key === "wakeSchedulerEnabled") {
    // Official Rh.on("wakeSchedulerEnabled", () => e.reconcile())
    await reconcileWakeScheduler();
  }
}

export async function runPreferencePreWriteHook(
  key: string,
  value: unknown,
  previous: unknown,
): Promise<boolean> {
  const hook = PRE_WRITE_HOOKS[key];
  if (!hook) return true;
  return (await hook(value, previous)) !== false;
}

/** Test injection: replace/clear dictation pre-write. */
export function setPreferencePreWriteHookForTests(
  key: string,
  hook: PreferencePreWriteHook | null,
): void {
  if (hook === null) {
    delete PRE_WRITE_HOOKS[key];
  } else {
    PRE_WRITE_HOOKS[key] = hook;
  }
}
