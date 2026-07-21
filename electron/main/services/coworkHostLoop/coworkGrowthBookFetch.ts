/**
 * Official main-process GrowthBook network + fcache residual (app.asar c9t / a9t / g9t / ZHe / BbA):
 *
 *   n9t = "/api/desktop/features"
 *   jHe() = userData/fcache
 *   ZJ magic = Buffer([67,76,70,1,0,154,183,226])  // "CLF" + version/header
 *   c9t():
 *     hardcodedMainGrowthBookFeatures()? → success with kni (3p)
 *     else net.fetch(new URL(n9t, mN())) → { features }
 *   g9t(): gzip body after magic; expire after r9t = 1440 min
 *   On fetch success: WHe(features) + a9t write
 *   On cold start fail: fall back to disk cache if not expired
 *
 * Product: 3p default keeps kni via getHardcodedFeatures(). 1p residual uses
 * fetch + fcache when hardcoded is null. Never invent flag values on network failure.
 */

import { gunzipSync, gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import {
  applyCoworkGrowthBookFeatures,
  COWORK_HARDCODED_MAIN_GROWTHBOOK_FEATURES,
  type CoworkGrowthBookFeature,
  getCoworkGrowthBookFeaturesSource,
} from "./coworkGrowthBookFeatures";

/** Official n9t */
export const COWORK_DESKTOP_FEATURES_PATH = "/api/desktop/features";

/** Official ZJ fcache magic header */
export const COWORK_GROWTHBOOK_FCACHE_MAGIC = Buffer.from([
  67, 76, 70, 1, 0, 154, 183, 226,
]);

/** Official r9t — disk cache max age (24h) */
export const COWORK_GROWTHBOOK_FCACHE_MAX_AGE_MS = 1440 * 60 * 1000;

/** Official t9t — success refresh interval (1h) */
export const COWORK_GROWTHBOOK_REFRESH_SUCCESS_MS = 3600 * 1000;

/** Official i9t — network-error refresh interval (5 min) */
export const COWORK_GROWTHBOOK_REFRESH_NETWORK_ERROR_MS = 300 * 1000;

export type CoworkGrowthBookFetchKind =
  | "success"
  | "network-error"
  | "http-error"
  | "parse-error"
  | "hardcoded";

export type CoworkGrowthBookFetchResult =
  | {
      features: Record<string, CoworkGrowthBookFeature>;
      kind: "success" | "hardcoded";
    }
  | { kind: "network-error" | "http-error" | "parse-error"; error?: string };

export type CoworkGrowthBookFetchDeps = {
  /** Official Ii().hardcodedMainGrowthBookFeatures — return kni for 3p, null for 1p. */
  getHardcodedFeatures?: () => Record<string, CoworkGrowthBookFeature> | null;
  /** Official mN() — claude.ai base. */
  getClaudeAiBaseUrl?: () => string;
  getUserDataPath?: () => string;
  /** Inject net.fetch residual. */
  fetchImpl?: (
    url: string,
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  nowMs?: () => number;
  readFileSync?: (filePath: string) => Buffer;
  writeFileSync?: (filePath: string, data: Buffer) => void;
  existsSync?: (filePath: string) => boolean;
  mkdirSync?: (dir: string) => void;
  log?: (message: string, ...args: unknown[]) => void;
};

export function resolveCoworkGrowthBookFcachePath(userDataPath: string): string {
  return path.join(userDataPath, "fcache");
}

export function resolveCoworkDesktopFeaturesUrl(baseUrl: string): string {
  return new URL(COWORK_DESKTOP_FEATURES_PATH, baseUrl).toString();
}

export function encodeCoworkGrowthBookFcache(
  features: Record<string, CoworkGrowthBookFeature>,
  timestampMs: number,
): Buffer {
  const body = gzipSync(
    Buffer.from(JSON.stringify({ timestamp: timestampMs, features }), "utf8"),
  );
  return Buffer.concat([COWORK_GROWTHBOOK_FCACHE_MAGIC, body]);
}

export function decodeCoworkGrowthBookFcache(
  bytes: Buffer,
  nowMs: number,
  maxAgeMs = COWORK_GROWTHBOOK_FCACHE_MAX_AGE_MS,
): Record<string, CoworkGrowthBookFeature> | null {
  if (
    bytes.length <= COWORK_GROWTHBOOK_FCACHE_MAGIC.length
    || !bytes.subarray(0, COWORK_GROWTHBOOK_FCACHE_MAGIC.length).equals(
      COWORK_GROWTHBOOK_FCACHE_MAGIC,
    )
  ) {
    return null;
  }
  try {
    const json = gunzipSync(
      bytes.subarray(COWORK_GROWTHBOOK_FCACHE_MAGIC.length),
    ).toString("utf8");
    const parsed = JSON.parse(json) as {
      features?: Record<string, CoworkGrowthBookFeature>;
      timestamp?: number;
    };
    if (!parsed.features || typeof parsed.timestamp !== "number") return null;
    if (nowMs - parsed.timestamp > maxAgeMs) return null;
    return parsed.features;
  } catch {
    return null;
  }
}

export async function fetchCoworkDesktopFeatures(
  deps: CoworkGrowthBookFetchDeps = {},
): Promise<CoworkGrowthBookFetchResult> {
  // Official: if deployment returns kni object, skip network.
  // Product 3p default: omit getter → kni. Product 1p residual: () => null → network.
  if (deps.getHardcodedFeatures) {
    const explicit = deps.getHardcodedFeatures();
    if (explicit) {
      return { kind: "hardcoded", features: explicit };
    }
    // null/undefined → fall through to network (1p)
  } else {
    return {
      kind: "hardcoded",
      features: COWORK_HARDCODED_MAIN_GROWTHBOOK_FEATURES,
    };
  }

  const baseUrl = deps.getClaudeAiBaseUrl?.() ?? "https://claude.ai";
  const url = resolveCoworkDesktopFeaturesUrl(baseUrl);
  const fetchImpl =
    deps.fetchImpl
    ?? (async (target: string) => {
      const response = await fetch(target);
      return {
        ok: response.ok,
        status: response.status,
        json: () => response.json(),
      };
    });

  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(url);
  } catch (error) {
    deps.log?.("[growthbook] network error: %o", error);
    return {
      kind: "network-error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!response.ok) {
    deps.log?.("[growthbook] API returned status %d", response.status);
    return { kind: "http-error", error: `HTTP ${response.status}` };
  }
  try {
    const body = (await response.json()) as {
      features?: Record<string, CoworkGrowthBookFeature>;
    };
    if (!body.features || typeof body.features !== "object") {
      return { kind: "parse-error", error: "missing features map" };
    }
    return { kind: "success", features: body.features };
  } catch (error) {
    deps.log?.("[growthbook] failed to parse response body: %o", error);
    return {
      kind: "parse-error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeCoworkGrowthBookFcache(
  userDataPath: string,
  features: Record<string, CoworkGrowthBookFeature>,
  deps: CoworkGrowthBookFetchDeps = {},
): void {
  const filePath = resolveCoworkGrowthBookFcachePath(userDataPath);
  const nowMs = deps.nowMs?.() ?? Date.now();
  const encoded = encodeCoworkGrowthBookFcache(features, nowMs);
  const mkdirSync =
    deps.mkdirSync
    ?? ((dir: string) => fs.mkdirSync(dir, { recursive: true }));
  const writeFileSync =
    deps.writeFileSync ?? ((p, data) => fs.writeFileSync(p, data));
  mkdirSync(path.dirname(filePath));
  writeFileSync(filePath, encoded);
}

export function readCoworkGrowthBookFcache(
  userDataPath: string,
  deps: CoworkGrowthBookFetchDeps = {},
): Record<string, CoworkGrowthBookFeature> | null {
  const filePath = resolveCoworkGrowthBookFcachePath(userDataPath);
  const existsSync = deps.existsSync ?? fs.existsSync;
  if (!existsSync(filePath)) return null;
  try {
    const readFileSync = deps.readFileSync ?? ((p) => fs.readFileSync(p));
    const nowMs = deps.nowMs?.() ?? Date.now();
    return decodeCoworkGrowthBookFcache(readFileSync(filePath), nowMs);
  } catch {
    return null;
  }
}

export type InitCoworkGrowthBookResult = {
  applied: boolean;
  kind: CoworkGrowthBookFetchKind | "cache" | "skipped-already-applied";
  source: ReturnType<typeof getCoworkGrowthBookFeaturesSource>;
};

/**
 * Official BbA / ZHe residual — one-shot init for product startup.
 * - 3p / kni: apply hardcoded (already seeded; still reports hardcoded)
 * - 1p success: apply + write fcache
 * - 1p fail: apply fcache if present
 * - 1p cold miss (network fail + no fcache): clear Gu to {} so ft() is false
 *   (official starts Gu={}; never invent kni for 1p)
 */
export async function initCoworkGrowthBookFeatures(
  deps: CoworkGrowthBookFetchDeps = {},
): Promise<InitCoworkGrowthBookResult> {
  const fetched = await fetchCoworkDesktopFeatures(deps);
  if (fetched.kind === "hardcoded") {
    // Already seeded as kni in module init; re-apply for idempotency.
    applyCoworkGrowthBookFeatures(fetched.features);
    return {
      applied: true,
      kind: "hardcoded",
      source: getCoworkGrowthBookFeaturesSource(),
    };
  }
  if (fetched.kind === "success") {
    applyCoworkGrowthBookFeatures(fetched.features);
    const userData = deps.getUserDataPath?.();
    if (userData) {
      try {
        writeCoworkGrowthBookFcache(userData, fetched.features, deps);
      } catch (error) {
        deps.log?.("[growthbook] failed to write disk cache: %o", error);
      }
    }
    return {
      applied: true,
      kind: "success",
      source: getCoworkGrowthBookFeaturesSource(),
    };
  }

  const userData = deps.getUserDataPath?.();
  if (userData) {
    const cached = readCoworkGrowthBookFcache(userData, deps);
    if (cached) {
      applyCoworkGrowthBookFeatures(cached);
      return {
        applied: true,
        kind: "cache",
        source: getCoworkGrowthBookFeaturesSource(),
      };
    }
  }

  // 1p path (getHardcodedFeatures present and returned null): do not keep kni.
  if (deps.getHardcodedFeatures) {
    applyCoworkGrowthBookFeatures({});
  }

  return {
    applied: false,
    kind: fetched.kind,
    source: getCoworkGrowthBookFeaturesSource(),
  };
}
