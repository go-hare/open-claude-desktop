import { app, BrowserWindow, shell } from "electron";
import path from "node:path";

let setupWindow: BrowserWindow | null = null;

function isAlive(window: BrowserWindow | null): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed());
}

function centerOnParent(child: BrowserWindow, parent?: BrowserWindow): void {
  if (!parent || parent.isDestroyed()) return;
  const parentBounds = parent.getBounds();
  const childBounds = child.getBounds();
  child.setPosition(
    Math.round(parentBounds.x + (parentBounds.width - childBounds.width) / 2),
    Math.round(parentBounds.y + (parentBounds.height - childBounds.height) / 2),
  );
}

function jsonArg(name: string, value: unknown): string {
  return `${name}=${JSON.stringify(value ?? {})}`;
}

export async function openCustom3pSetupWindow(parent?: BrowserWindow): Promise<BrowserWindow> {
  if (isAlive(setupWindow)) {
    setupWindow.show();
    setupWindow.focus();
    return setupWindow;
  }

  setupWindow = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#ffffff",
    title: "Configure Third-Party Inference…",
    autoHideMenuBar: true,
    show: false,
    parent,
    modal: false,
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
  setupWindow.once("ready-to-show", () => {
    if (!isAlive(setupWindow)) return;
    centerOnParent(setupWindow, parent);
    setupWindow.show();
    setupWindow.focus();
  });
  setupWindow.on("closed", () => {
    setupWindow = null;
  });

  await setupWindow.loadURL("app://localhost/setup-desktop-3p");
  return setupWindow;
}

export function getCustom3pSetupWindow(): BrowserWindow | null {
  return isAlive(setupWindow) ? setupWindow : null;
}
