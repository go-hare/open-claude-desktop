import { app, BrowserWindow, nativeTheme, shell } from "electron";
import path from "node:path";

let setupWindow: BrowserWindow | null = null;

function isAlive(window: BrowserWindow | null): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed());
}

function jsonArg(name: string, value: unknown): string {
  return `${name}=${JSON.stringify(value ?? {})}`;
}

/**
 * Official createSetupWindow residual (app.asar `vgr`):
 *   new BrowserWindow({
 *     width: 900, height: 720, minWidth: 720, minHeight: 560,
 *     backgroundColor: I8() → dark "#1f1f1e" / light "#fdfdfc",
 *     title: formatMessage("Configure Third-Party Inference…", id 9GRz7bC+rr),
 *     autoHideMenuBar: true,
 *     webPreferences: { preload: mainView.js },
 *   })
 *   QN(webContents, Jh.CUSTOM3P_SETUP)
 *   loadURL(`${Jb}/setup-desktop-3p`)  // app://localhost/setup-desktop-3p
 *
 * Official does **not** set parent/modal. Product previously passed parent=mainWindow
 * and served product-web SPA (no setup route) → window showed task/new shell.
 *
 * Page residual lives in ion-dist (`c71860c77-BOaDa5w5.js`); app protocol dual-root
 * must serve residual ion-dist for this path (see staticIonDist RESIDUAL_APP_SPA_PATHS).
 */
export async function openCustom3pSetupWindow(_parent?: BrowserWindow): Promise<BrowserWindow | null> {
  if (isAlive(setupWindow)) {
    setupWindow.show();
    setupWindow.focus();
    return setupWindow;
  }

  // Official I8 residual.
  const backgroundColor = nativeTheme.shouldUseDarkColors ? "#1f1f1e" : "#fdfdfc";

  setupWindow = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    backgroundColor,
    // Product zh-CN chrome title; official defaultMessage is English 9GRz7bC+rr.
    title: "配置第三方推理…",
    autoHideMenuBar: true,
    // Official: no parent/modal — independent setup window.
    webPreferences: {
      preload: path.join(app.getAppPath(), ".vite/build/mainView.js"),
      enableBlinkFeatures: undefined,
      additionalArguments: [
        jsonArg("--desktop-features", {}),
        jsonArg("--desktop-enterprise-config", {}),
        jsonArg("--desktop-telemetry-config", {
          deploymentMode: "3p",
          appVersion: app.getVersion(),
          cookielessOrigin: true,
        }),
      ],
    },
  });

  setupWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  setupWindow.on("closed", () => {
    setupWindow = null;
  });

  // Official: loadURL immediately (no show:false + ready-to-show gate).
  await setupWindow.loadURL("app://localhost/setup-desktop-3p");
  if (isAlive(setupWindow)) {
    setupWindow.show();
    setupWindow.focus();
  }
  return setupWindow;
}

export function getCustom3pSetupWindow(): BrowserWindow | null {
  return isAlive(setupWindow) ? setupWindow : null;
}
