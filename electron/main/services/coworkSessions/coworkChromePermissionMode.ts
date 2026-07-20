/**
 * Official gXi / chrome permission helpers for LocalAgentModeSessions.
 * Anchors: app.asar gXi + setPermissionMode chrome branch + aXi/wwe write-back.
 */

import type {
  CoworkChromePermissionMode,
  CoworkChromePermsBeforeUnsupervised,
  CoworkCuAllowedApp,
  CoworkCuGrantFlags,
  CoworkPermissionMode,
} from "./coworkSessionTypes";

export type CoworkChromePermissionFields = {
  chromeAllowedDomains?: string[];
  chromePermissionMode?: CoworkChromePermissionMode;
  chromePermsBeforeUnsupervised?: CoworkChromePermsBeforeUnsupervised;
};

/**
 * Official sXi rank map for chrome permission modes (aXi parent write-back).
 * ask:0 < follow_a_plan:1 < skip_all_permission_checks:2
 */
export const COWORK_CHROME_PERMISSION_MODE_RANK: Record<
  CoworkChromePermissionMode,
  number
> = {
  ask: 0,
  follow_a_plan: 1,
  skip_all_permission_checks: 2,
};

/**
 * Official wwe(e): undefined → -1; known mode → sXi[e]; else 0.
 */
export function rankCoworkChromePermissionMode(
  mode: CoworkChromePermissionMode | undefined,
): number {
  if (mode === undefined) return -1;
  return COWORK_CHROME_PERMISSION_MODE_RANK[mode] ?? 0;
}

/**
 * Official aXi(e, A, t): merge child chrome grant into parent dispatch write-back.
 *   domains = Set(parent.domains ∪ t)
 *   mode = wwe(A) >= wwe(parent.mode) ? A : parent.mode
 */
export function mergeCoworkChromePermissionWriteBack(
  parent: CoworkChromePermissionFields,
  mode: CoworkChromePermissionMode,
  domains: readonly string[],
): {
  chromePermissionMode: CoworkChromePermissionMode | undefined;
  chromeAllowedDomains: string[];
} {
  const mergedDomains = [
    ...new Set([...(parent.chromeAllowedDomains ?? []), ...domains]),
  ];
  const parentRank = rankCoworkChromePermissionMode(parent.chromePermissionMode);
  const nextRank = rankCoworkChromePermissionMode(mode);
  return {
    chromePermissionMode:
      nextRank >= parentRank ? mode : parent.chromePermissionMode,
    chromeAllowedDomains: mergedDomains,
  };
}

/**
 * Official gXi(e, A, t):
 *   i = A==="auto" || A==="bypassPermissions"
 *   r = t ? "skip_all_permission_checks" : void 0
 *   enter unsupervised without snapshot → save current chrome into snapshot, set mode r, clear domains
 *   enter unsupervised with snapshot → keep snapshot, set mode r, clear domains
 *   leave unsupervised with snapshot → restore mode+domains from snapshot, clear snapshot
 *   else undefined (no chrome field mutation)
 */
export function resolveCoworkChromePermsOnPermissionModeChange(
  session: CoworkChromePermissionFields,
  permissionMode: CoworkPermissionMode,
  chromeSkipAllPermissionChecks?: boolean,
): CoworkChromePermissionFields | undefined {
  const enteringUnsupervised =
    permissionMode === "auto" || permissionMode === "bypassPermissions";
  const unsupervisedChromeMode: CoworkChromePermissionMode | undefined =
    chromeSkipAllPermissionChecks ? "skip_all_permission_checks" : undefined;

  if (enteringUnsupervised && !session.chromePermsBeforeUnsupervised) {
    return {
      chromePermissionMode: unsupervisedChromeMode,
      chromeAllowedDomains: undefined,
      chromePermsBeforeUnsupervised: {
        mode: session.chromePermissionMode,
        domains: session.chromeAllowedDomains
          ? [...session.chromeAllowedDomains]
          : undefined,
      },
    };
  }

  if (enteringUnsupervised && session.chromePermsBeforeUnsupervised) {
    return {
      chromePermissionMode: unsupervisedChromeMode,
      chromeAllowedDomains: undefined,
      chromePermsBeforeUnsupervised: {
        mode: session.chromePermsBeforeUnsupervised.mode,
        domains: session.chromePermsBeforeUnsupervised.domains
          ? [...session.chromePermsBeforeUnsupervised.domains]
          : undefined,
      },
    };
  }

  if (!enteringUnsupervised && session.chromePermsBeforeUnsupervised) {
    return {
      chromePermissionMode: session.chromePermsBeforeUnsupervised.mode,
      chromeAllowedDomains: session.chromePermsBeforeUnsupervised.domains
        ? [...session.chromePermsBeforeUnsupervised.domains]
        : undefined,
      chromePermsBeforeUnsupervised: undefined,
    };
  }

  return undefined;
}

export function applyCoworkChromePermissionFields(
  session: CoworkChromePermissionFields,
  next: CoworkChromePermissionFields,
): void {
  session.chromePermissionMode = next.chromePermissionMode;
  session.chromeAllowedDomains = next.chromeAllowedDomains
    ? [...next.chromeAllowedDomains]
    : undefined;
  session.chromePermsBeforeUnsupervised = next.chromePermsBeforeUnsupervised
    ? {
        mode: next.chromePermsBeforeUnsupervised.mode,
        domains: next.chromePermsBeforeUnsupervised.domains
          ? [...next.chromePermsBeforeUnsupervised.domains]
          : undefined,
      }
    : undefined;
}

/**
 * Official oXi(e) — pick parent fields to inherit onto a new dispatch_child.
 * Copies only defined: chromePermissionMode, chromeAllowedDomains,
 * cuAllowedApps (array copy), cuGrantFlags (object copy), approvedToolNames.
 */
export type CoworkDispatchChildInheritedFields = {
  approvedToolNames?: string[];
  chromeAllowedDomains?: string[];
  chromePermissionMode?: CoworkChromePermissionMode;
  cuAllowedApps?: CoworkCuAllowedApp[];
  cuGrantFlags?: CoworkCuGrantFlags;
};

export type CoworkDispatchChildInheritParent = CoworkChromePermissionFields & {
  approvedToolNames?: string[];
  cuAllowedApps?: CoworkCuAllowedApp[];
  cuGrantFlags?: CoworkCuGrantFlags;
};

export function pickCoworkDispatchChildInheritedFields(
  parent: CoworkDispatchChildInheritParent | null | undefined,
): CoworkDispatchChildInheritedFields {
  if (!parent) return {};
  const out: CoworkDispatchChildInheritedFields = {};
  if (parent.chromePermissionMode !== undefined) {
    out.chromePermissionMode = parent.chromePermissionMode;
  }
  if (parent.chromeAllowedDomains !== undefined) {
    out.chromeAllowedDomains = [...parent.chromeAllowedDomains];
  }
  if (parent.cuAllowedApps !== undefined) {
    out.cuAllowedApps = [...parent.cuAllowedApps];
  }
  if (parent.cuGrantFlags !== undefined) {
    out.cuGrantFlags = { ...parent.cuGrantFlags };
  }
  if (parent.approvedToolNames !== undefined) {
    out.approvedToolNames = [...parent.approvedToolNames];
  }
  return out;
}

/**
 * Official startSession after D seed:
 *   if sessionType===dispatch_child && parentSessionId:
 *     p = oXi(parent); apply defined chrome/cu/approved fields
 *     if parent.chromePermsBeforeUnsupervised: deep-copy snapshot onto child
 */
export function applyCoworkDispatchChildStartInherit(
  child: CoworkChromePermissionFields & {
    approvedToolNames?: string[];
    cuAllowedApps?: CoworkCuAllowedApp[];
    cuGrantFlags?: CoworkCuGrantFlags;
  },
  parent: CoworkDispatchChildInheritParent | null | undefined,
): void {
  const inherited = pickCoworkDispatchChildInheritedFields(parent);
  if (inherited.chromePermissionMode !== undefined) {
    child.chromePermissionMode = inherited.chromePermissionMode;
  }
  if (inherited.chromeAllowedDomains !== undefined) {
    child.chromeAllowedDomains = [...inherited.chromeAllowedDomains];
  }
  if (inherited.cuAllowedApps !== undefined) {
    child.cuAllowedApps = [...inherited.cuAllowedApps];
  }
  if (inherited.cuGrantFlags !== undefined) {
    child.cuGrantFlags = { ...inherited.cuGrantFlags };
  }
  if (inherited.approvedToolNames !== undefined) {
    child.approvedToolNames = [...inherited.approvedToolNames];
  }
  if (parent?.chromePermsBeforeUnsupervised) {
    child.chromePermsBeforeUnsupervised = {
      mode: parent.chromePermsBeforeUnsupervised.mode,
      domains: parent.chromePermsBeforeUnsupervised.domains
        ? [...parent.chromePermsBeforeUnsupervised.domains]
        : undefined,
    };
  }
}
