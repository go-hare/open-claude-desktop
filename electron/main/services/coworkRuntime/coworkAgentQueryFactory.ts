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
  HOST_LOOP_DIRECT_DISALLOWED_TOOLS,
  HOST_LOOP_TOOL_NAMES,
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
  resolveCoworkClaudeExecutable,
  resolveCoworkDisclaimerExecutable,
} from "./coworkClaudeExecutable";

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

function createCanUseTool(input: CoworkQueryFactoryInput): CanUseTool {
  return async (toolName, toolInput, options) => {
    const denied = input.hostLoopMode
      ? preFilterCoworkHostFilePermission(
          { decisionReason: options.decisionReason, input: toolInput, toolName },
          createCoworkHostFileDenyResult,
        )
      : undefined;
    if (denied) return denied;
    return permissionResult(
      await input.canUseTool({
        input: toolInput,
        sessionId: input.sessionId,
        signal: options.signal,
        suggestions: options.suggestions,
        toolName,
      }),
    );
  };
}

function hostCwd(input: CoworkQueryFactoryInput): string {
  if (!input.hostLoopMode) return input.cwd;
  return input.userSelectedFolders[0] ?? process.cwd();
}

export function buildCoworkSdkOptions(
  input: CoworkQueryFactoryInput,
  options: CoworkAgentQueryFactoryOptions = {},
): Options {
  const sdkOptions: Options = {
    additionalDirectories: input.userSelectedFolders,
    allowedTools: stringArray(input.enabledMcpTools),
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
