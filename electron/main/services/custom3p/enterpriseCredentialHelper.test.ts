import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./credentialHelperResidual", () => ({
  spawnCredentialHelper: vi.fn(),
  parseCredentialHelperStdout: vi.fn(),
  buildCredentialHelperRunResult: vi.fn(
    (helperPath: string, spawn: { ok: boolean }, parsed: unknown) => ({
      ok: Boolean(spawn.ok && parsed),
      state: spawn.ok && parsed ? "success" : "failed",
      at: new Date().toISOString(),
      elapsedMs: 1,
      stdoutBytes: 0,
      outputFormat: "bare-token",
      headerCount: 0,
      stderrRedacted: "",
      helperPath,
    }),
  ),
}));

import {
  spawnCredentialHelper,
  parseCredentialHelperStdout,
} from "./credentialHelperResidual";
import {
  credentialHelperTokenToSpawnEnv,
  hasEnterpriseCredentialHelper,
  resetEnterpriseCredentialHelperForTests,
  runEnterpriseCredentialHelperWithTtl,
} from "./enterpriseCredentialHelper";

const localOnly = (bag: Record<string, unknown>) => ({
  getManagedConfig: () => ({}),
  getLocalConfig: () => bag,
});

describe("enterpriseCredentialHelper (yL residual)", () => {
  afterEach(() => {
    resetEnterpriseCredentialHelperForTests();
    vi.mocked(spawnCredentialHelper).mockReset();
    vi.mocked(parseCredentialHelperStdout).mockReset();
  });

  it("hasEnterpriseCredentialHelper requires non-empty path", () => {
    expect(hasEnterpriseCredentialHelper(localOnly({}))).toBe(false);
    expect(
      hasEnterpriseCredentialHelper(
        localOnly({ inferenceCredentialHelper: "  /bin/helper  " }),
      ),
    ).toBe(true);
  });

  it("caches token within TTL and skips second spawn", async () => {
    vi.mocked(spawnCredentialHelper).mockResolvedValue({
      ok: true,
      stdout: "tok-1",
      stderr: "",
      exitCode: 0,
      elapsedMs: 5,
    } as never);
    vi.mocked(parseCredentialHelperStdout).mockReturnValue({
      token: "tok-1",
      headers: { "X-Org": "a" },
      isJson: false,
    });

    let now = 1_000_000;
    const deps = localOnly({
      inferenceCredentialHelper: "/abs/helper",
      inferenceCredentialHelperTtlSec: 60,
    });
    const first = await runEnterpriseCredentialHelperWithTtl(deps, {
      nowMs: () => now,
    });
    expect(first?.token).toBe("tok-1");
    expect(spawnCredentialHelper).toHaveBeenCalledTimes(1);

    now += 30_000;
    const second = await runEnterpriseCredentialHelperWithTtl(deps, {
      nowMs: () => now,
    });
    expect(second?.token).toBe("tok-1");
    expect(spawnCredentialHelper).toHaveBeenCalledTimes(1);
    // getEnterpriseCredentialHelperCachedToken uses wall clock; with synthetic now
    // far in the past the cache appears expired — assert via second run instead.

    now += 40_000;
    vi.mocked(parseCredentialHelperStdout).mockReturnValue({
      token: "tok-2",
      isJson: false,
    });
    const third = await runEnterpriseCredentialHelperWithTtl(deps, {
      nowMs: () => now,
    });
    expect(third?.token).toBe("tok-2");
    expect(spawnCredentialHelper).toHaveBeenCalledTimes(2);
  });

  it("maps token bag to spawn env (ANTHROPIC_API_KEY + custom headers)", () => {
    // Failed helper must clear keys so static bag cannot silently win.
    expect(credentialHelperTokenToSpawnEnv(null)).toEqual({
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
    });
    expect(
      credentialHelperTokenToSpawnEnv({
        token: "abc",
        headers: { Authorization: "Bearer x", "X-A": "1" },
        isJson: true,
      }),
    ).toEqual({
      ANTHROPIC_API_KEY: "abc",
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer x|X-A: 1",
    });
  });
});
