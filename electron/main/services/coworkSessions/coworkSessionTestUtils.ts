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
  CoworkPermissionMode,
  CoworkRuntimeQuery,
  CoworkSdkMessage,
  CoworkSessionRuntimeState,
} from "./coworkSessionTypes";

type MessageResolver = (result: IteratorResult<CoworkSdkMessage>) => void;

export class TestCoworkQuery implements CoworkRuntimeQuery {
  readonly models: string[] = [];
  readonly permissionModes: CoworkPermissionMode[] = [];
  closed = false;
  interrupted = false;
  private done = false;
  private readonly messages: CoworkSdkMessage[] = [];
  private readonly resolvers: MessageResolver[] = [];

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
  override getAccountDetails(): CoworkAccountDetails {
    return {
      accountUuid: "account-1",
      emailAddress: "cowork@example.com",
      isLoggedOut: false,
    };
  }

  override getIdentity(): CoworkAccountIdentity {
    return { accountUuid: "account-1", organizationUuid: "org-1" };
  }

  override waitForIdentity(): Promise<CoworkAccountIdentity> {
    return Promise.resolve(this.getIdentity());
  }
}

export function createTestAccountContext(): CoworkAccountContext {
  return new TestCoworkAccountContext();
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
