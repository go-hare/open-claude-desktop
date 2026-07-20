/**
 * Official CU grant pure helpers (app.asar LocalAgentModeSessions).
 * Anchors: pwe, cXi, BTi / J_A(dispatchCuGrantTtlMs).
 * Residual: full CU MCP / Chicago grant Settings UI / aze canUseTool product.
 * Manager revokeComputerUseGrant + ComputerUseTcc IPC are separate (#107).
 */

import type {
  CoworkCuAllowedApp,
  CoworkCuGrantFlags,
} from "./coworkSessionTypes";

/**
 * Official BTi = 1800 * 1e3 (30 min).
 * J_A() = wr(fU, "dispatchCuGrantTtlMs", BTi, positive int) — product uses BTi
 * default; no invented Statsig/config store.
 */
export const COWORK_DISPATCH_CU_GRANT_TTL_MS = 1800 * 1e3;

/**
 * Official pwe(e, A, t):
 *   if any grant older than ttl → filter to younger
 *   else keep list as-is
 * Used by onCuPermissionUpdated parent write-back and lifecycle running prune.
 */
export function pruneCoworkCuAllowedAppsByTtl(
  apps: readonly CoworkCuAllowedApp[],
  nowMs: number,
  ttlMs: number = COWORK_DISPATCH_CU_GRANT_TTL_MS,
): CoworkCuAllowedApp[] {
  if (apps.some((app) => nowMs - app.grantedAt >= ttlMs)) {
    return apps.filter((app) => nowMs - app.grantedAt < ttlMs);
  }
  return [...apps];
}

/**
 * Official cXi(e, A, t): merge child CU grants into parent dispatch write-back.
 *   apps = Map(parent.apps by bundleId); for each child app missing, set
 *   flags = parent OR child (missing parent flag treated as false)
 */
export function mergeCoworkCuPermissionWriteBack(
  parent: {
    cuAllowedApps?: CoworkCuAllowedApp[];
    cuGrantFlags?: CoworkCuGrantFlags;
  },
  childApps: readonly CoworkCuAllowedApp[],
  childFlags: CoworkCuGrantFlags,
): {
  cuAllowedApps: CoworkCuAllowedApp[];
  cuGrantFlags: CoworkCuGrantFlags;
} {
  const byBundleId = new Map(
    (parent.cuAllowedApps ?? []).map((app) => [app.bundleId, app]),
  );
  for (const app of childApps) {
    if (!byBundleId.has(app.bundleId)) {
      byBundleId.set(app.bundleId, app);
    }
  }
  const parentFlags = parent.cuGrantFlags;
  return {
    cuAllowedApps: [...byBundleId.values()],
    cuGrantFlags: {
      clipboardRead:
        (parentFlags?.clipboardRead ?? false) || childFlags.clipboardRead,
      clipboardWrite:
        (parentFlags?.clipboardWrite ?? false) || childFlags.clipboardWrite,
      systemKeyCombos:
        (parentFlags?.systemKeyCombos ?? false) || childFlags.systemKeyCombos,
    },
  };
}

/**
 * Official lifecycle transition → running && tv(sessionType) && cuAllowedApps:
 *   cuAllowedApps = pwe(cuAllowedApps, Date.now(), J_A())
 * tv = agent | dispatch_child (same as replaceEnabledMcpTools skip).
 * Mutates session in place when prune applies; returns pruned count.
 */
export function pruneCoworkSessionCuGrantsOnTurnStart(
  session: {
    cuAllowedApps?: CoworkCuAllowedApp[];
    sessionType?: string;
  },
  nowMs: number,
  ttlMs: number = COWORK_DISPATCH_CU_GRANT_TTL_MS,
): number {
  if (
    session.sessionType !== "agent" &&
    session.sessionType !== "dispatch_child"
  ) {
    return 0;
  }
  const apps = session.cuAllowedApps;
  if (!apps || apps.length === 0) return 0;
  const before = apps.length;
  session.cuAllowedApps = pruneCoworkCuAllowedAppsByTtl(apps, nowMs, ttlMs);
  return before - (session.cuAllowedApps?.length ?? 0);
}

/**
 * Official CU host inject isAborted for session A:
 *   (n?._turnInterruptRequested)===true || (n?.lifecycleState)!=="running"
 * Missing session → true (official: undefined lifecycle !== "running").
 * Residual: full Chicago CU MCP wiring of this inject still product-optional.
 */
export function isCoworkSessionTurnAborted(
  session:
    | {
        _turnInterruptRequested?: boolean;
        lifecycleState?: string;
      }
    | null
    | undefined,
): boolean {
  return (
    session?._turnInterruptRequested === true ||
    session?.lifecycleState !== "running"
  );
}
