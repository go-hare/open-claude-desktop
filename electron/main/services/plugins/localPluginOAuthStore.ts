/**
 * Residual LocalPlugins OAuth / env / shim stores (app.asar index.js).
 *
 * Official:
 *   cowork-plugin-oauth  — credentials (VM) + clientConfig (BG); a9i / cit / git / SsA / Iit
 *   cowork-plugin-env    — env entries (zJA / sit / s9i / XJA)
 *   cowork-enabled-cli-ops — shim ops permissions (UK / Bit / lit / Eit / Cit)
 *
 * Key shape a8: `${accountId}:${orgId}:${pluginId}:${cliName}`
 *
 * data-official-source: app.asar index.js PluginOAuthStorage / EnabledCliOpsStore / PluginEnv
 * Non-goal: Anthropic account OAuth invent; remote marketplace OAuth token exchange
 * is productized only where residual storage + IPC validation apply.
 */
import { safeStorage } from "electron";
import Store from "electron-store";

const OAUTH_LOG = "[PluginOAuthStorage]";
const ENV_LOG = "[PluginEnvStore]";
const SHIM_LOG = "[EnabledCliOpsStore]";

/** Residual pL — env var name. */
export const PLUGIN_ENV_VAR_RE = /^[A-Z][A-Z0-9_]*$/;

/** Residual K9t prefixes + q9t exact reserved names (subset used by wL). */
const RESERVED_ENV_PREFIXES = ["CLAUDE_", "ANTHROPIC_", "OTEL_", "LD_"] as const;
const RESERVED_ENV_EXACT = new Set([
  "GLIBC_TUNABLES",
  "GCONV_PATH",
  "HOSTALIASES",
  "OPENSSL_CONF",
  "OPENSSL_MODULES",
  "OPENSSL_ENGINES",
  "NODE_OPTIONS",
  "NODE_PATH",
  "BASH_ENV",
  "GODEBUG",
  "PATH",
  "HOME",
  "LANG",
  "USER",
  "SHELL",
  "TZ",
  "TERM",
  "TMPDIR",
  "CLAUDE_TMPDIR",
  "PWD",
  "IFS",
  "ENV",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "SSL_CERT_FILE",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "GOOGLE_APPLICATION_CREDENTIALS",
]);

/** Residual iFA — default cli name when manifest uses top-level oauth/confirm. */
export const DEFAULT_PLUGIN_CLI_NAME = "default";

/** Residual mbA — unmatched op key suffix. */
export const PLUGIN_SHIM_UNMATCHED_OP = "__unmatched";

export type PluginOAuthClientConfig = {
  clientId?: string;
  clientSecret?: string;
};

/**
 * Residual git() bag — official camelCase (accessToken / refreshToken / tokenUrl).
 * Snake_case aliases accepted on read for older product writes.
 */
export type PluginOAuthCredentials = {
  accessToken?: string;
  refreshToken?: string;
  access_token?: string;
  refresh_token?: string;
  expiresAt?: number | string;
  grantedScopes?: string[];
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  [key: string]: unknown;
};

/** Normalize residual camelCase for status/connected checks. */
export function pluginOAuthAccessToken(
  creds: PluginOAuthCredentials | null | undefined,
): string | undefined {
  if (!creds) return undefined;
  if (typeof creds.accessToken === "string" && creds.accessToken.length > 0) {
    return creds.accessToken;
  }
  if (typeof creds.access_token === "string" && creds.access_token.length > 0) {
    return creds.access_token;
  }
  return undefined;
}

export type PluginEnvEntry = {
  accountId: string;
  orgId: string;
  pluginId: string;
  cliName: string;
  envKey: string;
  envVar: string;
  value: string;
  savedAt: number;
  savedAsSecret: boolean;
};

export type PluginEnvMutation =
  | {
      op: "set";
      envKey: string;
      envVar: string;
      value: string;
      secret?: boolean;
    }
  | { op: "delete"; envKey: string; envVar: string };

type OAuthStoreShape = {
  credentials?: string;
  clientConfig?: string;
};

type EnvStoreShape = {
  env?: string;
};

type ShimStoreShape = {
  ops?: string;
  ownerAccountId?: string;
};

const oauthStore = new Store<OAuthStoreShape>({
  name: "cowork-plugin-oauth",
  clearInvalidConfig: true,
});

const envStore = new Store<EnvStoreShape>({
  name: "cowork-plugin-env",
  clearInvalidConfig: true,
});

const shimStore = new Store<ShimStoreShape>({
  name: "cowork-enabled-cli-ops",
  clearInvalidConfig: true,
});

/** Residual a8 */
export function pluginOAuthScopeKey(
  accountId: string,
  orgId: string,
  pluginId: string,
  cliName: string,
): string {
  return `${accountId}:${orgId}:${pluginId}:${cliName}`;
}

/** Residual wL */
export function isReservedPluginEnvVar(name: string): boolean {
  if (RESERVED_ENV_EXACT.has(name)) return true;
  return RESERVED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Residual pL.test + wL */
export function isValidPluginEnvVarName(name: string): boolean {
  return PLUGIN_ENV_VAR_RE.test(name) && !isReservedPluginEnvVar(name);
}

function decryptJsonObject(encryptedB64: string, log: string): unknown {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(`${log} Encryption not available; returning empty`);
    return undefined;
  }
  try {
    const json = safeStorage.decryptString(Buffer.from(encryptedB64, "base64"));
    return JSON.parse(json) as unknown;
  } catch (error) {
    console.error(`${log} Failed to decrypt:`, error);
    return undefined;
  }
}

function encryptJsonObject(value: unknown, log: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Encryption not available on this system");
  }
  try {
    return safeStorage.encryptString(JSON.stringify(value)).toString("base64");
  } catch (error) {
    console.error(`${log} encrypt failed`, error);
    throw error;
  }
}

function readOAuthBag(field: "credentials" | "clientConfig"): Record<string, unknown> {
  const raw = oauthStore.get(field);
  if (typeof raw !== "string" || raw.length === 0) return {};
  const parsed = decryptJsonObject(raw, OAUTH_LOG);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? { ...(parsed as Record<string, unknown>) }
    : {};
}

function writeOAuthBag(
  field: "credentials" | "clientConfig",
  bag: Record<string, unknown>,
): void {
  oauthStore.set(field, encryptJsonObject(bag, OAUTH_LOG));
}

/** Residual Iit — clientConfig for scope. */
export function readPluginOAuthClient(
  accountId: string,
  orgId: string,
  pluginId: string,
  cliName: string,
): PluginOAuthClientConfig | null {
  const bag = readOAuthBag("clientConfig");
  const entry = bag[pluginOAuthScopeKey(accountId, orgId, pluginId, cliName)];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const rec = entry as Record<string, unknown>;
  const clientId =
    typeof rec.clientId === "string" && rec.clientId.length > 0
      ? rec.clientId
      : undefined;
  const clientSecret =
    typeof rec.clientSecret === "string" && rec.clientSecret.length > 0
      ? rec.clientSecret
      : undefined;
  if (!clientId && !clientSecret) return null;
  return {
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
  };
}

/** Residual a9i */
export function writePluginOAuthClient(
  accountId: string,
  orgId: string,
  pluginId: string,
  cliName: string,
  input: { clientId?: string; clientSecret?: string },
): void {
  const bag = readOAuthBag("clientConfig");
  const key = pluginOAuthScopeKey(accountId, orgId, pluginId, cliName);
  const prev =
    bag[key] && typeof bag[key] === "object" && !Array.isArray(bag[key])
      ? (bag[key] as Record<string, unknown>)
      : {};
  const pick = (next: string | undefined, fallback: unknown): string | undefined => {
    if (next !== undefined) {
      const trimmed = next.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    return typeof fallback === "string" && fallback.length > 0 ? fallback : undefined;
  };
  const clientId = pick(input.clientId, prev.clientId);
  const clientSecret = pick(input.clientSecret, prev.clientSecret);
  if (!clientId && !clientSecret) {
    if (key in bag) {
      delete bag[key];
      writeOAuthBag("clientConfig", bag);
    }
    return;
  }
  bag[key] = {
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
  };
  writeOAuthBag("clientConfig", bag);
}

/** Residual SsA */
export function readPluginOAuthCredentials(
  accountId: string,
  orgId: string,
  pluginId: string,
  cliName: string,
): PluginOAuthCredentials | null {
  const bag = readOAuthBag("credentials");
  const entry = bag[pluginOAuthScopeKey(accountId, orgId, pluginId, cliName)];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  return entry as PluginOAuthCredentials;
}

/** Residual git */
export function writePluginOAuthCredentials(
  accountId: string,
  orgId: string,
  pluginId: string,
  cliName: string,
  credentials: PluginOAuthCredentials,
): void {
  const bag = readOAuthBag("credentials");
  bag[pluginOAuthScopeKey(accountId, orgId, pluginId, cliName)] = credentials;
  writeOAuthBag("credentials", bag);
}

/** Residual cit */
export function clearPluginOAuthCredentials(
  accountId: string,
  orgId: string,
  pluginId: string,
  cliName: string,
): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  const bag = readOAuthBag("credentials");
  const key = pluginOAuthScopeKey(accountId, orgId, pluginId, cliName);
  if (!(key in bag)) return;
  delete bag[key];
  writeOAuthBag("credentials", bag);
}

function readEnvEntries(): PluginEnvEntry[] {
  const raw = envStore.get("env");
  if (typeof raw !== "string" || raw.length === 0) return [];
  const parsed = decryptJsonObject(raw, ENV_LOG);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("entries" in parsed) ||
    !Array.isArray((parsed as { entries: unknown }).entries)
  ) {
    console.warn(`${ENV_LOG} Dropping unrecognized stored payload shape`);
    return [];
  }
  return (parsed as { entries: PluginEnvEntry[] }).entries.filter(
    (e) => e && typeof e === "object",
  );
}

function writeEnvEntries(entries: PluginEnvEntry[]): void {
  envStore.set("env", encryptJsonObject({ v: 1, entries }, ENV_LOG));
}

/** Residual XJA.get */
export function getPluginEnvValue(
  accountId: string,
  orgId: string,
  pluginId: string,
  cliName: string,
  envKey: string,
  envVar: string,
): { value: string; savedAsSecret: boolean } | null {
  const hit = readEnvEntries().find(
    (e) =>
      e.accountId === accountId &&
      e.orgId === orgId &&
      e.pluginId === pluginId &&
      e.cliName === cliName &&
      e.envKey === envKey &&
      e.envVar === envVar,
  );
  return hit
    ? { value: hit.value, savedAsSecret: hit.savedAsSecret === true }
    : null;
}

/** Residual s9i */
export function applyPluginEnvMutations(
  accountId: string,
  orgId: string,
  pluginId: string,
  cliName: string,
  mutations: PluginEnvMutation[],
): void {
  if (mutations.length === 0) return;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Encryption not available on this system");
  }
  const entries = readEnvEntries();
  const now = Date.now();
  const matchIndex = (envKey: string, envVar: string) =>
    entries.findIndex(
      (e) =>
        e.accountId === accountId &&
        e.orgId === orgId &&
        e.pluginId === pluginId &&
        e.cliName === cliName &&
        e.envKey === envKey &&
        e.envVar === envVar,
    );
  for (const mut of mutations) {
    const idx = matchIndex(mut.envKey, mut.envVar);
    if (mut.op === "set") {
      const next: PluginEnvEntry = {
        accountId,
        orgId,
        pluginId,
        cliName,
        envKey: mut.envKey,
        envVar: mut.envVar,
        value: mut.value,
        savedAt: now,
        savedAsSecret: mut.secret === true,
      };
      if (idx >= 0) entries[idx] = next;
      else entries.push(next);
    } else if (idx >= 0) {
      entries.splice(idx, 1);
    }
  }
  writeEnvEntries(entries);
}

// ─── Shim ops (cowork-enabled-cli-ops) ───────────────────────────────────────

let shimOpsCache: Record<string, "allow" | "blocked"> | undefined;
let shimLoaded = false;
let shimWriteDisabled = false;
const shimDirtyKeys = new Set<string>();

function loadShimOps(): Record<string, "allow" | "blocked"> {
  if (shimLoaded && shimOpsCache) return shimOpsCache;
  shimLoaded = true;
  shimOpsCache = {};
  const raw = shimStore.get("ops");
  if (typeof raw !== "string" || raw.length === 0) return shimOpsCache;
  try {
    if (!safeStorage.isEncryptionAvailable()) return shimOpsCache;
    const parsed = JSON.parse(
      safeStorage.decryptString(Buffer.from(raw, "base64")),
    ) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (value === "allow" || value === "blocked") shimOpsCache[key] = value;
    }
  } catch (error) {
    console.error(`${SHIM_LOG} decrypt failed; disk writes disabled`, error);
    shimWriteDisabled = true;
  }
  return shimOpsCache;
}

function persistShimOps(): void {
  if (shimWriteDisabled) return;
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(`${SHIM_LOG} encryption unavailable; skipping persist`);
    return;
  }
  try {
    const bag = loadShimOps();
    shimStore.set(
      "ops",
      safeStorage.encryptString(JSON.stringify(bag)).toString("base64"),
    );
  } catch (error) {
    console.error(`${SHIM_LOG} encrypt failed; disk writes disabled`, error);
    shimWriteDisabled = true;
  }
}

/** Residual lit */
export function getPluginShimPermissionMap(): Record<
  string,
  "allow" | "blocked"
> {
  return { ...loadShimOps() };
}

/** Residual IPe */
export function collapseShimPermission(
  values: Array<"allow" | "blocked" | "ask" | undefined>,
): "allow" | "blocked" | "ask" {
  if (values.includes("blocked")) return "blocked";
  if (values.includes("ask")) return "ask";
  if (values.some((v) => v === "allow")) return "allow";
  return "ask";
}

/** Residual Bit — permission null clears keys. */
export function setPluginShimPermissions(
  keys: string[],
  permission: "allow" | "blocked" | null,
): void {
  const bag = loadShimOps();
  for (const key of keys) {
    shimDirtyKeys.add(key);
    if (permission === null) delete bag[key];
    else bag[key] = permission;
  }
  shimOpsCache = bag;
  persistShimOps();
}

/** Residual ybA */
export function pluginShimOpKey(
  marketplaceName: string,
  pluginName: string,
  cliName: string,
  op: string,
  matchHash: string,
): string {
  return `${marketplaceName}/${pluginName}:${cliName}:${op}:${matchHash}`;
}

/** Residual SbA */
export function pluginShimUnmatchedKey(
  marketplaceName: string,
  pluginName: string,
  cliName: string,
): string {
  return pluginShimOpKey(
    marketplaceName,
    pluginName,
    cliName,
    PLUGIN_SHIM_UNMATCHED_OP,
    "",
  );
}

/** Test helper — wipe stores. */
export function resetLocalPluginOAuthStoresForTests(): void {
  oauthStore.clear();
  envStore.clear();
  shimStore.clear();
  shimOpsCache = undefined;
  shimLoaded = false;
  shimWriteDisabled = false;
  shimDirtyKeys.clear();
}
