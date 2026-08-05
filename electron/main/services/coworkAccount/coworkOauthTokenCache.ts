/**
 * Official oauth token cache residual (app.asar qu / Lm / l5 / L5t / G5t / UHe subset):
 *
 *   const LHe = "oauth:tokenCache"
 *   function G5t(clientId, orgId, apiHost, scope) → `${clientId}:${orgId}:${apiHost}:${scope}`
 *   async function l5()  — safeStorage.encryptString(JSON.stringify(qu)) → electron-store LHe
 *   async function L5t() — load once from store (poe guard)
 *   async function Lm()  — C5++; qu={}; await l5()
 *   UHe: load L5t → cache hit / refresh / O5t exchange (exchange not productized here)
 *
 * Product residual:
 *   - In-memory map + optional safeStorage persistence (same key + encrypt shape).
 *   - Does not invent tokens. O5t/UHe exchange lives in coworkOauthFlow.ts
 *     and only writes real Anthropic responses via setCoworkOauthCachedToken.
 *   - Expired entries remain in map for F5t refresh (peek); get returns null.
 *
 * data-official-source: app.asar qu / LHe / G5t / l5 / L5t / Lm / UHe
 */

import { safeStorage } from "electron";
import Store from "electron-store";

/** Official LHe */
export const COWORK_OAUTH_TOKEN_CACHE_STORE_KEY = "oauth:tokenCache" as const;

/**
 * Official cache entry residual (qu[n]).
 * Product also accepts expiresAtMs alias for older writers.
 */
export type CoworkOauthCachedToken = {
  /** Opaque access token string. */
  token: string;
  /** Official refreshToken residual. */
  refreshToken?: string;
  /** Official expiresAt unix ms. */
  expiresAt?: number;
  /** Product alias for expiresAt (older residual). */
  expiresAtMs?: number;
  /** Optional environment / G5t key (oauth env / host / org composite). */
  key?: string;
  /** Official subscriptionType residual (max/pro/… or null). */
  subscriptionType?: string | null;
  /** Official rateLimitTier residual. */
  rateLimitTier?: string | null;
};

type StoreShape = {
  [COWORK_OAUTH_TOKEN_CACHE_STORE_KEY]?: string;
};

type PersistDeps = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => string;
  decryptString: (b64: string) => string;
  getStored: () => string | undefined;
  setStored: (b64: string) => void;
  path?: string;
};

let cache = new Map<string, CoworkOauthCachedToken>();
/** Official C5 generation — increments on each Lm clear. */
let clearGeneration = 0;
/** Official poe — L5t ran once. */
let loadedFromDisk = false;

let storeSingleton: Store<StoreShape> | null = null;
let persistDepsOverride: PersistDeps | null = null;

function getStore(): Store<StoreShape> {
  if (!storeSingleton) {
    storeSingleton = new Store<StoreShape>({ clearInvalidConfig: true });
  }
  return storeSingleton;
}

function defaultPersistDeps(): PersistDeps {
  const store = getStore();
  return {
    isEncryptionAvailable: () => {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
    encryptString: (plain: string) =>
      safeStorage.encryptString(plain).toString("base64"),
    decryptString: (b64: string) =>
      safeStorage.decryptString(Buffer.from(b64, "base64")),
    getStored: () => {
      const v = store.get(COWORK_OAUTH_TOKEN_CACHE_STORE_KEY);
      return typeof v === "string" && v.length > 0 ? v : undefined;
    },
    setStored: (b64: string) => {
      store.set(COWORK_OAUTH_TOKEN_CACHE_STORE_KEY, b64);
    },
    path: typeof store.path === "string" ? store.path : undefined,
  };
}

function deps(): PersistDeps {
  return persistDepsOverride ?? defaultPersistDeps();
}

function cacheKey(key?: string): string {
  return key && key.length > 0 ? key : "default";
}

function resolveExpiresAtMs(entry: CoworkOauthCachedToken): number | undefined {
  if (typeof entry.expiresAt === "number" && Number.isFinite(entry.expiresAt)) {
    return entry.expiresAt;
  }
  if (
    typeof entry.expiresAtMs === "number" &&
    Number.isFinite(entry.expiresAtMs)
  ) {
    return entry.expiresAtMs;
  }
  return undefined;
}

function isExpired(entry: CoworkOauthCachedToken, now = Date.now()): boolean {
  const exp = resolveExpiresAtMs(entry);
  return typeof exp === "number" && now >= exp;
}

/** Official G5t residual — cache key for client/org/host/scope. */
export function buildCoworkOauthCacheKey(
  clientId: string,
  orgId: string,
  apiHost: string,
  scope: string,
): string {
  return `${clientId}:${orgId}:${apiHost}:${scope}`;
}

/** Official C5 generation — increments on each Lm clear. */
export function getCoworkOauthTokenCacheGeneration(): number {
  return clearGeneration;
}

export function getCoworkOauthTokenCacheSize(): number {
  return cache.size;
}

/**
 * Official l5 residual — persist qu via safeStorage + electron-store LHe.
 * No-op when encryption unavailable (official warn path).
 */
export async function persistCoworkOauthTokenCache(): Promise<void> {
  const d = deps();
  if (!d.isEncryptionAvailable()) {
    console.warn(
      "[oauth] safeStorage not available, tokens will not persist",
    );
    return;
  }
  try {
    const plain: Record<string, CoworkOauthCachedToken> = {};
    for (const [k, v] of cache.entries()) {
      plain[k] = { ...v };
    }
    const keys = Object.keys(plain);
    console.debug(
      "[oauth] persisting token cache with %d entries: %o",
      keys.length,
      keys,
    );
    const b64 = d.encryptString(JSON.stringify(plain));
    d.setStored(b64);
  } catch (err) {
    console.error("Failed to persist OAuth token cache: %o", err);
  }
}

/**
 * Official L5t residual — load once from disk into qu.
 * Idempotent via poe (loadedFromDisk).
 */
export async function loadCoworkOauthTokenCacheFromDisk(): Promise<void> {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  const d = deps();
  try {
    if (d.path) {
      console.info("[oauth] token cache location: %s", d.path);
    }
    const raw = d.getStored();
    if (!raw) {
      console.info("[oauth] no persisted token cache found");
      return;
    }
    if (!d.isEncryptionAvailable()) {
      console.warn(
        "safeStorage not available, cannot decrypt tokens",
      );
      return;
    }
    const json = d.decryptString(raw);
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error("Failed to load OAuth token cache: invalid shape");
      cache = new Map();
      return;
    }
    const next = new Map<string, CoworkOauthCachedToken>();
    for (const [k, v] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!v || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      if (typeof e.token !== "string" || e.token.length === 0) continue;
      const entry: CoworkOauthCachedToken = {
        token: e.token,
        key: k,
      };
      if (typeof e.refreshToken === "string") entry.refreshToken = e.refreshToken;
      if (typeof e.expiresAt === "number") entry.expiresAt = e.expiresAt;
      if (typeof e.expiresAtMs === "number") entry.expiresAtMs = e.expiresAtMs;
      if (e.subscriptionType === null || typeof e.subscriptionType === "string") {
        entry.subscriptionType = e.subscriptionType as string | null;
      }
      if (e.rateLimitTier === null || typeof e.rateLimitTier === "string") {
        entry.rateLimitTier = e.rateLimitTier as string | null;
      }
      next.set(k, entry);
    }
    cache = next;
    console.info(
      "[oauth] loaded token cache from disk with %d entries: %o",
      cache.size,
      [...cache.keys()],
    );
  } catch (err) {
    console.error("Failed to load OAuth token cache: %o", err);
    cache = new Map();
  }
}

/**
 * Ensure L5t ran (official UHe poe path). Safe to call repeatedly.
 */
export async function ensureCoworkOauthTokenCacheLoaded(): Promise<void> {
  if (loadedFromDisk) return;
  console.info("Trying to load oauth token cache");
  await loadCoworkOauthTokenCacheFromDisk();
}

export function setCoworkOauthCachedToken(
  token: CoworkOauthCachedToken,
): void {
  if (!token.token || typeof token.token !== "string") return;
  const key = cacheKey(token.key);
  const entry: CoworkOauthCachedToken = { ...token, key };
  // Normalize expiresAt from alias
  if (
    entry.expiresAt === undefined &&
    typeof entry.expiresAtMs === "number"
  ) {
    entry.expiresAt = entry.expiresAtMs;
  }
  cache.set(key, entry);
  // Official: await l5() after write — fire-and-forget for sync set API.
  void persistCoworkOauthTokenCache();
}

/**
 * Peek cache entry without expiry eviction (official UHe reads qu[n]
 * even when expired so F5t can use refreshToken).
 */
export function peekCoworkOauthCachedToken(
  key?: string,
): CoworkOauthCachedToken | null {
  const entry = cache.get(cacheKey(key));
  return entry ? { ...entry } : null;
}

export function getCoworkOauthCachedToken(
  key?: string,
): CoworkOauthCachedToken | null {
  // Sync get residual: memory only. Callers that need disk must await
  // ensureCoworkOauthTokenCacheLoaded() first (official UHe does).
  const entry = cache.get(cacheKey(key));
  if (!entry) return null;
  if (isExpired(entry)) {
    // Keep entry in map for UHe refresh residual (F5t). Callers that
    // only want a live access token still get null here.
    return null;
  }
  return { ...entry };
}

/**
 * Async get residual matching UHe cache-hit subset (load disk first).
 * Does not invent exchange — empty after load → null.
 */
export async function getCoworkOauthCachedTokenAsync(
  key?: string,
): Promise<CoworkOauthCachedToken | null> {
  await ensureCoworkOauthTokenCacheLoaded();
  return getCoworkOauthCachedToken(key);
}

/**
 * Official Lm residual — clear all cached oauth tokens + persist empty.
 * Returns previous key count (for logs / tests).
 */
export function clearCoworkOauthTokenCache(): number {
  const had = cache.size;
  if (had > 0) {
    console.info("[oauth] clearing token cache, had %d cached tokens", had);
  }
  clearGeneration += 1;
  cache = new Map();
  void persistCoworkOauthTokenCache();
  return had;
}

/** Test / inject: override safeStorage + store surface. */
export function setCoworkOauthTokenCachePersistDepsForTests(
  next: PersistDeps | null,
): void {
  persistDepsOverride = next;
}

export function resetCoworkOauthTokenCacheForTests(): void {
  cache = new Map();
  clearGeneration = 0;
  loadedFromDisk = false;
  persistDepsOverride = null;
}
