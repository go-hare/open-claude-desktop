import { randomUUID } from "node:crypto";
import { CoworkAsyncInputQueue } from "./coworkAsyncInputQueue";
import { CoworkQueryRuntime } from "./coworkQueryRuntime";
import type {
  CoworkQueryFactory,
  CoworkSessionEvent,
} from "./coworkSessionManagerTypes";
import { createUserMessage } from "./coworkSessionState";
import type {
  CoworkAccountDetails,
  CoworkAccountIdentity,
} from "../coworkAccount/coworkAccountContext";
import type {
  CoworkImagePayload,
  CoworkPermissionRequestOptions,
  CoworkPermissionResolution,
  CoworkRuntimeQuery,
  CoworkSdkUserMessage,
  CoworkSessionRuntimeState,
  CoworkStartSessionInput,
  CoworkToolState,
} from "./coworkSessionTypes";

type CoworkSessionRuntimeControllerOptions = {
  emit: (event: CoworkSessionEvent) => void;
  getAccountDetails: () => CoworkAccountDetails | null;
  getIdentity: () => CoworkAccountIdentity;
  now: () => number;
  onQueryCompleted?: (sessionId: string) => void;
  queryFactory: CoworkQueryFactory;
  requestPermission: (
    session: CoworkSessionRuntimeState,
    request: CoworkPermissionRequestOptions,
  ) => Promise<CoworkPermissionResolution>;
  save: (session: CoworkSessionRuntimeState) => void;
  saveAndEmitUpdate: (session: CoworkSessionRuntimeState) => void;
};

export class CoworkSessionRuntimeController {
  private readonly emit: (event: CoworkSessionEvent) => void;
  private readonly getAccountDetails: () => CoworkAccountDetails | null;
  private readonly getIdentity: () => CoworkAccountIdentity;
  private readonly now: () => number;
  private readonly onQueryCompleted?: (sessionId: string) => void;
  private readonly queryFactory: CoworkQueryFactory;
  private readonly requestPermission: CoworkSessionRuntimeControllerOptions["requestPermission"];
  private readonly save: (session: CoworkSessionRuntimeState) => void;
  private readonly saveAndEmitUpdate: (
    session: CoworkSessionRuntimeState,
  ) => void;

  constructor(options: CoworkSessionRuntimeControllerOptions) {
    this.emit = options.emit;
    this.getAccountDetails = options.getAccountDetails;
    this.getIdentity = options.getIdentity;
    this.now = options.now;
    this.onQueryCompleted = options.onQueryCompleted;
    this.queryFactory = options.queryFactory;
    this.requestPermission = options.requestPermission;
    this.save = options.save;
    this.saveAndEmitUpdate = options.saveAndEmitUpdate;
  }

  async start(
    session: CoworkSessionRuntimeState,
    info: CoworkStartSessionInput,
  ): Promise<void> {
    session.lifecycleState = "initializing";
    session.error = undefined;
    const userMessage = this.recordUserMessage(session, info);
    const queue = new CoworkAsyncInputQueue<CoworkSdkUserMessage>();
    this.emitInitialization(session.sessionId);
    try {
      const query = await this.createQuery(session, queue);
      if (session.lifecycleState !== "initializing") return query.close();
      this.attachQuery(session, query, queue);
      queue.enqueue(userMessage);
      session.isFirstTurn = false;
      this.drainPendingStarts(session);
      this.saveAndEmitUpdate(session);
    } catch (error) {
      queue.done();
      this.failInitialization(session, error);
      throw error;
    }
  }

  enqueueMessage(
    session: CoworkSessionRuntimeState,
    message: string,
    images?: CoworkImagePayload[],
    userSelectedFiles?: string[],
    messageUuid?: string,
    toolStates?: CoworkToolState[],
  ): void {
    const userMessage = this.recordUserMessage(session, {
      images,
      message,
      messageUuid,
      toolStates,
      userSelectedFiles,
    });
    session.inputStream?.enqueue(userMessage);
  }

  queuePendingStart(
    session: CoworkSessionRuntimeState,
    info: CoworkStartSessionInput,
  ): void {
    session.pendingStartMessages ??= [];
    session.pendingStartMessages.push({
      channel: info.channel,
      images: info.images,
      message: info.message,
      messageUuid: info.messageUuid,
      toolStates: info.toolStates,
      userSelectedFiles: info.userSelectedFiles,
    });
  }

  private createQuery(
    session: CoworkSessionRuntimeState,
    queue: CoworkAsyncInputQueue<CoworkSdkUserMessage>,
  ): Promise<CoworkRuntimeQuery> {
    const rewindTo = session.pendingRewindTo;
    const resume = rewindTo === undefined ? session.cliSessionId : rewindTo ? session.cliSessionId : undefined;
    session.pendingRewindTo = undefined;
    this.save(session);
    return Promise.resolve(
      this.queryFactory({
        accountDetails: this.getAccountDetails(),
        accountIdentity: this.getIdentity(),
        canUseTool: (request) => this.requestPermission(session, request),
        cwd: session.cwd,
        enabledMcpTools: session.enabledMcpTools,
        forkSession: Boolean(rewindTo && resume),
        hostLoopMode: session.hostLoopMode,
        mcpServers: session.mcpServers,
        model: session.model,
        permissionMode: session.permissionMode,
        prompt: queue,
        remoteMcpServers: session.remoteMcpServersConfig,
        resume,
        resumeSessionAt: rewindTo || undefined,
        sessionId: session.sessionId,
        systemPrompt: session.systemPrompt,
        userSelectedFolders: session.resolvedFolders.map(
          (folder) => folder.canonical ?? folder.display,
        ),
      }),
    );
  }

  private attachQuery(
    session: CoworkSessionRuntimeState,
    query: CoworkRuntimeQuery,
    queue: CoworkAsyncInputQueue<CoworkSdkUserMessage>,
  ): void {
    session.query = query;
    session.inputStream = queue;
    session.lifecycleState = "running";
    const runtime = new CoworkQueryRuntime({
      emit: this.emit,
      isCurrent: () => session.query === query,
      now: this.now,
      onClosed: () => this.onQueryClosed(session, query),
      onQueryCompleted: this.onQueryCompleted,
      query,
      save: this.save,
      session,
    });
    void runtime.run();
  }

  private onQueryClosed(
    session: CoworkSessionRuntimeState,
    query: CoworkRuntimeQuery,
  ): void {
    if (session.query !== query) return;
    session.query = null;
    session.inputStream = null;
    if (session.lifecycleState === "running") session.lifecycleState = "idle";
    this.saveAndEmitUpdate(session);
  }

  private recordUserMessage(
    session: CoworkSessionRuntimeState,
    info: Pick<
      CoworkStartSessionInput,
      "images" | "message" | "messageUuid" | "userSelectedFiles"
    > & { toolStates?: CoworkToolState[] },
  ): CoworkSdkUserMessage {
    const userMessage = createUserMessage(
      session,
      info.message,
      info.messageUuid ?? randomUUID(),
      info.images,
      info.userSelectedFiles,
      info.toolStates,
    );
    session.messageBuffer.push(userMessage);
    session.lastActivityAt = this.now();
    this.emit({
      message: userMessage,
      sessionId: session.sessionId,
      type: "message",
      userMessageUuid: userMessage.uuid,
    });
    this.save(session);
    return userMessage;
  }

  private drainPendingStarts(session: CoworkSessionRuntimeState): void {
    const pending = session.pendingStartMessages ?? [];
    session.pendingStartMessages = undefined;
    for (const message of pending) {
      this.enqueueMessage(
        session,
        message.message,
        message.images,
        message.userSelectedFiles,
        message.messageUuid,
        message.toolStates,
      );
    }
  }

  private emitInitialization(sessionId: string): void {
    this.emit({
      initializationStatus: {
        isComplete: false,
        message: "Starting up...",
        step: "query",
      },
      sessionId,
      type: "initialization_status",
    });
  }

  private failInitialization(
    session: CoworkSessionRuntimeState,
    error: unknown,
  ): void {
    session.lifecycleState = "idle";
    session.error = error instanceof Error ? error.message : String(error);
    this.saveAndEmitUpdate(session);
    this.emit({
      error: session.error,
      sessionId: session.sessionId,
      type: "error",
    });
  }
}
