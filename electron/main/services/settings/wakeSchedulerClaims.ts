/**
 * Official wake-scheduler claim + woA residual (app.asar LZe / Evi / woA / Gle / j_A).
 *
 * asar:
 *   hHA = Map claimId → { id, nextWakeAt(): Date|null }
 *   LZe(claim) / Evi(id) register/unregister
 *   W_A(): minLeadTimeMs default 90_000, chainIntervalMs default 50_000
 *   woA(controller, now): min future claim > now+minLead → scheduleWake(epoch)
 *     scheduleWake return 0 → success (uh={epochMs}); else IOReturn warn
 *   Gle(active): Iv=active; false→true? no; true→false → woA when ready + gated
 *   j_A EventEmitter "darkwake" for bridge system_resumed residual
 *
 * Product: claim-min scheduleWake chain without inventing daemon success.
 * pU gate (feature 2893011886) injectable; default allow when not wired.
 *
 * data-official-source: app.asar woA / LZe / Evi / Gle / W_A / j_A
 */

import { EventEmitter } from "node:events";
import {
  getActiveWakeSchedulerController,
  getWakeSchedulerNativeApi,
  scheduleWake,
  WAKE_SCHEDULER_NO_API_ERROR,
  type WakeSchedulerController,
} from "./wakeScheduler";

const LOG = "[wake-scheduler]";

/** Official W_A defaults (GrowthBook 2893011886 overrides optional). */
export const WAKE_SCHEDULER_MIN_LEAD_MS = 90_000;
export const WAKE_SCHEDULER_CHAIN_INTERVAL_MS = 50_000;

/** Official bridge-poll claim intervals (GrowthBook residual defaults). */
export const WAKE_SCHEDULER_BRIDGE_POLL_AC_MS = 5 * 60_000;
export const WAKE_SCHEDULER_BRIDGE_POLL_BATTERY_MS = 15 * 60_000;

export type WakeSchedulerClaim = {
  id: string;
  nextWakeAt: () => Date | null;
};

export type WakeSchedulerClaimsConfig = {
  /** Official pU residual — feature gate for scheduling. */
  isFeatureEnabled?: () => boolean;
  /** Official W_A residual overrides. */
  minLeadTimeMs?: number;
  chainIntervalMs?: number;
  /** Inject scheduleWake for tests. */
  scheduleWakeFn?: (when: number) => Promise<number> | number;
  /** Inject controller readiness. */
  getController?: () => WakeSchedulerController | null;
  /** Inject isReady. */
  isReady?: () => boolean;
  now?: () => number;
  log?: {
    info?: (...a: unknown[]) => void;
    warn?: (...a: unknown[]) => void;
    debug?: (...a: unknown[]) => void;
  };
};

const claims = new Map<string, WakeSchedulerClaim>();
/** Official j_A residual — darkwake emitter for bridge resume. */
export const wakeSchedulerEvents = new EventEmitter();
/** Official Iv residual. */
let chainActive = false;
/** Official uh residual — last successful schedule epoch. */
let lastScheduled: { epochMs: number } | null = null;
let config: WakeSchedulerClaimsConfig = {};

export function configureWakeSchedulerClaims(
  next: WakeSchedulerClaimsConfig,
): void {
  config = { ...config, ...next };
}

export function resetWakeSchedulerClaimsForTests(): void {
  claims.clear();
  chainActive = false;
  lastScheduled = null;
  config = {};
  wakeSchedulerEvents.removeAllListeners();
}

/** Official LZe residual. */
export function registerWakeSchedulerClaim(claim: WakeSchedulerClaim): void {
  claims.set(claim.id, claim);
  (config.log?.info ?? console.info)(
    `${LOG} registered claim id=${claim.id}`,
  );
}

/** Official Evi residual. */
export function unregisterWakeSchedulerClaim(id: string): void {
  claims.delete(id);
}

export function listWakeSchedulerClaimIds(): string[] {
  return [...claims.keys()];
}

export function isWakeChainActive(): boolean {
  return chainActive;
}

export function getLastScheduledWakeEpoch(): number | null {
  return lastScheduled?.epochMs ?? null;
}

function minLeadMs(): number {
  return config.minLeadTimeMs ?? WAKE_SCHEDULER_MIN_LEAD_MS;
}

function isGatedOn(): boolean {
  return config.isFeatureEnabled?.() !== false;
}

function controllerReady(): boolean {
  if (config.isReady) return config.isReady() === true;
  const c =
    config.getController?.() ?? getActiveWakeSchedulerController();
  return c?.isReady() === true;
}

/**
 * Official woA residual — schedule earliest valid claim after min lead.
 * Never invents success: native scheduleWake must return 0.
 */
export async function rescheduleWakeFromClaims(
  nowMs?: number,
): Promise<{ scheduledEpochMs: number | null; claimCount: number }> {
  if (!isGatedOn()) {
    (config.log?.debug ?? console.debug)(
      `${LOG} gated off, skipping schedule`,
    );
    return { scheduledEpochMs: null, claimCount: 0 };
  }
  if (!controllerReady()) {
    (config.log?.debug ?? console.debug)(
      `${LOG} controller not ready, skipping schedule`,
    );
    return { scheduledEpochMs: null, claimCount: 0 };
  }

  const now = nowMs ?? config.now?.() ?? Date.now();
  const threshold = now + minLeadMs();
  const candidates: number[] = [];
  for (const claim of claims.values()) {
    try {
      const d = claim.nextWakeAt();
      if (d !== null && d.getTime() > threshold) {
        candidates.push(d.getTime());
      }
    } catch (err) {
      (config.log?.warn ?? console.warn)(
        `${LOG} claim ${claim.id} threw:`,
        err,
      );
    }
  }
  if (candidates.length === 0) {
    lastScheduled = null;
    (config.log?.info ?? console.info)(
      `${LOG} no valid claims → not scheduling`,
    );
    return { scheduledEpochMs: null, claimCount: 0 };
  }

  const epoch = Math.min(...candidates);
  lastScheduled = null;
  try {
    const schedule =
      config.scheduleWakeFn ??
      ((when: number) => scheduleWake(when));
    const result = await schedule(epoch);
    // Official: n===0 success; else IOReturn
    if (result === 0) {
      lastScheduled = { epochMs: epoch };
      (config.log?.info ?? console.info)(
        `${LOG} scheduled wake at ${new Date(epoch).toISOString()} (+${Math.round(
          (epoch - now) / 1000,
        )}s, claims=${candidates.length})`,
      );
      return { scheduledEpochMs: epoch, claimCount: candidates.length };
    }
    const code =
      typeof result === "number"
        ? (result >>> 0).toString(16)
        : String(result);
    (config.log?.warn ?? console.warn)(
      `${LOG} scheduleWake returned 0x${code}`,
    );
    return { scheduledEpochMs: null, claimCount: candidates.length };
  } catch (err) {
    (config.log?.warn ?? console.warn)(
      `${LOG} scheduleWake rejected:`,
      err,
    );
    return { scheduledEpochMs: null, claimCount: candidates.length };
  }
}

/**
 * Official Gle residual.
 * chainActive true→false: reschedule at normal cadence when ready.
 */
export function setWakeChainActive(active: boolean): void {
  const was = chainActive;
  chainActive = active;
  if (was && !active) {
    if (!controllerReady() || !isGatedOn()) return;
    void rescheduleWakeFromClaims().then(() => {
      (config.log?.info ?? console.info)(
        `${LOG} chainActive→false, rescheduled at normal cadence`,
      );
    });
  }
}

/**
 * Official j_A.emit("darkwake") residual — bridge system_resumed listener.
 * Does not invent dark-wake detection; callers (powerMonitor / Bvi) emit.
 */
export function emitWakeSchedulerDarkWake(): void {
  wakeSchedulerEvents.emit("darkwake");
}

/**
 * Official bridge-poll claim factory residual.
 * nextWakeAt: AC 5min / battery 15min defaults (GrowthBook overridable later).
 */
export function createBridgePollWakeClaim(options: {
  isDisposed: () => boolean;
  isOnBatteryPower?: () => boolean;
  acIntervalMs?: number;
  batteryIntervalMs?: number;
}): WakeSchedulerClaim {
  return {
    id: "bridge-poll",
    nextWakeAt: () => {
      if (options.isDisposed()) return null;
      const onBattery =
        options.isOnBatteryPower?.() === true;
      const interval = onBattery
        ? (options.batteryIntervalMs ?? WAKE_SCHEDULER_BRIDGE_POLL_BATTERY_MS)
        : (options.acIntervalMs ?? WAKE_SCHEDULER_BRIDGE_POLL_AC_MS);
      return new Date(Date.now() + interval);
    },
  };
}

/** Test helper — whether native api exists (honesty). */
export function hasWakeSchedulerNativeForClaims(): boolean {
  return Boolean(
    getWakeSchedulerNativeApi()?.scheduleWake ||
      getActiveWakeSchedulerController(),
  );
}

export { WAKE_SCHEDULER_NO_API_ERROR };
