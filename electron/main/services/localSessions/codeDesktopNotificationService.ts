/**
 * Official NotificationService residual for Code LocalSessions (app.asar class fir):
 *   showIdleNotification — id idle-${sessionId}, body "Claude is waiting for your input"
 *   closeIdleNotificationForSession
 *   showAskUserQuestionNotification — id ask-question-${requestId}
 *   requestUserAttention is separate (CodeSessionAttentionService / dockBounceEnabled)
 *
 * queryCompleted gate (shouldShowCodeIdleNotification) matches cowork residual:
 *   skip hidden / scheduledTaskId / focused === sessionId
 */

import {
  coworkAskUserQuestionNotificationBody,
  coworkAskUserQuestionNotificationId,
  coworkIdleNotificationId,
  coworkIdleNotificationTitle,
  shouldShowCoworkIdleNotification,
  type CoworkDesktopNotificationBackend,
} from "../coworkSessions/coworkDesktopNotificationService";

export {
  coworkAskUserQuestionNotificationBody as codeAskUserQuestionNotificationBody,
  coworkAskUserQuestionNotificationId as codeAskUserQuestionNotificationId,
  coworkIdleNotificationId as codeIdleNotificationId,
  coworkIdleNotificationTitle as codeIdleNotificationTitle,
  shouldShowCoworkIdleNotification as shouldShowCodeIdleNotification,
};

const IDLE_BODY = "Claude is waiting for your input";

export type CodeDesktopNotificationServiceOptions = {
  backend?: CoworkDesktopNotificationBackend | null;
  getFocusedSessionId?: () => string | null | undefined;
  /** Optional dock/flash when showing idle/ask (official also calls requestUserAttention). */
  requestUserAttention?: () => void;
  isInitialized?: boolean;
};

export class CodeDesktopNotificationService {
  private readonly backend: CoworkDesktopNotificationBackend | null;
  private readonly getFocusedSessionId?: () => string | null | undefined;
  private readonly requestUserAttention?: () => void;
  private readonly isInitialized: boolean;
  private readonly activeIdle = new Map<string, string>();
  private readonly activeAsk = new Map<string, string>();

  constructor(options: CodeDesktopNotificationServiceOptions = {}) {
    this.backend = options.backend ?? null;
    this.getFocusedSessionId = options.getFocusedSessionId;
    this.requestUserAttention = options.requestUserAttention;
    this.isInitialized = options.isInitialized ?? Boolean(options.backend);
  }

  showIdleNotification(input: {
    sessionId: string;
    sessionTitle?: string | null;
    scheduledTaskId?: string | null;
    isHiddenSession?: boolean;
  }): boolean {
    if (!this.isInitialized || !this.backend) return false;
    if (
      !shouldShowCoworkIdleNotification({
        sessionId: input.sessionId,
        focusedSessionId: this.getFocusedSessionId?.() ?? null,
        isHiddenSession: input.isHiddenSession === true,
        scheduledTaskId: input.scheduledTaskId,
      })
    ) {
      return false;
    }
    const id = coworkIdleNotificationId(input.sessionId);
    this.activeIdle.set(input.sessionId, id);
    this.backend.show({
      id,
      title: coworkIdleNotificationTitle(input.sessionTitle),
      body: IDLE_BODY,
      type: "idle",
      userInfo: { sessionId: input.sessionId },
    });
    this.requestUserAttention?.();
    return true;
  }

  closeIdleNotificationForSession(sessionId: string): void {
    const id = this.activeIdle.get(sessionId) ?? coworkIdleNotificationId(sessionId);
    this.activeIdle.delete(sessionId);
    this.backend?.close(id);
  }

  showAskUserQuestionNotification(input: {
    requestId: string;
    sessionId: string;
    sessionTitle?: string | null;
    questionText?: string | null;
  }): boolean {
    if (!this.isInitialized || !this.backend) return false;
    const id = coworkAskUserQuestionNotificationId(input.requestId);
    this.activeAsk.set(input.requestId, id);
    this.backend.show({
      id,
      title: coworkIdleNotificationTitle(input.sessionTitle),
      body: coworkAskUserQuestionNotificationBody(input.questionText),
      type: "ask_user_question",
      userInfo: { sessionId: input.sessionId, requestId: input.requestId },
    });
    this.requestUserAttention?.();
    return true;
  }

  closeAskUserQuestionNotification(requestId: string): void {
    const id = this.activeAsk.get(requestId) ?? coworkAskUserQuestionNotificationId(requestId);
    this.activeAsk.delete(requestId);
    this.backend?.close(id);
  }

  closeAllForSession(sessionId: string): void {
    this.closeIdleNotificationForSession(sessionId);
    for (const [requestId, id] of [...this.activeAsk.entries()]) {
      // best-effort: close all asks when focusing a session (official closes by session map)
      void requestId;
      this.backend?.close(id);
    }
  }

  onFocusedSessionChanged(sessionId: string | null | undefined): void {
    if (!sessionId) return;
    this.closeIdleNotificationForSession(sessionId);
  }
}
