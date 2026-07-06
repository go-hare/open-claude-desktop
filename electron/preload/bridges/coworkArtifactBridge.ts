import type { NamespaceBridgeSpec } from "../../../shared/bridge/spec";

export const coworkArtifactBridgeSpec: NamespaceBridgeSpec = {
  CoworkArtifactBridge: {
    invoke: ["callMcpTool", "askClaude", "runScheduledTask", "navigateHost", "openExternalUrl"],
  },
};
