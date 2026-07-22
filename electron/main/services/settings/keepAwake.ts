/**
 * Desktop keep-awake for official AppPreferences.keepAwakeEnabled (hYt).
 *
 * Official multi-claim residual (index.js):
 *   const ceA = new Set;
 *   let Ev = null;
 *   function UZe(e) { // claim
 *     const A = ceA.size === 0;
 *     ceA.add(e);
 *     A && (Ev = powerSaveBlocker.start("prevent-app-suspension"), ...);
 *   }
 *   function z5(e) { // release
 *     ceA.delete(e) && ceA.size === 0 && Ev !== null &&
 *       (powerSaveBlocker.stop(Ev), Ev = null);
 *   }
 *   const Lle = "keepAwakeEnabled";
 *   function ble() { gi("keepAwakeEnabled") === true ? UZe(Lle) : z5(Lle); }
 *   function hvi() { Rh.on("keepAwakeEnabled", ble); ble(); }
 *
 * Product residual: same claim Set; preference claim key "keepAwakeEnabled".
 * Wake-scheduler claim "wake_scheduler_approval_pending" can use claim/release
 * without inventing scheduler logic.
 */
import { powerSaveBlocker } from "electron";

/** Official Lle preference claim id. */
export const KEEP_AWAKE_PREFERENCE_CLAIM = "keepAwakeEnabled";

/** Official FW wake-scheduler approval claim id (for future residual). */
export const KEEP_AWAKE_WAKE_SCHEDULER_CLAIM = "wake_scheduler_approval_pending";

const claims = new Set<string>();
let blockerId: number | null = null;

export function getKeepAwakeClaimsForTests(): ReadonlySet<string> {
  return claims;
}

export function resetKeepAwakeForTests(): void {
  if (blockerId !== null) {
    try {
      if (powerSaveBlocker.isStarted(blockerId)) {
        powerSaveBlocker.stop(blockerId);
      }
    } catch {
      /* test env without electron powerSaveBlocker */
    }
  }
  claims.clear();
  blockerId = null;
}

export function isKeepAwakeActive(): boolean {
  return (
    claims.size > 0
    && blockerId !== null
    && (() => {
      try {
        return powerSaveBlocker.isStarted(blockerId);
      } catch {
        return blockerId !== null;
      }
    })()
  );
}

/** Official UZe — add claim; start blocker on first claim. */
export function claimKeepAwake(claim: string): void {
  const first = claims.size === 0;
  claims.add(claim);
  if (!first) return;
  try {
    blockerId = powerSaveBlocker.start("prevent-app-suspension");
  } catch {
    // Unit tests may run without a real Electron powerSaveBlocker.
    blockerId = -1;
  }
}

/** Official z5 — drop claim; stop blocker when last claim released. */
export function releaseKeepAwake(claim: string): void {
  if (!claims.delete(claim)) return;
  if (claims.size !== 0) return;
  if (blockerId !== null) {
    try {
      if (blockerId >= 0 && powerSaveBlocker.isStarted(blockerId)) {
        powerSaveBlocker.stop(blockerId);
      }
    } catch {
      /* ignore */
    }
  }
  blockerId = null;
}

/**
 * Preference path residual (ble for keepAwakeEnabled):
 * enabled true → claim preference; false → release preference only.
 * Other claims (wake scheduler) remain until released.
 */
export function applyKeepAwakeEnabled(enabled: boolean): boolean {
  if (enabled) {
    claimKeepAwake(KEEP_AWAKE_PREFERENCE_CLAIM);
  } else {
    releaseKeepAwake(KEEP_AWAKE_PREFERENCE_CLAIM);
  }
  return true;
}

/** Official ble/hvi boot residual: sync preference claim from bag. */
export function syncKeepAwakeFromPreferences(
  preferences: Record<string, unknown>,
): void {
  applyKeepAwakeEnabled(preferences.keepAwakeEnabled === true);
}
