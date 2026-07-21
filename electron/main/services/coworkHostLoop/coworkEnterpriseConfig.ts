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
 *   - Read userData/configLibrary/_meta.json appliedId → {uuid}.json
 *   - Optional setEnterpriseRemoteTier / inject for tests
 *   - Never invent true from absence
 *   - Full QB schema / win32 registry / native Jn() plist bridge residual
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY =
  "requireCoworkFullVmSandbox" as const;

export const COWORK_MANAGED_PREFERENCES_BUNDLE_ID =
  "com.anthropic.claudefordesktop";

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
  if (deps.getManagedConfig) {
    return parseCoworkEnterpriseBoolean(
      deps.getManagedConfig()?.[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY],
    );
  }
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") {
    // win32 SOFTWARE\Policies registry residual not product-wired (needs native Jn).
    return undefined;
  }
  const existsSync = deps.existsSync ?? fs.existsSync;
  const readFileSync = deps.readFileSync ?? ((p, enc) => fs.readFileSync(p, enc));
  const convert = deps.convertPlistToJson ?? defaultConvertPlistToJson;
  for (const plistPath of resolveCoworkManagedPreferencesPlistPaths({
    username: deps.username,
  })) {
    if (!existsSync(plistPath)) continue;
    const fromPlutil = convert(plistPath);
    if (fromPlutil) {
      try {
        const parsed = JSON.parse(fromPlutil) as Record<string, unknown>;
        const flag = parseCoworkEnterpriseBoolean(
          parsed[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY],
        );
        if (flag !== undefined) return flag;
      } catch {
        // fall through to XML residual
      }
    }
    try {
      const xml = readFileSync(plistPath, "utf8");
      const flag = readXmlPlistBooleanKey(
        xml,
        COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY,
      );
      if (flag !== undefined) return flag;
    } catch {
      // ignore unreadable plist
    }
  }
  return undefined;
}

export function readConfigLibraryRequireCoworkFullVmSandbox(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean | undefined {
  if (deps.getLocalConfig) {
    return parseCoworkEnterpriseBoolean(
      deps.getLocalConfig()?.[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY],
    );
  }
  const userDataPath = deps.getUserDataPath?.();
  if (!userDataPath) return undefined;
  const existsSync = deps.existsSync ?? fs.existsSync;
  const readFileSync = deps.readFileSync ?? ((p, enc) => fs.readFileSync(p, enc));
  const metaPath = resolveCoworkConfigLibraryMetaPath(userDataPath);
  if (!existsSync(metaPath)) return undefined;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
      appliedId?: unknown;
    };
    const appliedId =
      typeof meta.appliedId === "string" ? meta.appliedId : undefined;
    if (!appliedId || !APPLIED_ID_RE.test(appliedId)) return undefined;
    const entryPath = resolveCoworkConfigLibraryEntryPath(
      userDataPath,
      appliedId,
    );
    if (!existsSync(entryPath)) return undefined;
    const entry = JSON.parse(readFileSync(entryPath, "utf8")) as Record<
      string,
      unknown
    >;
    return parseCoworkEnterpriseBoolean(
      entry[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY],
    );
  } catch {
    return undefined;
  }
}

/**
 * Official vi()-shaped snapshot residual (require key only for product policy).
 * Managed wins over local; remote tier overlays when base is not none.
 */
export function loadCoworkEnterpriseConfig(
  deps: CoworkEnterpriseConfigDeps = {},
): CoworkEnterpriseConfigSnapshot {
  if (cached && !deps.getManagedConfig && !deps.getLocalConfig) {
    return cached;
  }
  const managedFlag = readManagedRequireCoworkFullVmSandbox(deps);
  const hasManaged = managedFlag !== undefined;
  const localFlag = hasManaged
    ? undefined
    : readConfigLibraryRequireCoworkFullVmSandbox(deps);
  const hasLocal = localFlag !== undefined;
  const type: CoworkEnterpriseConfigSourceType = hasManaged
    ? "managed"
    : hasLocal
      ? "local"
      : "none";
  const remote = deps.getRemoteTier?.() ?? remoteTier;
  const hasRemote = remote !== undefined && type !== "none";
  const base: Record<string, unknown> = {};
  if (hasManaged) {
    base[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY] = managedFlag;
  } else if (hasLocal) {
    base[COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY] = localFlag;
  }
  const merged: Record<string, unknown> = {
    ...base,
    ...(hasRemote ? remote : {}),
  };
  // Only keep explicit boolean true for require key (uHA === true).
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
  if (!deps.getManagedConfig && !deps.getLocalConfig) {
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
