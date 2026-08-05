/**
 * Residual Custom3p device-code verify window (app.asar _Er / MEr / Ust).
 *
 * Official:
 *   openDeviceCodeWindowForE2e: if (!process.env.CLAUDE_CDP_AUTH) return; showDeviceCodeWindow()
 *   showDeviceCodeWindow: 520×340, alwaysOnTop, title "Verify sign-in code",
 *     loadURL(`${Jb}/device-code-verify`) // app://localhost/device-code-verify
 *
 * data-official-source: app.asar index.js _Er / MEr / openDeviceCodeWindowForE2e
 * Non-goal: invent Anthropic device-code OAuth completion — window chrome only.
 */
import { app, BrowserWindow, nativeTheme } from "electron";
import path from "node:path";

let deviceCodeWindow: BrowserWindow | null = null;

function isAlive(window: BrowserWindow | null): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed());
}

function jsonArg(name: string, value: unknown): string {
  return `${name}=${JSON.stringify(value ?? {})}`;
}

/** Residual bst */
function existingDeviceCodeWindow(): BrowserWindow | null {
  return isAlive(deviceCodeWindow) ? deviceCodeWindow : null;
}

/**
 * Residual _Er — show or create device-code verify window.
 */
export function showDeviceCodeWindow(): BrowserWindow | null {
  const existing = existingDeviceCodeWindow();
  if (existing) {
    existing.show();
    existing.focus();
    return existing;
  }

  const backgroundColor = nativeTheme.shouldUseDarkColors ? "#1f1f1e" : "#fdfdfc";
  deviceCodeWindow = new BrowserWindow({
    width: 520,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    backgroundColor,
    title: "Verify sign-in code",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), ".vite/build/mainView.js"),
      enableBlinkFeatures: undefined,
      additionalArguments: [
        jsonArg("--desktop-enterprise-config", {}),
        jsonArg("--desktop-telemetry-config", {
          deploymentMode: "3p",
          appVersion: app.getVersion(),
          cookielessOrigin: true,
        }),
      ],
    },
  });

  const contents = deviceCodeWindow.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  const url = "app://localhost/device-code-verify";
  console.info(`[custom3p] Opening device-code verify window at ${url}`);
  void deviceCodeWindow.loadURL(url);
  deviceCodeWindow.on("closed", () => {
    deviceCodeWindow = null;
  });
  return deviceCodeWindow;
}

/** Residual MEr */
export function closeDeviceCodeWindow(): void {
  const existing = existingDeviceCodeWindow();
  if (existing) existing.destroy();
  deviceCodeWindow = null;
}

/**
 * Residual openDeviceCodeWindowForE2e — only when CLAUDE_CDP_AUTH is set.
 * Returns whether the window was opened (false when gate closed).
 */
export function openDeviceCodeWindowForE2e(): boolean {
  if (!process.env.CLAUDE_CDP_AUTH) return false;
  showDeviceCodeWindow();
  return true;
}
