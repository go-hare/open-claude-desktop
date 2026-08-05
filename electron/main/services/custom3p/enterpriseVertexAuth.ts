/**
 * Official Vertex OAuth residual (h1e / f1e / p1e / w1e / vbA / U5t / F5t):
 * Desktop-app OAuth client → loopback PKCE → store authorized_user ADC →
 * GOOGLE_APPLICATION_CREDENTIALS file for CLI spawn.
 *
 * data-official-source: app.asar h1e / p1e / w1e / F5t
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  needsEnterpriseVertexAuth,
  resolveEnterpriseVertexOAuth,
  type CoworkEnterpriseConfigDeps,
} from "../coworkHostLoop/coworkEnterpriseConfig";
import { runEnterprisePkceAuth } from "./enterprisePkceAuth";
import {
  deleteEnterpriseSecret,
  ENTERPRISE_SECRET_KEYS,
  readEnterpriseSecretJson,
  writeEnterpriseSecretJson,
} from "./enterpriseSecureStore";

export const VERTEX_OAUTH_AUTH_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const VERTEX_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const VERTEX_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type VertexAuthorizedUser = {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
  token_uri: string;
};

let inFlight: Promise<void> | null = null;
let generation = 0;

export function readVertexAuthorizedUser(): VertexAuthorizedUser | null {
  const raw = readEnterpriseSecretJson<VertexAuthorizedUser>(
    ENTERPRISE_SECRET_KEYS.vertexOAuth,
  );
  if (!raw || raw.type !== "authorized_user") return null;
  if (
    typeof raw.client_id !== "string" ||
    typeof raw.client_secret !== "string" ||
    typeof raw.refresh_token !== "string"
  ) {
    return null;
  }
  return raw;
}

export function storeVertexAuthorizedUser(user: VertexAuthorizedUser): void {
  writeEnterpriseSecretJson(ENTERPRISE_SECRET_KEYS.vertexOAuth, user);
}

export function clearVertexAuthorizedUser(): void {
  deleteEnterpriseSecret(ENTERPRISE_SECRET_KEYS.vertexOAuth);
}

/**
 * Official f1e residual — needs interactive auth when provider=vertex,
 * OAuth client configured, no credentials file, and no matching stored ADC.
 */
export function needsVertexInteractiveAuth(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean {
  if (!needsEnterpriseVertexAuth(deps)) return false;
  const oauth = resolveEnterpriseVertexOAuth(deps);
  if (!oauth) return false;
  const stored = readVertexAuthorizedUser();
  if (stored && stored.client_id !== oauth.clientId) {
    clearVertexAuthorizedUser();
    return true;
  }
  return stored === null;
}

/**
 * Official p1e residual — browser Google sign-in; requires refresh_token.
 */
export async function runVertexInteractiveAuth(
  deps: CoworkEnterpriseConfigDeps = {},
): Promise<void> {
  if (inFlight) return inFlight;
  const gen = generation;
  inFlight = (async () => {
    const oauth = resolveEnterpriseVertexOAuth(deps);
    if (!oauth) {
      throw new Error(
        "inferenceVertexOAuthClientId / Secret are not configured",
      );
    }
    const tokens = await runEnterprisePkceAuth({
      authorizationUrl: VERTEX_OAUTH_AUTH_URL,
      tokenUrl: VERTEX_OAUTH_TOKEN_URL,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      scopes: oauth.scopes,
      googleOfflineAccess: true,
      displayName: "Google",
    });
    if (!tokens.refreshToken) {
      throw new Error(
        "Google did not return a refresh_token; check the OAuth client is type 'Desktop app'",
      );
    }
    if (gen !== generation) return;
    storeVertexAuthorizedUser({
      type: "authorized_user",
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: tokens.refreshToken,
      token_uri: VERTEX_OAUTH_TOKEN_URL,
    });
  })().finally(() => {
    if (gen === generation) inFlight = null;
  });
  return inFlight;
}

/**
 * Official w1e residual — clear ADC + best-effort revoke.
 */
export async function revokeVertexAuth(): Promise<void> {
  generation += 1;
  inFlight = null;
  const prev = readVertexAuthorizedUser();
  clearVertexAuthorizedUser();
  if (!prev?.refresh_token) return;
  try {
    const res = await fetch(VERTEX_OAUTH_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: prev.refresh_token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(
        "[custom-3p] Google token revoke returned non-2xx",
        res.status,
      );
    }
  } catch (error) {
    console.warn(
      "[custom-3p] Google token revoke request failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Materialize authorized_user JSON for GOOGLE_APPLICATION_CREDENTIALS spawn inject.
 * Official F5t refreshes access tokens for probes; CLI ADC uses refresh_token file.
 */
export function materializeVertexAdcFile(
  userDataPath?: string,
): string | null {
  const user = readVertexAuthorizedUser();
  if (!user) return null;
  const dir =
    userDataPath && userDataPath.length > 0
      ? path.join(userDataPath, "enterprise-auth")
      : path.join(os.tmpdir(), "claude-enterprise-auth");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "vertex-adc.json");
  fs.writeFileSync(filePath, JSON.stringify(user), { encoding: "utf8", mode: 0o600 });
  return filePath;
}

/** Spawn env fragment when Vertex OAuth ADC is stored and bag has no credentials file. */
export function buildVertexOAuthSpawnEnv(
  deps: CoworkEnterpriseConfigDeps & { userDataPath?: string } = {},
): Record<string, string> {
  const oauth = resolveEnterpriseVertexOAuth(deps);
  if (!oauth) return {};
  const credsFile = materializeVertexAdcFile(deps.userDataPath);
  if (!credsFile) return {};
  return { GOOGLE_APPLICATION_CREDENTIALS: credsFile };
}
