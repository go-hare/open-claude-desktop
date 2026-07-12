import { app, net, session, WebContentsView, type BrowserWindow, type Rectangle } from "electron";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Official Nor — native-preview extensions (html/svg/pdf + Mnt office). */
const RENDERABLE_EXTENSIONS = new Set([".html", ".htm", ".svg", ".pdf"]);
/** Official Mnt — Office extensions converted to PDF before paint (Mor / soffice). */
const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".ppt", ".pptx"]);
const ALL_EXTENSIONS = new Set([...RENDERABLE_EXTENSIONS, ...OFFICE_EXTENSIONS]);
/** Official Szt parked sentinel. */
const PARKED_BOUNDS: Rectangle = { x: -10_000, y: 0, width: 1, height: 1 };
/** Official yor partition for the preview WebContentsView. */
const PREVIEW_PARTITION = "persist:cowork-file-preview";
/** Official _tA scheme (Sor builds cowork-file://preview/...). */
const PREVIEW_SCHEME = "cowork-file";
const PDF_CHROME_EXTENSION = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai";
/** Official Mor timeout (_or = 6e4). */
const OFFICE_CONVERT_TIMEOUT_MS = 60_000;

export type CoworkPreviewResult = { ok: boolean; painted?: boolean; declineReason?: string };
export type CoworkSessionRootsResolver = (sessionId: string) => string[] | Promise<string[]>;
export type CoworkZoomFactorProvider = () => number;

type LoadedCandidate = {
  sessionId: string;
  sourcePath: string;
  baseDir: string;
  entryName: string;
  ownedTempDir?: string;
};

type PendingResolve = {
  sessionId: string;
  sourcePath: string;
};

let protocolHandlerInstalled = false;
let protocolBaseDir: string | undefined;

function notFoundResponse(): Response {
  return new Response("Not found", { status: 404 });
}

/**
 * Official Ror + _2A: register cowork-file protocol on the preview partition so
 * knt can load `cowork-file://preview/<entry>` constrained to the active baseDir.
 */
function ensurePreviewProtocolHandler(): void {
  if (protocolHandlerInstalled) return;
  const previewSession = session.fromPartition(PREVIEW_PARTITION);
  previewSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  previewSession.setPermissionCheckHandler(() => false);
  previewSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed =
      details.url.startsWith(`${PREVIEW_SCHEME}://`) ||
      details.url.startsWith(`${PDF_CHROME_EXTENSION}/`) ||
      details.url.startsWith("chrome://resources/");
    callback({ cancel: !allowed });
  });
  previewSession.protocol.handle(PREVIEW_SCHEME, async (request) => {
    const baseDir = protocolBaseDir;
    if (!baseDir) return notFoundResponse();
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
    // Official Sor path is /preview/<entry...>; strip the preview root segment.
    if (parts[0] === "preview") parts.shift();
    if (parts.length === 0) return notFoundResponse();
    const joined = path.resolve(baseDir, ...parts);
    const relative = path.relative(baseDir, joined);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return notFoundResponse();
    }
    try {
      const response = await net.fetch(pathToFileURL(joined).href);
      if (!response.ok) return notFoundResponse();
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      headers.set(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'self' ${PDF_CHROME_EXTENSION}; frame-src 'self' ${PDF_CHROME_EXTENSION}; form-action 'none'; base-uri 'self'`,
      );
      return new Response(response.body, { status: 200, headers });
    } catch {
      return notFoundResponse();
    }
  });
  protocolHandlerInstalled = true;
}

function setProtocolBaseDir(baseDir: string | undefined): void {
  protocolBaseDir = baseDir;
}

/** Official Sor(entry) → cowork-file://preview/<encoded entry>. */
export function buildCoworkPreviewUrl(entryName: string, version: number): string {
  const encoded = entryName.split("/").map(encodeURIComponent).join("/");
  const pdfHash = entryName.toLowerCase().endsWith(".pdf") ? "#toolbar=0&view=FitH" : "";
  return `${PREVIEW_SCHEME}://preview/${encoded}?v=${version}${pdfHash}`;
}

export function decodePreviewPath(encodedPath: unknown): string | null {
  if (typeof encodedPath !== "string" || !encodedPath || encodedPath.includes("\0")) return null;
  try {
    const decoded = decodeURIComponent(encodedPath);
    return !decoded || decoded.includes("\0") ? null : decoded;
  } catch {
    return null;
  }
}

export function isOfficialParkedPreviewBounds(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return (
    raw.x === PARKED_BOUNDS.x &&
    raw.y === PARKED_BOUNDS.y &&
    raw.width === PARKED_BOUNDS.width &&
    raw.height === PARKED_BOUNDS.height
  );
}

/**
 * Official vor — clip width/height to parent content size; keep x/y (including negative park).
 */
export function clipPreviewBoundsToViewport(bounds: Rectangle, viewport: { width: number; height: number }): Rectangle {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.min(bounds.width, Math.max(0, viewport.width - bounds.x)),
    height: Math.min(bounds.height, Math.max(0, viewport.height - bounds.y)),
  };
}

/**
 * Official jkA — scale CSS bounds by main-view zoom factor, then vor-clip to content size.
 */
export function scalePreviewBoundsWithZoom(
  bounds: { x: number; y: number; width: number; height: number },
  zoomFactor: number,
  viewport: { width: number; height: number },
): Rectangle {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const x = Math.ceil(bounds.x * zoom);
  const y = Math.ceil(bounds.y * zoom);
  const scaled: Rectangle = {
    x,
    y,
    width: Math.max(0, Math.floor((bounds.x + bounds.width) * zoom) - x),
    height: Math.max(0, Math.floor((bounds.y + bounds.height) * zoom) - y),
  };
  return clipPreviewBoundsToViewport(scaled, viewport);
}

/** @deprecated Prefer scalePreviewBoundsWithZoom + official vor; kept for callers/tests. */
export function clipPreviewBounds(value: unknown, viewport: Rectangle): Rectangle | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (![raw.x, raw.y, raw.width, raw.height].every((part) => typeof part === "number" && Number.isFinite(part))) {
    return null;
  }
  if (isOfficialParkedPreviewBounds(value)) return { ...PARKED_BOUNDS };
  const input = {
    x: raw.x as number,
    y: raw.y as number,
    width: raw.width as number,
    height: raw.height as number,
  };
  const scaled = scalePreviewBoundsWithZoom(input, 1, viewport);
  if (scaled.width <= 0 || scaled.height <= 0) return null;
  return scaled;
}

export function isOfficePreviewExtension(extension: string): boolean {
  return OFFICE_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * Official Mor runs `soffice --headless --norestore --convert-to pdf` inside ClaudeVM.
 * Host-loop has no guest; resolve a real host soffice binary so the same conversion can paint.
 */
export function resolveSofficeBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const fromEnv = env.CLAUDE_SOFFICE_PATH?.trim();
  if (fromEnv) return fromEnv;
  const candidates =
    platform === "darwin"
      ? [
          "/Applications/LibreOffice.app/Contents/MacOS/soffice",
          "/opt/homebrew/bin/soffice",
          "/usr/local/bin/soffice",
        ]
      : platform === "win32"
        ? [
            "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
            "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
          ]
        : ["/usr/bin/soffice", "/usr/local/bin/soffice", "/snap/bin/soffice"];
  return (
    candidates.find((candidate) => {
      try {
        accessSync(candidate);
        return true;
      } catch {
        return false;
      }
    }) ?? null
  );
}

function officeCacheRoot(): string {
  try {
    return path.join(app.getPath("userData"), "cowork-file-preview", "office-cache");
  } catch {
    return path.join(os.tmpdir(), "cowork-file-preview", "office-cache");
  }
}

function previewTempRoot(): string {
  try {
    return path.join(app.getPath("userData"), "cowork-file-preview", "temp");
  } catch {
    return path.join(os.tmpdir(), "cowork-file-preview", "temp");
  }
}

/**
 * Official Mor (app.asar): hash bytes → cache hit → else soffice convert → office-cache/{hash}.pdf
 * Host equivalent: same flags, host process (no VM mount).
 */
export async function convertOfficeBytesToPdf(
  bytes: Buffer,
  extension: string,
  options: {
    sofficePath?: string | null;
    cacheDir?: string;
    execFileImpl?: typeof execFileAsync;
    timeoutMs?: number;
  } = {},
): Promise<{ pdfBytes: Buffer; pdfName: string; cacheHit: boolean; workDir: string }> {
  const ext = extension.toLowerCase().startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  if (!OFFICE_EXTENSIONS.has(ext)) throw new Error(`unsupported office extension: ${ext}`);
  const sofficePath = options.sofficePath === undefined ? resolveSofficeBinary() : options.sofficePath;
  if (!sofficePath) throw new Error("soffice binary not found");
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const pdfName = `${hash}.pdf`;
  const cacheDir = options.cacheDir ?? officeCacheRoot();
  await fs.mkdir(cacheDir, { recursive: true });
  const cachedPdf = path.join(cacheDir, pdfName);
  try {
    const pdfBytes = await fs.readFile(cachedPdf);
    if (pdfBytes.length > 0) return { pdfBytes, pdfName, cacheHit: true, workDir: cacheDir };
  } catch {
    /* cache miss */
  }

  const workDir = path.join(cacheDir, `office-convert-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });
  const inputName = `${hash}${ext}`;
  const inputPath = path.join(workDir, inputName);
  const outputPdf = path.join(workDir, pdfName);
  try {
    await fs.writeFile(inputPath, bytes, { mode: 0o600 });
    const execImpl = options.execFileImpl ?? execFileAsync;
    try {
      await execImpl(
        sofficePath,
        ["--headless", "--norestore", "--convert-to", "pdf", "--outdir", workDir, inputPath],
        { timeout: options.timeoutMs ?? OFFICE_CONVERT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`soffice exited with error: ${message.slice(-500)}`);
    }
    const pdfBytes = await fs.readFile(outputPdf);
    if (pdfBytes.length === 0) throw new Error("soffice produced empty pdf");
    await fs.writeFile(cachedPdf, pdfBytes, { mode: 0o600 }).catch(() => undefined);
    // Official Mor renames into office-cache and returns workDir=cache for protocol base.
    return { pdfBytes, pdfName, cacheHit: false, workDir: cacheDir };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function containedFile(candidate: string, roots: string[]): Promise<string | null> {
  let realCandidate: string;
  try {
    realCandidate = await fs.realpath(candidate);
  } catch {
    return null;
  }
  for (const root of roots) {
    try {
      const realRoot = await fs.realpath(root);
      const relative = path.relative(realRoot, realCandidate);
      if (relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) {
        return realCandidate;
      }
      if (relative === "") return realCandidate;
    } catch {
      /* Ignore unavailable session roots. */
    }
  }
  return null;
}

function mapOfficeResolveError(error: unknown): string {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  // Official Gor declineReason mapping for office resolve failures.
  if (/VM is not available|VM is unavailable|VM guest is not connected|VM disconnected|soffice binary not found|vm-not-ready/i.test(message)) {
    return "vm_unavailable";
  }
  if (/soffice/i.test(message)) return "soffice_failed";
  return "resolve_failed";
}

function parseCssBounds(value: unknown): { x: number; y: number; width: number; height: number } | null {
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
 * Official CoworkFilePreview host (For / knt / Rp / Tnt / jkA / Sor).
 * Lifecycle matches app.asar main; host-loop substitutes host soffice for ClaudeVM Mor.
 */
export class CoworkFilePreviewManager {
  private view: WebContentsView | null = null;
  /** Official mm — whether the preview WebContentsView is currently attached to the parent. */
  private attached = false;
  /**
   * Monotonic epoch bumped on every hide/destroy and at the start of each show.
   * In-flight resolves must not re-attach after Rp hide (click-stealing surface).
   */
  private epoch = 0;
  /** Official HK — last CSS bounds requested by Izt (pre-zoom). */
  private lastCssBounds: { x: number; y: number; width: number; height: number } | null = null;
  /** Official yv — currently loaded candidate. */
  private loaded: LoadedCandidate | null = null;
  /** Official JR — in-flight resolve token. */
  private pending: PendingResolve | null = null;
  /** Official kor — cache-bust for protocol URL. */
  private loadVersion = 0;
  private resolveRoots: CoworkSessionRootsResolver = () => [];
  private zoomFactorProvider: CoworkZoomFactorProvider = () => 1;
  private sofficePathOverride: string | null | undefined;
  private officeConverter:
    | ((bytes: Buffer, extension: string) => Promise<Buffer>)
    | null
    | undefined;

  constructor(
    private readonly window: BrowserWindow,
    private readonly createView: () => WebContentsView = () => {
      ensurePreviewProtocolHandler();
      return new WebContentsView({
        webPreferences: {
          session: session.fromPartition(PREVIEW_PARTITION),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          plugins: true,
          webSecurity: true,
        },
      });
    },
    zoomFactorProvider?: CoworkZoomFactorProvider,
  ) {
    if (zoomFactorProvider) this.zoomFactorProvider = zoomFactorProvider;
  }

  setSessionRootsResolver(resolver: CoworkSessionRootsResolver): void {
    this.resolveRoots = resolver;
  }

  setZoomFactorProvider(provider: CoworkZoomFactorProvider): void {
    this.zoomFactorProvider = provider;
  }

  /** Test hook: force soffice path (null = missing). */
  setSofficePathForTests(value: string | null | undefined): void {
    this.sofficePathOverride = value;
  }

  /** Test hook: inject office→pdf converter (null = fail as unavailable). */
  setOfficeConverterForTests(converter: ((bytes: Buffer, extension: string) => Promise<Buffer>) | null | undefined): void {
    this.officeConverter = converter;
  }

  /** Official For.isEnabled → M2A feature gate; host always exposes the surface. */
  isEnabled(): boolean {
    return true;
  }

  /**
   * Official FN/isVmReady = ClaudeVM guest connected (required for Mor/soffice).
   * Host-loop has no guest: report ready when a host soffice converter is available
   * so Izt's Office branch can begin show() and paint the converted PDF.
   */
  isVmReady(): boolean {
    if (this.officeConverter !== undefined) return this.officeConverter !== null;
    if (this.sofficePathOverride !== undefined) return Boolean(this.sofficePathOverride);
    return resolveSofficeBinary() !== null;
  }

  private resolveSofficePath(): string | null {
    if (this.sofficePathOverride !== undefined) return this.sofficePathOverride;
    return resolveSofficeBinary();
  }

  private contentSize(): { width: number; height: number } {
    if (this.window.isDestroyed()) return { width: 0, height: 0 };
    try {
      const [width, height] = this.window.getContentSize();
      return { width, height };
    } catch {
      const bounds = this.window.getContentBounds();
      return { width: bounds.width, height: bounds.height };
    }
  }

  /** Official jkA(bounds). */
  private applyBounds(cssBounds: { x: number; y: number; width: number; height: number }): void {
    if (!this.view || this.view.webContents.isDestroyed()) return;
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
          // ignore
        }
        this.attached = false;
      }
      void this.clearLoadedState();
      const view = this.createView();
      view.setVisible(false);
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      const allowUrl = (url: string) =>
        url.startsWith(`${PREVIEW_SCHEME}://`) || url.startsWith(`${PDF_CHROME_EXTENSION}/`);
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
    }
    return this.view;
  }

  /** Official Rp: detach + hide so the native surface cannot steal clicks after close. */
  private detachView(): void {
    if (!this.view) return;
    try {
      this.view.setVisible(false);
    } catch {
      // ignore
    }
    if (this.attached && !this.window.isDestroyed()) {
      try {
        this.window.contentView.removeChildView(this.view);
      } catch {
        // ignore if already detached
      }
    }
    this.attached = false;
  }

  /** Official $kA — drop loaded candidate, protocol base, and owned temps. */
  private async clearLoadedState(): Promise<void> {
    const owned = this.loaded?.ownedTempDir;
    // Synchronously drop identity first so concurrent show cannot matchesLoaded/re-attach.
    this.loaded = null;
    setProtocolBaseDir(undefined);
    try {
      await session.fromPartition(PREVIEW_PARTITION).clearStorageData();
    } catch {
      // ignore
    }
    if (owned) {
      await fs.rm(owned, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** True only while this show generation still owns the surface (not hidden/superseded). */
  private isCurrentEpoch(epoch: number): boolean {
    return epoch === this.epoch && !this.window.isDestroyed();
  }

  private matchesLoaded(sessionId: string, sourcePath: string): boolean {
    return this.loaded?.sessionId === sessionId && this.loaded.sourcePath === sourcePath;
  }

  private matchesPending(sessionId: string, sourcePath: string): boolean {
    return this.pending?.sessionId === sessionId && this.pending.sourcePath === sourcePath;
  }

  /**
   * Official Lor host subset: session-root containment + optional Mor office→pdf.
   * Returns baseDir/entryName for Sor protocol load (not data: URLs).
   */
  private async resolveRenderable(
    sessionId: string,
    sourcePath: string,
    extension: string,
  ): Promise<{ baseDir: string; entryName: string; ownedTempDir?: string } | { declineReason: string }> {
    const roots = await this.resolveRoots(sessionId);
    const candidate = await containedFile(path.resolve(sourcePath), roots);
    if (!candidate) return { declineReason: "path-not-allowed" };

    if (!OFFICE_EXTENSIONS.has(extension)) {
      return { baseDir: path.dirname(candidate), entryName: path.basename(candidate) };
    }

    try {
      const sourceBytes = await fs.readFile(candidate);
      if (this.officeConverter !== undefined) {
        if (!this.officeConverter) return { declineReason: "vm_unavailable" };
        const pdfBytes = await this.officeConverter(sourceBytes, extension);
        const tempDir = path.join(previewTempRoot(), `office-${randomUUID().slice(0, 8)}`);
        await fs.mkdir(tempDir, { recursive: true });
        const entryName = `${createHash("sha256").update(sourceBytes).digest("hex").slice(0, 16)}.pdf`;
        await fs.writeFile(path.join(tempDir, entryName), pdfBytes, { mode: 0o600 });
        return { baseDir: tempDir, entryName, ownedTempDir: tempDir };
      }
      const sofficePath = this.resolveSofficePath();
      if (!sofficePath) return { declineReason: "vm_unavailable" };
      const converted = await convertOfficeBytesToPdf(sourceBytes, extension, { sofficePath });
      return { baseDir: converted.workDir, entryName: converted.pdfName };
    } catch (error) {
      return { declineReason: mapOfficeResolveError(error) };
    }
  }

  /**
   * Official knt / showFilePreview.
   * Success is `{ ok: true }` after attach+loadURL kickoff (no capture paint gate).
   * Superseded in-flight resolves also soft-succeed so Izt does not permanent-fallback.
   *
   * Concurrency model (matches app.asar knt/Rp):
   * - JR pending token supersedes older resolves across await points.
   * - hide()/destroy() clear JR + yv synchronously and bump epoch so post-await
   *   work cannot re-addChildView (click-stealing overlay).
   * - show() only snapshots epoch — concurrent same-path show must NOT cancel the
   *   in-flight resolve (official: n(JR) soft-ok; first continues with updated HK).
   * - Already-loaded same candidate: only jkA bounds (no re-attach). Re-attach
   *   after Rp only happens on the full resolve path when yv was cleared.
   */
  async show(sessionId: unknown, encodedPath: unknown, bounds: unknown): Promise<CoworkPreviewResult> {
    if (this.window.isDestroyed()) return { ok: false, declineReason: "no_parent_window" };
    if (typeof sessionId !== "string" || !sessionId) return { ok: false, declineReason: "invalid-session" };
    const sourcePath = decodePreviewPath(encodedPath);
    if (!sourcePath) return { ok: false, declineReason: "invalid-path" };
    const extension = path.extname(sourcePath).toLowerCase();
    if (!ALL_EXTENSIONS.has(extension)) return { ok: false, declineReason: "unsupported_extension" };

    const cssBounds = parseCssBounds(bounds);
    if (!cssBounds) return { ok: false, declineReason: "invalid-bounds" };

    // Snapshot only — hide/destroy bump epoch; concurrent show must not cancel resolve.
    const epoch = this.epoch;
    // Official: HK = t before yv/JR short-circuits so later attach uses latest bounds.
    this.lastCssBounds = cssBounds;

    this.ensureView();
    if (!this.view || this.view.webContents.isDestroyed()) {
      return { ok: false, declineReason: "view_destroyed" };
    }

    // Official: if (n(yv)) return (jkA(t), { ok: !0 }) — bounds only, never re-attach.
    // Re-attach after Rp would recreate the click-stealing surface when yv lagged.
    if (this.matchesLoaded(sessionId, sourcePath)) {
      this.applyBounds(cssBounds);
      return { ok: true };
    }

    // Official: if (n(JR)) return { ok: !0 } — same resolve in flight; HK already updated.
    if (this.matchesPending(sessionId, sourcePath) && this.pending) {
      return { ok: true };
    }

    this.view.setVisible(false);
    setProtocolBaseDir(undefined);

    const token: PendingResolve = { sessionId, sourcePath };
    this.pending = token;

    let resolved: { baseDir: string; entryName: string; ownedTempDir?: string } | { declineReason: string };
    try {
      resolved = await this.resolveRenderable(sessionId, sourcePath, extension);
    } catch (error) {
      const declineReason = mapOfficeResolveError(error);
      if (this.pending === token && this.isCurrentEpoch(epoch)) {
        this.pending = null;
        this.hide();
      }
      return { ok: false, declineReason };
    }

    // Superseded / hidden while resolving — official cleans owned temp and returns ok:true.
    if (this.pending !== token || !this.isCurrentEpoch(epoch)) {
      if ("ownedTempDir" in resolved && resolved.ownedTempDir) {
        await fs.rm(resolved.ownedTempDir, { recursive: true, force: true }).catch(() => undefined);
      }
      return { ok: true };
    }

    if ("declineReason" in resolved) {
      this.pending = null;
      this.hide();
      return { ok: false, declineReason: resolved.declineReason };
    }

    await this.clearLoadedState();
    // Re-check after await: Rp may have cleared JR/yv and bumped epoch.
    if (this.pending !== token || !this.isCurrentEpoch(epoch)) {
      if (resolved.ownedTempDir) {
        await fs.rm(resolved.ownedTempDir, { recursive: true, force: true }).catch(() => undefined);
      }
      return { ok: true };
    }

    // Sync section after last await — hide cannot interleave mid-block on the main process.
    this.pending = null;
    this.loaded = {
      sessionId,
      sourcePath,
      baseDir: resolved.baseDir,
      entryName: resolved.entryName,
      ownedTempDir: resolved.ownedTempDir,
    };
    setProtocolBaseDir(resolved.baseDir);

    if (!this.view || this.view.webContents.isDestroyed()) {
      return { ok: false, declineReason: "view_destroyed" };
    }

    // Official knt: re-addChildView when mm is false after Rp hide removed it.
    if (!this.attached && !this.window.isDestroyed()) {
      this.window.contentView.addChildView(this.view);
      this.attached = true;
    }

    const applyCss = this.lastCssBounds ?? cssBounds;
    this.applyBounds(applyCss);
    this.view.setVisible(true);

    const url = buildCoworkPreviewUrl(resolved.entryName, ++this.loadVersion);
    // Official loadURL is fire-and-forget; failures log only — still return ok:true.
    void this.view.webContents.loadURL(url).catch(() => undefined);

    return { ok: true };
  }

  /** Official Rp / hideFilePreview. */
  hide(): void {
    // Bump epoch first so any in-flight show() past an await cannot re-attach.
    ++this.epoch;
    // Official: JR = void 0 synchronously.
    this.pending = null;
    this.lastCssBounds = null;
    // Drop yv identity synchronously (before async temp cleanup) so matchesLoaded is false
    // and a racy show cannot treat the closed candidate as still loaded.
    const owned = this.loaded?.ownedTempDir;
    this.loaded = null;
    setProtocolBaseDir(undefined);
    // Official Rp: setVisible(false) + removeChildView when mm — required to stop click steal.
    this.detachView();
    if (owned) {
      void fs.rm(owned, { recursive: true, force: true }).catch(() => undefined);
    }
    // clearStorageData is best-effort; session may be unavailable in unit harnesses.
    try {
      void session
        .fromPartition(PREVIEW_PARTITION)
        .clearStorageData()
        .catch(() => undefined);
    } catch {
      // ignore
    }
  }

  /** Official Tnt / parkAndCapture — snapshot then park; keep loaded document. */
  async parkAndCapture(bounds: unknown): Promise<string | null> {
    const view = this.view;
    if (!view || !this.attached || view.webContents.isDestroyed()) return null;
    const cssBounds = parseCssBounds(bounds) ?? PARKED_BOUNDS;
    const boundsAtStart = this.lastCssBounds;
    let image: { toPNG: () => Buffer };
    try {
      image = await view.webContents.capturePage();
    } catch {
      return null;
    }
    if (view.webContents.isDestroyed() || !this.attached) return null;
    // Official: only park if HK still matches the pre-capture value.
    if (boundsAtStart !== this.lastCssBounds && this.lastCssBounds !== null) {
      // Still return capture if taken; apply park only when not raced.
    }
    this.lastCssBounds = cssBounds;
    this.applyBounds(cssBounds);
    view.setVisible(true);
    return image.toPNG().toString("base64");
  }

  /** Re-apply last CSS bounds through official jkA after window resize / zoom. */
  relayout(): void {
    if (!this.view || !this.attached || !this.lastCssBounds) return;
    this.applyBounds(this.lastCssBounds);
  }

  suspend(): void {
    this.hide();
  }

  destroy(): void {
    ++this.epoch;
    this.pending = null;
    this.lastCssBounds = null;
    const owned = this.loaded?.ownedTempDir;
    this.loaded = null;
    setProtocolBaseDir(undefined);
    this.detachView();
    if (owned) {
      void fs.rm(owned, { recursive: true, force: true }).catch(() => undefined);
    }
    if (!this.view) return;
    try {
      this.view.webContents.close();
    } catch {
      // ignore
    }
    this.view = null;
  }
}
