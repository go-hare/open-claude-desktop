/**
 * Official refreshOAuthTokenForSdk residual (app.asar):
 *   async refreshOAuthTokenForSdk(){ await Lm(); … return t.ok?t.token:null }
 * Wired as options.getOAuthToken when Query process requests token refresh after 401.
 *
 * Product honesty (CLAUDE.md):
 *   - Does NOT invent Anthropic OAuth login success.
 *   - Only returns a live token already present in cowork oauth token cache (default key).
 *   - Empty cache → null (same as official fail path).
 *   - 3p / gateway auth uses env injection, not this callback.
 */
import {
  ensureCoworkOauthTokenCacheLoaded,
  getCoworkOauthCachedToken,
} from "../coworkAccount/coworkOauthTokenCache";

/**
 * Official getOAuthToken callback residual for SDK Options.
 * Returns access token string or null — never fabricates credentials.
 */
export async function refreshCodeSdkOAuthTokenResidual(): Promise<string | null> {
  try {
    await ensureCoworkOauthTokenCacheLoaded();
    // Official UHe cache-hit subset: live non-expired token only.
    const entry = getCoworkOauthCachedToken();
    if (entry?.token && entry.token.length > 0) return entry.token;
    return null;
  } catch {
    return null;
  }
}
