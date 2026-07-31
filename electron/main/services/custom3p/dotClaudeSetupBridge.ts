/**
 * Product bridge: when deploymentMode is "dotClaude", Custom3pSetup must surface
 * and edit the *active* source — ~/.claude/settings.json — not the dormant
 * configLibrary bag.
 *
 * Official Setup residual speaks the full enterprise bag (gateway / bedrock /
 * vertex / foundry + sandbox / connectors / telemetry / limits / egress).
 * Official multi-config main source remains userData/configLibrary; this bridge
 * is a product extension so "login chose ~/.claude → Setup shows/edits that".
 *
 * Mapping layers:
 * 1. CLI-native `settings.json.env` keys (BASE_URL / auth / headers / models /
 *    telemetry / provider flags) — CLI and host spawn both honor these.
 * 2. Product extension bag `claudexDesktopSetup` on the same settings.json —
 *    round-trips Setup-only enterprise fields that have no CLI env residual
 *    (workspace folders, managed MCP, egress allowlist, usage caps, extension
 *    toggles). Never written to configLibrary in this mode.
 *
 * Provider switch UX matches official residual: switching inferenceProvider
 * clears inactive provider fields from the form (and autosave writes the active
 * provider only). We do not invent multi-provider snapshots.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectDotClaudeCliConfig,
  listDotClaudeModelIdsFromEnv,
} from "./deploymentMode";
import type { Custom3pLibraryList } from "./custom3pConfigLibrary";
import { serializeAnthropicCustomHeaders } from "./custom3pCliEnv";

/**
 * Stable UUID so official Setup (txe /^[a-f0-9-]{36}$/) accepts the virtual entry.
 * Not a real configLibrary file — only used as the list/read/write id in dotClaude.
 */
export const DOT_CLAUDE_SETUP_CONFIG_ID = "d07c1a4d-e000-4000-8000-0000000000c1";

export const DOT_CLAUDE_SETUP_CONFIG_NAME = "~/.claude";

/**
 * Product extension key on ~/.claude/settings.json for Setup-only fields.
 * Not an official CLI residual key — intentionally namespaced.
 */
export const DOT_CLAUDE_DESKTOP_SETUP_BAG_KEY = "claudexDesktopSetup";

/** Setup bag fields that live only in the product extension bag (no CLI env). */
export const DOT_CLAUDE_DESKTOP_ONLY_FIELDS = [
  "allowedWorkspaceFolders",
  "requireCoworkFullVmSandbox",
  "secureVmFeaturesEnabled",
  "coworkEgressAllowedHosts",
  "managedMcpServers",
  "isLocalDevMcpEnabled",
  "isDesktopExtensionEnabled",
  "isDesktopExtensionDirectoryEnabled",
  "isDesktopExtensionSignatureRequired",
  "isClaudeCodeForDesktopEnabled",
  "disabledBuiltinTools",
  "disableDeploymentModeChooser",
  "autoUpdaterEnforcementHours",
  "inferenceMaxTokensPerWindow",
  "inferenceTokenWindowHours",
  "otlpEndpoint",
  "otlpProtocol",
  "otlpHeaders",
  "otlpResourceAttributes",
  "disableNonessentialServices",
] as const;

type DesktopOnlyField = (typeof DOT_CLAUDE_DESKTOP_ONLY_FIELDS)[number];

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

function truthyEnv(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function stringMap(value: unknown): Record<string, string> | undefined {
  const raw = record(value);
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

/** Inverse of official SPe / serializeAnthropicCustomHeaders (`Name: value` joined by `|`). */
export function parseAnthropicCustomHeaders(
  value: unknown,
): Record<string, string> | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const part of value.split("|")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key || !val) continue;
    out[key] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function isDotClaudeSetupConfigId(id: string | null | undefined): boolean {
  return typeof id === "string" && id === DOT_CLAUDE_SETUP_CONFIG_ID;
}

export function defaultDotClaudeSettingsPath(homeDir?: string): string {
  return path.join(homeDir ?? os.homedir(), ".claude", "settings.json");
}

function pickDesktopOnlyBag(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of DOT_CLAUDE_DESKTOP_ONLY_FIELDS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function resolveProviderFromEnv(
  env: Record<string, unknown>,
  modelType?: unknown,
): string {
  // Product CLI residual (claude-code providers.ts): modelType wins over cloud flags.
  if (modelType === "openai" || modelType === "gemini" || modelType === "grok") {
    return modelType;
  }
  if (modelType === "anthropic") return "gateway";

  if (truthyEnv(env.CLAUDE_CODE_USE_BEDROCK)) return "bedrock";
  if (truthyEnv(env.CLAUDE_CODE_USE_VERTEX)) return "vertex";
  if (truthyEnv(env.CLAUDE_CODE_USE_FOUNDRY)) return "foundry";
  if (truthyEnv(env.CLAUDE_CODE_USE_OPENAI)) return "openai";
  if (truthyEnv(env.CLAUDE_CODE_USE_GEMINI)) return "gemini";
  if (truthyEnv(env.CLAUDE_CODE_USE_GROK)) return "grok";
  // Heuristic: native OpenAI-compatible env without Anthropic gateway URL.
  if (stringField(env.OPENAI_API_KEY) && stringField(env.OPENAI_BASE_URL) && !stringField(env.ANTHROPIC_BASE_URL)) {
    return "openai";
  }
  if (stringField(env.GEMINI_API_KEY) && !stringField(env.ANTHROPIC_BASE_URL)) return "gemini";
  if ((stringField(env.GROK_API_KEY) || stringField(env.XAI_API_KEY)) && !stringField(env.ANTHROPIC_BASE_URL)) {
    return "grok";
  }
  return "gateway";
}

function resolveAuthSchemeFromEnv(env: Record<string, unknown>): "bearer" | "x-api-key" {
  // Prefer explicit token style; bare API_KEY alone → x-api-key form.
  if (stringField(env.ANTHROPIC_AUTH_TOKEN)) return "bearer";
  if (stringField(env.ANTHROPIC_API_KEY)) return "x-api-key";
  return "bearer";
}

function resolveGatewayApiKeyFromEnv(env: Record<string, unknown>): string {
  return stringField(env.ANTHROPIC_AUTH_TOKEN) ?? stringField(env.ANTHROPIC_API_KEY) ?? "";
}

/**
 * Map ~/.claude settings.json (env + product extension bag) → Custom3p Setup bag.
 * Active provider only (official residual form also shows one provider at a time).
 */
export function mapDotClaudeEnvToGatewayBag(
  env: Record<string, unknown>,
  options?: {
    settingsPath?: string;
    desktopBag?: Record<string, unknown>;
    /** Top-level ~/.claude/settings.json modelType (openai|gemini|grok|anthropic). */
    modelType?: unknown;
  },
): Record<string, unknown> {
  const provider = resolveProviderFromEnv(env, options?.modelType);
  const models = listDotClaudeModelIdsFromEnv(env);
  const inferenceModels = models.map((name) => ({ name, supports1m: false }));
  const desktop = record(options?.desktopBag);

  const bag: Record<string, unknown> = {
    inferenceProvider: provider,
    // Marker so UI/debug can tell this bag is the live CLI file projection.
    __dotClaudeSettingsPath: options?.settingsPath ?? defaultDotClaudeSettingsPath(),
    __dotClaudeProjection: true,
    ...pickDesktopOnlyBag(desktop),
  };

  if (inferenceModels.length > 0) bag.inferenceModels = inferenceModels;

  // Telemetry / updater (CLI env residual).
  if (truthyEnv(env.DISABLE_TELEMETRY)) bag.disableNonessentialTelemetry = true;
  if (truthyEnv(env.DISABLE_ERROR_REPORTING)) bag.disableEssentialTelemetry = true;
  if (truthyEnv(env.DISABLE_AUTOUPDATER)) bag.disableAutoUpdates = true;

  // OTLP — prefer desktop bag, fall back to common OTEL env names if present.
  if (!bag.otlpEndpoint && stringField(env.OTEL_EXPORTER_OTLP_ENDPOINT)) {
    bag.otlpEndpoint = stringField(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  }
  if (!bag.otlpProtocol && stringField(env.OTEL_EXPORTER_OTLP_PROTOCOL)) {
    bag.otlpProtocol = stringField(env.OTEL_EXPORTER_OTLP_PROTOCOL);
  }
  if (!bag.otlpHeaders) {
    const headers = parseAnthropicCustomHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);
    if (headers) bag.otlpHeaders = headers;
  }
  if (!bag.otlpResourceAttributes && stringField(env.OTEL_RESOURCE_ATTRIBUTES)) {
    bag.otlpResourceAttributes = stringField(env.OTEL_RESOURCE_ATTRIBUTES);
  }

  switch (provider) {
    case "bedrock": {
      bag.inferenceBedrockRegion = stringField(env.AWS_REGION) ?? stringField(env.AWS_DEFAULT_REGION) ?? "";
      bag.inferenceBedrockBearerToken = stringField(env.AWS_BEARER_TOKEN_BEDROCK) ?? "";
      bag.inferenceBedrockBaseUrl = stringField(env.ANTHROPIC_BEDROCK_BASE_URL) ?? "";
      bag.inferenceBedrockProfile = stringField(env.AWS_PROFILE) ?? "";
      bag.inferenceBedrockServiceTier = stringField(env.ANTHROPIC_BEDROCK_SERVICE_TIER) ?? "";
      const awsConfig = stringField(env.AWS_CONFIG_FILE);
      if (awsConfig) bag.inferenceBedrockAwsDir = path.dirname(awsConfig);
      break;
    }
    case "vertex": {
      bag.inferenceVertexProjectId =
        stringField(env.ANTHROPIC_VERTEX_PROJECT_ID) ?? stringField(env.GOOGLE_CLOUD_PROJECT) ?? "";
      bag.inferenceVertexRegion = stringField(env.CLOUD_ML_REGION) ?? "";
      bag.inferenceVertexBaseUrl = stringField(env.ANTHROPIC_VERTEX_BASE_URL) ?? "";
      bag.inferenceVertexCredentialsFile = stringField(env.GOOGLE_APPLICATION_CREDENTIALS) ?? "";
      break;
    }
    case "foundry": {
      bag.inferenceFoundryResource = stringField(env.ANTHROPIC_FOUNDRY_RESOURCE) ?? "";
      bag.inferenceFoundryApiKey = stringField(env.ANTHROPIC_FOUNDRY_API_KEY) ?? "";
      break;
    }
    case "openai": {
      bag.inferenceOpenAIBaseUrl = stringField(env.OPENAI_BASE_URL) ?? "";
      bag.inferenceOpenAIApiKey = stringField(env.OPENAI_API_KEY) ?? "";
      break;
    }
    case "gemini": {
      bag.inferenceGeminiBaseUrl = stringField(env.GEMINI_BASE_URL) ?? "";
      bag.inferenceGeminiApiKey = stringField(env.GEMINI_API_KEY) ?? "";
      break;
    }
    case "grok": {
      bag.inferenceGrokBaseUrl = stringField(env.GROK_BASE_URL) ?? "";
      bag.inferenceGrokApiKey =
        stringField(env.GROK_API_KEY) ?? stringField(env.XAI_API_KEY) ?? "";
      break;
    }
    default: {
      bag.inferenceGatewayBaseUrl = stringField(env.ANTHROPIC_BASE_URL) ?? "";
      bag.inferenceGatewayApiKey = resolveGatewayApiKeyFromEnv(env);
      bag.inferenceGatewayAuthScheme = resolveAuthSchemeFromEnv(env);
      const headers = parseAnthropicCustomHeaders(env.ANTHROPIC_CUSTOM_HEADERS);
      if (headers) bag.inferenceGatewayHeaders = headers;
      break;
    }
  }

  return bag;
}

/** @deprecated name kept for tests — full settings projection. */
export const mapDotClaudeSettingsToSetupBag = mapDotClaudeEnvToGatewayBag;

function clearProviderEnv(env: Record<string, unknown>): void {
  for (const key of [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_OPENAI",
    "CLAUDE_CODE_USE_GEMINI",
    "CLAUDE_CODE_USE_GROK",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_PROFILE",
    "AWS_CONFIG_FILE",
    "AWS_SHARED_CREDENTIALS_FILE",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_BEDROCK_SERVICE_TIER",
    "ANTHROPIC_VERTEX_PROJECT_ID",
    "GOOGLE_CLOUD_PROJECT",
    "CLOUD_ML_REGION",
    "ANTHROPIC_VERTEX_BASE_URL",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "ANTHROPIC_FOUNDRY_RESOURCE",
    "ANTHROPIC_FOUNDRY_API_KEY",
    "ANTHROPIC_FOUNDRY_BASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT_ID",
    "GEMINI_API_KEY",
    "GEMINI_BASE_URL",
    "GEMINI_MODEL",
    "GROK_API_KEY",
    "XAI_API_KEY",
    "GROK_BASE_URL",
    "GROK_MODEL",
  ]) {
    delete env[key];
  }
}

function setEnvFlag(env: Record<string, unknown>, key: string, enabled: boolean | undefined): void {
  if (enabled === true) env[key] = "1";
  else if (enabled === false) delete env[key];
}

function writeModelsIntoEnv(env: Record<string, unknown>, modelsRaw: unknown): void {
  const modelNames: string[] = [];
  if (Array.isArray(modelsRaw)) {
    for (const row of modelsRaw) {
      const name = stringField(record(row).name);
      if (name && !modelNames.includes(name)) modelNames.push(name);
    }
  }
  if (modelNames.length === 0) return;
  env.ANTHROPIC_MODEL = modelNames[0]!;
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = modelNames[0]!;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = modelNames[1] ?? modelNames[0]!;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = modelNames[2] ?? modelNames[1] ?? modelNames[0]!;
}

function writeGatewayProviderEnv(
  env: Record<string, unknown>,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const baseUrl = stringField(input.inferenceGatewayBaseUrl);
  const apiKey = stringField(input.inferenceGatewayApiKey);
  if (!baseUrl) return { ok: false, error: "Gateway base URL is required" };
  if (!apiKey) return { ok: false, error: "Gateway API key is required" };

  clearProviderEnv(env);
  env.ANTHROPIC_BASE_URL = baseUrl;

  const scheme =
    stringField(input.inferenceGatewayAuthScheme) === "x-api-key" ? "x-api-key" : "bearer";
  if (scheme === "x-api-key") {
    env.ANTHROPIC_API_KEY = apiKey;
    delete env.ANTHROPIC_AUTH_TOKEN;
  } else {
    env.ANTHROPIC_AUTH_TOKEN = apiKey;
    // Keep a stale different API_KEY from leaking as dual auth; clear when we own the secret.
    if (!stringField(env.ANTHROPIC_API_KEY) || stringField(env.ANTHROPIC_API_KEY) === apiKey) {
      delete env.ANTHROPIC_API_KEY;
    }
  }

  const headers = stringMap(input.inferenceGatewayHeaders);
  if (headers) {
    env.ANTHROPIC_CUSTOM_HEADERS = serializeAnthropicCustomHeaders(headers);
  } else if (input.inferenceGatewayHeaders !== undefined) {
    // Explicit empty object / clear from Setup.
    delete env.ANTHROPIC_CUSTOM_HEADERS;
  }

  return { ok: true };
}

function writeBedrockProviderEnv(
  env: Record<string, unknown>,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const region = stringField(input.inferenceBedrockRegion);
  if (!region) return { ok: false, error: "AWS region is required" };
  clearProviderEnv(env);
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_USE_BEDROCK = "1";
  env.AWS_REGION = region;
  const token = stringField(input.inferenceBedrockBearerToken);
  if (token) env.AWS_BEARER_TOKEN_BEDROCK = token;
  const baseUrl = stringField(input.inferenceBedrockBaseUrl);
  if (baseUrl) env.ANTHROPIC_BEDROCK_BASE_URL = baseUrl;
  const profile = stringField(input.inferenceBedrockProfile);
  if (profile) env.AWS_PROFILE = profile;
  const awsDir = stringField(input.inferenceBedrockAwsDir);
  if (awsDir) {
    env.AWS_CONFIG_FILE = path.join(awsDir, "config");
    env.AWS_SHARED_CREDENTIALS_FILE = path.join(awsDir, "credentials");
  }
  const tier = stringField(input.inferenceBedrockServiceTier);
  if (tier) env.ANTHROPIC_BEDROCK_SERVICE_TIER = tier;
  return { ok: true };
}

function writeVertexProviderEnv(
  env: Record<string, unknown>,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const projectId = stringField(input.inferenceVertexProjectId);
  if (!projectId) return { ok: false, error: "GCP project ID is required" };
  clearProviderEnv(env);
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_USE_VERTEX = "1";
  env.ANTHROPIC_VERTEX_PROJECT_ID = projectId;
  env.GOOGLE_CLOUD_PROJECT = projectId;
  const region = stringField(input.inferenceVertexRegion);
  if (region) env.CLOUD_ML_REGION = region;
  const baseUrl = stringField(input.inferenceVertexBaseUrl);
  if (baseUrl) env.ANTHROPIC_VERTEX_BASE_URL = baseUrl;
  const creds = stringField(input.inferenceVertexCredentialsFile);
  if (creds) env.GOOGLE_APPLICATION_CREDENTIALS = creds;
  return { ok: true };
}

function writeFoundryProviderEnv(
  env: Record<string, unknown>,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const resource = stringField(input.inferenceFoundryResource);
  const apiKey = stringField(input.inferenceFoundryApiKey);
  if (!resource) return { ok: false, error: "Azure AI Foundry resource name is required" };
  if (!apiKey) return { ok: false, error: "Azure AI Foundry API key is required" };
  clearProviderEnv(env);
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_USE_FOUNDRY = "1";
  env.ANTHROPIC_FOUNDRY_RESOURCE = resource;
  env.ANTHROPIC_FOUNDRY_API_KEY = apiKey;
  return { ok: true };
}

/**
 * Product multi-vendor residual (claude-code modelType):
 * openai / gemini / grok use native SDK clients — not Anthropic gateway.
 * Persist credentials in settings.env and set top-level modelType on write.
 */
function writeOpenAIProviderEnv(
  env: Record<string, unknown>,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const baseUrl = stringField(input.inferenceOpenAIBaseUrl);
  const apiKey = stringField(input.inferenceOpenAIApiKey);
  if (!baseUrl) return { ok: false, error: "OpenAI base URL is required" };
  if (!apiKey) return { ok: false, error: "OpenAI API key is required" };
  clearProviderEnv(env);
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  env.OPENAI_BASE_URL = baseUrl;
  env.OPENAI_API_KEY = apiKey;
  // Optional flag some forks still check; modelType is authoritative.
  env.CLAUDE_CODE_USE_OPENAI = "1";
  return { ok: true };
}

function writeGeminiProviderEnv(
  env: Record<string, unknown>,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const apiKey = stringField(input.inferenceGeminiApiKey);
  if (!apiKey) return { ok: false, error: "Gemini API key is required" };
  clearProviderEnv(env);
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  env.GEMINI_API_KEY = apiKey;
  const baseUrl = stringField(input.inferenceGeminiBaseUrl);
  if (baseUrl) env.GEMINI_BASE_URL = baseUrl;
  env.CLAUDE_CODE_USE_GEMINI = "1";
  return { ok: true };
}

function writeGrokProviderEnv(
  env: Record<string, unknown>,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const apiKey = stringField(input.inferenceGrokApiKey);
  if (!apiKey) return { ok: false, error: "Grok API key is required" };
  clearProviderEnv(env);
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  env.GROK_API_KEY = apiKey;
  const baseUrl = stringField(input.inferenceGrokBaseUrl);
  if (baseUrl) env.GROK_BASE_URL = baseUrl;
  env.CLAUDE_CODE_USE_GROK = "1";
  return { ok: true };
}

function modelTypeForProvider(provider: string): string | undefined {
  if (provider === "openai" || provider === "gemini" || provider === "grok") return provider;
  if (provider === "gateway") return "anthropic";
  // bedrock/vertex/foundry are env-only in CLI /provider — leave modelType unset.
  return undefined;
}

function writeTelemetryAndOtlpEnv(
  env: Record<string, unknown>,
  input: Record<string, unknown>,
): void {
  setEnvFlag(env, "DISABLE_TELEMETRY", booleanField(input.disableNonessentialTelemetry));
  setEnvFlag(env, "DISABLE_ERROR_REPORTING", booleanField(input.disableEssentialTelemetry));
  setEnvFlag(env, "DISABLE_AUTOUPDATER", booleanField(input.disableAutoUpdates));

  const otlpEndpoint = stringField(input.otlpEndpoint);
  if (otlpEndpoint) env.OTEL_EXPORTER_OTLP_ENDPOINT = otlpEndpoint;
  else if (input.otlpEndpoint !== undefined) delete env.OTEL_EXPORTER_OTLP_ENDPOINT;

  const otlpProtocol = stringField(input.otlpProtocol);
  if (otlpProtocol) env.OTEL_EXPORTER_OTLP_PROTOCOL = otlpProtocol;
  else if (input.otlpProtocol !== undefined) delete env.OTEL_EXPORTER_OTLP_PROTOCOL;

  const otlpHeaders = stringMap(input.otlpHeaders);
  if (otlpHeaders) {
    env.OTEL_EXPORTER_OTLP_HEADERS = serializeAnthropicCustomHeaders(otlpHeaders);
  } else if (input.otlpHeaders !== undefined) {
    delete env.OTEL_EXPORTER_OTLP_HEADERS;
  }

  const otlpResource = stringField(input.otlpResourceAttributes);
  if (otlpResource) env.OTEL_RESOURCE_ATTRIBUTES = otlpResource;
  else if (input.otlpResourceAttributes !== undefined) delete env.OTEL_RESOURCE_ATTRIBUTES;
}

/**
 * Merge Setup bag edits into ~/.claude settings.json.
 * - Connection / telemetry / models → `env`
 * - Setup-only enterprise fields → `claudexDesktopSetup`
 * Preserves unrelated env keys and top-level settings fields.
 * Does not touch userData/configLibrary.
 *
 * Active provider only — matching official residual autosave after provider switch.
 */
export function writeGatewayBagIntoDotClaudeSettings(
  bag: unknown,
  settingsPath?: string,
): { ok: true; settingsPath: string } | { ok: false; error: string } {
  const filePath = settingsPath ?? defaultDotClaudeSettingsPath();
  const input = record(bag);
  const provider = stringField(input.inferenceProvider) ?? "gateway";

  let root: Record<string, unknown> = {};
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      root = record(parsed);
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const env = { ...record(root.env) };
  let providerWrite: { ok: true } | { ok: false; error: string };
  switch (provider) {
    case "bedrock":
      providerWrite = writeBedrockProviderEnv(env, input);
      break;
    case "vertex":
      providerWrite = writeVertexProviderEnv(env, input);
      break;
    case "foundry":
      providerWrite = writeFoundryProviderEnv(env, input);
      break;
    case "openai":
      providerWrite = writeOpenAIProviderEnv(env, input);
      break;
    case "gemini":
      providerWrite = writeGeminiProviderEnv(env, input);
      break;
    case "grok":
      providerWrite = writeGrokProviderEnv(env, input);
      break;
    default:
      providerWrite = writeGatewayProviderEnv(env, input);
      break;
  }
  if (!providerWrite.ok) return providerWrite;

  writeModelsIntoEnv(env, input.inferenceModels);
  writeTelemetryAndOtlpEnv(env, input);

  root.env = env;

  // CLI residual: modelType distinguishes openai/gemini/grok from Anthropic gateway.
  const nextModelType = modelTypeForProvider(provider);
  if (nextModelType) root.modelType = nextModelType;
  else delete root.modelType;

  // Product extension bag: persist Setup-only fields for round-trip.
  const previousDesktop = record(root[DOT_CLAUDE_DESKTOP_SETUP_BAG_KEY]);
  const nextDesktop = { ...previousDesktop, ...pickDesktopOnlyBag(input) };
  // Drop undefined-ish holes so JSON stays clean.
  for (const key of Object.keys(nextDesktop) as DesktopOnlyField[]) {
    if (nextDesktop[key] === undefined) delete nextDesktop[key];
  }
  if (Object.keys(nextDesktop).length > 0) {
    root[DOT_CLAUDE_DESKTOP_SETUP_BAG_KEY] = nextDesktop;
  } else {
    delete root[DOT_CLAUDE_DESKTOP_SETUP_BAG_KEY];
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(root, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, filePath);
    return { ok: true, settingsPath: filePath };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function listDotClaudeAsConfigLibrary(homeDir?: string): Custom3pLibraryList {
  const detected = detectDotClaudeCliConfig(homeDir);
  const settingsPath = detected?.settingsPath ?? defaultDotClaudeSettingsPath(homeDir);
  const note = detected?.baseUrl ?? settingsPath;
  let provider = "gateway";
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as unknown;
    const root = record(raw);
    provider = resolveProviderFromEnv(record(root.env), root.modelType);
  } catch {
    // missing / unreadable — default gateway list entry
  }
  return {
    appliedId: DOT_CLAUDE_SETUP_CONFIG_ID,
    entries: [
      {
        id: DOT_CLAUDE_SETUP_CONFIG_ID,
        name: DOT_CLAUDE_SETUP_CONFIG_NAME,
        provider,
        note,
      },
    ],
    isManaged: false,
    platform: process.platform,
  };
}

function readSettingsRoot(
  settingsPath: string,
): { ok: true; root: Record<string, unknown> } | { ok: false; error: string; missing: boolean } {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as unknown;
    return { ok: true, root: record(raw) };
  } catch (error) {
    if (!fs.existsSync(settingsPath)) {
      return { ok: false, error: "missing", missing: true };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      missing: false,
    };
  }
}

export function readDotClaudeAsConfigLibrary(
  homeDir?: string,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  const detected = detectDotClaudeCliConfig(homeDir);
  const settingsPath = detected?.settingsPath ?? defaultDotClaudeSettingsPath(homeDir);
  const loaded = readSettingsRoot(settingsPath);
  if (!loaded.ok) {
    if (loaded.missing) {
      return {
        ok: true,
        config: mapDotClaudeEnvToGatewayBag({}, { settingsPath }),
      };
    }
    return { ok: false, error: loaded.error };
  }
  const env = record(loaded.root.env);
  const desktopBag = record(loaded.root[DOT_CLAUDE_DESKTOP_SETUP_BAG_KEY]);
  return {
    ok: true,
    config: mapDotClaudeEnvToGatewayBag(env, {
      settingsPath,
      desktopBag,
      modelType: loaded.root.modelType,
    }),
  };
}

export function writeDotClaudeAsConfigLibrary(
  config: unknown,
  homeDir?: string,
): { ok: true } | { ok: false; error: string } {
  const detected = detectDotClaudeCliConfig(homeDir);
  const settingsPath = detected?.settingsPath ?? defaultDotClaudeSettingsPath(homeDir);
  const result = writeGatewayBagIntoDotClaudeSettings(config, settingsPath);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export function revealDotClaudeSettingsPath(homeDir?: string): string | null {
  const detected = detectDotClaudeCliConfig(homeDir);
  const settingsPath = detected?.settingsPath ?? defaultDotClaudeSettingsPath(homeDir);
  if (fs.existsSync(settingsPath)) return settingsPath;
  const dir = path.dirname(settingsPath);
  return fs.existsSync(dir) ? dir : null;
}
