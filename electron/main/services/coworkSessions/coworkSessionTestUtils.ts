import { CoworkAccountContext } from "../coworkAccount/coworkAccountContext";
import { CoworkSessionManager } from "./coworkSessionManager";
import type {
  CoworkAccountDetails,
  CoworkAccountIdentity,
} from "../coworkAccount/coworkAccountContext";
import type {
  CoworkQueryFactoryInput,
  CoworkSessionEvent,
  CoworkSessionManagerOptions,
  CoworkSessionPersistencePort,
} from "./coworkSessionManagerTypes";
import type {
  CoworkFlagSettings,
  CoworkPermissionMode,
  CoworkRuntimeQuery,
  CoworkSdkMessage,
  CoworkSessionRuntimeState,
} from "./coworkSessionTypes";

type MessageResolver = (result: IteratorResult<CoworkSdkMessage>) => void;

export class TestCoworkQuery implements CoworkRuntimeQuery {
  readonly flagSettings: CoworkFlagSettings[] = [];
  readonly mcpServerSets: Array<Record<string, unknown>> = [];
  readonly models: string[] = [];
  readonly permissionModes: CoworkPermissionMode[] = [];
  closed = false;
  interrupted = false;
  private done = false;
  private readonly messages: CoworkSdkMessage[] = [];
  private readonly resolvers: MessageResolver[] = [];

  async applyFlagSettings(settings: CoworkFlagSettings): Promise<void> {
    this.flagSettings.push(settings);
  }

  close(): void {
    this.closed = true;
    this.finish();
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
  }

  async setModel(model: string): Promise<void> {
    this.models.push(model);
  }

  async setMcpServers(servers: Record<string, unknown>): Promise<unknown> {
    this.mcpServerSets.push(servers);
    return { ok: true };
  }

  async setPermissionMode(mode: CoworkPermissionMode): Promise<void> {
    this.permissionModes.push(mode);
  }

  push(message: CoworkSdkMessage): void {
    const resolver = this.resolvers.shift();
    if (resolver) resolver({ done: false, value: message });
    else this.messages.push(message);
  }

  finish(): void {
    this.done = true;
    for (const resolver of this.resolvers.splice(0)) {
      resolver({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<CoworkSdkMessage> {
    return { next: () => this.next() };
  }

  private next(): Promise<IteratorResult<CoworkSdkMessage>> {
    const message = this.messages.shift();
    if (message) return Promise.resolve({ done: false, value: message });
    if (this.done) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve) => this.resolvers.push(resolve));
  }
}

export class TestCoworkPersistence implements CoworkSessionPersistencePort {
  readonly deleted: string[] = [];
  readonly flushed: string[] = [];
  readonly saved: CoworkSessionRuntimeState[] = [];
  restored: CoworkSessionRuntimeState[] = [];
  /**
   * Optional inject for getOutputsDir / host-loop applyFlagSettings tests.
   * When unset, getSessionStorageDir is undefined so createQuery stays
   * sync-fast (existing manager tests race fire-and-forget start).
   */
  sessionStorageDir: string | null = null;
  /** Populated only when sessionStorageDir is set (optional persistence API). */
  getSessionStorageDir?: (
    session: Pick<CoworkSessionRuntimeState, "sessionId" | "sessionType">,
  ) => string;

  constructor() {
    const self = this;
    Object.defineProperty(this, "getSessionStorageDir", {
      configurable: true,
      enumerable: true,
      get() {
        if (!self.sessionStorageDir) return undefined;
        return (
          _session: Pick<CoworkSessionRuntimeState, "sessionId" | "sessionType">,
        ) => self.sessionStorageDir as string;
      },
    });
  }

  async deleteSession(session: CoworkSessionRuntimeState): Promise<void> {
    this.deleted.push(session.sessionId);
  }

  async flushSession(sessionId: string): Promise<void> {
    this.flushed.push(sessionId);
  }

  async loadSessions(): Promise<CoworkSessionRuntimeState[]> {
    return this.restored;
  }

  saveSession(session: CoworkSessionRuntimeState): void {
    this.saved.push(session);
  }
}

class TestCoworkAccountContext extends CoworkAccountContext {
  private readonly accountDetails: CoworkAccountDetails;

  constructor(details: Partial<CoworkAccountDetails> = {}) {
    super();
    this.accountDetails = {
      accountUuid: "account-1",
      emailAddress: "cowork@example.com",
      isLoggedOut: false,
      ...details,
    };
  }

  override getAccountDetails(): CoworkAccountDetails {
    return { ...this.accountDetails };
  }

  override getIdentity(): CoworkAccountIdentity {
    return { accountUuid: "account-1", organizationUuid: "org-1" };
  }

  override waitForIdentity(): Promise<CoworkAccountIdentity> {
    return Promise.resolve(this.getIdentity());
  }
}

export function createTestAccountContext(
  details: Partial<CoworkAccountDetails> = {},
): CoworkAccountContext {
  return new TestCoworkAccountContext(details);
}

export type CoworkManagerHarness = {
  events: CoworkSessionEvent[];
  factoryInputs: CoworkQueryFactoryInput[];
  persistence: TestCoworkPersistence;
  query: TestCoworkQuery;
};

export function createManagerHarness(): CoworkManagerHarness {
  return {
    events: [],
    factoryInputs: [],
    persistence: new TestCoworkPersistence(),
    query: new TestCoworkQuery(),
  };
}

export function createTestManager(
  harness: CoworkManagerHarness,
  overrides: Partial<CoworkSessionManagerOptions> = {},
): CoworkSessionManager {
  const options: CoworkSessionManagerOptions = {
    accountContext: createTestAccountContext(),
    createPersistence: () => harness.persistence,
    createProcessName: () => "process-1",
    createSessionId: () => "local_session_1",
    emit: (event) => harness.events.push(event),
    folderExists: () => true,
    homePath: "/Users/cowork",
    now: () => 1_000,
    queryFactory: (input) => {
      harness.factoryInputs.push(input);
      return harness.query;
    },
    ...overrides,
  };
  return new CoworkSessionManager(options);
}
