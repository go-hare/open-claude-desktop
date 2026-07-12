import type {
  CoworkAccountContext,
  CoworkAccountDetails,
  CoworkAccountIdentity,
} from "../coworkAccount/coworkAccountContext";
import type {
  CoworkSessionPersistenceFactory,
  CoworkSessionPersistencePort,
} from "./coworkSessionManagerTypes";
import { createRuntimeState } from "./coworkSessionState";
import type {
  CoworkSessionRuntimeState,
  CoworkStartSessionInput,
} from "./coworkSessionTypes";

type CoworkSessionRepositoryOptions = {
  accountContext: CoworkAccountContext;
  createPersistence: CoworkSessionPersistenceFactory;
  createProcessName: (sessionId: string) => string;
  now: () => number;
};

export class CoworkSessionRepository {
  private readonly accountContext: CoworkAccountContext;
  private readonly createPersistence: CoworkSessionPersistenceFactory;
  private readonly createProcessName: (sessionId: string) => string;
  private readonly now: () => number;
  private readonly sessions = new Map<string, CoworkSessionRuntimeState>();
  private identity: CoworkAccountIdentity | null = null;
  private initializeTask: Promise<void> | null = null;
  private persistence: CoworkSessionPersistencePort | null = null;

  constructor(options: CoworkSessionRepositoryOptions) {
    this.accountContext = options.accountContext;
    this.createPersistence = options.createPersistence;
    this.createProcessName = options.createProcessName;
    this.now = options.now;
  }

  async initialize(): Promise<void> {
    if (this.persistence) return;
    this.initializeTask ??= this.initializeFromAccount().finally(() => {
      this.initializeTask = null;
    });
    await this.initializeTask;
  }

  get(sessionId: string): CoworkSessionRuntimeState | undefined {
    return this.sessions.get(sessionId);
  }

  getAll(): CoworkSessionRuntimeState[] {
    return [...this.sessions.values()];
  }

  require(sessionId: string): CoworkSessionRuntimeState {
    const session = this.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    return session;
  }

  create(
    info: CoworkStartSessionInput,
    sessionId: string,
  ): CoworkSessionRuntimeState {
    const session = createRuntimeState(
      info,
      sessionId,
      this.createProcessName(sessionId),
      this.now(),
    );
    this.sessions.set(sessionId, session);
    return session;
  }

  getIdentity(): CoworkAccountIdentity {
    if (!this.identity) throw new Error("Cowork account identity unavailable");
    return this.identity;
  }

  getAccountDetails(): CoworkAccountDetails | null {
    return this.accountContext.getAccountDetails();
  }

  save(session: CoworkSessionRuntimeState): void {
    this.requirePersistence().saveSession(session);
  }

  saveIfInitialized(session: CoworkSessionRuntimeState): void {
    this.persistence?.saveSession(session);
  }

  flush(sessionId: string): Promise<void> {
    return this.requirePersistence().flushSession(sessionId);
  }

  async delete(session: CoworkSessionRuntimeState): Promise<void> {
    this.sessions.delete(session.sessionId);
    await this.requirePersistence().deleteSession(session);
  }

  private async initializeFromAccount(): Promise<void> {
    const identity =
      this.accountContext.getIdentity() ??
      (await this.accountContext.waitForIdentity(5_000));
    if (!identity) {
      throw new Error(
        "Unable to initialize Cowork sessions: account unavailable",
      );
    }
    this.identity = identity;
    this.persistence = this.createPersistence(identity);
    const restored = await this.persistence.loadSessions();
    for (const session of restored)
      this.sessions.set(session.sessionId, session);
  }

  private requirePersistence(): CoworkSessionPersistencePort {
    if (!this.persistence)
      throw new Error("CoworkSessionManager is not initialized");
    return this.persistence;
  }
}
