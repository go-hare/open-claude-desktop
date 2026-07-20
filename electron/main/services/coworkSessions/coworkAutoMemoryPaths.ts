/**
 * Official app.asar auto-memory path helpers for LocalAgentModeSessionManager.
 *
 * Anchors:
 *   Kb = "local-agent-mode-sessions"
 *   mp = "agent"
 *   Mc = "agent" (sessionType)
 *   Nu = "radar" (sessionType)
 *   RB(account, org)  → userData/Kb/account/org
 *   ZrA(account, org, spaceId) → RB/spaces/<spaceId>/memory
 *   Use(account, org) → RB/agent/memory
 *   AFA(account, org) → RB/memory
 *   GL(account, org)  → AFA/memory = RB/memory/memory
 *   getAutoMemoryDirForSession:
 *     spaceId → ZrA
 *     sessionType===agent → Use
 *     sessionType===radar → GL
 *     (feature-flag bare session → GL; not product-wired)
 *     else null
 */
import path from "node:path";
import type { CoworkSessionType } from "./coworkSessionTypes";

/** Official Kb. */
export const COWORK_LOCAL_AGENT_MODE_SESSIONS_DIR = "local-agent-mode-sessions";

/** Official mp / Mc sessionType segment. */
export const COWORK_AGENT_SESSION_TYPE = "agent" as const;

/** Official Nu sessionType. */
export const COWORK_RADAR_SESSION_TYPE = "radar" as const;

export type CoworkAutoMemorySessionIdentity = {
  /**
   * Official startSession option: `memoryEnabled !== false` keeps memory mount;
   * explicit `false` disables getAutoMemoryDirForSession.
   */
  memoryEnabled?: boolean | null;
  sessionType?: CoworkSessionType | string | null;
  spaceId?: string | null;
};

/** Official RB — account/org root under userData. */
export function coworkAccountStorageDir(
  userDataPath: string,
  accountId: string,
  orgId: string,
): string {
  return path.join(
    userDataPath,
    COWORK_LOCAL_AGENT_MODE_SESSIONS_DIR,
    accountId,
    orgId,
  );
}

/** Official ZrA — space-scoped memory. */
export function coworkSpaceMemoryDir(
  accountStorageDir: string,
  spaceId: string,
): string {
  return path.join(accountStorageDir, "spaces", spaceId, "memory");
}

/** Official Use — agent session memory. */
export function coworkAgentMemoryDir(accountStorageDir: string): string {
  return path.join(accountStorageDir, COWORK_AGENT_SESSION_TYPE, "memory");
}

/** Official AFA — base memory dir. */
export function coworkAccountMemoryBaseDir(accountStorageDir: string): string {
  return path.join(accountStorageDir, "memory");
}

/** Official GL — radar / default nested memory. */
export function coworkRadarMemoryDir(accountStorageDir: string): string {
  return path.join(coworkAccountMemoryBaseDir(accountStorageDir), "memory");
}

function isUnsafePathSegment(value: string): boolean {
  if (!value) return true;
  if (value.includes("\0")) return true;
  if (value === "." || value === "..") return true;
  // Reject absolute / parent traversal pieces that would escape account root.
  if (value.includes("/") || value.includes("\\")) return true;
  return false;
}

/**
 * Official getAutoMemoryDirForSession pure resolver given account storage root.
 * Returns null when the session has no memory mount (ordinary cowork w/o space).
 *
 * Official lifecycle gate: `memoryEnabled !== false ? getAutoMemoryDirForSession : null`.
 */
export function resolveCoworkAutoMemoryDir(
  accountStorageDir: string | null | undefined,
  session: CoworkAutoMemorySessionIdentity,
): string | null {
  // Official: t.memoryEnabled !== !1 (explicit false disables memory mount).
  if (session.memoryEnabled === false) return null;
  if (!accountStorageDir) return null;
  const spaceId = session.spaceId ?? null;
  if (spaceId) {
    if (isUnsafePathSegment(spaceId)) return null;
    return coworkSpaceMemoryDir(accountStorageDir, spaceId);
  }
  if (session.sessionType === COWORK_AGENT_SESSION_TYPE) {
    return coworkAgentMemoryDir(accountStorageDir);
  }
  if (session.sessionType === COWORK_RADAR_SESSION_TYPE) {
    return coworkRadarMemoryDir(accountStorageDir);
  }
  // Official also gates bare sessions via Statsig ft("123929380") → GL.
  // That flag is not product-wired here; return null (honest residual).
  return null;
}
