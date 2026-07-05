import type { NamespaceBridgeSpec } from "../../../shared/bridge/spec";

export const skillsBridgeSpec: NamespaceBridgeSpec = {
  Skills: {
    invoke: ["previewSkillFile"],
  },
};

export const simulatorBridgeSpec: NamespaceBridgeSpec = {
  Simulator: {
    invoke: ["listDevices", "installAndLaunch", "attach", "detach", "gesture"],
    events: ["attachment_"],
  },
};

export const officeAddinBridgeSpec: NamespaceBridgeSpec = {
  OfficeAddinFiles: {
    invoke: ["getConnectedFiles", "isFeatureEnabled", "focusFile", "selectFile", "updateActiveConversationSummary"],
    events: ["connectedFilesState_", "onAddinNeedsContext", "onFileAdded", "onFileRemoved", "onFileStateChanged"],
  },
};

export const buddyBridgeSpec: NamespaceBridgeSpec = {
  Buddy: {
    invoke: ["status", "install", "preview", "pairDevice", "scanDevices", "cancelScan", "pickDevice", "pickFolder", "submitPin", "forgetDevice", "setName"],
    events: ["deviceStatus", "pairingPrompt", "progress"],
  },
  BuddyBleTransport: {
    invoke: ["reportState", "log", "rx"],
    events: ["tx"],
  },
};
