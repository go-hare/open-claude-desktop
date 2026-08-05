/**
 * Official bootstrap residual (dPe / r5t / Bz NeedsBootstrapAuthError):
 * When bootstrapUrl set, optionally PKCE via bootstrapOidc, GET bootstrap JSON,
 * merge overlay keys (remote tier).
 *
 * data-official-source: app.asar dPe / r5t
 */
import {
  loadCoworkEnterpriseConfig,
  resolveEnterpriseBootstrapOidc,
  setCoworkEnterpriseRemoteTier,
  type CoworkEnterpriseConfigDeps,
} from "../coworkHostLoop/coworkEnterpriseConfig";
import { runEnterprisePkceAuth } from "./enterprisePkceAuth";
import {
  deleteEnterpriseSecret,
  ENTERPRISE_SECRET_KEYS,
  readEnterpriseSecretJson,
  writeEnterpriseSecretJson,
} from "./enterpriseSecureStore";

export class NeedsBootstrapAuthError extends Error {
  constructor() {
    super("bootstrapOidc requires interactive sign-in");
    this.name = "NeedsBootstrapAuthError";
  }
}

export type BootstrapFetchResult =
  | {
      ok: true;
      value: {
        config: Record<string, unknown>;
        expiresAt?: number;
      };
    }
  | {
      ok: false;
      kind: "unconfigured" | "parse" | "auth" | "http" | "unreachable";
      detail?: string;
      status?: number;
    };

type BootstrapOidcToken = {
  accessToken: string;
  expiresAt?: number;
  clientId: string;
};

const DEFAULT_CACHE_MS = 5 * 60_000;
let memoryCache:
  | { value: BootstrapFetchResult; expiresAt: number }
  | null = null;

function bootstrapOriginPath(bootstrapUrl: string): {
  origin: string;
  base: string;
} {
  const u = new URL(bootstrapUrl);
  const pathname = u.pathname.replace(/\/(?:user\/)?bootstrap\/?$/i, "");
  const base =
    pathname === "" || pathname === "/" ? u.origin : u.origin + pathname;
  return { origin: u.origin, base };
}

function readStoredOidcToken(): BootstrapOidcToken | null {
  return readEnterpriseSecretJson<BootstrapOidcToken>(
    ENTERPRISE_SECRET_KEYS.bootstrapOidc,
  );
}

function storeOidcToken(token: BootstrapOidcToken): void {
  writeEnterpriseSecretJson(ENTERPRISE_SECRET_KEYS.bootstrapOidc, token);
}

export function clearBootstrapOidcToken(): void {
  deleteEnterpriseSecret(ENTERPRISE_SECRET_KEYS.bootstrapOidc);
  memoryCache = null;
}

/**
 * Official n5t residual — interactive OIDC if no valid cached access token.
 */
export async function resolveBootstrapOidcAccessToken(
  deps: CoworkEnterpriseConfigDeps = {},
  interactive = true,
): Promise<string | null> {
  const oidc = resolveEnterpriseBootstrapOidc(deps);
  if (!oidc) return null;
  const stored = readStoredOidcToken();
  if (
    stored &&
    stored.clientId === oidc.clientId &&
    stored.accessToken &&
    (stored.expiresAt === undefined || stored.expiresAt > Date.now() + 30_000)
  ) {
    return stored.accessToken;
  }
  if (!interactive) {
    throw new NeedsBootstrapAuthError();
  }
  if (!oidc.authorizationUrl || !oidc.tokenUrl) {
    throw new Error(
      "bootstrapOidc requires authorizationUrl and tokenUrl for interactive sign-in",
    );
  }
  const tokens = await runEnterprisePkceAuth({
    authorizationUrl: oidc.authorizationUrl,
    tokenUrl: oidc.tokenUrl,
    clientId: oidc.clientId,
    scopes: oidc.scopes,
    displayName: "Bootstrap OIDC",
  });
  storeOidcToken({
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    clientId: oidc.clientId,
  });
  return tokens.accessToken;
}

/**
 * Official r5t / dPe residual — fetch bootstrap JSON, apply remote tier.
 */
export async function fetchEnterpriseBootstrapConfig(
  deps: CoworkEnterpriseConfigDeps = {},
  options: { interactive?: boolean; applyRemoteTier?: boolean } = {},
): Promise<BootstrapFetchResult> {
  const interactive = options.interactive !== false;
  const applyRemote = options.applyRemoteTier !== false;
  const snap = loadCoworkEnterpriseConfig(deps);
  const bag = snap.raw;
  const bootstrapUrl =
    typeof bag.bootstrapUrl === "string" ? bag.bootstrapUrl.trim() : "";
  if (!bootstrapUrl || bag.bootstrapEnabled === false) {
    return { ok: false, kind: "unconfigured" };
  }

  const now = Date.now();
  if (memoryCache && memoryCache.expiresAt > now) {
    return memoryCache.value;
  }

  let origin: string;
  try {
    origin = bootstrapOriginPath(bootstrapUrl).origin;
  } catch {
    return { ok: false, kind: "parse", detail: "invalid URL" };
  }
  void origin;

  const oidc = resolveEnterpriseBootstrapOidc(deps);
  let bearer: string | undefined;
  try {
    if (oidc) {
      bearer =
        (await resolveBootstrapOidcAccessToken(deps, interactive)) ?? undefined;
    }
  } catch (error) {
    if (error instanceof NeedsBootstrapAuthError) {
      return { ok: false, kind: "auth" };
    }
    return {
      ok: false,
      kind: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  let text: string;
  try {
    const res = await fetch(bootstrapUrl, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (oidc) clearBootstrapOidcToken();
        return {
          ok: false,
          kind: "auth",
          status: res.status,
          detail: `HTTP ${res.status}`,
        };
      }
      return {
        ok: false,
        kind: "http",
        status: res.status,
        detail: `HTTP ${res.status}`,
      };
    }
    text = (await res.text()).trim();
  } catch (error) {
    return {
      ok: false,
      kind: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, kind: "parse", detail: "response is not a JSON object" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, kind: "parse", detail: "response is not a JSON object" };
  }

  const root = parsed as Record<string, unknown>;
  const config =
    root.config && typeof root.config === "object" && !Array.isArray(root.config)
      ? (root.config as Record<string, unknown>)
      : root;

  const expiresAt =
    typeof root.expiresAt === "number"
      ? root.expiresAt
      : typeof root.expires_at === "number"
        ? root.expires_at
        : now + DEFAULT_CACHE_MS;

  const result: BootstrapFetchResult = {
    ok: true,
    value: { config, expiresAt },
  };
  memoryCache = {
    value: result,
    expiresAt: Math.min(expiresAt, now + DEFAULT_CACHE_MS),
  };

  if (applyRemote) {
    setCoworkEnterpriseRemoteTier(config);
  }
  return result;
}

export function resetBootstrapCacheForTests(): void {
  memoryCache = null;
}
