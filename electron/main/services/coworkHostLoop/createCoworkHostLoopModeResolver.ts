import {
  readCoworkForceHostLoopEnv,
  readCoworkHostLoopFeatureEnv,
  resolveCoworkHostLoopModeForNewSession,
  resolveCoworkRequireFullVmSandbox,
  type CoworkHostLoopPolicy,
} from "./coworkHostLoopMode";

export type CoworkHostLoopModeResolverOptions = {
  env?: NodeJS.ProcessEnv;
  getForceDisableHostLoop?: () => boolean;
  /**
   * GrowthBook flag 1143815894. When unavailable, return a documented operational
   * default from the caller — never hard-wire true inside the pure policy.
   */
  getHostLoopFeatureEnabled?: () => boolean;
  getIsDeveloperApprovedDevUrlOverrideEnabled?: () => boolean;
  /**
   * Official vi().requireCoworkFullVmSandbox. Prefer account/org when product-wired;
   * settings/env residual accepted via resolveCoworkRequireFullVmSandbox.
   */
  getRequireCoworkFullVmSandbox?: () => boolean;
  /** Settings preference residual when getRequire… omitted. */
  getRequireCoworkFullVmSandboxPreference?: () => unknown;
};

/** Pure new-session host-loop decision used by CoworkSessionManager.start. */
export function createCoworkHostLoopModeResolver(
  options: CoworkHostLoopModeResolverOptions = {},
): () => boolean {
  return () => resolveCoworkHostLoopModeForNewSession(readCoworkHostLoopPolicy(options));
}

export function readCoworkHostLoopPolicy(
  options: CoworkHostLoopModeResolverOptions = {},
): CoworkHostLoopPolicy {
  const env = options.env ?? process.env;
  const requireFromGetter = options.getRequireCoworkFullVmSandbox?.();
  const requireCoworkFullVmSandbox =
    requireFromGetter === true
    || (requireFromGetter === false
      ? false
      : resolveCoworkRequireFullVmSandbox({
          env,
          preferenceValue: options.getRequireCoworkFullVmSandboxPreference?.(),
        }));
  return {
    forceDisableHostLoop: options.getForceDisableHostLoop?.() === true,
    forceHostLoopEnv: readCoworkForceHostLoopEnv(env),
    // Explicit env residual wins over GrowthBook kni/ft (operator override).
    hostLoopFeatureEnabled: readCoworkHostLoopFeatureEnv(env)
      ?? options.getHostLoopFeatureEnabled?.()
      ?? false,
    isDeveloperApprovedDevUrlOverrideEnabled:
      options.getIsDeveloperApprovedDevUrlOverrideEnabled?.() === true
      || (globalThis as { isDeveloperApprovedDevUrlOverrideEnabled?: boolean })
        .isDeveloperApprovedDevUrlOverrideEnabled === true,
    requireCoworkFullVmSandbox,
  };
}
