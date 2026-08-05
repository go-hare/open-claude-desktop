/**
 * Quick Entry window preload — residual surface from official quickWindow.js.
 * data-official-source: app.asar .vite/build/quickWindow.js
 *
 * Official residual ships the same EIPC surface as aboutWindow (shared bundle).
 */
import { ipcRenderer } from "electron";
import { exposeBridgeSpec, exposeValue } from "./expose";
import { createProcessShim } from "./processShim";
import { internalUiBridgeSpec } from "./bridges/internalUiBridge";
import { hybridBridgeSpec } from "./bridges/hybridBridge";
import { readInitialLocaleBootstrap } from "./initialLocaleBootstrap";

exposeBridgeSpec(
  {
    "claude.internal.ui": internalUiBridgeSpec,
    "claude.hybrid": hybridBridgeSpec,
  },
  ipcRenderer,
);

const { messages, locale } = readInitialLocaleBootstrap();
exposeValue("process", createProcessShim());
exposeValue("initialMessages", messages);
exposeValue("initialLocale", locale);
