import type { BrowserWindow, WebContentsView } from "electron";
import { createFindInPageView } from "./createFindInPageView";
import { createMainView } from "./createMainView";
import { createMainWindow, updateOriginalTrafficLightPosition } from "./createMainWindow";
import { layoutDesktopViews } from "./layoutChildViews";
import { installNavigationGuards } from "./navigationPolicy";
import { normalizeSidebarMode, resolveInitialMainViewUrl } from "./routeMode";
import { createSecondaryWindowManager } from "./secondaryWindows";
import type { DesktopWindowOptions, DesktopWindowParts } from "./types";

function safeWindowAction(mainWindow: BrowserWindow, action: () => void): void {
  if (!mainWindow.isDestroyed()) action();
}

function focusMainView(mainView: WebContentsView, options: DesktopWindowOptions): void {
  mainView.webContents.focus();
  options.onMainViewFocus?.(mainView);
}

function syncTrafficLightPosition(mainWindow: BrowserWindow, mainView: WebContentsView): void {
  updateOriginalTrafficLightPosition(mainWindow, mainView.webContents.getZoomFactor());
}

function installCloseBehavior(mainWindow: BrowserWindow, options: DesktopWindowOptions): void {
  mainWindow.on("close", (event) => {
    if (options.shouldQuitOnClose?.()) return;

    event.preventDefault();
    const hide = () => mainWindow.hide();
    if (mainWindow.isFullScreen()) {
      mainWindow.once("leave-full-screen", hide);
      mainWindow.setFullScreen(false);
      return;
    }
    hide();
  });
}

function installMainWindowEvents(
  mainWindow: BrowserWindow,
  mainView: WebContentsView,
  findInPageView: WebContentsView,
  options: DesktopWindowOptions,
): void {
  const layout = () => layoutDesktopViews(mainWindow, mainView, findInPageView);

  mainWindow.webContents.on("did-finish-load", () => {
    setTimeout(() => {
      safeWindowAction(mainWindow, () => {
        mainWindow.setOpacity(1);
        syncTrafficLightPosition(mainWindow, mainView);
        layout();
        options.onMainWindowReady?.(mainWindow);
      });
    }, 50);
  });

  mainWindow.on("resize", layout);
  mainWindow.on("show", layout);
  mainWindow.on("focus", () => focusMainView(mainView, options));
  mainView.webContents.on("zoom-changed", () => syncTrafficLightPosition(mainWindow, mainView));
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.meta && input.key.toLowerCase() === "r") {
      mainView.webContents.reload();
      event.preventDefault();
    }
  });

  installCloseBehavior(mainWindow, options);
}

export function createDesktopWindow(options: DesktopWindowOptions): DesktopWindowParts {
  const mainWindow = createMainWindow(options);
  const mainView = createMainView(options);
  const findInPageView = createFindInPageView(options);
  const secondaryWindows = createSecondaryWindowManager(mainWindow, options.paths);

  mainWindow.contentView.addChildView(mainView);
  mainWindow.contentView.addChildView(findInPageView);

  const layout = () => layoutDesktopViews(mainWindow, mainView, findInPageView);
  layout();
  syncTrafficLightPosition(mainWindow, mainView);
  focusMainView(mainView, options);

  mainView.webContents.on("dom-ready", () => {
    syncTrafficLightPosition(mainWindow, mainView);
    options.onMainViewDomReady?.(mainView);
  });
  installNavigationGuards(mainView.webContents, mainWindow);
  installMainWindowEvents(mainWindow, mainView, findInPageView, options);

  return {
    mainWindow,
    mainView,
    findInPageView,
    secondaryWindows,
    layout,
    async loadAll() {
      await mainWindow.loadFile(options.paths.mainWindowHtml);
      const mode = normalizeSidebarMode(options.sidebarMode);
      await mainView.webContents.loadURL(options.initialMainViewUrl ?? resolveInitialMainViewUrl(options.baseUrl, mode, options.hasRendererConfig));
      await findInPageView.webContents.loadFile(options.paths.findInPageHtml);
    },
  };
}
