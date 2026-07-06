import type { NamespaceBridgeSpec } from "../../../shared/bridge/spec";

export const skillsBridgeSpec: NamespaceBridgeSpec = {
  Skills: {
    events: ["previewSkillFile"],
  },
};

export const simulatorBridgeSpec: NamespaceBridgeSpec = {
  Simulator: {
    invoke: ["listDevices", "installAndLaunch", "attach", "detach", "gesture", "attachment_$store$_getState"],
    sync: ["attachment_$store$_getStateSync"],
    events: ["attachment_$store$_update"],
  },
};

export const officeAddinBridgeSpec: NamespaceBridgeSpec = {
  OfficeAddinFiles: {
    invoke: ["connectedFilesState_$store$_getState", "getConnectedFiles", "isFeatureEnabled", "focusFile", "selectFile", "updateActiveConversationSummary"],
    sync: ["connectedFilesState_$store$_getStateSync"],
    events: ["connectedFilesState_$store$_update", "onAddinNeedsContext", "onFileAdded", "onFileRemoved", "onFileStateChanged"],
  },
};

export const buddyBridgeSpec: NamespaceBridgeSpec = {
  Buddy: {
    invoke: ["status", "deviceStatus", "install", "preview", "pairDevice", "scanDevices", "cancelScan", "pickDevice", "pickFolder", "submitPin", "forgetDevice", "setName"],
    events: ["pairingPrompt", "progress"],
  },
  BuddyBleTransport: {
    invoke: ["reportState", "log", "rx"],
    events: ["tx"],
  },
};
