/**
 * Residual Custom3pSetup MCP probe / authorize-and-probe (app.asar index.js).
 *
 * Official wiring (WYe.setImplementation):
 *   probeMcpServer: Bot
 *   authorizeAndProbeMcpServer: Qot
 *   forgetMcpOAuth: xv  → clearOAuthTokens(serverName)
 *
 * Bot(e)  → Cot(e) → Iot(config) → lot
 * Qot(e)  → Cot(e) → Sgr(config) → lot
 * Iot: oauth? Rgr (RUA non-interactive) : m2e headers + y2e fetch transport + Eot
 * Sgr: interactive N2e then Iot
 * Eot: Client custom3p-desktop connect + listTools → kind ok|auth|err
 *
 * data-official-source: app.asar .vite/build/index.js Bot / Qot / Iot / Sgr / Eot / Cot / lot / xv
 * Non-goal: Anthropic account OAuth invent.
 */
import { isIP } from "node:net";
import { app } from "electron";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  CUSTOM3P_MCP_SESSION_PARTITION,
  NeedsInteractiveAuthError,
  OAUTH_CANCELLED_BY_NEWER,
  custom3pMcpSessionFetch,
  interactiveAuthorize,
  parseByoOAuth,
} from "./custom3pMcpOAuthProvider";
import { clearOAuthTokens } from "./custom3pMcpOAuthStore";
import { resolveHeadersHelper } from "./headersHelper";
import { Custom3pMcpOAuthProvider } from "./custom3pMcpOAuthProvider";
import { oauthLoopbackRedirectUrl } from "./custom3pMcpOAuthLoopback";

/** Residual ev — probe connect timeout. */
const PROBE_TIMEOUT_MS = 10_000;

export type McpProbeServerConfig = {
  name: string;
  url: string;
  transport?: "http" | "sse" | string;
  headers?: Record<string, string>;
  headersHelper?: string;
  headersHelperTtlSec?: number;
  oauth?: unknown;
  source?: string;
};

export type McpProbeResult =
  | {
      kind: "ok";
      serverName: string;
      serverVersion?: string;
      transport?: string;
      latencyMs: number;
      tools: string[];
    }
  | { kind: "auth" }
  | {
      kind: "err";
      title: string;
      message: string;
      code?: string;
      request?: string;
      latencyMs?: number;
    };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const bag = asRecord(value);
  const entries = Object.entries(bag).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Residual Mgr — block link-local / metadata hostnames for probe.
 * Matches official: 169.254.* and fe80–febf link-local IPv6 (simplified).
 */
export function isBlockedProbeHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!isIP(host)) return false;
  if (host.startsWith("169.254.")) return true;
  // IPv6 link-local fe80::/10
  if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) {
    return true;
  }
  // AWS/GCP metadata common
  if (host === "169.254.169.254") return true;
  return false;
}

/** Residual sy — redact secrets in URL for logs / request field. */
export function safeProbeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = "***";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Residual Cot — parse + blocklist. On success returns config + safeUrl;
 * on failure returns kind err (no throw).
 */
export function parseProbeServerConfig(
  raw: unknown,
): McpProbeResult | { config: McpProbeServerConfig; safeUrl: string } {
  const bag = asRecord(raw);
  const url = asString(bag.url);
  const name = asString(bag.name) ?? "mcp";
  if (!url || !/^https?:\/\//i.test(url)) {
    return {
      kind: "err",
      title: "Invalid configuration",
      message: "Server configuration is invalid.",
    };
  }
  // Residual _gr: oauth ∧ headers exclusive (headersHelper omitted from that refine
  // but product already applies JLA on connect path).
  if (bag.oauth && (bag.headers || bag.headersHelper)) {
    return {
      kind: "err",
      title: "Invalid configuration",
      message: "oauth and headers are mutually exclusive",
    };
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return {
      kind: "err",
      title: "Invalid configuration",
      message: "Server configuration is invalid.",
    };
  }
  if (isBlockedProbeHostname(hostname)) {
    return {
      kind: "err",
      title: "Blocked address",
      message: "Link-local and metadata addresses are not allowed.",
    };
  }
  const transport = asString(bag.transport) ?? asString(bag.type) ?? "http";
  const headers = stringRecord(bag.headers);
  const headersHelper = asString(bag.headersHelper);
  const headersHelperTtlSec =
    typeof bag.headersHelperTtlSec === "number"
      ? bag.headersHelperTtlSec
      : undefined;
  const config: McpProbeServerConfig = {
    name,
    url,
    transport,
    ...(headers ? { headers } : {}),
    ...(headersHelper ? { headersHelper } : {}),
    ...(headersHelperTtlSec !== undefined ? { headersHelperTtlSec } : {}),
    oauth: bag.oauth,
    source: asString(bag.source) ?? "mdm",
  };
  return { config, safeUrl: safeProbeUrl(url) };
}

/** Residual Ngr-ish — collapse multi-line noise for err message. */
function sanitizeProbeMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

/** Residual lot — log + shape err request line. */
function finalizeProbeResult(
  parsed: { config: McpProbeServerConfig; safeUrl: string },
  result: McpProbeResult,
): McpProbeResult {
  const { config, safeUrl } = parsed;
  if (result.kind === "ok") {
    console.info(
      `[mcp-probe] ${config.name} connected in ${result.latencyMs}ms, ${result.tools.length} tools`,
    );
    return result;
  }
  if (result.kind === "auth") {
    console.info(`[mcp-probe] ${config.name} requires sign-in`);
    return result;
  }
  const message = sanitizeProbeMessage(result.message);
  console.info(`[mcp-probe] ${config.name} failed: ${message}`);
  return {
    kind: "err",
    title: result.title,
    code: result.code,
    message,
    request: `${String(config.transport ?? "http").toUpperCase()} ${safeUrl}  →  initialize`,
  };
}

function appVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}

/**
 * Residual Eot — connect Client + listTools.
 */
async function connectAndListTools(
  config: McpProbeServerConfig,
  transport: SSEClientTransport | StreamableHTTPClientTransport,
  startedAt: number,
): Promise<McpProbeResult> {
  const client = new Client(
    { name: "custom3p-desktop", version: appVersion() },
    { capabilities: {} },
  );
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
  try {
    await client.connect(transport, { signal: abort.signal });
    const latencyMs = Date.now() - startedAt;
    let tools: string[] = [];
    try {
      const listed = await client.listTools(undefined, { signal: abort.signal });
      tools = (listed.tools ?? []).map((t) => t.name);
    } catch {
      if (abort.signal.aborted) {
        return {
          kind: "err",
          title: "Timed out listing tools",
          message:
            "Server accepted the connection but did not respond to tools/list.",
        };
      }
    }
    const version = client.getServerVersion?.() as
      | { name?: string; version?: string }
      | undefined;
    return {
      kind: "ok",
      serverName: version?.name ?? config.name,
      ...(version?.version ? { serverVersion: version.version } : {}),
      transport: config.transport,
      latencyMs,
      tools,
    };
  } catch (error) {
    if (error instanceof NeedsInteractiveAuthError) {
      return { kind: "auth" };
    }
    if (
      error instanceof UnauthorizedError ||
      (error instanceof Error && error.message.includes("Unauthorized"))
    ) {
      return { kind: "auth" };
    }
    const message = error instanceof Error ? error.message : String(error);
    const status =
      typeof (error as { status?: unknown })?.status === "number"
        ? (error as { status: number }).status
        : undefined;
    const match = message.match(
      /\b(?:HTTP|status(?:\s+code)?)\s*[:=(]?\s*(4\d{2}|5\d{2})\b/i,
    );
    const code =
      typeof status === "number" && status >= 400 && status < 600
        ? String(status)
        : match?.[1];
    if (code === "401" || code === "403") return { kind: "auth" };
    if (message.includes("does not support dynamic client registration")) {
      return {
        kind: "err",
        title: "Connection failed",
        message: `${message}. Set the OAuth field to a pre-registered client, e.g. {"clientId":"...","callbackPort":53280}`,
      };
    }
    return {
      kind: "err",
      title: abort.signal.aborted
        ? "Connection timed out"
        : code
          ? `Server returned ${code}`
          : "Connection failed",
      ...(code ? { code } : {}),
      message,
    };
  } finally {
    clearTimeout(timer);
    void client.close().catch(() => undefined);
  }
}

/**
 * Residual Rgr — non-interactive OAuth transport (RUA + SUA interactive:false).
 */
async function probeWithCachedOAuth(
  config: McpProbeServerConfig,
  startedAt: number,
): Promise<McpProbeResult> {
  const byo = parseByoOAuth(config.oauth);
  const provider = new Custom3pMcpOAuthProvider(
    config.name,
    oauthLoopbackRedirectUrl(config.oauth),
    false,
    byo,
  );
  const url = new URL(config.url);
  const opts = {
    authProvider: provider,
    fetch: custom3pMcpSessionFetch,
  };
  const transport =
    config.transport === "sse"
      ? new SSEClientTransport(url, opts)
      : new StreamableHTTPClientTransport(url, opts);
  return connectAndListTools(config, transport, startedAt);
}

/**
 * Residual Iot — open/headers or oauth-cached probe.
 */
export async function probeMcpServerInner(
  config: McpProbeServerConfig,
): Promise<McpProbeResult> {
  const startedAt = Date.now();
  if (config.oauth) {
    return probeWithCachedOAuth(config, startedAt);
  }
  let helperHeaders: Record<string, string> | undefined;
  try {
    helperHeaders = await resolveHeadersHelper({
      name: config.name,
      headersHelper: config.headersHelper,
      headersHelperTtlSec: config.headersHelperTtlSec,
      source: config.source,
      headers: config.headers,
    });
  } catch (error) {
    return {
      kind: "err",
      title: "Headers helper failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const headers = {
    ...(config.headers ?? {}),
    ...(helperHeaders ?? {}),
  };
  const url = new URL(config.url);
  const requestInit =
    Object.keys(headers).length > 0 ? { headers } : undefined;
  // Residual Iot: y2e().fetch for both sse/http transports.
  const fetchImpl = custom3pMcpSessionFetch;
  const transport =
    config.transport === "sse"
      ? new SSEClientTransport(url, {
          fetch: fetchImpl,
          ...(requestInit ? { requestInit } : {}),
        })
      : new StreamableHTTPClientTransport(url, {
          fetch: fetchImpl,
          ...(requestInit ? { requestInit } : {}),
        });
  return connectAndListTools(config, transport, startedAt);
}

/**
 * Residual Sgr — interactive authorize then Iot.
 */
export async function authorizeAndProbeMcpServerInner(
  config: McpProbeServerConfig,
): Promise<McpProbeResult> {
  if (!config.oauth) {
    return {
      kind: "err",
      title: "OAuth not configured",
      message: "Set OAuth on this server to sign in.",
    };
  }
  try {
    await interactiveAuthorize({
      name: config.name,
      url: config.url,
      transport: config.transport,
      oauth: config.oauth,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === OAUTH_CANCELLED_BY_NEWER) {
      return { kind: "auth" };
    }
    return {
      kind: "err",
      title: "Sign-in failed",
      message,
    };
  }
  return probeMcpServerInner(config);
}

/** Residual Bot. */
export async function probeMcpServer(raw: unknown): Promise<McpProbeResult> {
  const parsed = parseProbeServerConfig(raw);
  if ("kind" in parsed) return parsed;
  return finalizeProbeResult(parsed, await probeMcpServerInner(parsed.config));
}

/** Residual Qot. */
export async function authorizeAndProbeMcpServer(
  raw: unknown,
): Promise<McpProbeResult> {
  const parsed = parseProbeServerConfig(raw);
  if ("kind" in parsed) return parsed;
  return finalizeProbeResult(
    parsed,
    await authorizeAndProbeMcpServerInner(parsed.config),
  );
}

/**
 * Residual forgetMcpOAuth → xv(serverName).
 * Clears custom3pMcpOAuth bag tokens for that server.
 */
export function forgetMcpOAuth(serverName: unknown): void {
  if (typeof serverName !== "string" || serverName.length === 0) {
    throw new Error(
      'Argument "serverName" at position 0 to method "forgetMcpOAuth" failed to pass validation',
    );
  }
  clearOAuthTokens(serverName);
}

/** Test/doc export — partition used by probe transports. */
export const PROBE_SESSION_PARTITION = CUSTOM3P_MCP_SESSION_PARTITION;
