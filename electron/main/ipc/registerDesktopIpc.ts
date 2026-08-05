import { app, dialog, shell } from "electron";
import { homedir } from "node:os";
import { LocalSessionStore } from "../services/localSessions/localSessionStore";
import { CoworkAccountContext } from "../services/coworkAccount/coworkAccountContext";
import {
  createCoworkAccountOauthIdentityWatcher,
  createCoworkGrowthBookAccountRefreshWatcher,
} from "../services/coworkAccount/coworkAccountIdentityEffects";
import { loadCoworkBootstrapIdentity } from "../services/coworkAccount/coworkBootstrapIdentity";
import { createCoworkHostLoopModeResolver } from "../services/coworkHostLoop/createCoworkHostLoopModeResolver";
import { isCoworkEnterpriseRequireFullVmSandbox } from "../services/coworkHostLoop/coworkEnterpriseConfig";
import { isCoworkHostLoopGrowthBookFeatureEnabled } from "../services/coworkHostLoop/coworkGrowthBookFeatures";
import { getActiveCoworkGrowthBookLifecycle } from "../services/coworkHostLoop/coworkGrowthBookLifecycle";
import { resolveCoworkRequireFullVmSandbox } from "../services/coworkHostLoop/coworkHostLoopMode";
import { createCoworkAgentQueryFactory } from "../services/coworkRuntime/coworkAgentQueryFactory";
import { kickComputerUseAppEnumerationPrewarm } from "../services/coworkRuntime/computerUseAppEnumeration";
import {
  createComputerUseHostAdapter,
} from "../services/coworkRuntime/computerUseDarwinExecutor";
import { getComputerUseSubGates } from "../services/coworkRuntime/computerUseChicagoConfig";
import { initComputerUseEsc } from "../services/coworkRuntime/computerUseLock";
import { initComputerUseTeachOverlay } from "../services/coworkRuntime/computerUseTeachOverlay";
import {
  createWebContentsDirectoryDispatcher,
  setCoworkDirectoryBridgeDispatcher,
} from "../services/coworkRuntime/coworkMcpDirectoryBridge";
import {
  createWebContentsPluginSearchDispatcher,
  setCoworkPluginSearchBridgeDispatcher,
} from "../services/coworkRuntime/coworkPluginSearchBridge";
import {
  createWebContentsSkillsSlashDispatcher,
  setCoworkSkillsSlashBridgeDispatcher,
} from "../services/coworkRuntime/coworkSkillsSlashBridge";
import { createCoworkTranscriptReader } from "../services/coworkRuntime/coworkTranscriptReader";
import { FeatureStateStore } from "../services/featureState/featureStateStore";
import {
  CoworkDesktopNotificationService,
  createElectronCoworkDesktopNotificationBackend,
} from "../services/coworkSessions/coworkDesktopNotificationService";
import { createCoworkMcpCoordinatorInjects } from "../services/coworkSessions/coworkMcpCoordinatorResidual";
import { CoworkSessionManager } from "../services/coworkSessions/coworkSessionManager";
import { CoworkSessionPersistence } from "../services/coworkSessions/coworkSessionPersistence";
import { ScheduledTaskStore } from "../services/scheduledTasks/scheduledTaskStore";
import { SettingsStore } from "../services/settings/settingsStore";
import { isEagerConnectorToolLoadFromUserData } from "../services/settings/toolAccessMode";
import type { WindowStateKeeper } from "../lifecycle/windowState";
import type { DesktopWindowParts } from "../windows/types";
import type { IpcHandlerContext } from "./context";
import { registerAppBindingsHandlers } from "./appBindingsHandlers";
import { registerFeatureHandlers } from "./featureHandlers";
import { registerFindInPageHandlers } from "./findInPageHandlers";
import { registerCoworkSessionsHandlers } from "./coworkSessionsHandlers";
import { registerLocalSessionsHandlers } from "./localSessionsHandlers";
import { getDirectMcpConnectionManager } from "../services/mcp/directMcpConnectionManager";
import {
  originalEventSurface,
  registerOriginalEventSurface,
} from "./originalEventSurface";
import { dispatchBridgeEvent } from "./registerIpc";
import { registerScheduledTasksHandlers } from "./scheduledTasksHandlers";
import { registerSettingsHandlers } from "./settingsHandlers";
import { registerStoreStateHandlers } from "./storeStateHandlers";
import { registerWebMiscHandlers } from "./webMiscHandlers";
import { registerWindowHandlers } from "./windowHandlers";
import { setSessionsBridgeStatusListener } from "../services/coworkSessions/sessionsBridgeResidual";
import {
  configureSessionsBridgeLifecycle,
  scheduleSessionsBridgeReconcile,
  setSessionsBridgeFeatureGate,
  SESSIONS_BRIDGE_FEATURE_FLAG_ID,
} from "../services/coworkSessions/sessionsBridgeLifecycle";
import { getSessionsBridgeClient } from "../services/coworkSessions/sessionsBridgeClient";
import { configureSessionsBridgePss } from "../services/coworkSessions/sessionsBridgePss";
import {
  getActiveWakeSchedulerController,
  getWakeSchedulerNativeApi,
} from "../services/settings/wakeScheduler";
import { setWakeChainActive } from "../services/settings/wakeSchedulerClaims";
import { isCoworkGrowthBookFeatureOn } from "../services/coworkHostLoop/coworkGrowthBookFeatures";
import { identityFromSettingsPrefs } from "../services/coworkSessions/sessionsBridgeResidual";

export function createDefaultIpcContext(
  windows: DesktopWindowParts,
  options?: { windowState?: WindowStateKeeper },
): IpcHandlerContext {
  const coworkAccount = new CoworkAccountContext({
    loadBootstrapIdentity: loadCoworkBootstrapIdentity,
  });
  // Official id() listeners residual (app.asar BbA + account oauth):
  //   id(() => I9t().finally(R0A))
  //   id(() => { identity-diff → Lm() })
  coworkAccount.subscribe(createCoworkAccountOauthIdentityWatcher());
  coworkAccount.subscribe(
    createCoworkGrowthBookAccountRefreshWatcher(() =>
      getActiveCoworkGrowthBookLifecycle(),
    ),
  );
  const featureState = new FeatureStateStore();
  // Shared SettingsStore so xn allowAllBrowserActions and AppPreferences IPC
  // see the same preference bag (official Xo()/F_ preferences).
  const settings = new SettingsStore();
  // Official uHA = vi().requireCoworkFullVmSandbox === true (MDM / configLibrary).
  // Residual env + settings preference still honored when enterprise source is none.
  const requireCoworkFullVmSandbox = () =>
    resolveCoworkRequireFullVmSandbox({
      enterpriseValue: isCoworkEnterpriseRequireFullVmSandbox({
        getUserDataPath: () => app.getPath("userData"),
      }),
      preferenceValue: settings.getPreferences().requireCoworkFullVmSandbox,
    });
  // Official v4(): feature flag 1143815894 via ft()/mZe. Product seeds official kni
  // (3p hardcodedMainGrowthBookFeatures → on:true). Env CLAUDE_HOST_LOOP_FEATURE still
  // overrides when set. requireCoworkFullVmSandbox / forceDisableHostLoop force dual-exec.
  // 1p /api/desktop/features + fcache: BbA lifecycle (R0A timer + I9t account).
  const resolveHostLoopMode = createCoworkHostLoopModeResolver({
    getForceDisableHostLoop: () =>
      featureState.getBoolean("vmForceDisableHostLoop", "global", false),
    getHostLoopFeatureEnabled: () => isCoworkHostLoopGrowthBookFeatureEnabled(),
    getRequireCoworkFullVmSandbox: requireCoworkFullVmSandbox,
  });
  // Official mcpDirectoryBridge wPA + skills c9e + pluginSearchBridge I9e:
  // reverse-RPC via LocalAgentModeSessions.onEvent.
  const getMainWc = () => windows.mainView.webContents;
  setCoworkDirectoryBridgeDispatcher(
    createWebContentsDirectoryDispatcher(getMainWc),
  );
  setCoworkSkillsSlashBridgeDispatcher(
    createWebContentsSkillsSlashDispatcher(getMainWc),
  );
  setCoworkPluginSearchBridgeDispatcher(
    createWebContentsPluginSearchDispatcher(getMainWc),
  );
  // Official getSessionStorageDir for XL transcript/message path context.
  let coworkPersistence: CoworkSessionPersistence | null = null;
  // Official Ds NotificationService (class fir) residual — Electron adapter only.
  // Swift UNUserNotificationCenter / ze analytics / dock bounce not product.
  const desktopNotificationService = new CoworkDesktopNotificationService({
    backend: createElectronCoworkDesktopNotificationBackend(),
  });
  /**
   * Spaces live in FeatureStateStore file; featureHandlers owns a separate in-memory Map.
   * Read a fresh store from disk each time (same pattern as scheduledTasksHandlers space folders).
   */
  const readSpaceRecord = (spaceId: string): Record<string, unknown> | null => {
    const spaces = new FeatureStateStore().loadMap<Record<string, unknown>>("spaces");
    return spaces.get(spaceId) ?? null;
  };
  // Residual mcpCoordinator injects: roots registry + createMcpServer/createRemote
  // from settings MCP bag (not soft no-op, not full createAllServers invent).
  const mcpCoordinatorInjects = createCoworkMcpCoordinatorInjects({
    getLocalMcpConfigs: () => settings.getMcpServersConfig(),
  });
  const localAgentModeSessions = new CoworkSessionManager({
    accountContext: coworkAccount,
    // Official getBridgeActiveSession inject — SessionsBridgeClient owns activeSessions.
    getBridgeActiveSession: (remoteId) => {
      const s = getSessionsBridgeClient()?.getActiveSession(remoteId);
      return s ? { localSessionId: s.localSessionId } : null;
    },
    registerRootsProvider: mcpCoordinatorInjects.registerRootsProvider,
    unregisterRootsProvider: mcpCoordinatorInjects.unregisterRootsProvider,
    createMcpServer: mcpCoordinatorInjects.createMcpServer,
    createRemoteMcpServers: mcpCoordinatorInjects.createRemoteMcpServers,
    // tool_search_mode "off" → eager setMcpServers (Tools already loaded residual).
    isEagerConnectorToolLoad: () =>
      isEagerConnectorToolLoadFromUserData(app.getPath("userData")),
    desktopNotificationService,
    // Residual RSe spaces for DJe project_instructions on start + space rename notify.
    getSpaceName: (spaceId) => {
      const space = readSpaceRecord(spaceId);
      return space && typeof space.name === "string" ? space.name : null;
    },
    getSpace: (spaceId) => {
      const space = readSpaceRecord(spaceId);
      if (!space) return null;
      const name = typeof space.name === "string" ? space.name : "";
      if (!name) return null;
      const linksRaw = Array.isArray(space.links) ? space.links : [];
      const links = linksRaw
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const link = entry as { title?: unknown; url?: unknown };
          if (typeof link.url !== "string" || !link.url) return null;
          return {
            title: typeof link.title === "string" ? link.title : null,
            url: link.url,
          };
        })
        .filter((entry): entry is { title: string | null; url: string } => Boolean(entry));
      return {
        name,
        description: typeof space.description === "string" ? space.description : null,
        instructions: typeof space.instructions === "string" ? space.instructions : null,
        links,
      };
    },
    // Official YM() / gi("chicagoEnabled"): computer-use fully on only after enable.
    // Also drives QHA stub path (featureDisabled enable prompt) when false.
    isComputerUseEnabled: () =>
      settings.getPreferences().chicagoEnabled === true,
    // Official gi("chicagoAutoUnhide") — SSA default true; leavingRunning P_A + adapter.
    getChicagoAutoUnhide: () =>
      settings.getPreferences().chicagoAutoUnhide !== false,
    // Official IFi getUserDeniedBundleIds → gi("chicagoUserDeniedBundleIds").
    getUserDeniedBundleIds: () => {
      const raw = settings.getPreferences().chicagoUserDeniedBundleIds;
      return Array.isArray(raw)
        ? raw.filter((id): id is string => typeof id === "string")
        : [];
    },
    // Official idle onClick: yz() focus main + dispatchNavigate residual.
    // Full XC.getDispatcher product not invented — focus main window only.
    navigateToLocalSession: (_sessionId) => {
      const main = windows.mainWindow;
      if (main && !main.isDestroyed()) {
        main.show();
        main.focus();
      }
    },
    createPersistence: (identity) => {
      coworkPersistence = new CoworkSessionPersistence({
        accountId: identity.accountUuid,
        orgId: identity.organizationUuid,
        userDataPath: app.getPath("userData"),
      });
      return coworkPersistence;
    },
    emit: (event) => {
      dispatchBridgeEvent(
        windows.mainView.webContents,
        "claude.web",
        "LocalAgentModeSessions",
        "onEvent",
        event,
      );
    },
    // Official P4 for request_cowork_directory: openDirectory + createDirectory,
    // title/message match dXe dialogTitle/dialogMessage.
    pickDirectory: async () => {
      const mainWindow = windows.mainWindow;
      const dialogOptions = {
        title: "Select Directory to Share",
        message: "Select a directory to share with the agent",
        defaultPath: homedir(),
        properties: ["openDirectory", "createDirectory"] as Array<
          "openDirectory" | "createDirectory"
        >,
      };
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true as const };
      }
      return { canceled: false as const, path: result.filePaths[0]! };
    },
    // Official gA.shell.openPath for LocalAgentModeSessions.openOutputsDir.
    // Ss Windows roaming residual not product-wired.
    openPath: (target) => shell.openPath(target),
    // Official gA.shell.showItemInFolder for transcript feedback iXi bundle.
    showItemInFolder: (target) => {
      shell.showItemInFolder(target);
    },
    // Official nB("downloads") residual — Electron app.getPath("downloads").
    getDownloadsDir: () => app.getPath("downloads"),
    // Official gA.app.getPath("logs") for J6e shareSession log tree.
    getLogsDir: () => app.getPath("logs"),
    // Official D7().appPath / homedir for S1/Qw share log scrub.
    getAppPath: () => app.getAppPath(),
    getScrubHomedir: () => homedir(),
    // Official xn("allowAllBrowserActions", bool) via AppPreferences residual.
    // Preference key exists in official defaults; do not invent browser automation.
    setAllowAllBrowserActions: (allowed) => {
      settings.setPreference("allowAllBrowserActions", allowed);
      const mainView = windows.mainView?.webContents;
      if (mainView && !mainView.isDestroyed()) {
        dispatchBridgeEvent(
          mainView,
          "claude.settings",
          "AppPreferences",
          "preferencesChanged",
          settings.getPreferences(),
        );
      }
    },
    // Official gi("allowAllBrowserActions") read for start chrome seed m.
    getAllowAllBrowserActions: () =>
      settings.getPreferences().allowAllBrowserActions === true,
    // Official K2() from account isRaven — manager derives when inject omitted.
    // Do not hardcode false; leave allowSkipAllOutsideUnsupervised unset.
    queryFactory: createCoworkAgentQueryFactory({
      onStderr: (chunk) => console.warn("[cowork-agent-sdk]", chunk.trimEnd()),
    }),
    resolveHostLoopMode: () => resolveHostLoopMode(),
    // Official vi().requireCoworkFullVmSandbox — settings/env residual until org payload.
    requireCoworkFullVmSandbox,
    // Official hasArtifacts / yn residual — write Documents/Claude/Artifacts + bag via FeatureState.
    // getAllWithDiskStatus is bag-first (soft-delete keeps disk orphans off the list).
    hasArtifacts: true,
    artifactStoreDeps: {
      getDocumentsPath: () => app.getPath("documents"),
      // Fresh store per write so create_artifact rows land in desktop-shell-feature-state.json.
      featureState: new FeatureStateStore(),
    },
    onArtifactsChanged: () => {
      const mainView = windows.mainView?.webContents;
      if (mainView && !mainView.isDestroyed()) {
        dispatchBridgeEvent(
          mainView,
          "claude.web",
          "CoworkArtifacts",
          "onArtifactsChanged",
        );
      }
    },
    // Official transcript load applies XL via buildVMPathContext.
    transcriptReader: createCoworkTranscriptReader(
      undefined,
      undefined,
      (session) => ({
        // Official buildVMPathContext: storage + autoMemory (ZrA/Use/GL).
        autoMemoryDir:
          coworkPersistence?.getAutoMemoryDirForSession(session) ?? null,
        sessionStorageDir:
          coworkPersistence?.getSessionStorageDir(session) ?? null,
      }),
    ),
  });
  // Official Xki residual: Escape globalShortcut stops CU lock holder.
  // Register only while lock held (Zki/zki via cuLockChanged).
  initComputerUseEsc((sessionId) => {
    void localAgentModeSessions.stop(sessionId).catch((error) => {
      console.warn("[cu-esc] stop holder failed", sessionId, error);
    });
  });
  // Official Ucr residual: teach overlay controller (BrowserWindow + cu-teach IPC).
  initComputerUseTeachOverlay(
    {
      on: (event, listener) => {
        localAgentModeSessions.on(
          event,
          listener as (...args: never[]) => void,
        );
      },
      resolveTeachStep: (result) =>
        localAgentModeSessions.resolveTeachStep(result),
      getCuLockHolder: () => localAgentModeSessions.getCuLockHolder(),
      stopSession: (sessionId) => localAgentModeSessions.stop(sessionId),
      getSession: (sessionId) => {
        const s = localAgentModeSessions.getSession(sessionId);
        return s
          ? { cuSelectedDisplayId: s.cuSelectedDisplayId }
          : null;
      },
    },
    () => windows.mainWindow,
  );
  // Official aFi residual prewarm (sFi 1s race) so gFi request_access descriptions
  // can include installed app names on first session when natives load in time.
  kickComputerUseAppEnumerationPrewarm(() => {
    const adapter = createComputerUseHostAdapter({
      // Enumeration does not require chicago on; adapter.isDisabled only gates actions.
      isChicagoEnabled: () => true,
      getAutoUnhideEnabled: () =>
        settings.getPreferences().chicagoAutoUnhide !== false,
      getSubGates: getComputerUseSubGates,
    });
    return adapter?.executor
      ? {
          listInstalledApps: () => adapter.executor.listInstalledApps(),
          listRunningApps: adapter.executor.listRunningApps
            ? () => adapter.executor.listRunningApps()
            : undefined,
        }
      : null;
  });
  return {
    windows,
    coworkAccount,
    localSessions: new LocalSessionStore("code"),
    localAgentModeSessions,
    scheduledTasks: new ScheduledTaskStore(),
    settings,
    // Official n5 for F1t resetMainWindowBounds (got/jsA mode change).
    windowState: options?.windowState,
  };
}

export function registerDesktopIpc(context: IpcHandlerContext): void {
  registerOriginalEventSurface(context);
  // Residual setDirectMcpStatusListener → dispatchOnDirectMcpServerStatusesChanged
  getDirectMcpConnectionManager().setStatusListener((statuses) => {
    originalEventSurface(context).localAgentModeDirectMcpServerStatusesChanged(
      statuses,
    );
  });
  // Official H6i → updateSessionsBridgeStatusStore (yit/QcA push)
  setSessionsBridgeStatusListener((state) => {
    originalEventSurface(context).localAgentModeSessionsBridgeStatusUpdated(state);
  });
  // Official nTA/lIr/NJ residual wiring (gate off until feature / force)
  setSessionsBridgeFeatureGate(
    isCoworkGrowthBookFeatureOn(SESSIONS_BRIDGE_FEATURE_FLAG_ID),
  );
  configureSessionsBridgeLifecycle({
    getIdentity: () => {
      try {
        const prefs = context.settings.getPreferences() as Record<string, unknown>;
        const fromPrefs = identityFromSettingsPrefs(prefs);
        if (fromPrefs.orgUuid && fromPrefs.accountUuid) return fromPrefs;
      } catch {
        /* fall through */
      }
      const id = context.coworkAccount?.getIdentity?.() ?? null;
      return {
        orgUuid: id?.organizationUuid ?? null,
        accountUuid: id?.accountUuid ?? null,
      };
    },
    onRemoteSessionStart: (payload) => {
      originalEventSurface(context).localAgentModeRemoteSessionStart(payload);
    },
    // Single preflight path → event surface only (no setPreflightDispatcher double-fire).
    onBridgePermissionPreflight: (payload) => {
      originalEventSurface(context).localAgentModeBridgePermissionPreflight(payload);
    },
    // Client handleInboundControlRequest → sessionManager.interruptTurn.
    // Do NOT also onInboundMessage → manager.handleInboundControlRequest (double interrupt).
    // getBridgeActiveSession on manager remains for direct manager residual callers.
    sessionManager: {
      hasSession: (id) => context.localAgentModeSessions.getSession(id) != null,
      sendMessage: (localId, text, images, files, messageUuid) =>
        context.localAgentModeSessions.sendMessage(
          localId,
          text,
          images as never,
          files as never,
          messageUuid,
        ),
      interruptTurn: (localId) =>
        context.localAgentModeSessions.interruptTurn(localId),
      seedWebFetchProvenance: (localId, text) =>
        context.localAgentModeSessions.seedWebFetchProvenance(localId, text),
    },
  });
  // Official bridge PSS residual: prefer native wakeScheduler asserts when present;
  // else powerSaveBlocker; never invent when both unavailable (returns 0).
  // Official Gle residual: setWakeChainActive (true no-op schedule; true→false → woA
  // rescheduleWakeFromClaims when controller ready + feature gated).
  configureSessionsBridgePss({
    getNative: () => {
      const api = getWakeSchedulerNativeApi() as {
        createPreventSystemSleepAssertion?: (r: string) => number;
        releaseAssertion?: (id: number) => void;
      } | null;
      if (!api) return null;
      const controller = getActiveWakeSchedulerController();
      return {
        isReady: () => controller?.isReady() === true,
        createPreventSystemSleepAssertion:
          api.createPreventSystemSleepAssertion?.bind(api),
        releaseAssertion: api.releaseAssertion?.bind(api),
      };
    },
    setChainActive: (active: boolean) => {
      // Official Gle residual → setWakeChainActive (woA claim-min chain).
      setWakeChainActive(active);
    },
  });
  void scheduleSessionsBridgeReconcile();
  registerWindowHandlers(context);
  registerAppBindingsHandlers(context);
  registerFindInPageHandlers(context);
  registerLocalSessionsHandlers(context);
  registerCoworkSessionsHandlers(context);
  registerScheduledTasksHandlers(context);
  registerSettingsHandlers(context);
  registerStoreStateHandlers(context);
  registerWebMiscHandlers(context);
  registerFeatureHandlers(context);
}
