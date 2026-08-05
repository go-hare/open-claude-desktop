/**
 * Official Bedrock SSO residual (GV / CHe / uHe / hHe / krA / EHe):
 * IAM Identity Center device authorization → access token → GetRoleCredentials
 * → temporary AWS keys for spawn.
 *
 * data-official-source: app.asar uHe / hHe / ozt / uoe
 */
import {
  needsEnterpriseBedrockSsoAuth,
  resolveEnterpriseBedrockSso,
  type CoworkEnterpriseBedrockSso,
  type CoworkEnterpriseConfigDeps,
} from "../coworkHostLoop/coworkEnterpriseConfig";
import {
  deleteEnterpriseSecret,
  ENTERPRISE_SECRET_KEYS,
  readEnterpriseSecretJson,
  writeEnterpriseSecretJson,
} from "./enterpriseSecureStore";
import { shell } from "electron";

const CLIENT_NAME = "Claude Desktop";
const SSO_SCOPE = "sso:account:access";
const SKEW_MS = 60_000;
const POLL_MAX_MS = 5_000;
const DEVICE_TIMEOUT_MS = 10 * 60_000;

export type BedrockSsoStored = {
  startUrl: string;
  ssoRegion: string;
  clientId: string;
  clientSecret: string;
  clientExpiresAt: number;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken?: string;
};

export type BedrockRoleCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt?: number;
};

type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

let inFlight: Promise<void> | null = null;
let generation = 0;
let deviceUi: { userCode: string; url: string } | null = null;

function oidcBase(region: string): string {
  return `https://oidc.${region}.amazonaws.com`;
}

function ssoBase(region: string): string {
  return `https://portal.sso.${region}.amazonaws.com`;
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const errType =
      typeof json.__type === "string"
        ? json.__type
        : typeof json.error === "string"
          ? json.error
          : `HTTP_${res.status}`;
    const err = new Error(
      typeof json.message === "string"
        ? json.message
        : `Bedrock SSO request failed (${errType})`,
    ) as Error & { errorType?: string; status?: number };
    err.errorType = errType;
    err.status = res.status;
    throw err;
  }
  return json;
}

export function readBedrockSsoStored(): BedrockSsoStored | null {
  const raw = readEnterpriseSecretJson<BedrockSsoStored>(
    ENTERPRISE_SECRET_KEYS.bedrockSso,
  );
  if (!raw?.clientId || !raw.accessToken) return null;
  return raw;
}

export function storeBedrockSso(value: BedrockSsoStored): void {
  writeEnterpriseSecretJson(ENTERPRISE_SECRET_KEYS.bedrockSso, value);
}

export function clearBedrockSso(): void {
  deleteEnterpriseSecret(ENTERPRISE_SECRET_KEYS.bedrockSso);
  deviceUi = null;
}

export function getBedrockSsoDeviceUi(): {
  userCode: string;
  url: string;
} | null {
  return deviceUi;
}

export function needsBedrockSsoInteractiveAuth(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean {
  if (!needsEnterpriseBedrockSsoAuth(deps)) return false;
  const cfg = resolveEnterpriseBedrockSso(deps);
  if (!cfg) return false;
  const stored = readBedrockSsoStored();
  if (stored && stored.startUrl !== cfg.startUrl) {
    clearBedrockSso();
    return true;
  }
  return stored === null;
}

/**
 * Official uHe residual — device authorization + poll for tokens.
 */
export async function runBedrockSsoAuth(
  deps: CoworkEnterpriseConfigDeps = {},
  fetchImpl: FetchLike = fetch,
  onDeviceCode?: (userCode: string) => void,
): Promise<void> {
  if (inFlight) {
    if (deviceUi) {
      onDeviceCode?.(deviceUi.userCode);
      await shell.openExternal(deviceUi.url);
    }
    return inFlight;
  }
  const gen = generation;
  inFlight = (async () => {
    const cfg = resolveEnterpriseBedrockSso(deps);
    if (!cfg) {
      throw new Error("inferenceBedrockSso* MDM keys are not configured");
    }
    let stored = readBedrockSsoStored();
    let clientId: string;
    let clientSecret: string;
    let clientExpiresAt: number;
    if (
      stored &&
      stored.startUrl === cfg.startUrl &&
      stored.clientExpiresAt - SKEW_MS > Date.now()
    ) {
      clientId = stored.clientId;
      clientSecret = stored.clientSecret;
      clientExpiresAt = stored.clientExpiresAt;
    } else {
      const registered = await postJson(
        `${oidcBase(cfg.ssoRegion)}/client/register`,
        {
          clientName: CLIENT_NAME,
          clientType: "public",
          scopes: [SSO_SCOPE],
        },
        fetchImpl,
      );
      clientId = String(registered.clientId ?? "");
      clientSecret = String(registered.clientSecret ?? "");
      const expSec =
        typeof registered.clientSecretExpiresAt === "number"
          ? registered.clientSecretExpiresAt
          : 0;
      clientExpiresAt = expSec * 1000;
      if (!clientId || !clientSecret) {
        throw new Error("Bedrock SSO client registration incomplete");
      }
    }

    const device = await postJson(
      `${oidcBase(cfg.ssoRegion)}/device_authorization`,
      {
        clientId,
        clientSecret,
        startUrl: cfg.startUrl,
      },
      fetchImpl,
    );
    const userCode = String(device.userCode ?? "");
    const deviceCode = String(device.deviceCode ?? "");
    const verificationUriComplete = String(
      device.verificationUriComplete ?? device.verificationUri ?? "",
    );
    if (!userCode || !deviceCode || !verificationUriComplete) {
      throw new Error("Bedrock SSO device authorization incomplete");
    }
    deviceUi = { userCode, url: verificationUriComplete };
    onDeviceCode?.(userCode);
    await shell.openExternal(verificationUriComplete);

    let intervalMs = Math.max(
      1000,
      (typeof device.interval === "number" ? device.interval : 5) * 1000,
    );
    const expiresIn =
      typeof device.expiresIn === "number" ? device.expiresIn : 600;
    const deadline = Date.now() + Math.min(expiresIn * 1000, DEVICE_TIMEOUT_MS);

    for (;;) {
      if (gen !== generation) throw new Error("Bedrock SSO grant superseded");
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("Bedrock SSO timed out waiting for browser approval");
      }
      await new Promise((r) => setTimeout(r, Math.min(intervalMs, remaining)));
      try {
        const token = await postJson(
          `${oidcBase(cfg.ssoRegion)}/token`,
          {
            clientId,
            clientSecret,
            deviceCode,
            grantType: "urn:ietf:params:oauth:grant-type:device_code",
          },
          fetchImpl,
        );
        const accessToken = String(token.accessToken ?? token.access_token ?? "");
        const expiresInTok =
          typeof token.expiresIn === "number"
            ? token.expiresIn
            : typeof token.expires_in === "number"
              ? token.expires_in
              : 3600;
        const refreshToken =
          typeof token.refreshToken === "string"
            ? token.refreshToken
            : typeof token.refresh_token === "string"
              ? token.refresh_token
              : undefined;
        if (!accessToken) {
          throw new Error("Bedrock SSO token response missing accessToken");
        }
        if (gen !== generation) throw new Error("Bedrock SSO grant superseded");
        storeBedrockSso({
          startUrl: cfg.startUrl,
          ssoRegion: cfg.ssoRegion,
          clientId,
          clientSecret,
          clientExpiresAt,
          accessToken,
          accessTokenExpiresAt: Date.now() + expiresInTok * 1000,
          refreshToken,
        });
        deviceUi = null;
        return;
      } catch (error) {
        const errType =
          error && typeof error === "object" && "errorType" in error
            ? String((error as { errorType?: string }).errorType)
            : "";
        if (
          errType.includes("AuthorizationPending") ||
          errType.includes("SlowDown")
        ) {
          if (errType.includes("SlowDown")) {
            intervalMs = Math.min(intervalMs + 5000, POLL_MAX_MS);
          }
          continue;
        }
        throw error;
      }
    }
  })().finally(() => {
    if (gen === generation) inFlight = null;
  });
  return inFlight;
}

export async function revokeBedrockSsoAuth(): Promise<void> {
  generation += 1;
  inFlight = null;
  clearBedrockSso();
}

/**
 * Official hHe residual — resolve temporary role credentials for spawn.
 */
export async function resolveBedrockRoleCredentials(
  deps: CoworkEnterpriseConfigDeps = {},
  fetchImpl: FetchLike = fetch,
): Promise<BedrockRoleCredentials | null> {
  const cfg = resolveEnterpriseBedrockSso(deps);
  if (!cfg) return null;
  let stored = readBedrockSsoStored();
  if (!stored || stored.startUrl !== cfg.startUrl) return null;

  if (stored.accessTokenExpiresAt - SKEW_MS <= Date.now()) {
    const refreshed = await refreshAccessToken(stored, fetchImpl);
    if (!refreshed) {
      clearBedrockSso();
      return null;
    }
    stored = refreshed;
    storeBedrockSso(refreshed);
  }

  return getRoleCredentials(stored, cfg, fetchImpl);
}

async function refreshAccessToken(
  stored: BedrockSsoStored,
  fetchImpl: FetchLike,
): Promise<BedrockSsoStored | null> {
  if (!stored.refreshToken || stored.clientExpiresAt <= Date.now()) {
    return null;
  }
  try {
    const token = await postJson(
      `${oidcBase(stored.ssoRegion)}/token`,
      {
        clientId: stored.clientId,
        clientSecret: stored.clientSecret,
        refreshToken: stored.refreshToken,
        grantType: "refresh_token",
      },
      fetchImpl,
    );
    const accessToken = String(token.accessToken ?? token.access_token ?? "");
    const expiresIn =
      typeof token.expiresIn === "number"
        ? token.expiresIn
        : typeof token.expires_in === "number"
          ? token.expires_in
          : 3600;
    if (!accessToken) return null;
    return {
      ...stored,
      accessToken,
      accessTokenExpiresAt: Date.now() + expiresIn * 1000,
      refreshToken:
        typeof token.refreshToken === "string"
          ? token.refreshToken
          : typeof token.refresh_token === "string"
            ? token.refresh_token
            : stored.refreshToken,
    };
  } catch {
    return null;
  }
}

async function getRoleCredentials(
  stored: BedrockSsoStored,
  cfg: CoworkEnterpriseBedrockSso,
  fetchImpl: FetchLike,
): Promise<BedrockRoleCredentials | null> {
  const url = new URL(`${ssoBase(stored.ssoRegion)}/federation/credentials`);
  url.searchParams.set("account_id", cfg.accountId);
  url.searchParams.set("role_name", cfg.roleName);
  const res = await fetchImpl(url.toString(), {
    method: "GET",
    headers: { "x-amz-sso_bearer_token": stored.accessToken },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) {
    clearBedrockSso();
    return null;
  }
  if (!res.ok) {
    throw new Error(`Bedrock SSO GetRoleCredentials HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    roleCredentials?: {
      accessKeyId?: string;
      secretAccessKey?: string;
      sessionToken?: string;
      expiration?: number;
    };
  };
  const rc = json.roleCredentials;
  if (!rc?.accessKeyId || !rc.secretAccessKey || !rc.sessionToken) {
    return null;
  }
  return {
    accessKeyId: rc.accessKeyId,
    secretAccessKey: rc.secretAccessKey,
    sessionToken: rc.sessionToken,
    expiresAt:
      typeof rc.expiration === "number" ? rc.expiration : undefined,
  };
}

/** Spawn env from temporary SSO role credentials. */
export function bedrockRoleCredentialsToEnv(
  creds: BedrockRoleCredentials,
): Record<string, string> {
  return {
    AWS_ACCESS_KEY_ID: creds.accessKeyId,
    AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
    AWS_SESSION_TOKEN: creds.sessionToken,
    AWS_BEARER_TOKEN_BEDROCK: "",
  };
}
