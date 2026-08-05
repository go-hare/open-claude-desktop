/**
 * Official enterprise config residual (app.asar Zzt / FV / vi / uHA):
 *
 *   function vi(){ return FV().config }
 *   function uHA(){ return vi().requireCoworkFullVmSandbox === true }
 *
 * Load order (Zzt):
 *   1. Managed MDM (darwin plists / win32 Policies registry) → source "managed"
 *   2. Else local configLibrary applied JSON → source "local"
 *   3. Else {} → source "none"
 *   Optional remote tier (uoe / w0A) overlays managed|local when present.
 *
 * Product residual:
 *   - Read darwin managed plists for requireCoworkFullVmSandbox only (XML + plutil)
 *   - Read win32 SOFTWARE\\Policies\\<appName> via `reg query` residual (official Vzt shape)
 *   - Read userData/configLibrary/_meta.json appliedId → {uuid}.json
 *   - Optional setEnterpriseRemoteTier / inject for tests
 *   - Never invent true from absence
 *   - Full QB multi-key schema residual (product policy reads require key)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY =
  "requireCoworkFullVmSandbox" as const;

export const COWORK_MANAGED_PREFERENCES_BUNDLE_ID =
  "com.anthropic.claudefordesktop";

/**
   * Official QB = Object.keys(yN.shape) residual (enterprise schema keys).
   * Product hard-consumers live in COWORK_ENTERPRISE_POLICY_KEYS + readers
   * below (d0A tools, vmEgressPolicy, Th folders, KHA OTEL, token cap, …).
   * Remaining keys stay name-only for registry/plist walk residual — never invent.
   */
export const COWORK_ENTERPRISE_QB_KEYS = [
  "isDesktopExtensionEnabled",
  "isDesktopExtensionDirectoryEnabled",
  "isDesktopExtensionSignatureRequired",
  "isLocalDevMcpEnabled",
  "isClaudeCodeForDesktopEnabled",
  "secureVmFeaturesEnabled",
  "requireCoworkFullVmSandbox",
  "coworkEgressAllowedHosts",
  "otlpEndpoint",
  "otlpProtocol",
  "otlpHeaders",
  "otlpResourceAttributes",
  "autoUpdaterEnforcementHours",
  "disableAutoUpdates",
  "disableDeploymentModeChooser",
  "forceLoginOrgUUID",
  "inferenceProvider",
  "inferenceGatewayBaseUrl",
  "inferenceGatewayApiKey",
  "inferenceGatewayAuthScheme",
  "inferenceGatewayHeaders",
  "inferenceVertexProjectId",
  "inferenceVertexRegion",
  "inferenceVertexCredentialsFile",
  "inferenceVertexOAuthClientId",
  "inferenceVertexOAuthClientSecret",
  "inferenceVertexOAuthScopes",
  "inferenceVertexBaseUrl",
  "inferenceBedrockRegion",
  "inferenceBedrockBearerToken",
  "inferenceBedrockBaseUrl",
  "inferenceBedrockProfile",
  "inferenceBedrockAwsDir",
  "inferenceBedrockSsoStartUrl",
  "inferenceBedrockSsoRegion",
  "inferenceBedrockSsoAccountId",
  "inferenceBedrockSsoRoleName",
  "inferenceBedrockServiceTier",
  "inferenceFoundryResource",
  "inferenceFoundryApiKey",
  "inferenceModels",
  "deploymentOrganizationUuid",
  "disableEssentialTelemetry",
  "disableNonessentialTelemetry",
  "disableNonessentialServices",
  "managedMcpServers",
  "disabledBuiltinTools",
  "allowedWorkspaceFolders",
  "inferenceCredentialHelper",
  "inferenceCredentialHelperTtlSec",
  "bootstrapEnabled",
  "bootstrapUrl",
  "bootstrapOidc",
  "inferenceMaxTokensPerWindow",
  "inferenceTokenWindowHours",
] as const;

/**
 * Official enterprise keys product currently hard-consumes (not name-only).
 * Keep in sync with readers below + spawn/host-loop injects.
 */
export const COWORK_ENTERPRISE_POLICY_KEYS = [
  COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY,
  "disabledBuiltinTools",
  "coworkEgressAllowedHosts",
  "allowedWorkspaceFolders",
  "otlpEndpoint",
  "otlpProtocol",
  "otlpHeaders",
  "otlpResourceAttributes",
  "inferenceMaxTokensPerWindow",
  "inferenceTokenWindowHours",
  "disableAutoUpdates",
  "autoUpdaterEnforcementHours",
  "forceLoginOrgUUID",
  "deploymentOrganizationUuid",
  "disableNonessentialServices",
  "inferenceVertexOAuthClientId",
  "inferenceVertexOAuthClientSecret",
  "inferenceVertexOAuthScopes",
  "inferenceBedrockSsoStartUrl",
  "inferenceBedrockSsoRegion",
  "inferenceBedrockSsoAccountId",
  "inferenceBedrockSsoRoleName",
  "bootstrapOidc",
] as const;

const APPLIED_ID_RE = /^[a-f0-9-]{36}$/i;

export type CoworkEnterpriseConfigSourceType = "managed" | "local" | "none";

export type CoworkEnterpriseConfigSource = {
  remote: boolean;
  type: CoworkEnterpriseConfigSourceType;
};

export type CoworkEnterpriseConfigSnapshot = {
  config: Record<string, unknown>;
  raw: Record<string, unknown>;
  source: CoworkEnterpriseConfigSource;
};

export type CoworkEnterpriseConfigDeps = {
  /**
   * Optional managed bag (tests / future native registry bridge).
   * When omitted, product reads darwin Managed Preferences plists.
   */
  getManagedConfig?: () => Record<string, unknown> | undefined;
  /**
   * Optional local bag. When omitted, product reads configLibrary applied JSON.
   */
  getLocalConfig?: () => Record<string, unknown> | undefined;
  /** Official remote tier overlay (uoe). */
  getRemoteTier?: () => Record<string, unknown> | undefined;
  /** userData root for configLibrary residual. */
  getUserDataPath?: () => string;
  platform?: NodeJS.Platform;
  username?: string;
  /** Injectable file exists. */
  existsSync?: (filePath: string) => boolean;
  /** Injectable text read. */
  readFileSync?: (filePath: string, encoding: "utf8") => string;
  /** Injectable plutil JSON convert (darwin residual). */
  convertPlistToJson?: (plistPath: string) => string | null;
  /**
   * Official win32 Vzt residual — read registry values.
   * Default uses `reg query` for Policies\\<appName>\\<QB key>.
   */
  readWindowsPolicyValue?: (input: {
    appName: string;
    hive: "HKCU" | "HKLM";
    valueName: string;
  }) => string | number | boolean | null;
  /**
   * Official Vzt batch residual (Jn().readRegistryValues shape).
   * When provided, used for full QB walks instead of per-key reg query.
   */
  readWindowsPolicyValues?: (input: {
    appName: string;
    valueNames: readonly string[];
  }) => Record<string, string | number | boolean | null>;
  /** app.getName() residual for win32 Policies key. */
  getAppName?: () => string;
  log?: (message: string, ...args: unknown[]) => void;
};

let remoteTier: Record<string, unknown> | undefined;
let cached: CoworkEnterpriseConfigSnapshot | undefined;
/** Product bootstrap inject — app.getPath("userData") for configLibrary residual. */
let defaultUserDataPath: string | undefined;

/** Official uoe — set remote enterprise tier and invalidate cache. */
export function setCoworkEnterpriseRemoteTier(
  next: Record<string, unknown> | null | undefined,
): void {
  remoteTier = next ?? undefined;
  cached = undefined;
}

/**
 * Wire userData root once at desktop bootstrap so vi()/Ti() readers resolve
 * configLibrary without every call site passing getUserDataPath.
 */
export function setCoworkEnterpriseUserDataPath(
  userDataPath: string | null | undefined,
): void {
  defaultUserDataPath =
    typeof userDataPath === "string" && userDataPath.length > 0
      ? userDataPath
      : undefined;
  cached = undefined;
}

export function resetCoworkEnterpriseConfigForTests(): void {
  remoteTier = undefined;
  cached = undefined;
  defaultUserDataPath = undefined;
}

function resolveEnterpriseUserDataPath(
  deps: CoworkEnterpriseConfigDeps,
): string | undefined {
  const fromDeps = deps.getUserDataPath?.();
  if (fromDeps) return fromDeps;
  if (defaultUserDataPath) return defaultUserDataPath;
  try {
    // Lazy Electron app path — avoids forcing deps at every residual gate call.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronApp = require("electron").app as {
      getPath?: (name: string) => string;
    };
    return electronApp.getPath?.("userData");
  } catch {
    return process.env.CLAUDE_USER_DATA_DIR || undefined;
  }
}

/** Official boolean residual (ZLA / Czt subset). Never invent true. */
export function parseCoworkEnterpriseBoolean(
  value: unknown,
): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return undefined;
}

export function resolveCoworkManagedPreferencesPlistPaths(input: {
  username?: string;
}): string[] {
  // macOS MDM residual only — always POSIX separators even when host is win32.
  const username = input.username ?? os.userInfo().username;
  const bundle = `${COWORK_MANAGED_PREFERENCES_BUNDLE_ID}.plist`;
  return [
    path.posix.join("/Library/Managed Preferences", bundle),
    path.posix.join("/Library/Managed Preferences", username, bundle),
  ];
}

/** Official Vzt key path residual: SOFTWARE\\Policies\\${appName} */
export function resolveCoworkWindowsPoliciesKeyPath(appName: string): string {
  const safe = appName.trim() || "Claude";
  return `SOFTWARE\\Policies\\${safe}`;
}

/**
 * Parse `reg query` stdout for a REG_DWORD / REG_SZ value.
 * Never invent true from missing/unreadable output.
 */
export function parseRegQueryValue(stdout: string): string | number | null {
  // e.g. "    requireCoworkFullVmSandbox    REG_DWORD    0x1"
  const match = /REG_(?:DWORD|SZ|QWORD)\s+(\S+)/i.exec(stdout);
  if (!match) return null;
  const raw = match[1]!;
  if (/^0x[0-9a-f]+$/i.test(raw)) {
    return Number.parseInt(raw, 16);
  }
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return raw;
}

function defaultReadWindowsPolicyValue(input: {
  appName: string;
  hive: "HKCU" | "HKLM";
  valueName: string;
}): string | number | boolean | null {
  if (process.platform !== "win32") return null;
  const keyPath = `${input.hive}\\${resolveCoworkWindowsPoliciesKeyPath(input.appName)}`;
  try {
    const stdout = execFileSync(
      "reg",
      ["query", keyPath, "/v", input.valueName],
      { encoding: "utf8", timeout: 5_000, windowsHide: true },
    );
    return parseRegQueryValue(stdout);
  } catch {
    return null;
  }
}

/**
 * Parse full `reg query HK??\\SOFTWARE\\Policies\\App` listing into a name→value map.
 * Official Vzt still only materializes known QB keys; never invents missing names.
 */
export function parseRegQueryKeyListing(
  stdout: string,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  // e.g. "    requireCoworkFullVmSandbox    REG_DWORD    0x1"
  const lineRe =
    /^\s+(\S+)\s+REG_(?:DWORD|SZ|QWORD|EXPAND_SZ|MULTI_SZ)\s+(\S.*)$/gim;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(stdout)) !== null) {
    const name = match[1]!;
    const raw = match[2]!.trim();
    if (/^0x[0-9a-f]+$/i.test(raw)) {
      out[name] = Number.parseInt(raw, 16);
    } else if (/^\d+$/.test(raw)) {
      out[name] = Number.parseInt(raw, 10);
    } else {
      out[name] = raw;
    }
  }
  return out;
}

/**
 * Official Vzt batch residual — one `reg query` per hive (not N×keys).
 * Missing Policies key → empty (never invents). Critical for spawn-time vi()
 * so host does not block on ~2×|QB| failed per-value queries.
 */
function defaultReadWindowsManagedBagViaRegQuery(
  appName: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (process.platform !== "win32") return {};
  const out: Record<string, unknown> = {};
  const keySet = new Set(keys);
  for (const hive of ["HKCU", "HKLM"] as const) {
    const keyPath = `${hive}\\${resolveCoworkWindowsPoliciesKeyPath(appName)}`;
    let stdout: string;
    try {
      stdout = execFileSync("reg", ["query", keyPath], {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      });
    } catch {
      // Key absent — continue other hive; do not fall back to per-value spam.
      continue;
    }
    const listed = parseRegQueryKeyListing(stdout);
    for (const [name, value] of Object.entries(listed)) {
      if (!keySet.has(name)) continue;
      // HKCU first then HKLM; first non-null wins (official residual order).
      if (out[name] === undefined) out[name] = value;
    }
  }
  return out;
}

/**
 * Official Vzt residual — walk SOFTWARE\\Policies\\<app> for QB keys.
 * HKCU then HKLM; first non-null raw value per key wins (never invents).
 */
export function readWindowsManagedEnterpriseBag(
  deps: CoworkEnterpriseConfigDeps = {},
  keys: readonly string[] = COWORK_ENTERPRISE_QB_KEYS,
): Record<string, unknown> {
  if (deps.getManagedConfig) {
    const managed = deps.getManagedConfig() ?? {};
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (managed[key] !== undefined) out[key] = managed[key];
    }
    return out;
  }
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") return {};
  if (deps.readWindowsPolicyValues) {
    const raw = deps.readWindowsPolicyValues({
      appName: deps.getAppName?.() ?? "Claude",
      valueNames: keys,
    });
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const value = raw[key];
      if (value !== null && value !== undefined) out[key] = value;
    }
    return out;
  }
  // Per-value inject still supported for tests that stub one key at a time.
  if (deps.readWindowsPolicyValue) {
    const readValue = deps.readWindowsPolicyValue;
    const appName = deps.getAppName?.() ?? "Claude";
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      for (const hive of ["HKCU", "HKLM"] as const) {
        const raw = readValue({ appName, hive, valueName: key });
        if (raw !== null && raw !== undefined) {
          out[key] = raw;
          break;
        }
      }
    }
    return out;
  }
  // Default: batch list Policies key once per hive (spawn-safe).
  return defaultReadWindowsManagedBagViaRegQuery(
    deps.getAppName?.() ?? "Claude",
    keys,
  );
}

export function readWindowsRequireCoworkFullVmSandbox(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean | undefined {
  const bag = readWindowsManagedEnterpriseBag(deps, [
    COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY,
  ]);
  return parseCoworkEnterpriseBoolean(
    bag[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY],
  );
}

/**
 * Official qzt residual — walk managed plists for full QB bag.
 * Only includes keys that are present; never invents values.
 */
export function readDarwinManagedEnterpriseBag(
  deps: CoworkEnterpriseConfigDeps = {},
  keys: readonly string[] = COWORK_ENTERPRISE_QB_KEYS,
): Record<string, unknown> {
  if (deps.getManagedConfig) {
    const managed = deps.getManagedConfig() ?? {};
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (managed[key] !== undefined) out[key] = managed[key];
    }
    return out;
  }
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") return {};
  const existsSync = deps.existsSync ?? fs.existsSync;
  const readFileSync = deps.readFileSync ?? ((p, enc) => fs.readFileSync(p, enc));
  const convert = deps.convertPlistToJson ?? defaultConvertPlistToJson;
  const out: Record<string, unknown> = {};
  for (const plistPath of resolveCoworkManagedPreferencesPlistPaths({
    username: deps.username,
  })) {
    if (!existsSync(plistPath)) continue;
    let bag: Record<string, unknown> | null = null;
    const fromPlutil = convert(plistPath);
    if (fromPlutil) {
      try {
        bag = JSON.parse(fromPlutil) as Record<string, unknown>;
      } catch {
        bag = null;
      }
    }
    if (!bag) {
      try {
        const xml = readFileSync(plistPath, "utf8");
        // XML residual only materializes boolean keys we can parse.
        const partial: Record<string, unknown> = {};
        for (const key of keys) {
          const flag = readXmlPlistBooleanKey(xml, key);
          if (flag !== undefined) partial[key] = flag;
        }
        bag = partial;
      } catch {
        continue;
      }
    }
    for (const key of keys) {
      if (out[key] === undefined && bag[key] !== undefined) {
        out[key] = bag[key];
      }
    }
  }
  return out;
}

/**
 * Official jzt residual — platform managed bag (darwin plists / win32 Policies).
 */
export function readManagedEnterpriseBag(
  deps: CoworkEnterpriseConfigDeps = {},
  keys: readonly string[] = COWORK_ENTERPRISE_QB_KEYS,
): Record<string, unknown> {
  if (deps.getManagedConfig) {
    const managed = deps.getManagedConfig() ?? {};
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (managed[key] !== undefined) out[key] = managed[key];
    }
    return out;
  }
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") return readWindowsManagedEnterpriseBag(deps, keys);
  if (platform === "darwin") return readDarwinManagedEnterpriseBag(deps, keys);
  return {};
}

/**
 * Official $zt / Wzt residual — configLibrary applied JSON full bag.
 */
export function readConfigLibraryEnterpriseBag(
  deps: CoworkEnterpriseConfigDeps = {},
  keys: readonly string[] = COWORK_ENTERPRISE_QB_KEYS,
): Record<string, unknown> {
  if (deps.getLocalConfig) {
    const local = deps.getLocalConfig() ?? {};
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (local[key] !== undefined) out[key] = local[key];
    }
    return out;
  }
  const userDataPath = resolveEnterpriseUserDataPath(deps);
  if (!userDataPath) return {};
  const existsSync = deps.existsSync ?? fs.existsSync;
  const readFileSync = deps.readFileSync ?? ((p, enc) => fs.readFileSync(p, enc));
  const metaPath = resolveCoworkConfigLibraryMetaPath(userDataPath);
  if (!existsSync(metaPath)) return {};
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
      appliedId?: unknown;
    };
    const appliedId =
      typeof meta.appliedId === "string" ? meta.appliedId : undefined;
    if (!appliedId || !APPLIED_ID_RE.test(appliedId)) return {};
    const entryPath = resolveCoworkConfigLibraryEntryPath(
      userDataPath,
      appliedId,
    );
    if (!existsSync(entryPath)) return {};
    const entry = JSON.parse(readFileSync(entryPath, "utf8")) as Record<
      string,
      unknown
    >;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (entry[key] !== undefined) out[key] = entry[key];
    }
    return out;
  } catch {
    return {};
  }
}

export function resolveCoworkConfigLibraryMetaPath(userDataPath: string): string {
  return path.join(userDataPath, "configLibrary", "_meta.json");
}

export function resolveCoworkConfigLibraryEntryPath(
  userDataPath: string,
  appliedId: string,
): string {
  return path.join(userDataPath, "configLibrary", `${appliedId}.json`);
}

function defaultConvertPlistToJson(plistPath: string): string | null {
  try {
    return execFileSync(
      "plutil",
      ["-convert", "json", "-o", "-", plistPath],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 2 * 1024 * 1024 },
    );
  } catch {
    return null;
  }
}

/**
 * Best-effort XML plist key extract when plutil is unavailable.
 * Only matches simple <key>…</key><true/>| <false/>| <string>… patterns.
 */
export function readXmlPlistBooleanKey(
  xml: string,
  key: string,
): boolean | undefined {
  const re = new RegExp(
    `<key>\\s*${escapeRegExp(key)}\\s*</key>\\s*(<true\\s*/?>|<false\\s*/?>|<string>([^<]*)</string>|<integer>(\\d+)</integer>)`,
    "i",
  );
  const match = re.exec(xml);
  if (!match) return undefined;
  const token = match[1]!.toLowerCase();
  if (token.startsWith("<true")) return true;
  if (token.startsWith("<false")) return false;
  if (match[2] !== undefined) return parseCoworkEnterpriseBoolean(match[2]);
  if (match[3] !== undefined) return parseCoworkEnterpriseBoolean(Number(match[3]));
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function readManagedRequireCoworkFullVmSandbox(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean | undefined {
  const bag = readManagedEnterpriseBag(deps, [
    COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY,
  ]);
  return parseCoworkEnterpriseBoolean(
    bag[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY],
  );
}

export function readConfigLibraryRequireCoworkFullVmSandbox(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean | undefined {
  const bag = readConfigLibraryEnterpriseBag(deps, [
    COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY,
  ]);
  return parseCoworkEnterpriseBoolean(
    bag[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY],
  );
}

/**
 * Official Zzt / vi() residual:
 *   managed bag (qzt/Vzt) wins over local configLibrary; remote tier overlays
 *   when base is not none. Product hard-consumers use raw (d0A / vmEgress /
 *   Th / KHA / token cap / auto-update) in addition to uHA require key.
 * Never invent true from absence.
 */
export function loadCoworkEnterpriseConfig(
  deps: CoworkEnterpriseConfigDeps = {},
): CoworkEnterpriseConfigSnapshot {
  if (
    cached
    && !deps.getManagedConfig
    && !deps.getLocalConfig
    && !deps.getRemoteTier
    && !deps.getUserDataPath
    && !deps.readWindowsPolicyValue
    && !deps.readWindowsPolicyValues
    && !deps.convertPlistToJson
  ) {
    return cached;
  }
  // Ensure configLibrary path resolution has a userData root when caller omits deps.
  const resolvedUserData = resolveEnterpriseUserDataPath(deps);
  const depsWithUserData: CoworkEnterpriseConfigDeps =
    deps.getUserDataPath || !resolvedUserData
      ? deps
      : {
          ...deps,
          getUserDataPath: () => resolvedUserData,
        };
  const managedBag = readManagedEnterpriseBag(depsWithUserData);
  const hasManaged = Object.keys(managedBag).length > 0;
  const localBag = hasManaged
    ? {}
    : readConfigLibraryEnterpriseBag(depsWithUserData);
  const hasLocal = Object.keys(localBag).length > 0;
  const type: CoworkEnterpriseConfigSourceType = hasManaged
    ? "managed"
    : hasLocal
      ? "local"
      : "none";
  const remote = deps.getRemoteTier?.() ?? remoteTier;
  const hasRemote = remote !== undefined && type !== "none";
  const base: Record<string, unknown> = hasManaged
    ? { ...managedBag }
    : hasLocal
      ? { ...localBag }
      : {};
  const merged: Record<string, unknown> = {
    ...base,
    ...(hasRemote ? remote : {}),
  };
  // Product config surface: only materialize explicit require boolean (uHA).
  // Other QB keys stay on raw for residual readers; do not invent them on config.
  const requireFlag = parseCoworkEnterpriseBoolean(
    merged[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY],
  );
  const config: Record<string, unknown> = {};
  if (requireFlag === true) {
    config[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY] = true;
  } else if (requireFlag === false) {
    config[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY] = false;
  }
  const snapshot: CoworkEnterpriseConfigSnapshot = {
    config,
    raw: merged,
    source: { type, remote: hasRemote },
  };
  if (
    !deps.getManagedConfig
    && !deps.getLocalConfig
    && !deps.getRemoteTier
    && !deps.readWindowsPolicyValue
    && !deps.readWindowsPolicyValues
    && !deps.convertPlistToJson
  ) {
    cached = snapshot;
  }
  return snapshot;
}

/** Official vi().requireCoworkFullVmSandbox === true */
export function isCoworkEnterpriseRequireFullVmSandbox(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean {
  return (
    loadCoworkEnterpriseConfig(deps).config[
      COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY
    ] === true
  );
}

/**
 * Read an enterprise boolean from residual bag (raw QB keys).
 * Returns undefined when key absent / unparseable — never invents true/false.
 */
export function getCoworkEnterpriseBoolean(
  key: (typeof COWORK_ENTERPRISE_QB_KEYS)[number] | string,
  deps: CoworkEnterpriseConfigDeps = {},
): boolean | undefined {
  const snap = loadCoworkEnterpriseConfig(deps);
  // Prefer materialised config for require key; otherwise raw residual bag.
  const fromConfig = snap.config[key];
  if (fromConfig !== undefined) {
    return parseCoworkEnterpriseBoolean(fromConfig);
  }
  return parseCoworkEnterpriseBoolean(snap.raw[key]);
}

/**
 * Official yvi residual input:
 *   vi().isClaudeCodeForDesktopEnabled === false → unsupported
 * Absent key is not false (never invent disable).
 */
export function isClaudeCodeForDesktopEnterpriseDisabled(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean {
  return getCoworkEnterpriseBoolean("isClaudeCodeForDesktopEnabled", deps) === false;
}

/**
 * Official pHA residual input:
 *   vi().secureVmFeaturesEnabled === false → enterprise disable
 * Absent key is not false.
 */
export function isSecureVmFeaturesEnterpriseDisabled(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean {
  return getCoworkEnterpriseBoolean("secureVmFeaturesEnabled", deps) === false;
}

function enterpriseRaw(
  key: string,
  deps: CoworkEnterpriseConfigDeps = {},
): unknown {
  const snap = loadCoworkEnterpriseConfig(deps);
  if (snap.config[key] !== undefined) return snap.config[key];
  return snap.raw[key];
}

function stringListFromEnterprise(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return out;
}

function positiveIntFromEnterprise(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/**
 * Official d0A residual:
 *   function d0A(e){
 *     const A=new Set(e.disabledBuiltinTools??[]);
 *     e.inferenceProvider==="bedrock"&&A.add("WebSearch");
 *     for(const[t,i]of Object.entries(CZt))A.has(t)&&A.add(i);
 *     return[...A]
 *   }
 * CZt maps Bash/WebFetch → workspace MCP tools so host-loop cannot bypass.
 */
export const ENTERPRISE_BUILTIN_TO_WORKSPACE_MCP: Readonly<
  Record<string, string>
> = {
  Bash: "mcp__workspace__bash",
  WebFetch: "mcp__workspace__web_fetch",
};

export function resolveEnterpriseDisallowedTools(
  deps: CoworkEnterpriseConfigDeps = {},
): string[] {
  const raw = enterpriseRaw("disabledBuiltinTools", deps);
  const listed = stringListFromEnterprise(raw) ?? [];
  const set = new Set(listed);
  const provider = enterpriseRaw("inferenceProvider", deps);
  if (provider === "bedrock") set.add("WebSearch");
  for (const [builtin, workspace] of Object.entries(
    ENTERPRISE_BUILTIN_TO_WORKSPACE_MCP,
  )) {
    if (set.has(builtin)) set.add(workspace);
  }
  return [...set];
}

/**
 * Official Ii().vmEgressPolicy() residual (3p):
 *   const A=Ti().coworkEgressAllowedHosts??[];
 *   return A.includes("*")
 *     ? {kind:"unrestricted"}
 *     : {kind:"allowlist",domains:[...provider.vmAllowedDomains(),...A]}
 * Product: bag hosts only (no cloud provider domain inject until dual-exec).
 * Absent / empty → null (fall back to session egress).
 */
export type CoworkEnterpriseVmEgressPolicy =
  | { kind: "unrestricted" }
  | { kind: "allowlist"; domains: string[] };

export function resolveEnterpriseVmEgressPolicy(
  deps: CoworkEnterpriseConfigDeps = {},
): CoworkEnterpriseVmEgressPolicy | null {
  const hosts = stringListFromEnterprise(
    enterpriseRaw("coworkEgressAllowedHosts", deps),
  );
  if (!hosts || hosts.length === 0) return null;
  if (hosts.includes("*")) return { kind: "unrestricted" };
  return { kind: "allowlist", domains: hosts };
}

/**
 * Official Th() residual:
 *   function Th(){const e=Ti().allowedWorkspaceFolders;if(e)return e.map(gC)}
 * undefined → unrestricted; present array (incl empty) → enforce.
 */
export function resolveEnterpriseAllowedWorkspaceFolders(
  deps: CoworkEnterpriseConfigDeps = {},
): string[] | null | undefined {
  const raw = enterpriseRaw("allowedWorkspaceFolders", deps);
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  // Official: present key including [] is restrictive (empty drops all drafts).
  return (stringListFromEnterprise(raw) ?? []).map((entry) => entry);
}

/**
 * Official otlp bag → KHA input residual.
 *   if(e.otlpEndpoint) return {endpoint, protocol, headers, resourceAttributes}
 */
export type CoworkEnterpriseOtlpConfig = {
  endpoint: string;
  protocol?: string;
  headers?: string;
  resourceAttributes?: string;
};

export function resolveEnterpriseOtlpConfig(
  deps: CoworkEnterpriseConfigDeps = {},
): CoworkEnterpriseOtlpConfig | null {
  const endpoint = enterpriseRaw("otlpEndpoint", deps);
  if (typeof endpoint !== "string" || endpoint.trim().length === 0) return null;
  const protocol = enterpriseRaw("otlpProtocol", deps);
  const headersRaw = enterpriseRaw("otlpHeaders", deps);
  let headers: string | undefined;
  if (typeof headersRaw === "string" && headersRaw.trim()) {
    headers = headersRaw.trim();
  } else if (
    headersRaw &&
    typeof headersRaw === "object" &&
    !Array.isArray(headersRaw)
  ) {
    // Official SPe-style "k: v" joined by "|" (same as gateway headers).
    headers = Object.entries(headersRaw as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([k, v]) => `${k}: ${v}`)
      .join("|");
    if (!headers) headers = undefined;
  }
  const resourceAttributes = enterpriseRaw("otlpResourceAttributes", deps);
  return {
    endpoint: endpoint.trim(),
    protocol:
      typeof protocol === "string" && protocol.trim()
        ? protocol.trim()
        : undefined,
    headers,
    resourceAttributes:
      typeof resourceAttributes === "string" && resourceAttributes.trim()
        ? resourceAttributes.trim()
        : undefined,
  };
}

/**
 * Official KHA residual (host target) — OTEL env for CLI spawn.
 * Filters resource attributes like official BFi (drop reserved keys subset).
 */
const OTEL_RESERVED_RESOURCE_KEYS = new Set([
  "service.name",
  "service.version",
  "telemetry.sdk.language",
  "telemetry.sdk.name",
  "telemetry.sdk.version",
]);

export function buildEnterpriseOtlpSpawnEnv(
  otlp: CoworkEnterpriseOtlpConfig | null | undefined,
  deps: CoworkEnterpriseConfigDeps = {},
): Record<string, string> {
  if (!otlp?.endpoint) return {};
  let resource = otlp.resourceAttributes ?? "";
  if (resource) {
    resource = resource
      .split(",")
      .filter((part) => {
        const eq = part.indexOf("=");
        if (eq <= 0) return false;
        const key = part.slice(0, eq).trim();
        return key.length > 0 && !OTEL_RESERVED_RESOURCE_KEYS.has(key);
      })
      .join(",");
  }
  // Official deploymentOrganizationUuid tags telemetry (orgUuidOverride residual).
  const orgUuid = resolveEnterpriseDeploymentOrganizationUuid(deps);
  if (orgUuid) {
    const tag = `deployment.organization.id=${orgUuid}`;
    resource = resource ? `${resource},${tag}` : tag;
  }
  const env: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_LOG_USER_PROMPTS: "1",
    OTEL_LOG_TOOL_DETAILS: "1",
    OTEL_EXPORTER_OTLP_ENDPOINT: otlp.endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: otlp.protocol ?? "http/protobuf",
  };
  if (otlp.headers) env.OTEL_EXPORTER_OTLP_HEADERS = otlp.headers;
  if (resource) env.OTEL_RESOURCE_ATTRIBUTES = resource;
  return env;
}

/** Official Ti().inferenceMaxTokensPerWindow / inferenceTokenWindowHours. */
export function resolveEnterpriseTokenCap(
  deps: CoworkEnterpriseConfigDeps = {},
): { maxTokens: number; windowHours: number } | null {
  const maxTokens = positiveIntFromEnterprise(
    enterpriseRaw("inferenceMaxTokensPerWindow", deps),
  );
  const windowHours = positiveIntFromEnterprise(
    enterpriseRaw("inferenceTokenWindowHours", deps),
  );
  if (maxTokens === undefined || windowHours === undefined) return null;
  return { maxTokens, windowHours };
}

/**
 * Official disableAutoUpdates residual — desktop auto-updater policy.
 * Absent key → undefined (do not invent block).
 */
export function isEnterpriseAutoUpdatesDisabled(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean | undefined {
  return getCoworkEnterpriseBoolean("disableAutoUpdates", deps);
}

/**
 * Official autoUpdaterEnforcementHours residual (1..72, default 72 when disabled updates).
 */
export function resolveEnterpriseAutoUpdaterEnforcementHours(
  deps: CoworkEnterpriseConfigDeps = {},
): number | undefined {
  const n = positiveIntFromEnterprise(
    enterpriseRaw("autoUpdaterEnforcementHours", deps),
  );
  if (n === undefined) return undefined;
  return Math.min(72, Math.max(1, n));
}

/**
 * Official AutoUpdater residual (jsr + enforcement window):
 *   let hours = bag.autoUpdaterEnforcementHours || 72
 *   explicitHours = !!bag.autoUpdaterEnforcementHours
 * Product third-party shell has no Anthropic feed — still honor enterprise hours policy.
 */
export function resolveEnterpriseAutoUpdaterPolicy(
  deps: CoworkEnterpriseConfigDeps = {},
): {
  disabled: boolean;
  enforcementHours: number;
  hoursExplicit: boolean;
} {
  const disabled = isEnterpriseAutoUpdatesDisabled(deps) === true;
  const explicit = resolveEnterpriseAutoUpdaterEnforcementHours(deps);
  return {
    disabled,
    enforcementHours: explicit ?? 72,
    hoursExplicit: explicit !== undefined,
  };
}

/**
 * Official eHe residual — forceLoginOrgUUID string | JSON string array → lowercased UUIDs.
 * Malformed JSON array → null (ignore policy). Empty → null.
 */
export function parseForceLoginOrgUUIDs(
  raw: unknown,
  onError?: (message: string) => void,
): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
      const list = raw
        .map((x) => x.trim().toLowerCase())
        .filter((x) => x.length > 0);
      return list.length > 0 ? list : null;
    }
    return null;
  }
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((r) => typeof r === "string")
      ) {
        return parsed.map((r) => String(r).trim().toLowerCase());
      }
      if (Array.isArray(parsed) && parsed.length === 0) return null;
    } catch {
      onError?.(
        `Enterprise config forceLoginOrgUUID has malformed JSON, ignoring policy: ${raw}`,
      );
      return null;
    }
    onError?.(
      `Enterprise config forceLoginOrgUUID is not a valid JSON string array, ignoring policy: ${raw}`,
    );
    return null;
  }
  return [t.toLowerCase()];
}

/** Official IHe().forceLoginOrgUUIDs residual. */
export function resolveEnterpriseForceLoginOrgUUIDs(
  deps: CoworkEnterpriseConfigDeps = {},
): string[] | null {
  return parseForceLoginOrgUUIDs(enterpriseRaw("forceLoginOrgUUID", deps));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Official RrA residual — deploymentOrganizationUuid must be UUID or fall back undefined.
 * Tags telemetry / orgUuidOverride; not used for auth.
 */
export function resolveEnterpriseDeploymentOrganizationUuid(
  deps: CoworkEnterpriseConfigDeps = {},
): string | undefined {
  const raw = enterpriseRaw("deploymentOrganizationUuid", deps);
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  if (!UUID_RE.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Official disableNonessentialServices residual (Ob mdmKey):
 * gates mcp-registry / connector favicons / artifact-sandbox renderer endpoints.
 * Absent → false (do not invent block).
 */
export function isEnterpriseNonessentialServicesDisabled(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean {
  return getCoworkEnterpriseBoolean("disableNonessentialServices", deps) === true;
}

/** Official iai residual — default Vertex OAuth scopes. */
export const ENTERPRISE_VERTEX_OAUTH_DEFAULT_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/cloud-platform",
] as const;

export type CoworkEnterpriseVertexOAuth = {
  clientId: string;
  clientSecret: string;
  scopes: string[];
};

/**
 * Official h1e residual:
 * both clientId + clientSecret required; scopes split on whitespace or default iai.
 * Partial config → null (ignore).
 */
export function resolveEnterpriseVertexOAuth(
  deps: CoworkEnterpriseConfigDeps = {},
): CoworkEnterpriseVertexOAuth | null {
  const clientId = enterpriseRaw("inferenceVertexOAuthClientId", deps);
  const clientSecret = enterpriseRaw("inferenceVertexOAuthClientSecret", deps);
  const id =
    typeof clientId === "string" && clientId.trim() ? clientId.trim() : "";
  const secret =
    typeof clientSecret === "string" && clientSecret.trim()
      ? clientSecret.trim()
      : "";
  if (!id || !secret) return null;
  const scopesRaw = enterpriseRaw("inferenceVertexOAuthScopes", deps);
  const scopes =
    typeof scopesRaw === "string" && scopesRaw.trim()
      ? scopesRaw.split(/\s+/).filter(Boolean)
      : [...ENTERPRISE_VERTEX_OAUTH_DEFAULT_SCOPES];
  return { clientId: id, clientSecret: secret, scopes };
}

/**
 * Official f1e residual — needs Vertex interactive OAuth when provider=vertex,
 * h1e present, and no credentials file path.
 */
export function needsEnterpriseVertexAuth(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean {
  if (enterpriseRaw("inferenceProvider", deps) !== "vertex") return false;
  if (!resolveEnterpriseVertexOAuth(deps)) return false;
  const creds = enterpriseRaw("inferenceVertexCredentialsFile", deps);
  if (typeof creds === "string" && creds.trim()) return false;
  return true;
}

/** Official AWS region residual (qxe-like). */
const AWS_REGION_RE = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;

export type CoworkEnterpriseBedrockSso = {
  startUrl: string;
  ssoRegion: string;
  accountId: string;
  roleName: string;
};

/**
 * Official GV residual — all four SSO fields required together; region must match.
 * Partial → null.
 */
export function resolveEnterpriseBedrockSso(
  deps: CoworkEnterpriseConfigDeps = {},
): CoworkEnterpriseBedrockSso | null {
  const startUrl = enterpriseRaw("inferenceBedrockSsoStartUrl", deps);
  const ssoRegion = enterpriseRaw("inferenceBedrockSsoRegion", deps);
  const accountId = enterpriseRaw("inferenceBedrockSsoAccountId", deps);
  const roleName = enterpriseRaw("inferenceBedrockSsoRoleName", deps);
  const A = typeof startUrl === "string" ? startUrl.trim() : "";
  const t = typeof ssoRegion === "string" ? ssoRegion.trim() : "";
  const i = typeof accountId === "string" ? accountId.trim() : "";
  const r = typeof roleName === "string" ? roleName.trim() : "";
  if (!(A && t && i && r)) return null;
  if (!AWS_REGION_RE.test(t)) return null;
  return { startUrl: A, ssoRegion: t, accountId: i, roleName: r };
}

/**
 * Official CHe residual — needs Bedrock SSO interactive when provider=bedrock,
 * GV present, no bearer, no profile.
 */
export function needsEnterpriseBedrockSsoAuth(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean {
  if (enterpriseRaw("inferenceProvider", deps) !== "bedrock") return false;
  if (!resolveEnterpriseBedrockSso(deps)) return false;
  const bearer = enterpriseRaw("inferenceBedrockBearerToken", deps);
  if (typeof bearer === "string" && bearer.trim()) return false;
  const profile = enterpriseRaw("inferenceBedrockProfile", deps);
  if (typeof profile === "string" && profile.trim()) return false;
  return true;
}

export type CoworkEnterpriseBootstrapOidc = {
  clientId: string;
  issuer?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  [key: string]: unknown;
};

/**
 * Official bootstrapOidc residual — object (or JSON string) with clientId.
 * Full interactive PKCE is NeedsBootstrapAuthError in official; product parses bag only.
 */
export function resolveEnterpriseBootstrapOidc(
  deps: CoworkEnterpriseConfigDeps = {},
): CoworkEnterpriseBootstrapOidc | null {
  let raw = enterpriseRaw("bootstrapOidc", deps);
  if (typeof raw === "string" && raw.trim()) {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const bag = raw as Record<string, unknown>;
  const clientId =
    typeof bag.clientId === "string" && bag.clientId.trim()
      ? bag.clientId.trim()
      : "";
  if (!clientId) return null;
  const out: CoworkEnterpriseBootstrapOidc = { clientId };
  if (typeof bag.issuer === "string" && bag.issuer.trim()) {
    out.issuer = bag.issuer.trim();
  }
  if (typeof bag.authorizationUrl === "string" && bag.authorizationUrl.trim()) {
    out.authorizationUrl = bag.authorizationUrl.trim();
  }
  if (typeof bag.tokenUrl === "string" && bag.tokenUrl.trim()) {
    out.tokenUrl = bag.tokenUrl.trim();
  }
  if (Array.isArray(bag.scopes)) {
    out.scopes = bag.scopes.filter((s): s is string => typeof s === "string");
  } else if (typeof bag.scopes === "string" && bag.scopes.trim()) {
    out.scopes = bag.scopes.split(/\s+/).filter(Boolean);
  }
  return out;
}

/**
 * Official AMA/IHe enterprise identity slice for 1p login + telemetry tags.
 */
export function resolveEnterpriseIdentityPolicy(
  deps: CoworkEnterpriseConfigDeps = {},
): {
  forceLoginOrgUUIDs: string[] | null;
  deploymentOrganizationUuid: string | undefined;
  nonessentialServicesDisabled: boolean;
  bootstrapOidc: CoworkEnterpriseBootstrapOidc | null;
  vertexOAuth: CoworkEnterpriseVertexOAuth | null;
  bedrockSso: CoworkEnterpriseBedrockSso | null;
  needsVertexAuth: boolean;
  needsBedrockSsoAuth: boolean;
} {
  return {
    forceLoginOrgUUIDs: resolveEnterpriseForceLoginOrgUUIDs(deps),
    deploymentOrganizationUuid:
      resolveEnterpriseDeploymentOrganizationUuid(deps),
    nonessentialServicesDisabled:
      isEnterpriseNonessentialServicesDisabled(deps),
    bootstrapOidc: resolveEnterpriseBootstrapOidc(deps),
    vertexOAuth: resolveEnterpriseVertexOAuth(deps),
    bedrockSso: resolveEnterpriseBedrockSso(deps),
    needsVertexAuth: needsEnterpriseVertexAuth(deps),
    needsBedrockSsoAuth: needsEnterpriseBedrockSsoAuth(deps),
  };
}
