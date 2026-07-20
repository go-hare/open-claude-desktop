import type { CoworkPermissionBrokerOptions } from "./coworkPermissionBroker";
import type {
  CoworkAccountContext,
  CoworkAccountDetails,
  CoworkAccountIdentity,
} from "../coworkAccount/coworkAccountContext";
import type { CoworkModelConfig } from "./coworkSessionModel";
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

/** Official D1e fs_file_* payload (index-BELzQL5P ~113624). */
export type CoworkFsFileEventPayload = {
  fileName: string;
  hostPath: string;
  timestamp: number;
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
  | {
      /** Official emit type:"prompt_suggestion" data:suggestion string */
      data: string;
      sessionId: string;
      type: "prompt_suggestion";
    }
  | { error: string; sessionId: string; type: "error" }
  | { code: number; sessionId: string; type: "close" }
  | { sessionId: string; type: "archived" }
  | {
      fsFile: CoworkFsFileEventPayload;
      sessionId: string;
      type: "fs_file_created" | "fs_file_modified" | "fs_file_deleted";
    }
  | {
      permissionMode: string;
      sessionId: string;
      type: "permission_mode_changed";
    };

export type CoworkQueryFactoryInput = {
  accountDetails: CoworkAccountDetails | null;
  accountIdentity: CoworkAccountIdentity;
  /**
   * Official Th() / vi().allowedWorkspaceFolders for canUseTool prepare
   * (P4 host-path attach only). Settings residual when unset.
   */
  allowedWorkspaceFolders?: readonly string[] | null;
  /**
   * Official autoMemoryHostDir for host-loop V1i allow rules
   * (Edit/Write/Read under memory dir). Null skips memory rules.
   */
  autoMemoryDir?: string | null;
  /**
   * Official autoMemoryReadOnly (radar sessionType === Nu): Read-only memory.
   */
  autoMemoryReadOnly?: boolean;
  canUseTool: (
    request: CoworkPermissionRequestOptions,
  ) => Promise<CoworkPermissionResolution>;
  cwd: string;
  enabledMcpTools?: unknown;
  forkSession?: boolean;
  /**
   * Official getClaudeConfigDir = join(sessionStorageDir, ".claude").
   * Used for V1i Ohe Read(.../projects/.../tool-results/...).
   */
  hostClaudeConfigDir?: string | null;
  /** Official hostOutputsDir = join(sessionStorageDir, "outputs"). */
  hostOutputsDir?: string | null;
  /** Official hostUploadsDir under session storage. */
  hostUploadsDir?: string | null;
  hostLoopMode?: boolean;
  /**
   * Official session.readOnlyPluginPaths (set during UXe plugin/skills mounts).
   * Optional until full dual-exec plugin path collection is product-wired.
   */
  readOnlyPluginPaths?: string[] | null;
  mcpServers?: Record<string, unknown>;
  model?: string;
  permissionMode?: string;
  prompt: AsyncIterable<CoworkSdkUserMessage>;
  remoteMcpServers?: unknown[];
  resume?: string;
  resumeSessionAt?: string;
  sessionId: string;
  /**
   * Official session.sessionType for canUseTool headless/bridge gates
   * (agent / dispatch_child path-required). Local cowork omit → picker.
   */
  sessionType?: string | null;
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
  /**
   * Official getAutoMemoryDirForSession — space / agent / radar memory roots
   * under local-agent-mode-sessions/<account>/<org>.
   */
  getAutoMemoryDirForSession?(
    session: Pick<
      CoworkSessionRuntimeState,
      "memoryEnabled" | "sessionType" | "spaceId"
    >,
  ): string | null;
  /** Official getSessionStorageDir — used for outputs fallback when no userSelectedFolders. */
  getSessionStorageDir?(session: Pick<CoworkSessionRuntimeState, "sessionId" | "sessionType">): string;
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
    | "titleSource"
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
  /**
   * Official P4 native folder picker for mcp__cowork__request_cowork_directory
   * when path is omitted. Product wires Electron dialog.showOpenDialog.
   */
  pickDirectory?: () => Promise<
    { canceled: true } | { canceled: false; path: string }
  >;
  /**
   * Official ft("2979038612") — prefer queueSessionNotification over
   * DANGEROUS_invalidateBuiltPromptAndTools. Default true when unset.
   */
  preferSessionNotifications?: () => boolean;
  /**
   * Official ws.peek().getSpace(spaceId)?.name for updateSession space notify.
   * Optional inject — when unset, leave-space message or enter without name
   * falls back to official "no longer in a Space" / empty-name branch.
   */
  getSpaceName?: (spaceId: string) => string | null | undefined;
  /**
   * Official kI() model config for setModel (r2/aK/KwA/bRA/Kk).
   * Optional inject — when unset, helpers degrade like empty config.
   */
  getModelConfig?: () => CoworkModelConfig | null | undefined;
  /**
   * Official ft("3885610113") — append `[1m]` via Kk. Default true when unset.
   */
  enable1mContextAppend?: () => boolean;
  /**
   * Official ft("658929541") mid-session model lock. Default false when unset
   * (Statsig residual — do not invent product gate on).
   */
  lockMidSessionModel?: () => boolean;
  /**
   * Official ft("1942781881") — after success result with no pending input,
   * arm 5s _suggestionTimeout before idle (waiting for prompt_suggestion).
   * Default false when unset (Statsig residual — do not invent product gate on).
   */
  enablePromptSuggestionGrace?: () => boolean;
  /**
   * Official Th() / vi().allowedWorkspaceFolders for setDraftSessionFolders eBe.
   * null/undefined → unrestricted (copy). Empty [] drops all drafts.
   * Settings product store residual when unset.
   */
  getAllowedWorkspaceFolders?: () => readonly string[] | null | undefined;
  /**
   * Official gA.shell.openPath for openOutputsDir (after getOutputsDir + Ss residual).
   * Product injects Electron shell.openPath in registerDesktopIpc.
   */
  openPath?: (target: string) => Promise<string>;
  /**
   * Official LocalAgentModeSessionManager EventEmitter "focusedSessionChanged"
   * after setFocusedSession when value changes. Main process uses this to close
   * idle / AskUserQuestion / scheduled notifications (Ds residual).
   */
  onFocusedSessionChanged?: (sessionId: string | null) => void;
  /**
   * Official gA.shell.showItemInFolder for transcript feedback iXi bundle.
   * Product injects Electron shell.showItemInFolder in registerDesktopIpc.
   */
  showItemInFolder?: (target: string) => void;
  /**
   * Official nB("downloads") for iXi tar.gz output dir / J6e zip output.
   * Default pure modules use homedir()/Downloads when unset.
   */
  getDownloadsDir?: () => string;
  /**
   * Official gA.app.getPath("logs") for J6e shareSession log tree (LeA + zJi skip).
   * Omit → skip logs (same as pure export when logsDir unset).
   */
  getLogsDir?: () => string | null | undefined;
  /**
   * Official D7().appPath = gA.app.getAppPath() for S1/Qw path scrub on logs.
   * Empty/omit → skip appPath rewrite in scrub.
   */
  getAppPath?: () => string | null | undefined;
  /**
   * Official D7().homedir for S1/Qw path scrub. Default pure uses os.homedir().
   */
  getScrubHomedir?: () => string | null | undefined;
  /**
   * Official xn("allowAllBrowserActions", bool) AppPreferences setter used by
   * setChromePermissionMode / updateChromePermission. Product injects
   * settings.setPreference residual (preference key exists in official defaults;
   * no browser automation product).
   */
  setAllowAllBrowserActions?: (allowed: boolean) => void | Promise<void>;
  /**
   * Official `ps.updateChromePermissions(scheduledTaskId, mode, domains)` from
   * LocalAgentModeSessions.updateChromePermission. Scheduled-tasks product
   * residual when unset — session chrome fields still update.
   */
  updateScheduledTaskChromePermissions?: (
    scheduledTaskId: string,
    mode: string,
    domains: string[],
  ) => void | Promise<void>;
  /**
   * Official K2(): account present && !(isRaven ?? true).
   * Used for start chrome seed m and E_ skip_all outside unsupervised.
   * When omitted, manager derives via resolveCoworkK2AllowSkipAllOutsideUnsupervised
   * from accountContext.getAccountDetails() (no invent product store).
   */
  allowSkipAllOutsideUnsupervised?: () => boolean;
  /**
   * Official YM() CU feature gate for noteCuWindowMentions:
   *   QoA.has(platform) ? doA() && gi("chicagoEnabled") : false
   * (darwin/win32 + chicago config residual). Product inject only — do not invent
   * full doA/gi("chicagoEnabled") product store. Default true so host IPC path
   * still stores mentions when CU surface is present.
   */
  isComputerUseEnabled?: () => boolean;
  /**
   * Official gi("allowAllBrowserActions") AppPreferences read for start seed m.
   * Default false when unset.
   */
  getAllowAllBrowserActions?: () => boolean;
  /**
   * Official ps.getChromePermissions(scheduledTaskId) for start chrome seed.
   * Residual when scheduled-tasks product not wired.
   */
  getScheduledTaskChromePermissions?: (scheduledTaskId: string) =>
    | { domains?: string[]; mode?: string }
    | null
    | undefined;
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
