/**
 * Official dual-exec (`hostLoopMode=false`) session mounts for Claude Code guest spawn.
 * Subset of LocalAgentModeSessionManager else-branch after `await q` (vm ready):
 *   user folders via Ym, outputs default cwd, .claude config rwd, memory, uploads, plugins residual.
 */
import path from "node:path";
import {
  COWORK_AUTO_MEMORY_MOUNT,
  deriveMountNames,
  normalizeCoworkVmMountPathSegment,
} from "../coworkSessions/coworkVmPathTranslation";
import {
  hostPathToCoworkVmGuestPath,
  resolveCoworkWorkspaceMountMode,
  type CoworkVmBashMountEntry,
} from "./coworkVmBashMounts";

export type ComputeCoworkDualExecMountsInput = {
  autoMemoryDir?: string | null;
  /** When true, auto-memory mount is rwd (official memory write path). */
  autoMemoryReadWrite?: boolean;
  fileDeleteApprovedMounts?: readonly string[] | null;
  forceRwMounts?: boolean;
  hostClaudeConfigDir?: string | null;
  hostOutputsDir?: string | null;
  hostUploadsDir?: string | null;
  networkDriveFolders?: readonly string[] | null;
  /**
   * Official plugin mounts: { mountName under mnt, hostPath }.
   * Residual until product plugin staging full wire.
   */
  pluginMounts?: readonly { hostPath: string; mountName: string }[] | null;
  skillsPluginPath?: string | null;
  userSelectedFolders?: readonly string[] | null;
  vmProcessName: string;
};

export type CoworkDualExecMountsResult = {
  additionalDirectories: string[];
  mounts: Record<string, CoworkVmBashMountEntry>;
  nameByFolder: Map<string, string>;
  /** Guest cwd for Claude Code: `/sessions/<vm>` (official zA.cwd). */
  sessionRoot: string;
};

/**
 * Official dual-exec plugin mounts from session.readOnlyPluginPaths (host paths).
 * Mount name = basename; collisions get `-2`, `-3`, … Does not invent roots.
 */
export function pluginMountsFromReadOnlyPaths(
  paths: readonly string[] | null | undefined,
): { hostPath: string; mountName: string }[] {
  const used = new Map<string, number>();
  const out: { hostPath: string; mountName: string }[] = [];
  for (const hostPath of paths ?? []) {
    if (typeof hostPath !== "string" || hostPath.trim().length === 0) continue;
    const base =
      normalizeCoworkVmMountPathSegment(path.basename(hostPath))
      || "plugin";
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const mountName = n === 1 ? base : `${base}-${n}`;
    out.push({ hostPath, mountName });
  }
  return out;
}

/**
 * Build guest `additionalMounts` for dual-exec Claude Code spawn.
 * Does not invent host-side execution.
 */
export function computeCoworkDualExecMounts(
  input: ComputeCoworkDualExecMountsInput,
): CoworkDualExecMountsResult {
  const vm = input.vmProcessName;
  const sessionRoot = `/sessions/${vm}`;
  const mounts: Record<string, CoworkVmBashMountEntry> = {};
  const network = new Set(input.networkDriveFolders ?? []);
  const approved = input.fileDeleteApprovedMounts ?? null;
  const forceRw = Boolean(input.forceRwMounts);

  const folders = [...(input.userSelectedFolders ?? [])].filter(
    (folder) => !network.has(folder),
  );
  const nameByFolder =
    folders.length > 0 ? deriveMountNames(folders) : new Map<string, string>();

  if (folders.length > 0) {
    for (const [hostFolder, mountBase] of nameByFolder) {
      const mountName = normalizeCoworkVmMountPathSegment(mountBase);
      mounts[mountName] = {
        path: hostPathToCoworkVmGuestPath(hostFolder),
        mode: resolveCoworkWorkspaceMountMode(mountName, approved, forceRw),
      };
    }
  } else if (input.hostOutputsDir) {
    const outputsName = normalizeCoworkVmMountPathSegment("outputs");
    mounts[outputsName] = {
      path: hostPathToCoworkVmGuestPath(input.hostOutputsDir),
      mode: resolveCoworkWorkspaceMountMode(outputsName, approved, forceRw),
    };
  }

  if (input.hostClaudeConfigDir) {
    mounts[normalizeCoworkVmMountPathSegment(".claude")] = {
      path: hostPathToCoworkVmGuestPath(input.hostClaudeConfigDir),
      mode: "rwd",
    };
  }

  if (input.autoMemoryDir) {
    mounts[normalizeCoworkVmMountPathSegment(COWORK_AUTO_MEMORY_MOUNT)] = {
      path: hostPathToCoworkVmGuestPath(input.autoMemoryDir),
      mode: input.autoMemoryReadWrite ? "rwd" : "ro",
    };
  }

  if (input.hostUploadsDir) {
    mounts[normalizeCoworkVmMountPathSegment("uploads")] = {
      path: hostPathToCoworkVmGuestPath(input.hostUploadsDir),
      mode: "ro",
    };
  }

  if (input.skillsPluginPath) {
    const skillsHost = path.join(input.skillsPluginPath, "skills");
    mounts[normalizeCoworkVmMountPathSegment(".claude/skills")] = {
      path: hostPathToCoworkVmGuestPath(skillsHost),
      mode: "ro",
    };
  }

  for (const plugin of input.pluginMounts ?? []) {
    if (!plugin.hostPath || !plugin.mountName) continue;
    const mountName = normalizeCoworkVmMountPathSegment(plugin.mountName);
    mounts[mountName] = {
      path: hostPathToCoworkVmGuestPath(plugin.hostPath),
      mode: "ro",
    };
  }

  const additionalDirectories = folders.map((folder) => {
    const name = nameByFolder.get(folder)!;
    return `${sessionRoot}/mnt/${normalizeCoworkVmMountPathSegment(name)}`;
  });

  return {
    mounts,
    nameByFolder,
    additionalDirectories,
    sessionRoot,
  };
}
