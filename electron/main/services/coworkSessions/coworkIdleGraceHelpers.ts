/**
 * Official LocalAgentModeSessionManager idle-grace residual (app.asar):
 *   transitionTo idle:
 *     idleGraceMs = wr("1978029737","idleGraceMs",0,ni())
 *     I = !error && priorState==="running"
 *     E = !!query && !!inputStream
 *     lastIdleAt = now
 *     if ms>0 && I && E && sessionType!==dispatch_child && !==radar
 *       → arm _idleGraceTimer → on fire: if still idle → teardownIdleProcess
 *     else → teardownIdleProcess
 *   cancelIdleGrace(session,{teardown}):
 *     clear timer; if teardown → teardownIdleProcess else je lam_idle_grace_hit (reuse)
 *   sendMessage: if _idleGraceTimer → cancelIdleGrace({teardown:false}) + running
 *   stopSession early: cancelIdleGrace({teardown:true})
 *
 * Residual honesty:
 * - Real Statsig wr idleGraceMs product store not invented — inject getIdleGraceMs
 *   default 0.
 * - When ms===0 product keeps warm query (existing resume path) instead of official
 *   immediate teardownIdleProcess — documented residual.
 * - full healthMonitor / memorySync product stores not invented; mcpServersDirty
 *   deferred setMcpServers flush is product (#126) on warm arm only.
 */

import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";
import { getCoworkVmInstanceId } from "./coworkSessionLifecycleAnalytics";

/** Official DE — skip idle grace arm. */
export const COWORK_IDLE_GRACE_SKIP_SESSION_TYPES = new Set<string>([
  "dispatch_child",
  "radar",
]);

export type CoworkIdleGraceSession = Pick<
  CoworkSessionRuntimeState,
  | "_idleGraceTimer"
  | "_idleGraceStartedAt"
  | "_lastIdleAt"
  | "lifecycleState"
  | "query"
  | "inputStream"
  | "sessionId"
  | "sessionType"
>;

export type CoworkIdleGraceArmDecision =
  | { arm: true; graceMs: number }
  | { arm: false; reason: "ms_zero" | "not_from_running" | "has_error" | "no_process" | "skip_session_type" };

/**
 * Official transitionTo idle arm gate (pure).
 * Prior state must be "running" (official `r==="running"`).
 */
export function resolveCoworkIdleGraceArm(input: {
  graceMs: number;
  fromRunning: boolean;
  hasError: boolean;
  hasQuery: boolean;
  hasInputStream: boolean;
  sessionType?: string | null;
}): CoworkIdleGraceArmDecision {
  if (!(input.graceMs > 0)) return { arm: false, reason: "ms_zero" };
  if (!input.fromRunning) return { arm: false, reason: "not_from_running" };
  if (input.hasError) return { arm: false, reason: "has_error" };
  if (!input.hasQuery || !input.hasInputStream) {
    return { arm: false, reason: "no_process" };
  }
  if (
    typeof input.sessionType === "string" &&
    COWORK_IDLE_GRACE_SKIP_SESSION_TYPES.has(input.sessionType)
  ) {
    return { arm: false, reason: "skip_session_type" };
  }
  return { arm: true, graceMs: input.graceMs };
}

/**
 * Official: clearTimeout + void timer/startedAt fields.
 * Returns elapsed ms when startedAt was set, else undefined.
 */
export function clearCoworkIdleGraceTimer(
  session: Pick<CoworkIdleGraceSession, "_idleGraceTimer" | "_idleGraceStartedAt">,
  now: () => number = Date.now,
): { hadTimer: boolean; graceElapsedMs: number | undefined } {
  const hadTimer = session._idleGraceTimer !== undefined;
  if (session._idleGraceTimer) {
    clearTimeout(session._idleGraceTimer);
    session._idleGraceTimer = undefined;
  }
  const graceElapsedMs =
    session._idleGraceStartedAt !== undefined
      ? Math.max(0, now() - session._idleGraceStartedAt)
      : undefined;
  session._idleGraceStartedAt = undefined;
  return { hadTimer, graceElapsedMs };
}

/**
 * Official arm: _idleGraceStartedAt=now; _idleGraceTimer=setTimeout(onFire, graceMs).
 * Clears any existing timer first.
 */
export function armCoworkIdleGraceTimer(
  session: Pick<
    CoworkIdleGraceSession,
    "_idleGraceTimer" | "_idleGraceStartedAt" | "sessionId"
  >,
  input: {
    graceMs: number;
    now?: () => number;
    onFire: () => void;
  },
): void {
  clearCoworkIdleGraceTimer(session, input.now ?? Date.now);
  const now = input.now ?? Date.now;
  session._idleGraceStartedAt = now();
  session._idleGraceTimer = setTimeout(() => {
    // Official: clear timer field first; compute elapsed from startedAt then void it.
    session._idleGraceTimer = undefined;
    const startedAt = session._idleGraceStartedAt;
    session._idleGraceStartedAt = undefined;
    void startedAt;
    // Caller onFire uses lifecycleState + _lastIdleAt for elapsed residual.
    input.onFire();
  }, input.graceMs);
}

/** Official timer fire: only teardown when lifecycle still idle. */
export function shouldTeardownOnCoworkIdleGraceFire(
  lifecycleState: string | undefined,
): boolean {
  return lifecycleState === "idle";
}

export type CoworkIdleGraceHitAnalytics = {
  session_id: string;
  vm_instance_id: string;
  grace_elapsed_ms: number | undefined;
};

export function buildCoworkIdleGraceHitProps(
  sessionId: string,
  graceElapsedMs: number | undefined,
): CoworkIdleGraceHitAnalytics {
  return {
    session_id: sessionId,
    vm_instance_id: getCoworkVmInstanceId(),
    grace_elapsed_ms: graceElapsedMs,
  };
}

export type CoworkIdleGraceExpiredAnalytics = {
  session_id: string;
  vm_instance_id: string;
  grace_elapsed_ms: number | undefined;
};

export function buildCoworkIdleGraceExpiredProps(
  sessionId: string,
  graceElapsedMs: number | undefined,
): CoworkIdleGraceExpiredAnalytics {
  return {
    session_id: sessionId,
    vm_instance_id: getCoworkVmInstanceId(),
    grace_elapsed_ms: graceElapsedMs,
  };
}

/**
 * Official sendMessage head flag: I = !!_idleGraceTimer before cancel.
 * Used with suggestion flags for optional session_updated.
 */
export function hasCoworkIdleGraceTimer(
  session: Pick<CoworkIdleGraceSession, "_idleGraceTimer">,
): boolean {
  return session._idleGraceTimer !== undefined;
}
