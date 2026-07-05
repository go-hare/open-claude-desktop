import { WebContentsView } from "electron";
import type { DesktopWindowOptions } from "./types";

function jsonArg(name: string, value: unknown): string {
  return `${name}=${JSON.stringify(value ?? {})}`;
}

export function createMainView(options: DesktopWindowOptions): WebContentsView {
  const mainView = new WebContentsView({
    webPreferences: {
      preload: options.paths.mainViewPreload,
      enableBlinkFeatures: undefined,
      additionalArguments: [
        jsonArg("--desktop-features", options.desktopFeatures),
        jsonArg("--desktop-enterprise-config", options.desktopEnterpriseConfig),
        jsonArg("--desktop-telemetry-config", options.desktopTelemetryConfig),
      ],
    },
  });

  mainView.setBackgroundColor("#00000000");
  return mainView;
}
