import type { App, BrowserWindow } from "electron";
import fs from "node:fs";
import { extractLaunchTarget, type LaunchTarget } from "./deepLinks";

export type SingleInstanceOptions = {
  app: App;
  getMainWindow: () => BrowserWindow | null | undefined;
  onSecondInstanceTarget?: (target: LaunchTarget) => void | Promise<void>;
  platform?: NodeJS.Platform;
};

export function restoreMainWindow(mainWindow: BrowserWindow | null | undefined): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  return true;
}

/**
 * Original bundle uses requestSingleInstanceLock + second-instance to bring the
 * existing window forward, then dispatches the deep-link/file launch payload.
 */
export function installSingleInstanceGuard(options: SingleInstanceOptions): boolean {
  const { app, platform = process.platform } = options;

  // macOS primarily enters through open-url / activate, but keeping the lock is
  // harmless and prevents duplicate windows when launched from CLI/tools.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }

  app.on("second-instance", (_event, argv) => {
    restoreMainWindow(options.getMainWindow());
    const target = extractLaunchTarget(argv, fs.existsSync);
    void options.onSecondInstanceTarget?.(target);
  });

  return platform === "darwin" || gotLock;
}
