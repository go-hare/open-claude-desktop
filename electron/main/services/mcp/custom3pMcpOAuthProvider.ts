/**
 * Residual custom3p MCP OAuthClientProvider (app.asar index.js SUA / yUA / N2e / Rni / M2e).
 * MCP-server OAuth only — not Anthropic account login invent.
 *
 * data-official-source: app.asar index.js SUA / N2e / _ni / RUA
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { app, session, shell } from "electron";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  clearField,
  clearOAuthTokens,
  readAccessToken,
  readEncryptedField,
  writeEncryptedField,
} from "./custom3pMcpOAuthStore";
import {
  OAUTH_CANCELLED_BY_NEWER,
  oauthCallbackHost,
  oauthCallbackPort,
  oauthLoopbackRedirectUrl,
  startOAuthLoopback,
  type OAuthLoopbackServer,
} from "./custom3pMcpOAuthLoopback";

const OAUTH_PROBE_TIMEOUT_MS = 10_000;
const OAUTH_CALLBACK_TIMEOUT_MS = 120_000;
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;

/** Residual y2e partition — OAuth discovery/token exchange share Chromium session state. */
export const CUSTOM3P_MCP_SESSION_PARTITION = "persist:custom3p-mcp";

let custom3pMcpSession: Electron.Session | null = null;

/**
 * Residual y2e() — singleton session.fromPartition("persist:custom3p-mcp").
 * Used by RUA transport fetch so cookies/HSTS match official custom3p MCP path.
 */
export function getCustom3pMcpSession(): Electron.Session {
  if (!custom3pMcpSession) {
    custom3pMcpSession = session.fromPartition(CUSTOM3P_MCP_SESSION_PARTITION);
  }
  return custom3pMcpSession;
}

/** Residual RUA fetch adapter: y2e().fetch(url, init). */
export function custom3pMcpSessionFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return getCustom3pMcpSession().fetch(url, init);
}

export class NeedsInteractiveAuthError extends Error {
  readonly serverName: string;
  constructor(serverName: string) {
    super(
      `${serverName}: OAuth needs interactive authorization (no cached tokens)`,
    );
    this.name = "NeedsInteractiveAuthError";
    this.serverName = serverName;
  }
}

export type ByoOAuthConfig = {
  clientId: string;
  tenantId?: string;
  scope?: string;
  callbackPort?: number;
  callbackHost?: "127.0.0.1" | "localhost";
};

export function parseByoOAuth(oauth: unknown): ByoOAuthConfig | undefined {
  if (!oauth || typeof oauth !== "object") return undefined;
  const bag = oauth as Record<string, unknown>;
  const clientId =
    typeof bag.clientId === "string" && bag.clientId.length > 0
      ? bag.clientId
      : undefined;
  if (!clientId) return undefined;
  const scopeRaw = bag.scope ?? bag.scopes;
  const scope =
    typeof scopeRaw === "string"
      ? scopeRaw || undefined
      : Array.isArray(scopeRaw)
        ? scopeRaw.filter((s): s is string => typeof s === "string").join(" ") ||
          undefined
        : undefined;
  const tenantId =
    typeof bag.tenantId === "string" && scope !== undefined
      ? bag.tenantId
      : undefined;
  const callbackPort =
    typeof bag.callbackPort === "number" ? bag.callbackPort : undefined;
  const callbackHost =
    bag.callbackHost === "127.0.0.1" || bag.callbackHost === "localhost"
      ? bag.callbackHost
      : undefined;
  return {
    clientId,
    ...(tenantId ? { tenantId } : {}),
    ...(scope ? { scope } : {}),
    ...(callbackPort !== undefined ? { callbackPort } : {}),
    ...(callbackHost ? { callbackHost } : {}),
  };
}

function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return true;
  return error instanceof Error && error.name === "UnauthorizedError";
}

/** Residual SUA. */
export class Custom3pMcpOAuthProvider implements OAuthClientProvider {
  private oauthState?: string;
  private pkceVerifier?: string;

  constructor(
    private readonly serverName: string,
    private readonly loopbackRedirectUrl: string,
    private readonly interactive: boolean,
    private readonly byo?: ByoOAuthConfig,
  ) {}

  get redirectUrl(): string {
    return this.loopbackRedirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    let version = "0.0.0";
    try {
      version = app.getVersion();
    } catch {
      /* test / early boot */
    }
    return {
      client_name: `Claude Desktop (${version})`,
      redirect_uris: [this.loopbackRedirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(this.byo?.scope ? { scope: this.byo.scope } : {}),
    };
  }

  discoveryState() {
    if (this.byo?.tenantId) {
      return {
        authorizationServerUrl: `https://login.microsoftonline.com/${this.byo.tenantId}/v2.0`,
      };
    }
    return undefined;
  }

  saveDiscoveryState(_state: unknown): void {
    /* residual no-op */
  }

  state(): string {
    this.oauthState = randomBytes(32).toString("base64url");
    return this.oauthState;
  }

  validateState(state: string | null): boolean {
    if (!this.oauthState || !state) return false;
    const a = Buffer.from(this.oauthState);
    const b = Buffer.from(state);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    if (this.byo) return { client_id: this.byo.clientId };
    return readEncryptedField<OAuthClientInformationMixed>(
      this.serverName,
      "client",
    );
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    if (this.byo) return;
    writeEncryptedField(this.serverName, "client", info);
    console.info("[custom3p-mcp] registered OAuth client", {
      server: this.serverName,
      clientId: (info as { client_id?: string }).client_id,
    });
  }

  tokens(): OAuthTokens | undefined {
    return readEncryptedField<OAuthTokens>(this.serverName, "tokens");
  }

  saveTokens(tokens: OAuthTokens): void {
    writeEncryptedField(this.serverName, "tokens", tokens);
    console.info("[custom3p-mcp] saved OAuth tokens", {
      server: this.serverName,
      hasRefresh: Boolean(tokens.refresh_token),
    });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    if (!this.interactive) {
      throw new NeedsInteractiveAuthError(this.serverName);
    }
    if (authorizationUrl.protocol !== "https:") {
      throw new Error(
        `[custom3p-mcp] refusing to open non-https authorize URL: ${authorizationUrl.protocol}//${authorizationUrl.host}`,
      );
    }
    const prompts = authorizationUrl.searchParams.getAll("prompt");
    if (prompts.length > 1) {
      authorizationUrl.searchParams.delete("prompt");
      authorizationUrl.searchParams.set("prompt", prompts[prompts.length - 1]!);
    }
    console.info("[custom3p-mcp] opening authorize URL", {
      server: this.serverName,
      host: authorizationUrl.host,
    });
    void shell.openExternal(authorizationUrl.toString());
  }

  saveCodeVerifier(verifier: string): void {
    this.pkceVerifier = verifier;
  }

  codeVerifier(): string {
    if (!this.pkceVerifier) {
      throw new Error(
        "PKCE verifier missing — saveCodeVerifier was not called before codeVerifier",
      );
    }
    return this.pkceVerifier;
  }

  invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): void {
    if (scope === "verifier" || scope === "all") {
      this.pkceVerifier = undefined;
      this.oauthState = undefined;
    }
    if (scope === "tokens" || scope === "all") {
      clearField(this.serverName, "tokens");
    }
    if (scope === "client" || scope === "all") {
      clearField(this.serverName, "client");
    }
  }
}

export type OAuthServerConfig = {
  name: string;
  url: string;
  transport?: string;
  oauth?: unknown;
};

type ActiveInteractive = {
  loopback: OAuthLoopbackServer;
  abort: AbortController;
};

let activeInteractive: ActiveInteractive | null = null;

function createOAuthTransport(
  config: OAuthServerConfig,
  authProvider: Custom3pMcpOAuthProvider,
): SSEClientTransport | StreamableHTTPClientTransport {
  const url = new URL(config.url);
  // Residual RUA: y2e().fetch via persist:custom3p-mcp (not global fetch).
  const opts = {
    authProvider,
    fetch: custom3pMcpSessionFetch,
  };
  return config.transport === "sse"
    ? new SSEClientTransport(url, opts)
    : new StreamableHTTPClientTransport(url, opts);
}

/**
 * Residual Rni — non-interactive OAuth probe with cached tokens.
 * Throws NeedsInteractiveAuthError (yUA) when interactive auth required.
 */
export async function probeOAuthCached(
  config: OAuthServerConfig,
  timeoutMs = OAUTH_PROBE_TIMEOUT_MS,
): Promise<void> {
  const provider = new Custom3pMcpOAuthProvider(
    config.name,
    oauthLoopbackRedirectUrl(config.oauth),
    false,
    parseByoOAuth(config.oauth),
  );
  const transport = createOAuthTransport(config, provider);
  const client = new Client(
    { name: "custom3p-desktop", version: safeAppVersion() },
    { capabilities: {} },
  );
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    await client.connect(transport, { signal: abort.signal });
  } catch (error) {
    void client.close().catch(() => undefined);
    if (abort.signal.aborted) {
      throw new Error(`OAuth probe timeout after ${timeoutMs}ms`);
    }
    // Non-interactive: UnauthorizedError / redirect path → needs interactive.
    if (
      isUnauthorizedError(error) ||
      error instanceof NeedsInteractiveAuthError
    ) {
      throw new NeedsInteractiveAuthError(config.name);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  void client.close().catch(() => undefined);
  if (!readAccessToken(config.name)) {
    throw new NeedsInteractiveAuthError(config.name);
  }
}

function safeAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}

/**
 * Residual N2e — interactive authorize (loopback + browser + finishAuth).
 */
export async function interactiveAuthorize(
  config: OAuthServerConfig,
): Promise<void> {
  if (activeInteractive) {
    activeInteractive.abort.abort(OAUTH_CANCELLED_BY_NEWER);
    await activeInteractive.loopback.close();
    activeInteractive = null;
  }

  const provider = new Custom3pMcpOAuthProvider(
    config.name,
    oauthLoopbackRedirectUrl(config.oauth),
    true,
    parseByoOAuth(config.oauth),
  );
  const loopback = await startOAuthLoopback(
    oauthCallbackPort(config.oauth),
    oauthCallbackHost(config.oauth),
    (state) => provider.validateState(state),
  );
  const abort = new AbortController();
  activeInteractive = { loopback, abort };

  const transport = createOAuthTransport(config, provider);
  const client = new Client(
    { name: "custom3p-desktop", version: safeAppVersion() },
    { capabilities: {} },
  );
  const probeTimer = setTimeout(() => abort.abort(), OAUTH_PROBE_TIMEOUT_MS);
  try {
    try {
      await client.connect(transport, { signal: abort.signal });
      // Already authorized (cached token worked).
      return;
    } catch (error) {
      if (abort.signal.aborted) {
        throw new Error(
          abort.signal.reason === OAUTH_CANCELLED_BY_NEWER
            ? OAUTH_CANCELLED_BY_NEWER
            : `OAuth probe timeout after ${OAUTH_PROBE_TIMEOUT_MS}ms`,
        );
      }
      // Residual: only UnauthorizedError continues to wait for callback.
      if (!isUnauthorizedError(error)) {
        throw error;
      }
      console.info(
        "[custom3p-mcp] waiting for OAuth callback (browser opened)",
        { server: config.name },
      );
      clearTimeout(probeTimer);
      const callback = await loopback.waitForCallback(
        OAUTH_CALLBACK_TIMEOUT_MS,
      );
      let exchangeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          transport.finishAuth(callback.code),
          new Promise<never>((_, reject) => {
            exchangeTimer = setTimeout(
              () =>
                reject(
                  new Error(
                    `OAuth token exchange timeout after ${TOKEN_EXCHANGE_TIMEOUT_MS}ms`,
                  ),
                ),
              TOKEN_EXCHANGE_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (exchangeTimer) clearTimeout(exchangeTimer);
      }
    }
  } finally {
    clearTimeout(probeTimer);
    void client.close().catch(() => undefined);
    if (activeInteractive?.loopback === loopback) {
      activeInteractive = null;
    }
    await loopback.close();
  }
}

/** Residual M2e bearer headers from keychain. */
export function oauthBearerHeaders(
  serverName: string,
): Record<string, string> {
  const token = readAccessToken(serverName);
  if (!token) {
    throw new Error(
      `OAuth succeeded but Keychain read returned no token for ${serverName}`,
    );
  }
  return { Authorization: `Bearer ${token}` };
}

/**
 * Residual _ni oauth branch — interactive then bearer headers for spawnUtilityClient.
 */
export async function authorizeAndGetBearerHeaders(
  config: OAuthServerConfig,
): Promise<Record<string, string>> {
  if (!config.oauth) {
    throw new Error(`Server ${config.name} has no oauth config`);
  }
  await interactiveAuthorize(config);
  return oauthBearerHeaders(config.name);
}

export { clearOAuthTokens, OAUTH_CANCELLED_BY_NEWER, UnauthorizedError };
