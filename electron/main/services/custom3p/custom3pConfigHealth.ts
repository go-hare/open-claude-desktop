/**
 * Official residual (app.asar X6t / KbA / K6t.probeInference / xbA / HbA):
 *
 *   yW states:
 *     healthy | invalid_config | auth_failed | unreachable |
 *     provider_error | not_testable | bootstrap_error | config_model_rejected
 *
 *   Gateway probe:
 *     model = PbA(inferenceModels)  // prefer haiku/sonnet/opus else first
 *     if model → POST {base}/v1/messages {model, max_tokens:1, messages:[{role:user,content:"."}]}
 *     else     → GET  {base}/v1/models?limit=1
 *     401/403 → auth_failed
 *     400/404 + probedModel → config_model_rejected
 *     other HTTP → provider_error
 *     network → unreachable
 *
 * getConfigHealth returns cached zJ; recheckConfigHealth recomputes X6t.
 */

import { net } from "electron";
import {
  type Custom3pEnterpriseConfig,
  type Custom3pInferenceModel,
} from "./custom3pCliEnv";
import {
  type DeploymentModeResolution,
  resolveDeploymentModeFromUserData,
} from "./deploymentMode";

export type ConfigHealthState =
  | "healthy"
  | "invalid_config"
  | "auth_failed"
  | "unreachable"
  | "provider_error"
  | "not_testable"
  | "bootstrap_error"
  | "config_model_rejected";

export type ConfigHealthSource = {
  type: "local" | "managed" | "none";
  remote: boolean;
};

/** Official vre-shaped ConfigHealth payload for Custom3pSetup.getConfigHealth. */
export type ConfigHealth = {
  state: ConfigHealthState;
  source: ConfigHealthSource;
  provider?: string;
  endpoint?: string;
  httpStatus?: number;
  errorCode?: string;
  failingField?: string;
  message?: string;
  requestUrl?: string;
  probedModel?: string;
  responseBody?: string;
  checkedAt: string;
};

const PROBE_TIMEOUT_MS = 5000;
const PROBE_USER_MESSAGE = { role: "user", content: "." } as const;

let cachedHealth: ConfigHealth | null = null;

function sourceFromResolution(resolution: DeploymentModeResolution): ConfigHealthSource {
  if (!resolution.thirdPartyActivated && resolution.mode === "1p") {
    return { type: "none", remote: false };
  }
  return { type: "local", remote: false };
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Official PbA residual — prefer haiku/sonnet/opus name match, else first. */
export function pickProbeModelName(
  models: Custom3pInferenceModel[] | string[] | undefined,
): string | undefined {
  if (!models?.length) return undefined;
  const names = models.map((entry) => (typeof entry === "string" ? entry : entry.name)).filter(Boolean);
  if (!names.length) return undefined;
  for (const needle of ["haiku", "sonnet", "opus"]) {
    const hit = names.find((name) => name.toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return names[0];
}

type ProbeKind = "auth" | "unreachable" | "error" | "config" | "not_testable" | "model_rejected";

type ProbeResult =
  | { ok: true; latencyMs: number }
  | {
      ok: false;
      kind: ProbeKind;
      message: string;
      httpStatus?: number;
      errorCode?: string;
      requestUrl?: string;
      probedModel?: string;
      responseBody?: string;
    };

const KIND_TO_STATE: Record<ProbeKind, ConfigHealthState> = {
  auth: "auth_failed",
  unreachable: "unreachable",
  error: "provider_error",
  config: "invalid_config",
  not_testable: "not_testable",
  model_rejected: "config_model_rejected",
};

/** Official xbA residual. */
function mapHttpFailure(
  status: number,
  providerLabel: string,
  extras: { requestUrl?: string; probedModel?: string; responseBody?: string },
): ProbeResult {
  if (status >= 200 && status < 300) return { ok: true, latencyMs: 0 };
  if (status === 401 || status === 403) {
    return {
      ok: false,
      kind: "auth",
      message: `${providerLabel} rejected the configured credential (HTTP ${status}).`,
      httpStatus: status,
      ...extras,
    };
  }
  if ((status === 400 || status === 404) && extras.probedModel) {
    return {
      ok: false,
      kind: "model_rejected",
      message: `${providerLabel} rejected model "${extras.probedModel}" (HTTP ${status})`,
      httpStatus: status,
      ...extras,
    };
  }
  return {
    ok: false,
    kind: "error",
    message: `${providerLabel} returned HTTP ${status}`,
    httpStatus: status,
    ...extras,
  };
}

/** Official HbA residual. */
function mapNetworkFailure(
  error: unknown,
  providerLabel: string,
  extras: { requestUrl?: string; probedModel?: string },
): ProbeResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    kind: "unreachable",
    message: `${providerLabel} was unreachable: ${message}`,
    ...extras,
  };
}

function sanitizeResponseBody(body: string): string {
  return body.slice(0, 500);
}

function safeRequestUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

async function probeGateway(
  enterprise: Custom3pEnterpriseConfig,
  timeoutMs: number,
): Promise<ProbeResult> {
  const baseUrl = enterprise.inferenceGatewayBaseUrl?.trim();
  if (!baseUrl) {
    return {
      ok: false,
      kind: "config",
      message: "config: inferenceGatewayBaseUrl: missing base URL",
    };
  }
  const apiKey = enterprise.inferenceGatewayApiKey?.trim();
  const authScheme = enterprise.inferenceGatewayAuthScheme === "x-api-key" ? "x-api-key" : "bearer";
  if (enterprise.inferenceGatewayAuthScheme === "sso" && !apiKey) {
    return {
      ok: false,
      kind: "not_testable",
      message: "Gateway SSO not signed in yet.",
    };
  }
  if (!apiKey) {
    return {
      ok: false,
      kind: "config",
      message: "Credential helper did not produce a token. Configure an API key in Setup.",
    };
  }

  const model = pickProbeModelName(enterprise.inferenceModels);
  const origin = stripTrailingSlash(baseUrl);
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    ...(authScheme === "x-api-key"
      ? { "x-api-key": apiKey }
      : { authorization: `Bearer ${apiKey}` }),
    ...(enterprise.inferenceGatewayHeaders ?? {}),
  };

  const url = model ? `${origin}/v1/messages` : `${origin}/v1/models?limit=1`;
  const started = Date.now();
  try {
    const response = model
      ? await net.fetch(url, {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [PROBE_USER_MESSAGE],
          }),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        })
      : await net.fetch(url, {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
    if (response.ok) return { ok: true, latencyMs: Date.now() - started };
    const responseBody = sanitizeResponseBody(await response.text().catch(() => ""));
    return mapHttpFailure(response.status, "Gateway", {
      requestUrl: safeRequestUrl(url),
      probedModel: model,
      responseBody,
    });
  } catch (error) {
    return mapNetworkFailure(error, "Gateway", {
      requestUrl: safeRequestUrl(url),
      probedModel: model,
    });
  }
}

async function probeProvider(
  enterprise: Custom3pEnterpriseConfig,
): Promise<ProbeResult> {
  const provider = enterprise.inferenceProvider;
  switch (provider) {
    case "gateway":
      return probeGateway(enterprise, PROBE_TIMEOUT_MS);
    case "vertex":
      return {
        ok: false,
        kind: "not_testable",
        message: "Vertex auth cannot be probed from the main process.",
      };
    case "bedrock":
      if (!pickProbeModelName(enterprise.inferenceModels)) {
        return {
          ok: false,
          kind: "error",
          message: "No model configured — set inferenceModels to test.",
        };
      }
      // Minimal residual: without full AWS signing, do not invent healthy.
      if (!enterprise.inferenceBedrockBearerToken && !enterprise.inferenceBedrockProfile) {
        return {
          ok: false,
          kind: "config",
          message: "config: bedrock credentials incomplete",
        };
      }
      return {
        ok: false,
        kind: "not_testable",
        message: "AWS SSO auth uses SigV4 signing — connection not verified here.",
      };
    case "foundry":
      if (!pickProbeModelName(enterprise.inferenceModels)) {
        return {
          ok: false,
          kind: "error",
          message: "No model configured — set inferenceModels to test.",
        };
      }
      return {
        ok: false,
        kind: "not_testable",
        message: "Foundry probe requires resource host verification.",
      };
    default:
      return {
        ok: false,
        kind: "config",
        message: `unhandled provider: ${provider ?? "none"}`,
      };
  }
}

/**
 * Official X6t residual — recompute ConfigHealth from applied enterprise bag.
 */
export async function recomputeConfigHealth(userDataPath?: string): Promise<ConfigHealth> {
  const checkedAt = new Date().toISOString();
  if (!userDataPath) {
    const health: ConfigHealth = {
      state: "not_testable",
      source: { type: "none", remote: false },
      checkedAt,
      message: "no userData path",
    };
    cachedHealth = health;
    return health;
  }

  const snap = resolveDeploymentModeFromUserData(userDataPath);
  const { resolution } = snap;
  const source = sourceFromResolution(resolution);
  const enterprise = resolution.enterprise;

  // Official: 1p with no 3p activation → Healthy (banner hidden via NotTestable/Healthy).
  // AQt hides Healthy + NotTestable. When mode is 1p and not thirdPartyActivated → not_testable.
  if (resolution.mode === "1p" && !resolution.thirdPartyActivated) {
    const health: ConfigHealth = {
      state: "not_testable",
      source: { type: "none", remote: false },
      checkedAt,
    };
    cachedHealth = health;
    return health;
  }

  if (!enterprise?.inferenceProvider) {
    // bootstrap-only / incomplete → invalid or bootstrap error path
    if (enterprise?.bootstrapUrl && enterprise.bootstrapEnabled !== false) {
      const health: ConfigHealth = {
        state: "bootstrap_error",
        source,
        checkedAt,
        message: resolution.detail || "Couldn't fetch organization configuration.",
      };
      cachedHealth = health;
      return health;
    }
    const health: ConfigHealth = {
      state: "invalid_config",
      source,
      checkedAt,
      message: resolution.detail || "Some required fields are missing or malformed.",
      failingField: "inferenceProvider",
    };
    cachedHealth = health;
    return health;
  }

  // Degraded bag without usable credentials → invalid_config (open Setup).
  if (resolution.degraded) {
    const health: ConfigHealth = {
      state: "invalid_config",
      source,
      provider: enterprise.inferenceProvider,
      endpoint: enterprise.inferenceGatewayBaseUrl,
      checkedAt,
      message: resolution.detail || "Provider setup needs a fix.",
      failingField: enterprise.inferenceGatewayBaseUrl ? "inferenceGatewayApiKey" : "inferenceGatewayBaseUrl",
    };
    cachedHealth = health;
    return health;
  }

  let endpoint: string | undefined;
  if (enterprise.inferenceProvider === "gateway" && enterprise.inferenceGatewayBaseUrl) {
    try {
      endpoint = `${new URL(enterprise.inferenceGatewayBaseUrl).origin}/`;
    } catch {
      endpoint = enterprise.inferenceGatewayBaseUrl;
    }
  } else if (enterprise.inferenceGatewayBaseUrl) {
    endpoint = enterprise.inferenceGatewayBaseUrl;
  }

  const base: ConfigHealth = {
    state: "healthy",
    source,
    provider: enterprise.inferenceProvider,
    endpoint,
    checkedAt,
  };

  let probe: ProbeResult;
  try {
    probe = await probeProvider(enterprise);
  } catch (error) {
    const health: ConfigHealth = {
      ...base,
      state: "provider_error",
      message: error instanceof Error ? error.message : String(error),
    };
    cachedHealth = health;
    return health;
  }

  if (probe.ok) {
    cachedHealth = base;
    return base;
  }

  const health: ConfigHealth = {
    ...base,
    state: KIND_TO_STATE[probe.kind],
    message: probe.message,
    httpStatus: probe.httpStatus,
    errorCode: probe.errorCode,
    requestUrl: probe.requestUrl,
    probedModel: probe.probedModel,
    responseBody: probe.responseBody,
  };
  cachedHealth = health;
  return health;
}

/** Official KPe — cached health (may be null before first recompute). */
export function getCachedConfigHealth(): ConfigHealth | null {
  return cachedHealth;
}

/**
 * Official getConfigHealth: return cache if present, else recompute once.
 * Residual KPe returns zJ which may be null until recheck; product eagerly
 * computes so AQt can paint on first /task/new visit.
 */
export async function getConfigHealth(userDataPath?: string): Promise<ConfigHealth> {
  if (cachedHealth) return cachedHealth;
  return recomputeConfigHealth(userDataPath);
}

/** Official KbA — force recompute. */
export async function recheckConfigHealth(userDataPath?: string): Promise<ConfigHealth> {
  return recomputeConfigHealth(userDataPath);
}

/** Clear cache after config write / apply (optional callers). */
export function invalidateConfigHealthCache(): void {
  cachedHealth = null;
}
