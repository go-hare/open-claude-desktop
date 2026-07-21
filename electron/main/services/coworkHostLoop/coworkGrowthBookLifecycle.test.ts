import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCoworkGrowthBookFeatures,
  isCoworkHostLoopGrowthBookFeatureEnabled,
  resetCoworkGrowthBookFeaturesForTests,
} from "./coworkGrowthBookFeatures";
import {
  COWORK_GROWTHBOOK_REFRESH_NETWORK_ERROR_MS,
  COWORK_GROWTHBOOK_REFRESH_SUCCESS_MS,
} from "./coworkGrowthBookFetch";
import {
  createCoworkGrowthBookLifecycle,
  setActiveCoworkGrowthBookLifecycle,
  startCoworkGrowthBookLifecycle,
} from "./coworkGrowthBookLifecycle";

afterEach(() => {
  resetCoworkGrowthBookFeaturesForTests();
  setActiveCoworkGrowthBookLifecycle(null);
});

describe("coworkGrowthBookLifecycle residual", () => {
  it("BbA: initial refresh then arms R0A with success interval for kni/hardcoded", async () => {
    const timers: Array<{ delay: number; fn: () => void }> = [];
    const { lifecycle, initial } = await startCoworkGrowthBookLifecycle({
      setTimeoutFn: ((fn: () => void, delay?: number) => {
        timers.push({ delay: delay ?? 0, fn });
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    });
    expect(initial.kind).toBe("hardcoded");
    expect(timers).toHaveLength(1);
    expect(timers[0]!.delay).toBe(COWORK_GROWTHBOOK_REFRESH_SUCCESS_MS);
    lifecycle.stop();
  });

  it("R0A uses 5min only after network-error kind", async () => {
    const timers: Array<{ delay: number; fn: () => void }> = [];
    const lifecycle = createCoworkGrowthBookLifecycle({
      getHardcodedFeatures: () => null,
      fetchImpl: async () => {
        throw new Error("offline");
      },
      setTimeoutFn: ((fn: () => void, delay?: number) => {
        timers.push({ delay: delay ?? 0, fn });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    });
    applyCoworkGrowthBookFeatures(null);
    const result = await lifecycle.refresh();
    expect(result.kind).toBe("network-error");
    lifecycle.scheduleNext(result.kind);
    expect(timers.at(-1)?.delay).toBe(
      COWORK_GROWTHBOOK_REFRESH_NETWORK_ERROR_MS,
    );
    lifecycle.stop();
  });

  it("I9t waits for in-flight then re-arms timer", async () => {
    let resolveFetch: ((v: unknown) => void) | null = null;
    let fetches = 0;
    const timers: number[] = [];
    const lifecycle = createCoworkGrowthBookLifecycle({
      getHardcodedFeatures: () => null,
      fetchImpl: async () => {
        fetches += 1;
        if (fetches === 1) {
          await new Promise((resolve) => {
            resolveFetch = resolve;
          });
          return {
            ok: true,
            status: 200,
            json: async () => ({ features: {} }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ features: {} }),
        };
      },
      setTimeoutFn: ((fn: () => void, delay?: number) => {
        timers.push(delay ?? 0);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    });

    const first = lifecycle.refresh();
    expect(lifecycle.isRefreshing()).toBe(true);
    const accountRefresh = lifecycle.refreshForAccountChange();
    resolveFetch?.(undefined);
    await first;
    const accountResult = await accountRefresh;
    expect(accountResult.applied).toBe(true);
    expect(timers.length).toBeGreaterThanOrEqual(1);
    expect(timers.at(-1)).toBe(COWORK_GROWTHBOOK_REFRESH_SUCCESS_MS);
    lifecycle.stop();
  });

  it("3p timer path keeps kni without inventing off", async () => {
    const lifecycle = createCoworkGrowthBookLifecycle({
      setTimeoutFn: ((fn: () => void) => {
        // never fire
        void fn;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    });
    const result = await lifecycle.refresh();
    expect(result.kind).toBe("hardcoded");
    expect(isCoworkHostLoopGrowthBookFeatureEnabled()).toBe(true);
    lifecycle.stop();
  });
});
