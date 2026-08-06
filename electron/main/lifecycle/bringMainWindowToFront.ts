import { app, type BrowserWindow } from "electron";

/**
 * Force the main shell window visible + frontmost.
 *
 * Residual boot uses opacity:0 until first paint (createMainWindow). After
 * `app.relaunch()` macOS often starts the new process without activating it —
 * window exists (CDP/targets live) but stays behind other apps until Dock click.
 * Tray path already did steal-focus + opacity; cold start / activate / second-instance
 * must share the same fronting so Apply→Relaunch does not require a manual Dock tap.
 */
export function bringMainWindowToFront(
  mainWindow: BrowserWindow | null | undefined,
): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  try {
    try {
      app.focus({ steal: true });
    } catch {
      try {
        app.focus();
      } catch {
        /* ignore */
      }
    }
    if (process.platform === "darwin") {
      try {
        if (app.dock && !app.dock.isVisible()) app.dock.show();
      } catch {
        /* ignore dock */
      }
    }
  } catch {
    /* ignore focus residual */
  }

  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
  } catch {
    /* continue opacity/focus */
  }

  try {
    if (typeof mainWindow.getOpacity === "function" && mainWindow.getOpacity() < 0.99) {
      mainWindow.setOpacity(1);
    }
  } catch {
    /* ignore */
  }

  try {
    if (process.platform === "win32") {
      try {
        mainWindow.setAlwaysOnTop(true);
        mainWindow.moveTop();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(false);
      } catch {
        mainWindow.moveTop();
        mainWindow.focus();
      }
    } else {
      mainWindow.moveTop();
      mainWindow.focus();
    }
  } catch {
    try {
      mainWindow.show();
      mainWindow.focus();
    } catch {
      /* ignore */
    }
  }

  return true;
}
