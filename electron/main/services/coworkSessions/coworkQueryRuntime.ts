import type { CoworkSessionEvent } from "./coworkSessionManagerTypes";
import type {
  CoworkRuntimeQuery,
  CoworkSdkMessage,
  CoworkSessionRuntimeState,
} from "./coworkSessionTypes";

type CoworkQueryRuntimeOptions = {
  emit: (event: CoworkSessionEvent) => void;
  isCurrent: () => boolean;
  now: () => number;
  onClosed: () => void;
  onQueryCompleted?: (sessionId: string) => void;
  query: CoworkRuntimeQuery;
  save: (session: CoworkSessionRuntimeState) => void;
  session: CoworkSessionRuntimeState;
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
  private readonly isCurrent: () => boolean;
  private readonly now: () => number;
  private readonly onClosed: () => void;
  private readonly onQueryCompleted?: (sessionId: string) => void;
  private readonly query: CoworkRuntimeQuery;
  private readonly save: (session: CoworkSessionRuntimeState) => void;
  private readonly session: CoworkSessionRuntimeState;

  constructor(options: CoworkQueryRuntimeOptions) {
    this.emit = options.emit;
    this.isCurrent = options.isCurrent;
    this.now = options.now;
    this.onClosed = options.onClosed;
    this.onQueryCompleted = options.onQueryCompleted;
    this.query = options.query;
    this.save = options.save;
    this.session = options.session;
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

  private handleMessage(message: CoworkSdkMessage): void {
    if (message.type === "system" && message.subtype === "init") {
      this.handleInitialization(message);
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

  private handleInitialization(message: CoworkSdkMessage): void {
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
    this.session.error = failed ? resultError(message) : undefined;
    this.session.lifecycleState = this.session.inputStream?.hasPending()
      ? "running"
      : "idle";
    this.save(this.session);
    this.emit({ sessionId: this.session.sessionId, type: "session_updated" });
    if (failed) this.emitError(this.session.error ?? "Turn failed");
    this.onQueryCompleted?.(this.session.sessionId);
  }

  private handleStreamEnd(): void {
    if (this.session.lifecycleState !== "running") return;
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
