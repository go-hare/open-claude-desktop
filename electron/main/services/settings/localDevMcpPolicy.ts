/**
 * Official app.asar residual for Developer / DXT enable gates:
 *
 *   async function InA() {
 *     return vi().isLocalDevMcpEnabled === false
 *       ? false
 *       : (Xo().features)?.isLocalDevMcpEnabled !== false;
 *   }
 *
 *   // isDxt residual (same shape):
 *   return vi().isDesktopExtensionEnabled === false
 *     ? false
 *     : (Xo().features)?.isDxtEnabled !== false;
 *
 * Absent enterprise key is NOT false. Absent features key is NOT false
 * (default enabled). Only explicit `false` disables.
 */

export type LocalDevMcpPolicyInput = {
  /** vi().isLocalDevMcpEnabled — undefined when enterprise key absent */
  enterpriseIsLocalDevMcpEnabled?: boolean;
  /** Xo().features?.isLocalDevMcpEnabled */
  featureIsLocalDevMcpEnabled?: unknown;
};

export type DxtEnabledPolicyInput = {
  /** vi().isDesktopExtensionEnabled */
  enterpriseIsDesktopExtensionEnabled?: boolean;
  /** Xo().features?.isDxtEnabled */
  featureIsDxtEnabled?: unknown;
};

/** Official InA residual. */
export function resolveIsLocalDevMcpEnabled(
  input: LocalDevMcpPolicyInput = {},
): boolean {
  if (input.enterpriseIsLocalDevMcpEnabled === false) return false;
  return input.featureIsLocalDevMcpEnabled !== false;
}

/** Official isDxtEnabled residual (enterprise isDesktopExtensionEnabled). */
export function resolveIsDxtEnabled(input: DxtEnabledPolicyInput = {}): boolean {
  if (input.enterpriseIsDesktopExtensionEnabled === false) return false;
  return input.featureIsDxtEnabled !== false;
}
