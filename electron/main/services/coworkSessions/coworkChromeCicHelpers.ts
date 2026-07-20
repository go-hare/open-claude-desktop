/**
 * Official CIC / Claude-in-Chrome pure helpers (app.asar).
 * Anchors: E_, gBe, cLi, K1e, Lai/N5 — used by aze canUseTool CIC path.
 * Residual: full aze canUseTool / Chrome MCP server product not invented.
 */

import type { CoworkChromePermissionMode } from "./coworkSessionTypes";
import type { CoworkPermissionMode } from "./coworkSessionTypes";

/** Official Lai = "Claude_in_Chrome" */
export const COWORK_CHROME_MCP_SERVER_NAME = "Claude_in_Chrome" as const;

/** Official N5 = `mcp__${Lai}__` */
export const COWORK_CHROME_MCP_TOOL_PREFIX =
  `mcp__${COWORK_CHROME_MCP_SERVER_NAME}__` as const;

/**
 * Official K1e — CIC tools that are always permissionless (no chrome mode gate).
 */
export const COWORK_CHROME_PERMISSIONLESS_TOOLS = new Set<string>([
  "tabs_context_mcp",
  "tabs_create_mcp",
  "tabs_close_mcp",
  "shortcuts_list",
  "shortcuts_execute",
  "resize_window",
  "switch_browser",
  "list_connected_browsers",
  "gif_creator",
]);

/**
 * Official jai — tools that may switch browser device (subset used by select_browser path).
 * Kept for residual wiring honesty; full aze not ported.
 */
export const COWORK_CHROME_BROWSER_SWITCH_TOOLS = new Set<string>([
  "switch_browser",
  "list_connected_browsers",
  "select_browser",
]);

/**
 * Official K2(): account present && !(isRaven ?? true).
 * Product injects boolean (true = allow skip_all outside unsupervised).
 * When inject omitted, default false matches official no-account / raven-default.
 */
export type CoworkChromeSkipAllAllowed = () => boolean;

/**
 * Official K2() pure from account details:
 *   const e = qa(); return e ? !(e.isRaven ?? true) : false
 * - no account / logged out / no uuid → false
 * - isRaven undefined → treat as true → K2 false (official ?? true)
 * - isRaven true → false
 * - isRaven false → true (non-raven account allows skip_all outside unsupervised)
 */
export function resolveCoworkK2AllowSkipAllOutsideUnsupervised(
  details:
    | {
        accountUuid?: string | null;
        isLoggedOut?: boolean;
        isRaven?: boolean;
      }
    | null
    | undefined,
): boolean {
  if (!details || details.isLoggedOut === true) return false;
  if (!details.accountUuid) return false;
  return !(details.isRaven ?? true);
}

/**
 * Official E_(e, A):
 *   if permissionMode is auto|bypassPermissions → return chrome mode e as-is
 *   else if e==="skip_all_permission_checks" && !K2() → undefined (suppress skip_all)
 *   else return e
 *
 * K2 inject: allowSkipAllOutsideUnsupervised (default false).
 */
export function resolveEffectiveCoworkChromePermissionMode(
  chromePermissionMode: CoworkChromePermissionMode | undefined,
  permissionMode: CoworkPermissionMode | string | undefined,
  allowSkipAllOutsideUnsupervised: boolean = false,
): CoworkChromePermissionMode | undefined {
  if (permissionMode === "auto" || permissionMode === "bypassPermissions") {
    return chromePermissionMode;
  }
  if (
    chromePermissionMode === "skip_all_permission_checks" &&
    !allowSkipAllOutsideUnsupervised
  ) {
    return undefined;
  }
  return chromePermissionMode;
}

export type CoworkChromeBrowserUrlParseResult =
  | { ok: true; cardUrl: string; host: string }
  | { ok: false; reason: "non-web" | "unparseable" };

/**
 * Official gBe(e): parse browser navigate URL for CIC cards.
 *   non-http(s) scheme → {ok:false, reason:"non-web"}
 *   bare host → prepend https://
 *   valid URL with host → {ok:true, cardUrl, host}
 *   else unparseable
 */
export function parseCoworkChromeBrowserUrl(
  raw: string,
): CoworkChromeBrowserUrlParseResult {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    return { ok: false, reason: "non-web" };
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!url.host) return { ok: false, reason: "unparseable" };
    return { ok: true, cardUrl: withScheme, host: url.host };
  } catch {
    return { ok: false, reason: "unparseable" };
  }
}

/**
 * Official cLi(e): map tool permission resolution → {allowed, always, allSites}.
 *   allowed = behavior==="allow"
 *   allSites = allowed && updatedInput._allowAllSites === true
 *   always = allowed && !allSites && (updatedPermissions?.length ?? 0) > 0
 */
export function mapCoworkBrowserPermissionResult(resolution: {
  behavior?: string;
  updatedPermissions?: unknown[];
  updatedInput?: Record<string, unknown>;
}): { allowed: boolean; always: boolean; allSites: boolean } {
  const allowed = resolution.behavior === "allow";
  const updatedPermissions =
    allowed && "updatedPermissions" in resolution
      ? resolution.updatedPermissions
      : undefined;
  const updatedInput =
    allowed && "updatedInput" in resolution
      ? resolution.updatedInput
      : undefined;
  const allSites = (updatedInput?._allowAllSites as boolean | undefined) === true;
  const always =
    allowed &&
    !allSites &&
    ((updatedPermissions?.length ?? 0) > 0);
  return { allowed, always, allSites };
}

/** Official browser permission request shape for gLi (Chrome MCP → tool permission). */
export type CoworkBrowserPermissionRequestInput = {
  actionData?: Record<string, unknown>;
  toolType: string;
  url?: string;
};

export type CoworkBrowserPermissionToolRequest = {
  input: Record<string, unknown>;
  suggestions: Array<{
    behavior: "allow";
    destination: "session";
    rules: Array<{ toolName: string }>;
    type: "addRules";
  }>;
  toolName: string;
};

/**
 * Official gLi(e):
 *   toolName = `browser:${toolType}`
 *   domain = URL(url).hostname or raw url on parse fail
 *   input = { ...actionData, domain } without _allowAllSites
 *   suggestions = [{ type:"addRules", rules:[{toolName}], behavior:"allow", destination:"session" }]
 */
export function buildCoworkBrowserPermissionToolRequest(
  request: CoworkBrowserPermissionRequestInput,
): CoworkBrowserPermissionToolRequest {
  const toolName = `browser:${request.toolType}`;
  let domain = request.url;
  if (typeof domain === "string") {
    try {
      domain = new URL(domain).hostname;
    } catch {
      // keep raw url string (official catch {})
    }
  }
  const input: Record<string, unknown> = {};
  if (request.actionData) Object.assign(input, request.actionData);
  input.domain = domain;
  delete input._allowAllSites;
  return {
    toolName,
    input,
    suggestions: [
      {
        type: "addRules",
        rules: [{ toolName }],
        behavior: "allow",
        destination: "session",
      },
    ],
  };
}

/**
 * Official nXi(sessions, sessionId):
 *   if sessionType===dispatch_child && parentSessionId && parent exists &&
 *   parent.lifecycleState!=="archived" → parentSessionId
 *   else → sessionId
 * Used by resolvePermissionSessionId for browser/tool permission target.
 */
export function resolveCoworkPermissionSessionId(
  getSession: (
    sessionId: string,
  ) =>
    | {
        lifecycleState?: string;
        parentSessionId?: string;
        sessionType?: string;
      }
    | null
    | undefined,
  sessionId: string,
): string {
  const session = getSession(sessionId);
  if (
    session?.sessionType === "dispatch_child" &&
    session.parentSessionId
  ) {
    const parent = getSession(session.parentSessionId);
    if (parent && parent.lifecycleState !== "archived") {
      return session.parentSessionId;
    }
  }
  return sessionId;
}

/**
 * Official iv(sessionType) / isHiddenSession: agent | dispatch_child | radar.
 * handleBrowserPermissionRequest skips main-window focus for these + scheduledTaskId.
 */
export function isCoworkHiddenSessionType(
  sessionType: string | null | undefined,
): boolean {
  return (
    sessionType === "agent" ||
    sessionType === "dispatch_child" ||
    sessionType === "radar"
  );
}

/** Official strip leading www. for domain compare (H1). */
export function stripCoworkChromeWwwPrefix(host: string): string {
  return host.replace(/^www\./, "");
}

/** Official Ice: strip www + trailing :port. */
export function normalizeCoworkChromeDomainHost(host: string): string {
  return stripCoworkChromeWwwPrefix(host).replace(/:\d+$/, "");
}

/** True when tool name is under official N5 Claude_in_Chrome MCP prefix. */
export function isCoworkChromeMcpToolName(toolName: string): boolean {
  return toolName.startsWith(COWORK_CHROME_MCP_TOOL_PREFIX);
}

/** Slice tool short name after N5 prefix; null if not CIC. */
export function coworkChromeMcpToolShortName(
  toolName: string,
): string | null {
  if (!isCoworkChromeMcpToolName(toolName)) return null;
  return toolName.slice(COWORK_CHROME_MCP_TOOL_PREFIX.length);
}

/** Official K1e membership on short name. */
export function isCoworkChromePermissionlessTool(shortName: string): boolean {
  return COWORK_CHROME_PERMISSIONLESS_TOOLS.has(shortName);
}

/**
 * Official startSession chrome seed (app.asar LocalAgentModeSessions start):
 *   f = scheduledTaskId ? ps.getChromePermissions(scheduledTaskId) : {}
 *   m = K2() && gi("allowAllBrowserActions") ? "skip_all_permission_checks" : void 0
 *   chromePermissionMode = E_(f.mode) ?? m
 *   chromeAllowedDomains = f.domains
 *   if permissionMode auto|bypassPermissions:
 *     if chromeSkipAllPermissionChecks !== undefined:
 *       chromePermissionMode = chromeSkipAll ? skip_all : void 0
 *       chromeAllowedDomains = void 0
 *     chromePermsBeforeUnsupervised = { mode: E_(f.mode)??m, domains: f.domains }
 *
 * Product injects K2 / gi / scheduled chrome as args (no invented product stores).
 */
export type CoworkStartChromeSeedInput = {
  allowAllBrowserActions?: boolean;
  /** Official K2() — allow skip_all outside unsupervised (and start default m). */
  allowSkipAllOutsideUnsupervised?: boolean;
  chromeSkipAllPermissionChecks?: boolean;
  permissionMode?: CoworkPermissionMode | string;
  scheduledChrome?: {
    domains?: string[];
    mode?: CoworkChromePermissionMode;
  };
};

export type CoworkStartChromeSeed = {
  chromeAllowedDomains?: string[];
  chromePermissionMode?: CoworkChromePermissionMode;
  chromePermsBeforeUnsupervised?: {
    domains?: string[];
    mode?: CoworkChromePermissionMode;
  };
};

export function resolveCoworkStartChromeSeed(
  input: CoworkStartChromeSeedInput,
): CoworkStartChromeSeed {
  const allowK2 = input.allowSkipAllOutsideUnsupervised === true;
  const allowAll = input.allowAllBrowserActions === true;
  const prefDefault: CoworkChromePermissionMode | undefined =
    allowK2 && allowAll ? "skip_all_permission_checks" : undefined;
  const scheduledMode = resolveEffectiveCoworkChromePermissionMode(
    input.scheduledChrome?.mode,
    // E_(f.mode) at start seed is called as E_(f.mode) without permissionMode in asar —
    // wait: official is E_(f.mode) with ONE arg? Look again: E_(f.mode)??m — only one arg!
    // function E_(e,A) — when A is undefined: not auto/bypass, so if e===skip_all && !K2 → undefined
    undefined,
    allowK2,
  );
  const baseMode = scheduledMode ?? prefDefault;
  const baseDomains = input.scheduledChrome?.domains
    ? [...input.scheduledChrome.domains]
    : undefined;

  const unsupervised =
    input.permissionMode === "auto" ||
    input.permissionMode === "bypassPermissions";

  if (unsupervised) {
    const seed: CoworkStartChromeSeed = {
      chromeAllowedDomains: baseDomains,
      chromePermissionMode: baseMode,
      chromePermsBeforeUnsupervised: {
        domains: baseDomains ? [...baseDomains] : undefined,
        mode: baseMode,
      },
    };
    if (input.chromeSkipAllPermissionChecks !== undefined) {
      seed.chromePermissionMode =
        input.chromeSkipAllPermissionChecks === true
          ? "skip_all_permission_checks"
          : undefined;
      seed.chromeAllowedDomains = undefined;
    }
    return seed;
  }

  return {
    chromeAllowedDomains: baseDomains,
    chromePermissionMode: baseMode,
  };
}
