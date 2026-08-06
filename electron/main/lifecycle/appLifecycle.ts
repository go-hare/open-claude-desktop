import type { App } from "electron";
import { nativeTheme } from "electron";
import type { DesktopWindowParts } from "../windows/types";
import {
  handleClaudeDeepLink,
  queuePendingClaudeOpenUrl,
} from "./claudeUrlHandler";
import { isClaudeDeepLink } from "./deepLinks";
import { bringMainWindowToFront } from "./bringMainWindowToFront";

export type DesktopLifecycleOptions = {
  app: App;
  getWindows: () => DesktopWindowParts | null;
  createAndLoadWindow: () => Promise<DesktopWindowParts>;
  onNativeThemeUpdated?: () => void;
  /**
   * Official residual after open-url magic-link miss: bridge DeepLink for other
   * claude:// routes once mainView exists.
   */
  onOpenUrlDeepLink?: (rawUrl: string) => void;
  platform?: NodeJS.Platform;
};

function showMainWindow(mainWindow: import("electron").BrowserWindow): void {
  // After app.relaunch / Dock activate: must steal focus + clear opacity:0 boot.
  bringMainWindowToFront(mainWindow);
}

/**
 * Official residual (app.asar):
 *   P.app.on("open-url",(e,t)=>{
 *     const n=exports.mainView;
 *     n ? Z8(t,n,…) && focus mainWindow : Qj=t
 *     finally e.preventDefault()
 *   })
 */
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

  // macOS Launch Services / universal-link entry for claude://…
  app.on("open-url", (event, rawUrl) => {
    event.preventDefault();
    try {
      if (!rawUrl || !isClaudeDeepLink(rawUrl)) return;
      console.info("[claudeURLHandler] open-url", rawUrl.slice(0, 160));
      const windows = options.getWindows();
      const mainView = windows?.mainView;
      if (!mainView || mainView.webContents.isDestroyed()) {
        queuePendingClaudeOpenUrl(rawUrl);
        return;
      }
      const result = handleClaudeDeepLink(rawUrl, mainView.webContents);
      if (!result.handled) {
        options.onOpenUrlDeepLink?.(rawUrl);
      }
      if (windows?.mainWindow && !windows.mainWindow.isDestroyed()) {
        showMainWindow(windows.mainWindow);
      }
    } catch (error) {
      console.error("[claudeURLHandler] open-url failed", error);
    }
  });

  nativeTheme.on("updated", () => {
    const windows = options.getWindows();
    if (windows && !windows.mainWindow.isDestroyed()) options.onNativeThemeUpdated?.();
  });
}
