import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  deploymentModeIs3p,
  hasThirdPartyActivationKeys,
  hasUsableThirdPartyCredentials,
  resolveDeploymentMode,
  resolveDeploymentModeFromUserData,
} from "./deploymentMode";
import { DESKTOP_SHELL_SETTINGS_FILE } from "./custom3pCliEnv";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempUserData(bag?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-mode-"));
  tempDirs.push(dir);
  if (bag) {
    fs.writeFileSync(
      path.join(dir, DESKTOP_SHELL_SETTINGS_FILE),
      JSON.stringify(bag),
      "utf8",
    );
  }
  return dir;
}

it("Hzt: empty enterprise is not third-party activated", () => {
  expect(hasThirdPartyActivationKeys(null)).toBe(false);
  expect(hasThirdPartyActivationKeys({})).toBe(false);
});

it("Hzt: inferenceProvider activates 3p keys", () => {
  expect(hasThirdPartyActivationKeys({ inferenceProvider: "gateway" })).toBe(true);
});

it("SM: persisted 1p forces Anthropic path when chooser enabled", () => {
  expect(deploymentModeIs3p({ inferenceProvider: "gateway" }, "1p")).toBe(false);
  expect(deploymentModeIs3p({ inferenceProvider: "gateway" }, "3p")).toBe(true);
  expect(deploymentModeIs3p({ inferenceProvider: "gateway" }, undefined)).toBe(true);
});

it("SM: disableDeploymentModeChooser forces 3p even with persisted 1p", () => {
  expect(
    deploymentModeIs3p(
      { inferenceProvider: "gateway", disableDeploymentModeChooser: true },
      "1p",
    ),
  ).toBe(true);
});

it("N1e: no activation → mode 1p", () => {
  const r = resolveDeploymentMode({ enterprise: null });
  expect(r.mode).toBe("1p");
  expect(r.thirdPartyActivated).toBe(false);
  expect(r.degraded).toBe(false);
});

it("N1e: gateway provider without creds → 3p degraded", () => {
  const r = resolveDeploymentMode({
    enterprise: { inferenceProvider: "gateway" },
  });
  expect(r.mode).toBe("3p");
  expect(r.degraded).toBe(true);
  expect(hasUsableThirdPartyCredentials({ inferenceProvider: "gateway" })).toBe(false);
});

it("N1e: gateway with api key → 3p active", () => {
  const r = resolveDeploymentMode({
    enterprise: {
      inferenceProvider: "gateway",
      inferenceGatewayApiKey: "sk-test",
    },
  });
  expect(r.mode).toBe("3p");
  expect(r.degraded).toBe(false);
});

it("resolveDeploymentModeFromUserData: empty userData → 1p", () => {
  const dir = tempUserData();
  const snap = resolveDeploymentModeFromUserData(dir);
  expect(snap.resolution.mode).toBe("1p");
  expect(snap.appliedId).toBeNull();
  expect(snap.enterprise).toBeNull();
});

it("resolveDeploymentModeFromUserData: applied gateway bag → 3p degraded", () => {
  const dir = tempUserData({
    appliedCustom3pConfigId: "cfg-1",
    custom3pConfigs: {
      "cfg-1": {
        id: "cfg-1",
        name: "Gateway",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        config: { inferenceProvider: "gateway" },
      },
    },
  });
  const snap = resolveDeploymentModeFromUserData(dir);
  // Legacy non-uuid id is rewritten to uuid during configLibrary migration.
  expect(snap.appliedId).toBeTruthy();
  expect(snap.resolution.mode).toBe("3p");
  expect(snap.resolution.degraded).toBe(true);
});

it("resolveDeploymentModeFromUserData: preferences.deploymentMode 1p forces 1p", () => {
  const dir = tempUserData({
    preferences: { deploymentMode: "1p" },
    appliedCustom3pConfigId: "cfg-1",
    custom3pConfigs: {
      "cfg-1": {
        id: "cfg-1",
        name: "Gateway",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        config: { inferenceProvider: "gateway" },
      },
    },
  });
  const snap = resolveDeploymentModeFromUserData(dir);
  expect(snap.resolution.mode).toBe("1p");
  expect(snap.resolution.thirdPartyActivated).toBe(true);
  expect(snap.resolution.detail).toContain("1p");
});

it("resolveDeploymentModeFromUserData: official configLibrary bag with key → 3p active", () => {
  const dir = tempUserData();
  const appliedId = "19551b40-a9be-4ee5-b343-0ebd21e24152";
  const libraryDir = path.join(dir, "configLibrary");
  fs.mkdirSync(libraryDir, { recursive: true });
  fs.writeFileSync(
    path.join(libraryDir, "_meta.json"),
    JSON.stringify({
      appliedId,
      entries: [{ id: appliedId, name: "Default" }],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(libraryDir, `${appliedId}.json`),
    JSON.stringify({
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic1",
      inferenceGatewayApiKey: "sk-test",
      inferenceModels: [{ name: "deepseek-v4-pro", supports1m: true }],
    }),
    "utf8",
  );
  const snap = resolveDeploymentModeFromUserData(dir);
  expect(snap.appliedId).toBe(appliedId);
  expect(snap.resolution.mode).toBe("3p");
  expect(snap.resolution.degraded).toBe(false);
  expect(snap.enterprise?.inferenceModels?.[0]?.name).toBe("deepseek-v4-pro");
});
