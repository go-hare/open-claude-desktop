import { app, Menu, screen, shell } from "electron";
import type { IpcHandlerContext } from "./context";
import { dispatchBridgeEvent, registerNamespaceHandlers } from "./registerIpc";
import { dispatchQuickEntrySubmitPayload } from "./settingsHandlers";
import { isClaudeCurrentlyHealthyResidual } from "../services/health/claudeHealthcheck";
import { setUserThemeMode } from "../services/settings/userThemeMode";
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
      /**
       * Official app.asar residual `mnr` (WindowControl.resize) — exact math:
       *   n = e.getBounds()
       *   o = { width:t, height:i, x:n.x, y:n.y }
       *   if n.width>0 && n.height>0:
       *     o.x = n.x + floor((n.width-t)/2)
       *     o.y = n.y + floor((n.height-i)/2)
       *   if r?.center:
       *     display = getDisplayMatching(n) || getPrimaryDisplay()
       *     {workAreaSize:a} = display
       *     o.x = max(0, floor((a.width-t)/2))
       *     o.y = max(0, floor((a.height-i)/2))
       *   e.setBounds(o, true); e.show()
       *
       * Official LoginRoute jn: resize(600,600,{center:true}) usually runs after
       * process relaunch while main window still opacity:0 (createMainWindow), so
       * animated setBounds is invisible. Product soft SPA → /login keeps opacity 1;
       * Electron/macOS animated setBounds then paints a corner-shrink (window origin
       * path) before landing centered — looks like "从左上角缩到小窗口".
       * For center:true while window is already opaque/visible, apply final bounds
       * without animate so the chooser appears centered in one frame (same end
       * geometry as official mnr).
       */
      resize: async (_event, width, height, opts) => {
        if (typeof width !== "number" || typeof height !== "number") return true;
        if (mainWindow.isDestroyed()) return true;
        const w = Math.round(width);
        const h = Math.round(height);
        const current = mainWindow.getBounds();
        const next = { width: w, height: h, x: current.x, y: current.y };
        if (current.width > 0 && current.height > 0) {
          next.x = current.x + Math.floor((current.width - w) / 2);
          next.y = current.y + Math.floor((current.height - h) / 2);
        }
        const center =
          typeof opts === "object" && opts !== null && (opts as { center?: boolean }).center === true;
        if (center) {
          const display =
            screen.getDisplayMatching(current.width > 0 ? current : { x: 0, y: 0, width: 0, height: 0 })
            || screen.getPrimaryDisplay();
          if (display) {
            // Official mnr residual uses workAreaSize only (assumes primary origin 0,0).
            // Product: center within workArea (taskbar / multi-monitor safe) so LoginRoute
            // jn resize(600,600,{center:true}) does not land at global (0,0) top-left.
            const { workArea } = display;
            next.x = Math.round(workArea.x + Math.max(0, (workArea.width - w) / 2));
            next.y = Math.round(workArea.y + Math.max(0, (workArea.height - h) / 2));
          }
        }
        // Official mnr: setBounds(o, true) while createMainWindow still opacity:0 after
        // process relaunch — animation is invisible. Soft SPA is already opaque;
        // animate:true paints shrink/grow frames ("闪"), and setOpacity(0) blinks
        // the whole window. Always animate:false when the window is already opaque.
        const opaqueVisible =
          mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.getOpacity() > 0.01;
        mainWindow.setBounds(next, !opaqueVisible);
        if (!mainWindow.isVisible()) mainWindow.show();
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
      /**
       * Official residual: nativeTheme.themeSource = mode; Yi.set("userThemeMode", mode).
       */
      setThemeMode: async (_event, mode) => setUserThemeMode(mode),
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
      /**
       * Official residual: destroyed → false; else (await ocr()) === "healthy".
       * ocr = net.fetch(app://localhost/healthcheck) → status.
       */
      isClaudeCurrentlyHealthy: async () => {
        if (mainWindow.isDestroyed() || mainView.webContents.isDestroyed()) {
          return false;
        }
        return isClaudeCurrentlyHealthyResidual();
      },
    },
    AboutWindow: {
      getAppName: async () => app.getName(),
      /**
       * Residual aboutWindow AboutWindow.getBuildProps / id() shape:
       *   { buildType, commitHash, commitTimestamp, isNestBuild, appVersion }
       * Renderer shows: `${process.version} (${commitHash.slice(0,6)})`
       */
      getBuildProps: async () => ({
        buildType: app.isPackaged ? "prod" : "dev",
        commitHash: process.env.CLAUDEX_COMMIT_HASH || "unknown",
        commitTimestamp: process.env.CLAUDEX_COMMIT_TIMESTAMP || "",
        isNestBuild: false,
        appVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
      }),
      getSupport: async () => ({}),
      openHelp: async () => {
        await shell.openExternal("https://support.anthropic.com/");
        return true;
      },
    },
    QuickWindow: {
      /**
       * Official quick-window.html residual (main-oBdKGVdT):
       *   Enter → QuickWindow.requestDismiss(promptInput.value)  // raw string
       *   Escape / outside click → requestDismiss(null)
       * Native / richer path uses requestDismissWithPayload({text,images,chatId}).
       * Product: string arg → IKA submit; null/empty → dismiss only.
       */
      requestDismiss: async (_event, payload) => {
        secondaryWindows.closeQuickWindow();
        if (typeof payload === "string") {
          const text = payload.trim();
          // Official IKA: text.trim().length > 2 required (else mst no-op).
          if (text.length > 2) {
            dispatchQuickEntrySubmitPayload(context, { text: payload, images: [] });
          }
          return true;
        }
        if (payload && typeof payload === "object") {
          dispatchQuickEntrySubmitPayload(context, payload);
        }
        return true;
      },
      /**
       * Official IKA residual (Sst.requestQuickWindowDismissWithPayload):
       * process payload → FSe/svi dispatchOnQuickEntrySubmit + show main.
       * Must not dispatch-only: on Windows the quick panel was focused, so
       * without show/focus the session starts in a hidden main view.
       */
      requestDismissWithPayload: async (_event, payload) => {
        secondaryWindows.closeQuickWindow();
        dispatchQuickEntrySubmitPayload(context, payload);
        return true;
      },
      /**
       * Official quick-window residual (main-oBdKGVdT):
       *   input debounce 750ms → requestSkooch(container.scrollWidth, scrollHeight)
       * Resizes the *already-open* panel to content — must NOT call activateQuickEntry.
       * Calling open/activate here re-shows the pill after Enter (user screenshot).
       */
      requestSkooch: async (_event, width, height) => {
        const quick = secondaryWindows.getWindow("quick");
        if (!quick || quick.isDestroyed() || !quick.isVisible()) {
          // Panel gone / already dismissed — ignore late debounce after Enter.
          return false;
        }
        const w = typeof width === "number" ? width : Number(width);
        const h = typeof height === "number" ? height : Number(height);
        const bounds = quick.getBounds();
        // Content size from renderer; clamp so multi-line grows without runaway.
        const nextW =
          Number.isFinite(w) && w > 0
            ? Math.min(Math.max(Math.ceil(w), 320), 900)
            : bounds.width;
        const nextH =
          Number.isFinite(h) && h > 0
            ? Math.min(Math.max(Math.ceil(h), 80), 700)
            : bounds.height;
        if (nextW !== bounds.width || nextH !== bounds.height) {
          quick.setBounds({
            x: bounds.x,
            y: bounds.y,
            width: nextW,
            height: nextH,
          });
        }
        return true;
      },
    },
  });

  const reportNavigationChange = () => emitNavigationState(context);
  mainView.webContents.on("did-navigate", reportNavigationChange);
  mainView.webContents.on("did-navigate-in-page", reportNavigationChange);
  mainView.webContents.on("did-finish-load", reportNavigationChange);
}
