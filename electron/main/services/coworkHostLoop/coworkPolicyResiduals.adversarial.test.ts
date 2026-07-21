/**
 * Adversarial residual probes for enterprise vi() + 1p GrowthBook cold miss.
 * Kept in-repo so verification does not need /tmp scripts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isCoworkEnterpriseRequireFullVmSandbox,
  loadCoworkEnterpriseConfig,
  resetCoworkEnterpriseConfigForTests,
  setCoworkEnterpriseRemoteTier,
} from "./coworkEnterpriseConfig";
import {
  applyCoworkGrowthBookFeatures,
  getCoworkGrowthBookFeaturesSource,
  isCoworkHostLoopGrowthBookFeatureEnabled,
  resetCoworkGrowthBookFeaturesForTests,
} from "./coworkGrowthBookFeatures";
import { initCoworkGrowthBookFeatures } from "./coworkGrowthBookFetch";
import {
  resolveCoworkHostLoopModeForNewSession,
  resolveCoworkRequireFullVmSandbox,
} from "./coworkHostLoopMode";
import { readCoworkHostLoopPolicy } from "./createCoworkHostLoopModeResolver";

afterEach(() => {
  resetCoworkEnterpriseConfigForTests();
  resetCoworkGrowthBookFeaturesForTests();
});

describe("adversarial enterprise + growthbook residuals", () => {
  it("empty managed does not invent requireFullVm true", () => {
    const snap = loadCoworkEnterpriseConfig({
      getManagedConfig: () => ({}),
      getLocalConfig: () => undefined,
    });
    expect(snap.source.type).toBe("none");
    expect(snap.config.requireCoworkFullVmSandbox).toBeUndefined();
    expect(
      isCoworkEnterpriseRequireFullVmSandbox({
        getManagedConfig: () => ({}),
        getLocalConfig: () => undefined,
      }),
    ).toBe(false);
    expect(resolveCoworkRequireFullVmSandbox({ enterpriseValue: undefined })).toBe(
      false,
    );
    expect(resolveCoworkRequireFullVmSandbox({ enterpriseValue: "true" })).toBe(
      false,
    );
  });

  it("managed true forces dual-exec despite host-loop kni on", () => {
    const enterprise = isCoworkEnterpriseRequireFullVmSandbox({
      getManagedConfig: () => ({ requireCoworkFullVmSandbox: true }),
    });
    expect(enterprise).toBe(true);
    const policy = readCoworkHostLoopPolicy({
      env: {},
      getHostLoopFeatureEnabled: () => true,
      getRequireCoworkFullVmSandbox: () =>
        resolveCoworkRequireFullVmSandbox({ enterpriseValue: enterprise }),
    });
    expect(resolveCoworkHostLoopModeForNewSession(policy)).toBe(false);
  });

  it("remote tier alone with none base does not invent require", () => {
    setCoworkEnterpriseRemoteTier({ requireCoworkFullVmSandbox: true });
    const snap = loadCoworkEnterpriseConfig({
      getManagedConfig: () => undefined,
      getLocalConfig: () => undefined,
    });
    expect(snap.source.type).toBe("none");
    expect(snap.source.remote).toBe(false);
    expect(snap.config.requireCoworkFullVmSandbox).toBeUndefined();
  });

  it("1p cold miss clears kni (host-loop off, no invent on)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-adv-gb-"));
    try {
      applyCoworkGrowthBookFeatures(null);
      expect(isCoworkHostLoopGrowthBookFeatureEnabled()).toBe(true);
      const result = await initCoworkGrowthBookFeatures({
        getHardcodedFeatures: () => null,
        getUserDataPath: () => root,
        fetchImpl: async () => {
          throw new Error("offline");
        },
      });
      expect(result.applied).toBe(false);
      expect(result.kind).toBe("network-error");
      expect(isCoworkHostLoopGrowthBookFeatureEnabled()).toBe(false);
      expect(getCoworkGrowthBookFeaturesSource()).toBe("cleared");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("3p hardcoded path keeps kni without network", async () => {
    let fetches = 0;
    const result = await initCoworkGrowthBookFeatures({
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("should not fetch");
      },
    });
    expect(result.kind).toBe("hardcoded");
    expect(fetches).toBe(0);
    expect(isCoworkHostLoopGrowthBookFeatureEnabled()).toBe(true);
  });
});
