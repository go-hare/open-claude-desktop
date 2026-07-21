/**
 * Official GrowthBook lifecycle residual (app.asar BbA / R0A / I9t / y7):
 *
 *   R0A(): schedule next y7() in t9t (1h) or i9t (5min) on network-error
 *   I9t(): wait in-flight, then ZHe() on account change
 *   BbA(): first init + R0A() + id(() => I9t().finally(R0A))
 *
 * Product: pure scheduler around initCoworkGrowthBookFeatures.
 * 3p kni still short-circuits network inside fetch; timer remains honest no-op network.
 */

import {
  COWORK_GROWTHBOOK_REFRESH_NETWORK_ERROR_MS,
  COWORK_GROWTHBOOK_REFRESH_SUCCESS_MS,
  initCoworkGrowthBookFeatures,
  type CoworkGrowthBookFetchDeps,
  type InitCoworkGrowthBookResult,
} from "./coworkGrowthBookFetch";

export type CoworkGrowthBookLifecycleDeps = CoworkGrowthBookFetchDeps & {
  /** Injectable timers for tests. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  onRefresh?: (result: InitCoworkGrowthBookResult) => void;
};

export type CoworkGrowthBookLifecycle = {
  /** Official UrA / y7 — run one refresh cycle. */
  refresh: () => Promise<InitCoworkGrowthBookResult>;
  /** Official I9t — account-change refresh. */
  refreshForAccountChange: () => Promise<InitCoworkGrowthBookResult>;
  /** Official R0A — arm next timer from last kind. */
  scheduleNext: (lastKind?: InitCoworkGrowthBookResult["kind"]) => void;
  /** Stop timers (tests / quit). */
  stop: () => void;
  /** Whether a refresh is in flight. */
  isRefreshing: () => boolean;
};

export function createCoworkGrowthBookLifecycle(
  deps: CoworkGrowthBookLifecycleDeps = {},
): CoworkGrowthBookLifecycle {
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<InitCoworkGrowthBookResult> | null = null;
  let lastKind: InitCoworkGrowthBookResult["kind"] = "hardcoded";

  const run = async (): Promise<InitCoworkGrowthBookResult> => {
    if (inFlight) {
      deps.log?.("[growthbook] fetch in progress, waiting");
      return inFlight;
    }
    deps.log?.("[growthbook] starting fetch");
    inFlight = initCoworkGrowthBookFeatures(deps)
      .then((result) => {
        lastKind = result.kind;
        deps.onRefresh?.(result);
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const scheduleNext = (
    kind: InitCoworkGrowthBookResult["kind"] = lastKind,
  ): void => {
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
    // Official R0A: only network-error uses i9t (5min); all other kinds use t9t (1h).
    const delay =
      kind === "network-error"
        ? COWORK_GROWTHBOOK_REFRESH_NETWORK_ERROR_MS
        : COWORK_GROWTHBOOK_REFRESH_SUCCESS_MS;
    deps.log?.("[growthbook] next refresh in %d min", delay / 60_000);
    timer = setTimeoutFn(() => {
      timer = null;
      void run().finally(() => scheduleNext());
    }, delay);
  };

  return {
    refresh: run,
    refreshForAccountChange: async () => {
      if (inFlight) {
        deps.log?.(
          "[growthbook] waiting for in-flight fetch before account refresh",
        );
        await inFlight;
      }
      deps.log?.("[growthbook] refreshing for account change");
      const result = await run();
      scheduleNext(result.kind);
      return result;
    },
    scheduleNext,
    stop: () => {
      if (timer) {
        clearTimeoutFn(timer);
        timer = null;
      }
    },
    isRefreshing: () => inFlight !== null,
  };
}

/** Process-wide BbA handle for id() account hooks / quit cleanup. */
let activeLifecycle: CoworkGrowthBookLifecycle | null = null;

export function getActiveCoworkGrowthBookLifecycle(): CoworkGrowthBookLifecycle | null {
  return activeLifecycle;
}

export function setActiveCoworkGrowthBookLifecycle(
  lifecycle: CoworkGrowthBookLifecycle | null,
): void {
  activeLifecycle = lifecycle;
}

/**
 * Official BbA residual — one-shot init then arm R0A.
 * Returns lifecycle handle for account-change hooks / quit cleanup.
 */
export async function startCoworkGrowthBookLifecycle(
  deps: CoworkGrowthBookLifecycleDeps = {},
): Promise<{
  lifecycle: CoworkGrowthBookLifecycle;
  initial: InitCoworkGrowthBookResult;
}> {
  // Stop prior timer if bootstrap re-entered (tests / HMR residual).
  activeLifecycle?.stop();
  const lifecycle = createCoworkGrowthBookLifecycle(deps);
  activeLifecycle = lifecycle;
  const initial = await lifecycle.refresh();
  lifecycle.scheduleNext(initial.kind);
  return { lifecycle, initial };
}
