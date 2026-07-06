import { ipcRenderer } from "electron";
import { exposeBridgeSpec } from "./expose";
import { coworkArtifactBridgeSpec } from "./bridges/coworkArtifactBridge";

exposeBridgeSpec(
  {
    "claude.coworkArtifact": coworkArtifactBridgeSpec,
  },
  ipcRenderer,
);
