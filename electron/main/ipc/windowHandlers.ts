import { app, Menu, shell } from "electron";
import type { IpcHandlerContext } from "./context";
import { dispatchBridgeEvent, registerNamespaceHandlers } from "./registerIpc";
import { setOriginalIncognitoTitleBarMode } from "../windows/createMainWindow";
import { activateQuickEntry } from "./settingsHandlers";

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

function popupMainMenu(context: IpcHandlerContext): void {
  const { mainWindow, mainView, secondaryWindows } = context.windows;
  const menu = Menu.buildFromTemplate([
    {
      label: "Claude-Deepseek",
      submenu: [
        { label: "About", click: () => void secondaryWindows.openAboutWindow() },
        { type: "separator" },
        { label: "Quick Entry", accelerator: "CommandOrControl+K", click: () => void activateQuickEntry(context) },
        { label: "Buddy", click: () => void secondaryWindows.openBuddyWindow() },
        { type: "separator" },
        { label: "Reload Main View", accelerator: "CommandOrControl+R", click: () => mainView.webContents.reload() },
        { label: "Toggle Developer Tools", accelerator: "Alt+CommandOrControl+I", click: () => mainView.webContents.toggleDevTools() },
        { type: "separator" },
        { label: "Quit", role: "quit" },
      ],
    },
  ]);
  menu.popup({ window: mainWindow });
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
