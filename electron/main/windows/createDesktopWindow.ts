import type { BrowserWindow, WebContentsView } from "electron";
import { createFindInPageView } from "./createFindInPageView";
import { createMainView } from "./createMainView";
import { createMainWindow, updateOriginalTrafficLightPosition } from "./createMainWindow";
import { layoutDesktopViews } from "./layoutChildViews";
import { installNavigationGuards } from "./navigationPolicy";
import { normalizeSidebarMode, resolveInitialMainViewUrl } from "./routeMode";
import { createSecondaryWindowManager } from "./secondaryWindows";
import { CoworkArtifactViewManager } from "./coworkArtifactViewManager";
import { CoworkFilePreviewManager } from "./coworkFilePreviewManager";
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
    // Official: quitting → allow close. win32 + !menuBarEnabled → quit (no hide).
    if (options.shouldQuitOnClose?.()) return;
    if (options.shouldQuitWhenTrayDisabled?.()) return;

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
  coworkFilePreview: CoworkFilePreviewManager,
  coworkArtifacts: CoworkArtifactViewManager,
  options: DesktopWindowOptions,
): void {
  const layout = () => {
    layoutDesktopViews(mainWindow, mainView, findInPageView);
    coworkFilePreview.relayout();
    coworkArtifacts.relayout();
  };

  const revealMainWindow = () => {
    safeWindowAction(mainWindow, () => {
      // Boot residual is opacity:0; must become opaque + front after paint.
      // After app.relaunch macOS may leave us backgrounded — always show+focus here.
      try {
        if (mainWindow.getOpacity() < 0.99) mainWindow.setOpacity(1);
      } catch {
        try {
          mainWindow.setOpacity(1);
        } catch {
          /* ignore */
        }
      }
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      try {
        mainWindow.moveTop();
        mainWindow.focus();
      } catch {
        /* ignore */
      }
      syncTrafficLightPosition(mainWindow, mainView);
      layout();
      options.onMainWindowReady?.(mainWindow);
    });
  };

  // Shell HTML finish — official path. Also arm mainView finish so SPA paint
  // still reveals if shell did-finish-load already fired before listeners attach.
  mainWindow.webContents.on("did-finish-load", () => {
    setTimeout(revealMainWindow, 50);
  });
  mainView.webContents.on("did-finish-load", () => {
    setTimeout(revealMainWindow, 50);
  });

  mainWindow.on("resize", layout);
  mainWindow.on("show", layout);
  mainWindow.on("hide", () => {
    coworkFilePreview.suspend();
    coworkArtifacts.suspend();
  });
  mainWindow.on("minimize", () => {
    coworkFilePreview.suspend();
    coworkArtifacts.suspend();
  });
  mainWindow.on("closed", () => {
    coworkFilePreview.destroy();
    coworkArtifacts.destroy();
  });
  mainWindow.on("focus", () => focusMainView(mainView, options));
  mainView.webContents.on("zoom-changed", () => {
    syncTrafficLightPosition(mainWindow, mainView);
    // Official jkA re-applies zoom-scaled bounds when the main view zoom changes.
    coworkFilePreview.relayout();
    coworkArtifacts.relayout();
  });
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
  const zoomFromMainView = () => {
    try {
      return mainView.webContents.isDestroyed() ? 1 : mainView.webContents.getZoomFactor();
    } catch {
      return 1;
    }
  };
  // Official Nnt(Zl, o6): parent window + main-view zoom provider for jkA bounds.
  const coworkFilePreview = new CoworkFilePreviewManager(mainWindow, undefined, zoomFromMainView);
  // Official cXe/YD artifact host view residual (same parent + zoom as file preview).
  const coworkArtifacts = new CoworkArtifactViewManager(mainWindow, undefined, zoomFromMainView);

  mainWindow.contentView.addChildView(mainView);
  mainWindow.contentView.addChildView(findInPageView);

  const layout = () => {
    layoutDesktopViews(mainWindow, mainView, findInPageView);
    coworkFilePreview.relayout();
    coworkArtifacts.relayout();
  };
  layout();
  syncTrafficLightPosition(mainWindow, mainView);
  focusMainView(mainView, options);

  mainView.webContents.on("dom-ready", () => {
    syncTrafficLightPosition(mainWindow, mainView);
    options.onMainViewDomReady?.(mainView);
  });
  // Stream paint diagnosis is debug-only (not residual). Default off — 500ms
  // executeJavaScript on every mainView is product noise and startup cost.
  if (process.env.CLAUDE_DESKTOP_STREAM_DIAG === "1") {
    const streamDiagInterval = setInterval(() => {
      if (mainView.webContents.isDestroyed()) {
        clearInterval(streamDiagInterval);
        return;
      }
      mainView.webContents.executeJavaScript(`
      (() => {
        const d = window.__tileVaDiag;
        if (!d || d.length === 0) return null;
        const first = d[0]?.t ?? 0;
        return { count: d.length, lastChars: d[d.length - 1]?.chars ?? 0, times: d.slice(-8).map(x => Math.round(x.t - first)) };
      })()
    `, true).then((result: unknown) => {
        if (result) console.log("[stream-diag]", JSON.stringify(result));
      }).catch(() => {});
    }, 500);
  }
  installNavigationGuards(mainView.webContents, mainWindow);
  installMainWindowEvents(
    mainWindow,
    mainView,
    findInPageView,
    coworkFilePreview,
    coworkArtifacts,
    options,
  );

  return {
    mainWindow,
    mainView,
    findInPageView,
    secondaryWindows,
    coworkFilePreview,
    coworkArtifacts,
    layout,
    async loadAll() {
      await mainWindow.loadFile(options.paths.mainWindowHtml);
      const mode = normalizeSidebarMode(options.sidebarMode);
      const mainViewUrl =
        options.initialMainViewUrl
        ?? resolveInitialMainViewUrl(options.baseUrl, mode, options.hasRendererConfig);
      // app:// first paint can race protocol.install if activate creates the window
      // during bootstrap awaits. Retry once after a short delay (ERR_FAILED -2).
      await loadMainViewUrlWithRetry(mainView.webContents, mainViewUrl);
      await findInPageView.webContents.loadFile(options.paths.findInPageHtml);
    },
  };
}

function isAppProtocolUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "app:";
  } catch {
    return false;
  }
}

function isTransientAppLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // Electron: Error: ERR_FAILED (-2) loading 'app://localhost'
  return /ERR_FAILED\s*\(-2\)/i.test(message) || /ERR_FAILED/i.test(message);
}

async function loadMainViewUrlWithRetry(
  webContents: import("electron").WebContents,
  url: string,
): Promise<void> {
  try {
    await webContents.loadURL(url);
    return;
  } catch (error) {
    if (!isAppProtocolUrl(url) || !isTransientAppLoadError(error)) throw error;
    console.warn("[mainView] app:// load failed; retrying once", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await webContents.loadURL(url);
  }
}
