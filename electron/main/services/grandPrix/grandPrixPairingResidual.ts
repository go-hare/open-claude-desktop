/**
 * Official GrandPrix nvi residual body (app.asar nvi / NZe / evi / Tle / kZe).
 *
 * Control flow:
 *   !darwin → {paired:false, error:"featureDisabled"}
 *   !evi(partner) → unknownPartner
 *   session attempts >= 3 → rateLimited
 *   !safeStorage → safeStorageUnavailable
 *   !Jn() → transportUnavailable
 *   attestedMachRequest → parse ivi → paired true | error
 *
 * Product residual:
 *   - Partners from GrowthBook 873030668 (salt+partners) validated + HMAC allowlist
 *   - Default empty map (Avi={}) → unknownPartner for any id (honest)
 *   - Native via maybeGetClaudeNative attestedMachRequest when present
 *   - Never invent paired:true without native ok body
 *
 * data-official-source: app.asar nvi / NZe / evi / rvi / Tle / ZTi / jTi / $Ti
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { safeStorage } from "electron";
import { getCoworkGrowthBookFeatureValue } from "../coworkHostLoop/coworkGrowthBookFeatures";
import { maybeGetClaudeNative } from "../settings/claudeNativeAddon";

/** Official GB flag for partner map. */
export const GRAND_PRIX_PARTNERS_FLAG = "873030668";

/** Official tvi session attempt cap. */
export const GRAND_PRIX_SESSION_ATTEMPT_CAP = 3;

/**
 * Official ZTi compiled allowlist (HMAC digests).
 * Without matching salt+partner payloads from GB, map stays empty — correct.
 */
const COMPILED_ALLOWLIST_HEX = [
  "5d377b5c23ec48addda2b3c4c9899c42464b205ea97c1531fb9620d95d7bdb06",
];

export type GrandPrixPartner = {
  teamId: string;
  service: string;
  testingService: string;
  requestBody: string;
};

export type GrandPrixPairResult =
  | { paired: true; token?: string }
  | { paired: false; error: string };

export type GrandPrixNativeTransport = {
  attestedMachRequest?: (
    service: string,
    teamId: string,
    body: Buffer,
  ) => Promise<{ ok: boolean; body?: Buffer | Uint8Array | null; error?: string }>;
};

export type GrandPrixPairDeps = {
  platform?: NodeJS.Platform;
  getPartners?: () => Record<string, GrandPrixPartner>;
  getNative?: () => GrandPrixNativeTransport | null;
  isEncryptionAvailable?: () => boolean;
  /** In-memory attempt map (partnerId → count). */
  attempts?: Map<string, number>;
  /** Persist paired bag: Record<id, {paired:true, token?}> */
  loadStore?: () => Record<string, { paired?: boolean; token?: string }>;
  saveStore?: (
    next: Record<string, { paired?: boolean; token?: string }>,
  ) => void;
  encryptToken?: (token: string) => string | undefined;
};

const defaultAttempts = new Map<string, number>();

function noNull(s: string): boolean {
  return !s.includes("\0");
}

function parsePartner(raw: unknown): GrandPrixPartner | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const teamId = typeof o.teamId === "string" ? o.teamId : "";
  const service = typeof o.service === "string" ? o.service : "";
  const testingService =
    typeof o.testingService === "string" ? o.testingService : "";
  const requestBody = typeof o.requestBody === "string" ? o.requestBody : "";
  if (!/^[A-Z0-9]{10}$/.test(teamId)) return null;
  if (!service || !testingService || !requestBody) return null;
  if (![service, testingService, requestBody].every(noNull)) return null;
  return { teamId, service, testingService, requestBody };
}

function hmacEntry(
  salt: string,
  partnerId: string,
  partner: GrandPrixPartner,
): Buffer {
  return createHmac("sha256", salt)
    .update(partnerId, "utf8")
    .update("\0")
    .update(partner.teamId, "utf8")
    .update("\0")
    .update(partner.service, "utf8")
    .update("\0")
    .update(partner.testingService, "utf8")
    .update("\0")
    .update(partner.requestBody, "utf8")
    .digest();
}

function onAllowlist(digest: Buffer): boolean {
  return COMPILED_ALLOWLIST_HEX.some((hex) => {
    try {
      const expected = Buffer.from(hex, "hex");
      return (
        expected.length === digest.length && timingSafeEqual(expected, digest)
      );
    } catch {
      return false;
    }
  });
}

/**
 * Official NZe residual — parse GB 873030668 → validated partners on allowlist.
 * Default empty when flag missing / invalid / no allowlist match.
 */
export function resolveGrandPrixPartners(
  featureValue: unknown = getCoworkGrowthBookFeatureValue(
    GRAND_PRIX_PARTNERS_FLAG,
    {},
  ),
): Record<string, GrandPrixPartner> {
  if (!featureValue || typeof featureValue !== "object") return {};
  const bag = featureValue as { salt?: unknown; partners?: unknown };
  if (typeof bag.salt !== "string" || bag.salt.length < 1) return {};
  if (!bag.partners || typeof bag.partners !== "object") return {};
  const out: Record<string, GrandPrixPartner> = {};
  for (const [id, raw] of Object.entries(
    bag.partners as Record<string, unknown>,
  )) {
    if (!id || id.includes("\0")) continue;
    const partner = parsePartner(raw);
    if (!partner) continue;
    const digest = hmacEntry(bag.salt, id, partner);
    if (!onAllowlist(digest)) continue;
    out[id] = partner;
  }
  return out;
}

export function isGrandPrixFeatureAvailable(
  platform: NodeJS.Platform = process.platform,
  partners: Record<string, GrandPrixPartner> = resolveGrandPrixPartners(),
): boolean {
  return platform === "darwin" && Object.keys(partners).length > 0;
}

/**
 * Official nvi(partnerId) residual.
 */
export async function grandPrixPairNvi(
  partnerId: unknown,
  deps: GrandPrixPairDeps = {},
): Promise<GrandPrixPairResult> {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") {
    return { paired: false, error: "featureDisabled" };
  }
  if (typeof partnerId !== "string" || partnerId.length === 0) {
    return { paired: false, error: "unknownPartner" };
  }

  const partners = deps.getPartners?.() ?? resolveGrandPrixPartners();
  const partner = partners[partnerId];
  if (!partner) {
    return { paired: false, error: "unknownPartner" };
  }

  const attempts = deps.attempts ?? defaultAttempts;
  const count = attempts.get(partnerId) ?? 0;
  if (count >= GRAND_PRIX_SESSION_ATTEMPT_CAP) {
    return { paired: false, error: "rateLimited" };
  }

  const encryptionOk =
    deps.isEncryptionAvailable?.() ??
    (() => {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    })();
  if (!encryptionOk) {
    return { paired: false, error: "safeStorageUnavailable" };
  }

  // Prefer explicit inject even when it returns null (tests / honest missing native).
  const native =
    deps.getNative !== undefined
      ? deps.getNative()
      : (maybeGetClaudeNative() as GrandPrixNativeTransport | null);
  if (!native || typeof native.attestedMachRequest !== "function") {
    return { paired: false, error: "transportUnavailable" };
  }

  attempts.set(partnerId, count + 1);

  let response: {
    ok: boolean;
    body?: Buffer | Uint8Array | null;
    error?: string;
  };
  try {
    response = await native.attestedMachRequest(
      partner.service,
      partner.teamId,
      Buffer.from(partner.requestBody, "utf8"),
    );
  } catch (err) {
    return {
      paired: false,
      error: "internal",
    };
  }

  if (!response.ok || !response.body) {
    return {
      paired: false,
      error: response.error ?? "internal",
    };
  }

  let parsed: { success?: boolean; reason?: string; token?: string };
  try {
    const text = Buffer.from(response.body).toString("utf8");
    parsed = JSON.parse(text) as {
      success?: boolean;
      reason?: string;
      token?: string;
    };
  } catch {
    return { paired: false, error: "internal" };
  }

  if (parsed.success !== true) {
    return {
      paired: false,
      error: typeof parsed.reason === "string" ? parsed.reason : "internal",
    };
  }

  const store = deps.loadStore?.() ?? {};
  const entry: { paired: true; token?: string } = { paired: true };
  if (typeof parsed.token === "string" && parsed.token) {
    const enc =
      deps.encryptToken?.(parsed.token) ??
      (() => {
        try {
          if (!safeStorage.isEncryptionAvailable()) return undefined;
          return safeStorage.encryptString(parsed.token).toString("base64");
        } catch {
          return undefined;
        }
      })();
    if (enc) entry.token = enc;
  }
  store[partnerId] = entry;
  deps.saveStore?.(store);

  return { paired: true };
}

/** Official Tle residual from store bag. */
export function grandPrixPairedMapFromStore(
  store: Record<string, { paired?: boolean; token?: string }> = {},
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [id, row] of Object.entries(store)) {
    if (row?.paired === true) out[id] = true;
  }
  return out;
}

/** Official kZe clear residual. */
export function grandPrixDisconnectResidual(
  partnerId: string | undefined,
  store: Record<string, { paired?: boolean; token?: string }>,
  attempts?: Map<string, number>,
): Record<string, { paired?: boolean; token?: string }> {
  if (partnerId === undefined) {
    attempts?.clear();
    return {};
  }
  if (Object.hasOwn(store, partnerId)) {
    const next = { ...store };
    delete next[partnerId];
    attempts?.delete(partnerId);
    return next;
  }
  return store;
}
