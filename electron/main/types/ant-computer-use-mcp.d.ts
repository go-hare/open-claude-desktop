/**
 * Ambient types for @ant/computer-use-mcp.
 * package.json "exports" + moduleResolution bundler fails to resolve
 * package src re-exports (./executor.js → .ts) under node_modules.
 * Runtime still loads vendor/dist; this declaration mirrors package public API
 * used by product residual (cTi / koA / ddi).
 */
declare module "@ant/computer-use-mcp" {
  export type CoordinateMode = "pixels" | "normalized_0_100";

  export type CuAppPermTier = "read" | "click" | "full";

  export interface AppGrant {
    bundleId: string;
    displayName: string;
    grantedAt: number;
    tier?: CuAppPermTier;
  }

  export interface CuGrantFlags {
    clipboardRead: boolean;
    clipboardWrite: boolean;
    systemKeyCombos: boolean;
  }

  export const DEFAULT_GRANT_FLAGS: CuGrantFlags;

  export interface CuSubGates {
    pixelValidation: boolean;
    clipboardPasteMultiline: boolean;
    mouseAnimation: boolean;
    hideBeforeAction: boolean;
    autoTargetDisplay: boolean;
    clipboardGuard: boolean;
  }

  export const ALL_SUB_GATES_ON: CuSubGates;
  export const ALL_SUB_GATES_OFF: CuSubGates;

  export interface Logger {
    info: (message: string, detail?: unknown) => void;
    error: (message: string, detail?: unknown) => void;
    warn: (message: string, detail?: unknown) => void;
    debug: (message: string, detail?: unknown) => void;
    silly: (message: string, detail?: unknown) => void;
  }

  export interface DisplayGeometry {
    displayId: number;
    width: number;
    height: number;
    scaleFactor: number;
    originX: number;
    originY: number;
    label?: string;
    isPrimary?: boolean;
  }

  export interface ScreenshotResult {
    base64: string;
    width: number;
    height: number;
    displayWidth: number;
    displayHeight: number;
    originX: number;
    originY: number;
    displayId?: number;
    accessibilityText?: string;
  }

  export type ScreenshotDims = Omit<ScreenshotResult, "base64">;

  export interface FrontmostApp {
    bundleId: string;
    displayName: string;
  }

  export interface InstalledApp {
    bundleId: string;
    displayName: string;
    path: string;
    iconDataUrl?: string;
  }

  export interface RunningApp {
    bundleId: string;
    displayName: string;
    pid?: number;
  }

  export interface ResolvePrepareCaptureResult extends ScreenshotResult {
    hidden: string[];
    activated?: string;
    displayId: number;
    captureError?: string;
  }

  export interface ComputerExecutorCapabilities {
    screenshotFiltering: "native" | "none";
    platform: "darwin" | "win32";
    hostBundleId: string;
  }

  export interface ComputerExecutor {
    capabilities: ComputerExecutorCapabilities;
    prepareForAction(
      allowlistBundleIds: string[],
      displayId?: number,
    ): Promise<string[]>;
    previewHideSet(
      allowlistBundleIds: string[],
      displayId?: number,
    ): Promise<Array<{ bundleId: string; displayName: string }>>;
    getDisplaySize(displayId?: number): Promise<DisplayGeometry>;
    listDisplays(): Promise<DisplayGeometry[]>;
    findWindowDisplays(
      bundleIds: string[],
    ): Promise<Array<{ bundleId: string; displayIds: number[] }>>;
    resolvePrepareCapture(opts: {
      allowedBundleIds: string[];
      preferredDisplayId?: number;
      autoResolve: boolean;
      doHide?: boolean;
    }): Promise<ResolvePrepareCaptureResult>;
    screenshot(opts: {
      allowedBundleIds: string[];
      displayId?: number;
    }): Promise<ScreenshotResult>;
    zoom(
      regionLogical: { x: number; y: number; w: number; h: number },
      allowedBundleIds: string[],
      displayId?: number,
    ): Promise<{ base64: string; width: number; height: number }>;
    key(keySequence: string, repeat?: number): Promise<void>;
    holdKey(keyNames: string[], durationMs: number): Promise<void>;
    type(text: string, opts: { viaClipboard: boolean }): Promise<void>;
    readClipboard(): Promise<string>;
    writeClipboard(text: string): Promise<void>;
    moveMouse(x: number, y: number): Promise<void>;
    click(
      x: number,
      y: number,
      button: "left" | "right" | "middle",
      count: 1 | 2 | 3,
      modifiers?: string[],
    ): Promise<void>;
    mouseDown(): Promise<void>;
    mouseUp(): Promise<void>;
    getCursorPosition(): Promise<{ x: number; y: number }>;
    drag(
      from: { x: number; y: number } | undefined,
      to: { x: number; y: number },
    ): Promise<void>;
    scroll(x: number, y: number, dx: number, dy: number): Promise<void>;
    getFrontmostApp(): Promise<FrontmostApp | null>;
    appUnderPoint(
      x: number,
      y: number,
    ): Promise<{ bundleId: string; displayName: string } | null>;
    listInstalledApps(): Promise<InstalledApp[]>;
    getAppIcon(path: string): Promise<string | undefined>;
    listRunningApps(): Promise<RunningApp[]>;
    openApp(bundleId: string): Promise<void>;
  }

  export interface CuPermissionRequest {
    requestId: string;
    reason: string;
    apps: unknown[];
    requestedFlags: Partial<CuGrantFlags>;
    screenshotFiltering: "native" | "none";
    tccState?: { accessibility: boolean; screenRecording: boolean };
    willHide?: Array<{ bundleId: string; displayName: string }>;
    autoUnhideEnabled?: boolean;
    featureDisabled?: boolean;
  }

  export interface CuPermissionResponse {
    granted: AppGrant[];
    denied: Array<{ bundleId: string; reason: "user_denied" | "not_installed" }>;
    flags: CuGrantFlags;
    userConsented?: boolean;
  }

  export interface CuTeachPermissionRequest {
    requestId: string;
    reason: string;
    apps: unknown[];
    screenshotFiltering: "native" | "none";
    tccState?: { accessibility: boolean; screenRecording: boolean };
    willHide?: Array<{ bundleId: string; displayName: string }>;
    autoUnhideEnabled?: boolean;
  }

  export interface ComputerUseHostAdapter {
    serverName: string;
    logger: Logger;
    executor: ComputerExecutor;
    ensureOsPermissions(): Promise<
      | { granted: true }
      | { granted: false; accessibility: boolean; screenRecording: boolean }
    >;
    isDisabled(): boolean;
    getAutoUnhideEnabled(): boolean;
    getSubGates(): CuSubGates;
    cropRawPatch(
      jpegBase64: string,
      rect: { x: number; y: number; width: number; height: number },
    ): Buffer | null;
  }

  export interface ComputerUseSessionContext {
    getAllowedApps(): readonly AppGrant[];
    getGrantFlags(): CuGrantFlags;
    getUserDeniedBundleIds(): readonly string[];
    getSelectedDisplayId(): number | undefined;
    getDisplayPinnedByModel?(): boolean;
    getDisplayResolvedForApps?(): string | undefined;
    getTeachModeActive?(): boolean;
    getLastScreenshotDims?(): ScreenshotDims | undefined;
    onPermissionRequest?(
      req: CuPermissionRequest,
      signal: AbortSignal,
    ): Promise<CuPermissionResponse>;
    onTeachPermissionRequest?(
      req: CuTeachPermissionRequest,
      signal: AbortSignal,
    ): Promise<CuPermissionResponse>;
    onAllowedAppsChanged?(apps: readonly AppGrant[], flags: CuGrantFlags): void;
    onAppsHidden?(bundleIds: string[]): void;
    getClipboardStash?(): string | undefined;
    onClipboardStashChanged?(stash: string | undefined): void;
    onResolvedDisplayUpdated?(displayId: number): void;
    onDisplayPinned?(displayId: number | undefined): void;
    onDisplayResolvedForApps?(sortedBundleIdsKey: string): void;
    onScreenshotCaptured?(dims: ScreenshotDims): void;
    onTeachModeActivated?(): void;
    onTeachStep?(req: unknown): Promise<unknown>;
    onTeachWorking?(): void;
    checkCuLock?(): Promise<{ holder: string | undefined; isSelf: boolean }>;
    acquireCuLock?(): Promise<void>;
    formatLockHeldMessage?(holder: string): string;
    isAborted?(): boolean;
    /** Optional package residual; product tracks Sets on session. */
    getHiddenPendingNote?(): string[];
    drainHiddenPendingNote?(): void;
  }

  export interface ResizeParams {
    pxPerToken: number;
    maxTargetPx: number;
    maxTargetTokens: number;
  }

  export const API_RESIZE_PARAMS: ResizeParams;
  export function targetImageSize(
    width: number,
    height: number,
    params: ResizeParams,
  ): [number, number];

  export function buildComputerUseTools(
    caps: {
      platform: "darwin" | "win32";
      screenshotFiltering: "native" | "none" | "mask";
      teachMode?: boolean;
    },
    coordinateMode: CoordinateMode,
    installedApps?: unknown,
  ): Array<{ name: string; description?: string; inputSchema?: unknown }>;

  export type CuCallToolResult = {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
    telemetry?: unknown;
    screenshot?: ScreenshotResult;
  };

  export function bindSessionContext(
    adapter: ComputerUseHostAdapter,
    coordinateMode: CoordinateMode,
    ctx: ComputerUseSessionContext,
  ): (name: string, args: unknown) => Promise<CuCallToolResult>;

  export function handleToolCall(
    ...args: unknown[]
  ): Promise<CuCallToolResult>;

  export function defersLockAcquire(name: string): boolean;
}
