import type { CoworkPermissionBrokerOptions } from "./coworkPermissionBroker";
import type {
  CoworkAccountContext,
  CoworkAccountDetails,
  CoworkAccountIdentity,
} from "../coworkAccount/coworkAccountContext";
import type {
  CoworkPermissionEvent,
  CoworkPermissionRequestOptions,
  CoworkPermissionResolution,
  CoworkRuntimeQuery,
  CoworkSdkMessage,
  CoworkSdkUserMessage,
  CoworkSessionRuntimeState,
  CoworkStartSessionInput,
} from "./coworkSessionTypes";

export type CoworkInitializationStatus = {
  isComplete: boolean;
  message: string;
  step: string;
};

export type CoworkSessionEvent =
  | CoworkPermissionEvent
  | {
      initializationStatus: CoworkInitializationStatus;
      sessionId: string;
      type: "initialization_status";
    }
  | {
      message: CoworkSdkMessage;
      sessionId: string;
      type: "message";
      userMessageUuid?: string;
    }
  | { sessionId: string; type: "session_updated" }
  | { error: string; sessionId: string; type: "error" }
  | { code: number; sessionId: string; type: "close" }
  | { sessionId: string; type: "archived" }
  | {
      permissionMode: string;
      sessionId: string;
      type: "permission_mode_changed";
    };

export type CoworkQueryFactoryInput = {
  accountDetails: CoworkAccountDetails | null;
  accountIdentity: CoworkAccountIdentity;
  canUseTool: (
    request: CoworkPermissionRequestOptions,
  ) => Promise<CoworkPermissionResolution>;
  cwd: string;
  enabledMcpTools?: unknown;
  forkSession?: boolean;
  hostLoopMode?: boolean;
  mcpServers?: Record<string, unknown>;
  model?: string;
  permissionMode?: string;
  prompt: AsyncIterable<CoworkSdkUserMessage>;
  remoteMcpServers?: unknown[];
  resume?: string;
  resumeSessionAt?: string;
  sessionId: string;
  systemPrompt?: string;
  userSelectedFolders: string[];
};

export type CoworkQueryFactory = (
  input: CoworkQueryFactoryInput,
) => CoworkRuntimeQuery | Promise<CoworkRuntimeQuery>;

export type CoworkTranscriptOptions = {
  limit?: number;
  maxScan?: number;
  types?: string[];
};

export type CoworkTranscriptReader = (
  session: CoworkSessionRuntimeState,
  options?: CoworkTranscriptOptions,
) => Promise<CoworkSdkMessage[]>;

export type CoworkSessionPersistencePort = {
  deleteSession(session: CoworkSessionRuntimeState): Promise<void>;
  flushSession(sessionId: string): Promise<void>;
  loadSessions(): Promise<CoworkSessionRuntimeState[]>;
  saveSession(session: CoworkSessionRuntimeState): void;
};

export type CoworkSessionPersistenceFactory = (
  identity: CoworkAccountIdentity,
) => CoworkSessionPersistencePort;

export type CoworkSessionUpdate = Partial<
  Pick<
    CoworkSessionRuntimeState,
    | "cwd"
    | "enabledMcpTools"
    | "isAgentCompleted"
    | "isStarred"
    | "model"
    | "permissionMode"
    | "resolvedFolders"
    | "spaceId"
    | "spaceIdSetBy"
    | "systemPrompt"
    | "title"
    | "userSelectedProjectUuids"
  >
>;

export type CoworkSessionManagerOptions = {
  accountContext: CoworkAccountContext;
  createPersistence: CoworkSessionPersistenceFactory;
  createProcessName?: (sessionId: string) => string;
  createSessionId?: () => string;
  emit: (event: CoworkSessionEvent) => void;
  folderExists?: (folder: string) => boolean;
  homePath?: string;
  now?: () => number;
  onQueryCompleted?: (sessionId: string) => void;
  permissionBroker?: Omit<CoworkPermissionBrokerOptions, "emit">;
  queryFactory: CoworkQueryFactory;
  /**
   * New-session host-loop decision (official v4()).
   * Resume inherits existing session.hostLoopMode inside the manager and does not call this.
   */
  resolveHostLoopMode?: (input: CoworkStartSessionInput) => boolean;
  /** Official uHA(): org requires full VM sandbox — reject resume of host-loop sessions. */
  requireCoworkFullVmSandbox?: () => boolean;
  transcriptReader?: CoworkTranscriptReader;
};
