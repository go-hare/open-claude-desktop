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

/**
 * Official xUt / QV chrome permission modes for LocalAgentModeSessions
 * setChromePermissionMode (ask | skip_all_permission_checks | follow_a_plan).
 */
export type CoworkChromePermissionMode =
  | "ask"
  | "skip_all_permission_checks"
  | "follow_a_plan";

/** Official chromePermsBeforeUnsupervised snapshot (mode + domains). */
export type CoworkChromePermsBeforeUnsupervised = {
  domains?: string[];
  mode?: CoworkChromePermissionMode;
};

export const COWORK_CHROME_PERMISSION_MODES = [
  "ask",
  "skip_all_permission_checks",
  "follow_a_plan",
] as const satisfies readonly CoworkChromePermissionMode[];

export function isCoworkChromePermissionMode(
  value: unknown,
): value is CoworkChromePermissionMode {
  return (
    typeof value === "string" &&
    (COWORK_CHROME_PERMISSION_MODES as readonly string[]).includes(value)
  );
}

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

/**
 * Official IXi cuAllowedApps item:
 *   Vt.object({ bundleId, displayName, grantedAt }).optional() array element.
 * Field + persist + oXi/pwe/cXi residual only; full CU MCP / Chicago UI not product.
 * (Vendor AppGrant may add tier; official IXi schema does not.)
 */
export type CoworkCuAllowedApp = {
  bundleId: string;
  displayName: string;
  grantedAt: number;
};

/**
 * Official IXi cuGrantFlags:
 *   Vt.object({ clipboardRead, clipboardWrite, systemKeyCombos }).optional()
 * Default when absent in MCP host inject is Jp all-false (not session field default).
 */
export type CoworkCuGrantFlags = {
  clipboardRead: boolean;
  clipboardWrite: boolean;
  systemKeyCombos: boolean;
};

/**
 * Official session.cuMentionedWindows item for noteCuWindowMentions /
 * appendCuWindowHint (title + bundleId).
 */
export type CoworkCuMentionedWindow = {
  bundleId: string;
  title: string;
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

/**
 * Official SDK Query.applyFlagSettings partial Settings payload.
 * Product only types the host-loop mount permissions subset we emit.
 */
export type CoworkFlagSettings = {
  /**
   * Official setModel applyFlagSettings({ effortLevel }) — "unset" becomes
   * undefined before send.
   */
  effortLevel?: string | number | null;
  permissions?: {
    additionalDirectories?: string[];
    allow?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export interface CoworkRuntimeQuery extends AsyncIterable<CoworkSdkMessage> {
  /**
   * Official Query.applyFlagSettings — mid-session flag-layer merge
   * (control subtype apply_flag_settings). Used by mountFolderForSession
   * host-loop after addUserSelectedFolder.
   */
  applyFlagSettings?(settings: CoworkFlagSettings): Promise<void>;
  close(): void;
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  /**
   * Official Query.setMcpServers — mid-session MCP server map apply
   * (control subtype mcp_set_servers). Used by applyMcpServersIfIdle.
   */
  setMcpServers?(servers: Record<string, unknown>): Promise<unknown>;
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

export type CoworkOtelConfig = {
  /** Official otelConfig.endpoint — wFi may append host to egress allowlist. */
  endpoint?: string | null;
  headers?: unknown;
  protocol?: string | null;
  resourceAttributes?: unknown;
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
  otelConfig?: CoworkOtelConfig;
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
  /**
   * Official builtGen — bumped by DANGEROUS_invalidateBuiltPromptAndTools.
   * Optional residual until full UXe built* cache is product-wired.
   */
  builtGen?: number;
  /**
   * Official IXi chromeAllowedDomains — browser allowlist domains for session.
   */
  chromeAllowedDomains?: string[];
  /**
   * Official IXi chromePermissionMode enum (ask / skip_all / follow_a_plan).
   */
  chromePermissionMode?: CoworkChromePermissionMode;
  /**
   * Official saveSession chromePermsBeforeUnsupervised snapshot.
   * Written by setChromePermissionMode; gXi restore residual uses it.
   */
  chromePermsBeforeUnsupervised?: CoworkChromePermsBeforeUnsupervised;
  /**
   * Official IXi chromeTabGroupId (Vt.number().optional) — Chrome tab group
   * bound by CIC getChromeTabGroupId / onChromeTabGroupIdUpdated injects.
   * Field + persist only; full aze Chrome MCP residual not product.
   */
  chromeTabGroupId?: number;
  /**
   * Official IXi cuAllowedApps — computer-use granted apps list.
   * Field + persist + oXi inherit + onCuPermissionUpdated residual only;
   * full CU MCP / Chicago grant UI not product.
   */
  cuAllowedApps?: CoworkCuAllowedApp[];
  /**
   * Official IXi cuGrantFlags — clipboard/systemKeyCombos grant flags.
   */
  cuGrantFlags?: CoworkCuGrantFlags;
  cliSessionId?: string;
  createdAt: number;
  cwd: string;
  /**
   * Official startSession / session.egressAllowedDomains — host-loop workspace
   * web_fetch / bash network allowlist (Settings → Capabilities residual when unset).
   */
  egressAllowedDomains?: string[];
  enabledMcpTools?: unknown;
  error?: string;
  /** Official setFileDeleteApprovedForMount names (persist across restarts). */
  fileDeleteApprovedMounts?: string[];
  fsDetectedFiles?: CoworkDetectedFile[];
  hostLoopMode?: boolean;
  initialMessage?: string;
  isAgentCompleted?: boolean;
  isArchived: boolean;
  isStarred?: boolean;
  lastActivityAt: number;
  memoryEnabled?: boolean;
  model?: string;
  /**
   * Official session.overrideLabel — synthetic setModel display label when
   * r2 remaps to a different SDK model id. Cleared when selecting a non-synthetic id.
   */
  overrideLabel?: string;
  /** Official session.otelConfig — optional OTLP host append into egress list. */
  otelConfig?: CoworkOtelConfig;
  parentSessionId?: string;
  /** Official pendingNotifications string queue (system-reminder drain). */
  pendingNotifications?: string[];
  /**
   * Official pendingSystemReminder — single pre-user-message blob consumed via $MA
   * before drainPendingNotifications (worktree / space / etc. setters residual).
   */
  pendingSystemReminder?: string;
  pendingRewindTo?: string;
  permissionMode?: CoworkPermissionMode;
  processName: string;
  promptSuggestion?: string;
  remoteMcpServersConfig?: unknown[];
  scheduledTaskId?: string;
  sessionId: string;
  sessionType?: CoworkSessionType;
  /**
   * Official IXi slashCommands: Vt.array(Vt.string()).optional() —
   * assigned from system/init slash_commands; getSupportedCommands maps to
   * {name,description:name} before RT()+K2e.
   */
  slashCommands?: string[];
  spaceId?: string;
  spaceIdSetBy?: "auto" | "user";
  systemPrompt?: string;
  title?: string;
  /** Official titleSource — "user" blocks later auto renames. */
  titleSource?: "auto" | "user";
  userSelectedFolders: string[];
  userSelectedProjectUuids?: string[];
  vmProcessName: string;
};

export type CoworkSessionRuntimeState = {
  approvedToolNames?: string[];
  /**
   * Official built* cache invalidated by DANGEROUS_invalidateBuiltPromptAndTools.
   * Not required for applyFlagSettings path; residual until full UXe rebuild.
   */
  builtAllowedTools?: unknown;
  builtGen?: number;
  builtLocalMcpServers?: unknown;
  builtSystemPrompt?: string;
  builtTools?: unknown;
  /**
   * Official session.chromeAllowedDomains — browser domain allowlist.
   * setChromePermissionMode snapshots it into chromePermsBeforeUnsupervised.
   */
  chromeAllowedDomains?: string[];
  /**
   * Official session.chromePermissionMode (QV: ask | skip_all | follow_a_plan).
   */
  chromePermissionMode?: CoworkChromePermissionMode;
  /**
   * Official session.chromePermsBeforeUnsupervised — snapshot used when entering
   * unsupervised permission modes (gXi). setChromePermissionMode always writes
   * { mode, domains: chromeAllowedDomains }.
   */
  chromePermsBeforeUnsupervised?: CoworkChromePermsBeforeUnsupervised;
  /**
   * Official session.chromeTabGroupId — optional Chrome tab group id for CIC
   * browser automation (getChromeTabGroupId / onChromeTabGroupIdUpdated).
   * Persisted on saveSession; full aze canUseTool residual not product.
   */
  chromeTabGroupId?: number;
  /**
   * Official session.cicOnceApproved — Set of hosts allowed once this turn.
   * Runtime-only (cleared on leavingRunning / finishTurnCleanup). Not IXi.
   * Used by aze canUseTool CIC residual.
   */
  cicOnceApproved?: Set<string>;
  /**
   * Official session.activeMcpServers — live MCP server map for query.setMcpServers.
   * Runtime residual; full mcpCoordinator createAllServers product not invented.
   */
  activeMcpServers?: Record<string, unknown>;
  cliSessionId?: string;
  createdAt: number;
  /**
   * Official session.cuAllowedApps — computer-use granted apps.
   * getCuAllowedApps / onCuPermissionUpdated / oXi / pwe lifecycle prune.
   */
  cuAllowedApps?: CoworkCuAllowedApp[];
  /**
   * Official session.cuGrantFlags — clipboard + systemKeyCombos grants.
   */
  cuGrantFlags?: CoworkCuGrantFlags;
  /**
   * Official session.cuMentionedWindows — set by noteCuWindowMentions, consumed
   * once by appendCuWindowHint (cleared). Ephemeral; not persisted.
   */
  cuMentionedWindows?: CoworkCuMentionedWindow[];
  cwd: string;
  /**
   * Official session.egressAllowedDomains from startSession.
   * Product source for workspace MCP allowedDomains when vmEgressPolicy inject
   * is unset (Settings → Capabilities residual).
   */
  egressAllowedDomains?: string[];
  enabledMcpTools?: unknown;
  error?: string;
  /**
   * Official session.fileDeleteApprovedMounts — mount basenames approved for
   * delete via mcp__cowork__allow_cowork_file_delete.
   */
  fileDeleteApprovedMounts?: string[];
  fsDetectedFiles: Map<string, CoworkDetectedFile>;
  hostLoopMode?: boolean;
  /**
   * Official session.hostLoopOnFolderAdded — dual-exec UXe `onFolderAddedForBash`
   * callback set during query init. Host-loop mountFolderForSession uses:
   *   u = (n || hostLoopOnFolderAdded==null) ? void 0 : hostLoopOnFolderAdded(r)
   * (asar `n||(C=i.hostLoopOnFolderAdded)==null?void 0:C.call(i,r)` — `||` before `?:`).
   * Ephemeral (not persisted). Product dual-exec UXe residual — unset is honest.
   */
  hostLoopOnFolderAdded?: ((hostPath: string) => string | undefined | null | void) | null;
  initialMessage?: string;
  inputStream: CoworkRuntimeInputStream | null;
  isAgentCompleted?: boolean;
  isFirstTurn: boolean;
  isStarred?: boolean;
  lastActivityAt: number;
  lifecycleState: CoworkLifecycleState;
  messageBuffer: CoworkSdkMessage[];
  mcpServers?: Record<string, unknown>;
  /**
   * Official startSession `memoryEnabled`. When `false`, auto-memory mount is
   * disabled (`getAutoMemoryDirForSession` → null). Undefined/true keeps default.
   */
  memoryEnabled?: boolean;
  model?: string;
  /**
   * Official session.overrideLabel — synthetic setModel display label.
   * Persist + restore; used by setModel same-label noop / notify label.
   */
  overrideLabel?: string;
  /**
   * Official session.cachedTotalTurns — used by ft("658929541") mid-session
   * model lock with messageBuffer.length. Accumulated on stopSession from
   * user messageBuffer entries (runtime-only; not in IXi persist schema).
   */
  cachedTotalTurns?: number;
  /**
   * Official session._turnInterruptRequested — set true by interruptTurn before
   * query.interrupt(); cleared on idle transition. Runtime-only (not IXi);
   * used by CU isAborted / API error suppress / result interrupt paths.
   */
  _turnInterruptRequested?: boolean;
  /**
   * Official session._suggestionTimeout — runtime-only Node timer after success
   * when ft("1942781881") arms 5s grace waiting for prompt_suggestion stream.
   * Cleared on stop / sendMessage / prompt_suggestion / stream end. Not IXi.
   * Residual: real Statsig gate product (inject only, default off).
   */
  _suggestionTimeout?: ReturnType<typeof setTimeout>;
  /**
   * Official session._idleGraceTimer — runtime-only Node timer after transition
   * to idle when wr idleGraceMs>0 and process kept for warm resume. Not IXi.
   * Residual: Statsig idleGraceMs product inject (default 0).
   */
  _idleGraceTimer?: ReturnType<typeof setTimeout>;
  /**
   * Official session._idleGraceStartedAt — wall ms when grace armed.
   * Cleared with timer. Not IXi.
   */
  _idleGraceStartedAt?: number;
  /**
   * Official session._lastIdleAt — set on every transitionTo idle.
   * Runtime-only (not IXi).
   */
  _lastIdleAt?: number;
  /**
   * Official session.mcpServersDirty — defer setMcpServers while Wl(session).
   * Runtime-only; flushed on idle-grace arm warm branch.
   */
  mcpServersDirty?: boolean;
  /** Official session.otelConfig. */
  otelConfig?: CoworkOtelConfig;
  parentSessionId?: string;
  pendingNotifications: string[];
  /**
   * Official pendingSystemReminder — consumed once on next user message ($MA).
   */
  pendingSystemReminder?: string;
  pendingRewindTo?: string;
  pendingStartMessages?: CoworkQueuedStartMessage[];
  /**
   * Ephemeral: last user message uuid for official je permission analytics
   * (`user_message_uuid` on lam_tool_permission_*). Not persisted.
   */
  pendingUserMessageUuid?: string | null;
  permissionMode?: CoworkPermissionMode;
  processName: string;
  promptSuggestion?: string;
  /**
   * Official session.slashCommands — string[] from system/init slash_commands.
   * IXi-persisted; getSupportedCommands maps name→{name,description:name}.
   */
  slashCommands?: string[];
  query: CoworkRuntimeQuery | null;
  /**
   * Official session.readOnlyPluginPaths (set during UXe plugin/skills mounts).
   * Host-loop V1i appends Read(path) for each. Optional until dual-exec collection
   * is product-wired — do not invent plugin roots.
   */
  readOnlyPluginPaths?: string[] | null;
  remoteMcpServersConfig?: unknown[];
  resolvedFolders: CoworkResolvedFolder[];
  scheduledTaskId?: string;
  sessionId: string;
  sessionType?: CoworkSessionType;
  spaceId?: string;
  spaceIdSetBy?: "auto" | "user";
  systemPrompt?: string;
  title?: string;
  /** Official titleSource — "user" blocks later auto renames. */
  titleSource?: "auto" | "user";
  userSelectedProjectUuids?: string[];
  vmProcessName: string;
  /**
   * Official session.widgetToolStates — assigned from sendMessage toolStates
   * (`"toolStates"in o&&(s.widgetToolStates=o.toolStates)`). Used by
   * appendWidgetContextHint. Ephemeral; not persisted.
   */
  widgetToolStates?: CoworkToolState[];
};

export type CoworkRendererSession = {
  bufferedMessages?: CoworkSdkMessage[];
  /**
   * Official getSession chromeAllowedDomains for browser permission UI hydrate.
   */
  chromeAllowedDomains?: string[];
  /**
   * Official getSession chromePermissionMode.
   */
  chromePermissionMode?: CoworkChromePermissionMode;
  /**
   * Official session.chromePermsBeforeUnsupervised snapshot (save/get parity).
   */
  chromePermsBeforeUnsupervised?: CoworkChromePermsBeforeUnsupervised;
  /**
   * Official getSession chromeTabGroupId (optional number).
   */
  chromeTabGroupId?: number;
  cliSessionId?: string;
  createdAt: number;
  /**
   * Official getSession cuAllowedApps for CU permission UI hydrate.
   */
  cuAllowedApps?: CoworkCuAllowedApp[];
  /**
   * Official getSession cuGrantFlags.
   */
  cuGrantFlags?: CoworkCuGrantFlags;
  cwd: string;
  enabledMcpTools?: unknown;
  error?: string;
  /** Official getSession local_agent_mode: fsDetectedFiles array for activity Me hydrate. */
  fsDetectedFiles?: CoworkDetectedFile[];
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
  /** Official getSession overrideLabel for synthetic model chips. */
  overrideLabel?: string;
  mountedProjects?: CoworkMountedProject[];
  parentSessionId?: string;
  pendingToolPermissions?: CoworkToolPermissionRequest[];
  permissionMode?: CoworkPermissionMode;
  promptSuggestion?: string;
  scheduledTaskId?: string;
  sessionId: string;
  sessionType?: CoworkSessionType;
  /** Official init slash_commands string names (getSupportedCommands seed). */
  slashCommands?: string[];
  spaceId?: string;
  title?: string;
  userSelectedFolders: string[];
  userSelectedProjectUuids?: string[];
};
