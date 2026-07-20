import { existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import type { CoworkPermissionBroker } from "./coworkPermissionBroker";
import { CoworkFileSystemWatcher } from "./coworkFileSystemWatcher";
import { createCoworkManagerPermissionBroker } from "./coworkSessionManagerFactories";
import { getCoworkSupportedCommands, type CoworkSlashCommand } from "./coworkSessionCommands";
import {
  COWORK_HOST_LOOP_RESUME_REJECTED,
  shouldRejectCoworkHostLoopResume,
} from "../coworkHostLoop/coworkHostLoopMode";
import { coworkHostLoopMountFlagSettings } from "../coworkHostLoop/coworkHostToolPolicy";
import type { CoworkSessionManagerOptions, CoworkSessionUpdate, CoworkTranscriptOptions } from "./coworkSessionManagerTypes";
import { CoworkSessionRepository } from "./coworkSessionRepository";
import { rewindCoworkSession } from "./coworkSessionRewind";
import { CoworkSessionRuntimeController } from "./coworkSessionRuntimeController";
import {
  classifyCoworkPathKind,
  type CoworkPathKind,
} from "../coworkRuntime/coworkDirectoryMcpServer";
import {
  coworkFolderPermissionPaths,
  coworkPathKindMountPath,
  coworkUserSelectedFolderPaths,
  filterCoworkDraftSessionFolders,
  mountCoworkSessionFolderFromPathKind,
  resolveAndFilterCoworkSessionFolders,
  type CoworkAddFolderResult,
} from "./coworkSessionWorkspace";
import {
  applyCoworkSessionSpaceIdUpdate,
  applyCoworkSessionTitleUpdate,
  coworkFoldersNoLongerAvailableMessage,
  invalidateCoworkBuiltPromptAndTools,
  notifyCoworkHostLoopFolderAccess,
  notifyCoworkModelSwitched,
  notifyCoworkQueuedMountNextResume,
  accumulateCoworkCachedTotalTurnsOnStop,
  clearCoworkSessionEphemeralsOnLeavingRunning,
  queueCoworkSessionNotification,
} from "./coworkSessionNotifications";
import {
  clearCoworkPromptSuggestionState,
  prepareCoworkSendMessageSuggestionClear,
} from "./coworkPromptSuggestionHelpers";
import {
  applyCowork1mContextModelSuffix,
  resolveCoworkSetModelChange,
  type CoworkModelConfig,
} from "./coworkSessionModel";
import {
  resolveCoworkReplaceEnabledMcpToolsChange,
  resolveCoworkReplaceRemoteMcpServersChange,
  type CoworkEnabledMcpToolsMap,
  type CoworkRemoteMcpServerConfig,
} from "./coworkMcpToolsState";
import {
  isCoworkTranscriptFeedback,
  readCoworkTranscriptFeedback,
  submitCoworkTranscriptFeedback,
  type CoworkTranscriptFeedback,
} from "./coworkTranscriptFeedback";
import {
  applyCoworkChromePermissionFields,
  applyCoworkDispatchChildStartInherit,
  mergeCoworkChromePermissionWriteBack,
  resolveCoworkChromePermsOnPermissionModeChange,
} from "./coworkChromePermissionMode";
import {
  buildCoworkBrowserPermissionToolRequest,
  isCoworkHiddenSessionType,
  mapCoworkBrowserPermissionResult,
  resolveCoworkK2AllowSkipAllOutsideUnsupervised,
  resolveCoworkPermissionSessionId,
  type CoworkBrowserPermissionRequestInput,
} from "./coworkChromeCicHelpers";
import {
  COWORK_DISPATCH_CU_GRANT_TTL_MS,
  isCoworkSessionTurnAborted,
  mergeCoworkCuPermissionWriteBack,
  pruneCoworkCuAllowedAppsByTtl,
  pruneCoworkSessionCuGrantsOnTurnStart,
} from "./coworkCuPermissionHelpers";
import {
  exportCoworkCliSessionTranscript,
  type CoworkShareSessionResult,
} from "./coworkSessionShareExport";
import {
  deriveMountNamesIncremental,
  normalizeCoworkVmMountPathSegment,
  resolveCoworkHostLoopBashMountName,
} from "./coworkVmPathTranslation";
import { applyStartInput, createDefaultCoworkProcessName, createDefaultCoworkSessionId, createResumeInput, isValidCoworkSessionId, toRendererSession } from "./coworkSessionState";
import type {
  CoworkChromePermissionMode,
  CoworkCuAllowedApp,
  CoworkCuGrantFlags,
  CoworkCuMentionedWindow,
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
  private readonly fileWatcher: CoworkFileSystemWatcher;
  private readonly folderExists: (folder: string) => boolean;
  private readonly homePath: string;
  private readonly now: () => number;
  private readonly permissions: CoworkPermissionBroker;
  private readonly getSpaceName?: (spaceId: string) => string | null | undefined;
  private readonly getModelConfig?: () => CoworkModelConfig | null | undefined;
  private readonly enable1mContextAppend: () => boolean;
  private readonly lockMidSessionModel: () => boolean;
  /**
   * Official ft("1942781881") — arm 5s suggestion grace after success.
   * Statsig residual: default false.
   */
  private readonly enablePromptSuggestionGrace: () => boolean;
  private readonly preferSessionNotifications: () => boolean;
  private readonly getAllowedWorkspaceFolders?: () =>
    | readonly string[]
    | null
    | undefined;
  private readonly openPath?: (target: string) => Promise<string>;
  private readonly onFocusedSessionChanged?: (
    sessionId: string | null,
  ) => void;
  private readonly showItemInFolder?: (target: string) => void;
  private readonly getDownloadsDir?: () => string;
  private readonly getLogsDir?: () => string | null | undefined;
  private readonly getAppPath?: () => string | null | undefined;
  private readonly getScrubHomedir?: () => string | null | undefined;
  /**
   * Official xn("allowAllBrowserActions", t==="skip_all_permission_checks").
   */
  private readonly setAllowAllBrowserActions?: (
    allowed: boolean,
  ) => void | Promise<void>;
  /**
   * Official ps.updateChromePermissions for scheduled-task mirror from
   * updateChromePermission. Residual when scheduled-tasks product not wired.
   */
  private readonly updateScheduledTaskChromePermissions?: (
    scheduledTaskId: string,
    mode: string,
    domains: string[],
  ) => void | Promise<void>;
  /** Official K2() inject for start chrome seed / E_. */
  private readonly allowSkipAllOutsideUnsupervised: () => boolean;
  /**
   * Official YM() inject for noteCuWindowMentions.
   * Residual: full doA + gi("chicagoEnabled") product store not invented.
   */
  private readonly isComputerUseEnabled: () => boolean;
  /** Official gi("allowAllBrowserActions") inject for start chrome seed. */
  private readonly getAllowAllBrowserActions: () => boolean;
  /** Official ps.getChromePermissions inject for start chrome seed. */
  private readonly getScheduledTaskChromePermissions?: (
    scheduledTaskId: string,
  ) => { domains?: string[]; mode?: string } | null | undefined;
  private readonly repository: CoworkSessionRepository;
  private readonly requireCoworkFullVmSandbox?: CoworkSessionManagerOptions["requireCoworkFullVmSandbox"];
  private readonly resolveHostLoopMode?: CoworkSessionManagerOptions["resolveHostLoopMode"];
  private readonly runtime: CoworkSessionRuntimeController;
  private readonly transcriptReader?: CoworkSessionManagerOptions["transcriptReader"];
  /** Official this.draftSessionFolders — pre-start folder draft list (eBe filtered). */
  private draftSessionFolders: string[] = [];
  /**
   * Official this.focusedSessionId = null — renderer-focused Cowork session.
   * Used by main notification skip/close (getFocusedSession residual).
   */
  private focusedSessionId: string | null = null;

  constructor(options: CoworkSessionManagerOptions) {
    this.createSessionId = options.createSessionId ?? createDefaultCoworkSessionId;
    this.emit = options.emit;
    this.folderExists = options.folderExists ?? existsSync;
    this.homePath = options.homePath ?? homedir();
    this.now = options.now ?? Date.now;
    // Official ft("2979038612") residual — default prefer notifications.
    this.preferSessionNotifications =
      options.preferSessionNotifications ?? (() => true);
    // Official ws.peek().getSpace(id)?.name inject for space change notify.
    this.getSpaceName = options.getSpaceName;
    // Official kI() / ft("3885610113") / ft("658929541") injects for setModel.
    this.getModelConfig = options.getModelConfig;
    this.enable1mContextAppend = options.enable1mContextAppend ?? (() => true);
    // Statsig residual: default off (do not invent product gate on).
    this.lockMidSessionModel = options.lockMidSessionModel ?? (() => false);
    // Official ft("1942781881") residual: default off (do not invent product gate on).
    this.enablePromptSuggestionGrace =
      options.enablePromptSuggestionGrace ?? (() => false);
    // Official Th() inject for setDraftSessionFolders eBe — Settings residual.
    this.getAllowedWorkspaceFolders = options.getAllowedWorkspaceFolders;
    // Official gA.shell.openPath for openOutputsDir.
    this.openPath = options.openPath;
    // Official EventEmitter "focusedSessionChanged" residual inject.
    this.onFocusedSessionChanged = options.onFocusedSessionChanged;
    // Official gA.shell.showItemInFolder + nB("downloads") for tXi/iXi.
    this.showItemInFolder = options.showItemInFolder;
    this.getDownloadsDir = options.getDownloadsDir;
    // Official gA.app.getPath("logs") for J6e shareSession.
    this.getLogsDir = options.getLogsDir;
    // Official D7() appPath/homedir for S1/Qw log scrub.
    this.getAppPath = options.getAppPath;
    this.getScrubHomedir = options.getScrubHomedir;
    // Official xn AppPreferences allowAllBrowserActions residual inject.
    this.setAllowAllBrowserActions = options.setAllowAllBrowserActions;
    // Official ps.updateChromePermissions residual inject.
    this.updateScheduledTaskChromePermissions =
      options.updateScheduledTaskChromePermissions;
    // Official K2() / gi("allowAllBrowserActions") for start chrome seed.
    // When inject omitted: derive K2 from accountContext.isRaven (qa() shape).
    this.allowSkipAllOutsideUnsupervised =
      options.allowSkipAllOutsideUnsupervised ??
      (() =>
        resolveCoworkK2AllowSkipAllOutsideUnsupervised(
          options.accountContext.getAccountDetails(),
        ));
    // Official YM() residual inject — default true (no invent chicagoEnabled off).
    this.isComputerUseEnabled = options.isComputerUseEnabled ?? (() => true);
    this.getAllowAllBrowserActions =
      options.getAllowAllBrowserActions ?? (() => false);
    this.getScheduledTaskChromePermissions =
      options.getScheduledTaskChromePermissions;
    this.requireCoworkFullVmSandbox = options.requireCoworkFullVmSandbox;
    this.resolveHostLoopMode = options.resolveHostLoopMode;
    this.transcriptReader = options.transcriptReader;
    this.repository = new CoworkSessionRepository({
      accountContext: options.accountContext,
      createPersistence: options.createPersistence,
      createProcessName: options.createProcessName ?? createDefaultCoworkProcessName,
      getCreateRuntimeChromeOptions: (info) => {
        const scheduled =
          info.scheduledTaskId && this.getScheduledTaskChromePermissions
            ? this.getScheduledTaskChromePermissions(info.scheduledTaskId)
            : undefined;
        return {
          allowAllBrowserActions: this.getAllowAllBrowserActions(),
          allowSkipAllOutsideUnsupervised:
            this.allowSkipAllOutsideUnsupervised(),
          scheduledChrome: scheduled
            ? {
                domains: scheduled.domains,
                mode: scheduled.mode as CoworkChromePermissionMode | undefined,
              }
            : undefined,
        };
      },
      now: this.now,
    });
    this.permissions = createCoworkManagerPermissionBroker(options, this.repository);
    this.runtime = this.createRuntimeController(options);
    // Official LocalAgentModeSessionManager: this.fileWatcher = new ANA; on("fsEvent", ...)
    this.fileWatcher = new CoworkFileSystemWatcher();
    this.fileWatcher.on("fsEvent", (event) => this.handleFsWatchEvent(event));
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
      if (!this.fileWatcher.isWatching(sessionId)) this.startFileWatching(sessionId);
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
    const isNewSession = !existing;
    const session = existing ?? this.repository.create(startInfo, sessionId);
    // Official after D seed: dispatch_child + parentSessionId → oXi(parent) +
    // chromePermsBeforeUnsupervised copy (overrides seed chrome for child).
    if (
      isNewSession &&
      startInfo.sessionType === "dispatch_child" &&
      startInfo.parentSessionId
    ) {
      applyCoworkDispatchChildStartInherit(
        session,
        this.repository.get(startInfo.parentSessionId),
      );
    }
    applyStartInput(session, startInfo);
    // Official doSessionInitialization:
    //   De = t.userSelectedFolders ?? []
    //   be = await resolveAndFilterSessionFolders(A, De, !!existing)
    //   Ke = resolvedFolders.slice(De.length); resolvedFolders = [...be, ...Ke]
    await this.resolveAndFilterFoldersForStart(session, startInfo, Boolean(existing));
    // Official drainPendingStartMessages → startFileWatching(userSelectedFolders) after init.
    // Our path starts the query async; start watching host folders immediately (same dirs).
    this.startFileWatching(sessionId);
    void this.runtime.start(session, startInfo).catch(() => undefined);
    return sessionId;
  }

  /**
   * Official resolveAndFilterSessionFolders + apply to session before query start.
   * FGi admin mount-root residual skipped when unrestricted (Th null → keep all).
   */
  private async resolveAndFilterFoldersForStart(
    session: CoworkSessionRuntimeState,
    info: CoworkStartSessionInput,
    resumeMode: boolean,
  ): Promise<void> {
    // Official: De = t.userSelectedFolders ?? [] (no fallback to existing folders).
    const inputFolders = info.userSelectedFolders ?? [];
    // Official Ke = resolvedFolders.slice(De.length) — extra mounts after USF prefix.
    const keepExtra = session.resolvedFolders.slice(inputFolders.length);
    const { resolved, missing } = await resolveAndFilterCoworkSessionFolders(
      inputFolders,
      { resumeMode },
    );
    session.resolvedFolders = [...resolved, ...keepExtra];
    if (resumeMode && missing.length > 0) {
      if (this.preferSessionNotifications()) {
        queueCoworkSessionNotification(
          session,
          coworkFoldersNoLongerAvailableMessage(missing),
        );
      } else {
        invalidateCoworkBuiltPromptAndTools(session);
      }
    }
    this.repository.save(session);
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
        // Official `"toolStates"in o` — omit when caller did not pass toolStates.
        ...(_toolStates !== undefined ? { toolStates: _toolStates } : {}),
        userSelectedFiles,
      });
      return;
    }
    // Official sendMessage head: clearTimeout(_suggestionTimeout) + promptSuggestion=void 0
    // + isAgentCompleted=false. Residual: cancelIdleGrace product not wired.
    const suggestionClear = prepareCoworkSendMessageSuggestionClear(session);
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
    // Official setLifecycle → running && tv(sessionType): pwe prune CU grants.
    session.lifecycleState = "running";
    session.error = undefined;
    pruneCoworkSessionCuGrantsOnTurnStart(session, this.now());
    // Official (g||c||I) session_updated when suggestion timeout / agent completed /
    // idle grace was cleared — product always emits via saveAndEmitUpdate below.
    void suggestionClear;
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

  /**
   * Official replaceEnabledMcpTools(A, t):
   *   tv(sessionType) → skip return current
   *   equality on keys/values → noop return current
   *   Ii().syncUserToolToggles residual
   *   if query: d6e + mcpCoordinator.reconcileServers + applyMcpServersIfIdle residual
   *   assign enabledMcpTools, save
   *   ft("2979038612") ? builtLocalMcpServers=void 0 : DANGEROUS_invalidate
   *   return { enabledMcpTools }
   * Product: pure assign/save/invalidate path only — no invented mcpCoordinator.
   */
  async replaceEnabledMcpTools(
    sessionId: string,
    enabledMcpTools: unknown,
  ): Promise<{ enabledMcpTools: CoworkEnabledMcpToolsMap }> {
    const session = this.repository.require(sessionId);
    const decision = resolveCoworkReplaceEnabledMcpToolsChange({
      currentEnabledMcpTools: session.enabledMcpTools as
        | CoworkEnabledMcpToolsMap
        | null
        | undefined,
      requested: enabledMcpTools,
      sessionType: session.sessionType,
    });
    if (decision.action === "skip_dispatch" || decision.action === "noop") {
      return { enabledMcpTools: decision.enabledMcpTools };
    }

    // Official query branch residual: d6e + mcpCoordinator.reconcileServers +
    // applyMcpServersIfIdle — not product-wired (no invent full coordinator).
    session.enabledMcpTools = decision.nextEnabledMcpTools;
    this.saveAndEmitUpdate(session);

    // Official: save then ft ? clear builtLocal only : full invalidate.
    if (this.preferSessionNotifications()) {
      session.builtLocalMcpServers = undefined;
    } else {
      invalidateCoworkBuiltPromptAndTools(session);
    }

    return {
      enabledMcpTools:
        (session.enabledMcpTools as CoworkEnabledMcpToolsMap | undefined) ?? {},
    };
  }

  /**
   * Official replaceRemoteMcpServers(A, t):
   *   jC key-set + sorted tool-name equality → noop return enabledMcpTools
   *   assign remoteMcpServersConfig = t.map({uuid,name,tools})
   *   if query: createRemoteServers + activeMcpServers + applyMcpServersIfIdle residual
   *   save; ft ? builtLocal=void 0 : DANGEROUS_invalidate
   *   return { enabledMcpTools }
   * Product: pure assign/save/invalidate only — no invented mcpCoordinator.
   */
  async replaceRemoteMcpServers(
    sessionId: string,
    servers: unknown,
  ): Promise<{ enabledMcpTools: CoworkEnabledMcpToolsMap }> {
    const session = this.repository.require(sessionId);
    const decision = resolveCoworkReplaceRemoteMcpServersChange({
      currentEnabledMcpTools: session.enabledMcpTools as
        | CoworkEnabledMcpToolsMap
        | null
        | undefined,
      currentRemoteServers: (session.remoteMcpServersConfig ??
        null) as CoworkRemoteMcpServerConfig[] | null,
      requested: servers,
    });
    if (decision.action === "noop") {
      return { enabledMcpTools: decision.enabledMcpTools };
    }

    // Official query branch residual: mcpCoordinator.createRemoteServers +
    // activeMcpServers merge/delete + applyMcpServersIfIdle.
    session.remoteMcpServersConfig = decision.nextRemoteServers;
    this.saveAndEmitUpdate(session);

    if (this.preferSessionNotifications()) {
      session.builtLocalMcpServers = undefined;
    } else {
      invalidateCoworkBuiltPromptAndTools(session);
    }

    return {
      enabledMcpTools:
        (session.enabledMcpTools as CoworkEnabledMcpToolsMap | undefined) ?? {},
    };
  }

  /**
   * Official setModel(A,t,i):
   *   WJ → KwA (stale synthetic) → r2/Kk → same-label noop → mid-session lock
   *   → live query setModel + effort applyFlagSettings → overrideLabel assign
   *   → ft notify Model switched to ${o?t:s} + CU suffix.
   * Product injects kI/ft gates; residual: je analytics, full UXe rebuild.
   */
  async setModel(sessionId: string, model: unknown): Promise<void> {
    const session = this.repository.require(sessionId);
    const decision = resolveCoworkSetModelChange({
      cachedTotalTurns: session.cachedTotalTurns,
      currentModel: session.model,
      currentOverrideLabel: session.overrideLabel,
      enable1mContextAppend: this.enable1mContextAppend(),
      hasLiveQuery: Boolean(session.query),
      lockMidSessionModel: this.lockMidSessionModel(),
      messageBufferLength: session.messageBuffer.length,
      modelConfig: this.getModelConfig?.() ?? null,
      requestedModel: model,
    });
    if (decision.action !== "apply") {
      return;
    }
    if (session.query) {
      if (decision.shouldCallQuerySetModel) {
        await session.query.setModel(decision.nextModel);
      }
      if (decision.effortLevel) {
        try {
          await session.query.applyFlagSettings?.({
            effortLevel:
              decision.effortLevel === "unset"
                ? undefined
                : decision.effortLevel,
          });
        } catch {
          // Official: warn + continue with model switch.
        }
      }
    }
    session.model = decision.nextModel;
    session.overrideLabel = decision.nextOverrideLabel;
    // Official: rG(Kk(g||"default")) / rG(s) for CU ToolSearch suffix.
    const modelConfig = this.getModelConfig?.() ?? null;
    const enable1m = this.enable1mContextAppend();
    const previousForRg = applyCowork1mContextModelSuffix(
      decision.previousModel || "default",
      modelConfig,
      enable1m,
    );
    notifyCoworkModelSwitched(session, decision.notifyLabel, {
      previousModel: previousForRg,
      nextModel: decision.nextModel,
      preferSessionNotifications: this.preferSessionNotifications(),
    });
    this.saveAndEmitUpdate(session);
  }

  /**
   * Official noteCuWindowMentions(A, t):
   *   if (!YM()) return
   *   missing session → S.warn + return
   *   i.cuMentionedWindows = t  (assign only; no saveSession / session_updated)
   * YM() = platform darwin|win32 && doA() && gi("chicagoEnabled") residual inject
   * as isComputerUseEnabled (default true; no invent full chicago product store).
   */
  noteCuWindowMentions(
    sessionId: string,
    windows: CoworkCuMentionedWindow[],
  ): void {
    if (!this.isComputerUseEnabled()) return;
    const session = this.repository.get(sessionId);
    if (!session) {
      console.warn(`Cannot note CU mentions: session ${sessionId} not found`);
      return;
    }
    session.cuMentionedWindows = windows;
  }

  /**
   * Official setDraftSessionFolders(A):
   *   eBe(A, drop warn) → this.draftSessionFolders = filtered.
   * Th() via getAllowedWorkspaceFolders inject (Settings residual).
   */
  setDraftSessionFolders(folders: unknown): void {
    const list = Array.isArray(folders)
      ? folders.filter((item): item is string => typeof item === "string")
      : [];
    this.draftSessionFolders = filterCoworkDraftSessionFolders(
      list,
      this.getAllowedWorkspaceFolders?.() ?? null,
      (info) => {
        // Official: S.warn drop outside allowedWorkspaceFolders
        console.warn(
          `setDraftSessionFolders: dropping ${info.folderPath} (outside allowedWorkspaceFolders)`,
        );
      },
    );
  }

  /** Official getDraftSessionFolders() — returns eBe-filtered draft list. */
  getDraftSessionFolders(): string[] {
    return this.draftSessionFolders;
  }

  /**
   * Official openOutputsDir(sessionId):
   *   getOutputsDir → shell.openPath(Ss(path)).
   * Ss Windows roaming residual not product-wired (identity path).
   */
  async openOutputsDir(sessionId: string): Promise<void> {
    const session = this.repository.require(sessionId);
    const outputs = this.getOutputsDir(session);
    if (!outputs) {
      throw new Error("Could not determine session storage dir");
    }
    if (!this.openPath) {
      // Product residual when shell not injected (tests may inject).
      throw new Error("openPath is not available");
    }
    const error = await this.openPath(outputs);
    if (error) {
      console.error(
        `Failed to open outputs directory: ${outputs}, error: ${error}`,
      );
    }
  }

  /**
   * Official getFocusedSession() — current renderer-focused session id or null.
   */
  getFocusedSession(): string | null {
    return this.focusedSessionId;
  }

  /**
   * Official setFocusedSession(A):
   *   previous = focusedSessionId; focusedSessionId = A;
   *   if previous !== A → emit("focusedSessionChanged", A).
   * Product maps EventEmitter emit → onFocusedSessionChanged inject residual.
   * Full Ds NotificationService close on focus (idle/AskUserQuestion/scheduled)
   * not product-wired (#109 closed only leavingRunning CU ephemerals).
   */
  setFocusedSession(sessionId: string | null): void {
    const previous = this.focusedSessionId;
    this.focusedSessionId = sessionId;
    if (previous !== sessionId) {
      this.onFocusedSessionChanged?.(sessionId);
    }
  }

  /**
   * Official submitTranscriptFeedback(sessionId, feedback):
   *   unknown session → warn + false
   *   no storage dir → false
   *   else tXi(storageDir, sessionId, feedback) → boolean
   * Bundle (iXi) failure returns false after feedback.json already written.
   */
  async submitTranscriptFeedback(
    sessionId: string,
    feedback: unknown,
  ): Promise<boolean> {
    if (!this.repository.get(sessionId)) {
      console.warn(
        `[LocalAgentModeSessionManager] submitTranscriptFeedback: unknown session ${sessionId}`,
      );
      return false;
    }
    if (!isCoworkTranscriptFeedback(feedback)) {
      // Official IPC G$A rejects before manager; product method is defensive.
      return false;
    }
    const session = this.repository.get(sessionId);
    if (!session) return false;
    const storage = this.repository.getSessionStorageDir(session);
    if (!storage) return false;
    return submitCoworkTranscriptFeedback(storage, sessionId, feedback, {
      downloadsDir: this.getDownloadsDir?.(),
      showItemInFolder: this.showItemInFolder,
    });
  }

  /**
   * Official getTranscriptFeedback(sessionId):
   *   unknown session → []
   *   no storage → []
   *   else Nit(storageDir)
   */
  async getTranscriptFeedback(
    sessionId: string,
  ): Promise<CoworkTranscriptFeedback[]> {
    const session = this.repository.get(sessionId);
    if (!session) return [];
    const storage = this.repository.getSessionStorageDir(session);
    if (!storage) return [];
    return readCoworkTranscriptFeedback(storage);
  }

  /**
   * Official shareSession(A):
   *   missing session → {success:false, error:"Session not found"}
   *   no cliSessionId → {success:false, error:"Session has no CLI session ID"}
   *   else J6e({
   *     cliSessionId,
   *     projectsDir: join(getClaudeConfigDir(A), "projects"),
   *     metadataFilePath: getSessionFilePath(A) ?? void 0,
   *   })
   * getClaudeConfigDir = join(getSessionStorageDir, ".claude") + mkdir 0o700.
   * getSessionFilePath residual: product persistence stores metadata as
   * `${getSessionStorageDir}.json` (slice extname inverse of getSessionStorageDir).
   * Logs via getLogsDir inject (official gA.app.getPath("logs")).
   */
  async shareSession(sessionId: string): Promise<CoworkShareSessionResult> {
    console.info(`[shareSession] Starting share for session ${sessionId}`);
    const session = this.repository.get(sessionId);
    if (!session) {
      console.warn(`[shareSession] Session ${sessionId} not found`);
      return { success: false, error: "Session not found" };
    }
    const cliSessionId = session.cliSessionId;
    if (!cliSessionId) {
      console.warn(
        `[shareSession] Session ${sessionId} has no cliSessionId`,
      );
      return { success: false, error: "Session has no CLI session ID" };
    }
    try {
      const claudeConfigDir = this.getClaudeConfigDir(session);
      const storage = this.repository.getSessionStorageDir(session);
      // Official getSessionFilePath: accountStorage/{agent/}${sessionId}.json
      // Product persistence: storageDir = metadataPath without ".json".
      const metadataFilePath = storage ? `${storage}.json` : undefined;
      return await exportCoworkCliSessionTranscript(
        {
          cliSessionId,
          projectsDir: join(claudeConfigDir, "projects"),
          metadataFilePath,
          logsDir: this.getLogsDir?.() ?? null,
        },
        {
          appPath: this.getAppPath?.() ?? undefined,
          downloadsDir: this.getDownloadsDir?.(),
          now: this.now,
          scrubHomedir: this.getScrubHomedir?.() ?? undefined,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[shareSession] Failed to share session ${sessionId}: ${message}`,
        { error },
      );
      return { success: false, error: message };
    }
  }

  /**
   * Official setPermissionMode(A,t,i,r):
   *   missing → false
   *   query.setPermissionMode(t) → permissionMode=t
   *   gXi(n,t,r?.chromeSkipAllPermissionChecks) → chrome fields when defined
   *   session_updated + save + permission_mode_changed
   *   children parentSessionId===A (incl. archived) → recursive setPermissionMode
   * Residual: chromeAllowedDomains third-arg `i` unused in official body too;
   * updateChromePermission is a separate CIC write path (see updateChromePermission).
   */
  async setPermissionMode(
    sessionId: string,
    mode: CoworkPermissionMode,
    _chromeAllowedDomains?: string[],
    options?: { chromeSkipAllPermissionChecks?: boolean },
  ): Promise<boolean> {
    const session = this.repository.get(sessionId);
    if (!session) {
      console.warn(
        `Cannot set permission mode: session ${sessionId} not found`,
      );
      return false;
    }
    try {
      if (session.query) await session.query.setPermissionMode?.(mode);
      session.permissionMode = mode;
      const chromeNext = resolveCoworkChromePermsOnPermissionModeChange(
        session,
        mode,
        options?.chromeSkipAllPermissionChecks,
      );
      if (chromeNext) {
        applyCoworkChromePermissionFields(session, chromeNext);
      }
      // Official order: session_updated → saveSession → permission_mode_changed.
      // Product saveAndEmitUpdate = save + session_updated (same net events).
      this.saveAndEmitUpdate(session);
      this.emit({
        permissionMode: mode,
        sessionId,
        type: "permission_mode_changed",
      });
      // Official: all children by parentSessionId (no archived skip).
      const children = this.repository
        .getAll()
        .filter((child) => child.parentSessionId === sessionId)
        .map((child) => child.sessionId);
      if (children.length > 0) {
        await Promise.allSettled(
          children.map((childId) =>
            this.setPermissionMode(childId, mode, undefined, options),
          ),
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Official getDispatchParentForWriteBack(A):
   *   sessionType === "dispatch_child" && parentSessionId
   *   → parent if present && lifecycleState !== "archived"
   * Used by updateChromePermission / CU write-back (not IPC).
   */
  getDispatchParentForWriteBack(
    sessionId: string,
  ): CoworkSessionRuntimeState | undefined {
    const session = this.repository.get(sessionId);
    if (
      session?.sessionType === "dispatch_child" &&
      session.parentSessionId
    ) {
      const parent = this.repository.get(session.parentSessionId);
      if (parent && parent.lifecycleState !== "archived") {
        return parent;
      }
    }
    return undefined;
  }

  /**
   * Official CIC inject getChromeTabGroupId:
   *   () => this.sessions.get(A)?.chromeTabGroupId
   * Residual: full aze Chrome MCP / canUseTool not product — field + accessors only.
   */
  getChromeTabGroupId(sessionId: string): number | undefined {
    return this.repository.get(sessionId)?.chromeTabGroupId;
  }

  /**
   * Official CIC inject onChromeTabGroupIdUpdated:
   *   n => { const o = this.sessions.get(A); o && (o.chromeTabGroupId = n) }
   * Official assigns only (no saveSession/session_updated here); next general save
   * persists via optionalMetadata chromeTabGroupId.
   */
  onChromeTabGroupIdUpdated(sessionId: string, tabGroupId: number): void {
    const session = this.repository.get(sessionId);
    if (!session) return;
    session.chromeTabGroupId = tabGroupId;
  }

  /**
   * Official CIC inject getCuAllowedApps:
   *   () => this.sessions.get(A)?.cuAllowedApps
   * MCP host IFi wraps with ??[]; manager returns field as-is.
   */
  getCuAllowedApps(sessionId: string): CoworkCuAllowedApp[] | undefined {
    return this.repository.get(sessionId)?.cuAllowedApps;
  }

  /**
   * Official CIC inject getCuGrantFlags:
   *   () => this.sessions.get(A)?.cuGrantFlags
   * MCP host IFi wraps with ??Jp; manager returns field as-is.
   */
  getCuGrantFlags(sessionId: string): CoworkCuGrantFlags | undefined {
    return this.repository.get(sessionId)?.cuGrantFlags;
  }

  /**
   * Official CIC inject onCuPermissionUpdated(n, o):
   *   s = sessions.get(A); if (!s) return
   *   s.cuAllowedApps = n; s.cuGrantFlags = o
   *   parent = getDispatchParentForWriteBack(A)
   *   if parent: g = pwe(n, now, J_A()); c = cXi(parent, g, o);
   *             parent.cuAllowedApps/Flags = c.*
   * Official assigns only (no saveSession/session_updated here) — same as
   * onChromeTabGroupIdUpdated. Full CU MCP / Chicago dialog residual.
   */
  onCuPermissionUpdated(
    sessionId: string,
    apps: CoworkCuAllowedApp[],
    flags: CoworkCuGrantFlags,
  ): void {
    const session = this.repository.get(sessionId);
    if (!session) return;
    session.cuAllowedApps = apps;
    session.cuGrantFlags = flags;
    const parent = this.getDispatchParentForWriteBack(sessionId);
    if (parent) {
      const pruned = pruneCoworkCuAllowedAppsByTtl(
        apps,
        this.now(),
        COWORK_DISPATCH_CU_GRANT_TTL_MS,
      );
      const merged = mergeCoworkCuPermissionWriteBack(parent, pruned, flags);
      parent.cuAllowedApps = merged.cuAllowedApps;
      parent.cuGrantFlags = merged.cuGrantFlags;
    }
  }

  /**
   * Official getComputerUseGrants(A):
   *   return this.sessions.get(A)?.cuAllowedApps ?? []
   * Settings / Chicago host surface; always array (unlike CIC getCuAllowedApps).
   */
  getComputerUseGrants(sessionId: string): CoworkCuAllowedApp[] {
    return this.repository.get(sessionId)?.cuAllowedApps ?? [];
  }

  /**
   * Official CU host isAborted inject for session A:
   *   _turnInterruptRequested===true || lifecycleState!=="running"
   * Missing session → true. Residual: full Chicago CU MCP product wire of inject.
   */
  isSessionTurnAborted(sessionId: string): boolean {
    return isCoworkSessionTurnAborted(this.repository.get(sessionId));
  }

  /**
   * Official revokeComputerUseGrant(A, t):
   *   missing session → false
   *   filter cuAllowedApps where bundleId !== t; no change → false
   *   assign filtered + saveSession(i)  (disk debounce only; no session_updated)
   *   o(g) = same filter+save when present
   *   parent = getDispatchParentForWriteBack(A); parent && o(parent)
   *   root = parent?.sessionId ?? A
   *   for each session with parentSessionId===root && sessionId!==A: o(session)
   *   return true
   * ComputerUseTcc IPC: getCurrentSessionGrants / revokeGrant → these methods.
   * Residual: full Chicago CU grant Settings UI / aze canUseTool product.
   */
  revokeComputerUseGrant(sessionId: string, bundleId: string): boolean {
    const session = this.repository.get(sessionId);
    if (!session) return false;
    const current = session.cuAllowedApps ?? [];
    const next = current.filter((app) => app.bundleId !== bundleId);
    if (next.length === current.length) return false;
    session.cuAllowedApps = next;
    // Official saveSession = debounced disk write only (no session_updated emit).
    this.repository.save(session);

    const revokeOn = (target: CoworkSessionRuntimeState): void => {
      const apps = target.cuAllowedApps ?? [];
      const filtered = apps.filter((app) => app.bundleId !== bundleId);
      if (filtered.length === apps.length) return;
      target.cuAllowedApps = filtered;
      this.repository.save(target);
    };

    const parent = this.getDispatchParentForWriteBack(sessionId);
    if (parent) revokeOn(parent);
    const rootSessionId = parent?.sessionId ?? sessionId;
    for (const other of this.repository.getAll()) {
      if (
        other.parentSessionId === rootSessionId &&
        other.sessionId !== sessionId
      ) {
        revokeOn(other);
      }
    }
    return true;
  }

  /**
   * Official resolvePermissionSessionId = nXi(sessions, id).
   * dispatch_child with live parent → parentSessionId; else id.
   */
  resolvePermissionSessionId(sessionId: string): string {
    return resolveCoworkPermissionSessionId(
      (id) => this.repository.get(id),
      sessionId,
    );
  }

  /**
   * Official handleBrowserPermissionRequest(A, t, i):
   *   if !scheduledTaskId && !isHiddenSession(A) → focus main window (product residual)
   *   o = resolvePermissionSessionId(A)
   *   {toolName,input,suggestions} = gLi(t)
   *   c = await handleToolPermission(o, toolName, input, suggestions, i, A)
   *   return cLi(c)
   * Product: routes via permission broker (same as canUseTool path). Full aze
   * Chrome MCP / main-window focus / scheduled-task auto-approve residual.
   */
  async handleBrowserPermissionRequest(
    sessionId: string,
    request: CoworkBrowserPermissionRequestInput,
    signal?: AbortSignal,
  ): Promise<{ allowed: boolean; always: boolean; allSites: boolean }> {
    const session = this.repository.get(sessionId);
    // Official: show/focus main window unless scheduledTaskId or isHiddenSession.
    // Product residual: no main-window Ze inject here (honest no-op).
    void isCoworkHiddenSessionType(session?.sessionType);

    // Official: o = resolvePermissionSessionId(A); handleToolPermission(o, …, A)
    // pending.sessionId = o (permission target), ownerSessionId = A (browser source).
    const permissionSessionId = this.resolvePermissionSessionId(sessionId);
    const permissionSession = this.repository.get(permissionSessionId);
    // Official handleToolPermission radar hard-deny (Nu).
    if (permissionSession?.sessionType === "radar") {
      return mapCoworkBrowserPermissionResult({
        behavior: "deny",
        // message unused by cLi
      });
    }
    const { toolName, input, suggestions } =
      buildCoworkBrowserPermissionToolRequest(request);
    const resolution = await this.permissions.requestPermission({
      input,
      ownerSessionId: sessionId,
      sessionId: permissionSessionId,
      signal,
      suggestions,
      toolName,
    });
    return mapCoworkBrowserPermissionResult(resolution);
  }

  /**
   * Official updateChromePermission(A,t,i) — internal CIC/browser grant write path
   * (not LocalAgentModeSessions IPC; mainView has no updateChromePermission method).
   *   missing → return
   *   session.chromePermissionMode = t; chromeAllowedDomains = i
   *   emit session_updated
   *   t==="skip_all_permission_checks" → xn("allowAllBrowserActions", true) only
   *   scheduledTaskId → ps.updateChromePermissions (inject residual)
   *   dispatch_child parent write-back via aXi (mode max-rank + domain Set union)
   * Residual: full Chrome MCP / CIC canUseTool / handleBrowserPermissionRequest not product.
   */
  updateChromePermission(
    sessionId: string,
    mode: CoworkChromePermissionMode,
    domains: string[],
  ): void {
    const session = this.repository.get(sessionId);
    if (!session) return;
    session.chromePermissionMode = mode;
    session.chromeAllowedDomains = domains;
    this.saveAndEmitUpdate(session);
    if (mode === "skip_all_permission_checks") {
      void this.setAllowAllBrowserActions?.(true);
    }
    if (session.scheduledTaskId) {
      void this.updateScheduledTaskChromePermissions?.(
        session.scheduledTaskId,
        mode,
        domains,
      );
    }
    const parent = this.getDispatchParentForWriteBack(sessionId);
    if (parent) {
      const merged = mergeCoworkChromePermissionWriteBack(
        parent,
        mode,
        domains,
      );
      parent.chromePermissionMode = merged.chromePermissionMode;
      parent.chromeAllowedDomains = merged.chromeAllowedDomains;
      this.saveAndEmitUpdate(parent);
    }
  }

  /**
   * Official setChromePermissionMode(A,t):
   *   missing session → false + warn
   *   i.chromePermissionMode = t
   *   xn("allowAllBrowserActions", t==="skip_all_permission_checks")
   *   i.chromePermsBeforeUnsupervised = { mode:t, domains:i.chromeAllowedDomains }
   *   saveSession + session_updated
   *   children with parentSessionId===A && lifecycleState!=="archived":
   *     same mode/snapshot + save + session_updated
   *   return true
   * Residual: full browser automation / Chrome MCP product not invented.
   */
  setChromePermissionMode(
    sessionId: string,
    mode: CoworkChromePermissionMode,
  ): boolean {
    const session = this.repository.get(sessionId);
    if (!session) {
      console.warn(
        `Cannot set chrome permission mode: session ${sessionId} not found`,
      );
      return false;
    }
    session.chromePermissionMode = mode;
    const allowAll = mode === "skip_all_permission_checks";
    void this.setAllowAllBrowserActions?.(allowAll);
    session.chromePermsBeforeUnsupervised = {
      mode,
      domains: session.chromeAllowedDomains
        ? [...session.chromeAllowedDomains]
        : undefined,
    };
    this.saveAndEmitUpdate(session);
    for (const child of this.repository.getAll()) {
      if (
        child.parentSessionId === sessionId &&
        child.lifecycleState !== "archived"
      ) {
        child.chromePermissionMode = mode;
        child.chromePermsBeforeUnsupervised = {
          mode,
          domains: child.chromeAllowedDomains
            ? [...child.chromeAllowedDomains]
            : undefined,
        };
        this.saveAndEmitUpdate(child);
      }
    }
    console.info(
      `Set chrome permission mode for session ${sessionId} to ${mode}`,
    );
    return true;
  }

  /**
   * Official interruptTurn(A):
   *   children parentSessionId===A → Promise.allSettled(interruptTurn)
   *   residual NOT invented: XM.claudeCodeSessionManager cross-stop
   *   no query → debug no-op
   *   else: _turnInterruptRequested=true; await query.interrupt(); warn on fail
   * Bridge control_request calls this; LocalAgentModeSessions preload has no
   * interrupt invoke key (Code LocalSessions does) — manager method only.
   */
  async interruptTurn(sessionId: string): Promise<void> {
    const children = this.repository
      .getAll()
      .filter((child) => child.parentSessionId === sessionId)
      .map((child) => child.sessionId);
    if (children.length > 0) {
      await Promise.allSettled(
        children.map((childId) => this.interruptTurn(childId)),
      );
    }
    // Residual: official also stops running Code sessions by dispatch parent
    // (cross-manager stop) — not product-wired (Code 不拆了 / no invent).
    const session = this.repository.get(sessionId);
    if (!session?.query) {
      console.debug(
        `[interruptTurn] Session ${sessionId} has no active query, no-op`,
      );
      return;
    }
    console.info(`[interruptTurn] Interrupting session ${sessionId}`);
    session._turnInterruptRequested = true;
    try {
      await session.query.interrupt();
    } catch (error) {
      console.warn(
        `[interruptTurn] Failed to interrupt session ${sessionId}:`,
        error,
      );
    }
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.repository.get(sessionId);
    if (!session) return;
    // Official stopSession head: clearTimeout(_suggestionTimeout) + promptSuggestion=void 0.
    clearCoworkPromptSuggestionState(session);
    const hadQuery = session.query !== null;
    session.lifecycleState = "stopping";
    session.inputStream?.done();
    session.query?.close();
    session.query = null;
    session.inputStream = null;
    // Official leavingRunning: clear product-owned CU ephemerals before idle.
    clearCoworkSessionEphemeralsOnLeavingRunning(session);
    session.lifecycleState = "idle";
    // Official stopSession: cachedTotalTurns += user messageBuffer; clear buffer.
    // After idle + optional close event in asar; product order: idle → accumulate
    // → teardown → save (close emit after accumulate matches analytics use of count).
    accumulateCoworkCachedTotalTurnsOnStop(session);
    // Official teardownIdleProcess → stopFileWatching(sessionId)
    this.stopFileWatching(sessionId);
    this.permissions.denyPendingPermissionsForSession(sessionId, "Turn ended");
    this.saveAndEmitUpdate(session);
    await this.repository.flush(sessionId);
    if (hadQuery) this.emit({ code: 0, sessionId, type: "close" });
  }

  async archive(sessionId: string, _options?: unknown): Promise<void> {
    const session = this.repository.get(sessionId);
    if (!session) return;
    // Official archiveSession: stopSession(A, true) then rm storage/uploads.
    await this.stop(sessionId);
    // Official: n=getSessionStorageDir(A); if(n) JA.rm(join(n,"uploads"),{recursive,force})
    // Residual not invented: sessionAuditLoggers close, dispatchCoordinator.detach,
    // je("lam_session_archived") analytics.
    const storage = this.repository.getSessionStorageDir(session);
    if (storage) {
      const uploads = join(storage, "uploads");
      await rm(uploads, { recursive: true, force: true }).catch((err) => {
        console.warn(
          `Failed to clean up session uploads directory ${uploads}:`,
          err,
        );
      });
    }
    this.permissions.denyPendingPermissionsForSession(
      sessionId,
      "Session was archived.",
    );
    session.lifecycleState = "archived";
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
    this.stopFileWatching(sessionId);
    await this.repository.delete(session);
  }

  async updateSession(sessionId: string, options: CoworkSessionUpdate): Promise<void> {
    const session = this.repository.require(sessionId);
    // Official updateSession: title (auto-ignore) then spaceId, then other fields
    // — not a blind Object.assign dump for title/space branches.
    const { spaceId, spaceIdSetBy, title, titleSource, ...rest } = options;
    if (title !== undefined) {
      applyCoworkSessionTitleUpdate(session, { title, titleSource });
    }
    if (spaceId !== undefined) {
      applyCoworkSessionSpaceIdUpdate(
        session,
        { spaceId, spaceIdSetBy },
        {
          preferSessionNotifications: this.preferSessionNotifications(),
          getSpaceName: this.getSpaceName,
        },
      );
    }
    Object.assign(session, rest);
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

  /**
   * Official LocalAgentModeSessions.addFolderToSession:
   *   P4(providedPath) → mountFolderForSession(resolved) → {ok, folderPath:Lc}
   * Product path-provided subset: classify Mh then mountFolderForSession
   * (inherits already-mounted short-circuit / host-loop bashMountName / next-resume).
   * Dialog-only P4 residual when path omitted — IPC currently always passes a path.
   */
  async addFolderToSession(
    sessionId: string,
    folder: string,
  ): Promise<CoworkAddFolderResult> {
    this.repository.require(sessionId);
    if (typeof folder !== "string" || folder.length === 0) {
      return { ok: false, error: "Folder path is required" };
    }
    // Official P4 + Mh for provided path; product classifyCoworkPathKind = Mh core.
    const pathKind = await classifyCoworkPathKind(folder);
    if (!pathKind) {
      return { ok: false, error: "Folder could not be resolved" };
    }
    const mounted = await this.mountFolderForSession(sessionId, pathKind);
    if (!mounted.ok) {
      return { ok: false, error: mounted.error || "Failed to mount directory." };
    }
    // Official return: {ok:true, folderPath:Lc(n.resolved)}
    return {
      ok: true,
      folderPath: mounted.displayPath,
      networkDrive: mounted.networkDrive,
    };
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
      getAutoMemoryDir: (session) =>
        this.repository.getAutoMemoryDirForSession(session),
      getHostOutputsDir: (session) => this.getOutputsDir(session),
      getSessionStorageDir: (session) =>
        this.repository.getSessionStorageDir(session),
      // Official ft("2979038612") residual for drainPendingNotifications.
      preferSessionNotifications: () => this.preferSessionNotifications(),
      // Official ft("1942781881") residual for success-result suggestion grace.
      enablePromptSuggestionGrace: () => this.enablePromptSuggestionGrace(),
      // Official P4 dialog when request_cowork_directory omits path.
      pickDirectory: options.pickDirectory,
      // Official mountFolderForSession → addUserSelectedFolder(Mh kind) + host watch restart.
      mountSessionFolder: (sessionId, pathKind) =>
        this.mountFolderForSession(sessionId, pathKind),
      // Official recordDetectedFile / setFileDeleteApprovedForMount.
      // notifySession residual: official dispatchCoordinator.notifySession —
      // no product UI port yet; keep injectable no-op path via console only.
      notifySession: (_sessionId, message) => {
        console.info(`[cowork notifySession] ${message}`);
      },
      recordDetectedFile: (sessionId, hostPath) =>
        this.recordDetectedFile(sessionId, hostPath),
      setFileDeleteApprovedForMount: (sessionId, mountName) =>
        this.setFileDeleteApprovedForMount(sessionId, mountName),
      // Official onMarkTaskComplete → isAgentCompleted + save + session_updated.
      // hasMarkTaskComplete: product default true (Statsig ft residual not product-wired).
      onMarkTaskComplete: (sessionId) => this.markTaskComplete(sessionId),
      hasMarkTaskComplete: true,
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

  /**
   * Official mountFolderForSession:
   *   hostLoopMode → addUserSelectedFolder + notify/invalidate + applyFlagSettings +
   *     bashMountName u = (n || hostLoopOnFolderAdded==null) ? void 0 : hostLoopOnFolderAdded(r)
   *   else if _c(i).includes(r) → {ok:true, mode:"host-loop"} (no re-add / no notify)
   *   else if !vmProcessId → add + next-resume queue (product has no dual-exec VM)
   * Dual-exec live VM mount residual (never invent mode:"vm" success).
   * hostLoopOnFolderAdded only set by dual-exec UXe onFolderAddedForBash — inject residual.
   */
  private async mountFolderForSession(
    sessionId: string,
    pathKind: CoworkPathKind,
  ): Promise<
    | {
        ok: true;
        displayPath: string;
        bashMountName?: string | null;
        mode?: "host-loop" | "vm";
        networkDrive?: boolean;
      }
    | { ok: false; error: string }
  > {
    const session = this.repository.get(sessionId);
    if (!session) {
      return { ok: false, error: "Session not found — cannot grant access." };
    }
    // Official: r=Lc(t), n=t.kind!=="local"
    const displayPath = coworkPathKindMountPath(pathKind);
    const networkDrive = pathKind.kind !== "local";

    // Official host-loop branch first (add + notify even if already present).
    if (session.hostLoopMode) {
      const result = mountCoworkSessionFolderFromPathKind(session, pathKind);
      if (!result.ok) {
        return { ok: false, error: result.error || "Failed to mount directory." };
      }
      notifyCoworkHostLoopFolderAccess(
        session,
        result.folderPath,
        Boolean(result.networkDrive),
        { preferSessionNotifications: this.preferSessionNotifications() },
      );
      this.saveAndEmitUpdate(session);
      this.startFileWatching(sessionId);
      await this.applyHostLoopMountFlagSettings(session);
      const bashMountName = resolveCoworkHostLoopBashMountName({
        hostLoopOnFolderAdded: session.hostLoopOnFolderAdded,
        hostPath: result.folderPath,
        networkDrive: Boolean(result.networkDrive),
      });
      return {
        ok: true,
        displayPath: result.folderPath,
        mode: "host-loop",
        networkDrive: result.networkDrive,
        bashMountName,
      };
    }

    // Official: if (_c(i).includes(r)) return {ok:true, mode:"host-loop"}
    // (already mounted — no re-add, no next-resume notify, no watch restart).
    if (coworkUserSelectedFolderPaths(session.resolvedFolders).includes(displayPath)) {
      return {
        ok: true,
        displayPath,
        mode: "host-loop",
        networkDrive,
      };
    }

    // Official: !vmProcessId || !vmProcessName → add + next-resume notify.
    // Product has no dual-exec VM process — always this residual branch.
    const result = mountCoworkSessionFolderFromPathKind(session, pathKind);
    if (!result.ok) {
      return { ok: false, error: result.error || "Failed to mount directory." };
    }
    this.notifyQueuedMountNextResume(session, result.folderPath);
    this.saveAndEmitUpdate(session);
    this.startFileWatching(sessionId);
    return {
      ok: true,
      displayPath: result.folderPath,
      mode: "host-loop",
      networkDrive: result.networkDrive,
    };
  }

  /**
   * Official mountFolderForSession non-host-loop queue branch:
   *   Q = p_(_c(i)).get(r) ?? basename(r); Zn(Q); queue next-resume message.
   * Dual-exec live VM mount residual — product never claims mode:"vm" success.
   */
  private notifyQueuedMountNextResume(
    session: CoworkSessionRuntimeState,
    folderPath: string,
  ): void {
    const hostPaths = coworkUserSelectedFolderPaths(session.resolvedFolders);
    const names = deriveMountNamesIncremental(hostPaths);
    const mountName = normalizeCoworkVmMountPathSegment(
      names.get(folderPath) ?? basename(folderPath),
    );
    notifyCoworkQueuedMountNextResume(session, folderPath, mountName, {
      preferSessionNotifications: this.preferSessionNotifications(),
    });
  }

  /**
   * Official mountFolderForSession host-loop applyFlagSettings:
   *   permissions.additionalDirectories = twe(session) = Zni(resolvedFolders)
   *   permissions.allow = HUA([getOutputsDir(sessionId), ...Q])
   * Best-effort when live query exposes applyFlagSettings; no-op otherwise.
   */
  private async applyHostLoopMountFlagSettings(
    session: CoworkSessionRuntimeState,
  ): Promise<void> {
    if (!session.hostLoopMode) return;
    const apply = session.query?.applyFlagSettings;
    if (!apply) return;
    const outputs = this.getOutputsDir(session);
    if (!outputs) {
      console.warn(
        `[mountFolderForSession] applyFlagSettings skipped: no outputs dir for ${session.sessionId}`,
      );
      return;
    }
    const additionalDirectories = coworkFolderPermissionPaths(
      session.resolvedFolders,
    );
    const settings = coworkHostLoopMountFlagSettings({
      folderPermissionPaths: additionalDirectories,
      hostOutputsDir: outputs,
    });
    try {
      await apply.call(session.query, settings);
    } catch (error) {
      console.warn(
        `[mountFolderForSession] applyFlagSettings failed for ${session.sessionId}:`,
        error,
      );
    }
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

  /**
   * Official startFileWatching(sessionId, userSelectedFolders):
   * if folders length → watch each; else watch getOutputsDir(sessionId).
   * Product derives folders via _c/Lc(resolvedFolders) after pathKind mount.
   */
  private startFileWatching(sessionId: string): void {
    const session = this.repository.get(sessionId);
    if (!session) return;
    this.fileWatcher.stopWatching(sessionId);
    // Official call site passes userSelectedFolders strings; product uses _c.
    const folders = coworkUserSelectedFolderPaths(session.resolvedFolders).filter(
      Boolean,
    );
    if (folders.length > 0) {
      for (const folder of folders) this.fileWatcher.startWatching(sessionId, folder);
      return;
    }
    const outputs = this.getOutputsDir(session);
    if (outputs) this.fileWatcher.startWatching(sessionId, outputs);
  }

  private stopFileWatching(sessionId: string): void {
    if (this.fileWatcher.isWatching(sessionId)) this.fileWatcher.stopWatching(sessionId);
  }

  /** Official getOutputsDir: join(getSessionStorageDir, "outputs") + mkdir. */
  private getOutputsDir(session: CoworkSessionRuntimeState): string | null {
    const storage = this.repository.getSessionStorageDir(session);
    if (!storage) return null;
    const outputs = join(storage, "outputs");
    if (!existsSync(outputs)) {
      try {
        mkdirSync(outputs, { recursive: true, mode: 0o700 });
      } catch {
        return null;
      }
    }
    return outputs;
  }

  /**
   * Official getClaudeConfigDir(sessionId):
   *   storage = getSessionStorageDir; throw if missing;
   *   join(storage, ".claude") + mkdir 0o700.
   */
  private getClaudeConfigDir(session: CoworkSessionRuntimeState): string {
    const storage = this.repository.getSessionStorageDir(session);
    if (!storage) {
      throw new Error("Could not determine session storage dir");
    }
    const configDir = join(storage, ".claude");
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    return configDir;
  }

  /**
   * Official fileWatcher.on("fsEvent"): update session.fsDetectedFiles + save + emit event with fsFile.
   */
  private handleFsWatchEvent(event: {
    fileName: string;
    hostPath: string;
    sessionId: string;
    timestamp: number;
    type: "fs_file_created" | "fs_file_modified" | "fs_file_deleted";
  }): void {
    const session = this.repository.get(event.sessionId);
    const fsFile = {
      fileName: event.fileName || basename(event.hostPath),
      hostPath: event.hostPath,
      timestamp: event.timestamp,
    };
    if (session) {
      if (event.type === "fs_file_created" || event.type === "fs_file_modified") {
        session.fsDetectedFiles.set(event.hostPath, fsFile);
        this.repository.save(session);
      } else if (event.type === "fs_file_deleted") {
        session.fsDetectedFiles.delete(event.hostPath);
        this.repository.save(session);
      }
    }
    this.emit({
      fsFile,
      sessionId: event.sessionId,
      type: event.type,
    });
  }

  /**
   * Official recordDetectedFile(sessionId, hostPath):
   * fsDetectedFiles.set + save + emit fs_file_created.
   */
  private recordDetectedFile(sessionId: string, hostPath: string): void {
    const session = this.repository.get(sessionId);
    if (!session) return;
    const fsFile = {
      fileName: basename(hostPath),
      hostPath,
      timestamp: this.now(),
    };
    session.fsDetectedFiles.set(hostPath, fsFile);
    this.repository.save(session);
    this.emit({
      fsFile,
      sessionId,
      type: "fs_file_created",
    });
  }

  /**
   * Official setFileDeleteApprovedForMount(mountName):
   * push unique name into session.fileDeleteApprovedMounts + save.
   */
  private setFileDeleteApprovedForMount(
    sessionId: string,
    mountName: string,
  ): void {
    const session = this.repository.get(sessionId);
    if (!session) return;
    const mounts = session.fileDeleteApprovedMounts ?? [];
    if (!mounts.includes(mountName)) {
      session.fileDeleteApprovedMounts = [...mounts, mountName];
      this.repository.save(session);
    }
  }

  /**
   * Official onMarkTaskComplete:
   * if session && !isAgentCompleted → isAgentCompleted=true + save + session_updated.
   */
  private markTaskComplete(sessionId: string): void {
    const session = this.repository.get(sessionId);
    if (!session || session.isAgentCompleted) return;
    session.isAgentCompleted = true;
    this.saveAndEmitUpdate(session);
  }
}
