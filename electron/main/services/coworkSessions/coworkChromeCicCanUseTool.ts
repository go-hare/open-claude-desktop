/**
 * Official async function aze(e,A,t) — canUseTool CIC residual (app.asar).
 * Anchors: N5 Claude_in_Chrome prefix, K1e permissionless, E_ chrome mode,
 * gBe URL parse, Ice/H1 domain normalize, showBrowserPermissionCard path.
 *
 * Residual honesty:
 * - Full Chrome MCP server product / extension storage queryTabUrl transport
 *   not invented — hooks are injects; missing queryTabUrl denys like offline.
 * - browser_batch recursion uses same aze pure path.
 * - cBe deny messages exact asar strings.
 */

import {
  COWORK_CHROME_MCP_TOOL_PREFIX,
  coworkChromeMcpToolShortName,
  isCoworkChromeMcpToolName,
  isCoworkChromePermissionlessTool,
  normalizeCoworkChromeDomainHost,
  parseCoworkChromeBrowserUrl,
  resolveEffectiveCoworkChromePermissionMode,
  stripCoworkChromeWwwPrefix,
  type CoworkBrowserPermissionRequestInput,
} from "./coworkChromeCicHelpers";
import type { CoworkChromePermissionMode } from "./coworkSessionTypes";
import type { CoworkPermissionMode } from "./coworkSessionTypes";

export type CoworkCicCanUseToolResolution =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export type CoworkCicTabUrlQueryResult = {
  storageDecision?: "allow" | "deny" | string | null;
  url: string;
};

export type CoworkCicCanUseToolHooks = {
  clearCicOnceApproved?: () => void;
  getCicOnceApproved?: () => ReadonlySet<string> | Iterable<string> | null | undefined;
  getCurrentBrowserDeviceId?: () => string | null | undefined;
  getSessionAfterPrompt?: () =>
    | {
        chromeAllowedDomains?: string[] | null;
        chromePermissionMode?: CoworkChromePermissionMode | string | null;
        permissionMode?: CoworkPermissionMode | string | null;
      }
    | null
    | undefined;
  /**
   * Official t.queryTabUrl — extension bridge residual.
   * When unset, product treats as unavailable (deny no url resolved / no storage).
   */
  queryTabUrl?: (
    query: { checkUrl?: string; tabId?: number },
    ctx: {
      displayName?: string | null;
      sessionId: string;
      tabGroupId?: number | string | null;
    },
  ) =>
    | Promise<CoworkCicTabUrlQueryResult | null | undefined>
    | CoworkCicTabUrlQueryResult
    | null
    | undefined;
  setCicOnceApproved?: (host: string) => void;
  showBrowserPermissionCard?: (
    request: CoworkBrowserPermissionRequestInput & {
      requestId: string;
      toolUseId: string;
    },
    signal?: AbortSignal,
  ) => Promise<{ allowed: boolean; always?: boolean; allSites?: boolean }>;
  updateChromePermission?: (
    mode: CoworkChromePermissionMode,
    domains: string[],
  ) => void;
};

export type CoworkCicCanUseToolSession = {
  chromeAllowedDomains?: string[] | null;
  chromePermissionMode?: CoworkChromePermissionMode | string | null;
  chromeTabGroupId?: number | string | null;
  permissionMode?: CoworkPermissionMode | string | null;
  title?: string | null;
};

/**
 * Official cBe deny for unparseable / non-web browser URLs.
 */
export function denyCoworkCicBrowserUrl(
  shortName: string,
  parse: { ok: false; reason: "non-web" | "unparseable" },
  rawUrl: string,
): CoworkCicCanUseToolResolution {
  console.info(
    `[canUseTool:CIC] ${shortName} → deny (${parse.reason}: ${rawUrl})`,
  );
  return {
    behavior: "deny",
    message:
      parse.reason === "non-web"
        ? "Can't interact with browser internal pages. Navigate to a web page first."
        : "Browser URL could not be parsed. Check the format and try again.",
  };
}

function allow(
  input: Record<string, unknown>,
): CoworkCicCanUseToolResolution {
  return { behavior: "allow", updatedInput: input };
}

function deny(message: string): CoworkCicCanUseToolResolution {
  return { behavior: "deny", message };
}

function domainInSessionGrant(
  host: string,
  allowed: readonly string[] | null | undefined,
): boolean {
  const target = normalizeCoworkChromeDomainHost(host);
  return (allowed ?? []).some(
    (d) => normalizeCoworkChromeDomainHost(d) === target,
  );
}

function domainInOnceApproved(
  host: string,
  once: ReadonlySet<string> | Iterable<string> | null | undefined,
): boolean {
  if (!once) return false;
  const target = stripCoworkChromeWwwPrefix(host);
  for (const item of once) {
    if (stripCoworkChromeWwwPrefix(item) === target) return true;
  }
  return false;
}

/**
 * Official aze — returns undefined when tool is not Claude_in_Chrome MCP.
 * Caller continues to generic canUseTool when undefined.
 */
export async function resolveCoworkChromeCicCanUseTool(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  options: {
    allowSkipAllOutsideUnsupervised?: boolean;
    hooks: CoworkCicCanUseToolHooks;
    session: CoworkCicCanUseToolSession | null | undefined;
    sessionId: string;
    signal?: AbortSignal;
  },
): Promise<CoworkCicCanUseToolResolution | undefined> {
  if (!isCoworkChromeMcpToolName(toolName)) return undefined;
  const shortName = coworkChromeMcpToolShortName(toolName);
  if (!shortName) return undefined;
  const input = toolInput ?? {};
  const session = options.session;
  const hooks = options.hooks;
  const effectiveMode = resolveEffectiveCoworkChromePermissionMode(
    session?.chromePermissionMode as CoworkChromePermissionMode | undefined,
    session?.permissionMode,
    options.allowSkipAllOutsideUnsupervised === true,
  );

  // K1e permissionless
  if (isCoworkChromePermissionlessTool(shortName)) {
    console.debug(`[canUseTool:CIC] ${shortName} → permissionless`);
    return allow(input);
  }

  // browser_batch: recurse aze on each sub-action name
  if (shortName === "browser_batch" && Array.isArray(input.actions)) {
    for (const action of input.actions) {
      if (typeof action !== "object" || action === null) continue;
      const a = action as { name?: unknown; input?: unknown };
      if (typeof a.name !== "string") continue;
      const subInput =
        typeof a.input === "object" && a.input !== null
          ? (a.input as Record<string, unknown>)
          : {};
      const sub = await resolveCoworkChromeCicCanUseTool(
        `${COWORK_CHROME_MCP_TOOL_PREFIX}${a.name}`,
        subInput,
        options,
      );
      if (sub?.behavior === "deny") {
        console.info(
          `[canUseTool:CIC] browser_batch → deny (sub-action ${a.name})`,
        );
        hooks.clearCicOnceApproved?.();
        return sub;
      }
    }
    console.debug(
      `[canUseTool:CIC] browser_batch → allow (${input.actions.length} sub-actions)`,
    );
    return allow(input);
  }

  // navigate history back/forward
  if (
    shortName === "navigate" &&
    typeof input.url === "string" &&
    (input.url.toLowerCase() === "back" ||
      input.url.toLowerCase() === "forward")
  ) {
    console.debug(
      `[canUseTool:CIC] navigate(${input.url}) → history`,
    );
    return allow(input);
  }

  // computer wait
  if (shortName === "computer" && input.action === "wait") {
    console.debug("[canUseTool:CIC] computer(wait) → harmless action");
    return allow(input);
  }

  if (effectiveMode === "skip_all_permission_checks") {
    console.debug(`[canUseTool:CIC] ${shortName} → auto-allow (skip_all)`);
    return allow(input);
  }

  // select_browser
  if (shortName === "select_browser") {
    const deviceId =
      typeof input.deviceId === "string" ? input.deviceId : "";
    const current = hooks.getCurrentBrowserDeviceId?.();
    if (!current || current === deviceId) {
      console.debug(
        `[canUseTool:CIC] select_browser → allow (initial/same: ${deviceId.slice(0, 8)})`,
      );
      return allow(input);
    }
    const label = `Browser ${deviceId.slice(0, 8)}`;
    console.debug(
      `[canUseTool:CIC] select_browser → prompt (redirect ${String(current).slice(0, 8)} → ${deviceId.slice(0, 8)})`,
    );
    const card = await hooks.showBrowserPermissionCard?.(
      {
        toolUseId: "",
        requestId: "",
        toolType: shortName,
        url: label,
        actionData: { deviceId: deviceId.slice(0, 8) },
      },
      options.signal,
    );
    if (card?.allowed) return allow(input);
    return deny("Browser switch was not approved.");
  }

  const tabCtx = {
    sessionId: options.sessionId,
    tabGroupId: session?.chromeTabGroupId,
    displayName: session?.title,
  };

  let cardUrl: string | undefined;
  let host: string | undefined;
  let storageDecision: string | null | undefined;

  if (shortName === "navigate" && typeof input.url !== "string") {
    console.info(
      `[canUseTool:CIC] navigate → deny (url is ${typeof input.url})`,
    );
    return deny(
      "Browser URL could not be parsed. Check the format and try again.",
    );
  }

  if (shortName === "navigate" && typeof input.url === "string") {
    const parsed = parseCoworkChromeBrowserUrl(input.url);
    if (!parsed.ok) return denyCoworkCicBrowserUrl(shortName, parsed, input.url);
    cardUrl = parsed.cardUrl;
    host = parsed.host;
    const tab = await hooks.queryTabUrl?.(
      { checkUrl: cardUrl },
      tabCtx,
    );
    storageDecision = tab?.storageDecision ?? undefined;
  } else if (typeof input.tabId === "number") {
    const tab = await hooks.queryTabUrl?.({ tabId: input.tabId }, tabCtx);
    if (!tab) {
      console.info(
        `[canUseTool:CIC] ${shortName} → deny (no url resolved)`,
      );
      return deny(
        "Browser connection is unavailable. You can try again.",
      );
    }
    const parsed = parseCoworkChromeBrowserUrl(tab.url);
    if (!parsed.ok) return denyCoworkCicBrowserUrl(shortName, parsed, tab.url);
    cardUrl = parsed.cardUrl;
    host = parsed.host;
    storageDecision = tab.storageDecision ?? undefined;
  } else {
    console.info(
      `[canUseTool:CIC] ${shortName} → deny (no url or tabId)`,
    );
    return deny(
      "Browser URL could not be parsed. Check the format and try again.",
    );
  }

  if (storageDecision === "deny") {
    console.info(
      `[canUseTool:CIC] ${shortName} → deny (ext storage DENY, ${host})`,
    );
    return deny(
      "This site was previously blocked for browser automation. You can change that in the extension's settings.",
    );
  }

  const allowedDomains = session?.chromeAllowedDomains ?? [];
  if (host && domainInSessionGrant(host, allowedDomains)) {
    console.debug(
      `[canUseTool:CIC] ${shortName} → auto-allow (session grant ${host})`,
    );
    return allow(input);
  }

  const once = hooks.getCicOnceApproved?.();
  if (host && domainInOnceApproved(host, once)) {
    console.debug(
      `[canUseTool:CIC] ${shortName} → auto-allow (once-approved this turn, ${host})`,
    );
    return allow(input);
  }

  if (storageDecision === "allow" && host) {
    console.debug(
      `[canUseTool:CIC] ${shortName} → auto-allow (ext storage grant, ${host})`,
    );
    hooks.updateChromePermission?.(
      "follow_a_plan",
      [...new Set([...allowedDomains, host])],
    );
    return allow(input);
  }

  console.debug(`[canUseTool:CIC] ${shortName} → prompt (${host})`);
  if (!hooks.showBrowserPermissionCard || !cardUrl || !host) {
    // Residual: no card inject → deny (cannot invent silent allow).
    return deny("Browser action was not allowed.");
  }
  const card = await hooks.showBrowserPermissionCard(
    {
      toolUseId: "",
      requestId: "",
      toolType: shortName,
      url: cardUrl,
      actionData: {
        coordinate: input.coordinate,
        text: input.text,
        tabId: input.tabId,
      },
    },
    options.signal,
  );
  if (!card?.allowed) {
    return deny("Browser action was not allowed.");
  }

  const after = hooks.getSessionAfterPrompt?.() ?? session;
  const afterMode = resolveEffectiveCoworkChromePermissionMode(
    after?.chromePermissionMode as CoworkChromePermissionMode | undefined,
    after?.permissionMode,
    options.allowSkipAllOutsideUnsupervised === true,
  );
  if (afterMode === "skip_all_permission_checks") {
    return allow(input);
  }
  if (card.allSites) {
    hooks.updateChromePermission?.(
      "skip_all_permission_checks",
      after?.chromeAllowedDomains ?? [],
    );
    return allow(input);
  }
  if (card.always) {
    hooks.updateChromePermission?.(
      "follow_a_plan",
      [...new Set([...(after?.chromeAllowedDomains ?? []), host])],
    );
    return allow(input);
  }
  hooks.setCicOnceApproved?.(host);
  return allow(input);
}
