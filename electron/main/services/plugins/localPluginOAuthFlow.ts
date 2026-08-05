/**
 * Residual plugin CLI OAuth exchange (app.asar NbA / n6t / r6t / i6t / dPe).
 *
 * Official startPluginOAuthFlow:
 *   i6t(pluginId, cli, oauthBag) → r6t → NbA → git(credentials)
 *
 * Protocol (NbA):
 *   - authorization_code + PKCE S256
 *   - loopback http://127.0.0.1:${redirectPort|ephemeral}/callback
 *   - net/fetch token POST application/x-www-form-urlencoded
 *   - credential camelCase: accessToken / refreshToken / expiresAt / grantedScopes /
 *     tokenUrl / clientId / clientSecret
 *
 * Not Anthropic account OAuth. Not custom3p MCP OAuth (different loopback rules).
 *
 * data-official-source: app.asar index.js NbA / n6t / r6t / i6t / R7 / A6t / QPe / uPe
 */
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { isIP } from "node:net";
import { net, shell } from "electron";

const LOG = "[PluginOAuthFlow]";

/** Residual A6t — callback wait. */
export const PLUGIN_OAUTH_CALLBACK_TIMEOUT_MS = 120_000;
/** Residual QPe — token exchange / refresh. */
export const PLUGIN_OAUTH_TOKEN_TIMEOUT_MS = 30_000;
/** Residual uPe — default expires when refresh present but no expires_in. */
export const PLUGIN_OAUTH_DEFAULT_EXPIRES_MS = 3_600_000;

export type PluginOAuthFlowInput = {
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  /** Residual scopes array (joined with space on authorize). */
  scopes?: string[];
  displayName?: string;
  /** Residual redirectPort — 0 / omit → ephemeral. */
  redirectPort?: number;
  /** Residual googleOfflineAccess → access_type=offline + prompt=consent. */
  googleOfflineAccess?: boolean;
};

/** Residual git() credential bag (camelCase). */
export type PluginOAuthFlowCredentials = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  grantedScopes?: string[];
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
};

export class PluginOAuthFlowError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PluginOAuthFlowError";
    this.code = code;
  }
}

/**
 * Residual R7 — authorizationUrl / tokenUrl must be https public host
 * (not localhost / private) for manifest validation.
 */
export function validatePublicHttpsUrl(value: unknown, field: string): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return `${field} is required.`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${field} must be a valid URL.`;
  }
  if (url.protocol !== "https:") {
    return `${field} must use https://.`;
  }
  if (isPrivateOrLocalHostname(url.hostname)) {
    return `${field} must be a public host, not localhost or a private address.`;
  }
  return null;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const parts = host.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (ipVersion === 6) {
    if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
    // fc00::/7 unique local, fe80::/10 link-local
    const compact = host.toLowerCase();
    if (compact.startsWith("fc") || compact.startsWith("fd") || compact.startsWith("fe8") || compact.startsWith("fe9") || compact.startsWith("fea") || compact.startsWith("feb")) {
      return true;
    }
  }
  return false;
}

/** Residual NbA URL allow for open/exchange: https or http on 127.0.0.1 only. */
function isAllowedOAuthEndpoint(url: URL): boolean {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && url.hostname === "127.0.0.1")
  );
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * Residual n6t — wait for /callback with state; CSRF rules differ from MCP loopback.
 * - Origin present → reject
 * - Referer: allow missing, or referer host matches authorize host (127.0.0.1 special-case)
 * - Host must equal 127.0.0.1:port
 */
function waitForPluginOAuthCallback(
  server: http.Server,
  expectedState: string,
  expectedHost: string,
  authorizeHostname: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("OAuth callback timed out"));
    }, timeoutMs);

    const onRequest = (
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ) => {
      const write = (status: number, body: string) => {
        res.writeHead(status, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
        });
        res.end(body);
      };
      const failHtml =
        "<!doctype html><title>Authorization failed</title><p>Authorization failed. You can close this tab.";
      const okHtml =
        "<!doctype html><title>Authorized</title><p>Authorization complete. You can close this tab and return to Claude.";

      let refererHost: string | null = null;
      if (req.headers.referer) {
        try {
          refererHost = new URL(req.headers.referer).hostname;
        } catch {
          refererHost = "<unparseable>";
        }
      }
      // Residual: allow no referer, or referer host matches authorize host;
      // special-case both 127.0.0.1.
      const refererOk =
        refererHost === null ||
        refererHost === authorizeHostname ||
        (authorizeHostname === "127.0.0.1" && refererHost === "127.0.0.1");
      if (req.headers.origin || !refererOk) {
        console.warn(`${LOG} Rejecting callback with browser headers`);
        write(400, failHtml);
        return;
      }
      if (req.headers.host !== expectedHost) {
        console.warn(
          `${LOG} Rejecting callback with invalid host: ${req.headers.host}`,
        );
        write(400, failHtml);
        return;
      }

      let url: URL;
      try {
        url = new URL(req.url ?? "", `http://${expectedHost}`);
      } catch {
        write(400, failHtml);
        return;
      }
      if (url.pathname !== "/callback") {
        write(404, failHtml);
        return;
      }
      if (url.searchParams.get("state") !== expectedState) {
        console.error(`${LOG} State mismatch on callback`);
        write(400, failHtml);
        return;
      }
      const err = url.searchParams.get("error");
      if (err) {
        clearTimeout(timer);
        server.off("request", onRequest);
        write(200, failHtml);
        reject(
          new Error(
            `Provider returned error: ${err}${
              url.searchParams.get("error_description")
                ? ` ${url.searchParams.get("error_description")}`
                : ""
            }`.trim(),
          ),
        );
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        clearTimeout(timer);
        server.off("request", onRequest);
        write(400, failHtml);
        reject(new Error("OAuth callback missing code parameter"));
        return;
      }
      clearTimeout(timer);
      server.off("request", onRequest);
      write(200, okHtml);
      resolve(code);
    };

    server.on("request", onRequest);
  });
}

async function fetchTokenJson(
  tokenUrl: string,
  body: URLSearchParams,
): Promise<Record<string, unknown>> {
  const response = await net.fetch(tokenUrl, {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    redirect: "error",
    signal: AbortSignal.timeout(PLUGIN_OAUTH_TOKEN_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new PluginOAuthFlowError(
      "token_exchange_http_error",
      `Token exchange failed (HTTP ${response.status})`,
    );
  }
  const json = (await response.json()) as unknown;
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new PluginOAuthFlowError(
      "token_response_parse_error",
      "Token response is not a JSON object",
    );
  }
  return json as Record<string, unknown>;
}

function credentialsFromTokenResponse(
  bag: Record<string, unknown>,
  input: PluginOAuthFlowInput,
): PluginOAuthFlowCredentials {
  const access =
    typeof bag.access_token === "string" ? bag.access_token : undefined;
  if (!access) {
    throw new PluginOAuthFlowError(
      "token_response_missing_access_token",
      "Token response missing access_token",
    );
  }
  const refresh =
    typeof bag.refresh_token === "string" ? bag.refresh_token : undefined;
  let expiresAt: number | undefined;
  if (typeof bag.expires_in === "number" && Number.isFinite(bag.expires_in)) {
    expiresAt = Date.now() + bag.expires_in * 1000;
  } else if (refresh) {
    expiresAt = Date.now() + PLUGIN_OAUTH_DEFAULT_EXPIRES_MS;
  }
  const grantedScopes =
    typeof bag.scope === "string"
      ? bag.scope.split(/[\s,]+/).filter(Boolean)
      : input.scopes;
  return {
    accessToken: access,
    ...(refresh ? { refreshToken: refresh } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(grantedScopes && grantedScopes.length > 0
      ? { grantedScopes }
      : {}),
    tokenUrl: input.tokenUrl,
    clientId: input.clientId,
    ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
  };
}

/**
 * Residual NbA — full interactive authorization_code + PKCE + loopback + token POST.
 */
export async function runPluginOAuthAuthorizationCodeFlow(
  input: PluginOAuthFlowInput,
): Promise<PluginOAuthFlowCredentials> {
  const authorizeUrl = new URL(input.authorizationUrl);
  if (!isAllowedOAuthEndpoint(authorizeUrl)) {
    throw new Error(
      "authorizationUrl must use https (or http on 127.0.0.1)",
    );
  }
  const tokenUrl = new URL(input.tokenUrl);
  if (!isAllowedOAuthEndpoint(tokenUrl)) {
    throw new Error("tokenUrl must use https (or http on 127.0.0.1)");
  }

  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString("base64url");

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    const port =
      typeof input.redirectPort === "number" &&
      Number.isInteger(input.redirectPort) &&
      input.redirectPort >= 0 &&
      input.redirectPort <= 65535
        ? input.redirectPort
        : 0;
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("OAuth loopback failed to bind");
  }
  const boundPort = address.port;
  const expectedHost = `127.0.0.1:${boundPort}`;
  const redirectUri = `http://127.0.0.1:${boundPort}/callback`;

  try {
    console.info(
      `${LOG} Loopback server listening on ${redirectUri} for provider "${
        input.displayName ?? input.clientId
      }"`,
    );

    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", input.clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    if (input.scopes && input.scopes.length > 0) {
      authorizeUrl.searchParams.set("scope", input.scopes.join(" "));
    }
    if (input.googleOfflineAccess) {
      authorizeUrl.searchParams.set("access_type", "offline");
      authorizeUrl.searchParams.set("prompt", "consent");
    }

    await shell.openExternal(authorizeUrl.toString());

    const code = await waitForPluginOAuthCallback(
      server,
      state,
      expectedHost,
      authorizeUrl.hostname,
      PLUGIN_OAUTH_CALLBACK_TIMEOUT_MS,
    );

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: input.clientId,
      code_verifier: verifier,
    });
    if (input.clientSecret) {
      body.set("client_secret", input.clientSecret);
    }

    const tokenBag = await fetchTokenJson(input.tokenUrl, body);
    return credentialsFromTokenResponse(tokenBag, input);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

/**
 * Residual r6t validation + NbA.
 * envVar is validated by caller when present on oauth bag.
 */
export async function runValidatedPluginOAuthFlow(
  oauth: Record<string, unknown>,
): Promise<PluginOAuthFlowCredentials> {
  const authorizationUrl =
    typeof oauth.authorizationUrl === "string"
      ? oauth.authorizationUrl
      : typeof oauth.authorization_url === "string"
        ? oauth.authorization_url
        : undefined;
  const tokenUrl =
    typeof oauth.tokenUrl === "string"
      ? oauth.tokenUrl
      : typeof oauth.token_url === "string"
        ? oauth.token_url
        : undefined;
  const clientId =
    typeof oauth.clientId === "string" ? oauth.clientId.trim() : "";
  if (!clientId) {
    throw new Error("OAuth clientId is not configured.");
  }

  const authErr = validatePublicHttpsUrl(authorizationUrl, "authorizationUrl");
  if (authErr) {
    throw new PluginOAuthFlowError("invalid_authorization_url", authErr);
  }
  const tokenErr = validatePublicHttpsUrl(tokenUrl, "tokenUrl");
  if (tokenErr) {
    throw new PluginOAuthFlowError("invalid_token_url", tokenErr);
  }

  const scopesRaw = oauth.scopes ?? oauth.scope;
  let scopes: string[] | undefined;
  if (Array.isArray(scopesRaw)) {
    scopes = scopesRaw.filter((s): s is string => typeof s === "string" && s.length > 0);
  } else if (typeof scopesRaw === "string" && scopesRaw.trim()) {
    scopes = scopesRaw.split(/[\s,]+/).filter(Boolean);
  }

  const clientSecret =
    typeof oauth.clientSecret === "string" && oauth.clientSecret.length > 0
      ? oauth.clientSecret
      : undefined;
  const displayName =
    typeof oauth.displayName === "string" ? oauth.displayName : undefined;
  const redirectPort =
    typeof oauth.redirectPort === "number" ? oauth.redirectPort : undefined;
  // Residual call site passes googleOfflineAccess:!0 for plugin oauth.
  const googleOfflineAccess = oauth.googleOfflineAccess !== false;

  return runPluginOAuthAuthorizationCodeFlow({
    authorizationUrl: authorizationUrl!,
    tokenUrl: tokenUrl!,
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    ...(scopes && scopes.length > 0 ? { scopes } : {}),
    ...(displayName ? { displayName } : {}),
    ...(redirectPort !== undefined ? { redirectPort } : {}),
    googleOfflineAccess,
  });
}

/** In-flight i6t dedupe map residual $BA. */
const inflight = new Map<string, Promise<PluginOAuthFlowCredentials>>();

/**
 * Residual i6t — single-flight per pluginId:cliName.
 */
export async function runPluginOAuthI6t(
  pluginId: string,
  cliName: string,
  oauth: Record<string, unknown>,
): Promise<PluginOAuthFlowCredentials> {
  const key = `${pluginId}:${cliName}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const work = runValidatedPluginOAuthFlow(oauth).finally(() => {
    if (inflight.get(key) === work) inflight.delete(key);
  });
  inflight.set(key, work);
  return work;
}

export function resetPluginOAuthInflightForTests(): void {
  inflight.clear();
}
