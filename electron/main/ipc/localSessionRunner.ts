import { app, Notification } from "electron";
import { ClaudeCliRunner } from "../services/localSessions/claudeCliRunner";
import { CodeSessionAttentionService } from "../services/localSessions/codeSessionAttention";
import { CodeDesktopNotificationService } from "../services/localSessions/codeDesktopNotificationService";
import type { IpcHandlerContext } from "./context";
import { originalEventSurface } from "./originalEventSurface";

const runners = new WeakMap<IpcHandlerContext, ClaudeCliRunner>();
const attentionByContext = new WeakMap<IpcHandlerContext, CodeSessionAttentionService>();
const codeNotificationsByContext = new WeakMap<IpcHandlerContext, CodeDesktopNotificationService>();
const focusedCodeSessionByContext = new WeakMap<IpcHandlerContext, string | null>();
/** Official stopFlashFrame on focus — install once per context. */
const attentionFocusHooks = new WeakSet<IpcHandlerContext>();

function eventMarker(event: Record<string, unknown>): string {
  return [event.type, event.kind, event.subtype, event.event]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function hasObjectField(event: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => typeof event[key] === "object" && event[key] !== null);
}

function getCodeSessionAttention(context: IpcHandlerContext): CodeSessionAttentionService {
  const existing = attentionByContext.get(context);
  if (existing) return existing;
  const service = new CodeSessionAttentionService({
    getMainWindow: () => context.windows.mainWindow,
    // Official gi("dockBounceEnabled") residual.
    isDockBounceEnabled: () =>
      context.settings.getPreferences().dockBounceEnabled === true,
  });
  attentionByContext.set(context, service);
  // Official NotificationService: stopFlashFrame when the user returns to the app.
  // Cover main window focus/restore/show + any BrowserWindow focus.
  if (!attentionFocusHooks.has(context)) {
    attentionFocusHooks.add(context);
    const stop = () => {
      try {
        service.stopFlashFrame();
      } catch {
        /* ignore */
      }
    };
    try {
      const main = context.windows.mainWindow;
      if (main && !main.isDestroyed()) {
        main.on("focus", stop);
        main.on("restore", stop);
        main.on("show", stop);
      }
      app.on("browser-window-focus", stop);
    } catch {
      /* window may not be ready yet — runner path still stops on respond */
    }
  }
  return service;
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
    // Attention is fired once from ClaudeCliRunner.registerPendingPermission
    // (onPermissionAttention) — do not double-flash here.
  }
  if (marker.includes("ssh_password") || hasObjectField(event, "sshPasswordRequest")) {
    events.localSessionSshPasswordRequired(event);
  }
}

function getCodeDesktopNotifications(
  context: IpcHandlerContext,
): CodeDesktopNotificationService {
  const existing = codeNotificationsByContext.get(context);
  if (existing) return existing;
  const attention = getCodeSessionAttention(context);
  const service = new CodeDesktopNotificationService({
    backend: Notification.isSupported()
      ? {
          show: (input) => {
            try {
              const n = new Notification({ title: input.title, body: input.body });
              n.show();
            } catch {
              /* best-effort */
            }
          },
          close: () => {
            /* Electron Notification has no global close-by-id; best-effort no-op */
          },
        }
      : null,
    getFocusedSessionId: () => focusedCodeSessionByContext.get(context) ?? null,
    requestUserAttention: () => attention.requestUserAttention(),
  });
  codeNotificationsByContext.set(context, service);
  return service;
}

export function getLocalSessionRunner(context: IpcHandlerContext): ClaudeCliRunner {
  const existing = runners.get(context);
  if (existing) return existing;

  // Wire Claude Code settings → worktree create residual (chillingSloth / ccBranchPrefix).
  context.localSessions.setWorktreePreferenceReaders({
    getChillingSlothLocation: () => {
      const value = context.settings.getPreferences().chillingSlothLocation;
      return value as "default" | string | { customPath: string } | undefined;
    },
    getCcBranchPrefix: () => {
      const value = context.settings.getPreferences().ccBranchPrefix;
      return typeof value === "string" ? value : "claude";
    },
  });

  const attention = getCodeSessionAttention(context);
  const notifications = getCodeDesktopNotifications(context);
  const runner = new ClaudeCliRunner(context.localSessions, {
    onEvent: (event) => {
      dispatchLocalSessionEvent(context, event);
      const marker = eventMarker(event);
      const sessionId = stringField(event, "sessionId") ?? "";
      // Official queryCompleted → showIdle (only on turn completed, not every session_updated).
      if (stringField(event, "type") === "completed" && sessionId) {
        const session = context.localSessions.getSession(sessionId);
        notifications.showIdleNotification({
          sessionId,
          sessionTitle: session?.title,
          scheduledTaskId: session?.scheduledTaskId,
        });
      }
      if (stringField(event, "type") === "stopped" && sessionId) {
        notifications.closeIdleNotificationForSession(sessionId);
      }
      // Official AskUserQuestion path also requestUserAttention + OS notification.
      if (
        marker.includes("ask_user_question")
        || marker.includes("askuserquestion")
        || stringField(event, "toolName") === "AskUserQuestion"
        || stringField(event, "name") === "AskUserQuestion"
      ) {
        const requestId =
          stringField(event, "requestId")
          ?? stringField(event, "toolUseId")
          ?? stringField(asRecord(event.request), "toolUseId")
          ?? `${sessionId}-ask`;
        const session = sessionId ? context.localSessions.getSession(sessionId) : null;
        notifications.showAskUserQuestionNotification({
          requestId,
          sessionId: sessionId || "unknown",
          sessionTitle: session?.title,
          questionText:
            stringField(event, "question")
            ?? stringField(event, "text")
            ?? stringField(asRecord(event.request), "question"),
        });
      }
    },
    onSessionUpdated: (sessionId) => {
      const session = context.localSessions.getSession(sessionId);
      if (session) {
        dispatchLocalSessionEvent(context, {
          type: "session_updated",
          sessionId,
          session,
        });
        // Close idle while a turn is actively running again.
        if (session.isRunning === true) {
          notifications.closeIdleNotificationForSession(sessionId);
        }
      }
    },
    onPermissionAttention: () => attention.requestUserAttention(),
    onPermissionAttentionStop: () => attention.stopFlashFrame(),
    // Official gi("bypassPermissionsModeEnabled") residual for spawn clamp.
    isBypassPermissionsModeEnabled: () =>
      context.settings.getPreferences().bypassPermissionsModeEnabled === true,
    // Official vu.shouldAutoApprovePermission / addApprovedPermissions residual.
    shouldAutoApproveScheduledPermission: (taskId, toolName, suggestions) =>
      context.scheduledTasks.shouldAutoApprovePermission(taskId, toolName, suggestions),
    addScheduledTaskApprovedPermissions: (taskId, suggestions) => {
      context.scheduledTasks.addApprovedPermissions(taskId, suggestions);
    },
  });
  runners.set(context, runner);
  return runner;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function getCodeSessionAttentionService(
  context: IpcHandlerContext,
): CodeSessionAttentionService {
  return getCodeSessionAttention(context);
}

export function getCodeDesktopNotificationService(
  context: IpcHandlerContext,
): CodeDesktopNotificationService {
  return getCodeDesktopNotifications(context);
}

/** Official setFocusedSession residual — close idle for the focused Code session. */
export function setFocusedCodeSession(
  context: IpcHandlerContext,
  sessionId: string | null | undefined,
): void {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  focusedCodeSessionByContext.set(context, id);
  getCodeDesktopNotifications(context).onFocusedSessionChanged(id);
}
