import type { NamespaceBridgeSpec } from "../../../shared/bridge/spec";

export const internalUiBridgeSpec: NamespaceBridgeSpec = {
  MainWindowTitleBar: {
    invoke: [
      "titleBarReady",
      "updateTitleBar",
      "requestReloadMainView",
      "requestMainMenuPopup",
      "isClaudeCurrentlyHealthy",
      "showLoadError",
      "hideLoadError",
    ],
  },
  AboutWindow: {
    invoke: ["getAppName", "getBuildProps", "getSupport", "openHelp"],
  },
  QuickWindow: {
    invoke: ["requestDismiss", "requestDismissWithPayload", "requestSkooch"],
  },
};
