import type { CoworkSessionEvent } from "./coworkSessionManagerTypes";
import type {
  CoworkRuntimeQuery,
  CoworkSdkMessage,
  CoworkSessionRuntimeState,
} from "./coworkSessionTypes";
import {
  applyCoworkPromptSuggestionMessage,
  armCoworkPromptSuggestionTimeout,
  clearCoworkPromptSuggestionTimeout,
  coworkPromptSuggestionText,
} from "./coworkPromptSuggestionHelpers";

type CoworkQueryRuntimeOptions = {
  emit: (event: CoworkSessionEvent) => void;
  isCurrent: () => boolean;
  now: () => number;
  onClosed: () => void;
  onQueryCompleted?: (sessionId: string) => void;
  query: CoworkRuntimeQuery;
  save: (session: CoworkSessionRuntimeState) => void;
  session: CoworkSessionRuntimeState;
  /**
   * Official LocalAgentModeSessionManager.translateMessagePaths (XL) —
   * rewrite VM mnt paths in outbound SDK messages before emit/buffer.
   */
  translateMessage?: <T extends CoworkSdkMessage>(message: T) => T;
  /**
   * Official ft("1942781881") — arm 5s suggestion grace after success result.
   * Default false (Statsig residual — do not invent product gate on).
   */
  enablePromptSuggestionGrace?: () => boolean;
};

const maximumBufferedMessages = 1_100;

function messageString(message: CoworkSdkMessage, key: string) {
  const value = message[key];
  return typeof value === "string" ? value : undefined;
}

function resultError(message: CoworkSdkMessage): string {
  return (
    messageString(message, "result") ??
    messageString(message, "error") ??
    `Turn failed: ${messageString(message, "subtype") ?? "unknown"}`
  );
}

function isFailedResult(message: CoworkSdkMessage): boolean {
  const subtype = messageString(message, "subtype");
  return (
    message.is_error === true ||
    (subtype !== undefined && subtype !== "success")
  );
}

export class CoworkQueryRuntime {
  private readonly emit: (event: CoworkSessionEvent) => void;
  private readonly enablePromptSuggestionGrace: () => boolean;
  private readonly isCurrent: () => boolean;
  private readonly now: () => number;
  private readonly onClosed: () => void;
  private readonly onQueryCompleted?: (sessionId: string) => void;
  private readonly query: CoworkRuntimeQuery;
  private readonly save: (session: CoworkSessionRuntimeState) => void;
  private readonly session: CoworkSessionRuntimeState;
  private readonly translateMessage?: CoworkQueryRuntimeOptions["translateMessage"];

  constructor(options: CoworkQueryRuntimeOptions) {
    this.emit = options.emit;
    this.enablePromptSuggestionGrace =
      options.enablePromptSuggestionGrace ?? (() => false);
    this.isCurrent = options.isCurrent;
    this.now = options.now;
    this.onClosed = options.onClosed;
    this.onQueryCompleted = options.onQueryCompleted;
    this.query = options.query;
    this.save = options.save;
    this.session = options.session;
    this.translateMessage = options.translateMessage;
  }

  async run(): Promise<void> {
    try {
      for await (const message of this.query) {
        if (!this.isCurrent()) return;
        this.handleMessage(message);
      }
      if (this.isCurrent()) this.handleStreamEnd();
    } catch (error) {
      if (this.isCurrent()) this.handleStreamError(error);
    } finally {
      if (this.isCurrent()) this.onClosed();
    }
  }

  private handleMessage(raw: CoworkSdkMessage): void {
    // Official: XL deep-translate VM paths on outbound messages (and transcript).
    let message = raw;
    try {
      message = this.translateMessage?.(raw) ?? raw;
    } catch (error) {
      console.warn(
        "[coworkQueryRuntime] translateMessagePaths failed: %o",
        error,
      );
      message = raw;
    }
    // Official: type==="prompt_suggestion" → assign + emit + clear timeout→idle.
    // Do not buffer into messageBuffer; continue stream (not a chat message).
    if (message.type === "prompt_suggestion") {
      this.handlePromptSuggestion(message);
      return;
    }
    if (message.type === "system" && message.subtype === "init") {
      this.handleInitialization(message);
    }
    // Official intermediate APIError: when interrupted / not running, suppress
    // abort-error handling (continue stream). Product has no je intermediate
    // analytics; skip treating interrupted assistant.error as a hard path.
    if (
      message.type === "assistant" &&
      message.error &&
      (this.session._turnInterruptRequested === true ||
        this.session.lifecycleState !== "running")
    ) {
      console.debug(
        `[APIError] Suppressing abort error for interrupted session ${this.session.sessionId}`,
      );
      if (message.type !== "stream_event") this.bufferMessage(message);
      this.session.lastActivityAt = this.now();
      this.emit({
        message,
        sessionId: this.session.sessionId,
        type: "message",
      });
      this.save(this.session);
      return;
    }
    if (message.type !== "stream_event") this.bufferMessage(message);
    this.session.lastActivityAt = this.now();
    this.emit({
      message,
      sessionId: this.session.sessionId,
      type: "message",
    });
    if (message.type === "result") this.handleResult(message);
    else this.save(this.session);
  }

  private handlePromptSuggestion(message: CoworkSdkMessage): void {
    const suggestion = coworkPromptSuggestionText(message);
    const { transitionedToIdle } = applyCoworkPromptSuggestionMessage(
      this.session,
      suggestion,
    );
    this.session.lastActivityAt = this.now();
    this.save(this.session);
    this.emit({
      data: suggestion,
      sessionId: this.session.sessionId,
      type: "prompt_suggestion",
    });
    if (transitionedToIdle) {
      this.emit({ sessionId: this.session.sessionId, type: "session_updated" });
    }
  }

  private handleInitialization(message: CoworkSdkMessage): void {
    // Official re-init while waiting for suggestion / agent completed:
    // clear timeout + isAgentCompleted + emit session_updated.
    if (this.session._suggestionTimeout || this.session.isAgentCompleted) {
      clearCoworkPromptSuggestionTimeout(this.session);
      this.session.isAgentCompleted = false;
      this.emit({ sessionId: this.session.sessionId, type: "session_updated" });
    }
    const cliSessionId = messageString(message, "session_id");
    if (cliSessionId && /^[a-zA-Z0-9_-]+$/.test(cliSessionId)) {
      this.session.cliSessionId = cliSessionId;
    }
    this.emit({
      initializationStatus: { isComplete: true, message: "", step: "complete" },
      sessionId: this.session.sessionId,
      type: "initialization_status",
    });
  }

  private bufferMessage(message: CoworkSdkMessage): void {
    this.session.messageBuffer.push(message);
    if (this.session.messageBuffer.length > maximumBufferedMessages) {
      this.session.messageBuffer = this.session.messageBuffer.slice(
        -maximumBufferedMessages,
      );
    }
  }

  private handleResult(message: CoworkSdkMessage): void {
    const failed = isFailedResult(message);
    // Official failed-result interrupt short-circuit (p = is_error path):
    //   if _turnInterruptRequested || lifecycleState!=="running":
    //     close query, null streams, idle, clear flag;
    //     queryCompleted only when was interrupt.
    // Residual not invented: trackCycleOutcome / je turn analytics.
    if (
      failed &&
      (this.session._turnInterruptRequested === true ||
        this.session.lifecycleState !== "running")
    ) {
      console.info(
        `[Result] Turn ended by user interrupt for session ${this.session.sessionId}`,
      );
      const wasInterrupt = this.session._turnInterruptRequested === true;
      this.session._turnInterruptRequested = undefined;
      clearCoworkPromptSuggestionTimeout(this.session);
      try {
        this.session.query?.close();
      } catch (error) {
        console.warn(
          `[Result] Failed to close query for session ${this.session.sessionId}:`,
          error,
        );
      }
      if (this.session.query === this.query) {
        this.session.query = null;
        this.session.inputStream = null;
      }
      this.session.error = undefined;
      this.session.lifecycleState = "idle";
      this.save(this.session);
      this.emit({ sessionId: this.session.sessionId, type: "session_updated" });
      if (wasInterrupt) this.onQueryCompleted?.(this.session.sessionId);
      return;
    }
    this.session.error = failed ? resultError(message) : undefined;
    const hasPending = this.session.inputStream?.hasPending() === true;
    if (!failed && !hasPending && this.enablePromptSuggestionGrace()) {
      // Official success + no pending + ft("1942781881"): arm 5s then idle.
      // Residual: sessionType!==DE (dispatch) gate not product-mapped here —
      // inject default off so arm only when product explicitly enables.
      armCoworkPromptSuggestionTimeout(this.session, {
        onFire: () => {
          if (!this.isCurrent()) return;
          if (this.session.lifecycleState === "running") {
            this.session.lifecycleState = "idle";
            this.session._turnInterruptRequested = undefined;
            this.save(this.session);
            this.emit({
              sessionId: this.session.sessionId,
              type: "session_updated",
            });
          }
        },
      });
      this.save(this.session);
      this.emit({ sessionId: this.session.sessionId, type: "session_updated" });
      this.onQueryCompleted?.(this.session.sessionId);
      return;
    }
    this.session.lifecycleState = hasPending ? "running" : "idle";
    // Official transitionTo("idle"): clear _turnInterruptRequested.
    // Product stop/leavingRunning also clear via ephemerals helper.
    if (this.session.lifecycleState === "idle") {
      this.session._turnInterruptRequested = undefined;
      clearCoworkPromptSuggestionTimeout(this.session);
    }
    this.save(this.session);
    this.emit({ sessionId: this.session.sessionId, type: "session_updated" });
    if (failed) this.emitError(this.session.error ?? "Turn failed");
    this.onQueryCompleted?.(this.session.sessionId);
  }

  private handleStreamEnd(): void {
    if (this.session.lifecycleState !== "running") return;
    // Official interrupt short-circuit: do not surface "ended unexpectedly"
    // when user interrupted and stream closed without a result message.
    if (this.session._turnInterruptRequested === true) {
      console.info(
        `[Result] Turn ended by user interrupt for session ${this.session.sessionId}`,
      );
      this.session._turnInterruptRequested = undefined;
      clearCoworkPromptSuggestionTimeout(this.session);
      this.session.error = undefined;
      this.session.lifecycleState = "idle";
      this.save(this.session);
      this.emit({ sessionId: this.session.sessionId, type: "session_updated" });
      this.onQueryCompleted?.(this.session.sessionId);
      return;
    }
    // Official stream end with pending _suggestionTimeout: clear timeout, no
    // unexpected-error when already waiting for suggestion (clean-complete path).
    if (this.session._suggestionTimeout) {
      clearCoworkPromptSuggestionTimeout(this.session);
      this.session.lifecycleState = "idle";
      this.session._turnInterruptRequested = undefined;
      this.session.error = undefined;
      this.save(this.session);
      this.emit({ sessionId: this.session.sessionId, type: "session_updated" });
      return;
    }
    this.session.lifecycleState = "idle";
    this.session.error = "The session ended unexpectedly. Please try again.";
    this.save(this.session);
    this.emitError(this.session.error);
  }

  private handleStreamError(error: unknown): void {
    if (
      ["idle", "stopping", "archived"].includes(this.session.lifecycleState)
    ) {
      return;
    }
    // Suppress stream abort noise after interruptTurn.
    if (this.session._turnInterruptRequested === true) {
      console.debug(
        `[APIError] Suppressing abort error for interrupted session ${this.session.sessionId}`,
      );
      this.session._turnInterruptRequested = undefined;
      clearCoworkPromptSuggestionTimeout(this.session);
      this.session.error = undefined;
      this.session.lifecycleState = "idle";
      this.save(this.session);
      this.emit({ sessionId: this.session.sessionId, type: "session_updated" });
      this.onQueryCompleted?.(this.session.sessionId);
      return;
    }
    clearCoworkPromptSuggestionTimeout(this.session);
    this.session.lifecycleState = "idle";
    this.session.error = error instanceof Error ? error.message : String(error);
    this.save(this.session);
    this.emitError(this.session.error);
  }

  private emitError(error: string): void {
    this.emit({ error, sessionId: this.session.sessionId, type: "error" });
    this.emit({ sessionId: this.session.sessionId, type: "session_updated" });
  }
}
