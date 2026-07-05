import { BrowserWindow } from "electron";
import type { DesktopWindowOptions } from "./types";

const ORIGINAL_TITLEBAR_HEIGHT = 45;
const ORIGINAL_TRAFFIC_LIGHT_SIZE = 12;
const ORIGINAL_TITLE_BAR_OVERLAY = process.platform === "win32";

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
    backgroundColor: options.backgroundColor ?? "#ffffff",
    opacity: 0,
    webPreferences: {
      preload: options.paths.mainWindowPreload,
      enableBlinkFeatures: undefined,
    },
  });

  return mainWindow;
}
