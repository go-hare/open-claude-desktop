import { ipcRenderer } from "electron";
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

exposeValue("claudeAppBindings", claudeAppBindings);
exposeValue("claudeAppSettings", claudeAppSettings);
exposeValue("process", createProcessShim());
exposeValue("desktopBootFeatures", readJsonArg("--desktop-features=", {}));
exposeValue("desktopEnterpriseConfig", readJsonArg("--desktop-enterprise-config=", {}));
exposeValue("desktopTelemetryConfig", readJsonArg("--desktop-telemetry-config=", {}));
exposeValue("desktopNestLocalUsername", readJsonArg("--desktop-nest-local-username=", null));
exposeValue("electronWindowControl", electronWindowControl);
exposeValue("electronIntl", electronIntl);
