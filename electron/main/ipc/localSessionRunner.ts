import { ClaudeCliRunner } from "../services/localSessions/claudeCliRunner";
import type { IpcHandlerContext } from "./context";
import { dispatchBridgeEvent } from "./registerIpc";

type SessionBridgeInterface = "LocalSessions" | "LocalAgentModeSessions";

const runners = new WeakMap<IpcHandlerContext, Partial<Record<SessionBridgeInterface, ClaudeCliRunner>>>();

function eventMarker(event: Record<string, unknown>): string {
  return [event.type, event.kind, event.subtype, event.event]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function hasObjectField(event: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => typeof event[key] === "object" && event[key] !== null);
}

export function dispatchSessionRunnerEvent(context: IpcHandlerContext, iface: SessionBridgeInterface, event: Record<string, unknown>): void {
  dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", iface, "onEvent", event);
  const marker = eventMarker(event);
  if (marker.includes("tool_permission") || marker.includes("permission_request") || hasObjectField(event, "toolPermissionRequest", "permissionRequest")) {
    dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", iface, "onToolPermissionRequest", event);
  }
  if (iface === "LocalSessions" && (marker.includes("ssh_password") || hasObjectField(event, "sshPasswordRequest"))) {
    dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", iface, "onSSHPasswordRequired", event);
  }
}

export function dispatchLocalSessionEvent(context: IpcHandlerContext, event: Record<string, unknown>): void {
  dispatchSessionRunnerEvent(context, "LocalSessions", event);
}

function getRunnerStore(context: IpcHandlerContext, iface: SessionBridgeInterface) {
  return iface === "LocalSessions" ? context.localSessions : context.localAgentModeSessions;
}

export function getLocalSessionRunner(context: IpcHandlerContext): ClaudeCliRunner {
  return getSessionRunner(context, "LocalSessions");
}

export function getSessionRunner(context: IpcHandlerContext, iface: SessionBridgeInterface): ClaudeCliRunner {
  const scoped = runners.get(context) ?? {};
  const existing = scoped[iface];
  if (existing) return existing;

  const store = getRunnerStore(context, iface);
  const runner = new ClaudeCliRunner(store, {
    onEvent: (event) => dispatchSessionRunnerEvent(context, iface, event),
    onSessionUpdated: (sessionId) => {
      const session = store.getSession(sessionId);
      if (session) dispatchSessionRunnerEvent(context, iface, { type: "session_updated", sessionId, session });
    },
  });
  scoped[iface] = runner;
  runners.set(context, scoped);
  return runner;
}
