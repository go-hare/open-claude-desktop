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
 *
 * Product host-loop path: inject SDK MCP so the model can call request_access and
 * the renderer Age/Uge/Oge panels receive tool_permission_request events.
 * Full native executor / claude-swift residual stays optional after enable.
 */
import { randomUUID } from "node:crypto";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  buildComputerUseTools,
  type CuPermissionRequest,
  type CuPermissionResponse,
} from "@ant/computer-use-mcp";
import {
  getComputerUseTccState,
  type ComputerUseTccState,
  type TccGrantState,
} from "../tcc/computerUseTcc";

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
  getAllowedApps?: () => unknown[] | undefined;
  /** Official screenshotFiltering capability residual. */
  screenshotFiltering?: "native" | "none";
};

const DEFAULT_GRANT_FLAGS = {
  clipboardRead: false,
  clipboardWrite: false,
  systemKeyCombos: false,
} as const;

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
    screenshotFiltering: "native" | "none";
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
  screenshotFiltering: "native" | "none",
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
              ? "Access granted for this session. Other computer-use actions still require a full native host adapter residual."
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
 */
const computerUseToolShape = {
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

/**
 * Official gFi residual as createSdkMcpServer for product host-loop mcpServers.
 * Tools alwaysLoad so request_access is visible even when chicagoEnabled is false.
 */
export function createCoworkComputerUseMcpServerConfig(
  options: CoworkComputerUseMcpOptions,
) {
  if (!isSupportedPlatform()) {
    return null;
  }

  const screenshotFiltering: "native" | "none" =
    options.screenshotFiltering ??
    (process.platform === "win32" ? "none" : "native");

  // Official hMA / buildComputerUseTools — schema source of truth.
  const residualTools = buildComputerUseTools(
    {
      platform: process.platform === "win32" ? "win32" : "darwin",
      screenshotFiltering,
      teachMode: true,
    },
    "pixels",
  );

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

    // Official ddi residual (MVe / allowlist_empty):
    // action tools with no session grants → "Call request_access first."
    // Product also surfaces the Oge/Fge permission card so the user sees a
    // dialog (not only a tool-result string) — matching official in-chat UX.
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
          // Official allowlist_empty telemetry residual text.
          return textResult(
            "No applications are granted for this session. Call request_access first.",
          );
        }
        // Grants may now exist; model should retry the action.
        return textResult(
          "Application access was updated for this session. Call the previous computer-use action again.",
        );
      }
      // Session already has grants. Full cTi/ddi native executor residual is
      // still incomplete in product host-loop — refuse honestly without
      // inventing a product-only "not fully wired" API failure as primary UX.
      // Official path would execute via claude-swift; do not invent screenshots.
      return textResult(
        "Computer use actions could not be completed on the desktop host for this session. Prefer a non-computer-use approach if one exists, or call request_access if application access still needs approval.",
      );
    }

    return textResult(
      "No applications are granted for this session. Call request_access first.",
    );
  };

  const tools = residualTools.map((schema: { description?: string; name: string }) => {
    const description =
      typeof schema.description === "string" ? schema.description : schema.name;
    return tool(
      schema.name,
      description,
      computerUseToolShape,
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
