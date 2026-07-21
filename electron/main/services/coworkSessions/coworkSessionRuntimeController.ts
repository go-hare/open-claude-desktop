import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  appendCoworkMarkTaskCompleteSystemPrompt,
  withCoworkDirectoryMcpServer,
  type CoworkDirectoryMountResult,
  type CoworkDirectoryPickResult,
} from "../coworkRuntime/coworkDirectoryMcpServer";
import { withCoworkAlwaysLoadMcpServers } from "../coworkRuntime/coworkSkillsPluginsMcpServer";
import {
  resolveCoworkWorkspaceAllowedDomains,
  withCoworkWorkspaceMcpServer,
  type CoworkVmEgressPolicy,
} from "../coworkRuntime/coworkWorkspaceMcpServer";
import { computeCoworkHostLoopBashMounts } from "../coworkVm/coworkVmBashMounts";
import {
  computeCoworkDualExecMounts,
  pluginMountsFromReadOnlyPaths,
} from "../coworkVm/coworkVmDualExecMounts";
import { getCoworkVmGuestBashRunner } from "../coworkVm/coworkVmGuestBash";
import { getCoworkClaudeVmService } from "../coworkVm/coworkClaudeVm";
import type {
  CoworkAccountDetails,
  CoworkAccountIdentity,
} from "../coworkAccount/coworkAccountContext";
import { CoworkAsyncInputQueue } from "./coworkAsyncInputQueue";
import { CoworkQueryRuntime } from "./coworkQueryRuntime";
import type {
  CoworkQueryFactory,
  CoworkQueryFactoryInput,
  CoworkSessionEvent,
} from "./coworkSessionManagerTypes";
import { clearCoworkSessionEphemeralsOnLeavingRunning } from "./coworkSessionNotifications";
import { createUserMessage } from "./coworkSessionState";
import type {
  CoworkImagePayload,
  CoworkPermissionRequestOptions,
  CoworkPermissionResolution,
  CoworkRuntimeQuery,
  CoworkSdkMessage,
  CoworkSdkUserMessage,
  CoworkSessionRuntimeState,
  CoworkStartSessionInput,
  CoworkToolState,
} from "./coworkSessionTypes";
import {
  buildCoworkVmPathContext,
  translateCoworkMessagePaths,
} from "./coworkVmPathTranslation";
import {
  coworkFolderPermissionPaths,
  coworkNetworkDriveFolderPaths,
  coworkUserSelectedFolderPaths,
} from "./coworkSessionWorkspace";
import { pruneCoworkSessionCuGrantsOnTurnStart } from "./coworkCuPermissionHelpers";
import {
  collectCoworkReadOnlyPluginPaths,
} from "./coworkReadOnlyPluginPaths";
import { COWORK_LOCAL_AGENT_MODE_SESSIONS_DIR } from "./coworkAutoMemoryPaths";

type CoworkSessionRuntimeControllerOptions = {
  emit: (event: CoworkSessionEvent) => void;
  getAccountDetails: () => CoworkAccountDetails | null;
  getIdentity: () => CoworkAccountIdentity;
  /**
   * Official ft("2979038612") for drainPendingNotifications on user messages.
   * Default true when unset.
   */
  preferSessionNotifications?: () => boolean;
  /**
   * Official ft("1942781881") — arm 5s _suggestionTimeout after success.
   * Default false when unset (Statsig residual).
   */
  enablePromptSuggestionGrace?: () => boolean;
  /**
   * Official getAutoMemoryDirForSession for XL/gh path context
   * (`.auto-memory` mount → host memory dir).
   */
  getAutoMemoryDir?: (
    session: CoworkSessionRuntimeState,
  ) => string | null;
  /** Official getSessionStorageDir for XL/gh path context. */
  getSessionStorageDir?: (
    session: CoworkSessionRuntimeState,
  ) => string | null;
  /**
   * Official P4 dialog when request_cowork_directory omits path.
   * When unset, tool requires explicit path (remote residual honesty).
   */
  pickDirectory?: () => Promise<CoworkDirectoryPickResult>;
  /**
   * Official e.mountFolder / mountFolderForSession after P4 validation.
   * Receives full Mh pathKind (not string-only).
   */
  mountSessionFolder?: (
    sessionId: string,
    pathKind: import("../coworkRuntime/coworkDirectoryMcpServer").CoworkPathKind,
  ) => Promise<CoworkDirectoryMountResult>;
  /**
   * Official getOutputsDir(sessionId) for present_files accessibility roots.
   */
  getHostOutputsDir?: (session: CoworkSessionRuntimeState) => string | null;
  /**
   * Official recordDetectedFile(sessionId, hostPath) — present_files iJA promote.
   */
  recordDetectedFile?: (sessionId: string, hostPath: string) => void;
  /**
   * Official notifySession(sessionId, message).
   */
  notifySession?: (sessionId: string, message: string) => void;
  /**
   * Official setFileDeleteApprovedForMount(sessionId, mountName).
   */
  setFileDeleteApprovedForMount?: (
    sessionId: string,
    mountName: string,
  ) => void;
  /**
   * Official onMarkTaskComplete — isAgentCompleted + save + session_updated.
   */
  onMarkTaskComplete?: (sessionId: string) => void;
  /**
   * Official hasMarkTaskComplete (Statsig residual). Default true when unset.
   */
  hasMarkTaskComplete?: boolean | ((session: CoworkSessionRuntimeState) => boolean);
  /**
   * Official Ii().vmEgressPolicy() inject. When set, wins over session
   * egressAllowedDomains (cnA path). Settings → Capabilities residual when unset.
   */
  getVmEgressPolicy?: (
    session: CoworkSessionRuntimeState,
  ) => CoworkVmEgressPolicy | null | undefined;
  /**
   * Official Th() / vi().allowedWorkspaceFolders for request_cowork_directory P4.
   * Settings product residual when unset (unrestricted).
   */
  getAllowedWorkspaceFolders?: (
    session: CoworkSessionRuntimeState,
  ) => readonly string[] | null | undefined;
  now: () => number;
  /**
   * Official transitionTo("idle") idle-grace arm residual from manager.
   */
  onBecameIdle?: (
    sessionId: string,
    options?: { fromRunning?: boolean; hasError?: boolean },
  ) => void;
  onQueryCompleted?: (sessionId: string) => void;
  /**
   * Official aze CIC canUseTool residual builder.
   * When unset, factory skips CIC branch (no Chrome MCP invent).
   */
  buildCicCanUseTool?: (
    session: CoworkSessionRuntimeState,
  ) => CoworkQueryFactoryInput["cicCanUseTool"];
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
  private readonly getAutoMemoryDir?: (
    session: CoworkSessionRuntimeState,
  ) => string | null;
  private readonly getIdentity: () => CoworkAccountIdentity;
  private readonly getHostOutputsDir?: (
    session: CoworkSessionRuntimeState,
  ) => string | null;
  private readonly getSessionStorageDir?: (
    session: CoworkSessionRuntimeState,
  ) => string | null;
  private readonly mountSessionFolder?: CoworkSessionRuntimeControllerOptions["mountSessionFolder"];
  private readonly notifySession?: CoworkSessionRuntimeControllerOptions["notifySession"];
  private readonly now: () => number;
  private readonly onBecameIdle?: CoworkSessionRuntimeControllerOptions["onBecameIdle"];
  private readonly onQueryCompleted?: (sessionId: string) => void;
  private readonly buildCicCanUseTool?: CoworkSessionRuntimeControllerOptions["buildCicCanUseTool"];
  private readonly pickDirectory?: CoworkSessionRuntimeControllerOptions["pickDirectory"];
  private readonly queryFactory: CoworkQueryFactory;
  private readonly recordDetectedFile?: CoworkSessionRuntimeControllerOptions["recordDetectedFile"];
  private readonly requestPermission: CoworkSessionRuntimeControllerOptions["requestPermission"];
  private readonly save: (session: CoworkSessionRuntimeState) => void;
  private readonly saveAndEmitUpdate: (
    session: CoworkSessionRuntimeState,
  ) => void;
  private readonly setFileDeleteApprovedForMount?: CoworkSessionRuntimeControllerOptions["setFileDeleteApprovedForMount"];
  private readonly onMarkTaskComplete?: CoworkSessionRuntimeControllerOptions["onMarkTaskComplete"];
  private readonly hasMarkTaskComplete?: CoworkSessionRuntimeControllerOptions["hasMarkTaskComplete"];
  private readonly getVmEgressPolicy?: CoworkSessionRuntimeControllerOptions["getVmEgressPolicy"];
  private readonly getAllowedWorkspaceFolders?: CoworkSessionRuntimeControllerOptions["getAllowedWorkspaceFolders"];
  private readonly preferSessionNotifications: () => boolean;
  private readonly enablePromptSuggestionGrace: () => boolean;

  constructor(options: CoworkSessionRuntimeControllerOptions) {
    this.emit = options.emit;
    this.getAccountDetails = options.getAccountDetails;
    this.getAllowedWorkspaceFolders = options.getAllowedWorkspaceFolders;
    this.getAutoMemoryDir = options.getAutoMemoryDir;
    this.getHostOutputsDir = options.getHostOutputsDir;
    this.getIdentity = options.getIdentity;
    this.getSessionStorageDir = options.getSessionStorageDir;
    this.getVmEgressPolicy = options.getVmEgressPolicy;
    this.hasMarkTaskComplete = options.hasMarkTaskComplete;
    this.mountSessionFolder = options.mountSessionFolder;
    this.notifySession = options.notifySession;
    this.now = options.now;
    this.onBecameIdle = options.onBecameIdle;
    this.buildCicCanUseTool = options.buildCicCanUseTool;
    this.onMarkTaskComplete = options.onMarkTaskComplete;
    this.onQueryCompleted = options.onQueryCompleted;
    this.pickDirectory = options.pickDirectory;
    // Official ft("2979038612") residual — default prefer notifications.
    this.preferSessionNotifications =
      options.preferSessionNotifications ?? (() => true);
    // Official ft("1942781881") residual — default off.
    this.enablePromptSuggestionGrace =
      options.enablePromptSuggestionGrace ?? (() => false);
    this.queryFactory = options.queryFactory;
    this.recordDetectedFile = options.recordDetectedFile;
    this.requestPermission = options.requestPermission;
    this.save = options.save;
    this.saveAndEmitUpdate = options.saveAndEmitUpdate;
    this.setFileDeleteApprovedForMount = options.setFileDeleteApprovedForMount;
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
    // Official sendMessage options only include toolStates when present
    // (`"toolStates"in o&&(s.widgetToolStates=o.toolStates)`). Do not spread
    // undefined toolStates — that would wipe session.widgetToolStates every turn.
    const userMessage = this.recordUserMessage(session, {
      images,
      message,
      messageUuid,
      userSelectedFiles,
      ...(toolStates !== undefined ? { toolStates } : {}),
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
      // Only retain toolStates key when present (official `"toolStates"in o`).
      ...(info.toolStates !== undefined ? { toolStates: info.toolStates } : {}),
      userSelectedFiles: info.userSelectedFiles,
    });
  }

  private async createQuery(
    session: CoworkSessionRuntimeState,
    queue: CoworkAsyncInputQueue<CoworkSdkUserMessage>,
  ): Promise<CoworkRuntimeQuery> {
    const rewindTo = session.pendingRewindTo;
    const resume = rewindTo === undefined ? session.cliSessionId : rewindTo ? session.cliSessionId : undefined;
    session.pendingRewindTo = undefined;
    this.save(session);
    // Official UXe: autoMemoryHostDir = memoryEnabled gate ? getAutoMemoryDir : null
    // autoMemoryReadOnly = sessionType === radar (Nu)
    // mkdir failure → degrade to null (official: T=null after warn).
    let autoMemoryDir = this.getAutoMemoryDir?.(session) ?? null;
    if (autoMemoryDir) {
      try {
        await mkdir(autoMemoryDir, { recursive: true });
      } catch {
        autoMemoryDir = null;
      }
    }
    // Official hostOutputsDir / hostUploadsDir under session storage.
    // Official getClaudeConfigDir = join(sessionStorageDir, ".claude") + mkdir 0o700.
    const sessionStorageDir = this.getSessionStorageDir?.(session) ?? null;
    let hostOutputsDir: string | null = null;
    let hostUploadsDir: string | null = null;
    let hostClaudeConfigDir: string | null = null;
    if (sessionStorageDir) {
      hostOutputsDir = path.join(sessionStorageDir, "outputs");
      hostUploadsDir = path.join(sessionStorageDir, "uploads");
      hostClaudeConfigDir = path.join(sessionStorageDir, ".claude");
      try {
        await mkdir(hostOutputsDir, { recursive: true });
        await mkdir(hostUploadsDir, { recursive: true });
        await mkdir(hostClaudeConfigDir, { recursive: true, mode: 0o700 });
      } catch {
        /* keep paths even if mkdir fails — policy still references them */
      }
    }
    // Official session.readOnlyPluginPaths (UXe: Ke.readOnlyPluginPaths=Ve).
    // Fill from installed_plugins.json / remote plugin dirs when session has none yet.
    // Do not invent roots — collect only existing host install paths.
    if (
      !session.readOnlyPluginPaths
      || session.readOnlyPluginPaths.length === 0
    ) {
      const identity = this.getIdentity();
      const userDataPath = resolveCoworkUserDataFromSessionStorage(
        sessionStorageDir,
      );
      if (userDataPath && identity?.accountUuid && identity?.organizationUuid) {
        const collected = collectCoworkReadOnlyPluginPaths({
          accountId: identity.accountUuid,
          orgId: identity.organizationUuid,
          userDataPath,
        });
        if (collected.length > 0) {
          session.readOnlyPluginPaths = collected;
        }
      }
    }
    const readOnlyPluginPaths =
      session.readOnlyPluginPaths?.filter(
        (pluginPath) =>
          typeof pluginPath === "string" && pluginPath.trim().length > 0,
      ) ?? null;
    const vmProcessName = session.vmProcessName || session.processName;
    const networkDriveFolders = coworkNetworkDriveFolderPaths(
      session.resolvedFolders,
    );
    const userSelectedFolders = coworkUserSelectedFolderPaths(
      session.resolvedFolders,
    );
    // Official dual-exec (hostLoopMode=false): await vm ready, then guest spawn mounts.
    let dualExecSpawn:
      | {
          additionalMounts: Record<string, unknown>;
          allowedDomains?: string[] | null;
          isResume?: boolean;
          processName: string;
          sessionId: string;
        }
      | null = null;
    if (!session.hostLoopMode && vmProcessName) {
      // Best-effort early start; spawn-time ensureVmStarted also waits for guest.
      // Honest failure surfaces at guest Claude spawn (not option-build).
      void getCoworkClaudeVmService().startVM().catch(() => undefined);
      const dualMounts = computeCoworkDualExecMounts({
        autoMemoryDir,
        autoMemoryReadWrite:
          !Boolean(session.sessionType === "radar") && Boolean(autoMemoryDir),
        fileDeleteApprovedMounts: session.fileDeleteApprovedMounts,
        hostClaudeConfigDir,
        hostOutputsDir,
        hostUploadsDir,
        networkDriveFolders,
        // Official UXe plugin ro mounts when session already collected host paths.
        pluginMounts: pluginMountsFromReadOnlyPaths(readOnlyPluginPaths),
        userSelectedFolders,
        vmProcessName,
      });
      dualExecSpawn = {
        additionalMounts: dualMounts.mounts as Record<string, unknown>,
        allowedDomains: resolveCoworkWorkspaceAllowedDomains({
          egressAllowedDomains: session.egressAllowedDomains,
          otelConfig: session.otelConfig,
          vmEgressPolicy: this.getVmEgressPolicy?.(session),
        }) as string[] | null | undefined,
        isResume: Boolean(resume),
        processName: vmProcessName,
        sessionId: session.sessionId,
      };
    }
    return this.queryFactory({
      accountDetails: this.getAccountDetails(),
      accountIdentity: this.getIdentity(),
      // Official canUseTool P4(Th) for _hostPath attach; Settings residual when unset.
      allowedWorkspaceFolders: this.getAllowedWorkspaceFolders?.(session) ?? null,
      autoMemoryDir,
      autoMemoryReadOnly: session.sessionType === "radar",
      canUseTool: (request) => this.requestPermission(session, request),
      // Official aze CIC canUseTool residual — product wires browser card hooks.
      cicCanUseTool: this.buildCicCanUseTool?.(session),
      cwd: session.hostLoopMode
        ? session.cwd
        : `/sessions/${vmProcessName}`,
      // Official a||g path-required gate uses session.sessionType.
      sessionType: session.sessionType ?? null,
      dualExecSpawn,
      enabledMcpTools: session.enabledMcpTools,
      forkSession: Boolean(rewindTo && resume),
      hostClaudeConfigDir,
      hostOutputsDir,
      hostUploadsDir,
      hostLoopMode: session.hostLoopMode,
      networkDriveFolders,
      readOnlyPluginPaths,
      vmProcessName,
      // Official alwaysLoad: mcp-registry + skills + plugins + cowork (dXe).
      // Path context wires LocalMcp XL/DeA staging (createSdkServer).
      // Official UXe host-loop also injects workspace MCP (x1i: bash + web_fetch).
      // Official WA.cowork = dXe({ mountFolder, getSessionStorageDir, ... }).
      mcpServers: withCoworkDirectoryMcpServer(
        withCoworkWorkspaceMcpServer(
          withCoworkAlwaysLoadMcpServers(
            session.sessionId,
            session.mcpServers as Record<string, unknown> | undefined,
            () => this.buildPathContext(session),
          ),
          session.hostLoopMode
            ? (() => {
                // Official UXe → x1i({
                //   allowedDomains, computeBashMounts: j1i, vmReadyPromise,
                //   vmProcessName, sessionId, sessionType
                // }) with Y1i/xeA guest bash — not host child_process.
                const vmProcessName =
                  session.vmProcessName || session.processName;
                const guestBash = getCoworkVmGuestBashRunner();
                return {
                  allowedDomains: resolveCoworkWorkspaceAllowedDomains({
                    egressAllowedDomains: session.egressAllowedDomains,
                    otelConfig: session.otelConfig,
                    vmEgressPolicy: this.getVmEgressPolicy?.(session),
                  }),
                  computeBashMounts: () => {
                    const storage =
                      this.getSessionStorageDir?.(session) ?? null;
                    const outputs =
                      this.getHostOutputsDir?.(session)
                      ?? (storage ? path.join(storage, "outputs") : null);
                    const uploads = storage
                      ? path.join(storage, "uploads")
                      : null;
                    return computeCoworkHostLoopBashMounts({
                      autoMemoryDir: this.getAutoMemoryDir?.(session) ?? null,
                      fileDeleteApprovedMounts:
                        session.fileDeleteApprovedMounts,
                      hostOutputsDir: outputs,
                      hostUploadsDir: uploads,
                      networkDriveFolders:
                        coworkNetworkDriveFolderPaths(session.resolvedFolders),
                      sessionStorageDir: storage,
                      userSelectedFolders: coworkUserSelectedFolderPaths(
                        session.resolvedFolders,
                      ),
                      vmProcessName,
                    });
                  },
                  getVmStatus: () => guestBash.getVmStatus(),
                  runBash: (input) => guestBash.runBash(input),
                  sessionId: session.sessionId,
                  sessionType: session.sessionType ?? "cowork",
                  vmProcessName,
                };
              })()
            : null,
        ),
        {
          // Official Th() / allowedWorkspaceFolders → P4 tG.
          getAllowedWorkspaceFolders: this.getAllowedWorkspaceFolders
            ? () => this.getAllowedWorkspaceFolders!(session)
            : undefined,
          getHostOutputsDir: () => {
            if (this.getHostOutputsDir) {
              return this.getHostOutputsDir(session);
            }
            const storage = this.getSessionStorageDir?.(session);
            return storage ? path.join(storage, "outputs") : null;
          },
          getOutputsSubpath: () => {
            if (this.getHostOutputsDir) {
              return this.getHostOutputsDir(session);
            }
            const storage = this.getSessionStorageDir?.(session);
            return storage ? path.join(storage, "outputs") : null;
          },
          getSessionStorageDir: () =>
            this.getSessionStorageDir?.(session) ?? null,
          // Official _c = resolvedFolders.map(Lc) — includes network-drive display.
          getUserSelectedFolders: () =>
            coworkUserSelectedFolderPaths(session.resolvedFolders),
          // Official NH(resolvedFolders) — non-local kinds for tJA exclude.
          getNetworkDriveFolders: () =>
            coworkNetworkDriveFolderPaths(session.resolvedFolders),
          getVMPathContext: () => this.buildPathContext(session),
          isHostLoopMode: Boolean(session.hostLoopMode),
          mountFolder: this.mountSessionFolder
            ? (pathKind) =>
                this.mountSessionFolder!(session.sessionId, pathKind)
            : undefined,
          notifySession: this.notifySession
            ? (message) => this.notifySession!(session.sessionId, message)
            : undefined,
          pickDirectory: this.pickDirectory,
          recordDetectedFile: this.recordDetectedFile
            ? (hostPath) =>
                this.recordDetectedFile!(session.sessionId, hostPath)
            : undefined,
          sessionId: session.sessionId,
          setFileDeleteApprovedForMount: this.setFileDeleteApprovedForMount
            ? (mountName) =>
                this.setFileDeleteApprovedForMount!(
                  session.sessionId,
                  mountName,
                )
            : undefined,
          hasMarkTaskComplete:
            typeof this.hasMarkTaskComplete === "function"
              ? this.hasMarkTaskComplete(session)
              : this.hasMarkTaskComplete !== false,
          onMarkTaskComplete: this.onMarkTaskComplete
            ? () => this.onMarkTaskComplete!(session.sessionId)
            : undefined,
          vmProcessName: session.vmProcessName || session.processName,
        },
      ),
      model: session.model,
      permissionMode: session.permissionMode,
      prompt: queue,
      remoteMcpServers: session.remoteMcpServersConfig,
      resume,
      resumeSessionAt: rewindTo || undefined,
      sessionId: session.sessionId,
      // Official _Ui: when hasMarkTaskComplete, append VUA guidance to system prompt.
      systemPrompt: appendCoworkMarkTaskCompleteSystemPrompt(
        session.systemPrompt,
        typeof this.hasMarkTaskComplete === "function"
          ? this.hasMarkTaskComplete(session)
          : this.hasMarkTaskComplete !== false,
      ),
      // Official UXe additionalDirectories / twe(Zni) includes network unc.
      // Dual-exec factory rewrites to /sessions/<vm>/mnt/<name>; host-loop keeps host paths.
      userSelectedFolders: session.hostLoopMode
        ? coworkFolderPermissionPaths(session.resolvedFolders)
        : userSelectedFolders,
    });
  }

  private attachQuery(
    session: CoworkSessionRuntimeState,
    query: CoworkRuntimeQuery,
    queue: CoworkAsyncInputQueue<CoworkSdkUserMessage>,
  ): void {
    session.query = query;
    session.inputStream = queue;
    // Official setLifecycle → running && tv(sessionType): pwe prune CU grants.
    session.lifecycleState = "running";
    pruneCoworkSessionCuGrantsOnTurnStart(session, this.now());
    const runtime = new CoworkQueryRuntime({
      emit: this.emit,
      // Official ft("1942781881") residual inject for success-result arm.
      enablePromptSuggestionGrace: this.enablePromptSuggestionGrace,
      isCurrent: () => session.query === query,
      now: this.now,
      onBecameIdle: this.onBecameIdle,
      onClosed: () => this.onQueryClosed(session, query),
      onQueryCompleted: this.onQueryCompleted,
      query,
      save: this.save,
      session,
      translateMessage: (message) => this.translateMessagePaths(session, message),
    });
    void runtime.run();
  }

  /**
   * Official LocalAgentModeSessionManager.buildVMPathContext:
   * sessionStorageDir + autoMemoryDir (getAutoMemoryDirForSession) + mounts.
   */
  private buildPathContext(session: CoworkSessionRuntimeState) {
    return buildCoworkVmPathContext(session, {
      autoMemoryDir: this.getAutoMemoryDir?.(session) ?? null,
      sessionStorageDir: this.getSessionStorageDir?.(session) ?? null,
    });
  }

  /**
   * Official LocalAgentModeSessionManager.translateMessagePaths:
   *   XL(message, `/sessions/${vm}/mnt/`, buildVMPathContext(session), hostLoopMode)
   */
  private translateMessagePaths<T extends CoworkSdkMessage>(
    session: CoworkSessionRuntimeState,
    message: T,
  ): T {
    const context = this.buildPathContext(session);
    return translateCoworkMessagePaths(message, context, session.hostLoopMode);
  }

  private onQueryClosed(
    session: CoworkSessionRuntimeState,
    query: CoworkRuntimeQuery,
  ): void {
    if (session.query !== query) return;
    session.query = null;
    session.inputStream = null;
    if (session.lifecycleState === "running") {
      // Official leavingRunning: clear product-owned CU ephemerals.
      clearCoworkSessionEphemeralsOnLeavingRunning(session);
      session.lifecycleState = "idle";
    }
    this.saveAndEmitUpdate(session);
  }

  private recordUserMessage(
    session: CoworkSessionRuntimeState,
    info: Pick<
      CoworkStartSessionInput,
      "images" | "message" | "messageUuid" | "userSelectedFiles"
    > & { toolStates?: CoworkToolState[] },
  ): CoworkSdkUserMessage {
    // Official sendMessage: `"toolStates"in o&&(s.widgetToolStates=o.toolStates)`
    // before user-message pipeline (appendWidget reads session.widgetToolStates).
    if ("toolStates" in info) {
      session.widgetToolStates = info.toolStates;
    }
    const userMessage = createUserMessage(
      session,
      info.message,
      info.messageUuid ?? randomUUID(),
      info.images,
      info.userSelectedFiles,
      info.toolStates,
      { preferSessionNotifications: this.preferSessionNotifications() },
    );
    session.messageBuffer.push(userMessage);
    // Official LocalAgentModeSessionManager keeps the active turn uuid for
    // lam_tool_permission_* analytics (`user_message_uuid`).
    session.pendingUserMessageUuid = userMessage.uuid;
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

/**
 * Derive Electron userData from session storage path:
 *   userData/local-agent-mode-sessions/<account>/<org>/...
 * When session storage is unset, return null (do not invent userData).
 */
export function resolveCoworkUserDataFromSessionStorage(
  sessionStorageDir: string | null | undefined,
): string | null {
  if (!sessionStorageDir) return null;
  const marker = path.sep + COWORK_LOCAL_AGENT_MODE_SESSIONS_DIR + path.sep;
  const normalized = path.resolve(sessionStorageDir);
  const idx = normalized.indexOf(marker);
  if (idx <= 0) {
    // exact segment at end of userData
    const suffix = path.sep + COWORK_LOCAL_AGENT_MODE_SESSIONS_DIR;
    if (normalized.endsWith(suffix)) {
      return normalized.slice(0, -suffix.length) || null;
    }
    return null;
  }
  return normalized.slice(0, idx) || null;
}
