/**
 * Official NotificationService residual (app.asar `class fir`, used as `Ds`):
 *   showIdleNotification({sessionId, sessionTitle, onClick})
 *     id = `idle-${sessionId}`
 *     title = sessionTitle || "Local Session"
 *     body = "Claude is waiting for your input"
 *   closeIdleNotificationForSession(sessionId)
 *   showAskUserQuestionNotification / closeAskUserQuestionNotificationsForSession
 *   showNotification(title, body, id?, onClick?)
 *   closeNotification(id)
 *
 * Wiring residual (registerDesktopIpc / main):
 *   focusedSessionChanged(sessionId) →
 *     closeIdle + closeAskUserQuestion + closeNotification(`scheduled-${id}`)
 *   queryCompleted(sessionId) →
 *     !isHiddenSession && !scheduledTaskId && focused !== sessionId → showIdle
 *
 * Residual honesty:
 * - Full Swift UNUserNotificationCenter / Electron Notification product backends
 *   are inject adapters (show/close), not invented as product stores.
 * - ze analytics / dock bounce / flash frame residual not product.
 * - Code LocalSessions path residual (an.on scheduled) not product here.
 */

export type CoworkDesktopNotificationShowInput = {
  body: string;
  id: string;
  title: string;
  /** Optional type tag for adapters. */
  type?: "idle" | "ask_user_question" | "generic" | "scheduled";
  userInfo?: Record<string, unknown>;
};

export type CoworkDesktopNotificationBackend = {
  close: (id: string) => void;
  show: (input: CoworkDesktopNotificationShowInput) => void;
};

export type CoworkDesktopNotificationServiceOptions = {
  backend?: CoworkDesktopNotificationBackend | null;
  /**
   * Official isInitialized gate. Default true when backend provided, else false
   * (matches "not initialized, skipping").
   */
  isInitialized?: boolean;
};

const IDLE_BODY = "Claude is waiting for your input";
const DEFAULT_SESSION_TITLE = "Local Session";
const ASK_BODY_MAX = 100;

export function coworkIdleNotificationId(sessionId: string): string {
  return `idle-${sessionId}`;
}

export function coworkAskUserQuestionNotificationId(requestId: string): string {
  return `ask-question-${requestId}`;
}

export function coworkScheduledNotificationId(sessionId: string): string {
  return `scheduled-${sessionId}`;
}

export function coworkIdleNotificationTitle(
  sessionTitle: string | null | undefined,
): string {
  return sessionTitle || DEFAULT_SESSION_TITLE;
}

export function coworkAskUserQuestionNotificationBody(
  questionText: string | null | undefined,
): string {
  if (!questionText) return "Claude is asking you a question";
  if (questionText.length > ASK_BODY_MAX) {
    return `${questionText.slice(0, ASK_BODY_MAX)}...`;
  }
  return questionText;
}

/**
 * Official queryCompleted → showIdle gate (pure):
 *   if isHidden → skip
 *   if scheduledTaskId → skip
 *   if focused === sessionId → skip
 *   else show
 */
export function shouldShowCoworkIdleNotification(input: {
  focusedSessionId?: string | null;
  isHiddenSession: boolean;
  scheduledTaskId?: string | null;
  sessionId: string;
}): boolean {
  if (input.isHiddenSession) return false;
  if (input.scheduledTaskId) return false;
  if (input.focusedSessionId === input.sessionId) return false;
  return true;
}

/**
 * Official focusedSessionChanged(c): when c truthy, close idle + ask + scheduled.
 */
export function resolveCoworkFocusedSessionNotificationCloses(
  sessionId: string | null | undefined,
): {
  closeAskUserQuestion: boolean;
  closeIdle: boolean;
  closeScheduledId: string | null;
  sessionId: string;
} | null {
  if (!sessionId) return null;
  return {
    closeAskUserQuestion: true,
    closeIdle: true,
    closeScheduledId: coworkScheduledNotificationId(sessionId),
    sessionId,
  };
}

export class CoworkDesktopNotificationService {
  private readonly backend: CoworkDesktopNotificationBackend | null;
  private readonly activeIdleNotifications = new Map<string, string>();
  private readonly activeAskUserQuestionNotifications = new Map<
    string,
    string
  >();
  private readonly askUserQuestionBySession = new Map<string, Set<string>>();
  private readonly pendingClickCallbacks = new Map<string, () => void>();
  private isInitialized: boolean;

  constructor(options: CoworkDesktopNotificationServiceOptions = {}) {
    this.backend = options.backend ?? null;
    this.isInitialized =
      options.isInitialized ?? Boolean(options.backend);
  }

  setInitialized(value: boolean): void {
    this.isInitialized = value;
  }

  /**
   * Official showIdleNotification — skip if not initialized.
   */
  showIdleNotification(input: {
    onClick?: () => void;
    sessionId: string;
    sessionTitle?: string | null;
  }): void {
    if (!this.isInitialized || !this.backend) {
      console.warn(
        "NotificationService not initialized, skipping notification",
      );
      return;
    }
    const id = coworkIdleNotificationId(input.sessionId);
    this.activeIdleNotifications.set(input.sessionId, id);
    if (input.onClick) this.pendingClickCallbacks.set(id, input.onClick);
    this.backend.show({
      body: IDLE_BODY,
      id,
      title: coworkIdleNotificationTitle(input.sessionTitle),
      type: "idle",
      userInfo: { sessionId: input.sessionId, type: "idle_notification" },
    });
  }

  closeIdleNotificationForSession(sessionId: string): void {
    const id = this.activeIdleNotifications.get(sessionId);
    if (!id || !this.backend) return;
    this.backend.close(id);
    this.activeIdleNotifications.delete(sessionId);
    this.pendingClickCallbacks.delete(id);
  }

  showAskUserQuestionNotification(input: {
    onClick?: () => void;
    questionText?: string | null;
    requestId: string;
    sessionId: string;
    sessionTitle?: string | null;
  }): void {
    if (!this.isInitialized || !this.backend) {
      console.warn(
        "NotificationService not initialized, skipping notification",
      );
      return;
    }
    const id = coworkAskUserQuestionNotificationId(input.requestId);
    this.activeAskUserQuestionNotifications.set(input.requestId, id);
    if (input.onClick) this.pendingClickCallbacks.set(id, input.onClick);
    if (!this.askUserQuestionBySession.has(input.sessionId)) {
      this.askUserQuestionBySession.set(input.sessionId, new Set());
    }
    this.askUserQuestionBySession.get(input.sessionId)!.add(input.requestId);
    this.backend.show({
      body: coworkAskUserQuestionNotificationBody(input.questionText),
      id,
      title: coworkIdleNotificationTitle(input.sessionTitle),
      type: "ask_user_question",
      userInfo: {
        requestId: input.requestId,
        sessionId: input.sessionId,
        type: "ask_user_question",
      },
    });
  }

  closeAskUserQuestionNotificationsForSession(sessionId: string): void {
    const requestIds = this.askUserQuestionBySession.get(sessionId);
    if (!requestIds || requestIds.size === 0 || !this.backend) return;
    for (const requestId of requestIds) {
      const id = this.activeAskUserQuestionNotifications.get(requestId);
      if (!id) continue;
      this.backend.close(id);
      this.activeAskUserQuestionNotifications.delete(requestId);
      this.pendingClickCallbacks.delete(id);
    }
    this.askUserQuestionBySession.delete(sessionId);
  }

  showNotification(
    title: string,
    body: string,
    id?: string,
    onClick?: () => void,
  ): void {
    if (!this.isInitialized || !this.backend) {
      console.warn(
        "NotificationService not initialized, skipping notification",
      );
      return;
    }
    const notificationId = id ?? `notification-${Date.now()}`;
    if (onClick) this.pendingClickCallbacks.set(notificationId, onClick);
    this.backend.show({
      body,
      id: notificationId,
      title,
      type: "generic",
    });
  }

  closeNotification(id: string): void {
    if (!this.backend) return;
    this.backend.close(id);
    this.pendingClickCallbacks.delete(id);
  }

  /**
   * Official focusedSessionChanged handler body for Ds closes.
   */
  handleFocusedSessionChanged(sessionId: string | null | undefined): void {
    const closes = resolveCoworkFocusedSessionNotificationCloses(sessionId);
    if (!closes) return;
    this.closeIdleNotificationForSession(closes.sessionId);
    this.closeAskUserQuestionNotificationsForSession(closes.sessionId);
    if (closes.closeScheduledId) {
      this.closeNotification(closes.closeScheduledId);
    }
  }

  /** Test helper — whether idle notification is tracked for session. */
  hasIdleNotificationForSession(sessionId: string): boolean {
    return this.activeIdleNotifications.has(sessionId);
  }

  /** Test helper — ask-user request ids tracked for session. */
  getAskUserQuestionRequestIds(sessionId: string): string[] {
    return [...(this.askUserQuestionBySession.get(sessionId) ?? [])];
  }

  invokeClickCallback(id: string): boolean {
    const cb = this.pendingClickCallbacks.get(id);
    if (!cb) return false;
    cb();
    this.pendingClickCallbacks.delete(id);
    return true;
  }
}

/**
 * Electron Notification adapter residual — tag-based show/close best-effort.
 * No Swift path invent.
 */
export function createElectronCoworkDesktopNotificationBackend(): CoworkDesktopNotificationBackend {
  // Lazy require so unit tests without electron can still import helpers.
  const active = new Map<string, { close: () => void }>();
  return {
    close(id: string) {
      const n = active.get(id);
      if (n) {
        try {
          n.close();
        } catch {
          /* ignore */
        }
        active.delete(id);
      }
    },
    show(input: CoworkDesktopNotificationShowInput) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Notification } = require("electron") as {
          Notification: new (opts: {
            body: string;
            title: string;
            urgency?: string;
          }) => {
            close: () => void;
            on: (event: string, cb: () => void) => void;
            show: () => void;
          };
          isSupported?: () => boolean;
        };
        if (
          typeof (Notification as unknown as { isSupported?: () => boolean })
            .isSupported === "function" &&
          !(Notification as unknown as { isSupported: () => boolean }).isSupported()
        ) {
          return;
        }
        const notification = new Notification({
          body: input.body,
          title: input.title,
          urgency: input.type === "idle" ? "normal" : undefined,
        });
        active.set(input.id, notification);
        notification.on("close", () => {
          active.delete(input.id);
        });
        notification.show();
      } catch (error) {
        console.warn(
          "[CoworkDesktopNotificationService] Electron show failed:",
          error,
        );
      }
    },
  };
}
