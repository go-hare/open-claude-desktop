/**
 * Official oauth flow residual (app.asar UHe / O5t / Y5t / F5t / m0A / D0A / KBA / _h).
 *
 * Control flow (honest — no invent success):
 *   UHe: L5t load → lastActiveOrg cookie → G5t cache hit → F5t refresh → O5t exchange
 *   O5t: lastActiveOrg + sessionKey cookies → PKCE authorize → token exchange
 *   Empty cookies / network / non-200 → typed fail reason (not_logged_in / auth_error / …)
 *
 * Product residual:
 *   - Real tokens only when Anthropic endpoints return them.
 *   - Without 1p cookies, returns not_logged_in (bridge start fails honestly).
 *   - Wire sessions-bridge defaultGetOAuthToken → getCoworkApiToken (IIr subset).
 *
 * data-official-source: app.asar UHe / O5t / Y5t / F5t / m0A / D0A / KBA / b5t / woe / _h
 */

import { net, session } from "electron";
import {
  buildCoworkOauthCacheKey,
  ensureCoworkOauthTokenCacheLoaded,
  getCoworkOauthTokenCacheGeneration,
  peekCoworkOauthCachedToken,
  persistCoworkOauthTokenCache,
  setCoworkOauthCachedToken,
  type CoworkOauthCachedToken,
} from "./coworkOauthTokenCache";
import {
  COWORK_OAUTH_DEFAULT_EXPIRES_IN,
  buildCoworkOauthCookieUrl,
  getCoworkOauthCookieDomain,
  parseCoworkOauthOrgUuid,
  resolveCoworkSessionsBridgeOauthConfig,
  type CoworkOauthConfig,
} from "./coworkOauthConfigs";

const LOG = "[oauth]";
const ANTHROPIC_VERSION = "2023-06-01";

export type CoworkOauthFailReason = {
  type:
    | "not_logged_in"
    | "network_error"
    | "server_error"
    | "auth_error";
  detail: string;
  status?: number;
};

export type CoworkOauthTokenSuccess = {
  token: string;
  refreshToken?: string;
  /** Official expires field = expires_in seconds from response. */
  expires: number;
};

export type CoworkOauthFlowResult =
  | {
      ok: true;
      token: string;
      subscriptionType: string | null;
      rateLimitTier: string | null;
    }
  | {
      ok: false;
      reason: CoworkOauthFailReason;
    };

type CookieLike = { name: string; value: string };

type FlowDeps = {
  getCookies: (filter: {
    name?: string;
    url: string;
  }) => Promise<CookieLike[]>;
  fetch: (
    url: string,
    init?: RequestInit,
  ) => Promise<{
    ok: boolean;
    status: number;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
  }>;
  closeAllConnections?: () => Promise<void> | void;
  cookieUrl?: string;
  /** Skip profile tier fetch in tests. */
  fetchProfile?: (
    apiHost: string,
    token: string,
  ) => Promise<{
    subscriptionType: string | null;
    rateLimitTier: string | null;
  } | null>;
  randomPkce?: () => Promise<[string, string, string]>;
  now?: () => number;
};

let flowDepsOverride: FlowDeps | null = null;

export function setCoworkOauthFlowDepsForTests(next: FlowDeps | null): void {
  flowDepsOverride = next;
}

function defaultFetch(
  url: string,
  init?: RequestInit,
): Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}> {
  // Electron net.fetch returns a WHATWG Response-like object.
  return net.fetch(url, init as never) as never;
}

function defaultDeps(): FlowDeps {
  return {
    getCookies: async (filter) => {
      const list = await session.defaultSession.cookies.get(filter);
      return list.map((c) => ({ name: c.name, value: c.value }));
    },
    fetch: defaultFetch,
    closeAllConnections: async () => {
      try {
        await session.defaultSession.closeAllConnections();
      } catch {
        // ignore
      }
    },
    cookieUrl: undefined,
  };
}

function deps(): FlowDeps {
  return flowDepsOverride ?? defaultDeps();
}

function isTokenSuccess(
  value: CoworkOauthTokenSuccess | CoworkOauthFailReason,
): value is CoworkOauthTokenSuccess {
  return value != null && typeof value === "object" && "token" in value;
}

function isRetriableNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === "Failed to fetch") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ERR_CONNECTION") ||
    msg.includes("ERR_NETWORK") ||
    msg.includes("Failed to fetch")
  );
}

/** Official D0A residual — fetch with connection-pool flush retry. */
async function oauthFetch(
  url: string,
  init?: RequestInit,
): Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}> {
  const d = deps();
  try {
    return await d.fetch(url, init);
  } catch (err) {
    if (isRetriableNetworkError(err)) {
      console.warn(
        `${LOG} network error on fetch, flushing connection pool and retrying: %s`,
        err instanceof Error ? err.message : String(err),
      );
      await d.closeAllConnections?.();
      return await d.fetch(url, init);
    }
    throw err;
  }
}

/** Official m0A residual — 5xx retry with backoff. */
async function oauthFetchWithServerRetry(
  url: string,
  init?: RequestInit,
  maxRetries = 2,
): Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}> {
  let res = await oauthFetch(url, init);
  for (let attempt = 1; attempt <= maxRetries && res.status >= 500; attempt++) {
    const delay = 500 * Math.pow(2, attempt - 1);
    console.warn(
      `${LOG} server error %d on attempt %d, retrying in %dms`,
      res.status,
      attempt,
      delay,
    );
    await new Promise((r) => setTimeout(r, delay));
    res = await oauthFetch(url, init);
  }
  return res;
}

/**
 * Official Y5t residual — PKCE verifier / challenge / state.
 * Returns [code_verifier, code_challenge, state].
 */
export async function generateCoworkOauthPkce(): Promise<
  [string, string, string]
> {
  const d = deps();
  if (d.randomPkce) return d.randomPkce();

  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = btoa(String.fromCharCode(...verifierBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const challengeBytes = new Uint8Array(digest);
  const challenge = btoa(String.fromCharCode(...challengeBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let state = "";
  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  for (let i = 0; i < 32; i++) {
    state += alphabet[stateBytes[i]! % alphabet.length];
  }
  return [verifier, challenge, state];
}

function resolveCookieUrl(): string {
  const d = deps();
  if (d.cookieUrl) return d.cookieUrl;
  return buildCoworkOauthCookieUrl(getCoworkOauthCookieDomain());
}

/**
 * Official O5t residual — cookie sessionKey exchange (authorize + token).
 * Honest fail when cookies missing or Anthropic returns non-200.
 */
export async function exchangeCoworkOauthFromCookies(
  config: CoworkOauthConfig,
): Promise<CoworkOauthTokenSuccess | CoworkOauthFailReason> {
  const d = deps();
  const cookieUrl = resolveCookieUrl();
  console.debug(
    `[getOauthToken] looking up cookies for url=${cookieUrl}`,
  );
  const orgCookies = await d.getCookies({
    name: "lastActiveOrg",
    url: cookieUrl,
  });
  console.debug(
    `[getOauthToken] found ${orgCookies.length} orgId cookies`,
  );
  if (!orgCookies.length) {
    console.info("oauth failed: no lastActiveOrg cookie found");
    return {
      type: "not_logged_in",
      detail: "no lastActiveOrg cookie found",
    };
  }
  const orgId = orgCookies[0]!.value;
  console.debug(`[getOauthToken] orgId=${orgId}`);
  const skCookies = await d.getCookies({
    name: "sessionKey",
    url: cookieUrl,
  });
  console.debug(`[getOauthToken] found ${skCookies.length} sk cookies`);
  if (!skCookies.length) {
    console.info("oauth failed: no sessionKey cookie found");
    return {
      type: "not_logged_in",
      detail: "no sessionKey cookie found",
    };
  }
  const sessionKey = skCookies[0]!.value;
  const [verifier, challenge, state] = await generateCoworkOauthPkce();

  let authorizeRes: Awaited<ReturnType<typeof oauthFetchWithServerRetry>>;
  try {
    authorizeRes = await oauthFetchWithServerRetry(
      `${config.apiHost}/v1/oauth/${orgId}/authorize`,
      {
        method: "POST",
        headers: {
          "anthropic-version": ANTHROPIC_VERSION,
          Authorization: `Bearer ${sessionKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          response_type: "code",
          client_id: config.clientId,
          organization_uuid: orgId,
          redirect_uri: config.redirectUri,
          scope: config.scope,
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }),
      },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("oauth authorize network error: %s", detail);
    return { type: "network_error", detail };
  }

  if (authorizeRes.status !== 200) {
    const body = await authorizeRes.text();
    console.info(`oauth failed: authorize returned ${authorizeRes.status} %o`, {
      error: body,
    });
    return authorizeRes.status >= 500
      ? {
          type: "server_error",
          status: authorizeRes.status,
          detail: body,
        }
      : {
          type: "auth_error",
          status: authorizeRes.status,
          detail: body,
        };
  }

  const authorizeJson = (await authorizeRes.json()) as {
    redirect_uri?: string;
  };
  const redirectUri = authorizeJson.redirect_uri;
  if (!redirectUri) {
    console.info("oauth failed: no auth code in redirect_uri");
    return {
      type: "auth_error",
      status: 0,
      detail: "no auth code in redirect_uri",
    };
  }
  let code: string | null = null;
  try {
    code = new URL(redirectUri).searchParams.get("code");
  } catch {
    code = null;
  }
  if (!code) {
    console.info("oauth failed: no auth code in redirect_uri");
    return {
      type: "auth_error",
      status: 0,
      detail: "no auth code in redirect_uri",
    };
  }

  const tokenBody: Record<string, unknown> = {
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    state,
    code_verifier: verifier,
  };
  if (!config.scope.includes("user:sessions:claude_code")) {
    tokenBody.expires_in = COWORK_OAUTH_DEFAULT_EXPIRES_IN;
  }

  let tokenRes: Awaited<ReturnType<typeof oauthFetchWithServerRetry>>;
  try {
    tokenRes = await oauthFetchWithServerRetry(
      `${config.apiHost}/v1/oauth/token`,
      {
        method: "POST",
        headers: {
          "anthropic-version": ANTHROPIC_VERSION,
          Authorization: `Bearer ${sessionKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tokenBody),
      },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("oauth token exchange network error: %s", detail);
    return { type: "network_error", detail };
  }

  if (tokenRes.status !== 200) {
    const body = await tokenRes.text();
    console.info(`oauth failed: token exchange returned ${tokenRes.status}`, {
      error: body,
    });
    return tokenRes.status >= 500
      ? {
          type: "server_error",
          status: tokenRes.status,
          detail: body,
        }
      : {
          type: "auth_error",
          status: tokenRes.status,
          detail: body,
        };
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (
    typeof tokenJson.access_token !== "string" ||
    tokenJson.access_token.length === 0
  ) {
    return {
      type: "auth_error",
      status: 0,
      detail: "token response missing access_token",
    };
  }
  return {
    token: tokenJson.access_token,
    refreshToken:
      typeof tokenJson.refresh_token === "string"
        ? tokenJson.refresh_token
        : undefined,
    expires:
      typeof tokenJson.expires_in === "number" &&
      Number.isFinite(tokenJson.expires_in)
        ? tokenJson.expires_in
        : COWORK_OAUTH_DEFAULT_EXPIRES_IN,
  };
}

/**
 * Official F5t residual — refresh_token grant.
 */
export async function refreshCoworkOauthToken(
  config: CoworkOauthConfig,
  refreshToken: string,
): Promise<CoworkOauthTokenSuccess | CoworkOauthFailReason> {
  const body: Record<string, unknown> = {
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
    scope: config.scope,
  };
  if (!config.scope.includes("user:sessions:claude_code")) {
    body.expires_in = COWORK_OAUTH_DEFAULT_EXPIRES_IN;
  }

  let res: Awaited<ReturnType<typeof oauthFetchWithServerRetry>>;
  try {
    res = await oauthFetchWithServerRetry(`${config.apiHost}/v1/oauth/token`, {
      method: "POST",
      headers: {
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("OAuth token refresh network error: %s", detail);
    return { type: "network_error", detail };
  }

  if (res.status !== 200) {
    const text = await res.text();
    console.error(
      "OAuth token refresh failed: status=%d, response=%s",
      res.status,
      text,
    );
    return res.status >= 500
      ? { type: "server_error", status: res.status, detail: text }
      : { type: "auth_error", status: res.status, detail: text };
  }

  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (
    typeof json.access_token !== "string" ||
    json.access_token.length === 0
  ) {
    return {
      type: "auth_error",
      status: 0,
      detail: "refresh response missing access_token",
    };
  }
  return {
    token: json.access_token,
    refreshToken:
      typeof json.refresh_token === "string"
        ? json.refresh_token
        : refreshToken,
    expires:
      typeof json.expires_in === "number" && Number.isFinite(json.expires_in)
        ? json.expires_in
        : COWORK_OAUTH_DEFAULT_EXPIRES_IN,
  };
}

const EMPTY_TIER = Object.freeze({
  subscriptionType: null as string | null,
  rateLimitTier: null as string | null,
});

/** Official b5t residual — /api/oauth/profile subscription tier. */
async function fetchOauthProfileTier(
  apiHost: string,
  token: string,
): Promise<{
  subscriptionType: string | null;
  rateLimitTier: string | null;
} | null> {
  const d = deps();
  if (d.fetchProfile) return d.fetchProfile(apiHost, token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await oauthFetch(`${apiHost}/api/oauth/profile`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(
        `${LOG} profile fetch returned %d, subscription tier unavailable`,
        res.status,
      );
      return res.status >= 500 ? null : { ...EMPTY_TIER };
    }
    const body = (await res.json()) as {
      organization?: {
        organization_type?: string;
        rate_limit_tier?: string | null;
      };
    };
    let subscriptionType: string | null = null;
    switch (body.organization?.organization_type) {
      case "claude_max":
        subscriptionType = "max";
        break;
      case "claude_pro":
        subscriptionType = "pro";
        break;
      case "claude_enterprise":
        subscriptionType = "enterprise";
        break;
      case "claude_team":
        subscriptionType = "team";
        break;
      default:
        subscriptionType = null;
    }
    return {
      subscriptionType,
      rateLimitTier: body.organization?.rate_limit_tier ?? null,
    };
  } catch (err) {
    console.warn(`${LOG} profile fetch failed: %o`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Official KBA residual */
async function maybeFetchProfileTier(
  config: CoworkOauthConfig,
  token: string,
): Promise<
  | { subscriptionType: string | null; rateLimitTier: string | null }
  | undefined
> {
  if (!config.scope.includes("user:profile")) {
    return { ...EMPTY_TIER };
  }
  return (await fetchOauthProfileTier(config.apiHost, token)) ?? undefined;
}

function cacheEntryStillValid(
  entry: CoworkOauthCachedToken | null,
  now: number,
): entry is CoworkOauthCachedToken {
  if (!entry?.token) return false;
  const exp = entry.expiresAt ?? entry.expiresAtMs;
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    // No expiry → treat as valid residual (caller still may refresh later).
    return true;
  }
  return now < exp;
}

/**
 * Official UHe residual — performOauthFlow.
 * Load cache → org cookie → cache hit → refresh → O5t exchange → persist.
 */
export async function performCoworkOauthFlow(
  config: CoworkOauthConfig,
): Promise<CoworkOauthFlowResult> {
  const d = deps();
  const now = d.now?.() ?? Date.now();

  // Official: poe || (load L5t, poe=true)
  await ensureCoworkOauthTokenCacheLoaded();
  const generationAtStart = getCoworkOauthTokenCacheGeneration();

  const cookieUrl = resolveCookieUrl();
  const orgCookies = await d.getCookies({
    name: "lastActiveOrg",
    url: cookieUrl,
  });
  const orgId = parseCoworkOauthOrgUuid(orgCookies[0]?.value);
  if (!orgId) {
    console.info("oauth failed: no active organization");
    return {
      ok: false,
      reason: {
        type: "not_logged_in",
        detail: "no active organization",
      },
    };
  }

  const cacheKey = buildCoworkOauthCacheKey(
    config.clientId,
    orgId,
    config.apiHost,
    config.scope,
  );
  console.info(
    `${LOG} looking up token for orgId=%s, cacheKey=%s`,
    orgId,
    cacheKey,
  );

  // Official: qu[n] peek keeps expired entries for refresh residual.
  let cached = peekCoworkOauthCachedToken(cacheKey);
  if (cacheEntryStillValid(cached, now)) {
    if (cached.subscriptionType === undefined) {
      const tier = await maybeFetchProfileTier(config, cached.token);
      if (tier !== undefined) {
        setCoworkOauthCachedToken({
          ...cached,
          key: cacheKey,
          subscriptionType: tier.subscriptionType,
          rateLimitTier: tier.rateLimitTier,
        });
        cached = peekCoworkOauthCachedToken(cacheKey) ?? cached;
      }
    }
    console.info(`${LOG} using cached token for orgId=%s`, orgId);
    return {
      ok: true,
      token: cached.token,
      subscriptionType: cached.subscriptionType ?? null,
      rateLimitTier: cached.rateLimitTier ?? null,
    };
  }

  if (cached) {
    console.info(
      `${LOG} cached token expired for orgId=%s (expiresAt=%d, now=%d)`,
      orgId,
      cached.expiresAt ?? cached.expiresAtMs ?? 0,
      now,
    );
  } else {
    console.info(`${LOG} no cached token found for orgId=%s`, orgId);
  }

  if (cached?.refreshToken) {
    console.info(`${LOG} refreshing token for orgId=%s`, orgId);
    const refreshed = await refreshCoworkOauthToken(
      config,
      cached.refreshToken,
    );
    if (getCoworkOauthTokenCacheGeneration() !== generationAtStart) {
      console.info(
        `${LOG} token cache cleared during refresh; discarding`,
      );
      return {
        ok: false,
        reason: {
          type: "not_logged_in",
          detail: "cache cleared mid-flow",
        },
      };
    }
    if (isTokenSuccess(refreshed)) {
      console.info(
        `${LOG} token refreshed for orgId=%s, persisting`,
        orgId,
      );
      const tier =
        (await maybeFetchProfileTier(config, refreshed.token)) ??
        (cached.subscriptionType !== undefined
          ? {
              subscriptionType: cached.subscriptionType ?? null,
              rateLimitTier: cached.rateLimitTier ?? null,
            }
          : undefined);
      setCoworkOauthCachedToken({
        token: refreshed.token,
        refreshToken: refreshed.refreshToken,
        expiresAt: now + refreshed.expires * 1000,
        key: cacheKey,
        subscriptionType: tier?.subscriptionType,
        rateLimitTier: tier?.rateLimitTier,
      });
      await persistCoworkOauthTokenCache();
      return {
        ok: true,
        token: refreshed.token,
        subscriptionType: tier?.subscriptionType ?? null,
        rateLimitTier: tier?.rateLimitTier ?? null,
      };
    }
    console.info(
      `${LOG} refresh token failed for orgId=%s (%s), clearing cache and trying fresh exchange`,
      orgId,
      refreshed.type,
    );
    // Official qu[n]=null then fall through to O5t
  }

  console.info(
    `${LOG} performing fresh oauth exchange for orgId=%s`,
    orgId,
  );
  const exchanged = await exchangeCoworkOauthFromCookies(config);
  if (!isTokenSuccess(exchanged)) {
    console.info(
      `${LOG} failed to obtain oauth token for orgId=%s (%s): %s`,
      orgId,
      exchanged.type,
      exchanged.detail,
    );
    return { ok: false, reason: exchanged };
  }
  if (getCoworkOauthTokenCacheGeneration() !== generationAtStart) {
    console.info(
      `${LOG} token cache cleared during exchange; discarding`,
    );
    return {
      ok: false,
      reason: {
        type: "not_logged_in",
        detail: "cache cleared mid-flow",
      },
    };
  }

  console.info(`${LOG} obtained new token for orgId=%s, caching`, orgId);
  const tier = await maybeFetchProfileTier(config, exchanged.token);
  setCoworkOauthCachedToken({
    token: exchanged.token,
    refreshToken: exchanged.refreshToken,
    expiresAt: now + exchanged.expires * 1000,
    key: cacheKey,
    subscriptionType: tier?.subscriptionType,
    rateLimitTier: tier?.rateLimitTier,
  });
  await persistCoworkOauthTokenCache();
  return {
    ok: true,
    token: exchanged.token,
    subscriptionType: tier?.subscriptionType ?? null,
    rateLimitTier: tier?.rateLimitTier ?? null,
  };
}

/**
 * Official _h / getApiToken residual — token string or null (no invent).
 */
export async function getCoworkApiToken(
  config: CoworkOauthConfig,
): Promise<string | null> {
  const result = await performCoworkOauthFlow(config);
  return result.ok ? result.token : null;
}

/**
 * Official IIr getOAuthToken residual for sessions bridge:
 * COWORK config + sessions scope → getApiToken; empty → throw for client start fail.
 */
export async function getSessionsBridgeOAuthToken(options?: {
  apiHost?: string | null;
}): Promise<string> {
  const config = resolveCoworkSessionsBridgeOauthConfig({
    apiHost: options?.apiHost,
  });
  const token = await getCoworkApiToken(config);
  if (!token) {
    throw new Error(
      `[sessions-bridge] No OAuth access token available for sessions bridge`,
    );
  }
  return token;
}
