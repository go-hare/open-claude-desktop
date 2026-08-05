import { ipcRenderer, webFrame } from "electron";
import { exposeBridgeSpec, exposeValue } from "./expose";
import { readJsonArg } from "./argv";
import { claudeAppBindings, claudeAppSettings } from "./appBindings";
import { electronIntl } from "./intlBridge";
import { createProcessShim } from "./processShim";
import { electronWindowControl } from "./windowControl";
import { settingsBridgeSpec } from "./bridges/settingsBridge";
import { hybridBridgeSpec } from "./bridges/hybridBridge";
import { webBridgeSpec } from "./bridges/webBridge";
import { buddyBridgeSpec, officeAddinBridgeSpec, simulatorBridgeSpec, skillsBridgeSpec } from "./bridges/mainViewExtraBridge";
import { setupBuddyBle } from "./buddyBle";
import { readInitialLocaleBootstrap } from "./initialLocaleBootstrap";

exposeBridgeSpec(
  {
    "claude.web": webBridgeSpec,
    "claude.settings": settingsBridgeSpec,
    "claude.hybrid": hybridBridgeSpec,
    "claude.skills": skillsBridgeSpec,
    "claude.simulator": simulatorBridgeSpec,
    "claude.officeAddin": officeAddinBridgeSpec,
    "claude.buddy": buddyBridgeSpec,
  },
  ipcRenderer,
);

// Residual ion SPA (setup-desktop-3p / mainView) reads locale from:
//   localStorage["spa:locale"] → navigator.languages → en-US (index-BELzQL5P c3t/a_)
// then G0t fetches /i18n/{locale}.json + overrides. Product DesktopIntl preference
// must seed spa:locale in the **page** world before residual scripts run.
// Preload is context-isolated — use webFrame.executeJavaScript (not preload localStorage).
const { messages, locale } = readInitialLocaleBootstrap();
if (locale) {
  const seed = `(() => { try { localStorage.setItem("spa:locale", ${JSON.stringify(locale)}); document.documentElement.lang = ${JSON.stringify(locale)}; } catch (_) {} })()`;
  try {
    // Synchronous so spa:locale is set before residual index modules evaluate c3t.
    void webFrame.executeJavaScript(seed, true);
  } catch (err) {
    console.warn("[mainView preload] spa:locale seed failed", err);
  }
}

exposeValue("claudeAppBindings", claudeAppBindings);
exposeValue("claudeAppSettings", claudeAppSettings);
exposeValue("process", createProcessShim());
exposeValue("desktopBootFeatures", readJsonArg("--desktop-features=", {}));
exposeValue("desktopEnterpriseConfig", readJsonArg("--desktop-enterprise-config=", {}));
exposeValue("desktopTelemetryConfig", readJsonArg("--desktop-telemetry-config=", {}));
exposeValue("desktopNestLocalUsername", readJsonArg("--desktop-nest-local-username=", null));
exposeValue("electronWindowControl", electronWindowControl);
exposeValue("electronIntl", electronIntl);
exposeValue("initialMessages", messages);
exposeValue("initialLocale", locale);

// Official mainView residual: window.buddyBle = { pair, disconnect } + NUS transport.
// Must run after BuddyBleTransport IPC bridge is exposed.
try {
  setupBuddyBle();
} catch (err) {
  console.error("[buddyBle setup]", err);
}
