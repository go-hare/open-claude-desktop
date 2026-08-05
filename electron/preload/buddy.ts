/**
 * Buddy window preload — residual surface from official buddy.js.
 * data-official-source: app.asar .vite/build/buddy.js
 *
 * Residual buddy window exposes:
 *   claude.buddy.Buddy only (NOT BuddyBleTransport — that is mainView residual)
 *   claude.hybrid DesktopIntl
 *   process / initialMessages / initialLocale (sync getInitialLocale)
 *   buddy.getPathForFile (webUtils)
 */
import { ipcRenderer, webUtils } from "electron";
import type { NamespaceBridgeSpec } from "../../shared/bridge/spec";
import { exposeBridgeSpec, exposeValue } from "./expose";
import { createProcessShim } from "./processShim";
import { hybridBridgeSpec } from "./bridges/hybridBridge";
import { readInitialLocaleBootstrap } from "./initialLocaleBootstrap";

/** Residual buddy.js EIPC surface — Buddy iface only. */
const buddyWindowBridgeSpec: NamespaceBridgeSpec = {
  Buddy: {
    invoke: [
      "status",
      "deviceStatus",
      "install",
      "preview",
      "pairDevice",
      "scanDevices",
      "cancelScan",
      "pickDevice",
      "pickFolder",
      "submitPin",
      "forgetDevice",
      "setName",
    ],
    events: ["pairingPrompt", "progress"],
  },
};

exposeBridgeSpec(
  {
    "claude.buddy": buddyWindowBridgeSpec,
    "claude.hybrid": hybridBridgeSpec,
  },
  ipcRenderer,
);

const { messages, locale } = readInitialLocaleBootstrap();
exposeValue("process", createProcessShim());
exposeValue("initialMessages", messages);
exposeValue("initialLocale", locale);
exposeValue("buddy", {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
