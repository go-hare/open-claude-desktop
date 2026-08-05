/**
 * Official yL residual — inferenceCredentialHelper + TTL cache for spawn.
 *
 * data-official-source: app.asar yL / DPe / pPe
 */
import path from "node:path";
import {
  type CoworkEnterpriseConfigDeps,
  loadCoworkEnterpriseConfig,
} from "../coworkHostLoop/coworkEnterpriseConfig";
import {
  buildCredentialHelperRunResult,
  parseCredentialHelperStdout,
  spawnCredentialHelper,
  type CredentialHelperRunResult,
} from "./credentialHelperResidual";

const DEFAULT_TTL_SEC = 3600;

export type CredentialHelperTokenBag = {
  token: string;
  headers?: Record<string, string>;
  isJson: boolean;
};

type CacheEntry = {
  value: CredentialHelperTokenBag;
  expiresAt: number;
};

let cache: CacheEntry | null = null;
let lastRun: CredentialHelperRunResult | null = null;

export function resetEnterpriseCredentialHelperForTests(): void {
  cache = null;
  lastRun = null;
}

export function getEnterpriseCredentialHelperLastRun(): CredentialHelperRunResult | null {
  return lastRun;
}

export function getEnterpriseCredentialHelperCachedToken(): CredentialHelperTokenBag | null {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  return null;
}

function enterpriseBag(deps: CoworkEnterpriseConfigDeps): Record<string, unknown> {
  return loadCoworkEnterpriseConfig(deps).raw;
}

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

/** Official DPe residual — env for helper spawn. */
export function buildCredentialHelperEnv(
  bag: Record<string, unknown>,
  processEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...processEnv };
  if (typeof bag.inferenceBedrockProfile === "string" && bag.inferenceBedrockProfile) {
    env.AWS_PROFILE = bag.inferenceBedrockProfile;
  }
  if (typeof bag.inferenceBedrockRegion === "string" && bag.inferenceBedrockRegion) {
    env.AWS_REGION = bag.inferenceBedrockRegion;
  }
  if (typeof bag.inferenceBedrockAwsDir === "string" && bag.inferenceBedrockAwsDir) {
    env.AWS_CONFIG_FILE = path.join(bag.inferenceBedrockAwsDir, "config");
    env.AWS_SHARED_CREDENTIALS_FILE = path.join(
      bag.inferenceBedrockAwsDir,
      "credentials",
    );
  }
  return env;
}

export function hasEnterpriseCredentialHelper(
  deps: CoworkEnterpriseConfigDeps = {},
): boolean {
  const helper = enterpriseBag(deps).inferenceCredentialHelper;
  return typeof helper === "string" && helper.trim().length > 0;
}

/**
 * Official yL residual — cached credential helper token bag.
 */
export async function runEnterpriseCredentialHelperWithTtl(
  deps: CoworkEnterpriseConfigDeps = {},
  options: { nowMs?: () => number } = {},
): Promise<CredentialHelperTokenBag | null> {
  const bag = enterpriseBag(deps);
  const helper =
    typeof bag.inferenceCredentialHelper === "string"
      ? bag.inferenceCredentialHelper.trim()
      : "";
  if (!helper) return null;

  const now = options.nowMs?.() ?? Date.now();
  const ttlSec = positiveInt(bag.inferenceCredentialHelperTtlSec, DEFAULT_TTL_SEC);
  if (cache && cache.expiresAt > now) {
    return cache.value;
  }

  const spawn = await spawnCredentialHelper(helper, {
    env: buildCredentialHelperEnv(bag),
    logTag: "custom-3p",
  });
  const parsed =
    spawn.ok && "stdout" in spawn
      ? parseCredentialHelperStdout(spawn.stdout)
      : null;
  lastRun = buildCredentialHelperRunResult(helper, spawn, parsed);

  if (!spawn.ok || !parsed) {
    console.warn(
      `[custom-3p] credential helper failed (reason=${
        spawn.ok ? "parse" : spawn.reason
      })`,
    );
    return null;
  }

  const value: CredentialHelperTokenBag = {
    token: parsed.token,
    headers: parsed.headers,
    isJson: parsed.isJson,
  };
  cache = { value, expiresAt: now + ttlSec * 1000 };
  return value;
}

/**
 * Map helper token into gateway-style spawn env.
 * Official yL: when helper is configured, its result owns key inject.
 * null bag (failed/empty run) clears API key + auth token so static bag keys
 * cannot silently win after a helper failure.
 */
export function credentialHelperTokenToSpawnEnv(
  bag: CredentialHelperTokenBag | null | undefined,
): Record<string, string> {
  if (!bag?.token) {
    return {
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
    };
  }
  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: bag.token,
    ANTHROPIC_AUTH_TOKEN: "",
  };
  if (bag.headers && Object.keys(bag.headers).length > 0) {
    env.ANTHROPIC_CUSTOM_HEADERS = Object.entries(bag.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("|");
  }
  return env;
}
