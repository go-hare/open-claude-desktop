/**
 * Official AppPreferences defaults (app.asar SSA) + product residual keys.
 *
 * Official merge (bLA):
 *   return { ...SSA, ...legacyMigration, ...storedPreferences }
 *
 * Product residual keys (not in SSA; used by shell IPC):
 *   - locale (DesktopIntl)
 *   - deploymentMode (Custom3pSetup.setDeploymentMode)
 *   - requireCoworkFullVmSandbox (host-loop policy residual; never invent true)
 *
 * Do not invent enterprise MDM true from absence of require key.
 */

/** Official SSA bag (index.js). */
export const OFFICIAL_APP_PREFERENCE_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  menuBarEnabled: true,
  legacyQuickEntryEnabled: true,
  chromeExtensionEnabled: true,
  chromeExtension: {},
  quickEntryShortcut: "double-tap-option",
  quickEntryDictationShortcut: "off",
  hardwareBuddyEnabled: false,
  plushRaccoonEnabled: false,
  quietPenguinEnabled: false,
  louderPenguinEnabled: false,
  floatingPenguinEnabled: false,
  plushRaccoonOption1: "off",
  plushRaccoonOption2: "off",
  plushRaccoonOption3: "off",
  chillingSlothLocation: "default",
  ccBranchPrefix: "claude",
  ccMaxWarmWorktrees: 3,
  ccWorktreeReapAfterHours: 24,
  secureVmFeaturesEnabled: true,
  launchEnabled: true,
  launchPreviewPersistSession: false,
  launchPreviewPersistedWorkspaces: [],
  localAgentModeTrustedFolders: [],
  allowAllBrowserActions: false,
  dispatchTrustedCodeWorkspaces: [],
  dispatchCodeTasksPermissionMode: "acceptEdits",
  coworkScheduledTasksEnabled: false,
  ccdScheduledTasksEnabled: false,
  sidebarMode: "chat",
  bypassPermissionsModeEnabled: false,
  dockBounceEnabled: false,
  coworkWebSearchEnabled: true,
  coworkDisabledTools: [],
  coworkSpaceContextEnabled: false,
  keepAwakeEnabled: false,
  wakeSchedulerEnabled: false,
  wakeSchedulerApprovedThisCycle: false,
  wakeSchedulerRegisteredAtVersion: "",
  wakeSchedulerCourtesyFlippedKeepAwake: false,
  coworkOnboardingResumeStep: null,
  chicagoEnabled: false,
  remoteToolsDeviceName: "",
  chicagoAutoUnhide: true,
  chicagoUserDeniedBundleIds: [],
  vmMemoryGB: 0,
  vmCpuCount: 0,
  ccAutoArchiveOnPrClose: false,
  epitaxyPrefs: {},
});

/**
 * Product residual preference keys accepted by setPreference but not in official HSA/SSA.
 * Values are not defaulted into getPreferences unless written (do not invent).
 */
export const PRODUCT_RESIDUAL_PREFERENCE_KEYS = Object.freeze([
  "locale",
  "deploymentMode",
  "requireCoworkFullVmSandbox",
] as const);

export type ProductResidualPreferenceKey =
  (typeof PRODUCT_RESIDUAL_PREFERENCE_KEYS)[number];

export const OFFICIAL_APP_PREFERENCE_KEYS = Object.freeze(
  Object.keys(OFFICIAL_APP_PREFERENCE_DEFAULTS),
);

/** bLA residual: SSA defaults under stored preferences. */
export function mergeAppPreferences(
  stored: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return {
    ...OFFICIAL_APP_PREFERENCE_DEFAULTS,
    ...(stored ?? {}),
  };
}
