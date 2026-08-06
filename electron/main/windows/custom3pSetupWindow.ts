import { app, BrowserWindow, nativeTheme, shell } from "electron";
import path from "node:path";
import { resolveBrowserWindowIconPath } from "../services/settings/officialAppIcon";
import { SettingsStore } from "../services/settings/settingsStore";
import { resolveDialogLocale } from "../services/settings/desktopDialogI18n";

let setupWindow: BrowserWindow | null = null;

function isAlive(window: BrowserWindow | null): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed());
}

function jsonArg(name: string, value: unknown): string {
  return `${name}=${JSON.stringify(value ?? {})}`;
}

/**
 * Official createSetupWindow residual (app.asar `vgr`):
 *   title: formatMessage("Configure Third-Party Inference…", id 9GRz7bC+rr)
 * Product: follow DesktopIntl / preferences.locale (same bag as dialog i18n).
 */
function resolveSetupWindowTitle(): string {
  const TITLES: Record<string, string> = {
    "en-US": "Configure Third-Party Inference…",
    "zh-CN": "配置第三方推理…",
    "ja-JP": "サードパーティ推論の設定…",
    "ko-KR": "타사 추론 구성…",
    "de-DE": "Drittanbieter-Inferenz konfigurieren…",
    "fr-FR": "Configurer l’inférence tierce…",
    "es-ES": "Configurar inferencia de terceros…",
    "es-419": "Configurar inferencia de terceros…",
    "pt-BR": "Configurar inferência de terceiros…",
    "it-IT": "Configura inferenza di terze parti…",
    "id-ID": "Konfigurasi inferensi pihak ketiga…",
    "hi-IN": "थर्ड-पार्टी इनफरेंस कॉन्फ़िगर करें…",
  };
  try {
    const prefs = new SettingsStore().getPreferences();
    const raw =
      typeof prefs.locale === "string" && prefs.locale.length > 0
        ? prefs.locale
        : app.getLocale();
    const locale = resolveDialogLocale(raw);
    return TITLES[locale] ?? TITLES["en-US"]!;
  } catch {
    return TITLES["en-US"]!;
  }
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
 * Page residual lives in ion-dist (`c71860c77-BOaDa5w5.js`) — full official Setup UI.
 * app protocol dual-root must serve residual ion-dist for this path
 * (staticIonDist RESIDUAL_APP_SPA_PATHS). Product owns configLibrary + CLI env +
 * multi-vendor bag fields (patch-setup-multivendor-providers after sync).
 */
export async function openCustom3pSetupWindow(_parent?: BrowserWindow): Promise<BrowserWindow | null> {
  if (isAlive(setupWindow)) {
    setupWindow.show();
    setupWindow.focus();
    return setupWindow;
  }

  // Official I8 residual.
  const backgroundColor = nativeTheme.shouldUseDarkColors ? "#1f1f1e" : "#fdfdfc";
  const setupTitle = resolveSetupWindowTitle();
  // Win taskbar: residual PNG/ICO (icns empty → Electron Atom default).
  const appIconPath = resolveBrowserWindowIconPath(process.resourcesPath || app.getAppPath());

  setupWindow = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    backgroundColor,
    // Official 9GRz7bC+rr — follow preferences.locale (not hard-coded zh).
    title: setupTitle,
    autoHideMenuBar: true,
    ...(appIconPath ? { icon: appIconPath } : {}),
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

  // Residual ion-dist SPA may set document.title to "Claude Desktop Setup" (web
  // brand). Keep official BrowserWindow title (Configure Third-Party Inference…).
  setupWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    if (isAlive(setupWindow)) setupWindow.setTitle(setupTitle);
  });

  setupWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  setupWindow.on("closed", () => {
    setupWindow = null;
  });

  // Official residual SPA (not product approximate): dual-root serves ion-dist.
  // Official: loadURL immediately (no show:false + ready-to-show gate).
  await setupWindow.loadURL("app://localhost/setup-desktop-3p");
  if (isAlive(setupWindow)) {
    setupWindow.setTitle(setupTitle);
    setupWindow.show();
    setupWindow.focus();
  }
  return setupWindow;
}

export function getCustom3pSetupWindow(): BrowserWindow | null {
  return isAlive(setupWindow) ? setupWindow : null;
}

/**
 * Close the independent Setup BrowserWindow without quitting the app.
 * Used by relaunchApp so countdown can run on the main window (official UX:
 * close small Setup first → main shows "Relaunching in n").
 */
export function closeCustom3pSetupWindow(): void {
  if (!isAlive(setupWindow)) {
    setupWindow = null;
    return;
  }
  try {
    setupWindow.removeAllListeners("close");
    setupWindow.close();
  } catch {
    try {
      setupWindow.destroy();
    } catch {
      /* already gone */
    }
  } finally {
    setupWindow = null;
  }
}
