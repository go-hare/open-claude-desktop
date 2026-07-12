import {
  readCoworkForceHostLoopEnv,
  readCoworkHostLoopFeatureEnv,
  resolveCoworkHostLoopModeForNewSession,
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
  getRequireCoworkFullVmSandbox?: () => boolean;
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
  return {
    forceDisableHostLoop: options.getForceDisableHostLoop?.() === true,
    forceHostLoopEnv: readCoworkForceHostLoopEnv(env),
    hostLoopFeatureEnabled: options.getHostLoopFeatureEnabled?.()
      ?? readCoworkHostLoopFeatureEnv(env)
      ?? false,
    isDeveloperApprovedDevUrlOverrideEnabled:
      options.getIsDeveloperApprovedDevUrlOverrideEnabled?.() === true
      || (globalThis as { isDeveloperApprovedDevUrlOverrideEnabled?: boolean })
        .isDeveloperApprovedDevUrlOverrideEnabled === true,
    requireCoworkFullVmSandbox: options.getRequireCoworkFullVmSandbox?.() === true,
  };
}
