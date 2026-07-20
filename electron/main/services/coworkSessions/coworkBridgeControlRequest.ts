/**
 * Official LocalAgentMode bridge handleInboundControlRequest (app.asar):
 *   if request.subtype !== "interrupt" → return (no-op)
 *   activeSessions.get(remoteSessionId) missing → je outcome "no_session"
 *   !localSessionId → je outcome "no_local_session"
 *   else sessionManager.interruptTurn(localSessionId) + je "interrupted"
 *
 * Full remote bridge / activeSessions transport product is residual.
 * This pure helper is the control_request→interruptTurn residual product can call.
 */

export type CoworkBridgeInterruptOutcome =
  | "ignored_non_interrupt"
  | "no_session"
  | "no_local_session"
  | "interrupted";

export type CoworkBridgeInterruptAnalyticsProps = {
  session_id: string;
  local_session_id: string | null;
  request_id: string | null;
  outcome: Exclude<CoworkBridgeInterruptOutcome, "ignored_non_interrupt">;
};

export type CoworkBridgeActiveSessionRef = {
  localSessionId?: string | null;
};

/**
 * Official shape residual for control_request message:
 *   { type:"control_request", request_id?, request:{ subtype } }
 */
export function isCoworkBridgeInterruptControlRequest(
  message: unknown,
): boolean {
  if (!message || typeof message !== "object") return false;
  const m = message as { type?: unknown; request?: unknown };
  if (m.type !== "control_request") return false;
  const req = m.request;
  if (!req || typeof req !== "object") return false;
  return (req as { subtype?: unknown }).subtype === "interrupt";
}

export function extractCoworkBridgeControlRequestId(
  message: unknown,
): string | null {
  if (!message || typeof message !== "object") return null;
  const id = (message as { request_id?: unknown }).request_id;
  return typeof id === "string" ? id : null;
}

/**
 * Pure decision for official handleInboundControlRequest interrupt branch.
 * Does not call interruptTurn — caller invokes when outcome would be interrupted.
 */
export function resolveCoworkBridgeInterruptControlRequest(input: {
  remoteSessionId: string;
  message: unknown;
  activeSession: CoworkBridgeActiveSessionRef | null | undefined;
}): {
  outcome: CoworkBridgeInterruptOutcome;
  localSessionId: string | null;
  requestId: string | null;
  analytics: CoworkBridgeInterruptAnalyticsProps | null;
} {
  const requestId = extractCoworkBridgeControlRequestId(input.message);
  if (!isCoworkBridgeInterruptControlRequest(input.message)) {
    return {
      outcome: "ignored_non_interrupt",
      localSessionId: null,
      requestId,
      analytics: null,
    };
  }
  if (!input.activeSession) {
    return {
      outcome: "no_session",
      localSessionId: null,
      requestId,
      analytics: {
        session_id: input.remoteSessionId,
        local_session_id: null,
        request_id: requestId,
        outcome: "no_session",
      },
    };
  }
  const local =
    typeof input.activeSession.localSessionId === "string" &&
    input.activeSession.localSessionId.length > 0
      ? input.activeSession.localSessionId
      : null;
  if (!local) {
    return {
      outcome: "no_local_session",
      localSessionId: null,
      requestId,
      analytics: {
        session_id: input.remoteSessionId,
        local_session_id: null,
        request_id: requestId,
        outcome: "no_local_session",
      },
    };
  }
  return {
    outcome: "interrupted",
    localSessionId: local,
    requestId,
    analytics: {
      session_id: input.remoteSessionId,
      local_session_id: local,
      request_id: requestId,
      outcome: "interrupted",
    },
  };
}

/**
 * Official handleInboundControlRequest interrupt path as async effect helper.
 * Product injects getActiveSession + interruptTurn + optional analytics sink.
 */
export async function handleCoworkBridgeInterruptControlRequest(input: {
  remoteSessionId: string;
  message: unknown;
  getActiveSession: (
    remoteSessionId: string,
  ) => CoworkBridgeActiveSessionRef | null | undefined;
  interruptTurn: (localSessionId: string) => void | Promise<void>;
  track?: (props: CoworkBridgeInterruptAnalyticsProps) => void;
}): Promise<CoworkBridgeInterruptOutcome> {
  const resolved = resolveCoworkBridgeInterruptControlRequest({
    remoteSessionId: input.remoteSessionId,
    message: input.message,
    activeSession: input.getActiveSession(input.remoteSessionId),
  });
  if (resolved.analytics) {
    try {
      input.track?.(resolved.analytics);
    } catch (error) {
      console.warn(
        "[coworkBridgeControlRequest] track failed: %o",
        error,
      );
    }
  }
  if (resolved.outcome === "interrupted" && resolved.localSessionId) {
    await input.interruptTurn(resolved.localSessionId);
  }
  return resolved.outcome;
}
