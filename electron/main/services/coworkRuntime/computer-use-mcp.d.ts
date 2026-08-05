/**
 * Ambient types for vendor `@ant/computer-use-mcp`.
 * Package `exports` point at dist JS without types condition; residual product
 * needs the symbols used by computer-use host-loop MCP inject + Win executor.
 */
declare module "@ant/computer-use-mcp" {
  export type CuAppPermTier = "read" | "click" | "full";

  export type CuGrantFlags = {
    clipboardRead: boolean;
    clipboardWrite: boolean;
    systemKeyCombos: boolean;
  };

  export type AppGrant = {
    bundleId: string;
    displayName: string;
    grantedAt: number;
    tier?: CuAppPermTier;
  };

  export type CuPermissionRequest = {
    apps: Array<{
      alreadyGranted: boolean;
      isSentinel: boolean;
      proposedTier: CuAppPermTier;
      requestedName: string;
      resolved?: {
        bundleId?: string;
        displayName?: string;
        iconDataUrl?: string;
        path?: string;
      };
    }>;
    reason?: string;
    requestedFlags?: Partial<CuGrantFlags>;
    requestId?: string;
    screenshotFiltering?: "native" | "none" | "mask";
    autoUnhideEnabled?: boolean;
    willHide?: Array<{ bundleId: string; displayName: string }>;
    tccState?: {
      accessibility: boolean;
      screenRecording: boolean;
    };
    featureDisabled?: boolean;
  };

  export type CuPermissionResponse = {
    denied: Array<{
      bundleId: string;
      reason: "user_denied" | "not_installed" | string;
    }>;
    flags: CuGrantFlags;
    granted: AppGrant[];
    userConsented?: boolean;
  };

  export type CuTeachPermissionRequest = CuPermissionRequest;

  export type CoordinateMode = "pixels" | "normalized_0_100";

  export type CuSubGates = {
    pixelValidation: boolean;
    clipboardPasteMultiline: boolean;
    mouseAnimation: boolean;
    hideBeforeAction: boolean;
    autoTargetDisplay: boolean;
    clipboardGuard: boolean;
  };

  export type DisplayGeometry = {
    displayId: number;
    width: number;
    height: number;
    scaleFactor: number;
    originX: number;
    originY: number;
    label?: string;
    isPrimary?: boolean;
  };

  export type ScreenshotResult = {
    base64: string;
    width: number;
    height: number;
    displayWidth: number;
    displayHeight: number;
    originX: number;
    originY: number;
    displayId?: number;
    accessibilityText?: string;
  };

  export type ScreenshotDims = Omit<ScreenshotResult, "base64">;

  export type FrontmostApp = {
    bundleId: string;
    displayName: string;
  };

  export type InstalledApp = {
    bundleId: string;
    displayName: string;
    path: string;
    iconDataUrl?: string;
  };

  export type RunningApp = {
    bundleId: string;
    displayName: string;
    pid?: number;
  };

  export type ResolvePrepareCaptureResult = ScreenshotResult & {
    hidden: string[];
    activated?: string;
    displayId: number;
    captureError?: string;
  };

  export type ComputerExecutorCapabilities = {
    screenshotFiltering: "native" | "none" | "mask";
    platform: "darwin" | "win32";
    hostBundleId: string;
  };

  export type ComputerExecutor = {
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
    typePaced?(text: string, opts?: unknown): Promise<void>;
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
  };

  export type Logger = {
    info: (message: string, detail?: unknown) => void;
    error: (message: string, detail?: unknown) => void;
    warn: (message: string, detail?: unknown) => void;
    debug: (message: string, detail?: unknown) => void;
    silly?: (message: string, detail?: unknown) => void;
  };

  export type ComputerUseHostAdapter = {
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
  };

  export type ComputerUseSessionContext = {
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
    checkCuLock?(): Promise<{ holder: string | undefined; isSelf: boolean }>;
    acquireCuLock?(): Promise<void>;
    formatLockHeldMessage?(holder: string): string;
    isAborted?(): boolean;
  };

  export type CuErrorKind =
    | "allowlist_empty"
    | "tcc_not_granted"
    | "cu_lock_held"
    | "teach_mode_conflict"
    | "teach_mode_not_active"
    | "executor_threw"
    | "capture_failed"
    | "app_denied"
    | "bad_args"
    | "app_not_granted"
    | "tier_insufficient"
    | "feature_unavailable"
    | "state_conflict"
    | "grant_flag_required"
    | "display_error"
    | "launch_failed"
    | "element_not_found"
    | "other";

  export type CuCallTelemetry = {
    granted_count?: number;
    denied_count?: number;
    denied_browser_count?: number;
    denied_terminal_count?: number;
    error_kind?: CuErrorKind;
  };

  export type CuCallToolResult = {
    content: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          data: string;
          mimeType: string;
        }
      | Record<string, unknown>
    >;
    isError?: boolean;
    screenshot?: ScreenshotResult;
    telemetry?: CuCallTelemetry;
  };

  export type ComputerUseToolSchema = {
    description?: string;
    name: string;
    inputSchema?: unknown;
  };

  export type ResizeParams = {
    maxDimension?: number;
    maxPixels?: number;
  };

  export const DEFAULT_GRANT_FLAGS: CuGrantFlags;
  export const ALL_SUB_GATES_ON: CuSubGates;
  export const ALL_SUB_GATES_OFF: CuSubGates;
  export const API_RESIZE_PARAMS: ResizeParams;

  export function targetImageSize(
    width: number,
    height: number,
    params?: ResizeParams,
  ): [number, number];

  export function buildComputerUseTools(
    caps: {
      platform: "darwin" | "win32" | "linux";
      screenshotFiltering: "native" | "none" | "mask";
      teachMode?: boolean;
    },
    coordinateMode: CoordinateMode | "pixels" | "normalized",
    installedAppNames?: string[],
  ): ComputerUseToolSchema[];

  export function bindSessionContext(
    adapter: ComputerUseHostAdapter,
    coordinateMode: CoordinateMode,
    ctx: ComputerUseSessionContext,
  ): (name: string, args: unknown) => Promise<CuCallToolResult>;

  export function handleToolCall(
    adapter: ComputerUseHostAdapter,
    name: string,
    args: unknown,
    overrides: Record<string, unknown>,
  ): Promise<CuCallToolResult>;

  export function defersLockAcquire(name: string): boolean;
}
