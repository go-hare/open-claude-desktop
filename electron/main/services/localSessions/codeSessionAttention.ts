/**
 * Official NotificationService.requestUserAttention residual (app.asar class fir):
 *   requestUserAttention(){
 *     if (this.isAppFocusedAndVisible()) return;
 *     if (!gi("dockBounceEnabled")) return;
 *     process.platform === "darwin"
 *       ? app.dock.bounce("critical")
 *       : mainWindow.flashFrame(true)
 *   }
 *   stopFlashFrame(){ cancelBounce / flashFrame(false) }
 *
 * Called when tool_permission_request / ask-user notifications fire and the
 * app is not focused. Product wires this for Code LocalSessions + optional
 * Cowork notification path.
 */

import { app, BrowserWindow, type BrowserWindow as ElectronBrowserWindow } from "electron";

export type CodeSessionAttentionDeps = {
  getMainWindow: () => ElectronBrowserWindow | null | undefined;
  /** Official gi("dockBounceEnabled") — must be true to flash/bounce. */
  isDockBounceEnabled: () => boolean;
};

export class CodeSessionAttentionService {
  private dockBounceId = -1;
  private readonly deps: CodeSessionAttentionDeps;

  constructor(deps: CodeSessionAttentionDeps) {
    this.deps = deps;
  }

  isAppFocusedAndVisible(): boolean {
    try {
      if (!app.isReady()) return false;
      const focused = BrowserWindow.getFocusedWindow();
      if (!focused || focused.isDestroyed()) return false;
      if (focused.isMinimized()) return false;
      return focused.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Official requestUserAttention residual — no-op when focused or pref off.
   */
  requestUserAttention(): void {
    if (this.isAppFocusedAndVisible()) return;
    if (!this.deps.isDockBounceEnabled()) return;
    try {
      if (process.platform === "darwin") {
        const dock = (app as unknown as { dock?: { bounce?: (type: string) => number } }).dock;
        const id = dock?.bounce?.("critical");
        this.dockBounceId = typeof id === "number" ? id : -1;
        return;
      }
      const main = this.deps.getMainWindow();
      if (main && !main.isDestroyed()) {
        main.flashFrame(true);
      }
    } catch {
      /* best-effort attention only */
    }
  }

  /** Official stopFlashFrame residual. */
  stopFlashFrame(): void {
    try {
      if (process.platform === "darwin") {
        if (this.dockBounceId >= 0) {
          const dock = (app as unknown as {
            dock?: { cancelBounce?: (id: number) => void };
          }).dock;
          dock?.cancelBounce?.(this.dockBounceId);
          this.dockBounceId = -1;
        }
        return;
      }
      const main = this.deps.getMainWindow();
      if (main && !main.isDestroyed()) {
        main.flashFrame(false);
      }
    } catch {
      /* ignore */
    }
  }
}
