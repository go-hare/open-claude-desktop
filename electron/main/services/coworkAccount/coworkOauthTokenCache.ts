/**
 * Official oauth token cache residual (app.asar qu / Lm / clearTokenCache):
 *
 *   async function Lm() {
 *     const e = Object.keys(qu);
 *     S.info("[oauth] clearing token cache, had %d cached tokens", e.length);
 *     C5++; qu = {}; await l5();
 *   }
 *
 * Product residual: in-process token map cleared on account identity change.
 * Does not invent tokens; only stores what callers put in.
 */

export type CoworkOauthCachedToken = {
  /** Opaque access token string. */
  token: string;
  /** Optional expiry unix ms. */
  expiresAtMs?: number;
  /** Optional environment key (oauth env / host). */
  key?: string;
};

let cache = new Map<string, CoworkOauthCachedToken>();
let clearGeneration = 0;

function cacheKey(key?: string): string {
  return key && key.length > 0 ? key : "default";
}

/** Official C5 generation — increments on each Lm clear. */
export function getCoworkOauthTokenCacheGeneration(): number {
  return clearGeneration;
}

export function getCoworkOauthTokenCacheSize(): number {
  return cache.size;
}

export function setCoworkOauthCachedToken(
  token: CoworkOauthCachedToken,
): void {
  if (!token.token || typeof token.token !== "string") return;
  cache.set(cacheKey(token.key), { ...token });
}

export function getCoworkOauthCachedToken(
  key?: string,
): CoworkOauthCachedToken | null {
  const entry = cache.get(cacheKey(key));
  if (!entry) return null;
  if (
    typeof entry.expiresAtMs === "number"
    && Number.isFinite(entry.expiresAtMs)
    && Date.now() >= entry.expiresAtMs
  ) {
    cache.delete(cacheKey(key));
    return null;
  }
  return { ...entry };
}

/**
 * Official Lm residual — clear all cached oauth tokens.
 * Returns previous key count (for logs / tests).
 */
export function clearCoworkOauthTokenCache(): number {
  const had = cache.size;
  if (had > 0) {
    console.info("[oauth] clearing token cache, had %d cached tokens", had);
  }
  clearGeneration += 1;
  cache = new Map();
  return had;
}

export function resetCoworkOauthTokenCacheForTests(): void {
  cache = new Map();
  clearGeneration = 0;
}
