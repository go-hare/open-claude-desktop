import { ClaudeCliRunner } from "../services/localSessions/claudeCliRunner";
import type { IpcHandlerContext } from "./context";
import { originalEventSurface } from "./originalEventSurface";

const runners = new WeakMap<IpcHandlerContext, ClaudeCliRunner>();

function eventMarker(event: Record<string, unknown>): string {
  return [event.type, event.kind, event.subtype, event.event]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function hasObjectField(event: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => typeof event[key] === "object" && event[key] !== null);
}

/** Code LocalSessions runner events only. Cowork uses CoworkSessionManager.emit → onEvent. */
export function dispatchLocalSessionEvent(
  context: IpcHandlerContext,
  event: Record<string, unknown>,
): void {
  const events = originalEventSurface(context);
  events.localSessionEvent(event);
  const marker = eventMarker(event);
  if (
    marker.includes("tool_permission")
    || marker.includes("permission_request")
    || hasObjectField(event, "toolPermissionRequest", "permissionRequest")
  ) {
    events.localSessionToolPermissionRequest(event);
  }
  if (marker.includes("ssh_password") || hasObjectField(event, "sshPasswordRequest")) {
    events.localSessionSshPasswordRequired(event);
  }
}

export function getLocalSessionRunner(context: IpcHandlerContext): ClaudeCliRunner {
  const existing = runners.get(context);
  if (existing) return existing;

  const runner = new ClaudeCliRunner(context.localSessions, {
    onEvent: (event) => dispatchLocalSessionEvent(context, event),
    onSessionUpdated: (sessionId) => {
      const session = context.localSessions.getSession(sessionId);
      if (session) {
        dispatchLocalSessionEvent(context, {
          type: "session_updated",
          sessionId,
          session,
        });
      }
    },
  });
  runners.set(context, runner);
  return runner;
}
