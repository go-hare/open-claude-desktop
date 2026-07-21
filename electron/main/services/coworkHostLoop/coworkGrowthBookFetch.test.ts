import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyCoworkGrowthBookFeatures,
  isCoworkHostLoopGrowthBookFeatureEnabled,
  resetCoworkGrowthBookFeaturesForTests,
} from "./coworkGrowthBookFeatures";
import {
  decodeCoworkGrowthBookFcache,
  encodeCoworkGrowthBookFcache,
  fetchCoworkDesktopFeatures,
  initCoworkGrowthBookFeatures,
  resolveCoworkDesktopFeaturesUrl,
  resolveCoworkGrowthBookFcachePath,
  writeCoworkGrowthBookFcache,
} from "./coworkGrowthBookFetch";
import { COWORK_HOST_LOOP_FEATURE_FLAG_ID } from "./coworkHostLoopMode";

afterEach(() => {
  resetCoworkGrowthBookFeaturesForTests();
});

describe("coworkGrowthBookFetch pure helpers", () => {
  it("builds official features URL and fcache path", () => {
    expect(resolveCoworkDesktopFeaturesUrl("https://claude.ai")).toBe(
      "https://claude.ai/api/desktop/features",
    );
    expect(resolveCoworkGrowthBookFcachePath("/tmp/ud")).toBe(
      path.join("/tmp/ud", "fcache"),
    );
  });

  it("round-trips fcache magic + gzip + expiry", () => {
    const features = {
      [COWORK_HOST_LOOP_FEATURE_FLAG_ID]: { on: false, value: false },
    };
    const now = 1_700_000_000_000;
    const encoded = encodeCoworkGrowthBookFcache(features, now);
    expect(encoded.subarray(0, 3).toString("utf8")).toBe("CLF");
    expect(decodeCoworkGrowthBookFcache(encoded, now + 1000)).toEqual(features);
    expect(
      decodeCoworkGrowthBookFcache(encoded, now + 1440 * 60 * 1000 + 1),
    ).toBeNull();
  });
});

describe("fetchCoworkDesktopFeatures", () => {
  it("returns kni hardcoded without network by default (3p)", async () => {
    let fetches = 0;
    const result = await fetchCoworkDesktopFeatures({
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("should not fetch");
      },
    });
    expect(result.kind).toBe("hardcoded");
    expect(fetches).toBe(0);
    if (result.kind === "hardcoded") {
      expect(result.features[COWORK_HOST_LOOP_FEATURE_FLAG_ID]?.on).toBe(true);
    }
  });

  it("1p null hardcoded fetches and applies success map", async () => {
    const result = await fetchCoworkDesktopFeatures({
      getHardcodedFeatures: () => null,
      getClaudeAiBaseUrl: () => "https://claude.ai",
      fetchImpl: async (url) => {
        expect(url).toBe("https://claude.ai/api/desktop/features");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: {
              [COWORK_HOST_LOOP_FEATURE_FLAG_ID]: { on: false, value: false },
            },
          }),
        };
      },
    });
    expect(result.kind).toBe("success");
  });

  it("fails honestly on network error without inventing features", async () => {
    const result = await fetchCoworkDesktopFeatures({
      getHardcodedFeatures: () => null,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    expect(result.kind).toBe("network-error");
  });
});

describe("initCoworkGrowthBookFeatures", () => {
  it("writes fcache on 1p success and flips host-loop flag", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-gb-"));
    try {
      expect(isCoworkHostLoopGrowthBookFeatureEnabled()).toBe(true);
      const result = await initCoworkGrowthBookFeatures({
        getHardcodedFeatures: () => null,
        getUserDataPath: () => root,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            features: {
              [COWORK_HOST_LOOP_FEATURE_FLAG_ID]: { on: false, value: false },
            },
          }),
        }),
      });
      expect(result.applied).toBe(true);
      expect(result.kind).toBe("success");
      expect(isCoworkHostLoopGrowthBookFeatureEnabled()).toBe(false);
      expect(fs.existsSync(path.join(root, "fcache"))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to fcache when 1p network fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-gb-cache-"));
    try {
      writeCoworkGrowthBookFcache(root, {
        [COWORK_HOST_LOOP_FEATURE_FLAG_ID]: { on: false, value: false },
      });
      applyCoworkGrowthBookFeatures(null); // kni on
      const result = await initCoworkGrowthBookFeatures({
        getHardcodedFeatures: () => null,
        getUserDataPath: () => root,
        fetchImpl: async () => {
          throw new Error("offline");
        },
      });
      expect(result.kind).toBe("cache");
      expect(isCoworkHostLoopGrowthBookFeatureEnabled()).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("1p network fail without fcache clears kni (does not invent host-loop on)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-gb-empty-"));
    try {
      applyCoworkGrowthBookFeatures(null); // kni on seed
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
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
