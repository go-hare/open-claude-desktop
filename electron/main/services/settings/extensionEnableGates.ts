/**
 * Official Extensions enable gates residual (app.asar index.js):
 *
 *   async function HN() {
 *     return vi().isDesktopExtensionEnabled === false
 *       ? false
 *       : (Xo().features)?.isDxtEnabled !== false;
 *   }
 *   async function YPA() {
 *     if (await HN()) {
 *       if (vi().isDesktopExtensionDirectoryEnabled === false) return false;
 *       if ((Xo().features)?.isDxtDirectoryEnabled === false) return false;
 *     } else return false;
 *     return true;
 *   }
 *   async function L6e() {
 *     return vi().isDesktopExtensionSignatureRequired === true;
 *   }
 *   async function b6e() {
 *     return vi().isDesktopExtensionDirectoryEnabled === true;
 *   }
 *   async function rKA() {
 *     if (Ii().hasOrgPolicyBackend()) { ... checkAndDisableBlockedExtensions }
 *   }
 *
 * data-official-source: app.asar index.js HN / YPA / L6e / b6e / rKA
 * Absent enterprise key is NOT false (L6e/b6e require === true).
 * Product has no org policy backend → refreshAllowlistCheck is honest no-op.
 */

import { getCoworkEnterpriseBoolean } from "../coworkHostLoop/coworkEnterpriseConfig";
import { resolveIsDxtEnabled } from "./localDevMcpPolicy";
import type { SettingsStore } from "./settingsStore";

export type ExtensionGateDeps = {
  settings?: Pick<SettingsStore, "isDxtEnabled" | "getAppConfig">;
  /** Inject enterprise booleans for tests. */
  enterprise?: {
    isDesktopExtensionEnabled?: boolean;
    isDesktopExtensionDirectoryEnabled?: boolean;
    isDesktopExtensionSignatureRequired?: boolean;
  };
  /** Inject Xo().features for tests. */
  features?: Record<string, unknown>;
  /** Residual Ii().hasOrgPolicyBackend — product default false. */
  hasOrgPolicyBackend?: boolean;
};

function readFeatures(
  deps: ExtensionGateDeps,
): Record<string, unknown> {
  if (deps.features) return deps.features;
  const appConfig = deps.settings?.getAppConfig?.();
  const features = appConfig?.features;
  return typeof features === "object" && features !== null
    ? (features as Record<string, unknown>)
    : {};
}

function enterpriseBool(
  key:
    | "isDesktopExtensionEnabled"
    | "isDesktopExtensionDirectoryEnabled"
    | "isDesktopExtensionSignatureRequired",
  deps: ExtensionGateDeps,
): boolean | undefined {
  const injected = deps.enterprise?.[key];
  if (typeof injected === "boolean") return injected;
  return getCoworkEnterpriseBoolean(key);
}

/** Official HN — isExtensionsEnabled / isDxt residual. */
export function isExtensionsEnabledResidual(deps: ExtensionGateDeps = {}): boolean {
  if (deps.settings?.isDxtEnabled) {
    return deps.settings.isDxtEnabled();
  }
  const features = readFeatures(deps);
  return resolveIsDxtEnabled({
    enterpriseIsDesktopExtensionEnabled: enterpriseBool(
      "isDesktopExtensionEnabled",
      deps,
    ),
    featureIsDxtEnabled: features.isDxtEnabled,
  });
}

/**
 * Official YPA — directory install path enabled only when HN &&
 * enterprise directory !== false && features.isDxtDirectoryEnabled !== false.
 */
export function isDirectoryEnabledResidual(deps: ExtensionGateDeps = {}): boolean {
  if (!isExtensionsEnabledResidual(deps)) return false;
  if (enterpriseBool("isDesktopExtensionDirectoryEnabled", deps) === false) {
    return false;
  }
  const features = readFeatures(deps);
  if (features.isDxtDirectoryEnabled === false) return false;
  return true;
}

/** Official L6e — signature required only when enterprise === true. */
export function isDesktopExtensionSignatureRequiredResidual(
  deps: ExtensionGateDeps = {},
): boolean {
  return enterpriseBool("isDesktopExtensionSignatureRequired", deps) === true;
}

/** Official b6e — directory enabled only when enterprise === true. */
export function isDesktopExtensionDirectoryEnabledResidual(
  deps: ExtensionGateDeps = {},
): boolean {
  return enterpriseBool("isDesktopExtensionDirectoryEnabled", deps) === true;
}

/**
 * Official rKA — only runs when hasOrgPolicyBackend().
 * Product shell has no org policy backend → no-op (do not invent success).
 * Returns whether any org-policy work ran.
 */
export async function refreshAllowlistCheckResidual(
  deps: ExtensionGateDeps = {},
): Promise<{ ran: boolean; reason?: string }> {
  const hasBackend = deps.hasOrgPolicyBackend === true;
  if (!hasBackend) {
    return { ran: false, reason: "no_org_policy_backend" };
  }
  // No product org-policy implementation yet — honest no-op even if flag forced.
  return { ran: false, reason: "org_policy_backend_unimplemented" };
}
