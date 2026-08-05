/**
 * Official bridge PSS residual (createPreventSystemSleepAssertion / releaseAssertion).
 *
 * asar:
 *   Gle(true) on user turn
 *   id = $_A()?.isReady() ? hkA()?.createPreventSystemSleepAssertion(`bridge_turn:${uuid}`) ?? 0 : 0
 *   releaseTurnBlocks: for id of heldPSS → hkA()?.releaseAssertion(id); if none left Gle(false)
 *
 * Product residual:
 *   1) Prefer native wakeScheduler methods when present (no invent when missing)
 *   2) Else Electron powerSaveBlocker ("prevent-app-suspension") as portable shell
 *      keep-awake for bridge turns (ids still real; never invent success without start)
 *   3) chainActive Gle residual via setBridgeTurnChainActive inject (wake reschedule)
 *
 * data-official-source: app.asar heldPSSAssertions / Gle / hkA createPreventSystemSleepAssertion
 */

import { randomUUID } from "node:crypto";
import { powerSaveBlocker } from "electron";

export type BridgePssNativeApi = {
  isReady?: () => boolean;
  createPreventSystemSleepAssertion?: (reason: string) => number | null | undefined;
  releaseAssertion?: (id: number) => void;
};

export type BridgePssDeps = {
  /** Official $_A/hkA residual handle. */
  getNative?: () => BridgePssNativeApi | null | undefined;
  /** Official Gle(chainActive) residual. */
  setChainActive?: (active: boolean) => void;
  /** Inject for tests. */
  powerSaveStart?: (type: string) => number;
  powerSaveStop?: (id: number) => void;
  powerSaveIsStarted?: (id: number) => boolean;
};

const powerIds = new Set<number>();

let deps: BridgePssDeps = {};

/** Configure PSS residual (product wire + tests). */
export function configureSessionsBridgePss(next: BridgePssDeps): void {
  deps = { ...deps, ...next };
}

export function resetSessionsBridgePssForTests(): void {
  for (const id of powerIds) {
    try {
      deps.powerSaveStop?.(id);
    } catch {
      /* */
    }
  }
  powerIds.clear();
  deps = {};
}

/**
 * Official createPreventSystemSleepAssertion residual for a bridge turn.
 * Returns 0 when not ready / unavailable (official `?? 0`).
 */
export function createBridgeTurnPssAssertion(
  reason = `bridge_turn:${randomUUID()}`,
): number {
  deps.setChainActive?.(true);
  const native = deps.getNative?.();
  if (native?.isReady?.() === true && native.createPreventSystemSleepAssertion) {
    try {
      const id = native.createPreventSystemSleepAssertion(reason);
      if (typeof id === "number" && Number.isFinite(id) && id > 0) return id;
    } catch (err) {
      console.warn(
        `[sessions-bridge:pss] native createPreventSystemSleepAssertion failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Portable residual: powerSaveBlocker when native assertion API absent.
  try {
    const start =
      deps.powerSaveStart ??
      ((type: string) => powerSaveBlocker.start(type as "prevent-app-suspension"));
    const id = start("prevent-app-suspension");
    if (typeof id === "number" && id >= 0) {
      powerIds.add(id);
      return id;
    }
  } catch {
    /* test env without electron */
  }
  return 0;
}

/** Official releaseAssertion residual for one held id. */
export function releaseBridgeTurnPssAssertion(id: number): void {
  if (!id) return;
  const native = deps.getNative?.();
  if (native?.releaseAssertion) {
    try {
      native.releaseAssertion(id);
      return;
    } catch {
      /* fall through */
    }
  }
  if (powerIds.has(id) || true) {
    try {
      const isStarted =
        deps.powerSaveIsStarted ??
        ((x: number) => {
          try {
            return powerSaveBlocker.isStarted(x);
          } catch {
            return false;
          }
        });
      const stop =
        deps.powerSaveStop ??
        ((x: number) => {
          powerSaveBlocker.stop(x);
        });
      if (isStarted(id)) stop(id);
    } catch {
      /* */
    }
    powerIds.delete(id);
  }
}

/**
 * Official releaseTurnBlocks PSS tail: release all held ids; if no sessions still
 * hold PSS, Gle(false).
 */
export function releaseBridgeTurnPssAssertions(
  held: number[],
  anyOtherHeld: () => boolean,
): void {
  for (const id of held) releaseBridgeTurnPssAssertion(id);
  held.length = 0;
  if (!anyOtherHeld()) {
    deps.setChainActive?.(false);
  }
}
