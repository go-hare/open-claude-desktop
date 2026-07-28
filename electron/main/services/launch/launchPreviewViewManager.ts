/**
 * Official Launch Preview WebContentsView residual (app.asar class w5e / showPreview):
 *
 *   new WebContentsView({ webPreferences: { session: AOi(workspaceKey, persist),
 *     nodeIntegration: false, contextIsolation: true, sandbox: true, plugins: true }})
 *   showPreview(serverId, bounds):
 *     zoom = mainView.getZoomFactor()
 *     scale bounds → setBounds(IOi(c)) → setVisible(true)
 *     first show: mainWindow.contentView.addChildView(view)
 *   hidePreview: setVisible(false); optional removeChildView
 *   localhost-only navigation (isAllowedUrl)
 *
 *   setPreviewViewport / clearPreviewViewport / setPreviewColorScheme / toggleSelectionMode
 *   → CDPTools (zFi) via LaunchPreviewCdp; elementSelected via DMA callback.
 *
 * Product: attaches over mainWindow contentView; partition from launchPreviewPersist.
 */

import { WebContentsView, type BrowserWindow, type WebContentsView as ElectronWebContentsView } from "electron";
import {
  getLaunchPreviewSession,
  hashLaunchPreviewWorkspace,
  launchPreviewPartitionName,
  recordLaunchPreviewPersistedWorkspace,
  type LaunchPreviewPersistStore,
} from "./launchPreviewPersist";
import {
  LaunchPreviewCdp,
  type PreviewElementContext,
} from "./launchPreviewCdp";

export type PreviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PreviewContext = {
  serverId: string;
  port: number;
  url: string;
  view: ElectronWebContentsView;
  isVisible: boolean;
  workspaceKey?: string;
  persist: boolean;
  cwd?: string;
  /** Official lastColorScheme residual. */
  lastColorScheme: "light" | "dark" | null;
  /** Official emulatedViewport residual. */
  emulatedViewport: { width: number; height: number; mobile?: boolean } | null;
  cdp: LaunchPreviewCdp;
  selectionEnabled: boolean;
};

export type LaunchPreviewViewManagerDeps = {
  getMainWindow: () => BrowserWindow | null | undefined;
  /** Official ka residual — main webContents for zoom factor. */
  getMainWebContents?: () => Electron.WebContents | null | undefined;
  isPersistEnabled?: () => boolean;
  persistStore?: LaunchPreviewPersistStore | null;
  /**
   * Official DMA residual — dispatch Launch.elementSelected(serverId, context).
   */
  onElementSelected?: (serverId: string, context: PreviewElementContext) => void;
  log?: (...args: unknown[]) => void;
};

/**
 * Official p5e residual — preview view background for color scheme.
 * dark → #131312; staticHtml light → #ffffff; else #f5f5f5.
 */
function previewBackgroundColor(
  scheme: "light" | "dark" | null,
  staticHtml = false,
): string {
  if (scheme === "dark") return "#131312";
  if (staticHtml) return "#ffffff";
  return "#f5f5f5";
}

function clampBounds(
  bounds: PreviewBounds,
  contentSize: [number, number] | null,
): PreviewBounds {
  if (!contentSize) return bounds;
  const [cw, ch] = contentSize;
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.min(bounds.width, Math.max(0, cw - bounds.x)),
    height: Math.min(bounds.height, Math.max(0, ch - bounds.y)),
  };
}

function isLocalhostHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

export class LaunchPreviewViewManager {
  private readonly contexts = new Map<string, PreviewContext>();
  private readonly deps: LaunchPreviewViewManagerDeps;

  constructor(deps: LaunchPreviewViewManagerDeps) {
    this.deps = deps;
  }

  /**
   * Official D5e + w5e residual — create context for serverId/port.
   */
  ensureContext(input: {
    serverId: string;
    port: number;
    cwd?: string;
    initialUrl?: string;
  }): PreviewContext | null {
    const existing = this.contexts.get(input.serverId);
    if (existing) return existing;
    if (!(input.port >= 1 && input.port <= 65535 && Number.isInteger(input.port))) {
      this.deps.log?.("[Preview] Invalid port", input);
      return null;
    }
    const persist = this.deps.isPersistEnabled?.() === true;
    const workspaceKey = input.cwd ? hashLaunchPreviewWorkspace(input.cwd) : undefined;
    const session = getLaunchPreviewSession(workspaceKey, persist);
    if (persist && workspaceKey && this.deps.persistStore) {
      recordLaunchPreviewPersistedWorkspace(workspaceKey, this.deps.persistStore);
    }
    const url = input.initialUrl ?? `http://127.0.0.1:${input.port}`;
    let view: ElectronWebContentsView;
    try {
      view = new WebContentsView({
        webPreferences: {
          session,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          plugins: true,
        },
      });
    } catch (error) {
      this.deps.log?.("[Preview] WebContentsView create failed", error);
      return null;
    }
    try {
      view.setBackgroundColor("#ffffff");
      view.setVisible(false);
    } catch {
      /* best-effort */
    }
    const ctx: PreviewContext = {
      serverId: input.serverId,
      port: input.port,
      url,
      view,
      isVisible: false,
      workspaceKey,
      persist,
      cwd: input.cwd,
      lastColorScheme: null,
      emulatedViewport: null,
      cdp: new LaunchPreviewCdp(),
      selectionEnabled: false,
    };
    this.setupNavigationGuards(ctx);
    this.contexts.set(input.serverId, ctx);
    this.deps.log?.("[Preview] Created context", {
      serverId: input.serverId,
      port: input.port,
      partition: launchPreviewPartitionName(workspaceKey, persist),
      totalContexts: this.contexts.size,
    });
    return ctx;
  }

  private setupNavigationGuards(ctx: PreviewContext): void {
    const { webContents } = ctx.view;
    if (!webContents || webContents.isDestroyed()) return;
    const allowed = (url: string): boolean => {
      try {
        const u = new URL(url);
        return isLocalhostHost(u.hostname) && u.port === `${ctx.port}`;
      } catch {
        return false;
      }
    };
    try {
      webContents.setWindowOpenHandler(({ url }) => {
        if (allowed(url)) {
          void webContents.loadURL(url).catch(() => undefined);
        }
        return { action: "deny" };
      });
      webContents.on("will-navigate", (event, url) => {
        if (!allowed(url)) event.preventDefault();
      });
    } catch {
      /* best-effort */
    }
  }

  connect(serverId: string): boolean {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    const wc = ctx.view.webContents;
    if (!wc || wc.isDestroyed()) return false;
    void wc.loadURL(ctx.url).catch(() => undefined);
    return true;
  }

  /**
   * Official showPreview(serverId, bounds) residual.
   */
  showPreview(serverId: string, bounds: PreviewBounds): boolean {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return false;

    const zoom =
      (() => {
        try {
          const wc = this.deps.getMainWebContents?.();
          if (wc && !wc.isDestroyed()) return wc.getZoomFactor();
        } catch {
          /* ignore */
        }
        return 1;
      })() || 1;

    const x0 = Math.ceil(bounds.x * zoom);
    const y0 = Math.ceil(bounds.y * zoom);
    const x1 = Math.floor((bounds.x + bounds.width) * zoom);
    const y1 = Math.floor((bounds.y + bounds.height) * zoom);
    let scaled: PreviewBounds = {
      x: x0,
      y: y0,
      width: Math.max(0, x1 - x0),
      height: Math.max(0, y1 - y0),
    };

    try {
      const contentSize = mainWindow.getContentSize?.() as [number, number] | undefined;
      scaled = clampBounds(scaled, contentSize ?? null);
    } catch {
      /* ignore */
    }

    const firstShow = !ctx.isVisible;
    try {
      if (firstShow) {
        mainWindow.contentView.addChildView(ctx.view);
        ctx.isVisible = true;
        this.connect(serverId);
      }
      ctx.view.setBounds(scaled);
      ctx.view.setVisible(true);
    } catch (error) {
      this.deps.log?.("[Preview] showPreview failed", error);
      return false;
    }
    return true;
  }

  hidePreview(serverId?: string): boolean {
    const ids = serverId ? [serverId] : [...this.contexts.keys()];
    let ok = false;
    for (const id of ids) {
      const ctx = this.contexts.get(id);
      if (!ctx) continue;
      try {
        ctx.view.setVisible(false);
        const mainWindow = this.deps.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed() && ctx.isVisible) {
          try {
            mainWindow.contentView.removeChildView(ctx.view);
          } catch {
            /* older electron may lack removeChildView */
          }
        }
        ctx.isVisible = false;
        ok = true;
      } catch {
        /* best-effort */
      }
    }
    return ok;
  }

  destroy(serverId: string): boolean {
    this.hidePreview(serverId);
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    try {
      if (ctx.selectionEnabled) {
        void ctx.cdp.disableInspectMode().catch(() => undefined);
      }
      ctx.cdp.detach();
    } catch {
      /* ignore */
    }
    try {
      if (!ctx.view.webContents.isDestroyed()) {
        ctx.view.webContents.close();
      }
    } catch {
      /* ignore */
    }
    this.contexts.delete(serverId);
    return true;
  }

  private async ensureCdp(ctx: PreviewContext): Promise<LaunchPreviewCdp> {
    const wc = ctx.view.webContents;
    if (!wc || wc.isDestroyed()) {
      throw new Error("Preview webContents destroyed");
    }
    await ctx.cdp.attach(wc);
    return ctx.cdp;
  }

  /**
   * Official _5e / setPreviewViewport residual:
   *   emulatedViewport = {width,height,mobile}; CDP setViewport; re-apply last bounds.
   */
  async setPreviewViewport(
    serverId: string,
    width: number,
    height: number,
    mobile?: boolean,
  ): Promise<boolean> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    try {
      ctx.emulatedViewport = { width, height, mobile };
      const cdp = await this.ensureCdp(ctx);
      await cdp.setViewport(width, height, mobile);
      return true;
    } catch (error) {
      this.deps.log?.("[Preview] setPreviewViewport failed", { serverId, error });
      return false;
    }
  }

  /**
   * Official M5e / clearPreviewViewport residual — clear device metrics override.
   */
  async clearPreviewViewport(serverId: string): Promise<boolean> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    try {
      ctx.emulatedViewport = null;
      const cdp = await this.ensureCdp(ctx);
      await cdp.clearViewport();
      return true;
    } catch (error) {
      this.deps.log?.("[Preview] clearPreviewViewport failed", { serverId, error });
      return false;
    }
  }

  /**
   * Official N5e / setPreviewColorScheme residual:
   *   lastColorScheme + view background + Emulation.setEmulatedMedia.
   */
  async setPreviewColorScheme(
    serverId: string,
    scheme: string,
  ): Promise<boolean> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    const normalized = scheme === "dark" ? "dark" : scheme === "light" ? "light" : null;
    if (!normalized) return false;
    try {
      ctx.lastColorScheme = normalized;
      try {
        ctx.view.setBackgroundColor(previewBackgroundColor(normalized, false));
      } catch {
        /* ignore */
      }
      const cdp = await this.ensureCdp(ctx);
      await cdp.setColorScheme(normalized);
      return true;
    } catch (error) {
      this.deps.log?.("[Preview] setPreviewColorScheme failed", { serverId, error });
      return false;
    }
  }

  /**
   * Official TOi / toggleSelectionMode residual:
   *   enable → Overlay.setInspectMode; on inspectNodeRequested captureElementContext
   *   → DMA(elementSelected); re-enable inspect mode (one-shot re-arm).
   *   disable → disableInspectMode.
   */
  async toggleSelectionMode(
    serverId: string,
    enabled: boolean,
  ): Promise<boolean> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    try {
      const cdp = await this.ensureCdp(ctx);
      if (enabled) {
        let busy = false;
        const onNode = async (backendNodeId: number) => {
          if (busy) return;
          busy = true;
          try {
            const context = await cdp.captureElementContext(backendNodeId);
            if (context) {
              this.deps.onElementSelected?.(serverId, context);
            }
          } finally {
            busy = false;
            try {
              await cdp.enableInspectMode(onNode);
            } catch {
              /* re-arm best-effort */
            }
          }
        };
        await cdp.enableInspectMode(onNode);
        ctx.selectionEnabled = true;
      } else {
        await cdp.disableInspectMode();
        ctx.selectionEnabled = false;
      }
      return true;
    } catch (error) {
      this.deps.log?.("[Preview] toggleSelectionMode failed", {
        serverId,
        enabled,
        error,
      });
      return false;
    }
  }

  navigate(serverId: string, url: string): boolean {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    try {
      const u = new URL(url);
      if (!isLocalhostHost(u.hostname)) return false;
      ctx.url = url;
      void ctx.view.webContents.loadURL(url).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  refresh(serverId: string): boolean {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    try {
      ctx.view.webContents.reload();
      return true;
    } catch {
      return false;
    }
  }

  goBack(serverId: string): boolean {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    try {
      if (ctx.view.webContents.canGoBack()) {
        ctx.view.webContents.goBack();
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  goForward(serverId: string): boolean {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    try {
      if (ctx.view.webContents.canGoForward()) {
        ctx.view.webContents.goForward();
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  /**
   * Official QOi / capturePreviewScreenshot residual:
   *   {cdp, isVisible} → visible ? takeScreenshot() : takeScreenshotViaCDP()
   * Returns raw base64 (no data: URL prefix) — FE prefixes `data:image/png;base64,`.
   */
  async capturePreviewScreenshot(serverId: string): Promise<string | null> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return null;
    const wc = ctx.view.webContents;
    if (!wc || wc.isDestroyed()) return null;
    try {
      const cdp = await this.ensureCdp(ctx);
      const data = ctx.isVisible
        ? await cdp.takeScreenshot()
        : await cdp.takeScreenshotViaCDP();
      return data && data.length > 0 ? data : null;
    } catch (error) {
      this.deps.log?.("[Preview] capturePreviewScreenshot failed", { serverId, error });
      return null;
    }
  }

  /**
   * Official uOi residual — JPEG compressed screenshot for preview_screenshot MCP.
   */
  async capturePreviewScreenshotCompressed(
    serverId: string,
  ): Promise<string | null> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return null;
    const wc = ctx.view.webContents;
    if (!wc || wc.isDestroyed()) return null;
    try {
      const cdp = await this.ensureCdp(ctx);
      const data = ctx.isVisible
        ? await cdp.takeScreenshotCompressed()
        : await cdp.takeScreenshotViaCDPCompressed();
      return data && data.length > 0 ? data : null;
    } catch (error) {
      this.deps.log?.("[Preview] capturePreviewScreenshotCompressed failed", {
        serverId,
        error,
      });
      return null;
    }
  }

  /** Official BOi residual. */
  getConsoleLogs(
    serverId: string,
    level?: "all" | "error" | "warn",
  ): import("./launchPreviewCdp").PreviewConsoleLog[] {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return [];
    return ctx.cdp.getConsoleLogs(level);
  }

  /** Official wOi residual. */
  getNetworkEntries(
    serverId: string,
    filter?: "all" | "failed",
  ): import("./launchPreviewCdp").PreviewNetworkEntry[] {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return [];
    return ctx.cdp.getNetworkEntries(filter);
  }

  async getResponseBody(
    serverId: string,
    requestId: string,
  ): Promise<{ body: string; base64Encoded: boolean } | null> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return null;
    try {
      const cdp = await this.ensureCdp(ctx);
      return cdp.getResponseBody(requestId);
    } catch {
      return null;
    }
  }

  async inspectElement(
    serverId: string,
    selector: string,
    styles?: string[],
  ): Promise<Record<string, unknown> | null> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return null;
    try {
      const cdp = await this.ensureCdp(ctx);
      return cdp.inspectElement(selector, styles);
    } catch (error) {
      this.deps.log?.("[Preview] inspectElement failed", { serverId, error });
      return null;
    }
  }

  async click(
    serverId: string,
    selector: string,
    options?: { doubleClick?: boolean },
  ): Promise<boolean> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    try {
      const cdp = await this.ensureCdp(ctx);
      return cdp.click(selector, options);
    } catch (error) {
      this.deps.log?.("[Preview] click failed", { serverId, error });
      return false;
    }
  }

  async fill(
    serverId: string,
    selector: string,
    value: string,
  ): Promise<boolean> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return false;
    try {
      const cdp = await this.ensureCdp(ctx);
      return cdp.fill(selector, value);
    } catch (error) {
      this.deps.log?.("[Preview] fill failed", { serverId, error });
      return false;
    }
  }

  async evaluate(serverId: string, expression: string): Promise<unknown> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) throw new Error("Server not found");
    const cdp = await this.ensureCdp(ctx);
    return cdp.evaluate(expression);
  }

  async takeSnapshotText(serverId: string): Promise<string | null> {
    const ctx = this.contexts.get(serverId);
    if (!ctx) return null;
    try {
      const cdp = await this.ensureCdp(ctx);
      return cdp.takeSnapshotText();
    } catch (error) {
      this.deps.log?.("[Preview] takeSnapshotText failed", { serverId, error });
      return null;
    }
  }

  has(serverId: string): boolean {
    return this.contexts.has(serverId);
  }

  /** Test helper. */
  getContextCount(): number {
    return this.contexts.size;
  }
}
