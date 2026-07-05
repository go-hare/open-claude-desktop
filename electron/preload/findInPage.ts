import { ipcRenderer } from "electron";
import { exposeBridgeSpec, exposeValue } from "./expose";
import { createProcessShim } from "./processShim";
import { hybridBridgeSpec } from "./bridges/hybridBridge";
import { internalFindInPageBridgeSpec } from "./bridges/findInPageBridge";

exposeBridgeSpec(
  {
    "claude.internal.findInPage": internalFindInPageBridgeSpec,
    "claude.hybrid": hybridBridgeSpec,
  },
  ipcRenderer,
);

exposeValue("process", createProcessShim());
exposeValue("initialLocale", "en-US");
