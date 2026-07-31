import { app } from "electron";
import path from "node:path";
import { custom3pBootstrapState } from "../services/custom3p/custom3pStatus";
import { getSupportBundleState } from "../services/support/supportBundle";
import type { IpcHandlerContext } from "./context";
import { registerInterfaceHandlers, registerInterfaceSyncHandlers, type IpcHandler, type SyncIpcHandler } from "./registerIpc";

type StoreStateDefinition = {
  namespace: string;
  iface: string;
  storeName: string;
  getState: () => unknown;
};

function getBrowserNavigationState(context: IpcHandlerContext) {
  const { mainView } = context.windows;
  const history = mainView.webContents.navigationHistory;
  return {
    url: mainView.webContents.getURL(),
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
  };
}

function settingsUserDataPath(context: IpcHandlerContext): string {
  try {
    return path.dirname(context.settings.getSettingsFile());
  } catch {
    return app.getPath("userData");
  }
}

function registerStoreState(definition: StoreStateDefinition): void {
  const asyncHandlers: Record<string, IpcHandler> = {
    [`${definition.storeName}_$store$_getState`]: async () => definition.getState(),
  };
  const syncHandlers: Record<string, SyncIpcHandler> = {
    [`${definition.storeName}_$store$_getStateSync`]: () => definition.getState(),
  };
  registerInterfaceHandlers(definition.namespace, definition.iface, asyncHandlers, `${definition.namespace}.${definition.iface}.store`);
  registerInterfaceSyncHandlers(definition.namespace, definition.iface, syncHandlers, `${definition.namespace}.${definition.iface}.store`);
}

export function registerStoreStateHandlers(context: IpcHandlerContext): void {
  registerStoreState({
    namespace: "claude.settings",
    iface: "Custom3pSetup",
    storeName: "bootstrapState",
    getState: () => custom3pBootstrapState(settingsUserDataPath(context)),
  });
  registerStoreState({
    namespace: "claude.settings",
    iface: "SupportBundle",
    storeName: "supportBundleState",
    getState: () => getSupportBundleState(),
  });
  registerStoreState({
    namespace: "claude.simulator",
    iface: "Simulator",
    storeName: "attachment",
    getState: () => ({ attached: false, device: null }),
  });
  registerStoreState({
    namespace: "claude.officeAddin",
    iface: "OfficeAddinFiles",
    storeName: "connectedFilesState",
    getState: () => ({ files: [], activeFile: null }),
  });
  registerStoreState({
    namespace: "claude.web",
    iface: "AutoUpdater",
    storeName: "updaterState",
    getState: () => ({ status: "disabled", updateAvailable: false }),
  });
  registerStoreState({
    namespace: "claude.web",
    iface: "BrowserNavigation",
    storeName: "navigationState",
    getState: () => getBrowserNavigationState(context),
  });
  registerStoreState({
    namespace: "claude.web",
    iface: "LocalAgentModeSessions",
    storeName: "sessionsBridgeStatus",
    // Residual-honest: 3p has no Anthropic remote sessions bridge poller.
    // Pref may exist for UI round-trip, but never soft-true "ready".
    getState: () => ({
      enabled: false,
      status: "unavailable",
      conflict: false,
      dispatchAgentName: null,
      reason: "sessions_bridge_unavailable",
    }),
  });
  registerStoreState({
    namespace: "claude.web",
    iface: "LocalAgentModeSessions",
    // Official getInitialInteractiveAuthState: null | lcA bag. Product idle residual.
    storeName: "interactiveAuth",
    getState: () => null,
  });
  registerStoreState({
    namespace: "claude.web",
    iface: "GrandPrix",
    storeName: "grandPrixStatus",
    getState: () => ({ paired: false, status: "disconnected" }),
  });
  registerStoreState({
    namespace: "claude.web",
    iface: "Launch",
    storeName: "activeServers",
    getState: () => [],
  });
  registerStoreState({
    namespace: "claude.web",
    iface: "ClaudeVM",
    storeName: "apiReachability",
    getState: () => ({ reachability: "unknown", willTryRecover: false }),
  });
}
