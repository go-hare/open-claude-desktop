import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createCustom3pConfigLibraryEntry,
  getAppliedCustom3pConfigLibraryBag,
  listCustom3pConfigLibrary,
  migrateLegacyShellCustom3pConfigsToLibrary,
  readCustom3pConfigLibrary,
  writeCustom3pConfigLibrary,
} from "./custom3pConfigLibrary";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempUserData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "config-library-"));
  tempDirs.push(dir);
  return dir;
}

it("Cgr/Igr/Egr residual: create + write + read full gateway bag with inferenceModels", () => {
  const userData = tempUserData();
  const entry = createCustom3pConfigLibraryEntry(userData, "Default", {
    inferenceProvider: "gateway",
  });
  expect(entry.id).toMatch(/^[a-f0-9-]{36}$/i);

  const write = writeCustom3pConfigLibrary(userData, entry.id, {
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic1",
    inferenceGatewayApiKey: "sk-test",
    inferenceModels: [{ name: "deepseek-v4-pro", supports1m: true }],
    coworkEgressAllowedHosts: ["*"],
    // Product proxy extension — library is pass-through; must survive write/read.
    inferenceHttpProxy: "http://127.0.0.1:12000",
    inferenceHttpsProxy: "http://127.0.0.1:12000",
    inferenceNoProxy: "127.0.0.1,localhost",
  });
  expect(write).toEqual({ ok: true });

  const read = readCustom3pConfigLibrary(userData, entry.id);
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  expect(read.config.inferenceGatewayBaseUrl).toBe(
    "https://api.deepseek.com/anthropic1",
  );
  expect(read.config.inferenceModels).toEqual([
    { name: "deepseek-v4-pro", supports1m: true },
  ]);
  expect(read.config.inferenceHttpProxy).toBe("http://127.0.0.1:12000");
  expect(read.config.inferenceHttpsProxy).toBe("http://127.0.0.1:12000");
  expect(read.config.inferenceNoProxy).toBe("127.0.0.1,localhost");

  const listed = listCustom3pConfigLibrary(userData);
  expect(listed.appliedId).toBe(entry.id);
  expect(listed.entries).toHaveLength(1);
  expect(listed.entries[0]?.provider).toBe("gateway");
  expect(listed.entries[0]?.note).toBe("https://api.deepseek.com/anthropic1");

  const applied = getAppliedCustom3pConfigLibraryBag(userData);
  expect(applied.id).toBe(entry.id);
  expect(applied.config?.inferenceModels).toEqual([
    { name: "deepseek-v4-pro", supports1m: true },
  ]);
});

it("migrates legacy shell custom3pConfigs once when library empty", () => {
  const userData = tempUserData();
  const legacyId = "19551b40-a9be-4ee5-b343-0ebd21e24152";
  const migrated = migrateLegacyShellCustom3pConfigsToLibrary(userData, {
    appliedCustom3pConfigId: legacyId,
    custom3pConfigs: {
      [legacyId]: {
        id: legacyId,
        name: "Default",
        config: {
          inferenceProvider: "gateway",
          inferenceGatewayBaseUrl: "https://gw.example",
          inferenceGatewayApiKey: "k",
          inferenceModels: [{ name: "deepseek-v4-pro", supports1m: true }],
        },
      },
    },
  });
  expect(migrated).toBe(true);
  expect(migrateLegacyShellCustom3pConfigsToLibrary(userData, {
    custom3pConfigs: { other: { config: {} } },
  })).toBe(false);

  const applied = getAppliedCustom3pConfigLibraryBag(userData);
  expect(applied.id).toBe(legacyId);
  expect(applied.config?.inferenceModels).toEqual([
    { name: "deepseek-v4-pro", supports1m: true },
  ]);
});
