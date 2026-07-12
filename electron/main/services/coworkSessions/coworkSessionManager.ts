import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { CoworkPermissionBroker } from "./coworkPermissionBroker";
import { createCoworkManagerPermissionBroker } from "./coworkSessionManagerFactories";
import { getCoworkSupportedCommands, type CoworkSlashCommand } from "./coworkSessionCommands";
import {
  COWORK_HOST_LOOP_RESUME_REJECTED,
  shouldRejectCoworkHostLoopResume,
} from "../coworkHostLoop/coworkHostLoopMode";
import type { CoworkSessionManagerOptions, CoworkSessionUpdate, CoworkTranscriptOptions } from "./coworkSessionManagerTypes";
import { CoworkSessionRepository } from "./coworkSessionRepository";
import { rewindCoworkSession } from "./coworkSessionRewind";
import { CoworkSessionRuntimeController } from "./coworkSessionRuntimeController";
import { addCoworkSessionFolder, type CoworkAddFolderResult } from "./coworkSessionWorkspace";
import { applyStartInput, createDefaultCoworkProcessName, createDefaultCoworkSessionId, createResumeInput, isValidCoworkSessionId, toRendererSession } from "./coworkSessionState";
import type {
  CoworkImagePayload,
  CoworkPermissionDecision,
  CoworkPermissionMode,
  CoworkRendererSession,
  CoworkSdkMessage,
  CoworkSessionRuntimeState,
  CoworkStartSessionInput,
  CoworkToolState,
} from "./coworkSessionTypes";

export class CoworkSessionManager {
  private readonly createSessionId: () => string;
  private readonly emit: CoworkSessionManagerOptions["emit"];
  private readonly folderExists: (folder: string) => boolean;
  private readonly homePath: string;
  private readonly now: () => number;
  private readonly permissions: CoworkPermissionBroker;
  private readonly repository: CoworkSessionRepository;
  private readonly requireCoworkFullVmSandbox?: CoworkSessionManagerOptions["requireCoworkFullVmSandbox"];
  private readonly resolveHostLoopMode?: CoworkSessionManagerOptions["resolveHostLoopMode"];
  private readonly runtime: CoworkSessionRuntimeController;
  private readonly transcriptReader?: CoworkSessionManagerOptions["transcriptReader"];

  constructor(options: CoworkSessionManagerOptions) {
    this.createSessionId = options.createSessionId ?? createDefaultCoworkSessionId;
    this.emit = options.emit;
    this.folderExists = options.folderExists ?? existsSync;
    this.homePath = options.homePath ?? homedir();
    this.now = options.now ?? Date.now;
    this.requireCoworkFullVmSandbox = options.requireCoworkFullVmSandbox;
    this.resolveHostLoopMode = options.resolveHostLoopMode;
    this.transcriptReader = options.transcriptReader;
    this.repository = new CoworkSessionRepository({
      accountContext: options.accountContext,
      createPersistence: options.createPersistence,
      createProcessName: options.createProcessName ?? createDefaultCoworkProcessName,
      now: this.now,
    });
    this.permissions = createCoworkManagerPermissionBroker(options, this.repository);
    this.runtime = this.createRuntimeController(options);
  }

  initialize(): Promise<void> {
    return this.repository.initialize();
  }

  async start(info: CoworkStartSessionInput): Promise<string> {
    await this.initialize();
    const sessionId = info.sessionId ?? this.createSessionId();
    if (!isValidCoworkSessionId(sessionId)) {
      throw new Error("start: invalid sessionId");
    }
    const existing = this.repository.get(sessionId);
    const startInfo = this.withResolvedHostLoopMode(info, existing);
    if (existing?.lifecycleState === "initializing") {
      this.runtime.queuePendingStart(existing, startInfo);
      return sessionId;
    }
    if (existing?.query && existing.inputStream) {
      await this.sendMessage(
        sessionId,
        startInfo.message,
        startInfo.images,
        startInfo.userSelectedFiles,
        startInfo.messageUuid,
        startInfo.toolStates,
      );
      return sessionId;
    }
    const session = existing ?? this.repository.create(startInfo, sessionId);
    applyStartInput(session, startInfo);
    void this.runtime.start(session, startInfo).catch(() => undefined);
    return sessionId;
  }

  private withResolvedHostLoopMode(
    info: CoworkStartSessionInput,
    existing: CoworkSessionRuntimeState | undefined,
  ): CoworkStartSessionInput {
    const isNewSession = !existing;
    if (
      !isNewSession
      && shouldRejectCoworkHostLoopResume(
        existing.hostLoopMode,
        this.requireCoworkFullVmSandbox?.(),
      )
    ) {
      throw new Error(COWORK_HOST_LOOP_RESUME_REJECTED);
    }
    // Official: new session uses v4(); resume inherits existing.hostLoopMode === true.
    const hostLoopMode = isNewSession
      ? this.resolveHostLoopMode?.(info) ?? info.hostLoopMode ?? false
      : existing.hostLoopMode === true;
    return { ...info, hostLoopMode };
  }

  async sendMessage(
    sessionId: string,
    message: string,
    images?: CoworkImagePayload[],
    userSelectedFiles?: string[],
    messageUuid?: string,
    _toolStates?: CoworkToolState[],
  ): Promise<void> {
    const session = this.repository.require(sessionId);
    if (session.lifecycleState === "initializing") {
      this.runtime.queuePendingStart(session, {
        images,
        message,
        messageUuid,
        toolStates: _toolStates,
        userSelectedFiles,
      });
      return;
    }
    if (!session.query || !session.inputStream) {
      await this.start(
        createResumeInput(
          session,
          message,
          images,
          userSelectedFiles,
          messageUuid,
          _toolStates,
        ),
      );
      return;
    }
    // Live query still open after a prior result: re-enter running and publish
    // isRunning before enqueue so Web hydration/metadata matches official turns.
    session.lifecycleState = "running";
    session.error = undefined;
    this.saveAndEmitUpdate(session);
    this.runtime.enqueueMessage(
      session,
      message,
      images,
      userSelectedFiles,
      messageUuid,
      _toolStates,
    );
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    const session = this.repository.require(sessionId);
    if (session.model === model) return;
    if (session.query) await session.query.setModel(model);
    session.model = model;
    this.saveAndEmitUpdate(session);
  }

  async setPermissionMode(
    sessionId: string,
    mode: CoworkPermissionMode,
    _chromeAllowedDomains?: string[],
    _options?: unknown,
  ): Promise<boolean> {
    const session = this.repository.get(sessionId);
    if (!session) return false;
    try {
      if (session.query) await session.query.setPermissionMode?.(mode);
      session.permissionMode = mode;
      this.saveAndEmitUpdate(session);
      this.emit({
        permissionMode: mode,
        sessionId,
        type: "permission_mode_changed",
      });
      return true;
    } catch {
      return false;
    }
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.repository.get(sessionId);
    if (!session) return;
    const hadQuery = session.query !== null;
    session.lifecycleState = "stopping";
    session.inputStream?.done();
    session.query?.close();
    session.query = null;
    session.inputStream = null;
    session.lifecycleState = "idle";
    this.permissions.denyPendingPermissionsForSession(sessionId, "Turn ended");
    this.saveAndEmitUpdate(session);
    await this.repository.flush(sessionId);
    if (hadQuery) this.emit({ code: 0, sessionId, type: "close" });
  }

  async archive(sessionId: string, _options?: unknown): Promise<void> {
    const session = this.repository.get(sessionId);
    if (!session) return;
    await this.stop(sessionId);
    session.lifecycleState = "archived";
    this.permissions.denyPendingPermissionsForSession(
      sessionId,
      "Session was archived.",
    );
    this.repository.save(session);
    await this.repository.flush(sessionId);
    this.emit({ sessionId, type: "archived" });
  }

  async delete(sessionId: string): Promise<void> {
    const session = this.repository.get(sessionId);
    if (!session) return;
    await this.stop(sessionId);
    this.permissions.denyPendingPermissionsForSession(
      sessionId,
      "Session was deleted.",
    );
    await this.repository.delete(session);
  }

  async updateSession(sessionId: string, options: CoworkSessionUpdate): Promise<void> {
    const session = this.repository.require(sessionId);
    Object.assign(session, options);
    session.lastActivityAt = this.now();
    this.saveAndEmitUpdate(session);
  }

  getSession(sessionId: string, _options?: unknown): CoworkRendererSession | null {
    const session = this.repository.get(sessionId);
    return session ? this.toRenderer(session) : null;
  }

  getAll(): CoworkRendererSession[] {
    return this.repository.getAll().map((session) => this.toRenderer(session));
  }

  async addFolderToSession(sessionId: string, folder: string): Promise<CoworkAddFolderResult> {
    const session = this.repository.require(sessionId);
    const result = await addCoworkSessionFolder(session, folder);
    if (result.ok) this.saveAndEmitUpdate(session);
    return result;
  }

  getSupportedCommands(sessionId?: string): Promise<CoworkSlashCommand[]> {
    return getCoworkSupportedCommands(sessionId ? this.repository.get(sessionId) : undefined);
  }

  async getTranscript(
    sessionId: string,
    options?: CoworkTranscriptOptions,
  ): Promise<CoworkSdkMessage[]> {
    const session = this.repository.get(sessionId);
    if (!session) return [];
    if (this.transcriptReader) return this.transcriptReader(session, options);
    return [...session.messageBuffer];
  }

  respondToToolPermission(
    requestId: string,
    decision: CoworkPermissionDecision,
    updatedInput?: unknown,
  ): void {
    this.permissions.respondToToolPermission(requestId, decision, updatedInput);
  }

  rewind(sessionId: string, targetUuid: string): Promise<string | null> {
    return rewindCoworkSession(
      {
        emit: this.emit,
        getSession: (id) => this.repository.get(id),
        getTranscript: (id) => this.getTranscript(id),
        now: this.now,
        save: (session) => this.repository.save(session),
        stop: (id) => this.stop(id),
      },
      sessionId,
      targetUuid,
    );
  }

  private createRuntimeController(options: CoworkSessionManagerOptions): CoworkSessionRuntimeController {
    return new CoworkSessionRuntimeController({
      emit: this.emit,
      getAccountDetails: () => this.repository.getAccountDetails(),
      getIdentity: () => this.repository.getIdentity(),
      now: this.now,
      onQueryCompleted: options.onQueryCompleted,
      queryFactory: options.queryFactory,
      requestPermission: (session, request) =>
        this.permissions.requestPermission({
          ...request,
          ownerSessionId: request.ownerSessionId ?? session.parentSessionId,
          sessionId: session.sessionId,
        }),
      save: (session) => this.repository.save(session),
      saveAndEmitUpdate: (session) => this.saveAndEmitUpdate(session),
    });
  }

  private saveAndEmitUpdate(session: CoworkSessionRuntimeState): void {
    session.lastActivityAt = this.now();
    this.repository.save(session);
    this.emit({ sessionId: session.sessionId, type: "session_updated" });
  }

  private toRenderer(session: CoworkSessionRuntimeState): CoworkRendererSession {
    return toRendererSession(
      session,
      this.permissions.getPendingForSession(session.sessionId),
      this.homePath,
      this.folderExists,
    );
  }
}
