import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetCoworkEnterpriseConfigForTests } from "./coworkEnterpriseConfig";
import {
  accumulateEnterpriseTokenUsage,
  assertEnterpriseTokenCapAllowsTurn,
  checkEnterpriseTokenCap,
  tumbleTokenWindow,
} from "./coworkTokenCap";

const temporaryDirectories: string[] = [];

afterEach(() => {
  resetCoworkEnterpriseConfigForTests();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "token-cap-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("coworkTokenCap residual", () => {
  it("tumbles window when hours elapsed", () => {
    const start = 1_000_000;
    const state = tumbleTokenWindow(
      { windowStartMs: start, inputTokens: 10, outputTokens: 5 },
      1,
      start + 2 * 60 * 60 * 1000,
    );
    expect(state.inputTokens).toBe(0);
    expect(state.outputTokens).toBe(0);
  });

  it("QeA: absent bag never over", () => {
    expect(
      checkEnterpriseTokenCap({
        getManagedConfig: () => ({}),
        getLocalConfig: () => ({}),
      }),
    ).toEqual({ over: false });
  });

  it("QeA + A6 accumulate and refuse when over", () => {
    const root = tempDir();
    const storagePath = path.join(root, "usage.json");
    const deps = {
      getManagedConfig: () => ({}),
      getLocalConfig: () => ({
        inferenceMaxTokensPerWindow: 100,
        inferenceTokenWindowHours: 24,
      }),
      storagePath,
      nowMs: () => 1_000_000,
    };
    expect(checkEnterpriseTokenCap(deps)).toEqual({ over: false });
    accumulateEnterpriseTokenUsage(60, 50, deps);
    const check = checkEnterpriseTokenCap(deps);
    expect(check.over).toBe(true);
    if (check.over) {
      expect(check.used).toBe(110);
      expect(check.cap).toBe(100);
    }
    expect(() => assertEnterpriseTokenCapAllowsTurn(deps)).toThrow(
      /custom3p_token_cap_exceeded:110:100:24/,
    );
  });
});
