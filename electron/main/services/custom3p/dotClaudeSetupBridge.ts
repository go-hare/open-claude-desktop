/**
 * Product bridge: when deploymentMode is "dotClaude", Custom3pSetup must surface
 * and edit the *active* source — ~/.claude/settings.json — not the dormant
 * configLibrary bag. Official Setup residual only speaks gateway bag shape
 * (inferenceProvider / inferenceGateway* / inferenceModels); we map both ways.
 *
 * Never invent a second source: login chose ~/.claude → list/read/write that file.
 * configLibrary remains untouched in this mode (still used after switch to 3p).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectDotClaudeCliConfig,
  listDotClaudeModelIdsFromEnv,
} from "./deploymentMode";
import type { Custom3pLibraryList } from "./custom3pConfigLibrary";

/**
 * Stable UUID so official Setup (txe /^[a-f0-9-]{36}$/) accepts the virtual entry.
 * Not a real configLibrary file — only used as the list/read/write id in dotClaude.
 */
export const DOT_CLAUDE_SETUP_CONFIG_ID = "d07c1a4d-e000-4000-8000-0000000000c1";

export const DOT_CLAUDE_SETUP_CONFIG_NAME = "~/.claude";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isDotClaudeSetupConfigId(id: string | null | undefined): boolean {
  return typeof id === "string" && id === DOT_CLAUDE_SETUP_CONFIG_ID;
}

export function defaultDotClaudeSettingsPath(homeDir?: string): string {
  return path.join(homeDir ?? os.homedir(), ".claude", "settings.json");
}

/**
 * Map ~/.claude env → Custom3p Setup gateway bag (form fields).
 */
export function mapDotClaudeEnvToGatewayBag(
  env: Record<string, unknown>,
  options?: { settingsPath?: string },
): Record<string, unknown> {
  const baseUrl = stringField(env.ANTHROPIC_BASE_URL) ?? "";
  const authToken =
    stringField(env.ANTHROPIC_AUTH_TOKEN) ?? stringField(env.ANTHROPIC_API_KEY) ?? "";
  // Prefer AUTH_TOKEN path as bearer; bare API_KEY alone → still bearer for gateway form.
  const authScheme = "bearer";
  const models = listDotClaudeModelIdsFromEnv(env);
  const inferenceModels = models.map((name) => ({ name, supports1m: false }));

  const bag: Record<string, unknown> = {
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: baseUrl,
    inferenceGatewayApiKey: authToken,
    inferenceGatewayAuthScheme: authScheme,
    // Marker so UI/debug can tell this bag is the live CLI file projection.
    __dotClaudeSettingsPath: options?.settingsPath ?? defaultDotClaudeSettingsPath(),
  };
  if (inferenceModels.length > 0) bag.inferenceModels = inferenceModels;
  return bag;
}

/**
 * Merge Setup gateway bag edits into ~/.claude settings.json `env`.
 * Preserves unrelated env keys and top-level settings fields.
 * Does not touch userData/configLibrary.
 */
export function writeGatewayBagIntoDotClaudeSettings(
  bag: unknown,
  settingsPath?: string,
): { ok: true; settingsPath: string } | { ok: false; error: string } {
  const filePath = settingsPath ?? defaultDotClaudeSettingsPath();
  const input = record(bag);
  const baseUrl = stringField(input.inferenceGatewayBaseUrl);
  const apiKey = stringField(input.inferenceGatewayApiKey);
  if (!baseUrl) return { ok: false, error: "Gateway base URL is required" };
  if (!apiKey) return { ok: false, error: "Gateway API key is required" };

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
  env.ANTHROPIC_BASE_URL = baseUrl;
  // Prefer AUTH_TOKEN for third-party gateways (matches typical CLI ~/.claude).
  env.ANTHROPIC_AUTH_TOKEN = apiKey;
  // Keep API_KEY in sync only if it was already the sole key style; otherwise leave/clear?
  // If user had API_KEY only, detectDotClaude accepted it — write both for robustness.
  if (!stringField(env.ANTHROPIC_API_KEY) || stringField(env.ANTHROPIC_API_KEY) === apiKey) {
    // Do not force-delete API_KEY if different secret was present; just set AUTH_TOKEN.
  }

  const modelsRaw = input.inferenceModels;
  const modelNames: string[] = [];
  if (Array.isArray(modelsRaw)) {
    for (const row of modelsRaw) {
      const name = stringField(record(row).name);
      if (name && !modelNames.includes(name)) modelNames.push(name);
    }
  }
  if (modelNames.length > 0) {
    env.ANTHROPIC_MODEL = modelNames[0]!;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = modelNames[0]!;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = modelNames[1] ?? modelNames[0]!;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = modelNames[2] ?? modelNames[1] ?? modelNames[0]!;
  }

  root.env = env;
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
  return {
    appliedId: DOT_CLAUDE_SETUP_CONFIG_ID,
    entries: [
      {
        id: DOT_CLAUDE_SETUP_CONFIG_ID,
        name: DOT_CLAUDE_SETUP_CONFIG_NAME,
        provider: "gateway",
        note,
      },
    ],
    isManaged: false,
    platform: process.platform,
  };
}

export function readDotClaudeAsConfigLibrary(
  homeDir?: string,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  const detected = detectDotClaudeCliConfig(homeDir);
  const settingsPath = detected?.settingsPath ?? defaultDotClaudeSettingsPath(homeDir);
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as unknown;
    const env = record(record(raw).env);
    return {
      ok: true,
      config: mapDotClaudeEnvToGatewayBag(env, { settingsPath }),
    };
  } catch (error) {
    // No file yet — empty gateway form so user can create routing in ~/.claude.
    if (!fs.existsSync(settingsPath)) {
      return {
        ok: true,
        config: mapDotClaudeEnvToGatewayBag({}, { settingsPath }),
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
