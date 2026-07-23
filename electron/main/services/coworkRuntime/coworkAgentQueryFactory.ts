import path from "node:path";
import {
  query as sdkQuery,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKUserMessage,
  type SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import {
  createCoworkHostProcessAdapter,
  createCoworkHostProcessRegistry,
  createMacDisclaimerResolver,
} from "../coworkHostLoop/coworkHostProcess";
import {
  createCoworkHostFileDenyResult,
  coworkAutoMemoryAllowedToolRules,
  coworkHostConfigAllowedToolRules,
  coworkSessionMountAllowedToolRules,
  HOST_LOOP_DIRECT_DISALLOWED_TOOLS,
  HOST_LOOP_TOOL_NAMES,
  HOST_LOOP_WORKSPACE_TOOLS,
  preFilterCoworkHostFilePermission,
} from "../coworkHostLoop/coworkHostToolPolicy";
import type {
  CoworkQueryFactory,
  CoworkQueryFactoryInput,
} from "../coworkSessions/coworkSessionManagerTypes";
import type {
  CoworkPermissionMode,
  CoworkRuntimeQuery,
} from "../coworkSessions/coworkSessionTypes";
import {
  preFilterCoworkRequestDirectoryPermission,
  prepareCoworkRequestDirectoryPermissionInput,
} from "./coworkDirectoryMcpServer";
import {
  resolveCoworkClaudeExecutable,
  resolveCoworkDisclaimerExecutable,
} from "./coworkClaudeExecutable";
import { resolveCoworkChromeCicCanUseTool } from "../coworkSessions/coworkChromeCicCanUseTool";
import type { CoworkChromePermissionMode } from "../coworkSessions/coworkSessionTypes";
import { createCoworkVmSpawnFunction } from "../coworkVm/coworkVmProcess";
import {
  computeCoworkDualExecMounts,
  pluginMountsFromReadOnlyPaths,
} from "../coworkVm/coworkVmDualExecMounts";

export type CoworkSdkQuery = (params: {
  options?: Options;
  prompt: string | AsyncIterable<SDKUserMessage>;
}) => Query;

export type CoworkAgentQueryFactoryOptions = {
  executable?: string;
  onStderr?: (chunk: string) => void;
  query?: CoworkSdkQuery;
  spawnClaudeCodeProcess?: (options: Parameters<NonNullable<Options["spawnClaudeCodeProcess"]>>[0]) => SpawnedProcess;
};

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return result.length > 0 ? [...new Set(result)] : undefined;
}

function permissionMode(value: string | undefined): PermissionMode | undefined {
  return ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"].includes(
    value ?? "",
  )
    ? (value as PermissionMode)
    : undefined;
}

function permissionResult(value: Awaited<ReturnType<CoworkQueryFactoryInput["canUseTool"]>>): PermissionResult {
  if (value.behavior === "deny") {
    return {
      behavior: "deny",
      interrupt: value.interrupt,
      message: value.message ?? "Permission denied",
    };
  }
  return {
    behavior: "allow",
    decisionClassification: value.decisionClassification,
    updatedInput: value.updatedInput as Record<string, unknown> | undefined,
    updatedPermissions: value.updatedPermissions as PermissionResult extends { updatedPermissions?: infer T } ? T : never,
  };
}

/**
 * Official sessionStorageDir for XPA — recover from hostOutputsDir / hostClaudeConfigDir
 * product paths (join(storage, "outputs"|".claude")).
 */
function sessionStorageDirFromFactoryInput(
  input: CoworkQueryFactoryInput,
): string | null {
  if (input.hostOutputsDir) return path.dirname(input.hostOutputsDir);
  if (input.hostClaudeConfigDir) return path.dirname(input.hostClaudeConfigDir);
  return null;
}

function createCanUseTool(input: CoworkQueryFactoryInput): CanUseTool {
  return async (toolName, toolInput, options) => {
    const denied = input.hostLoopMode
      ? preFilterCoworkHostFilePermission(
          { decisionReason: options.decisionReason, input: toolInput, toolName },
          createCoworkHostFileDenyResult,
        )
      : undefined;
    if (denied) return denied;

    // Official aze canUseTool CIC residual (before generic permission UI).
    // Non-CIC tools return undefined and fall through.
    const cic = input.cicCanUseTool;
    if (cic) {
      const cicResult = await resolveCoworkChromeCicCanUseTool(
        toolName,
        toolInput as Record<string, unknown> | undefined,
        {
          allowSkipAllOutsideUnsupervised:
            cic.allowSkipAllOutsideUnsupervised === true,
          hooks: {
            clearCicOnceApproved: cic.clearCicOnceApproved,
            getCicOnceApproved: cic.getCicOnceApproved,
            getCurrentBrowserDeviceId: cic.getCurrentBrowserDeviceId,
            getSessionAfterPrompt: cic.getSessionAfterPrompt,
            queryTabUrl: cic.queryTabUrl,
            setCicOnceApproved: cic.setCicOnceApproved,
            showBrowserPermissionCard: cic.showBrowserPermissionCard,
            updateChromePermission: cic.updateChromePermission
              ? (mode, domains) =>
                  cic.updateChromePermission?.(
                    mode as CoworkChromePermissionMode,
                    domains,
                  )
              : undefined,
          },
          session: cic.session,
          sessionId: input.sessionId,
          signal: options.signal,
        },
      );
      if (cicResult) {
        return permissionResult(cicResult);
      }
    }

    // Official canUseTool pre-prompt for mcp__cowork__request_cowork_directory (ql):
    // XPA internal storage + AJA protected roots before permission UI.
    // Then strip stale _hostPath, re-run P4 (incl. Th/tG) and attach host path
    // only when P4.ok — not a hard deny on admin roots fail.
    const sessionStorageDir = sessionStorageDirFromFactoryInput(input);
    const requestDirDenied = preFilterCoworkRequestDirectoryPermission(
      toolName,
      toolInput as Record<string, unknown> | undefined,
      {
        sessionStorageDir,
        // Official a||g = sessionType agent|dispatch_child. mountSkeletonHome
        // residual (dA false until dual-exec skeleton product).
        sessionType: input.sessionType,
      },
    );
    if (requestDirDenied) return requestDirDenied;

    const preparedInput =
      (await prepareCoworkRequestDirectoryPermissionInput(
        toolName,
        toolInput as Record<string, unknown> | undefined,
        {
          allowedWorkspaceFolders: input.allowedWorkspaceFolders,
          sessionStorageDir,
        },
      )) ?? toolInput;

    return permissionResult(
      await input.canUseTool({
        input: preparedInput,
        sessionId: input.sessionId,
        signal: options.signal,
        suggestions: options.suggestions,
        toolName,
      }),
    );
  };
}

function isVmSessionPath(value: string | undefined): boolean {
  if (!value) return true;
  return value === "/sessions" || value.startsWith("/sessions/");
}

function hostFolders(folders: string[] | undefined): string[] {
  return (folders ?? []).filter((folder) => !isVmSessionPath(folder));
}

/** Resolve a host-spawnable cwd. `/sessions/...` is a VM path and fails on Windows. */
export function hostCwd(input: CoworkQueryFactoryInput): string {
  const folders = hostFolders(input.userSelectedFolders);
  if (input.hostLoopMode) return folders[0] ?? process.cwd();
  if (!isVmSessionPath(input.cwd)) return input.cwd;
  return folders[0] ?? process.cwd();
}

/**
 * Official dual-exec cwd is `/sessions/<vmProcessName>` (guest).
 * Host-loop uses hostCwd (real host path).
 */
export function resolveCoworkSdkCwd(input: CoworkQueryFactoryInput): string {
  if (!input.hostLoopMode && input.vmProcessName) {
    return `/sessions/${input.vmProcessName}`;
  }
  return hostCwd(input);
}

function resolveDualExecSpawn(
  input: CoworkQueryFactoryInput,
  options: CoworkAgentQueryFactoryOptions,
): Options["spawnClaudeCodeProcess"] | undefined {
  if (input.hostLoopMode) {
    return options.spawnClaudeCodeProcess;
  }
  const vmProcessName = input.vmProcessName;
  if (!vmProcessName) return undefined;

  // Prefer explicit dualExecSpawn from runtime; else derive mounts from session inputs.
  // Official UXe fills session.readOnlyPluginPaths → plugin ro mounts (pluginMountsFromReadOnlyPaths).
  const derived = input.dualExecSpawn
    ? null
    : computeCoworkDualExecMounts({
        autoMemoryDir: input.autoMemoryDir,
        autoMemoryReadWrite: !input.autoMemoryReadOnly && Boolean(input.autoMemoryDir),
        hostClaudeConfigDir: input.hostClaudeConfigDir,
        hostOutputsDir: input.hostOutputsDir,
        hostUploadsDir: input.hostUploadsDir,
        networkDriveFolders: input.networkDriveFolders,
        pluginMounts: pluginMountsFromReadOnlyPaths(input.readOnlyPluginPaths),
        userSelectedFolders: hostFolders(input.userSelectedFolders),
        vmProcessName,
      });

  const mounts =
    input.dualExecSpawn?.additionalMounts
    ?? derived?.mounts
    ?? {};
  const processName =
    input.dualExecSpawn?.processName ?? vmProcessName;
  const sessionId = input.dualExecSpawn?.sessionId ?? input.sessionId;

  // Do not startVM at option-build time (unit tests / pure options).
  // Runtime controller kicks start early; spawnCoworkVmGuestProcess ensures guest before spawn.
  return createCoworkVmSpawnFunction({
    additionalMounts: mounts as Record<string, unknown>,
    allowedDomains: input.dualExecSpawn?.allowedDomains,
    isResume: input.dualExecSpawn?.isResume ?? Boolean(input.resume),
    mountSkeletonHome: input.dualExecSpawn?.mountSkeletonHome,
    processName,
    sessionId,
  });
}

/**
 * Official UXe residual: zA.plugins = [{ type:"local", path }] for each install.
 * Host-loop uses host installPath; dual-exec uses guest mount
 * `/sessions/<vm>/mnt/<basename>` matching pluginMountsFromReadOnlyPaths.
 * Only paths that exist (host) or have a mount name (guest) are included —
 * never invent plugin dirs.
 */
export function sdkPluginsFromReadOnlyPaths(
  paths: readonly string[] | null | undefined,
  mode: "host" | "guest",
  vmProcessName?: string | null,
): NonNullable<Options["plugins"]> | undefined {
  const cleaned = (paths ?? []).filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  if (cleaned.length === 0) return undefined;

  if (mode === "host") {
    const plugins = cleaned.map((hostPath) => ({
      type: "local" as const,
      path: hostPath,
    }));
    return plugins.length > 0 ? plugins : undefined;
  }

  if (!vmProcessName) return undefined;
  const mounts = pluginMountsFromReadOnlyPaths(cleaned);
  if (mounts.length === 0) return undefined;
  return mounts.map((m) => ({
    type: "local" as const,
    path: `/sessions/${vmProcessName}/mnt/${m.mountName}`,
  }));
}

export function buildCoworkSdkOptions(
  input: CoworkQueryFactoryInput,
  options: CoworkAgentQueryFactoryOptions = {},
): Options {
  const folders = hostFolders(input.userSelectedFolders);
  const enabled = stringArray(input.enabledMcpTools) ?? [];
  // Official UXe/V1i host-loop allowedTools:
  // workspace MCP + mounts + Ohe(config)/plugins + memory.
  if (input.hostLoopMode) {
    enabled.push(...HOST_LOOP_WORKSPACE_TOOLS);
    enabled.push(
      ...coworkSessionMountAllowedToolRules({
        folderPermissionPaths: folders,
        hostOutputsDir: input.hostOutputsDir,
        hostUploadsDir: input.hostUploadsDir,
      }),
    );
    enabled.push(
      ...coworkHostConfigAllowedToolRules({
        hostClaudeConfigDir: input.hostClaudeConfigDir,
        readOnlyPluginPaths: input.readOnlyPluginPaths,
      }),
    );
    enabled.push(
      ...coworkAutoMemoryAllowedToolRules(
        input.autoMemoryDir,
        Boolean(input.autoMemoryReadOnly),
      ),
    );
  }

  const pluginMounts = pluginMountsFromReadOnlyPaths(input.readOnlyPluginPaths);
  const dualExec =
    !input.hostLoopMode && input.vmProcessName
      ? computeCoworkDualExecMounts({
          autoMemoryDir: input.autoMemoryDir,
          autoMemoryReadWrite:
            !input.autoMemoryReadOnly && Boolean(input.autoMemoryDir),
          hostClaudeConfigDir: input.hostClaudeConfigDir,
          hostOutputsDir: input.hostOutputsDir,
          hostUploadsDir: input.hostUploadsDir,
          networkDriveFolders: input.networkDriveFolders,
          pluginMounts,
          userSelectedFolders: folders,
          vmProcessName: input.vmProcessName,
        })
      : null;

  // Official it[] → zA.plugins=dKi(it) residual — load installed plugins via --plugin-dir.
  const plugins = sdkPluginsFromReadOnlyPaths(
    input.readOnlyPluginPaths,
    input.hostLoopMode ? "host" : "guest",
    input.vmProcessName,
  );

  const sdkOptions: Options = {
    additionalDirectories: input.hostLoopMode
      ? folders.length > 0
        ? folders
        : undefined
      : dualExec && dualExec.additionalDirectories.length > 0
        ? dualExec.additionalDirectories
        : undefined,
    allowedTools: enabled.length > 0 ? enabled : undefined,
    canUseTool: createCanUseTool(input),
    cwd: resolveCoworkSdkCwd(input),
    forwardSubagentText: true,
    forkSession: input.forkSession,
    includePartialMessages: true,
    mcpServers: input.mcpServers as Options["mcpServers"],
    model: input.model,
    pathToClaudeCodeExecutable: input.hostLoopMode
      ? options.executable ?? resolveCoworkClaudeExecutable()
      : // Official dual-exec: guest binary at /usr/local/bin/claude
        "/usr/local/bin/claude",
    permissionMode: permissionMode(input.permissionMode),
    plugins,
    resume: input.resume,
    resumeSessionAt: input.resumeSessionAt,
    systemPrompt: input.systemPrompt,
  };
  if (sdkOptions.permissionMode === "bypassPermissions") {
    sdkOptions.allowDangerouslySkipPermissions = true;
  }
  if (input.hostLoopMode) {
    sdkOptions.disallowedTools = [...HOST_LOOP_DIRECT_DISALLOWED_TOOLS];
    sdkOptions.tools = [...HOST_LOOP_TOOL_NAMES];
    sdkOptions.spawnClaudeCodeProcess = options.spawnClaudeCodeProcess;
  } else if (input.vmProcessName) {
    // Official dual-exec: spawn Claude Code inside guest (tGi), not host shell.
    sdkOptions.spawnClaudeCodeProcess = resolveDualExecSpawn(input, options);
  }
  return sdkOptions;
}

function defaultHostSpawn(onStderr?: (chunk: string) => void) {
  const registry = createCoworkHostProcessRegistry();
  const disclaimer = resolveCoworkDisclaimerExecutable();
  return createCoworkHostProcessAdapter({
    commandResolver: disclaimer ? createMacDisclaimerResolver(disclaimer) : undefined,
    onStderr,
    registry,
  });
}

export function createCoworkAgentQueryFactory(
  options: CoworkAgentQueryFactoryOptions = {},
): CoworkQueryFactory {
  const query = options.query ?? sdkQuery;
  const spawnClaudeCodeProcess =
    options.spawnClaudeCodeProcess ?? defaultHostSpawn(options.onStderr);
  return (input) =>
    query({
      options: buildCoworkSdkOptions(input, {
        ...options,
        spawnClaudeCodeProcess,
      }),
      prompt: input.prompt as AsyncIterable<SDKUserMessage>,
    }) as unknown as CoworkRuntimeQuery;
}

export function coworkPermissionMode(value: CoworkPermissionMode): PermissionMode {
  return value as PermissionMode;
}
