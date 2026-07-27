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
import os from "node:os";
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

export type DesktopDeploymentMode = "1p" | "3p" | "dotClaude";

/**
 * Product extension (no official residual): "dotClaude" deployment mode lets the
 * desktop run directly on the user's existing `~/.claude` CLI configuration —
 * no configLibrary bag, no credential copy. Routing / models / keys resolve in
 * the CLI exactly as they do in the terminal (zero migration for CLI users).
 * Resolution maps it to the 3p shell (Cai) so bootstrap synthesizes an account;
 * the spawn env passthrough branch lives in custom3pCliEnv.
 */
export const DOT_CLAUDE_DEPLOYMENT_MODE = "dotClaude" as const;

export type EnterpriseActivationBag = Custom3pEnterpriseConfig & {
  bootstrapUrl?: string;
  bootstrapEnabled?: boolean;
  disableDeploymentModeChooser?: boolean;
  inferenceCredentialHelper?: string;
};

/**
 * Detected routing credentials from the user's existing CLI config
 * (`~/.claude/settings.json` env bag). Product dotClaude mode only — the
 * desktop never writes this file; the CLI remains its owner.
 */
export type DotClaudeCliConfig = {
  /** Absolute path of the settings file the values came from. */
  settingsPath: string;
  baseUrl: string;
  /** env.ANTHROPIC_AUTH_TOKEN or env.ANTHROPIC_API_KEY. */
  authToken?: string;
  /** env.ANTHROPIC_MODEL (informational — model stays CLI-managed). */
  model?: string;
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
  return value === "1p" || value === "3p" || value === DOT_CLAUDE_DEPLOYMENT_MODE
    ? value
    : undefined;
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

/**
 * Detect a usable CLI config at `~/.claude/settings.json` (env.ANTHROPIC_BASE_URL
 * + AUTH_TOKEN or API_KEY). Read-only: never mutates the file, never copies the
 * secret anywhere. Returns null when the file is absent/incomplete/invalid.
 */
export function detectDotClaudeCliConfig(homeDir?: string): DotClaudeCliConfig | null {
  try {
    const home = homeDir ?? os.homedir();
    const settingsPath = path.join(home, ".claude", "settings.json");
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    const env = record(raw.env);
    const baseUrl = stringField(env.ANTHROPIC_BASE_URL);
    const authToken = stringField(env.ANTHROPIC_AUTH_TOKEN) ?? stringField(env.ANTHROPIC_API_KEY);
    if (!baseUrl || !authToken) return null;
    const config: DotClaudeCliConfig = { settingsPath, baseUrl, authToken };
    const model = stringField(env.ANTHROPIC_MODEL);
    if (model) config.model = model;
    return config;
  } catch {
    return null;
  }
}

/** Official N1e decision without side effects. */
export function resolveDeploymentMode(input: {
  enterprise: EnterpriseActivationBag | null | undefined;
  persistedDeploymentMode?: DesktopDeploymentMode | undefined;
  /** Product dotClaude detection result (only consulted for that mode). */
  dotClaudeConfig?: DotClaudeCliConfig | null | undefined;
}): DeploymentModeResolution {
  const enterprise = input.enterprise ?? null;
  const persisted = input.persistedDeploymentMode;

  // Product dotClaude mode: user explicitly chose to run on ~/.claude.
  // Maps to the 3p shell (synthetic account, no official OAuth) but the CLI
  // keeps owning routing. Stale choice (config since removed) → degraded, and
  // the login page will surface the regular chooser instead of the card.
  if (persisted === DOT_CLAUDE_DEPLOYMENT_MODE) {
    const dotClaude = input.dotClaudeConfig ?? null;
    return {
      mode: "3p",
      thirdPartyActivated: dotClaude !== null,
      degraded: dotClaude === null,
      detail: dotClaude
        ? `dotClaude mode — routing from ~/.claude (${dotClaude.baseUrl})`
        : "dotClaude mode stale — ~/.claude/settings.json has no ANTHROPIC_BASE_URL + token",
      enterprise,
      persistedDeploymentMode: persisted,
    };
  }

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
  /** Present when ~/.claude/settings.json has usable routing env (any mode). */
  dotClaudeConfig: DotClaudeCliConfig | null;
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
    dotClaudeConfig: null,
    resolution: resolveDeploymentMode({ enterprise: null }),
  };

  const persistedDeploymentMode = readPersistedDeploymentModeFromShell(userDataPath);
  const dotClaudeConfig = detectDotClaudeCliConfig();

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
      dotClaudeConfig,
    });
    return {
      appliedId,
      appliedConfig,
      persistedDeploymentMode,
      enterprise,
      dotClaudeConfig,
      resolution,
    };
  } catch {
    if (managedEnterprise) {
      const resolution = resolveDeploymentMode({
        enterprise: managedEnterprise,
        persistedDeploymentMode,
        dotClaudeConfig,
      });
      return {
        ...empty,
        appliedId,
        appliedConfig,
        persistedDeploymentMode,
        enterprise: managedEnterprise,
        dotClaudeConfig,
        resolution,
      };
    }
    return {
      ...empty,
      appliedId,
      appliedConfig,
      persistedDeploymentMode,
      dotClaudeConfig,
    };
  }
}
