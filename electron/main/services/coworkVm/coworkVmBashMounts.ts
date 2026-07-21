/**
 * Official host-loop bash mounts (`j1i` / `Cq` / `_o` / `Zn`) for workspace MCP.
 * Builds `additionalMounts` + `vmCwd` under `/sessions/<vmProcessName>/mnt/…`.
 */
import path from "node:path";
import {
  COWORK_AUTO_MEMORY_MOUNT,
  HOST_LOOP_RESERVED_MOUNT_NAMES,
  deriveMountNamesIncremental,
  normalizeCoworkVmMountPathSegment,
} from "../coworkSessions/coworkVmPathTranslation";
import type { CoworkWorkspaceBashMounts } from "../coworkRuntime/coworkWorkspaceMcpServer";

/** Official mount entry path/mode. */
export type CoworkVmBashMountEntry = {
  mode: "ro" | "rw" | "rwd";
  path: string;
};

/**
 * Official Cq(resolveWorkspaceMountMode):
 *   globalForceRw ? "rw" : approved.includes(mount) ? "rwd" : "rw"
 */
export function resolveCoworkWorkspaceMountMode(
  mountName: string,
  fileDeleteApprovedMounts?: readonly string[] | null,
  forceRw = false,
): "rw" | "rwd" {
  if (forceRw) return "rw";
  if (
    fileDeleteApprovedMounts != null
    && fileDeleteApprovedMounts.includes(mountName)
  ) {
    return "rwd";
  }
  return "rw";
}

/**
 * Official `_o` host path → guest mount path string.
 * darwin/linux: path relative to `/` (no leading slash).
 * win32: `c/Users/...` form (drive letter lowercased, no colon).
 */
export function hostPathToCoworkVmGuestPath(hostPath: string): string {
  if (process.platform === "win32") {
    const normalized = path.win32.normalize(hostPath);
    if (normalized.startsWith("\\\\")) {
      throw new Error(`UNC paths are not supported: ${hostPath}`);
    }
    const parsed = path.win32.parse(normalized);
    const rest = path.win32
      .join(parsed.dir.slice(parsed.root.length), parsed.base)
      .split("\\")
      .join("/");
    const cleaned = rest && rest !== "." ? rest : "";
    if (parsed.root.length >= 2 && parsed.root[1] === ":") {
      const drive = parsed.root.charAt(0).toLowerCase();
      return cleaned ? `${drive}/${cleaned}` : drive;
    }
    return cleaned;
  }
  const absolute = path.posix.normalize(
    hostPath.split("\\").join("/"),
  );
  if (absolute === "/") return "";
  return path.posix.relative("/", absolute);
}

export type ComputeCoworkHostLoopBashMountsInput = {
  autoMemoryDir?: string | null;
  /**
   * Official skills staging root whose `skills/` subdir is mounted ro at
   * `.claude/skills`. Optional residual when product has no host skills dir.
   */
  claudeSkillsRoot?: string | null;
  fileDeleteApprovedMounts?: readonly string[] | null;
  /** Force all rw mounts (official third Cq arg). Default false. */
  forceRwMounts?: boolean;
  hostOutputsDir?: string | null;
  hostUploadsDir?: string | null;
  /**
   * Network-drive host paths excluded from user folder mounts (official NH).
   */
  networkDriveFolders?: readonly string[] | null;
  /**
   * Session storage dir — used for `.claude/projects` host path join.
   */
  sessionStorageDir?: string | null;
  /**
   * Local user-selected folder host paths (network drives filtered by caller
   * or via networkDriveFolders).
   */
  userSelectedFolders?: readonly string[] | null;
  vmProcessName: string;
};

/**
 * Official `j1i` subset for host-loop workspace bash.
 * Residual honesty: plugin mounts / project uuid mounts not product-wired yet.
 */
export function computeCoworkHostLoopBashMounts(
  input: ComputeCoworkHostLoopBashMountsInput,
): CoworkWorkspaceBashMounts & {
  nameByFolder: Map<string, string>;
  vmCwdMountName: string;
} {
  const vm = input.vmProcessName;
  const mounts: Record<string, CoworkVmBashMountEntry> = {};
  const network = new Set(input.networkDriveFolders ?? []);
  const approved = input.fileDeleteApprovedMounts ?? null;
  const forceRw = Boolean(input.forceRwMounts);

  const outputsName = normalizeCoworkVmMountPathSegment("outputs");
  const outputsHost = input.hostOutputsDir;
  if (!outputsHost) {
    // Official always has outputs dir; without it bash cwd is still outputs path.
    // Leave path empty string only if missing — spawn may still fail honestly.
  }
  const outputsEntry: CoworkVmBashMountEntry = {
    path: outputsHost ? hostPathToCoworkVmGuestPath(outputsHost) : "",
    mode: resolveCoworkWorkspaceMountMode(outputsName, approved, forceRw),
  };

  const folders = [...(input.userSelectedFolders ?? [])];
  let nameByFolder = new Map<string, string>();
  let vmCwdMountName: string | undefined;

  if (folders.length === 0) {
    mounts[outputsName] = outputsEntry;
    vmCwdMountName = outputsName;
  } else {
    nameByFolder = deriveMountNamesIncremental(folders, [
      ...HOST_LOOP_RESERVED_MOUNT_NAMES,
    ]);
    for (const [hostFolder, mountBase] of nameByFolder) {
      if (network.has(hostFolder)) continue;
      const mountName = normalizeCoworkVmMountPathSegment(mountBase);
      if (!vmCwdMountName) vmCwdMountName = mountName;
      mounts[mountName] = {
        path: hostPathToCoworkVmGuestPath(hostFolder),
        mode: resolveCoworkWorkspaceMountMode(mountName, approved, forceRw),
      };
    }
    if (!vmCwdMountName) vmCwdMountName = outputsName;
  }

  const uploadsName = normalizeCoworkVmMountPathSegment("uploads");
  if (input.hostUploadsDir) {
    mounts[uploadsName] = {
      path: hostPathToCoworkVmGuestPath(input.hostUploadsDir),
      mode: "ro",
    };
  }

  if (input.claudeSkillsRoot) {
    const skillsHost = path.join(input.claudeSkillsRoot, "skills");
    mounts[normalizeCoworkVmMountPathSegment(".claude/skills")] = {
      path: hostPathToCoworkVmGuestPath(skillsHost),
      mode: "ro",
    };
  }

  if (input.sessionStorageDir) {
    const projectsHost = path.join(input.sessionStorageDir, "projects");
    mounts[normalizeCoworkVmMountPathSegment(".claude/projects")] = {
      path: hostPathToCoworkVmGuestPath(projectsHost),
      mode: "ro",
    };
  }

  // outputs always present (overwrite if folders branch skipped it earlier).
  mounts[outputsName] = outputsEntry;

  if (input.autoMemoryDir) {
    mounts[normalizeCoworkVmMountPathSegment(COWORK_AUTO_MEMORY_MOUNT)] = {
      path: hostPathToCoworkVmGuestPath(input.autoMemoryDir),
      mode: "ro",
    };
  }

  const cwdName = vmCwdMountName ?? outputsName;
  return {
    mounts,
    vmCwd: `/sessions/${vm}/mnt/${cwdName}`,
    vmCwdMountName: cwdName,
    nameByFolder,
  };
}
