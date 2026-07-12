/**
 * Official host-loop decision (app.asar LocalAgentModeSessionManager):
 *
 *   forceDisableHostLoop = store.get("forceDisableHostLoop", false)
 *   requireCoworkFullVmSandbox = account/org.requireCoworkFullVmSandbox === true
 *   featureEnabled = GrowthBook flag "1143815894"
 *
 *   v4() / new session:
 *     if (requireCoworkFullVmSandbox || forceDisableHostLoop) return false
 *     if (devUrlOverride && CLAUDE_FORCE_HOST_LOOP === "1") return true
 *     return featureEnabled
 *
 *   resume:
 *     if (existingHostLoopMode && requireCoworkFullVmSandbox) throw
 *     hostLoopMode = existingHostLoopMode === true
 */

export const COWORK_HOST_LOOP_FEATURE_FLAG_ID = "1143815894";

export const COWORK_HOST_LOOP_RESUME_REJECTED =
  "This session was created before your organization required the VM sandbox. It cannot be resumed under the current policy. Please start a new session.";

export type CoworkHostLoopPolicy = {
  /** Store key forceDisableHostLoop / ClaudeVM.setForceDisableHostLoop */
  forceDisableHostLoop?: boolean;
  /** Env CLAUDE_FORCE_HOST_LOOP === "1" */
  forceHostLoopEnv?: boolean;
  /**
   * GrowthBook flag 1143815894.
   * When the product flag source is unavailable, callers may pass an operational
   * default; do not hard-wire true inside the pure policy function.
   */
  hostLoopFeatureEnabled?: boolean;
  /** globalThis.isDeveloperApprovedDevUrlOverrideEnabled */
  isDeveloperApprovedDevUrlOverrideEnabled?: boolean;
  /** org policy requireCoworkFullVmSandbox === true */
  requireCoworkFullVmSandbox?: boolean;
};

export type ResolveCoworkHostLoopModeInput = {
  existingHostLoopMode?: boolean;
  isNewSession: boolean;
  policy: CoworkHostLoopPolicy;
};

export function resolveCoworkHostLoopModeForNewSession(policy: CoworkHostLoopPolicy): boolean {
  if (policy.requireCoworkFullVmSandbox === true || policy.forceDisableHostLoop === true) {
    return false;
  }
  if (
    policy.isDeveloperApprovedDevUrlOverrideEnabled === true
    && policy.forceHostLoopEnv === true
  ) {
    return true;
  }
  return policy.hostLoopFeatureEnabled === true;
}

export function resolveCoworkHostLoopMode(input: ResolveCoworkHostLoopModeInput): boolean {
  if (!input.isNewSession) {
    return input.existingHostLoopMode === true;
  }
  return resolveCoworkHostLoopModeForNewSession(input.policy);
}

export function shouldRejectCoworkHostLoopResume(
  existingHostLoopMode: boolean | undefined,
  requireCoworkFullVmSandbox: boolean | undefined,
): boolean {
  return existingHostLoopMode === true && requireCoworkFullVmSandbox === true;
}

export function readCoworkForceHostLoopEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.CLAUDE_FORCE_HOST_LOOP === "1";
}

export function readCoworkHostLoopFeatureEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  const value = env.CLAUDE_HOST_LOOP_FEATURE ?? env.CLAUDE_HOST_LOOP_FLAG;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
}
