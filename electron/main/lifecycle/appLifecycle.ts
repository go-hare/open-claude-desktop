import type { App, BrowserWindow } from "electron";
import { nativeTheme } from "electron";
import type { DesktopWindowParts } from "../windows/types";

export type DesktopLifecycleOptions = {
  app: App;
  getWindows: () => DesktopWindowParts | null;
  createAndLoadWindow: () => Promise<DesktopWindowParts>;
  onNativeThemeUpdated?: () => void;
  platform?: NodeJS.Platform;
};

function showMainWindow(mainWindow: BrowserWindow): void {
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

export function installDesktopAppLifecycle(options: DesktopLifecycleOptions): void {
  const { app, platform = process.platform } = options;

  app.on("window-all-closed", () => {
    if (platform !== "darwin") app.quit();
  });

  app.on("activate", async () => {
    const windows = options.getWindows();
    if (!windows || windows.mainWindow.isDestroyed()) {
      await options.createAndLoadWindow();
      return;
    }
    showMainWindow(windows.mainWindow);
  });

  nativeTheme.on("updated", () => {
    const windows = options.getWindows();
    if (windows && !windows.mainWindow.isDestroyed()) options.onNativeThemeUpdated?.();
  });
}
