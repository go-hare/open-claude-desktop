import { BrowserWindow, nativeTheme } from "electron";
import type { DesktopWindowOptions } from "./types";

const ORIGINAL_TITLEBAR_HEIGHT = 45;
const ORIGINAL_TRAFFIC_LIGHT_SIZE = 12;
const ORIGINAL_TITLE_BAR_OVERLAY = process.platform === "win32";
const ORIGINAL_WINDOWS_TITLE_BAR_OVERLAY_HEIGHT = process.platform === "darwin" ? 0 : 36;
const ORIGINAL_INCOGNITO_TITLE_BAR_OVERLAY_HEIGHT = 44;
const TRANSPARENT_TITLE_BAR_COLOR = "#00000000";

let incognitoTitleBarMode = false;

export function getOriginalTrafficLightPosition(zoomFactor = 1): { x: number; y: number } {
  const inset = Math.round((ORIGINAL_TITLEBAR_HEIGHT * zoomFactor - ORIGINAL_TRAFFIC_LIGHT_SIZE) / 2);
  return { x: inset, y: inset };
}

export function updateOriginalTrafficLightPosition(mainWindow: BrowserWindow, zoomFactor = 1): void {
  if (process.platform !== "darwin" || mainWindow.isDestroyed()) return;
  const macWindow = mainWindow as BrowserWindow & {
    setWindowButtonPosition?: (position: { x: number; y: number } | null) => void;
  };
  macWindow.setWindowButtonPosition?.(getOriginalTrafficLightPosition(zoomFactor));
}

export function getOriginalWindowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#1f1f1e" : "#fdfdfc";
}

function getOriginalTitleBarOverlay(): Electron.TitleBarOverlay {
  const height = incognitoTitleBarMode ? ORIGINAL_INCOGNITO_TITLE_BAR_OVERLAY_HEIGHT : ORIGINAL_WINDOWS_TITLE_BAR_OVERLAY_HEIGHT;
  if (nativeTheme.shouldUseDarkColors) {
    return {
      color: incognitoTitleBarMode ? "#f9f8f4" : TRANSPARENT_TITLE_BAR_COLOR,
      symbolColor: incognitoTitleBarMode ? "#000" : "#fff",
      height,
    };
  }

  return {
    color: incognitoTitleBarMode ? "#141412" : TRANSPARENT_TITLE_BAR_COLOR,
    symbolColor: incognitoTitleBarMode ? "#fff" : "#000",
    height,
  };
}

export function applyOriginalTitleBarOverlay(mainWindow: BrowserWindow): void {
  if (process.platform !== "win32" || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setTitleBarOverlay(getOriginalTitleBarOverlay());
  } catch {
    // Older Electron builds can reject titleBarOverlay updates on some platforms.
  }
}

export function setOriginalIncognitoTitleBarMode(enabled: boolean): void {
  incognitoTitleBarMode = enabled;
  if (process.platform !== "win32") return;
  for (const window of BrowserWindow.getAllWindows()) {
    applyOriginalTitleBarOverlay(window);
  }
}

export function createMainWindow(options: DesktopWindowOptions): BrowserWindow {
  const persisted = options.windowState;
  const mainWindow = new BrowserWindow({
    x: persisted?.x,
    y: persisted?.y,
    width: options.width ?? persisted?.width ?? 1200,
    height: options.height ?? persisted?.height ?? 800,
    minWidth: options.minWidth ?? 600,
    minHeight: options.minHeight ?? 400,
    titleBarStyle: "hidden",
    titleBarOverlay: options.titleBarOverlay ?? ORIGINAL_TITLE_BAR_OVERLAY,
    trafficLightPosition: options.trafficLightPosition ?? getOriginalTrafficLightPosition(),
    show: options.showOnCreate ?? true,
    backgroundColor: options.backgroundColor ?? getOriginalWindowBackgroundColor(),
    opacity: 0,
    webPreferences: {
      preload: options.paths.mainWindowPreload,
      enableBlinkFeatures: undefined,
    },
  });

  applyOriginalTitleBarOverlay(mainWindow);
  return mainWindow;
}
