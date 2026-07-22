/**
 * Official AppPreferences setPreference validation residual (HSA = qOe.required()).
 *
 * Official setPreference:
 *   const o = HSA.keyof().safeParse(key);
 *   if (o.success) {
 *     const a = HSA.shape[o.data].safeParse(value);
 *     if (a.success) await xn(...); else throw
 *   }
 *   // unknown keys: silent no-op
 *
 * Product residual:
 *   - Validate official SSA keys with light type checks (no invent new enums).
 *   - Accept PRODUCT_RESIDUAL_PREFERENCE_KEYS with explicit shapes.
 *   - Unknown keys: reject (align official no-write; return false not throw for IPC).
 */

import {
  OFFICIAL_APP_PREFERENCE_DEFAULTS,
  PRODUCT_RESIDUAL_PREFERENCE_KEYS,
} from "./appPreferencesDefaults";
import { assertValidAcceleratorInPreferenceValue } from "./electronAccelerator";

const SIDEBAR_MODES = new Set(["chat", "code", "task", "epitaxy"]);
const DISPATCH_CODE_TASKS_MODES = new Set([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "bypassPermissions",
]);
const QUICK_ENTRY_SHORTCUTS = new Set(["double-tap-option", "off"]);
const QUICK_ENTRY_DICTATION = new Set(["capslock", "double-tap-capslock", "off"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOffOrAccelerator(value: unknown): boolean {
  if (value === "off") return true;
  return isPlainObject(value) && typeof value.accelerator === "string";
}

function isQuickEntryShortcut(value: unknown): boolean {
  if (typeof value === "string" && QUICK_ENTRY_SHORTCUTS.has(value)) return true;
  return isPlainObject(value) && typeof value.accelerator === "string";
}

function isQuickEntryDictation(value: unknown): boolean {
  if (typeof value === "string" && QUICK_ENTRY_DICTATION.has(value)) return true;
  return isPlainObject(value) && typeof value.accelerator === "string";
}

function isNonNegInt(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonNegNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCoworkOnboardingResumeStep(value: unknown): boolean {
  if (value === null) return true;
  if (!isPlainObject(value)) return false;
  const step = value.step;
  const accountKey = value.accountKey;
  return (
    (step === "ios" || step === "setup")
    && typeof accountKey === "string"
  );
}

/**
 * Official chromeExtension shape residual (optional nested fields).
 */
function isChromeExtension(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (
    value.pairedDeviceId !== undefined
    && typeof value.pairedDeviceId !== "string"
  ) {
    return false;
  }
  if (
    value.pairedDeviceName !== undefined
    && typeof value.pairedDeviceName !== "string"
  ) {
    return false;
  }
  if (
    value.pairedFromDeviceIds !== undefined
    && !isStringArray(value.pairedFromDeviceIds)
  ) {
    return false;
  }
  return true;
}

type Validator = (value: unknown) => boolean;

const OFFICIAL_VALIDATORS: Record<string, Validator> = {
  menuBarEnabled: (v) => typeof v === "boolean",
  legacyQuickEntryEnabled: (v) => typeof v === "boolean",
  chromeExtensionEnabled: (v) => typeof v === "boolean",
  chromeExtension: isChromeExtension,
  quickEntryShortcut: isQuickEntryShortcut,
  quickEntryDictationShortcut: isQuickEntryDictation,
  hardwareBuddyEnabled: (v) => typeof v === "boolean",
  plushRaccoonEnabled: (v) => typeof v === "boolean",
  quietPenguinEnabled: (v) => typeof v === "boolean",
  louderPenguinEnabled: (v) => typeof v === "boolean",
  floatingPenguinEnabled: (v) => typeof v === "boolean",
  plushRaccoonOption1: isOffOrAccelerator,
  plushRaccoonOption2: isOffOrAccelerator,
  plushRaccoonOption3: isOffOrAccelerator,
  chillingSlothLocation: (v) => typeof v === "string",
  ccBranchPrefix: (v) => typeof v === "string",
  ccMaxWarmWorktrees: isNonNegInt,
  ccWorktreeReapAfterHours: isNonNegNumber,
  secureVmFeaturesEnabled: (v) => typeof v === "boolean",
  launchEnabled: (v) => typeof v === "boolean",
  launchPreviewPersistSession: (v) => typeof v === "boolean",
  launchPreviewPersistedWorkspaces: isStringArray,
  localAgentModeTrustedFolders: isStringArray,
  allowAllBrowserActions: (v) => typeof v === "boolean",
  dispatchTrustedCodeWorkspaces: isStringArray,
  dispatchCodeTasksPermissionMode: (v) =>
    typeof v === "string" && DISPATCH_CODE_TASKS_MODES.has(v),
  coworkScheduledTasksEnabled: (v) => typeof v === "boolean",
  ccdScheduledTasksEnabled: (v) => typeof v === "boolean",
  sidebarMode: (v) => typeof v === "string" && SIDEBAR_MODES.has(v),
  bypassPermissionsModeEnabled: (v) => typeof v === "boolean",
  dockBounceEnabled: (v) => typeof v === "boolean",
  coworkWebSearchEnabled: (v) => typeof v === "boolean",
  coworkDisabledTools: isStringArray,
  coworkSpaceContextEnabled: (v) => typeof v === "boolean",
  keepAwakeEnabled: (v) => typeof v === "boolean",
  wakeSchedulerEnabled: (v) => typeof v === "boolean",
  wakeSchedulerApprovedThisCycle: (v) => typeof v === "boolean",
  wakeSchedulerRegisteredAtVersion: (v) => typeof v === "string",
  wakeSchedulerCourtesyFlippedKeepAwake: (v) => typeof v === "boolean",
  coworkOnboardingResumeStep: isCoworkOnboardingResumeStep,
  chicagoEnabled: (v) => typeof v === "boolean",
  remoteToolsDeviceName: (v) => typeof v === "string",
  chicagoAutoUnhide: (v) => typeof v === "boolean",
  chicagoUserDeniedBundleIds: isStringArray,
  vmMemoryGB: isNonNegInt,
  vmCpuCount: isNonNegInt,
  ccAutoArchiveOnPrClose: (v) => typeof v === "boolean",
  epitaxyPrefs: isPlainObject,
};

const PRODUCT_RESIDUAL_VALIDATORS: Record<string, Validator> = {
  locale: (v) => typeof v === "string" && v.length > 0,
  deploymentMode: (v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean",
  /**
   * Host-loop policy residual. Only boolean accepted; never coerce string "true".
   * Absence elsewhere does not invent true (resolve path uses === true).
   */
  requireCoworkFullVmSandbox: (v) => typeof v === "boolean",
};

export type AppPreferenceValidationResult =
  | { ok: true; key: string; value: unknown }
  | { ok: false; reason: string };

export function isOfficialAppPreferenceKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    OFFICIAL_APP_PREFERENCE_DEFAULTS,
    key,
  );
}

export function isProductResidualPreferenceKey(key: string): boolean {
  return (PRODUCT_RESIDUAL_PREFERENCE_KEYS as readonly string[]).includes(key);
}

/**
 * Validate inbound setPreference(key, value).
 * Unknown keys → ok:false (official silent drop → product returns false).
 * Invalid types → ok:false.
 */
export function validateAppPreference(
  key: unknown,
  value: unknown,
): AppPreferenceValidationResult {
  if (typeof key !== "string" || key.length === 0) {
    return { ok: false, reason: "invalid key" };
  }

  if (isOfficialAppPreferenceKey(key)) {
    const validator = OFFICIAL_VALIDATORS[key];
    if (!validator) {
      return { ok: false, reason: `missing validator for ${key}` };
    }
    if (!validator(value)) {
      return {
        ok: false,
        reason: `Failed to validate inbound preference (key=${key})`,
      };
    }
    // Official: accelerator objects must pass ent() or throw.
    const accel = assertValidAcceleratorInPreferenceValue(value);
    if (!accel.ok) {
      return { ok: false, reason: accel.reason };
    }
    return { ok: true, key, value };
  }

  if (isProductResidualPreferenceKey(key)) {
    const validator = PRODUCT_RESIDUAL_VALIDATORS[key];
    if (!validator || !validator(value)) {
      return {
        ok: false,
        reason: `Failed to validate residual preference (key=${key})`,
      };
    }
    return { ok: true, key, value };
  }

  return { ok: false, reason: `unknown preference key: ${key}` };
}
