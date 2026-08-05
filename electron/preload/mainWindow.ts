import { ipcRenderer } from "electron";
import { exposeBridgeSpec, exposeValue } from "./expose";
import { createProcessShim } from "./processShim";
import { settingsBridgeSpec } from "./bridges/settingsBridge";
import { internalUiBridgeSpec } from "./bridges/internalUiBridge";
import { hybridBridgeSpec } from "./bridges/hybridBridge";
import { readInitialLocaleBootstrap } from "./initialLocaleBootstrap";

exposeBridgeSpec(
  {
    "claude.settings": settingsBridgeSpec,
    "claude.internal.ui": internalUiBridgeSpec,
    "claude.hybrid": hybridBridgeSpec,
  },
  ipcRenderer,
);

const { messages, locale } = readInitialLocaleBootstrap();
exposeValue("process", createProcessShim());
exposeValue("initialMessages", messages);
exposeValue("initialLocale", locale);
