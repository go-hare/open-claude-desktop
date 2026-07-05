import { app, Menu, shell } from "electron";
import type { IpcHandlerContext } from "./context";
import { dispatchBridgeEvent, registerNamespaceHandlers } from "./registerIpc";

function popupMainMenu(context: IpcHandlerContext): void {
  const { mainWindow, mainView, secondaryWindows } = context.windows;
  const menu = Menu.buildFromTemplate([
    {
      label: "Claude-Deepseek",
      submenu: [
        { label: "About", click: () => void secondaryWindows.openAboutWindow() },
        { type: "separator" },
        { label: "Quick Entry", accelerator: "CommandOrControl+K", click: () => void secondaryWindows.openQuickWindow() },
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
      setIncognitoMode: async () => true,
      setThemeMode: async () => true,
    },
    WindowState: {
      getFullscreen: async () => mainWindow.isFullScreen(),
      getVisibility: async () => mainWindow.isVisible(),
      getZoomFactor: async () => mainView.webContents.getZoomFactor(),
      fullscreenChanged: async () => mainWindow.isFullScreen(),
      visibilityChanged: async () => mainWindow.isVisible(),
      zoomFactorChanged: async () => mainView.webContents.getZoomFactor(),
      cuDockStateChanged: async () => null,
    },
    BrowserNavigation: {
      goBack: async () => {
        if (mainView.webContents.navigationHistory.canGoBack()) mainView.webContents.navigationHistory.goBack();
        return true;
      },
      goForward: async () => {
        if (mainView.webContents.navigationHistory.canGoForward()) mainView.webContents.navigationHistory.goForward();
        return true;
      },
      reportNavigationState: async () => ({ url: mainView.webContents.getURL() }),
      requestMainMenuPopup: async () => {
        popupMainMenu(context);
        return true;
      },
      navigationState_: async () => ({ url: mainView.webContents.getURL() }),
    },
  });

  registerNamespaceHandlers("claude.internal.ui", {
    MainWindowTitleBar: {
      titleBarReady: async () => true,
      updateTitleBar: async () => true,
      requestReloadMainView: async () => {
        mainView.webContents.reload();
        return true;
      },
      requestMainMenuPopup: async () => {
        popupMainMenu(context);
        return true;
      },
      isClaudeCurrentlyHealthy: async () => true,
      showLoadError: async () => true,
      hideLoadError: async () => true,
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
        await secondaryWindows.openQuickWindow();
        return true;
      },
    },
  });
}
