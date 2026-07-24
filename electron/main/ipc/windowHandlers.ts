import { app, Menu, shell } from "electron";
import type { IpcHandlerContext } from "./context";
import { dispatchBridgeEvent, registerNamespaceHandlers } from "./registerIpc";
import { setOriginalIncognitoTitleBarMode } from "../windows/createMainWindow";

function navigationState(context: IpcHandlerContext) {
  const { mainView } = context.windows;
  const history = mainView.webContents.navigationHistory;
  return {
    url: mainView.webContents.getURL(),
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
  };
}

function emitNavigationState(context: IpcHandlerContext): void {
  const { mainView } = context.windows;
  dispatchBridgeEvent(mainView.webContents, "claude.web", "BrowserNavigation", "navigationState_$store$_update", navigationState(context));
}

/**
 * Windows topbar hamburger (official ion-dist `tVt` → BrowserNavigation.requestMainMenuPopup).
 * Official app pops the full application menu under the menu button — not a stub About/Quit menu.
 * Topbar layout (cbc59a8af `Yn`): h-[36px] flex items-center gap-1 px-3; first control is Menu.
 */
function popupMainMenu(context: IpcHandlerContext): void {
  const { mainWindow } = context.windows;
  if (mainWindow.isDestroyed()) return;

  const menu = Menu.getApplicationMenu();
  if (!menu) return;

  // Anchor under the Windows chrome hamburger (px-3 → 12, bar height 36).
  menu.popup({
    window: mainWindow,
    x: 12,
    y: 36,
  });
}

export function registerWindowHandlers(context: IpcHandlerContext): void {
  const { mainWindow, mainView, secondaryWindows } = context.windows;

  registerNamespaceHandlers("claude.web", {
    WindowControl: {
      resize: async (_event, width, height) => {
        if (typeof width === "number" && typeof height === "number") mainWindow.setSize(width, height);
        return true;
      },
      focus: async () => {
        mainWindow.focus();
        mainView.webContents.focus();
        return true;
      },
      close: async () => {
        mainWindow.close();
        return true;
      },
      captureScreenshot: async () => (await mainWindow.capturePage()).toDataURL(),
      setIncognitoMode: async (_event, enabled) => {
        setOriginalIncognitoTitleBarMode(Boolean(enabled));
        return true;
      },
      setThemeMode: async () => true,
    },
    WindowState: {
      getFullscreen: async () => mainWindow.isFullScreen(),
      getVisibility: async () => mainWindow.isVisible(),
      getZoomFactor: async () => mainView.webContents.getZoomFactor(),
    },
    BrowserNavigation: {
      goBack: async () => {
        if (mainView.webContents.navigationHistory.canGoBack()) mainView.webContents.navigationHistory.goBack();
        setTimeout(() => emitNavigationState(context), 0);
        return true;
      },
      goForward: async () => {
        if (mainView.webContents.navigationHistory.canGoForward()) mainView.webContents.navigationHistory.goForward();
        setTimeout(() => emitNavigationState(context), 0);
        return true;
      },
      reportNavigationState: async () => navigationState(context),
      requestMainMenuPopup: async () => {
        popupMainMenu(context);
        return true;
      },
    },
  });

  registerNamespaceHandlers("claude.internal.ui", {
    MainWindowTitleBar: {
      titleBarReady: async () => {
        setOriginalIncognitoTitleBarMode(false);
        return true;
      },
      requestReloadMainView: async () => {
        mainView.webContents.reload();
        return true;
      },
      requestMainMenuPopup: async () => {
        popupMainMenu(context);
        return true;
      },
      isClaudeCurrentlyHealthy: async () => true,
    },
    AboutWindow: {
      getAppName: async () => app.getName(),
      getBuildProps: async () => ({ appVersion: app.getVersion(), platform: process.platform, arch: process.arch }),
      getSupport: async () => ({}),
      openHelp: async () => {
        await shell.openExternal("https://support.anthropic.com/");
        return true;
      },
    },
    QuickWindow: {
      requestDismiss: async () => {
        secondaryWindows.closeQuickWindow();
        return true;
      },
      requestDismissWithPayload: async (_event, payload) => {
        dispatchBridgeEvent(mainView.webContents, "claude.web", "QuickEntry", "onQuickEntrySubmit", payload);
        secondaryWindows.closeQuickWindow();
        return true;
      },
      requestSkooch: async () => {
        // Official yst residual: native H9i (Swift QuickScreenshotView share strip)
        // then Electron quick panel fallback — not openQuickWindow alone.
        await activateQuickEntry(context);
        return true;
      },
    },
  });

  const reportNavigationChange = () => emitNavigationState(context);
  mainView.webContents.on("did-navigate", reportNavigationChange);
  mainView.webContents.on("did-navigate-in-page", reportNavigationChange);
  mainView.webContents.on("did-finish-load", reportNavigationChange);
}
