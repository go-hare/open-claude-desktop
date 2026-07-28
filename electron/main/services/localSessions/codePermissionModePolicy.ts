/**
 * Official bypassPermissionsModeEnabled residual consumers (app.asar):
 *
 * Main process clamp (dispatch / child session seed):
 *   mode === "bypassPermissions" && gi("bypassPermissionsModeEnabled") !== true
 *     → "acceptEdits"
 *
 * Frontend te() (c3d5d2a6f): composer may offer bypass only when preference is true
 * (plus feature/raven gates already handled on settings page).
 *
 * Product Code path:
 *   - getDefaultPermissionMode never invents bypass
 *   - setPermissionMode / spawn / start clamp bypass when pref off
 *   - web menus filter bypass when pref off
 */

export const CODE_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "auto",
  "dontAsk",
] as const;

export type CodePermissionMode = (typeof CODE_PERMISSION_MODES)[number] | string;

/**
 * Official clamp: bypass only when bypassPermissionsModeEnabled === true.
 * Other modes pass through unchanged.
 */
export function clampCodePermissionMode(
  mode: string | null | undefined,
  bypassPermissionsModeEnabled: boolean,
): string {
  const normalized = normalizeCodePermissionMode(mode);
  if (normalized === "bypassPermissions" && bypassPermissionsModeEnabled !== true) {
    return "acceptEdits";
  }
  return normalized;
}

export function normalizeCodePermissionMode(mode: string | null | undefined): string {
  if (!mode) return "default";
  if (mode === "bypass") return "bypassPermissions";
  if (CODE_PERMISSION_MODES.includes(mode as (typeof CODE_PERMISSION_MODES)[number])) {
    return mode;
  }
  return "default";
}

/** Modes offered in the Code composer Mode menu (official Os subset + product labels). */
export function availableCodePermissionModes(
  bypassPermissionsModeEnabled: boolean,
): string[] {
  const modes = ["default", "acceptEdits", "plan"];
  if (bypassPermissionsModeEnabled === true) {
    modes.push("bypassPermissions");
  }
  return modes;
}
