/**
 * Official residual A6 / QeA token soft-cap (client-side, not server quota):
 *
 *   async function A6(inTok, outTok) {
 *     const t = Ti(), i = t.inferenceMaxTokensPerWindow, r = t.inferenceTokenWindowHours;
 *     if (i === undefined || r === undefined) return;
 *     // accumulate under org-scoped storage key, tumble window by hours
 *   }
 *   async function QeA() {
 *     if both unset → { over:false }
 *     else sum in+out vs max → { over, used, cap, windowHours }
 *   }
 * startSession / sendMessage refuse when QeA().over.
 */

import fs from "node:fs";
import path from "node:path";
import {
  resolveEnterpriseTokenCap,
  type CoworkEnterpriseConfigDeps,
} from "./coworkEnterpriseConfig";

export type CoworkTokenCapCheck =
  | { over: false }
  | { over: true; used: number; cap: number; windowHours: number };

type TokenWindowState = {
  windowStartMs: number;
  inputTokens: number;
  outputTokens: number;
};

const STORAGE_FILE = "enterprise-token-usage.json";

function defaultStoragePath(userDataPath: string | undefined): string | null {
  if (!userDataPath) return null;
  return path.join(userDataPath, STORAGE_FILE);
}

function emptyWindow(nowMs: number): TokenWindowState {
  return { windowStartMs: nowMs, inputTokens: 0, outputTokens: 0 };
}

/** Official AZe residual — reset window when hours elapsed. */
export function tumbleTokenWindow(
  state: TokenWindowState | null | undefined,
  windowHours: number,
  nowMs: number = Date.now(),
): TokenWindowState {
  if (!state || !Number.isFinite(state.windowStartMs)) {
    return emptyWindow(nowMs);
  }
  const windowMs = Math.max(1, windowHours) * 60 * 60 * 1000;
  if (nowMs - state.windowStartMs >= windowMs) {
    return emptyWindow(nowMs);
  }
  return {
    windowStartMs: state.windowStartMs,
    inputTokens: Math.max(0, state.inputTokens | 0),
    outputTokens: Math.max(0, state.outputTokens | 0),
  };
}

function readState(filePath: string | null): TokenWindowState | null {
  if (!filePath) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof raw.windowStartMs !== "number") return null;
    return {
      windowStartMs: raw.windowStartMs,
      inputTokens: typeof raw.inputTokens === "number" ? raw.inputTokens : 0,
      outputTokens: typeof raw.outputTokens === "number" ? raw.outputTokens : 0,
    };
  } catch {
    return null;
  }
}

function writeState(filePath: string | null, state: TokenWindowState): void {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state), "utf8");
  } catch {
    /* best-effort soft cap — never block on storage failure */
  }
}

export type CoworkTokenCapDeps = CoworkEnterpriseConfigDeps & {
  getUserDataPath?: () => string;
  nowMs?: () => number;
  /** Test inject storage path. */
  storagePath?: string | null;
};

/**
 * Official QeA residual — check whether the tumbling window is over cap.
 * Both bag fields required; absent → never over.
 */
export function checkEnterpriseTokenCap(
  deps: CoworkTokenCapDeps = {},
): CoworkTokenCapCheck {
  const cap = resolveEnterpriseTokenCap(deps);
  if (!cap) return { over: false };
  const nowMs = deps.nowMs?.() ?? Date.now();
  const filePath =
    deps.storagePath !== undefined
      ? deps.storagePath
      : defaultStoragePath(deps.getUserDataPath?.());
  const tumbled = tumbleTokenWindow(readState(filePath), cap.windowHours, nowMs);
  const used = tumbled.inputTokens + tumbled.outputTokens;
  if (used < cap.maxTokens) return { over: false };
  return {
    over: true,
    used,
    cap: cap.maxTokens,
    windowHours: cap.windowHours,
  };
}

/** Official A6 residual — accumulate usage after a turn. */
export function accumulateEnterpriseTokenUsage(
  inputTokens: number,
  outputTokens: number,
  deps: CoworkTokenCapDeps = {},
): void {
  const cap = resolveEnterpriseTokenCap(deps);
  if (!cap) return;
  const nowMs = deps.nowMs?.() ?? Date.now();
  const filePath =
    deps.storagePath !== undefined
      ? deps.storagePath
      : defaultStoragePath(deps.getUserDataPath?.());
  const tumbled = tumbleTokenWindow(readState(filePath), cap.windowHours, nowMs);
  writeState(filePath, {
    windowStartMs: tumbled.windowStartMs,
    inputTokens: tumbled.inputTokens + Math.max(0, Math.floor(inputTokens)),
    outputTokens: tumbled.outputTokens + Math.max(0, Math.floor(outputTokens)),
  });
}

/** Official refuse message residual (Cowork startSession / sendMessage). */
export function formatEnterpriseTokenCapError(check: {
  used: number;
  cap: number;
  windowHours: number;
}): string {
  return (
    `Token limit reached (${check.used.toLocaleString()} of ${check.cap.toLocaleString()} ` +
    `in this ${check.windowHours}-hour window). Wait for the window to reset or raise ` +
    `inferenceMaxTokensPerWindow in enterprise config.`
  );
}

/**
 * Throw when over cap — call at Cowork/Code start + send.
 * Error message prefix `custom3p_token_cap_exceeded:` matches official CCD residual.
 */
export function assertEnterpriseTokenCapAllowsTurn(
  deps: CoworkTokenCapDeps = {},
): void {
  const check = checkEnterpriseTokenCap(deps);
  if (!check.over) return;
  const err = new Error(
    `custom3p_token_cap_exceeded:${check.used}:${check.cap}:${check.windowHours}`,
  );
  (err as Error & { tokenCap?: typeof check }).tokenCap = check;
  (err as Error & { userMessage?: string }).userMessage =
    formatEnterpriseTokenCapError(check);
  throw err;
}
