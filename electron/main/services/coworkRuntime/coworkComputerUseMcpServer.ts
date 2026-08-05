/**
 * Official residual (app.asar):
 *   lZe = "computer-use"
 *   uoA() = platform ∈ {darwin, win32}
 *   YM()  = uoA() && doA() && gi("chicagoEnabled")
 *   QHA() = uoA() && doA() && !gi("chicagoEnabled")
 *   fZe() = platform && doA (stub tools when feature gate) / YM when not
 *   gFi(e) → { serverName:lZe, tools, isEnabled:JQe.isEnabled, handleToolCall:JQe.handleToolCall }
 *   CFi  → synthesize computer:request_access with featureDisabled:true (+ tccState)
 *           via onComputerUsePermissionRequest when QHA()
 *   createComputerUsePermissionHandler → toolName "computer:request_access"
 *   koA()/cTi + ddi/bindSessionContext → native executor handleToolCall (Darwin)
 *
 * Product host-loop path: inject SDK MCP so the model can call request_access and
 * the renderer Age/Uge/Oge panels receive tool_permission_request events.
 * Action tools route through @ant/computer-use-mcp bindSessionContext when Darwin
 * natives load; otherwise honest refuse (no invent screenshots).
 */
import { randomUUID } from "node:crypto";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  bindSessionContext,
  buildComputerUseTools,
  DEFAULT_GRANT_FLAGS,
  type AppGrant,
  type ComputerUseHostAdapter,
  type ComputerUseSessionContext,
  type CuGrantFlags,
  type CuPermissionRequest,
  type CuPermissionResponse,
  type CuSubGates,
  type ScreenshotDims,
} from "@ant/computer-use-mcp";
import {
  getComputerUseTccState,
  type ComputerUseTccState,
  type TccGrantState,
} from "../tcc/computerUseTcc";
import {
  createComputerUseHostAdapter,
  isComputerUseNativeAvailable,
} from "./computerUseDarwinExecutor";
import {
  getComputerUseCoordinateMode,
  getComputerUseSubGates,
  getComputerUseTeachModeEnabled,
} from "./computerUseChicagoConfig";
import {
  enumerateInstalledAppNamesForTools,
  getCachedInstalledAppNamesForTools,
} from "./computerUseAppEnumeration";
import {
  applySaveToDiskScreenshotNote,
  type PersistScreenshotForDispatch,
} from "./computerUseScreenshotPersist";

/** Official lZe */
export const COWORK_COMPUTER_USE_MCP_NAME = "computer-use";

/** Official tool surface names used by permission UI (not raw MCP names). */
export const COWORK_COMPUTER_REQUEST_ACCESS_TOOL = "computer:request_access";
export const COWORK_COMPUTER_REQUEST_TEACH_ACCESS_TOOL =
  "computer:request_teach_access";

export type CoworkComputerUsePermissionHandler = (
  request: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<CuPermissionResponse>;

export type CoworkComputerUseMcpOptions = {
  /**
   * Official gi("chicagoEnabled"). When false on supported platforms → QHA stub
   * path (CFi enable prompt).
   */
  isChicagoEnabled: () => boolean;
  /**
   * Official createComputerUsePermissionHandler / onComputerUsePermissionRequest.
   * Maps to LocalAgentModeSessions permission broker with toolName computer:request_*.
   */
  onPermissionRequest: CoworkComputerUsePermissionHandler;
  onTeachPermissionRequest?: CoworkComputerUsePermissionHandler;
  /** Optional live TCC probe (official dMA / ensureOsPermissions). */
  getTccState?: () => ComputerUseTccState | Promise<ComputerUseTccState>;
  /**
   * Official IFi getAllowedApps / session.cuAllowedApps.
   * When empty, ddi residual refuses action tools until request_access.
   */
  getAllowedApps?: () => readonly AppGrant[] | AppGrant[] | undefined;
  /**
   * Official IFi getGrantFlags / session.cuGrantFlags.
   * Defaults to DEFAULT_GRANT_FLAGS (Jp residual) when unset.
   */
  getGrantFlags?: () => CuGrantFlags | undefined;
  /**
   * Official onCuPermissionUpdated residual after bindSessionContext merge.
   */
  onAllowedAppsChanged?: (
    apps: readonly AppGrant[],
    flags: CuGrantFlags,
  ) => void;
  /** Official IFi getUserDeniedBundleIds / gi("chicagoUserDeniedBundleIds"). */
  getUserDeniedBundleIds?: () => readonly string[];
  getSelectedDisplayId?: () => number | undefined;
  getDisplayPinnedByModel?: () => boolean;
  getDisplayResolvedForApps?: () => string | undefined;
  getTeachModeActive?: () => boolean;
  /**
   * Official IFi onTeachModeActivated — set after teach permission with
   * userConsented===true (package residual).
   */
  onTeachModeActivated?: () => void;
  /**
   * Official IFi onTeachStep — blocking promise until overlay next/exit.
   */
  onTeachStep?: (req: {
    explanation: string;
    nextPreview: string;
    anchorLogical?: { x: number; y: number };
  }) => Promise<{ action: "next" } | { action: "exit" }>;
  /**
   * Official IFi onTeachWorking residual.
   */
  onTeachWorking?: () => void;
  getLastScreenshotDims?: () => ScreenshotDims | undefined;
  onScreenshotCaptured?: (dims: ScreenshotDims) => void;
  onAppsHidden?: (bundleIds: string[]) => void;
  getClipboardStash?: () => string | undefined;
  onClipboardStashChanged?: (stash: string | undefined) => void;
  onResolvedDisplayUpdated?: (displayId: number) => void;
  onDisplayPinned?: (displayId: number | undefined) => void;
  onDisplayResolvedForApps?: (sortedBundleIdsKey: string) => void;
  checkCuLock?: () => Promise<{ holder: string | undefined; isSelf: boolean }>;
  acquireCuLock?: () => Promise<void>;
  isAborted?: () => boolean;
  /**
   * Official package residual getHiddenPendingNote / drainHiddenPendingNote.
   * Product tracks Sets on session (cuHiddenPendingNote).
   */
  getHiddenPendingNote?: () => string[];
  drainHiddenPendingNote?: () => void;
  /**
   * Official gi("chicagoAutoUnhide") for host adapter getAutoUnhideEnabled.
   * Default true when unset (matches SSA chicagoAutoUnhide).
   */
  getAutoUnhideEnabled?: () => boolean;
  /** Official screenshotFiltering capability residual (darwin native / win mask). */
  screenshotFiltering?: "native" | "none" | "mask";
  /**
   * Inject host adapter for tests. Production builds via createComputerUseHostAdapter.
   */
  hostAdapter?: ComputerUseHostAdapter | null;
  /**
   * Coordinate mode residual (oq / chicago_config.coordinateMode). Default from
   * getComputerUseCoordinateMode() → "pixels" when unset.
   */
  coordinateMode?: "pixels" | "normalized_0_100";
  /**
   * Official $5 sub-gates inject for host adapter. Default getComputerUseSubGates().
   */
  getSubGates?: () => CuSubGates;
  /**
   * Official pZe teachMode for buildComputerUseTools. Default getComputerUseTeachModeEnabled().
   */
  teachModeEnabled?: boolean;
  /**
   * Official sFi/aFi installed app names for request_access description.
   * When omitted, product attempts Darwin executor prewarm once (1s race).
   * Pass [] to force omit list without prewarm (tests).
   */
  installedAppNames?: string[];
  /**
   * Official persistScreenshotForDispatch residual for h9e when save_to_disk.
   * Host-loop writes under session outputsDir.
   */
  persistScreenshotForDispatch?: PersistScreenshotForDispatch;
};

const SAFETY_RULES_NOTE = `

IMPORTANT — safety rules now in effect:

Computer use can control apps you allow. Prefer tasks where mistakes are easy to fix.`;

function isSupportedPlatform(
  platform: NodeJS.Platform = process.platform,
): boolean {
  // Official uoA / QoA
  return platform === "darwin" || platform === "win32";
}

/** Official YM() without inventing doA growthbook — product treats doA as true on supported OS. */
export function isCoworkComputerUseFullyEnabled(
  isChicagoEnabled: boolean,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return isSupportedPlatform(platform) && isChicagoEnabled;
}

/** Official QHA() */
export function isCoworkComputerUseEnablePromptPath(
  isChicagoEnabled: boolean,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return isSupportedPlatform(platform) && !isChicagoEnabled;
}

function textResult(message: string, isError = true) {
  return {
    content: [{ type: "text" as const, text: message }],
    ...(isError ? { isError: true as const } : {}),
  };
}

function tccGranted(state: ComputerUseTccState): boolean {
  if (process.platform !== "darwin") return true;
  return (
    state.accessibility === "granted" && state.screenRecording === "granted"
  );
}

function mapTccForUi(state: ComputerUseTccState): {
  accessibility: TccGrantState;
  screenRecording: TccGrantState;
} {
  return {
    accessibility: state.accessibility,
    screenRecording: state.screenRecording,
  };
}

/**
 * Official CFi residual when QHA():
 * show enable prompt via onComputerUsePermissionRequest(featureDisabled:true).
 *
 * Official only auto-opens the dialog for `request_access`; other tools get
 * "Call request_access…". Product host-loop also opens the dialog for action
 * tools (screenshot/click/…) so the user still sees Uge when the model skips
 * request_access — matches official UX of an in-chat permission card rather
 * than a raw API failure string.
 */
export async function handleCoworkComputerUseFeatureDisabledCall(
  toolName: string,
  args: Record<string, unknown>,
  options: {
    getTccState?: () => ComputerUseTccState | Promise<ComputerUseTccState>;
    isChicagoEnabled: () => boolean;
    onPermissionRequest: CoworkComputerUsePermissionHandler;
    screenshotFiltering: "native" | "none" | "mask";
  },
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const tcc = await Promise.resolve(
    options.getTccState?.() ?? getComputerUseTccState(),
  );
  const reason =
    typeof args.reason === "string" ? args.reason.trim() : "";
  const input: Record<string, unknown> = {
    requestId: randomUUID(),
    reason,
    apps: [],
    requestedFlags: {},
    screenshotFiltering: options.screenshotFiltering,
    featureDisabled: true,
  };
  if (!tccGranted(tcc)) {
    input.tccState = mapTccForUi(tcc);
  }

  const abort = new AbortController();
  try {
    await options.onPermissionRequest(input, abort.signal);
  } finally {
    abort.abort();
  }

  // Re-read pref after user decision (Uge may have set chicagoEnabled true).
  if (!options.isChicagoEnabled()) {
    if (toolName !== "request_access") {
      // Residual non-request_access guidance after user denied enable.
      return textResult(
        "Computer Use is available but not yet enabled. Call request_access to show the user an in-chat enable prompt.",
      );
    }
    return textResult(
      "The user saw the enable prompt and chose not to turn on Computer Use. Do not retry in this turn. Let the user know you can't complete this without computer use and offer an alternative if one exists. If the user sends a new request that requires computer use, you may call request_access again.",
    );
  }

  const after = await Promise.resolve(
    options.getTccState?.() ?? getComputerUseTccState(),
  );
  if (tccGranted(after)) {
    return textResult(
      "Computer Use is now enabled. Call request_access again to select which applications Claude may control." +
        SAFETY_RULES_NOTE,
    );
  }
  const missing: string[] = [];
  if (after.accessibility !== "granted") missing.push("Accessibility");
  if (after.screenRecording !== "granted") missing.push("Screen Recording");
  return textResult(
    `Computer Use is now enabled, but ${missing.join(" and ")} permission(s) are not yet granted. These need to be granted in the Claude desktop app. Once the user grants them, call request_access again to select applications.` +
      SAFETY_RULES_NOTE,
  );
}

/** Official MVe residual — tools that may run with an empty app allowlist. */
function isComputerUsePermissionlessTool(name: string): boolean {
  return (
    name === "request_access"
    || name === "request_teach_access"
    || name === "list_granted_applications"
  );
}

function appsFromArgs(args: Record<string, unknown>): CuPermissionRequest["apps"] {
  const names = Array.isArray(args.apps)
    ? args.apps.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  return names.map((requestedName) => ({
    alreadyGranted: false,
    isSentinel: false,
    proposedTier: "full" as const,
    requestedName,
    // Residual: no app enumeration / icon resolve until native host adapter wired.
    resolved: undefined,
  }));
}

function requestedFlagsFromArgs(args: Record<string, unknown>) {
  return {
    clipboardRead: args.clipboardRead === true,
    clipboardWrite: args.clipboardWrite === true,
    systemKeyCombos: args.systemKeyCombos === true,
  };
}

/**
 * Official createComputerUsePermissionHandler shape for enabled chicago path:
 * permission toolName is computer:request_access (not mcp__…).
 */
async function handleEnabledRequestAccess(
  args: Record<string, unknown>,
  options: CoworkComputerUseMcpOptions,
  screenshotFiltering: "native" | "none" | "mask",
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const tcc = await Promise.resolve(
    options.getTccState?.() ?? getComputerUseTccState(),
  );
  if (!tccGranted(tcc)) {
    const input: Record<string, unknown> = {
      requestId: randomUUID(),
      reason: typeof args.reason === "string" ? args.reason.trim() : "",
      apps: [],
      requestedFlags: {},
      screenshotFiltering,
      featureDisabled: false,
      tccState: mapTccForUi(tcc),
    };
    const abort = new AbortController();
    try {
      await options.onPermissionRequest(input, abort.signal);
    } finally {
      abort.abort();
    }
    const after = await Promise.resolve(
      options.getTccState?.() ?? getComputerUseTccState(),
    );
    if (!tccGranted(after)) {
      return textResult(
        "System permissions are still required for Computer Use. Ask the user to grant Accessibility and Screen Recording, then call request_access again.",
      );
    }
  }

  const apps = appsFromArgs(args);
  const flags = requestedFlagsFromArgs(args);
  const input: Record<string, unknown> = {
    requestId: randomUUID(),
    reason: typeof args.reason === "string" ? args.reason.trim() : "",
    apps,
    requestedFlags: flags,
    screenshotFiltering,
    willHide: [],
    autoUnhideEnabled: true,
  };

  const abort = new AbortController();
  let response: CuPermissionResponse;
  try {
    response = await options.onPermissionRequest(input, abort.signal);
  } finally {
    abort.abort();
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          granted: response.granted,
          denied: response.denied,
          flags: response.flags,
          screenshotFiltering,
          note:
            response.granted.length > 0
              ? "Access granted for this session. Computer-use actions may now proceed via the native host residual."
              : "User denied computer use for the requested applications.",
        }),
      },
    ],
    isError: response.granted.length === 0,
  };
}

/**
 * SDK `tool()` wants a Zod raw shape. Residual CU tools accept free-form
 * objects; keep a permissive shape so request_access + later action tools
 * still parse without inventing strict product validation.
 *
 * Official hMA residual: `apps` property description may include the aFi
 * installed-app enumeration (`Available applications on this machine: …`).
 * Per-tool shape must carry residual property descriptions — a shared shape
 * without `.describe()` drops the first-packet app list from model schema.
 */
const computerUseToolShapeBase = {
  actions: z.array(z.unknown()).optional(),
  app: z.string().optional(),
  apps: z.array(z.string()).optional(),
  bundle_id: z.string().optional(),
  clipboardRead: z.boolean().optional(),
  clipboardWrite: z.boolean().optional(),
  coordinate: z.array(z.number()).optional(),
  display_id: z.number().optional(),
  duration: z.number().optional(),
  reason: z.string().optional(),
  region: z.array(z.number()).optional(),
  save_to_disk: z.boolean().optional(),
  start_coordinate: z.array(z.number()).optional(),
  systemKeyCombos: z.boolean().optional(),
  text: z.string().optional(),
};

type ResidualToolSchema = {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, { description?: string } | undefined>;
  };
};

/** Preserve residual property descriptions (esp. apps + aFi hint) on Zod shape. */
export function computerUseToolShapeForResidual(schema: ResidualToolSchema) {
  const appsDesc = schema.inputSchema?.properties?.apps?.description;
  const reasonDesc = schema.inputSchema?.properties?.reason?.description;
  if (!appsDesc && !reasonDesc) return computerUseToolShapeBase;
  return {
    ...computerUseToolShapeBase,
    ...(appsDesc
      ? { apps: z.array(z.string()).optional().describe(appsDesc) }
      : {}),
    ...(reasonDesc
      ? { reason: z.string().optional().describe(reasonDesc) }
      : {}),
  };
}

/**
 * Official IFi session context bag for ddi/bindSessionContext.
 */
function buildSessionContext(
  options: CoworkComputerUseMcpOptions,
): ComputerUseSessionContext {
  return {
    getAllowedApps: () => {
      const apps = options.getAllowedApps?.() ?? [];
      return Array.isArray(apps) ? apps : [];
    },
    getGrantFlags: () =>
      options.getGrantFlags?.() ?? { ...DEFAULT_GRANT_FLAGS },
    getUserDeniedBundleIds: () => options.getUserDeniedBundleIds?.() ?? [],
    getSelectedDisplayId: () => options.getSelectedDisplayId?.(),
    getDisplayPinnedByModel: options.getDisplayPinnedByModel,
    getDisplayResolvedForApps: options.getDisplayResolvedForApps,
    getTeachModeActive: options.getTeachModeActive,
    getLastScreenshotDims: options.getLastScreenshotDims,
    // Product handlers accept residual free-form request bags (featureDisabled etc.);
    // package types are stricter CuPermissionRequest — cast at bind boundary.
    onPermissionRequest: options.onPermissionRequest as unknown as ComputerUseSessionContext["onPermissionRequest"],
    onTeachPermissionRequest:
      options.onTeachPermissionRequest as unknown as ComputerUseSessionContext["onTeachPermissionRequest"],
    // Official IFi onTeach* residual for bindSessionContext.
    onTeachModeActivated: options.onTeachModeActivated,
    onTeachStep: options.onTeachStep as ComputerUseSessionContext["onTeachStep"],
    onTeachWorking: options.onTeachWorking,
    onAllowedAppsChanged: options.onAllowedAppsChanged,
    onAppsHidden: options.onAppsHidden,
    getClipboardStash: options.getClipboardStash,
    onClipboardStashChanged: options.onClipboardStashChanged,
    onResolvedDisplayUpdated: options.onResolvedDisplayUpdated,
    onDisplayPinned: options.onDisplayPinned,
    onDisplayResolvedForApps: options.onDisplayResolvedForApps,
    onScreenshotCaptured: options.onScreenshotCaptured,
    checkCuLock: options.checkCuLock,
    acquireCuLock: options.acquireCuLock,
    formatLockHeldMessage: () =>
      "Another Claude session is currently using the computer. Wait for the user to acknowledge it is finished (stop button in the Claude window), or find a non-computer-use approach if one is readily apparent.",
    isAborted: options.isAborted,
    // Official package optional residual — product Sets on session.
    getHiddenPendingNote: options.getHiddenPendingNote,
    drainHiddenPendingNote: options.drainHiddenPendingNote,
  };
}

/**
 * Official EFi residual: cache bindSessionContext dispatcher per options identity.
 * Product caches one dispatcher lazily on first action after enable.
 */
function getOrCreateBoundDispatcher(
  options: CoworkComputerUseMcpOptions,
  adapter: ComputerUseHostAdapter,
  coordinateMode: "pixels" | "normalized_0_100",
): (name: string, args: unknown) => Promise<{
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
  telemetry?: unknown;
  screenshot?: unknown;
}> {
  return bindSessionContext(
    adapter,
    coordinateMode,
    buildSessionContext(options),
  ) as (name: string, args: unknown) => Promise<{
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
    telemetry?: unknown;
    screenshot?: unknown;
  }>;
}

/**
 * Official gFi residual as createSdkMcpServer for product host-loop mcpServers.
 * Tools alwaysLoad so request_access is visible even when chicagoEnabled is false.
 * Action tools: official JQe → EFi/ddi/bindSessionContext when Darwin host adapter loads.
 */
export function createCoworkComputerUseMcpServerConfig(
  options: CoworkComputerUseMcpOptions,
) {
  if (!isSupportedPlatform()) {
    return null;
  }

  // Official residual: darwin → native compositor exclude; win32 → mask rects.
  const screenshotFiltering: "native" | "none" | "mask" =
    options.screenshotFiltering ??
    (process.platform === "win32" ? "mask" : "native");
  // Official oq residual — frozen at MCP construction like official hMA/oq.
  const coordinateMode =
    options.coordinateMode ?? getComputerUseCoordinateMode();
  // Official pZe residual for teach tools in schema.
  const teachMode =
    options.teachModeEnabled ?? getComputerUseTeachModeEnabled();

  // Official sFi/aFi → installedAppNames for request_access description.
  // Sync construct uses explicit inject or empty; async prewarm upgrades cache
  // for subsequent builds. First call may omit list (official also omits on timeout).
  const installedAppNames =
    options.installedAppNames !== undefined
      ? options.installedAppNames
      : undefined;

  // Official hMA / buildComputerUseTools — schema source of truth.
  const residualTools = buildComputerUseTools(
    {
      platform: process.platform === "win32" ? "win32" : "darwin",
      screenshotFiltering,
      teachMode,
    },
    coordinateMode,
    installedAppNames && installedAppNames.length > 0
      ? installedAppNames
      : undefined,
  );

  // Kick official aFi prewarm when chicago on and no explicit list (fire-and-forget).
  // Darwin: listInstalledApps via claude-swift; Win32: AUMID cache via PE.
  if (
    options.installedAppNames === undefined &&
    options.hostAdapter === undefined &&
    options.isChicagoEnabled() &&
    (process.platform === "darwin" || process.platform === "win32")
  ) {
    void getCachedInstalledAppNamesForTools(async () => {
      const adapter = createComputerUseHostAdapter({
        isChicagoEnabled: options.isChicagoEnabled,
        getAutoUnhideEnabled: () => options.getAutoUnhideEnabled?.() ?? true,
        getSubGates: options.getSubGates ?? getComputerUseSubGates,
      });
      if (!adapter?.executor?.listInstalledApps) return undefined;
      return enumerateInstalledAppNamesForTools({
        listInstalledApps: () => adapter.executor.listInstalledApps(),
        listRunningApps: adapter.executor.listRunningApps
          ? () => adapter.executor.listRunningApps()
          : undefined,
      });
    }).catch(() => undefined);
  }

  // Official koA host adapter — lazy so missing natives don't block MCP inject.
  let hostAdapter: ComputerUseHostAdapter | null | undefined =
    options.hostAdapter !== undefined ? options.hostAdapter : undefined;
  let boundDispatcher:
    | ((name: string, args: unknown) => Promise<{
        content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
        isError?: boolean;
        telemetry?: unknown;
        screenshot?: unknown;
      }>)
    | null = null;

  const resolveHostAdapter = (): ComputerUseHostAdapter | null => {
    if (hostAdapter !== undefined) return hostAdapter;
    hostAdapter = createComputerUseHostAdapter({
      isChicagoEnabled: options.isChicagoEnabled,
      // Official gi("chicagoAutoUnhide") → adapter.getAutoUnhideEnabled (default true).
      getAutoUnhideEnabled: () => options.getAutoUnhideEnabled?.() ?? true,
      // Official $5 residual.
      getSubGates: options.getSubGates ?? getComputerUseSubGates,
    });
    return hostAdapter;
  };

  const handle = async (name: string, args: Record<string, unknown>) => {
    // Official JQe.handleToolCall: if QHA() → CFi (enable prompt) for any tool.
    if (isCoworkComputerUseEnablePromptPath(options.isChicagoEnabled())) {
      return handleCoworkComputerUseFeatureDisabledCall(name, args, {
        getTccState: options.getTccState,
        isChicagoEnabled: options.isChicagoEnabled,
        onPermissionRequest: options.onPermissionRequest,
        screenshotFiltering,
      });
    }

    // Official EFi/ddi path when host adapter available (Darwin cTi residual).
    const adapter = resolveHostAdapter();
    if (adapter) {
      if (!boundDispatcher) {
        boundDispatcher = getOrCreateBoundDispatcher(
          options,
          adapter,
          coordinateMode,
        );
      }
      try {
        // Official JQe strips save_to_disk before dispatch; h9e after when true.
        const { save_to_disk: saveToDisk, ...dispatchArgs } = args;
        const result = await boundDispatcher(name, dispatchArgs);
        // Strip piggybacked screenshot/telemetry for MCP content return.
        const { screenshot: _shot, telemetry: _tel, ...mcpResult } = result;
        void _shot;
        void _tel;
        const content = (mcpResult.content ?? []) as Array<{
          type: string;
          text?: string;
          data?: string;
          mimeType?: string;
        }>;
        const out = {
          content,
          ...(mcpResult.isError ? { isError: true as const } : {}),
        };
        // Official h9e residual — only screenshot/zoom + save_to_disk true.
        if (
          (name === "screenshot" || name === "zoom") &&
          saveToDisk === true
        ) {
          await applySaveToDiskScreenshotNote(
            out,
            options.persistScreenshotForDispatch,
          );
        }
        // MCP tool result for SDK: text/image content parts.
        return {
          content: out.content as Array<{ type: "text"; text: string }>,
          ...(out.isError ? { isError: true as const } : {}),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return textResult(
          `Computer use action failed: ${message}. Prefer a non-computer-use approach if one exists.`,
        );
      }
    }

    // Host adapter unavailable (win32 not productized / natives missing).
    // Keep request_access / list_granted / teach permission UX; refuse actions honestly.
    if (name === "request_access") {
      return handleEnabledRequestAccess(args, options, screenshotFiltering);
    }

    if (name === "request_teach_access") {
      const handler =
        options.onTeachPermissionRequest ?? options.onPermissionRequest;
      const apps = appsFromArgs(args);
      const input: Record<string, unknown> = {
        requestId: randomUUID(),
        reason: typeof args.reason === "string" ? args.reason.trim() : "",
        apps,
        requestedFlags: {},
        screenshotFiltering,
      };
      const abort = new AbortController();
      try {
        const response = await handler(input, abort.signal);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                granted: response.granted,
                denied: response.denied,
              }),
            },
          ],
          isError: response.granted.length === 0,
        };
      } finally {
        abort.abort();
      }
    }

    if (name === "list_granted_applications") {
      const apps = options.getAllowedApps?.() ?? [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ apps }),
          },
        ],
      };
    }

    // Official ddi residual (MVe / allowlist_empty) without native executor:
    // still surface permission card; then honest refuse (no invent screenshots).
    if (!isComputerUsePermissionlessTool(name)) {
      const allowed = options.getAllowedApps?.() ?? [];
      if (!Array.isArray(allowed) || allowed.length === 0) {
        await handleEnabledRequestAccess(
          {
            reason:
              typeof args.reason === "string"
                ? args.reason
                : `Required for computer-use tool "${name}"`,
            apps: Array.isArray(args.apps) ? args.apps : [],
          },
          options,
          screenshotFiltering,
        );
        const after = options.getAllowedApps?.() ?? [];
        if (!Array.isArray(after) || after.length === 0) {
          return textResult(
            "No applications are granted for this session. Call request_access first.",
          );
        }
        return textResult(
          "Application access was updated for this session. Call the previous computer-use action again.",
        );
      }
      // Natives missing after grants — official would execute via cTi; product refuses.
      return textResult(
        "Computer use native host is unavailable on this desktop build (claude-swift computerUse / claude-native). Prefer a non-computer-use approach if one exists.",
      );
    }

    return textResult(
      "No applications are granted for this session. Call request_access first.",
    );
  };

  const tools = residualTools.map((schema: ResidualToolSchema) => {
    const description =
      typeof schema.description === "string" ? schema.description : schema.name;
    return tool(
      schema.name,
      description,
      computerUseToolShapeForResidual(schema),
      async (args) => handle(schema.name, (args ?? {}) as Record<string, unknown>),
      // Official rG residual: alwaysLoad tools when computer-use is injected.
      { alwaysLoad: true },
    );
  });

  return createSdkMcpServer({
    // Official createSdkMcpServer alwaysLoad residual (skills/plugins path).
    alwaysLoad: true,
    name: COWORK_COMPUTER_USE_MCP_NAME,
    tools,
  });
}

/** Re-export probe for callers / tests. */
export { isComputerUseNativeAvailable };

/**
 * Official createComputerUsePermissionHandler(A) for manager wiring:
 * maps CuPermissionRequest → computer:request_access via requestPermission.
 */
export function createCoworkComputerUsePermissionHandler(deps: {
  requestPermission: (options: {
    input: unknown;
    sessionId: string;
    signal?: AbortSignal;
    suggestions?: unknown[];
    toolName: string;
  }) => Promise<{
    behavior: "allow" | "deny";
    updatedInput?: unknown;
  }>;
  sessionId: string;
}): CoworkComputerUsePermissionHandler {
  return async (request, signal) => {
    const toolName = COWORK_COMPUTER_REQUEST_ACCESS_TOOL;
    const input = { ...request };
    delete (input as { _cuGrants?: unknown })._cuGrants;
    const resolution = await deps.requestPermission({
      input,
      sessionId: deps.sessionId,
      signal,
      suggestions: [
        {
          type: "addRules",
          rules: [{ toolName }],
          behavior: "allow",
          destination: "session",
        },
      ],
      toolName,
    });
    if (resolution.behavior !== "allow") {
      const apps = Array.isArray(request.apps) ? request.apps : [];
      return {
        granted: [],
        denied: apps.map((app) => {
          const row = app as {
            resolved?: { bundleId?: string };
            requestedName?: string;
          };
          return {
            bundleId: row.resolved?.bundleId ?? row.requestedName ?? "unknown",
            reason: "user_denied" as const,
          };
        }),
        flags: { ...DEFAULT_GRANT_FLAGS },
      };
    }
    const updated =
      resolution.updatedInput && typeof resolution.updatedInput === "object"
        ? (resolution.updatedInput as Record<string, unknown>)
        : undefined;
    const grants = updated?._cuGrants as CuPermissionResponse | undefined;
    if (grants && Array.isArray(grants.granted)) {
      return {
        granted: grants.granted,
        denied: grants.denied ?? [],
        flags: {
          clipboardRead: grants.flags?.clipboardRead === true,
          clipboardWrite: grants.flags?.clipboardWrite === true,
          systemKeyCombos: grants.flags?.systemKeyCombos === true,
        },
      };
    }
    // Standard-prompt fallback (official createComputerUsePermissionHandler).
    const apps = Array.isArray(request.apps) ? request.apps : [];
    const grantedAt = Date.now();
    const granted = [];
    const denied = [];
    for (const app of apps) {
      const row = app as {
        alreadyGranted?: boolean;
        proposedTier?: "read" | "click" | "full";
        requestedName?: string;
        resolved?: { bundleId?: string; displayName?: string };
      };
      if (row.alreadyGranted) continue;
      if (row.resolved?.bundleId && row.resolved.displayName) {
        granted.push({
          bundleId: row.resolved.bundleId,
          displayName: row.resolved.displayName,
          grantedAt,
          tier: row.proposedTier ?? "full",
        });
      } else if (row.requestedName) {
        denied.push({
          bundleId: row.requestedName,
          reason: "not_installed" as const,
        });
      }
    }
    return {
      granted,
      denied,
      flags: { ...DEFAULT_GRANT_FLAGS },
    };
  };
}
