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
import type { DesktopWindowParts } from "../windows/types";
import type { IpcHandlerContext } from "./context";
import { registerAppBindingsHandlers } from "./appBindingsHandlers";
import { registerFeatureHandlers } from "./featureHandlers";
import { registerFindInPageHandlers } from "./findInPageHandlers";
import { registerCoworkSessionsHandlers } from "./coworkSessionsHandlers";
import { registerLocalSessionsHandlers } from "./localSessionsHandlers";
import { registerOriginalEventSurface } from "./originalEventSurface";
import { dispatchBridgeEvent } from "./registerIpc";
import { registerScheduledTasksHandlers } from "./scheduledTasksHandlers";
import { registerSettingsHandlers } from "./settingsHandlers";
import { registerStoreStateHandlers } from "./storeStateHandlers";
import { registerWebMiscHandlers } from "./webMiscHandlers";
import { registerWindowHandlers } from "./windowHandlers";

export function createDefaultIpcContext(windows: DesktopWindowParts): IpcHandlerContext {
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
  return {
    windows,
    coworkAccount,
    localSessions: new LocalSessionStore("code"),
    localAgentModeSessions,
    scheduledTasks: new ScheduledTaskStore(),
    settings,
  };
}

export function registerDesktopIpc(context: IpcHandlerContext): void {
  registerOriginalEventSurface(context);
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
