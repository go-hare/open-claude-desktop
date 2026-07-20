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
  const sdkOptions: Options = {
    additionalDirectories: folders.length > 0 ? folders : undefined,
    allowedTools: enabled.length > 0 ? enabled : undefined,
    canUseTool: createCanUseTool(input),
    cwd: hostCwd(input),
    forwardSubagentText: true,
    forkSession: input.forkSession,
    includePartialMessages: true,
    mcpServers: input.mcpServers as Options["mcpServers"],
    model: input.model,
    pathToClaudeCodeExecutable:
      options.executable ?? resolveCoworkClaudeExecutable(),
    permissionMode: permissionMode(input.permissionMode),
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
