/**
 * Official residual (app.asar):
 *
 *   function G4(e) {
 *     const t = Ii(); // deployment mode
 *     return {
 *       CLAUDE_CODE_ENTRYPOINT: t.type === "3p" ? "claude-desktop-3p" : "claude-desktop",
 *       ANTHROPIC_BASE_URL: e.apiHost,
 *       ANTHROPIC_API_KEY: "",
 *       CLAUDE_CODE_OAUTH_TOKEN: e.oauthToken,
 *       ...KGi(), // PROVIDER_MANAGED_BY_HOST + DISABLE_AUTOUPDATER (+ 3p flags)
 *       ...t.sessionEnvVars(),
 *     };
 *   }
 *
 *   HFi(e): process.env → shell env → delete USE_BEDROCK/VERTEX/FOUNDRY
 *           → Object.assign(G4(e)) → resolveCredentialOverrides
 *
 * Gateway provider (class K6t residual):
 *   sessionEnvVars():
 *     ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from apiKey + authScheme
 *     ANTHROPIC_CUSTOM_HEADERS via SPe(headers)  // "k: v" joined by "|"
 *     CLAUDE_CODE_OAUTH_TOKEN: ""
 *   apiHostOverride(): creds.baseUrl  → G4 ANTHROPIC_BASE_URL
 *
 * Official multi-config residual:
 *   userData/configLibrary/_meta.json + {uuid}.json (wrA/bb/RLA)
 * Legacy product shell bag (migrated once when library empty):
 *   userData/desktop-shell-settings.json appliedCustom3pConfigId + custom3pConfigs
 *
 * CLI does not open that JSON itself — main injects env at spawn (HFi/G4).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DOT_CLAUDE_DEPLOYMENT_MODE,
  detectDotClaudeCliConfig,
  normalizePersistedDeploymentMode,
} from "./deploymentMode";
import {
  getAppliedCustom3pConfigLibraryBag,
  migrateLegacyShellCustom3pConfigsToLibrary,
} from "./custom3pConfigLibrary";

export const DESKTOP_SHELL_SETTINGS_FILE = "desktop-shell-settings.json";

export type Custom3pInferenceModel = {
  name: string;
  supports1m?: boolean;
};

export type Custom3pEnterpriseConfig = {
  inferenceProvider?: string;
  inferenceGatewayBaseUrl?: string;
  inferenceGatewayApiKey?: string;
  inferenceGatewayAuthScheme?: string;
  inferenceGatewayHeaders?: Record<string, string>;
  inferenceVertexProjectId?: string;
  inferenceVertexRegion?: string;
  inferenceVertexCredentialsFile?: string;
  inferenceVertexBaseUrl?: string;
  inferenceBedrockRegion?: string;
  inferenceBedrockBearerToken?: string;
  inferenceBedrockBaseUrl?: string;
  inferenceBedrockProfile?: string;
  inferenceBedrockAwsDir?: string;
  inferenceBedrockServiceTier?: string;
  inferenceFoundryResource?: string;
  inferenceFoundryApiKey?: string;
  /** Official SC residual — model picker / probeInference source. */
  inferenceModels?: Custom3pInferenceModel[];
  disableNonessentialTelemetry?: boolean;
  disableEssentialTelemetry?: boolean;
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

function stringMap(value: unknown): Record<string, string> | undefined {
  const raw = record(value);
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

/** Official inferenceModels residual — preserve name + supports1m only. */
function inferenceModelsField(value: unknown): Custom3pInferenceModel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const models: Custom3pInferenceModel[] = [];
  for (const row of value) {
    const bag = record(row);
    const name = stringField(bag.name);
    if (!name) continue;
    const model: Custom3pInferenceModel = { name };
    if (typeof bag.supports1m === "boolean") model.supports1m = bag.supports1m;
    models.push(model);
  }
  return models.length > 0 ? models : undefined;
}

/** Official SPe residual: headers → `"Name: value"` joined by `|`. */
export function serializeAnthropicCustomHeaders(
  headers: Record<string, string> | undefined,
): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("|");
}

/**
 * Normalize enterprise / setup-window bag (official QB keys residual).
 * Returns null when bag has no inferenceProvider (not a 3p credential source).
 */
export function custom3pEnterpriseConfigFromUnknown(
  value: unknown,
): Custom3pEnterpriseConfig | null {
  const root = record(value);
  // Setup window sometimes wraps as { config: { inferenceProvider... } }
  const bag = stringField(root.inferenceProvider) ? root : record(root.config);
  const inferenceProvider = stringField(bag.inferenceProvider);
  if (!inferenceProvider) return null;

  return {
    inferenceProvider,
    inferenceGatewayBaseUrl: stringField(bag.inferenceGatewayBaseUrl),
    inferenceGatewayApiKey: stringField(bag.inferenceGatewayApiKey),
    inferenceGatewayAuthScheme: stringField(bag.inferenceGatewayAuthScheme),
    inferenceGatewayHeaders: stringMap(bag.inferenceGatewayHeaders),
    inferenceVertexProjectId: stringField(bag.inferenceVertexProjectId),
    inferenceVertexRegion: stringField(bag.inferenceVertexRegion),
    inferenceVertexCredentialsFile: stringField(bag.inferenceVertexCredentialsFile),
    inferenceVertexBaseUrl: stringField(bag.inferenceVertexBaseUrl),
    inferenceBedrockRegion: stringField(bag.inferenceBedrockRegion),
    inferenceBedrockBearerToken: stringField(bag.inferenceBedrockBearerToken),
    inferenceBedrockBaseUrl: stringField(bag.inferenceBedrockBaseUrl),
    inferenceBedrockProfile: stringField(bag.inferenceBedrockProfile),
    inferenceBedrockAwsDir: stringField(bag.inferenceBedrockAwsDir),
    inferenceBedrockServiceTier: stringField(bag.inferenceBedrockServiceTier),
    inferenceFoundryResource: stringField(bag.inferenceFoundryResource),
    inferenceFoundryApiKey: stringField(bag.inferenceFoundryApiKey),
    inferenceModels: inferenceModelsField(bag.inferenceModels),
    disableNonessentialTelemetry: booleanField(bag.disableNonessentialTelemetry),
    disableEssentialTelemetry: booleanField(bag.disableEssentialTelemetry),
  };
}

/** Official gateway resolvedAuthScheme residual. */
export function resolveGatewayAuthScheme(
  scheme: string | undefined,
): "bearer" | "x-api-key" {
  return scheme === "x-api-key" ? "x-api-key" : "bearer";
}

/**
 * Official KGi residual (host-managed CLI flags).
 * When deployment is 3p, also disable growthbook / optional telemetry.
 */
export function buildHostManagedCliFlags(
  config: Custom3pEnterpriseConfig,
): Record<string, string> {
  return {
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_GROWTHBOOK: "1",
    DISABLE_FEEDBACK_COMMAND: "1",
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    DISABLE_TELEMETRY: config.disableNonessentialTelemetry ? "1" : "",
    DISABLE_ERROR_REPORTING: config.disableEssentialTelemetry ? "1" : "",
  };
}

/**
 * Official provider sessionEnvVars residual (gateway / vertex / bedrock / foundry).
 * Does not include G4 base fields (entrypoint / BASE_URL).
 */
export function buildCustom3pSessionEnvVars(
  config: Custom3pEnterpriseConfig,
): Record<string, string> {
  switch (config.inferenceProvider) {
    case "gateway": {
      const bearer = resolveGatewayAuthScheme(config.inferenceGatewayAuthScheme) === "bearer";
      const apiKey = config.inferenceGatewayApiKey ?? "";
      return {
        ANTHROPIC_API_KEY: bearer ? "" : apiKey,
        ANTHROPIC_AUTH_TOKEN: bearer ? apiKey : "",
        ANTHROPIC_CUSTOM_HEADERS: serializeAnthropicCustomHeaders(
          config.inferenceGatewayHeaders,
        ),
        CLAUDE_CODE_OAUTH_TOKEN: "",
      };
    }
    case "vertex":
      return {
        CLAUDE_CODE_USE_VERTEX: "1",
        ANTHROPIC_VERTEX_PROJECT_ID: config.inferenceVertexProjectId ?? "",
        GOOGLE_CLOUD_PROJECT: config.inferenceVertexProjectId ?? "",
        CLOUD_ML_REGION: config.inferenceVertexRegion ?? "",
        ANTHROPIC_VERTEX_BASE_URL: config.inferenceVertexBaseUrl ?? "",
        ANTHROPIC_API_KEY: "",
        CLAUDE_CODE_OAUTH_TOKEN: "",
        ...(config.inferenceVertexCredentialsFile
          ? { GOOGLE_APPLICATION_CREDENTIALS: config.inferenceVertexCredentialsFile }
          : {}),
      };
    case "bedrock": {
      const env: Record<string, string> = {
        CLAUDE_CODE_USE_BEDROCK: "1",
        AWS_REGION: config.inferenceBedrockRegion ?? "",
        ANTHROPIC_BEDROCK_BASE_URL: config.inferenceBedrockBaseUrl ?? "",
        ANTHROPIC_BEDROCK_SERVICE_TIER: config.inferenceBedrockServiceTier ?? "",
        ANTHROPIC_API_KEY: "",
        CLAUDE_CODE_OAUTH_TOKEN: "",
      };
      if (config.inferenceBedrockBearerToken) {
        env.AWS_BEARER_TOKEN_BEDROCK = config.inferenceBedrockBearerToken;
      } else {
        env.AWS_BEARER_TOKEN_BEDROCK = "";
        env.AWS_ACCESS_KEY_ID = "";
        env.AWS_SECRET_ACCESS_KEY = "";
        env.AWS_SESSION_TOKEN = "";
        env.AWS_PROFILE = config.inferenceBedrockProfile ?? "";
        if (config.inferenceBedrockAwsDir) {
          env.AWS_CONFIG_FILE = path.join(config.inferenceBedrockAwsDir, "config");
          env.AWS_SHARED_CREDENTIALS_FILE = path.join(
            config.inferenceBedrockAwsDir,
            "credentials",
          );
        }
      }
      return env;
    }
    case "foundry":
      return {
        CLAUDE_CODE_USE_FOUNDRY: "1",
        ANTHROPIC_FOUNDRY_RESOURCE: config.inferenceFoundryResource ?? "",
        ANTHROPIC_FOUNDRY_API_KEY: config.inferenceFoundryApiKey ?? "",
        ANTHROPIC_FOUNDRY_BASE_URL: "",
        ANTHROPIC_API_KEY: "",
        CLAUDE_CODE_OAUTH_TOKEN: "",
      };
    default:
      // Unknown provider: still mark host-managed 3p without inventing credentials.
      return {
        ANTHROPIC_API_KEY: "",
        CLAUDE_CODE_OAUTH_TOKEN: "",
      };
  }
}

/** Official gateway apiHostOverride residual. */
export function resolveCustom3pApiHost(
  config: Custom3pEnterpriseConfig,
): string | undefined {
  switch (config.inferenceProvider) {
    case "gateway":
      return config.inferenceGatewayBaseUrl;
    case "vertex":
      return config.inferenceVertexBaseUrl;
    case "bedrock":
      return config.inferenceBedrockBaseUrl;
    default:
      return undefined;
  }
}

/** Primary model id from applied bag inferenceModels residual. */
export function primaryInferenceModelName(
  config: Custom3pEnterpriseConfig | null | undefined,
): string | undefined {
  return config?.inferenceModels?.find((row) => typeof row.name === "string" && row.name.length > 0)?.name;
}

const ANTHROPIC_MODEL_SHORTNAMES = new Set(["sonnet", "opus", "haiku"]);

/**
 * Resolve `--model` for host CLI spawn against applied userData bag.
 *
 * Official shortnames (sonnet|opus|haiku) resolve via ANTHROPIC_DEFAULT_* env (we pin those to bag).
 * Product rule: never let shell-leaked ids (grok-*, kimi-*, etc.) ride through as --model when a
 * configLibrary bag is applied — drop --model so env pin / bag default wins.
 */
export function resolveCliModelArg(
  requested: string | null | undefined,
  config: Custom3pEnterpriseConfig | null | undefined,
): string | undefined {
  if (!requested || requested === "default" || requested === "opus-4") return undefined;
  if (requested === "sonnet-4") return resolveCliModelArg("sonnet", config);

  const bagNames =
    config?.inferenceModels
      ?.map((row) => row.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0) ?? [];
  const primary = bagNames[0];

  if (bagNames.length > 0) {
    if (bagNames.includes(requested)) return requested;
    // 1M context residual: `${id}[1m]`
    if (bagNames.some((name) => requested === `${name}[1m]`)) return requested;
    // Official shortname identity → pin to bag primary so CLI does not keep a bare "sonnet"
    // that shell DEFAULT_* might still interpret differently than our env overwrite order.
    if (ANTHROPIC_MODEL_SHORTNAMES.has(requested)) return primary;
    // Foreign / shell-leaked model id (e.g. grok-4.5 from ~/.claude or prior init).
    return undefined;
  }

  if (ANTHROPIC_MODEL_SHORTNAMES.has(requested)) return requested;
  return requested;
}

/**
 * Official G4 + sessionEnvVars for desktop 3p spawn.
 * Only returns a bag when inferenceProvider is present (deployment type 3p).
 */
export function buildDesktopCustom3pCliEnv(
  config: Custom3pEnterpriseConfig | null | undefined,
): Record<string, string> | null {
  if (!config?.inferenceProvider) return null;

  const apiHost = resolveCustom3pApiHost(config);
  const env: Record<string, string> = {
    CLAUDE_CODE_ENTRYPOINT: "claude-desktop-3p",
    // Official G4 always writes ANTHROPIC_API_KEY:"" then sessionEnvVars overwrites.
    ANTHROPIC_API_KEY: "",
    CLAUDE_CODE_OAUTH_TOKEN: "",
    CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL: "true",
    MCP_CONNECTION_NONBLOCKING: "true",
    API_TIMEOUT_MS: "900000",
    ...buildHostManagedCliFlags(config),
    ...buildCustom3pSessionEnvVars(config),
  };

  // Do not invent a base URL — only set when enterprise bag has one (gateway residual).
  if (apiHost) env.ANTHROPIC_BASE_URL = apiHost;

  // Official K6t.shortnameIdentityOverrides only writes ANTHROPIC_DEFAULT_{SONNET,HAIKU,OPUS}_MODEL
  // when discovered model id is exactly sonnet|haiku|opus. Product bag models (e.g. deepseek-v4-pro)
  // never match that shortname list, so process-inherited ANTHROPIC_DEFAULT_*_MODEL from the shell
  // (e.g. terminal ~/.claude/settings.json env) would leak into host spawn and win over bag.
  // Project rule: 3p routing keys come from applied configLibrary bag, not process inheritance.
  // Pin default model env to bag inferenceModels[0] when present so "Default model" spawn hits bag.
  const primaryModel = primaryInferenceModelName(config);
  if (primaryModel) {
    env.ANTHROPIC_MODEL = primaryModel;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = primaryModel;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = primaryModel;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = primaryModel;
  }

  // Drop empty optional telemetry flags so we do not force DISABLE_TELEMETRY="".
  for (const key of ["DISABLE_TELEMETRY", "DISABLE_ERROR_REPORTING"] as const) {
    if (env[key] === "") delete env[key];
  }

  return env;
}

export type DesktopShellCustom3pSnapshot = {
  appliedId: string | null;
  config: unknown | null;
  enterprise: Custom3pEnterpriseConfig | null;
};

/**
 * Official wrA residual first: userData/configLibrary applied bag.
 * Falls back to legacy desktop-shell-settings custom3pConfigs and migrates once
 * into configLibrary when the library is empty.
 */
export function readAppliedCustom3pFromDesktopShellSettings(
  userDataPath: string,
): DesktopShellCustom3pSnapshot {
  const empty: DesktopShellCustom3pSnapshot = {
    appliedId: null,
    config: null,
    enterprise: null,
  };

  // Prefer official configLibrary residual.
  try {
    const fromLibrary = getAppliedCustom3pConfigLibraryBag(userDataPath);
    if (fromLibrary.id) {
      return {
        appliedId: fromLibrary.id,
        config: fromLibrary.config,
        enterprise: custom3pEnterpriseConfigFromUnknown(fromLibrary.config),
      };
    }
  } catch {
    // continue to legacy shell bag
  }

  try {
    const filePath = path.join(userDataPath, DESKTOP_SHELL_SETTINGS_FILE);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const appliedId =
      typeof raw.appliedCustom3pConfigId === "string" && raw.appliedCustom3pConfigId.length > 0
        ? raw.appliedCustom3pConfigId
        : null;
    const configs = record(raw.custom3pConfigs);
    // One-shot migrate legacy multi-config into configLibrary (official wrA).
    try {
      migrateLegacyShellCustom3pConfigsToLibrary(userDataPath, {
        appliedCustom3pConfigId: appliedId,
        custom3pConfigs: configs,
      });
      const migrated = getAppliedCustom3pConfigLibraryBag(userDataPath);
      if (migrated.id) {
        return {
          appliedId: migrated.id,
          config: migrated.config,
          enterprise: custom3pEnterpriseConfigFromUnknown(migrated.config),
        };
      }
    } catch {
      // fall through to in-memory legacy read
    }
    const recordBag = appliedId ? record(configs[appliedId]) : {};
    const config = Object.keys(recordBag).length > 0 ? (recordBag.config ?? null) : null;
    return {
      appliedId,
      config,
      enterprise: custom3pEnterpriseConfigFromUnknown(config),
    };
  } catch {
    return empty;
  }
}

const PROVIDER_FLAG_KEYS = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

/** Read persisted chooser mode from desktop-shell-settings (dotClaude passthrough gate). */
function readPersistedDeploymentModeFromUserData(
  userDataPath: string | undefined,
): string | undefined {
  if (!userDataPath) return undefined;
  try {
    const filePath = path.join(userDataPath, DESKTOP_SHELL_SETTINGS_FILE);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const preferences =
      typeof raw.preferences === "object" && raw.preferences !== null
        ? (raw.preferences as Record<string, unknown>)
        : {};
    return normalizePersistedDeploymentMode(preferences.deploymentMode ?? raw.deploymentMode);
  } catch {
    return undefined;
  }
}

/**
 * dotClaude env forwarding: read the user's `~/.claude/settings.json` `env` bag
 * fresh from disk (string values only). Never cached, never written to userData —
 * editing CLI config takes effect on the next spawned session. Returns {} when
 * the file is absent or the CLI config is not usable (stale dotClaude choice).
 */
export function readDotClaudeSettingsEnv(
  injected?: Record<string, string> | null,
): Record<string, string> {
  if (injected !== undefined) return injected ?? {};
  if (!detectDotClaudeCliConfig()) return {};
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".claude", "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    const env = raw.env;
    if (typeof env !== "object" || env === null || Array.isArray(env)) return {};
    return Object.fromEntries(
      Object.entries(env as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Official HFi residual (host spawn env), product simplified:
 *   process.env → local-session-environment → clear provider flags → G4+sessionEnvVars
 *   delete CLAUDECODE
 *
 * custom3p from configLibrary (wrA residual; shell bag legacy fallback) wins over
 * process.env / ~/.claude inheritance for routing keys (BASE_URL / API key / entrypoint).
 *
 * Product dotClaude mode (deploymentMode === "dotClaude"): pass-through — no bag
 * inject AND no ~/.claude suppression. Routing / model / keys resolve inside the
 * CLI from ~/.claude exactly as in the terminal; we only pin the desktop
 * entrypoint + host-managed flags.
 */
export function buildClaudeCliSpawnEnv(options: {
  processEnv?: NodeJS.ProcessEnv;
  localSessionEnv?: Record<string, string>;
  userDataPath?: string;
  /** Test / DI inject; when set, skip disk read. */
  appliedEnterpriseConfig?: Custom3pEnterpriseConfig | null;
  /** Test / DI inject for the persisted chooser mode; when undefined, read from disk. */
  persistedDeploymentMode?: string | null;
  /** Test / DI inject for ~/.claude env forwarding; when undefined, read live from disk. */
  dotClaudeSettingsEnv?: Record<string, string> | null;
  /** When false, skip 3p inject even if disk has applied config. Default true. */
  applyCustom3p?: boolean;
}): NodeJS.ProcessEnv {
  const processEnv = options.processEnv ?? process.env;
  const localSessionEnv = options.localSessionEnv ?? {};
  const env: NodeJS.ProcessEnv = {
    ...processEnv,
    ...localSessionEnv,
  };

  // Official HFi always clears cloud-provider flags before G4.
  for (const key of PROVIDER_FLAG_KEYS) {
    delete env[key];
  }
  delete env.CLAUDECODE;

  const persistedMode =
    options.persistedDeploymentMode !== undefined
      ? (options.persistedDeploymentMode ?? undefined)
      : readPersistedDeploymentModeFromUserData(options.userDataPath);

  if (persistedMode === DOT_CLAUDE_DEPLOYMENT_MODE) {
    // dotClaude pass-through: host-managed flags only, routing stays with ~/.claude.
    // IMPORTANT: the desktop is GUI-launched — process.env does NOT inherit the
    // terminal's ANTHROPIC_*. So "let the CLI read ~/.claude itself" needs help:
    // forward the settings.json env bag (fresh read at every spawn; never
    // persisted into userData) so spawned sessions actually hit the user's
    // CLI gateway. Skills / MCP / agents / other settings still resolve from
    // ~/.claude natively by the CLI — nothing is mirrored.
    env.CLAUDE_CODE_ENTRYPOINT = "claude-desktop-3p";
    Object.assign(env, buildHostManagedCliFlags({}));
    Object.assign(env, readDotClaudeSettingsEnv(options.dotClaudeSettingsEnv));
    for (const key of ["DISABLE_TELEMETRY", "DISABLE_ERROR_REPORTING"] as const) {
      if (env[key] === "") delete env[key];
    }
    return env;
  }

  const applyCustom3p = options.applyCustom3p !== false;
  let enterprise: Custom3pEnterpriseConfig | null | undefined =
    options.appliedEnterpriseConfig;

  if (applyCustom3p && enterprise === undefined && options.userDataPath) {
    enterprise = readAppliedCustom3pFromDesktopShellSettings(options.userDataPath).enterprise;
  }

  const custom3pEnv = applyCustom3p ? buildDesktopCustom3pCliEnv(enterprise ?? null) : null;
  if (custom3pEnv) {
    Object.assign(env, custom3pEnv);
    // Official G4 always writes ANTHROPIC_BASE_URL from e.apiHost. When the applied
    // bag has no baseUrl, do not keep a process-inherited URL as if it came from userData.
    if (!Object.prototype.hasOwnProperty.call(custom3pEnv, "ANTHROPIC_BASE_URL")) {
      delete env.ANTHROPIC_BASE_URL;
    }
    // Host-managed 3p residual: empty credential slots must not fall back to process
    // inheritance after assign (Object.assign keeps prior keys if source omits them —
    // sessionEnvVars always sets these, but strip leftovers for safety).
    if (env.ANTHROPIC_API_KEY === undefined) env.ANTHROPIC_API_KEY = "";
    if (env.CLAUDE_CODE_OAUTH_TOKEN === undefined) env.CLAUDE_CODE_OAUTH_TOKEN = "";
  } else if (!env.CLAUDE_CODE_ENTRYPOINT) {
    // Official non-3p desktop residual is claude-desktop; product local sessions historically used sdk-ts.
    // Keep sdk-ts only when no host 3p bag — matches prior product spawn default.
    env.CLAUDE_CODE_ENTRYPOINT = processEnv.CLAUDE_CODE_ENTRYPOINT ?? "sdk-ts";
  }

  return env;
}
