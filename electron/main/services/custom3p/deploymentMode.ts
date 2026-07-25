/**
 * Official residual (app.asar):
 *
 *   function Hzt(e) {
 *     return e.inferenceProvider !== undefined
 *       || (bootstrapUrl set && bootstrapEnabled !== false);
 *   }
 *   function IHe(e) { return e.disableDeploymentModeChooser === true }
 *   function SM(e) { // deploymentModeIs3p
 *     return Hzt(e) && (IHe(e) || readPersistedDeploymentMode() !== "1p");
 *   }
 *   function N1e(deps) { // initDeploymentMode
 *     const t = vi(); // enterprise config
 *     if (!SM(t)) return 1p mode (hai);
 *     try { creds = UV(t) } catch { degraded 3p }
 *     if (creds === null) 3p degraded (no valid credentials);
 *     else 3p active;
 *   }
 *
 * Product sources for enterprise bag (first non-empty merge, never invent true):
 *   1. applied custom3p bag from userData/configLibrary (official wrA residual)
 *   2. legacy desktop-shell-settings custom3pConfigs (one-shot migrate when library empty)
 *   3. optional managed/enterprise overlay (caller-supplied)
 *   4. preferences.deploymentMode as persisted chooser residual
 */

import fs from "node:fs";
import path from "node:path";
import {
  custom3pEnterpriseConfigFromUnknown,
  DESKTOP_SHELL_SETTINGS_FILE,
  type Custom3pEnterpriseConfig,
} from "./custom3pCliEnv";
import {
  getAppliedCustom3pConfigLibraryBag,
  migrateLegacyShellCustom3pConfigsToLibrary,
} from "./custom3pConfigLibrary";

export type DesktopDeploymentMode = "1p" | "3p";

export type EnterpriseActivationBag = Custom3pEnterpriseConfig & {
  bootstrapUrl?: string;
  bootstrapEnabled?: boolean;
  disableDeploymentModeChooser?: boolean;
  inferenceCredentialHelper?: string;
};

export type DeploymentModeResolution = {
  /** Official Ii().type residual. */
  mode: DesktopDeploymentMode;
  /** Hzt — 3p activation keys present. */
  thirdPartyActivated: boolean;
  /** SM would be true but UV/creds incomplete → degraded 3p. */
  degraded: boolean;
  /** Why not 3p, or why degraded — for logs / health UI. */
  detail: string;
  enterprise: EnterpriseActivationBag | null;
  persistedDeploymentMode: DesktopDeploymentMode | undefined;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Official Hzt residual. */
export function hasThirdPartyActivationKeys(
  enterprise: EnterpriseActivationBag | null | undefined,
): boolean {
  if (!enterprise) return false;
  if (enterprise.inferenceProvider !== undefined && enterprise.inferenceProvider !== "") {
    return true;
  }
  if (enterprise.bootstrapUrl && enterprise.bootstrapEnabled !== false) {
    return true;
  }
  return false;
}

/** Official IHe residual. */
export function isDeploymentModeChooserDisabled(
  enterprise: EnterpriseActivationBag | null | undefined,
): boolean {
  return enterprise?.disableDeploymentModeChooser === true;
}

/**
 * Official SM / deploymentModeIs3p residual.
 * Persisted "1p" forces Anthropic path even when enterprise has 3p keys
 * (unless chooser is enterprise-disabled).
 */
export function deploymentModeIs3p(
  enterprise: EnterpriseActivationBag | null | undefined,
  persistedDeploymentMode: DesktopDeploymentMode | undefined,
): boolean {
  if (!hasThirdPartyActivationKeys(enterprise)) return false;
  if (isDeploymentModeChooserDisabled(enterprise)) return true;
  return persistedDeploymentMode !== "1p";
}

/**
 * Official UV/Pzt-shaped gate: enough credentials to not mark degraded.
 * Does not invent secrets; incomplete bag → degraded (still 3p).
 */
export function hasUsableThirdPartyCredentials(
  enterprise: EnterpriseActivationBag | null | undefined,
): boolean {
  if (!enterprise?.inferenceProvider) {
    // bootstrap-only activation can be "configured" without provider until overlay resolves
    return Boolean(enterprise?.bootstrapUrl && enterprise.bootstrapEnabled !== false);
  }
  switch (enterprise.inferenceProvider) {
    case "gateway": {
      if (enterprise.inferenceGatewayAuthScheme === "sso") return true;
      if (stringField(enterprise.inferenceGatewayApiKey)) return true;
      if (stringField(enterprise.inferenceCredentialHelper)) return true;
      if (enterprise.bootstrapUrl && enterprise.bootstrapEnabled !== false) return true;
      // Official requires base URL for gateway probe; missing key/url → degraded.
      return false;
    }
    case "vertex":
      return Boolean(
        stringField(enterprise.inferenceVertexProjectId)
        && stringField(enterprise.inferenceVertexRegion),
      );
    case "bedrock":
      return Boolean(
        stringField(enterprise.inferenceBedrockBearerToken)
        || stringField(enterprise.inferenceBedrockProfile)
        || stringField(enterprise.inferenceCredentialHelper),
      );
    case "foundry":
      return Boolean(
        stringField(enterprise.inferenceFoundryResource)
        || stringField(enterprise.inferenceFoundryApiKey),
      );
    default:
      return false;
  }
}

export function normalizePersistedDeploymentMode(
  value: unknown,
): DesktopDeploymentMode | undefined {
  return value === "1p" || value === "3p" ? value : undefined;
}

export function enterpriseActivationFromUnknown(
  value: unknown,
): EnterpriseActivationBag | null {
  const base = custom3pEnterpriseConfigFromUnknown(value);
  const root = record(value);
  const bag = stringField(root.inferenceProvider) || root.bootstrapUrl
    ? root
    : record(root.config);

  const bootstrapUrl = stringField(bag.bootstrapUrl);
  const bootstrapEnabled = booleanField(bag.bootstrapEnabled);
  const disableDeploymentModeChooser = booleanField(bag.disableDeploymentModeChooser);
  const inferenceCredentialHelper = stringField(bag.inferenceCredentialHelper);

  if (!base && !bootstrapUrl) {
    // bare flags without provider/bootstrap do not activate 3p
    if (disableDeploymentModeChooser) {
      return {
        disableDeploymentModeChooser: true,
      };
    }
    return null;
  }

  return {
    ...(base ?? {}),
    ...(bootstrapUrl ? { bootstrapUrl } : {}),
    ...(bootstrapEnabled !== undefined ? { bootstrapEnabled } : {}),
    ...(disableDeploymentModeChooser !== undefined
      ? { disableDeploymentModeChooser }
      : {}),
    ...(inferenceCredentialHelper ? { inferenceCredentialHelper } : {}),
  };
}

/**
 * Merge enterprise overlays (managed MDM / applied custom3p).
 * Later sources override earlier for same keys; empty overlay skipped.
 */
export function mergeEnterpriseActivationBags(
  ...bags: Array<EnterpriseActivationBag | null | undefined>
): EnterpriseActivationBag | null {
  let merged: EnterpriseActivationBag | null = null;
  for (const bag of bags) {
    if (!bag || Object.keys(bag).length === 0) continue;
    merged = { ...(merged ?? {}), ...bag };
  }
  return merged;
}

/** Official N1e decision without side effects. */
export function resolveDeploymentMode(input: {
  enterprise: EnterpriseActivationBag | null | undefined;
  persistedDeploymentMode?: DesktopDeploymentMode | undefined;
}): DeploymentModeResolution {
  const enterprise = input.enterprise ?? null;
  const persisted = input.persistedDeploymentMode;
  const activated = hasThirdPartyActivationKeys(enterprise);

  if (!deploymentModeIs3p(enterprise, persisted)) {
    return {
      mode: "1p",
      thirdPartyActivated: activated,
      degraded: false,
      detail: activated
        ? "persisted deploymentMode is 1p"
        : "no inferenceProvider / bootstrapUrl — Anthropic 1p path",
      enterprise,
      persistedDeploymentMode: persisted,
    };
  }

  const usable = hasUsableThirdPartyCredentials(enterprise);
  return {
    mode: "3p",
    thirdPartyActivated: true,
    degraded: !usable,
    detail: usable
      ? `3p active (${enterprise?.inferenceProvider ?? "bootstrap"})`
      : `3p degraded — open Setup to fix (${enterprise?.inferenceProvider ?? "unknown"})`,
    enterprise,
    persistedDeploymentMode: persisted,
  };
}

export type DesktopShellDeploymentSnapshot = {
  appliedId: string | null;
  appliedConfig: unknown | null;
  persistedDeploymentMode: DesktopDeploymentMode | undefined;
  enterprise: EnterpriseActivationBag | null;
  resolution: DeploymentModeResolution;
};

function readPersistedDeploymentModeFromShell(
  userDataPath: string,
): DesktopDeploymentMode | undefined {
  try {
    const filePath = path.join(userDataPath, DESKTOP_SHELL_SETTINGS_FILE);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const preferences = record(raw.preferences);
    return normalizePersistedDeploymentMode(
      preferences.deploymentMode ?? raw.deploymentMode,
    );
  } catch {
    return undefined;
  }
}

function readLegacyShellAppliedCustom3p(userDataPath: string): {
  appliedId: string | null;
  appliedConfig: unknown | null;
} {
  try {
    const filePath = path.join(userDataPath, DESKTOP_SHELL_SETTINGS_FILE);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const appliedId =
      typeof raw.appliedCustom3pConfigId === "string" && raw.appliedCustom3pConfigId.length > 0
        ? raw.appliedCustom3pConfigId
        : null;
    const configs = record(raw.custom3pConfigs);
    try {
      migrateLegacyShellCustom3pConfigsToLibrary(userDataPath, {
        appliedCustom3pConfigId: appliedId,
        custom3pConfigs: configs,
      });
    } catch {
      // best-effort
    }
    const recordBag = appliedId ? record(configs[appliedId]) : {};
    const appliedConfig =
      Object.keys(recordBag).length > 0 ? (recordBag.config ?? null) : null;
    return { appliedId, appliedConfig };
  } catch {
    return { appliedId: null, appliedConfig: null };
  }
}

/**
 * Read product applied bag + resolve N1e residual.
 * Official multi-config applied bag lives in userData/configLibrary.
 */
export function resolveDeploymentModeFromUserData(
  userDataPath: string,
  managedEnterprise?: EnterpriseActivationBag | null,
): DesktopShellDeploymentSnapshot {
  const empty: DesktopShellDeploymentSnapshot = {
    appliedId: null,
    appliedConfig: null,
    persistedDeploymentMode: undefined,
    enterprise: null,
    resolution: resolveDeploymentMode({ enterprise: null }),
  };

  const persistedDeploymentMode = readPersistedDeploymentModeFromShell(userDataPath);

  let appliedId: string | null = null;
  let appliedConfig: unknown | null = null;

  try {
    const fromLibrary = getAppliedCustom3pConfigLibraryBag(userDataPath);
    if (fromLibrary.id) {
      appliedId = fromLibrary.id;
      appliedConfig = fromLibrary.config;
    }
  } catch {
    // continue
  }

  if (!appliedId) {
    const legacy = readLegacyShellAppliedCustom3p(userDataPath);
    // After migrate, prefer library again.
    try {
      const migrated = getAppliedCustom3pConfigLibraryBag(userDataPath);
      if (migrated.id) {
        appliedId = migrated.id;
        appliedConfig = migrated.config;
      } else {
        appliedId = legacy.appliedId;
        appliedConfig = legacy.appliedConfig;
      }
    } catch {
      appliedId = legacy.appliedId;
      appliedConfig = legacy.appliedConfig;
    }
  }

  try {
    const fromApplied = enterpriseActivationFromUnknown(appliedConfig);
    const enterprise = mergeEnterpriseActivationBags(managedEnterprise, fromApplied);
    const resolution = resolveDeploymentMode({
      enterprise,
      persistedDeploymentMode,
    });
    return {
      appliedId,
      appliedConfig,
      persistedDeploymentMode,
      enterprise,
      resolution,
    };
  } catch {
    if (managedEnterprise) {
      const resolution = resolveDeploymentMode({
        enterprise: managedEnterprise,
        persistedDeploymentMode,
      });
      return {
        ...empty,
        appliedId,
        appliedConfig,
        persistedDeploymentMode,
        enterprise: managedEnterprise,
        resolution,
      };
    }
    return {
      ...empty,
      appliedId,
      appliedConfig,
      persistedDeploymentMode,
    };
  }
}
