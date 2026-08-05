import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  grandPrixDisconnectResidual,
  grandPrixPairedMapFromStore,
  grandPrixPairNvi,
  resolveGrandPrixPartners,
  GRAND_PRIX_SESSION_ATTEMPT_CAP,
} from "./grandPrixPairingResidual";

const SALT = "test-salt-1";

function partner() {
  return {
    teamId: "ABCDEF1234",
    service: "svc.example",
    testingService: "svc.test",
    requestBody: '{"nonce":1}',
  };
}

function allowlistedPayload() {
  // Build a partner that matches COMPILED allowlist by temporarily
  // using inject getPartners (bypass HMAC) for pair path tests.
  return partner();
}

describe("grandPrixPairingResidual", () => {
  it("NZe empty default without GB partners", () => {
    expect(resolveGrandPrixPartners({})).toEqual({});
    expect(resolveGrandPrixPartners(null)).toEqual({});
    expect(resolveGrandPrixPartners({ salt: "x", partners: {} })).toEqual({});
  });

  it("NZe rejects partners not on allowlist", () => {
    const p = partner();
    const value = {
      salt: SALT,
      partners: { "p-1": p },
    };
    // HMAC of test salt won't match compiled allowlist → empty
    expect(resolveGrandPrixPartners(value)).toEqual({});
  });

  it("nvi !darwin → featureDisabled", async () => {
    expect(
      await grandPrixPairNvi("p", {
        platform: "linux",
        getPartners: () => ({ p: allowlistedPayload() }),
      }),
    ).toEqual({ paired: false, error: "featureDisabled" });
  });

  it("nvi unknown partner", async () => {
    expect(
      await grandPrixPairNvi("missing", {
        platform: "darwin",
        getPartners: () => ({}),
      }),
    ).toEqual({ paired: false, error: "unknownPartner" });
  });

  it("nvi no native → transportUnavailable", async () => {
    expect(
      await grandPrixPairNvi("p", {
        platform: "darwin",
        getPartners: () => ({ p: allowlistedPayload() }),
        getNative: () => null,
        isEncryptionAvailable: () => true,
      }),
    ).toEqual({ paired: false, error: "transportUnavailable" });
  });

  it("nvi safeStorage unavailable", async () => {
    expect(
      await grandPrixPairNvi("p", {
        platform: "darwin",
        getPartners: () => ({ p: allowlistedPayload() }),
        getNative: () => ({
          attestedMachRequest: async () => ({ ok: true, body: Buffer.from("{}") }),
        }),
        isEncryptionAvailable: () => false,
      }),
    ).toEqual({ paired: false, error: "safeStorageUnavailable" });
  });

  it("nvi rateLimited after cap", async () => {
    const attempts = new Map<string, number>([
      ["p", GRAND_PRIX_SESSION_ATTEMPT_CAP],
    ]);
    expect(
      await grandPrixPairNvi("p", {
        platform: "darwin",
        getPartners: () => ({ p: allowlistedPayload() }),
        getNative: () => ({
          attestedMachRequest: async () => ({
            ok: true,
            body: Buffer.from(JSON.stringify({ success: true })),
          }),
        }),
        isEncryptionAvailable: () => true,
        attempts,
      }),
    ).toEqual({ paired: false, error: "rateLimited" });
  });

  it("nvi native fail → error bag not invent paired", async () => {
    const result = await grandPrixPairNvi("p", {
      platform: "darwin",
      getPartners: () => ({ p: allowlistedPayload() }),
      getNative: () => ({
        attestedMachRequest: async () => ({
          ok: false,
          error: "denied",
        }),
      }),
      isEncryptionAvailable: () => true,
      attempts: new Map(),
    });
    expect(result).toEqual({ paired: false, error: "denied" });
  });

  it("nvi native success → paired true + store", async () => {
    let store: Record<string, { paired?: boolean; token?: string }> = {};
    const result = await grandPrixPairNvi("p", {
      platform: "darwin",
      getPartners: () => ({ p: allowlistedPayload() }),
      getNative: () => ({
        attestedMachRequest: async () => ({
          ok: true,
          body: Buffer.from(
            JSON.stringify({ success: true, token: "tok-1" }),
          ),
        }),
      }),
      isEncryptionAvailable: () => true,
      attempts: new Map(),
      loadStore: () => store,
      saveStore: (next) => {
        store = next;
      },
      encryptToken: (t) => `enc:${t}`,
    });
    expect(result).toEqual({ paired: true });
    expect(store.p).toEqual({ paired: true, token: "enc:tok-1" });
    expect(grandPrixPairedMapFromStore(store)).toEqual({ p: true });
  });

  it("disconnect clears store entry", () => {
    const next = grandPrixDisconnectResidual("p", {
      p: { paired: true },
      q: { paired: true },
    });
    expect(next).toEqual({ q: { paired: true } });
  });

  it("hmac helper smoke (digest length 32)", () => {
    const digest = createHmac("sha256", "s")
      .update("id")
      .digest();
    expect(digest.length).toBe(32);
  });
});
