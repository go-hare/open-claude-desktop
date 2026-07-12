export type CoworkLifecycleState =
  "idle" | "initializing" | "running" | "stopping" | "archived";

export type CoworkSessionType =
  "agent" | "dispatch_child" | "radar" | "scheduled" | (string & {});

export type CoworkPermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "default"
  | "dontAsk"
  | "plan"
  | (string & {});

export type CoworkImagePayload = {
  base64: string;
  filename?: string;
  mimeType: string;
};

export type CoworkToolStateContent = {
  data?: string;
  media_type?: string;
  text?: string;
  type: string;
};

export type CoworkToolState = {
  content: CoworkToolStateContent[];
  tool_name: string;
};

export type CoworkSdkMessage = {
  type: string;
  uuid?: string;
  [key: string]: unknown;
};

export type CoworkSdkUserMessage = CoworkSdkMessage & {
  client_platform: "desktop_app";
  message: {
    content: string | unknown[];
    role: "user";
  };
  parent_tool_use_id: null;
  session_id: string;
  tool_states?: CoworkToolState[];
  type: "user";
  user_selected_files?: string[];
  uuid: string;
};

export type CoworkResolvedFolder = {
  canonical?: string;
  display: string;
  kind: "junction-to-unc" | "literal-unc" | "local" | "network-drive";
  unc?: string;
};

export type CoworkDetectedFile = {
  fileName: string;
  hostPath: string;
  timestamp: number;
};

export type CoworkMountedProject = {
  hostPath: string;
  mountPath?: string;
  name: string;
  uuid: string;
};

export interface CoworkRuntimeQuery extends AsyncIterable<CoworkSdkMessage> {
  close(): void;
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  setPermissionMode?(mode: CoworkPermissionMode): Promise<void>;
  supportedCommands?(): Promise<Array<{ description?: string; name: string }>>;
}

export interface CoworkRuntimeInputStream {
  done(): void;
  enqueue(message: CoworkSdkUserMessage): void;
  hasPending(): boolean;
}

export type CoworkQueuedStartMessage = {
  channel?: string;
  images?: CoworkImagePayload[];
  message: string;
  messageUuid?: string;
  toolStates?: CoworkToolState[];
  userSelectedFiles?: string[];
};

export type CoworkStartSessionInput = {
  accountName?: string;
  channel?: string;
  chromeAllowedDomains?: string[];
  chromeSkipAllPermissionChecks?: boolean;
  cuAppHints?: unknown[];
  egressAllowedDomains?: string[];
  emailAddress?: string;
  enabledCliOps?: unknown;
  enabledMcpTools?: unknown;
  images?: CoworkImagePayload[];
  hostLoopMode?: boolean;
  imagineSystemPrompt?: string;
  mcpServers?: Record<string, unknown>;
  memoryEnabled?: boolean;
  message: string;
  messageUuid?: string;
  model?: string;
  orgCliExecPolicies?: unknown;
  otelConfig?: unknown;
  parentSessionId?: string;
  permissionMode?: CoworkPermissionMode;
  pluginsEnabled?: boolean;
  remoteMcpServers?: unknown[];
  scheduledTaskId?: string;
  sessionId?: string;
  sessionType?: CoworkSessionType;
  skillsEnabled?: boolean;
  spaceId?: string;
  systemPrompt?: string;
  title?: string;
  toolStates?: CoworkToolState[];
  userSelectedFiles?: string[];
  userSelectedFolders?: string[];
  userSelectedProjectUuids?: string[];
};

export type CoworkSendMessageInput = {
  channel?: string;
  images?: CoworkImagePayload[];
  message: string;
  messageUuid?: string;
  sessionId: string;
  toolStates?: CoworkToolState[];
  userSelectedFiles?: string[];
};

export type CoworkPermissionDecision = "always" | "deny" | "once";

export type CoworkPermissionResolution = {
  behavior: "allow" | "deny";
  decisionClassification?: "user_permanent" | "user_reject" | "user_temporary";
  interrupt?: boolean;
  message?: string;
  updatedInput?: unknown;
  updatedPermissions?: unknown;
};

export type CoworkToolPermissionRequest = {
  channel?: string;
  input: unknown;
  requestId: string;
  sessionId: string;
  suggestions?: unknown;
  toolName: string;
};

export type CoworkPermissionRequestOptions = {
  channel?: string;
  input: unknown;
  isExternal?: boolean;
  ownerSessionId?: string;
  sessionId: string;
  signal?: AbortSignal;
  suggestions?: unknown;
  toolName: string;
};

export type CoworkPendingPermission = CoworkPermissionRequestOptions & {
  abortCleanup?: () => void;
  requestId: string;
  requestedAt: number;
  resolve: (resolution: CoworkPermissionResolution) => void;
  stalledCleanup?: () => void;
};

export type CoworkPermissionEvent =
  | {
      request: CoworkToolPermissionRequest;
      sessionId: string;
      type: "tool_permission_request";
    }
  | {
      request: Omit<CoworkToolPermissionRequest, "channel" | "suggestions">;
      sessionId: string;
      type: "tool_permission_resolved";
    };

export type CoworkPersistedSessionMetadata = {
  approvedToolNames?: string[];
  cliSessionId?: string;
  createdAt: number;
  cwd: string;
  enabledMcpTools?: unknown;
  error?: string;
  fsDetectedFiles?: CoworkDetectedFile[];
  hostLoopMode?: boolean;
  initialMessage?: string;
  isAgentCompleted?: boolean;
  isArchived: boolean;
  isStarred?: boolean;
  lastActivityAt: number;
  model?: string;
  parentSessionId?: string;
  pendingNotifications?: unknown[];
  pendingRewindTo?: string;
  permissionMode?: CoworkPermissionMode;
  processName: string;
  promptSuggestion?: string;
  remoteMcpServersConfig?: unknown[];
  scheduledTaskId?: string;
  sessionId: string;
  sessionType?: CoworkSessionType;
  spaceId?: string;
  spaceIdSetBy?: "auto" | "user";
  systemPrompt?: string;
  title?: string;
  userSelectedFolders: string[];
  userSelectedProjectUuids?: string[];
  vmProcessName: string;
};

export type CoworkSessionRuntimeState = {
  approvedToolNames?: string[];
  cliSessionId?: string;
  createdAt: number;
  cwd: string;
  enabledMcpTools?: unknown;
  error?: string;
  fsDetectedFiles: Map<string, CoworkDetectedFile>;
  hostLoopMode?: boolean;
  initialMessage?: string;
  inputStream: CoworkRuntimeInputStream | null;
  isAgentCompleted?: boolean;
  isFirstTurn: boolean;
  isStarred?: boolean;
  lastActivityAt: number;
  lifecycleState: CoworkLifecycleState;
  messageBuffer: CoworkSdkMessage[];
  mcpServers?: Record<string, unknown>;
  model?: string;
  parentSessionId?: string;
  pendingNotifications: unknown[];
  pendingRewindTo?: string;
  pendingStartMessages?: CoworkQueuedStartMessage[];
  permissionMode?: CoworkPermissionMode;
  processName: string;
  promptSuggestion?: string;
  query: CoworkRuntimeQuery | null;
  remoteMcpServersConfig?: unknown[];
  resolvedFolders: CoworkResolvedFolder[];
  scheduledTaskId?: string;
  sessionId: string;
  sessionType?: CoworkSessionType;
  spaceId?: string;
  spaceIdSetBy?: "auto" | "user";
  systemPrompt?: string;
  title?: string;
  userSelectedProjectUuids?: string[];
  vmProcessName: string;
};

export type CoworkRendererSession = {
  bufferedMessages?: CoworkSdkMessage[];
  cliSessionId?: string;
  createdAt: number;
  cwd: string;
  enabledMcpTools?: unknown;
  error?: string;
  folderExists?: boolean;
  homePath?: string;
  hostLoopMode?: boolean;
  initializationStatus?: { isComplete: boolean; message: string; step: string };
  isAgentCompleted?: boolean;
  isArchived?: boolean;
  isRunning: boolean;
  isStarred?: boolean;
  lastActivityAt: number;
  localMcpServers?: unknown[];
  model?: string;
  mountedProjects?: CoworkMountedProject[];
  parentSessionId?: string;
  pendingToolPermissions?: CoworkToolPermissionRequest[];
  permissionMode?: CoworkPermissionMode;
  promptSuggestion?: string;
  scheduledTaskId?: string;
  sessionId: string;
  sessionType?: CoworkSessionType;
  spaceId?: string;
  title?: string;
  userSelectedFolders: string[];
  userSelectedProjectUuids?: string[];
};
