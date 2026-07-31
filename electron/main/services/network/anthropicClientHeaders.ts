import { app, session } from "electron";
import { anthropicOriginUrl } from "../../windows/routeMode";

/**
 * Official residual (app.asar Frr / hV / _a — formerly documented as wEr / GQ):
 *   hV = anthropic-client-platform / -app / -version
 *   Frr adds -os-platform / -os-version + anthropic-desktop-topbar: "1"
 *   + optional CLAUDE_EXTRA_HEADERS_TOKEN (Gsn / pai)
 *   host gate _a(host): anthropic origin host + .ai↔.com twin
 *
 * Live claude.ai SPA desktop gate (index-Rqu5Ur9t.js jI) is SEPARATE:
 *   n = (ua has "claude/" | "claudenest/" | "claudegov/") && !!window.claudeAppBindings
 *   → anthropic-client-platform: desktop_app vs web_claude_ai
 * Product display name is Claudex (TCC) so default Electron UA is "Claudex/…" and
 * fails the "claude/" token. installAnthropicDesktopUserAgent() injects Claude/<ver>
 * without renaming the app. Headers alone are not enough for the SPA branch.
 *
 * Header app id is official residual identity for Anthropic host recognition —
 * not the product CFBundleIdentifier (com.local.claudex.desktop).
 */
export const ANTHROPIC_CLIENT_PLATFORM = "desktop_app";
export const ANTHROPIC_CLIENT_APP = "com.anthropic.claudefordesktop";

/** Live SPA residual tokens that mark the client as Claude Desktop. */
const DESKTOP_UA_TOKENS = ["claude/", "claudenest/", "claudegov/"] as const;

let installed = false;
let userAgentInstalled = false;

/** Official GQ residual: anthropic origin host + .ai↔.com twin. */
export function isAnthropicClientHeaderHost(
  host: string,
  originHost = (() => {
    try {
      return new URL(anthropicOriginUrl()).host;
    } catch {
      return "claude.ai";
    }
  })(),
): boolean {
  if (!host) return false;
  if (host === originHost) return true;
  if (
    process.env.CLAUDE_CDP_AUTH
    && process.env.CLAUDE_USER_DATA_DIR
    && host === "claude-ai.staging.ant.dev"
  ) {
    return true;
  }
  if (originHost.endsWith(".ai")) {
    return host === originHost.replace(/\.ai$/, ".com");
  }
  if (originHost.endsWith(".com")) {
    return host === originHost.replace(/\.com$/, ".ai");
  }
  return false;
}

/**
 * Official pai residual — signed extra header bag from CLAUDE_EXTRA_HEADERS_TOKEN.
 * Product: only accept a simple JSON object payload when token is a bare JSON
 * object (dev override). Full JWT/signed residual is not reimplemented; invalid
 * tokens are ignored (same as official reject → {}).
 */
export function parseClaudeExtraHeadersToken(token: string | undefined): Record<string, string> {
  const raw = token?.trim();
  if (!raw) return {};
  // Official expects 3-part token; product also allows bare JSON map for local tests.
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string" && k.trim()) out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  }
  return {};
}

function osVersion(): string {
  try {
    if (typeof process.getSystemVersion === "function") {
      return process.getSystemVersion();
    }
  } catch {
    /* fall through */
  }
  return process.platform;
}

/**
 * Live SPA residual (index-Rqu5Ur9t.js jI): desktop detection requires UA token
 * `claude/` (or nest/gov) plus `window.claudeAppBindings`.
 *
 * Official packaged productName is "Claude" → Electron UA already contains Claude/.
 * Product keeps display name Claudex for Dock/TCC separation, so we append a
 * residual `Claude/<version>` token to userAgentFallback before any navigation.
 */
export function installAnthropicDesktopUserAgent(options?: {
  getUserAgent?: () => string;
  setUserAgent?: (value: string) => void;
  getVersion?: () => string;
}): void {
  if (userAgentInstalled) return;
  userAgentInstalled = true;

  const getUserAgent =
    options?.getUserAgent
    ?? (() => app.userAgentFallback ?? "");
  const setUserAgent =
    options?.setUserAgent
    ?? ((value: string) => {
      app.userAgentFallback = value;
    });
  const getVersion = options?.getVersion ?? (() => app.getVersion());

  const current = getUserAgent();
  const lower = current.toLowerCase();
  if (DESKTOP_UA_TOKENS.some((token) => lower.includes(token))) {
    return;
  }

  const version = getVersion().trim() || "0.0.0";
  const token = `Claude/${version}`;
  setUserAgent(current ? `${current} ${token}` : token);
}

/**
 * Official Frr residual: install once on defaultSession before loadAll navigates to mN.
 */
export function installAnthropicClientRequestHeaders(options?: {
  getVersion?: () => string;
  getPlatform?: () => NodeJS.Platform;
  getOsVersion?: () => string;
  getExtraHeaders?: () => Record<string, string>;
}): void {
  if (installed) return;
  installed = true;

  const getVersion = options?.getVersion ?? (() => app.getVersion());
  const getPlatform = options?.getPlatform ?? (() => process.platform);
  const getOsVersion = options?.getOsVersion ?? osVersion;
  const getExtraHeaders =
    options?.getExtraHeaders
    ?? (() => parseClaudeExtraHeadersToken(process.env.CLAUDE_EXTRA_HEADERS_TOKEN));

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const url = new URL(details.url);
      if (!isAnthropicClientHeaderHost(url.host)) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }

      const headers: Record<string, string> = {
        ...details.requestHeaders,
        "anthropic-client-platform": ANTHROPIC_CLIENT_PLATFORM,
        "anthropic-client-app": ANTHROPIC_CLIENT_APP,
        "anthropic-client-version": getVersion(),
        "anthropic-client-os-platform": getPlatform(),
        "anthropic-client-os-version": getOsVersion(),
        "anthropic-desktop-topbar": "1",
      };

      for (const [key, value] of Object.entries(getExtraHeaders())) {
        headers[key] = value;
      }

      // Official deletes this marker when present.
      if ("x-claude-desktop-no-iap-inject" in headers) {
        delete headers["x-claude-desktop-no-iap-inject"];
      }

      callback({ requestHeaders: headers });
    } catch {
      callback({ requestHeaders: details.requestHeaders });
    }
  });
}

/** Test-only: allow re-install in vitest. */
export function resetAnthropicClientRequestHeadersForTests(): void {
  installed = false;
  userAgentInstalled = false;
}
