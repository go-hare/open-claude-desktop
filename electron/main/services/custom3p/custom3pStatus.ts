/**
 * Official residual (app.asar):
 *   Bai / _1e bootstrap state: configured from bootstrapUrl; health never|pending|ok|stale|...
 *   getConfigHealth / getLoginDesktop3pStatus on Custom3pSetup
 *   N1e degraded 3p when UV/creds incomplete
 *
 * ConfigHealth live probe lives in custom3pConfigHealth.ts (X6t/KbA residual).
 * This module keeps login-desktop status + bootstrap bag helpers.
 */

import {
  resolveEnterpriseBootstrapOidc,
  resolveEnterpriseDeploymentOrganizationUuid,
  resolveEnterpriseForceLoginOrgUUIDs,
} from "../coworkHostLoop/coworkEnterpriseConfig";
import { needsBedrockSsoInteractiveAuth } from "./enterpriseBedrockSsoAuth";
import { needsVertexInteractiveAuth } from "./enterpriseVertexAuth";
import {
  type DeploymentModeResolution,
  type DesktopShellDeploymentSnapshot,
  resolveDeploymentModeFromUserData,
} from "./deploymentMode";

export type Custom3pSource = {
  type: "local" | "managed" | "none";
  remote: boolean;
};

/**
 * @deprecated Prefer ConfigHealth from custom3pConfigHealth (official yW states).
 * Kept as a thin sync snapshot for any non-banner callers.
 */
export type Custom3pHealthState = {
  state:
    | "healthy"
    | "invalid_config"
    | "auth_failed"
    | "unreachable"
    | "provider_error"
    | "not_testable"
    | "bootstrap_error"
    | "config_model_rejected"
    | "degraded"
    | "unconfigured"
    | "never";
  source: Custom3pSource;
  provider: string | null;
  endpoint: string | null;
  checkedAt: string;
  detail?: string;
  deploymentMode?: "1p" | "3p";
  message?: string;
  probedModel?: string;
  httpStatus?: number;
  requestUrl?: string;
  responseBody?: string;
  failingField?: string;
  errorCode?: string;
};

export type Custom3pLoginDesktopStatus = {
  enabled: boolean;
  source: Custom3pSource;
  provider: string | null;
  bootstrapHost: string | null;
  deploymentMode: "1p" | "3p" | "dotClaude";
  thirdPartyActivated: boolean;
  degraded: boolean;
  detail: string;
  /**
   * Official IHe / eHe residual — org UUID allowlist for 1p login (null = unrestricted).
   */
  forceLoginOrgUUIDs?: string[] | null;
  /** Official deploymentOrganizationUuid residual (telemetry tag). */
  deploymentOrganizationUuid?: string | null;
  /**
   * Official f1e / CHe residual — interactive auth still required (stored ADC/SSO considered).
   * Product does not invent browser OAuth/SSO tokens; UI can surface setup repair.
   */
  needsVertexAuth?: boolean;
  needsBedrockSsoAuth?: boolean;
  /** Official bootstrapOidc present (interactive bootstrap still required). */
  bootstrapOidcConfigured?: boolean;
  /**
   * Product extension: ~/.claude/settings.json has usable routing env, so the
   * login page may offer a "Continue with ~/.claude" card. Never contains the
   * secret — only the base URL host for display.
   */
  dotClaude?: {
    available: boolean;
    host: string | null;
    model?: string;
  };
};

export type Custom3pBootstrapState = {
  configured: boolean;
  url?: string;
  origin: "local" | "mdm" | "none";
  health: "never" | "pending" | "ok" | "degraded" | "unreachable" | "stale";
  lastSyncAt?: number;
  suppliedKeys: string[];
  suppliedValues: Record<string, unknown>;
  detail?: string;
};

function sourceFromResolution(resolution: DeploymentModeResolution): Custom3pSource {
  if (!resolution.thirdPartyActivated && resolution.mode === "1p") {
    return { type: "none", remote: false };
  }
  return { type: "local", remote: false };
}

function providerOf(resolution: DeploymentModeResolution): string | null {
  const p = resolution.enterprise?.inferenceProvider;
  return typeof p === "string" && p.length > 0 ? p : null;
}

function endpointOf(resolution: DeploymentModeResolution): string | null {
  const e = resolution.enterprise;
  if (!e) return null;
  if (typeof e.inferenceGatewayBaseUrl === "string" && e.inferenceGatewayBaseUrl) {
    return e.inferenceGatewayBaseUrl;
  }
  if (typeof e.inferenceOpenAIBaseUrl === "string" && e.inferenceOpenAIBaseUrl) {
    return e.inferenceOpenAIBaseUrl;
  }
  if (typeof e.inferenceGeminiBaseUrl === "string" && e.inferenceGeminiBaseUrl) {
    return e.inferenceGeminiBaseUrl;
  }
  if (typeof e.inferenceGrokBaseUrl === "string" && e.inferenceGrokBaseUrl) {
    return e.inferenceGrokBaseUrl;
  }
  if (typeof e.inferenceVertexBaseUrl === "string" && e.inferenceVertexBaseUrl) {
    return e.inferenceVertexBaseUrl;
  }
  if (typeof e.inferenceBedrockBaseUrl === "string" && e.inferenceBedrockBaseUrl) {
    return e.inferenceBedrockBaseUrl;
  }
  if (typeof e.bootstrapUrl === "string" && e.bootstrapUrl) return e.bootstrapUrl;
  return resolution.mode === "3p" ? "app://localhost" : null;
}

function suppliedFromEnterprise(
  enterprise: DeploymentModeResolution["enterprise"],
): { keys: string[]; values: Record<string, unknown> } {
  if (!enterprise) return { keys: [], values: {} };
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(enterprise)) {
    if (value === undefined || value === null || value === "") continue;
    if (
      key === "inferenceGatewayApiKey"
      || key === "inferenceBedrockBearerToken"
      || key === "inferenceFoundryApiKey"
      || key === "inferenceOpenAIApiKey"
      || key === "inferenceGeminiApiKey"
      || key === "inferenceGrokApiKey"
    ) {
      values[key] = "[set]";
      continue;
    }
    values[key] = value;
  }
  return { keys: Object.keys(values), values };
}

export function resolveCustom3pSnapshot(
  userDataPath: string,
): DesktopShellDeploymentSnapshot {
  return resolveDeploymentModeFromUserData(userDataPath);
}

/**
 * Sync structural health (no network). Prefer async recomputeConfigHealth for banner.
 * Maps N1e residual into yW-compatible states for IPC consumers that still call sync.
 */
export function custom3pHealth(userDataPath?: string): Custom3pHealthState {
  const checkedAt = new Date().toISOString();
  if (!userDataPath) {
    return {
      state: "not_testable",
      source: { type: "none", remote: false },
      provider: null,
      endpoint: null,
      checkedAt,
      detail: "no userData path",
      deploymentMode: "1p",
    };
  }
  const snap = resolveDeploymentModeFromUserData(userDataPath);
  const { resolution } = snap;
  if (resolution.mode === "1p" && !resolution.thirdPartyActivated) {
    return {
      state: "not_testable",
      source: { type: "none", remote: false },
      provider: providerOf(resolution),
      endpoint: endpointOf(resolution),
      checkedAt,
      detail: resolution.detail,
      deploymentMode: "1p",
    };
  }
  if (resolution.degraded) {
    return {
      state: "invalid_config",
      source: sourceFromResolution(resolution),
      provider: providerOf(resolution),
      endpoint: endpointOf(resolution),
      checkedAt,
      detail: resolution.detail,
      message: resolution.detail,
      deploymentMode: "3p",
    };
  }
  return {
    // Sync path cannot claim healthy without probe — not_testable until recheck.
    state: "not_testable",
    source: sourceFromResolution(resolution),
    provider: providerOf(resolution),
    endpoint: endpointOf(resolution),
    checkedAt,
    detail: resolution.detail,
    deploymentMode: resolution.mode === "3p" ? "3p" : "1p",
  };
}

/**
 * Official getLoginDesktop3pStatus residual (app.asar `hgr` / `fot`).
 * Product extension: also surfaces ~/.claude detection for the dotClaude card.
 */
export function custom3pLoginDesktopStatus(userDataPath?: string): Custom3pLoginDesktopStatus {
  if (!userDataPath) {
    return {
      enabled: false,
      source: { type: "none", remote: false },
      provider: null,
      bootstrapHost: null,
      deploymentMode: "1p",
      thirdPartyActivated: false,
      degraded: false,
      detail: "no userData path",
    };
  }
  const snap = resolveDeploymentModeFromUserData(userDataPath);
  const { resolution, dotClaudeConfig } = snap;
  const enterprise = resolution.enterprise ?? snap.enterprise;
  const provider =
    typeof enterprise?.inferenceProvider === "string" && enterprise.inferenceProvider.length > 0
      ? enterprise.inferenceProvider
      : providerOf(resolution);
  let bootstrapHost: string | null = null;
  const bootstrapUrl =
    typeof enterprise?.bootstrapUrl === "string" ? enterprise.bootstrapUrl : null;
  if (bootstrapUrl) {
    try {
      bootstrapHost = new URL(bootstrapUrl).hostname || null;
    } catch {
      bootstrapHost = null;
    }
  }
  const chooserDisabled = enterprise?.disableDeploymentModeChooser === true;
  const dotClaudeMode = snap.persistedDeploymentMode === "dotClaude";
  const enabled = !chooserDisabled && (resolution.thirdPartyActivated || dotClaudeMode);
  // Official IHe / h1e / CHe residual — identity + interactive-auth needs from bag.
  // Use userData inject so tests/desktop don't walk win32 registry for status.
  const enterpriseDeps = {
    getManagedConfig: () => ({}),
    getLocalConfig: () =>
      enterprise && typeof enterprise === "object"
        ? (enterprise as Record<string, unknown>)
        : {},
  };
  return {
    enabled,
    source: dotClaudeMode ? { type: "local", remote: false } : sourceFromResolution(resolution),
    provider,
    bootstrapHost,
    deploymentMode: dotClaudeMode ? "dotClaude" : resolution.mode,
    thirdPartyActivated: resolution.thirdPartyActivated,
    degraded: resolution.degraded,
    detail: resolution.detail,
    forceLoginOrgUUIDs: resolveEnterpriseForceLoginOrgUUIDs(enterpriseDeps),
    deploymentOrganizationUuid:
      resolveEnterpriseDeploymentOrganizationUuid(enterpriseDeps) ?? null,
    needsVertexAuth: needsVertexInteractiveAuth(enterpriseDeps),
    needsBedrockSsoAuth: needsBedrockSsoInteractiveAuth(enterpriseDeps),
    bootstrapOidcConfigured: resolveEnterpriseBootstrapOidc(enterpriseDeps) !== null,
    dotClaude: dotClaudeConfig
      ? {
          available: true,
          host: hostOf(dotClaudeConfig.baseUrl),
          ...(dotClaudeConfig.model ? { model: dotClaudeConfig.model } : {}),
        }
      : { available: false, host: null },
  };
}

function hostOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname || null;
  } catch {
    return null;
  }
}

/** Official Bai / bootstrapState_$store residual. */
export function custom3pBootstrapState(userDataPath?: string): Custom3pBootstrapState {
  if (!userDataPath) {
    return {
      configured: false,
      origin: "none",
      health: "never",
      suppliedKeys: [],
      suppliedValues: {},
    };
  }
  const snap = resolveDeploymentModeFromUserData(userDataPath);
  const { resolution } = snap;
  const enterprise = resolution.enterprise;
  const bootstrapUrl =
    typeof enterprise?.bootstrapUrl === "string" ? enterprise.bootstrapUrl : undefined;
  const bootstrapEnabled = enterprise?.bootstrapEnabled !== false;
  const bootstrapConfigured = Boolean(bootstrapUrl && bootstrapEnabled);
  const { keys, values } = suppliedFromEnterprise(enterprise);

  if (resolution.mode === "1p") {
    return {
      configured: bootstrapConfigured || resolution.thirdPartyActivated,
      url: bootstrapUrl,
      origin: bootstrapConfigured ? "local" : "none",
      health: "never",
      suppliedKeys: keys,
      suppliedValues: values,
      detail: resolution.detail,
    };
  }

  return {
    configured: true,
    url: bootstrapUrl,
    origin: bootstrapConfigured ? "local" : "local",
    health: resolution.degraded ? "degraded" : "ok",
    suppliedKeys: keys,
    suppliedValues: values,
    detail: resolution.detail,
  };
}
