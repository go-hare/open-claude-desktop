/**
 * About window preload — residual surface from official aboutWindow.js.
 * data-official-source: app.asar .vite/build/aboutWindow.js
 *
 * Residual about === quick (same bundle except sourcemap name).
 * Exposes:
 *   claude.internal.ui (AboutWindow + QuickWindow + MainWindowTitleBar)
 *   claude.hybrid (DesktopIntl)
 *   process / initialMessages / initialLocale (locale via sendSync getInitialLocale)
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
