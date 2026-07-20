import {
  trackCoworkPermissionAnalytics,
  type CoworkPermissionAnalyticsProps,
} from "./coworkPermissionAnalytics";
import { CoworkPermissionBroker } from "./coworkPermissionBroker";
import type { CoworkSessionManagerOptions } from "./coworkSessionManagerTypes";
import type { CoworkSessionRepository } from "./coworkSessionRepository";
import type { CoworkPendingPermission } from "./coworkSessionTypes";

/**
 * Official LocalAgentModeSessionManager je props for permission analytics.
 * `session_type` is always "cowork" on this manager path.
 */
function analyticsPropsForPending(
  repository: CoworkSessionRepository,
  pending: CoworkPendingPermission,
  extra?: Partial<CoworkPermissionAnalyticsProps>,
): CoworkPermissionAnalyticsProps {
  const session = repository.get(pending.sessionId);
  return {
    permission_mode: session?.permissionMode ?? null,
    request_id: pending.requestId,
    session_id: pending.sessionId,
    session_type: "cowork",
    tool_name: pending.toolName,
    user_message_uuid: session?.pendingUserMessageUuid ?? null,
    ...extra,
  };
}

export function createCoworkManagerPermissionBroker(
  options: CoworkSessionManagerOptions,
  repository: CoworkSessionRepository,
): CoworkPermissionBroker {
  const brokerOptions = options.permissionBroker;
  return new CoworkPermissionBroker({
    ...brokerOptions,
    emit: options.emit,
    onRequested: (pending) => {
      brokerOptions?.onRequested?.(pending);
      trackCoworkPermissionAnalytics(
        "lam_tool_permission_requested",
        analyticsPropsForPending(repository, pending),
      );
    },
    onResponded: (pending, decision, latencyMs) => {
      brokerOptions?.onResponded?.(pending, decision, latencyMs);
      trackCoworkPermissionAnalytics(
        "lam_tool_permission_responded",
        analyticsPropsForPending(repository, pending, {
          decision,
          latency_ms: latencyMs,
        }),
      );
    },
    onStalled: (pending) => {
      brokerOptions?.onStalled?.(pending);
      trackCoworkPermissionAnalytics(
        "lam_tool_permission_stalled",
        analyticsPropsForPending(repository, pending, {
          // Official je: seconds_waiting: 300 while still pending.
          seconds_waiting: 300,
        }),
      );
    },
    persistAlwaysAllow: (pending, resolution) => {
      brokerOptions?.persistAlwaysAllow?.(pending, resolution);
      const session = repository.get(pending.sessionId);
      if (session) repository.saveIfInitialized(session);
    },
  });
}
