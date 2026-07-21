import { afterEach, describe, expect, it } from "vitest";
import {
  applyCoworkGrowthBookFeatures,
  COWORK_HARDCODED_MAIN_GROWTHBOOK_FEATURES,
  getCoworkGrowthBookFeaturesSource,
  isCoworkGrowthBookFeatureOn,
  isCoworkHostLoopGrowthBookFeatureEnabled,
  resetCoworkGrowthBookFeaturesForTests,
} from "./coworkGrowthBookFeatures";
import { COWORK_HOST_LOOP_FEATURE_FLAG_ID } from "./coworkHostLoopMode";
import { readCoworkHostLoopPolicy } from "./createCoworkHostLoopModeResolver";
import { resolveCoworkHostLoopModeForNewSession } from "./coworkHostLoopMode";

afterEach(() => {
  resetCoworkGrowthBookFeaturesForTests();
});

describe("coworkGrowthBookFeatures kni/ft residual", () => {
  it("seeds official kni with host-loop flag 1143815894 on", () => {
    expect(COWORK_HARDCODED_MAIN_GROWTHBOOK_FEATURES[COWORK_HOST_LOOP_FEATURE_FLAG_ID]?.on).toBe(
      true,
    );
    expect(isCoworkHostLoopGrowthBookFeatureEnabled()).toBe(true);
    expect(isCoworkGrowthBookFeatureOn("no-such-flag")).toBe(false);
    expect(getCoworkGrowthBookFeaturesSource()).toBe("kni");
  });

  it("applyFeatures replaces map; null restores kni; empty clears", () => {
    applyCoworkGrowthBookFeatures({
      [COWORK_HOST_LOOP_FEATURE_FLAG_ID]: { on: false, value: false },
    });
    expect(isCoworkHostLoopGrowthBookFeatureEnabled()).toBe(false);
    expect(getCoworkGrowthBookFeaturesSource()).toBe("applied");
    applyCoworkGrowthBookFeatures(null);
    expect(isCoworkHostLoopGrowthBookFeatureEnabled()).toBe(true);
    expect(getCoworkGrowthBookFeaturesSource()).toBe("kni");
    applyCoworkGrowthBookFeatures({});
    expect(isCoworkHostLoopGrowthBookFeatureEnabled()).toBe(false);
    expect(getCoworkGrowthBookFeaturesSource()).toBe("cleared");
  });

  it("wires into host-loop policy when getter uses kni", () => {
    const policy = readCoworkHostLoopPolicy({
      env: {},
      getHostLoopFeatureEnabled: () => isCoworkHostLoopGrowthBookFeatureEnabled(),
    });
    expect(policy.hostLoopFeatureEnabled).toBe(true);
    expect(resolveCoworkHostLoopModeForNewSession(policy)).toBe(true);
  });

  it("env CLAUDE_HOST_LOOP_FEATURE=0 overrides kni on", () => {
    const policy = readCoworkHostLoopPolicy({
      env: { CLAUDE_HOST_LOOP_FEATURE: "0" },
      getHostLoopFeatureEnabled: () => isCoworkHostLoopGrowthBookFeatureEnabled(),
    });
    expect(policy.hostLoopFeatureEnabled).toBe(false);
    expect(resolveCoworkHostLoopModeForNewSession(policy)).toBe(false);
  });

  it("require full VM sandbox still forces dual-exec despite kni on", () => {
    const policy = readCoworkHostLoopPolicy({
      env: {},
      getHostLoopFeatureEnabled: () => true,
      getRequireCoworkFullVmSandbox: () => true,
    });
    expect(resolveCoworkHostLoopModeForNewSession(policy)).toBe(false);
  });
});
