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
   * Product host-loop policy still only *consumes* requireCoworkFullVmSandbox
   * (uHA). Other keys are named for 1:1 registry/plist walk residual / future
   * policy readers — do not invent values for absent keys.
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

/** Official enterprise keys product currently consumes for host-loop policy. */
export const COWORK_ENTERPRISE_POLICY_KEYS = [
  COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY,
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

/** Official uoe — set remote enterprise tier and invalidate cache. */
export function setCoworkEnterpriseRemoteTier(
  next: Record<string, unknown> | null | undefined,
): void {
  remoteTier = next ?? undefined;
  cached = undefined;
}

export function resetCoworkEnterpriseConfigForTests(): void {
  remoteTier = undefined;
  cached = undefined;
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
  const username = input.username ?? os.userInfo().username;
  const bundle = `${COWORK_MANAGED_PREFERENCES_BUNDLE_ID}.plist`;
  return [
    path.join("/Library/Managed Preferences", bundle),
    path.join("/Library/Managed Preferences", username, bundle),
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
  const readValue =
    deps.readWindowsPolicyValue ?? defaultReadWindowsPolicyValue;
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
  const userDataPath = deps.getUserDataPath?.();
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
 *   when base is not none. Product policy still only *consumes* require key
 *   (uHA === true). Full QB bag is retained on `raw` for 1:1 residual.
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
    && !deps.readWindowsPolicyValue
    && !deps.readWindowsPolicyValues
    && !deps.convertPlistToJson
  ) {
    return cached;
  }
  const managedBag = readManagedEnterpriseBag(deps);
  const hasManaged = Object.keys(managedBag).length > 0;
  const localBag = hasManaged ? {} : readConfigLibraryEnterpriseBag(deps);
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
