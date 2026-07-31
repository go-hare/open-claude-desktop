/**
 * Residual of official CoworkArtifacts host view (app.asar):
 *   cXe showArtifact / YD hideArtifact / IXe reloadArtifactView /
 *   CXe parkAndCaptureArtifact / gXe bounds (jkA-style zoom) / V2i load URL.
 *
 * Official protocol: cowork-artifact://local/{id}/index.html (or versions/{n}.html).
 * Product residual: serve from resolved host dir (indexHtmlPath parent or
 * ~/Documents/Claude/Artifacts/{id}) without inventing full X2i create/share graph.
 */

import { app, net, session, WebContentsView, type BrowserWindow, type Rectangle } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isOfficialParkedPreviewBounds,
  scalePreviewBoundsWithZoom,
} from "./coworkFilePreviewManager";

/** Official AM scheme. */
export const COWORK_ARTIFACT_SCHEME = "cowork-artifact";
/** Official AKe residual: Documents/Claude/Artifacts. */
export function resolveOfficialArtifactsRoot(
  getDocumentsPath: () => string = () => {
    try {
      return app.getPath("documents");
    } catch {
      return path.join(os.homedir(), "Documents");
    }
  },
): string {
  return path.join(getDocumentsPath(), "Claude", "Artifacts");
}

/** Official wGt parked sentinel (same geometry as file-preview PARKED_BOUNDS). */
export const ARTIFACT_PARKED_BOUNDS: Rectangle = { x: -10_000, y: 0, width: 1, height: 1 };

const ARTIFACT_PARTITION = "persist:cowork-artifact-view";

export type CoworkArtifactDirResolver = (
  artifactId: string,
) => string | null | Promise<string | null>;

export type CoworkArtifactZoomProvider = () => number;

type CssBounds = { x: number; y: number; width: number; height: number };

let protocolInstalled = false;
let activeArtifactBaseDir: string | undefined;

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/**
 * Official j2i residual: register cowork-artifact protocol on the artifact partition.
 * Path shape: /local/{artifactId}/index.html | /local/{artifactId}/versions/{n}.html
 * Product: map artifactId → host baseDir via activeArtifactBaseDir for the shown id only
 * (full multi-id container graph not invented — one active base at a time like show path).
 */
function ensureArtifactProtocolHandler(): void {
  if (protocolInstalled) return;
  const artifactSession = session.fromPartition(ARTIFACT_PARTITION);
  artifactSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  artifactSession.setPermissionCheckHandler(() => false);
  artifactSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`${COWORK_ARTIFACT_SCHEME}://`) });
  });
  artifactSession.protocol.handle(COWORK_ARTIFACT_SCHEME, async (request) => {
    const baseDir = activeArtifactBaseDir;
    if (!baseDir) return notFound();
    const url = new URL(request.url);
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });
    // Official V2i: local/{id}/{entry...}
    if (parts[0] === "local") parts.shift();
    if (parts.length < 1) return notFound();
    // Drop artifact id segment; remainder is relative entry under baseDir.
    parts.shift();
    if (parts.length === 0) return notFound();
    const joined = path.resolve(baseDir, ...parts);
    const relative = path.relative(baseDir, joined);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return notFound();
    }
    try {
      const response = await net.fetch(pathToFileURL(joined).href);
      if (!response.ok) return notFound();
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; object-src 'none'; frame-src 'self'; form-action 'none'; base-uri 'self'",
      );
      return new Response(response.body, { status: 200, headers });
    } catch {
      return notFound();
    }
  });
  protocolInstalled = true;
}

function setActiveArtifactBaseDir(baseDir: string | undefined): void {
  activeArtifactBaseDir = baseDir;
}

/** Official V2i(id, version?) → cowork-artifact://local/{id}/index.html|versions/n.html */
export function buildCoworkArtifactUrl(artifactId: string, version?: number): string {
  const entry =
    version !== undefined && Number.isFinite(version)
      ? `versions/${Math.trunc(version)}.html`
      : "index.html";
  return `${COWORK_ARTIFACT_SCHEME}://local/${encodeURIComponent(artifactId)}/${entry}`;
}

function parseCssBounds(value: unknown): CssBounds | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (![raw.x, raw.y, raw.width, raw.height].every((part) => typeof part === "number" && Number.isFinite(part))) {
    return null;
  }
  return {
    x: raw.x as number,
    y: raw.y as number,
    width: raw.width as number,
    height: raw.height as number,
  };
}

/**
 * Official CoworkArtifacts view host residual (cXe / YD / IXe / CXe / gXe).
 */
export class CoworkArtifactViewManager {
  private view: WebContentsView | null = null;
  private attached = false;
  private shownArtifactId: string | undefined;
  private loadedUrl: string | undefined;
  /** Official eM — last load/reload timestamp returned to FE. */
  private loadToken = 0;
  private lastCssBounds: CssBounds | null = null;
  private resolveDir: CoworkArtifactDirResolver = (id) =>
    path.join(resolveOfficialArtifactsRoot(), id);
  private zoomFactorProvider: CoworkArtifactZoomProvider = () => 1;

  constructor(
    private readonly window: BrowserWindow,
    private readonly createView: () => WebContentsView = () => {
      ensureArtifactProtocolHandler();
      return new WebContentsView({
        webPreferences: {
          session: session.fromPartition(ARTIFACT_PARTITION),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
    },
    zoomFactorProvider?: CoworkArtifactZoomProvider,
  ) {
    if (zoomFactorProvider) this.zoomFactorProvider = zoomFactorProvider;
  }

  setArtifactDirResolver(resolver: CoworkArtifactDirResolver): void {
    this.resolveDir = resolver;
  }

  setZoomFactorProvider(provider: CoworkArtifactZoomProvider): void {
    this.zoomFactorProvider = provider;
  }

  getShownArtifactId(): string | undefined {
    return this.shownArtifactId;
  }

  private contentSize(): { width: number; height: number } {
    if (this.window.isDestroyed()) return { width: 0, height: 0 };
    try {
      const size = this.window.getContentSize();
      const width = Number(size?.[0]);
      const height = Number(size?.[1]);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        return { width, height };
      }
    } catch {
      /* fall through */
    }
    try {
      const bounds = this.window.getContentBounds();
      return {
        width: Number(bounds?.width) || 0,
        height: Number(bounds?.height) || 0,
      };
    } catch {
      return { width: 0, height: 0 };
    }
  }

  /** Official gXe. */
  private applyBounds(cssBounds: CssBounds): void {
    if (!this.view || this.view.webContents.isDestroyed()) return;
    this.lastCssBounds = cssBounds;
    if (isOfficialParkedPreviewBounds(cssBounds)) {
      this.view.setBounds({ ...ARTIFACT_PARKED_BOUNDS });
      return;
    }
    const zoom = this.zoomFactorProvider();
    const scaled = scalePreviewBoundsWithZoom(cssBounds, zoom, this.contentSize());
    this.view.setBounds(scaled);
  }

  private ensureView(): WebContentsView {
    if (!this.view || this.view.webContents.isDestroyed()) {
      if (this.view && this.attached && !this.window.isDestroyed()) {
        try {
          this.window.contentView.removeChildView(this.view);
        } catch {
          /* ignore */
        }
        this.attached = false;
      }
      const view = this.createView();
      view.setVisible(false);
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      const allowUrl = (url: string) => url.startsWith(`${COWORK_ARTIFACT_SCHEME}://`);
      view.webContents.on("will-navigate", (event, url) => {
        if (!allowUrl(url)) event.preventDefault();
      });
      view.webContents.on("will-redirect", (event, url) => {
        if (!allowUrl(url)) event.preventDefault();
      });
      view.webContents.on("did-finish-load", () => {
        if (view.webContents.isDestroyed()) return;
        void view.webContents
          .insertCSS("* { -webkit-app-region: no-drag !important; app-region: no-drag !important; }")
          .catch(() => undefined);
      });
      this.view = view;
      this.attached = false;
      this.loadedUrl = undefined;
    }
    return this.view;
  }

  private detachView(): void {
    if (!this.view) return;
    try {
      this.view.setVisible(false);
    } catch {
      /* ignore */
    }
    if (this.attached && !this.window.isDestroyed()) {
      try {
        this.window.contentView.removeChildView(this.view);
      } catch {
        /* ignore */
      }
    }
    this.attached = false;
  }

  /**
   * Official cXe(artifactId, bounds, version?) → eM number (0 on failure).
   */
  async showArtifact(
    artifactId: string,
    bounds: unknown,
    version?: number,
  ): Promise<number> {
    if (!artifactId || this.window.isDestroyed()) return 0;
    const css = parseCssBounds(bounds);
    if (!css) return 0;

    const baseDir = await this.resolveDir(artifactId);
    if (!baseDir) {
      console.warn("[CoworkArtifacts] No host dir for artifact", artifactId);
      return 0;
    }
    try {
      await fs.access(path.join(baseDir, "index.html"));
    } catch {
      // Version-only restore still needs versions/n.html; check entry below via load.
      try {
        await fs.access(baseDir);
      } catch {
        console.warn("[CoworkArtifacts] Artifact folder missing", artifactId, baseDir);
        return 0;
      }
    }

    const view = this.ensureView();
    if (!this.attached && !this.window.isDestroyed()) {
      this.window.contentView.addChildView(view);
      this.attached = true;
    }
    setActiveArtifactBaseDir(baseDir);
    this.applyBounds(css);
    try {
      view.setVisible(true);
    } catch {
      /* ignore */
    }
    this.shownArtifactId = artifactId;
    const url = buildCoworkArtifactUrl(artifactId, version);
    if (this.loadedUrl !== url) {
      this.loadedUrl = url;
      this.loadToken = Date.now();
      try {
        await view.webContents.loadURL(url);
      } catch (error) {
        console.error("[CoworkArtifacts] Failed to load", { url, error });
        return 0;
      }
    }
    return this.loadToken || Date.now();
  }

  /** Official YD hideArtifact → boolean. */
  hideArtifact(): boolean {
    if (!this.view) return false;
    this.shownArtifactId = undefined;
    this.loadedUrl = undefined;
    this.detachView();
    setActiveArtifactBaseDir(undefined);
    return true;
  }

  /** Official IXe reloadArtifactView → eM number (0 if nothing shown). */
  async reloadArtifactView(): Promise<number> {
    if (!this.view || this.view.webContents.isDestroyed() || !this.shownArtifactId) return 0;
    const id = this.shownArtifactId;
    this.loadToken = Date.now();
    try {
      this.view.webContents.reload();
    } catch {
      return 0;
    }
    return this.shownArtifactId === id ? this.loadToken : 0;
  }

  /**
   * Official CXe(parkBounds): capture PNG base64 of shown view, then re-apply bounds.
   * Returns null when nothing attached / parked / destroyed.
   */
  async parkAndCaptureArtifact(bounds: unknown): Promise<string | null> {
    if (!this.view || this.view.webContents.isDestroyed() || !this.attached) return null;
    if (this.lastCssBounds && this.lastCssBounds.x < 0) return null;
    const css = parseCssBounds(bounds) ?? this.lastCssBounds;
    if (!css) return null;
    const previous = this.lastCssBounds;
    let pngBase64: string | null = null;
    try {
      const image = await this.view.webContents.capturePage();
      pngBase64 = image.toPNG().toString("base64");
    } catch {
      pngBase64 = null;
    }
    if (previous) this.applyBounds(previous);
    else this.applyBounds(css);
    return pngBase64;
  }

  /**
   * Official EXe residual: printToPDF of the **shown artifact** WebContentsView.
   * Returns PDF Buffer, or null when nothing shown / destroyed (honest — not mainView invent).
   */
  async printShownArtifactToPdf(): Promise<Buffer | null> {
    if (!this.view || this.view.webContents.isDestroyed() || !this.attached) return null;
    if (!this.shownArtifactId) return null;
    try {
      const pdf = await this.view.webContents.printToPDF({ printBackground: true });
      return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } catch {
      return null;
    }
  }

  /** Official jkA re-apply after zoom/resize. */
  relayout(): void {
    if (!this.view || !this.attached || !this.lastCssBounds) return;
    if (this.view.webContents.isDestroyed()) return;
    this.applyBounds(this.lastCssBounds);
  }

  suspend(): void {
    this.hideArtifact();
  }

  destroy(): void {
    this.hideArtifact();
    if (this.view && !this.view.webContents.isDestroyed()) {
      try {
        this.view.webContents.close();
      } catch {
        /* ignore */
      }
    }
    this.view = null;
    this.attached = false;
    this.shownArtifactId = undefined;
    this.loadedUrl = undefined;
    this.lastCssBounds = null;
    setActiveArtifactBaseDir(undefined);
  }
}

/** Resolve artifact host dir: prefer indexHtmlPath dirname, else official Documents tree. */
export async function resolveCoworkArtifactHostDir(
  artifactId: string,
  metadata: Record<string, unknown> | null | undefined,
  getDocumentsPath?: () => string,
): Promise<string | null> {
  const indexHtmlPath =
    metadata && typeof metadata.indexHtmlPath === "string" ? metadata.indexHtmlPath : null;
  if (indexHtmlPath) {
    return path.dirname(indexHtmlPath);
  }
  const root = resolveOfficialArtifactsRoot(getDocumentsPath);
  const candidate = path.join(root, artifactId);
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Local residual of official yn disk enumeration under AKe root
 * (`Documents/Claude/Artifacts/{id}` with index.html).
 * No cloud invent — only folders already on disk.
 */
export async function listOfficialArtifactsOnDisk(
  getDocumentsPath?: () => string,
  deps: {
    readdir?: typeof fs.readdir;
    access?: typeof fs.access;
    stat?: typeof fs.stat;
  } = {},
): Promise<Array<Record<string, unknown>>> {
  const readdir = deps.readdir ?? fs.readdir;
  const access = deps.access ?? fs.access;
  const stat = deps.stat ?? fs.stat;
  const root = resolveOfficialArtifactsRoot(getDocumentsPath);
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = (await readdir(root, { withFileTypes: true })) as Array<{
      name: string;
      isDirectory: () => boolean;
    }>;
  } catch {
    return [];
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (!entry?.name || entry.name.startsWith(".")) continue;
    if (typeof entry.isDirectory === "function" && !entry.isDirectory()) continue;
    const id = entry.name;
    const dir = path.join(root, id);
    const indexHtmlPath = path.join(dir, "index.html");
    try {
      await access(indexHtmlPath);
    } catch {
      continue;
    }
    let createdAt = Date.now();
    try {
      const st = await stat(dir);
      const ms = Number(st.birthtimeMs || st.mtimeMs || 0);
      if (Number.isFinite(ms) && ms > 0) createdAt = Math.trunc(ms);
    } catch {
      /* keep now */
    }
    // Official versions/{stamp}.html residual — expose stamps for restore UI.
    const versions: number[] = [];
    try {
      const versionEntries = (await readdir(path.join(dir, "versions"), {
        withFileTypes: true,
      })) as Array<{ name: string; isFile?: () => boolean; isDirectory?: () => boolean }>;
      for (const ve of versionEntries) {
        if (!ve?.name || !ve.name.endsWith(".html")) continue;
        if (typeof ve.isFile === "function" && !ve.isFile()) continue;
        const stamp = Number(ve.name.replace(/\.html$/i, ""));
        if (Number.isFinite(stamp)) versions.push(Math.trunc(stamp));
      }
      versions.sort((a, b) => a - b);
    } catch {
      /* no versions dir */
    }
    const normalized = normalizeCoworkArtifactRecord({
      id,
      name: id,
      indexHtmlPath,
      createdAt,
      schemaVersion: 1,
      ...(versions.length > 0 ? { versions } : {}),
    });
    if (normalized) rows.push(normalized);
  }
  return rows;
}

/** Normalize featureState / residual bag rows toward official uUt shape. */
export function normalizeCoworkArtifactRecord(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  // Adversarial residual: never throw on null/undefined bag rows.
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) return null;
  const name =
    typeof raw.name === "string" && raw.name
      ? raw.name
      : typeof raw.title === "string" && raw.title
        ? raw.title
        : id;
  const createdAt =
    typeof raw.createdAt === "number"
      ? raw.createdAt
      : typeof raw.createdAt === "string"
        ? Date.parse(raw.createdAt) || Date.now()
        : Date.now();
  const updatedAt =
    typeof raw.updatedAt === "number"
      ? raw.updatedAt
      : typeof raw.updatedAt === "string"
        ? Date.parse(raw.updatedAt) || undefined
        : undefined;
  return {
    ...raw,
    id,
    name,
    createdAt,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    isStarred: raw.isStarred === true || raw.starred === true,
    schemaVersion: typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1,
  };
}
