import path from "node:path";
import {
  classifyCoworkPathKind,
  coworkPathKindMountPath,
  type CoworkPathKind,
  type CoworkPathSafetyFs,
} from "../coworkRuntime/coworkDirectoryMcpServer";
import type {
  CoworkResolvedFolder,
  CoworkSessionRuntimeState,
} from "./coworkSessionTypes";

export type CoworkAddFolderResult =
  | { folderPath: string; ok: true; networkDrive?: boolean }
  | { error: string; ok: false };

/**
 * Official sandboxed-session deny when mounting non-local (network-drive) kinds.
 * Host-loop allows network drives; dual-exec / non-host-loop does not.
 */
export const COWORK_NETWORK_DRIVE_SANDBOX_DENY =
  "Network drives can't be added to a sandboxed session — file tools run inside the sandbox and can't reach network shares. Use a local folder, or start a new session in host-loop mode.";

/**
 * Official Lc — mount path identity from resolved folder / Mh kind.
 * local → canonical (fallback display); others → display.
 */
export function coworkResolvedFolderMountPath(
  folder: CoworkResolvedFolder | CoworkPathKind,
): string {
  if (folder.kind === "local") {
    return "canonical" in folder && folder.canonical
      ? folder.canonical
      : folder.display;
  }
  return folder.display;
}

/** Official Mh kind → session resolvedFolders entry. */
export function coworkPathKindToResolvedFolder(
  kind: CoworkPathKind,
): CoworkResolvedFolder {
  if (kind.kind === "local") {
    return {
      kind: "local",
      display: kind.display,
      canonical: kind.canonical,
    };
  }
  if (kind.kind === "network-drive") {
    return {
      kind: "network-drive",
      display: kind.display,
      unc: kind.unc,
    };
  }
  return { kind: kind.kind, display: kind.display };
}

/**
 * Official _c — resolvedFolders.map(Lc). Includes network-drive display paths.
 */
export function coworkUserSelectedFolderPaths(
  folders: readonly CoworkResolvedFolder[] | undefined,
): string[] {
  return (folders ?? []).map(coworkResolvedFolderMountPath);
}

/**
 * Official NH — Set of non-local folder Lc paths (network / junction / literal).
 * Used by getNetworkDriveFolders → tJA exclude + present_files.
 */
export function coworkNetworkDriveFolderPaths(
  folders: readonly CoworkResolvedFolder[] | undefined,
): Set<string> {
  return new Set(
    (folders ?? [])
      .filter((folder) => folder.kind !== "local")
      .map(coworkResolvedFolderMountPath),
  );
}

/**
 * Official Zni / twe — permission additionalDirectories roots:
 * Lc(each) + network-drive.unc when present.
 */
export function coworkFolderPermissionPaths(
  folders: readonly CoworkResolvedFolder[] | undefined,
): string[] {
  const set = new Set<string>();
  for (const folder of folders ?? []) {
    set.add(coworkResolvedFolderMountPath(folder));
    if (folder.kind === "network-drive" && folder.unc) {
      set.add(folder.unc);
    }
  }
  return [...set];
}

/**
 * Official addUserSelectedFolder(session, Mh kind) — store full path kind.
 * Non-local without hostLoopMode → sandbox network-drive deny.
 */
export function addCoworkSessionResolvedFolder(
  session: CoworkSessionRuntimeState,
  folder: CoworkResolvedFolder,
): CoworkAddFolderResult {
  if (folder.kind !== "local" && !session.hostLoopMode) {
    return { ok: false, error: COWORK_NETWORK_DRIVE_SANDBOX_DENY };
  }
  const mountPath = coworkResolvedFolderMountPath(folder);
  if (!path.isAbsolute(mountPath) && folder.kind === "local") {
    return { error: "Folder path must be absolute", ok: false };
  }
  const existing = session.resolvedFolders.some(
    (entry) => coworkResolvedFolderMountPath(entry) === mountPath,
  );
  if (!existing) {
    session.resolvedFolders.push(folder);
  }
  return {
    folderPath: mountPath,
    ok: true,
    networkDrive: folder.kind !== "local",
  };
}

/**
 * Public add-folder (UI / IPC): Mh classify absolute path then store kind.
 * Relative → absolute error; Mh null → unresolved.
 */
export async function addCoworkSessionFolder(
  session: CoworkSessionRuntimeState,
  folderPath: string,
  options: { pathSafetyFs?: Partial<CoworkPathSafetyFs> } = {},
): Promise<CoworkAddFolderResult> {
  if (!path.isAbsolute(folderPath)) {
    return { error: "Folder path must be absolute", ok: false };
  }
  const kind = await classifyCoworkPathKind(folderPath, {
    fs: options.pathSafetyFs,
  });
  if (!kind) {
    return { error: "Folder could not be resolved", ok: false };
  }
  return addCoworkSessionResolvedFolder(
    session,
    coworkPathKindToResolvedFolder(kind),
  );
}

/**
 * Official AAA — resume-resolvable kinds only:
 *   kind === "local" || kind === "network-drive"
 * (literal-unc / junction-to-unc filtered out on resume)
 */
export function isCoworkResumeResolvablePathKind(
  kind: CoworkPathKind | null | undefined,
): kind is CoworkPathKind {
  return kind?.kind === "local" || kind?.kind === "network-drive";
}

export type CoworkResolveAndFilterSessionFoldersResult = {
  /** Official r after Mh(+AAA) and optional FGi residual (unrestricted = all). */
  resolved: CoworkResolvedFolder[];
  /** Paths from input that failed resume Mh/AAA (for deleted-disk notify). */
  missing: string[];
};

/**
 * Official resolveAndFilterSessionFolders(A, t, i) pure core (no FGi Settings store):
 *   i (resumeMode) true  → Mh each; keep AAA; missing → caller queue/invalidate
 *   i false (new session) → zni = Promise.all(map Mh).filter(non-null)
 * Admin FGi/tG residual: when unrestricted Th() is null, official returns all Lc paths.
 */
export async function resolveAndFilterCoworkSessionFolders(
  folderPaths: readonly string[],
  options: {
    resumeMode: boolean;
    classify?: (folderPath: string) => Promise<CoworkPathKind | null>;
  },
): Promise<CoworkResolveAndFilterSessionFoldersResult> {
  const classify =
    options.classify ??
    ((folderPath: string) => classifyCoworkPathKind(folderPath));

  if (!options.resumeMode) {
    // Official zni(t)
    const kinds = await Promise.all(folderPaths.map((p) => classify(p)));
    return {
      resolved: kinds
        .filter((k): k is CoworkPathKind => k != null)
        .map(coworkPathKindToResolvedFolder),
      missing: [],
    };
  }

  // Official resume branch: Mh + AAA
  const kinds = await Promise.all(folderPaths.map((p) => classify(p)));
  const resolved = kinds
    .filter(isCoworkResumeResolvablePathKind)
    .map(coworkPathKindToResolvedFolder);
  // Official: o = r.map(Lc); missing = t.filter(a => !o.includes(a))
  // (string equality on original folder paths vs Lc identities)
  const lcList = resolved.map(coworkResolvedFolderMountPath);
  const missing = folderPaths.filter((p) => !lcList.includes(p));
  return { resolved, missing };
}

/**
 * Official mountFolderForSession host-loop subset after P4:
 * addUserSelectedFolder(kind) + return host-loop + networkDrive flag.
 */
export function mountCoworkSessionFolderFromPathKind(
  session: CoworkSessionRuntimeState,
  pathKind: CoworkPathKind,
): CoworkAddFolderResult {
  return addCoworkSessionResolvedFolder(
    session,
    coworkPathKindToResolvedFolder(pathKind),
  );
}

/** Re-export Lc helper name used by callers expecting path-kind mount path. */
export { coworkPathKindMountPath };

/**
 * Official eBe(folders, onDrop) for setDraftSessionFolders:
 *   Th() null/undefined → copy folders
 *   else keep folder when under some root via:
 *     rel = relative(root, normalize(folder));
 *     rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
 *   dropped folders invoke onDrop({ allowed:false, folderPath, allowedRoots }).
 * Product injects allowed roots (Settings Th residual when unset → unrestricted).
 */
export type CoworkDraftFolderDropInfo = {
  allowed: false;
  allowedRoots: readonly string[];
  folderPath: string;
};

export function filterCoworkDraftSessionFolders(
  folders: readonly string[],
  allowedWorkspaceFolders: readonly string[] | null | undefined,
  onDrop?: (info: CoworkDraftFolderDropInfo) => void,
): string[] {
  // Official Th() falsy → [...e]
  if (allowedWorkspaceFolders == null) return [...folders];
  const roots = allowedWorkspaceFolders;
  return folders.filter((folderPath) => {
    const allowed = roots.some((root) => {
      const rel = path.relative(root, path.normalize(folderPath));
      return (
        rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
      );
    });
    if (!allowed) {
      onDrop?.({ allowed: false, folderPath, allowedRoots: roots });
    }
    return allowed;
  });
}
