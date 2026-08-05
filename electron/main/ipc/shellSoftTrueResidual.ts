/**
 * Honest residual helpers for secondary shell surfaces that previously soft-true
 * invented ready/connected/ok bags. Shapes match official app.asar validators.
 *
 * Premise: 壳 1:1 — never invent success without real residual body.
 */
import fs from "node:fs";
import path from "node:path";
import { coworkClaudeExecutableCandidates } from "../services/coworkRuntime/coworkClaudeExecutable";

/** Official Tl residual for ClaudeCode.getStatus. */
export type ClaudeCodeInstallStatus =
  | "not_installed"
  | "updating"
  | "ready"
  | "download_failed";

/**
 * Honest residual of Ta.getStatus / Ta.prepare — ready only when a real
 * absolute Claude Code binary path exists. Never invent ready/success from PATH bare names.
 */
export function resolveClaudeCodeBinaryPath(
  candidates: string[] = coworkClaudeExecutableCandidates(),
  exists: (p: string) => boolean = (p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  },
): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!path.isAbsolute(candidate)) continue;
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function getClaudeCodeInstallStatus(
  candidates?: string[],
  exists?: (p: string) => boolean,
): ClaudeCodeInstallStatus {
  return resolveClaudeCodeBinaryPath(candidates, exists) ? "ready" : "not_installed";
}

export function prepareClaudeCodeInstall(
  candidates?: string[],
  exists?: (p: string) => boolean,
): { success: boolean; error?: string } {
  const binary = resolveClaudeCodeBinaryPath(candidates, exists);
  if (binary) return { success: true };
  return {
    success: false,
    error: "Claude Code binary not installed",
  };
}

/** Official cz() residual for CoworkArtifactBridge.askClaude errors (k2i shape). */
export function askClaudeError(message: string): { text: string; isError: true } {
  return { text: message, isError: true };
}

/**
 * Official nvi(partnerId) residual without native partner allowlist / attestedMach.
 * YFt shape: { paired:boolean, error?:string }.
 *
 * Official order:
 *   !darwin → featureDisabled
 *   !evi(partner) → unknownPartner
 *   rateLimited / safeStorageUnavailable / transportUnavailable / internal
 *
 * Product: empty partner map (GB 873030668 default {}) → unknownPartner for any id.
 * Optional hasNativeTransport=false with known partner would yield transportUnavailable;
 * without partner map we never reach transport branch (honest).
 */
export function grandPrixPairResidual(
  partnerId: unknown,
  platform: NodeJS.Platform = process.platform,
  options: {
    /** Official evi(partnerId) — product default empty map. */
    isKnownPartner?: (id: string) => boolean;
    /** Official Jn() attestedMach transport present? */
    hasNativeTransport?: boolean;
  } = {},
): { paired: false; error: string } {
  if (platform !== "darwin") {
    return { paired: false, error: "featureDisabled" };
  }
  if (typeof partnerId !== "string" || partnerId.length === 0) {
    return { paired: false, error: "unknownPartner" };
  }
  const known = options.isKnownPartner?.(partnerId) ?? false;
  if (!known) {
    // No compiled partner map / GB allowlist residual in product shell.
    return { paired: false, error: "unknownPartner" };
  }
  if (options.hasNativeTransport === false) {
    return { paired: false, error: "transportUnavailable" };
  }
  // Known partner but no attestedMach product path — still transport unavailable.
  return { paired: false, error: "transportUnavailable" };
}

/**
 * Official grandPrixStatus store (ucA / OFt / Tle residual):
 *   { paired: Record<partnerId, boolean> }
 * NOT { paired: boolean, status: "connected" }.
 */
export function grandPrixStatusResidual(
  pairedMap: Record<string, boolean> = {},
): { paired: Record<string, boolean> } {
  const paired: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(pairedMap)) {
    if (typeof id === "string" && typeof value === "boolean") {
      paired[id] = value;
    }
  }
  return { paired };
}

/**
 * Official Simulator attachment store (AmA array residual).
 * Empty residual when no live sim session: [].
 */
export function simulatorAttachmentStateResidual(
  attachments: unknown = [],
): unknown[] {
  return Array.isArray(attachments) ? attachments : [];
}

/** Official KTi residual when VMP restart is not armed → false. */
export function restartAfterVmpInstallResidual(armed = false): boolean {
  return armed === true;
}
