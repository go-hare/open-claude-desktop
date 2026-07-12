import { spawn as nodeSpawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  SpawnOptions as ClaudeSpawnOptions,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";

export const CLAUDE_CODE_OAUTH_TOKEN = "CLAUDE_CODE_OAUTH_TOKEN";
export const CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR = "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR";

export type CoworkHostCommand = { args: string[]; command: string };

export type CoworkHostCommandResolver = (command: CoworkHostCommand) => CoworkHostCommand;

export type CoworkHostNativeSpawnOptions = {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  stdio: ["pipe", "pipe", "pipe"] | ["pipe", "pipe", "pipe", number];
  windowsHide: true;
};

export type CoworkHostSpawnedProcess = SpawnedProcess & {
  stderr?: NodeJS.ReadableStream | null;
};

export type CoworkHostSpawnImplementation = (
  command: string,
  args: string[],
  options: CoworkHostNativeSpawnOptions,
) => CoworkHostSpawnedProcess;

export type CoworkHostProcessRegistry = {
  readonly size: number;
  terminateAll: () => void;
  track: (process: SpawnedProcess) => void;
};

export type CoworkHostProcessRegistryOptions = { registerExit?: (listener: () => void) => void };

export type CoworkOAuthStageDependencies = {
  closeFile?: (descriptor: number) => void;
  makeTemporaryDirectory?: (prefix: string) => string;
  onError?: (error: unknown) => void;
  openFile?: (filePath: string) => number;
  remove?: (targetPath: string, options: { force: boolean; recursive?: boolean }) => void;
  temporaryDirectory?: () => string;
  writeFile?: (
    filePath: string,
    content: string,
    options: { encoding: "utf8"; mode: number },
  ) => void;
};

export type CoworkHostProcessAdapterOptions = {
  closeFileDescriptor?: (descriptor: number) => void;
  commandResolver?: CoworkHostCommandResolver;
  onOAuthStageError?: (error: unknown) => void;
  onStderr?: (chunk: string) => void;
  platform?: NodeJS.Platform;
  registerExit?: (listener: () => void) => void;
  registry?: CoworkHostProcessRegistry;
  spawnProcess?: CoworkHostSpawnImplementation;
  stageOAuthToken?: (token: string) => number | undefined;
};

export type CoworkHostProcessAdapter = (options: ClaudeSpawnOptions) => SpawnedProcess;

export function createMacDisclaimerResolver(
  disclaimerPath: string,
  platform: NodeJS.Platform = process.platform,
): CoworkHostCommandResolver {
  return ({ command, args }) =>
    platform === "darwin"
      ? { args: [command, ...args], command: disclaimerPath }
      : { args: [...args], command };
}

export function createCoworkHostProcessRegistry(
  options: CoworkHostProcessRegistryOptions = {},
): CoworkHostProcessRegistry {
  const activeProcesses = new Set<SpawnedProcess>();
  const registry: CoworkHostProcessRegistry = {
    get size() {
      return activeProcesses.size;
    },
    terminateAll: () => terminateProcesses(activeProcesses),
    track: (child) => trackProcess(activeProcesses, child),
  };
  const registerExit = options.registerExit ?? ((listener) => process.once("exit", listener));
  registerExit(registry.terminateAll);
  return registry;
}

export function stageCoworkOAuthToken(
  token: string,
  dependencies: CoworkOAuthStageDependencies = {},
): number | undefined {
  const deps = oauthStageDependencies(dependencies);
  let directory: string | undefined;
  let descriptor: number | undefined;
  try {
    directory = deps.makeTemporaryDirectory(path.join(deps.temporaryDirectory(), "hlsp-"));
    const tokenPath = path.join(directory, "t");
    deps.writeFile(tokenPath, token, { encoding: "utf8", mode: 0o600 });
    descriptor = deps.openFile(tokenPath);
    deps.remove(tokenPath, { force: true });
    deps.remove(directory, { force: true, recursive: true });
    return descriptor;
  } catch (error) {
    if (descriptor !== undefined) safeClose(deps.closeFile, descriptor);
    if (directory) safeRemove(deps.remove, directory);
    deps.onError?.(error);
    return undefined;
  }
}

export function createCoworkHostProcessAdapter(
  options: CoworkHostProcessAdapterOptions = {},
): CoworkHostProcessAdapter | undefined {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return undefined;
  const registry =
    options.registry ?? createCoworkHostProcessRegistry({ registerExit: options.registerExit });
  const dependencies = processDependencies(options, registry);
  return (spawnOptions) => spawnCoworkHostProcess(spawnOptions, dependencies);
}

type ProcessDependencies = {
  closeFileDescriptor: (descriptor: number) => void;
  commandResolver: CoworkHostCommandResolver;
  onOAuthStageError?: (error: unknown) => void;
  onStderr?: (chunk: string) => void;
  registry: CoworkHostProcessRegistry;
  spawnProcess: CoworkHostSpawnImplementation;
  stageOAuthToken: (token: string) => number | undefined;
};

function spawnCoworkHostProcess(
  options: ClaudeSpawnOptions,
  dependencies: ProcessDependencies,
): SpawnedProcess {
  const command = dependencies.commandResolver({
    args: [...options.args],
    command: options.command,
  });
  const oauth = prepareOAuthSpawn(options.env, dependencies);
  let child: CoworkHostSpawnedProcess;
  try {
    child = dependencies.spawnProcess(command.command, command.args, {
      cwd: options.cwd,
      env: oauth.env,
      signal: options.signal,
      stdio: oauth.stdio,
      windowsHide: true,
    });
  } finally {
    if (oauth.descriptor !== undefined) {
      dependencies.closeFileDescriptor(oauth.descriptor);
    }
  }
  attachStderr(child, dependencies.onStderr);
  dependencies.registry.track(child);
  return child;
}

function prepareOAuthSpawn(
  sourceEnv: NodeJS.ProcessEnv,
  dependencies: ProcessDependencies,
): {
  descriptor?: number;
  env: NodeJS.ProcessEnv;
  stdio: CoworkHostNativeSpawnOptions["stdio"];
} {
  const env = { ...sourceEnv };
  const token = sourceEnv[CLAUDE_CODE_OAUTH_TOKEN];
  if (!token) return { env, stdio: ["pipe", "pipe", "pipe"] };
  const descriptor = tryStageOAuthToken(token, dependencies);
  if (descriptor === undefined) {
    return { env, stdio: ["pipe", "pipe", "pipe"] };
  }
  delete env[CLAUDE_CODE_OAUTH_TOKEN];
  env[CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR] = "3";
  return { descriptor, env, stdio: ["pipe", "pipe", "pipe", descriptor] };
}

function tryStageOAuthToken(token: string, dependencies: ProcessDependencies): number | undefined {
  try {
    return dependencies.stageOAuthToken(token);
  } catch (error) {
    dependencies.onOAuthStageError?.(error);
    return undefined;
  }
}

function processDependencies(
  options: CoworkHostProcessAdapterOptions,
  registry: CoworkHostProcessRegistry,
): ProcessDependencies {
  return {
    closeFileDescriptor: options.closeFileDescriptor ?? closeSync,
    commandResolver: options.commandResolver ?? identityCommand,
    onOAuthStageError: options.onOAuthStageError,
    onStderr: options.onStderr,
    registry,
    spawnProcess: options.spawnProcess ?? spawnNativeProcess,
    stageOAuthToken:
      options.stageOAuthToken ??
      ((token) => stageCoworkOAuthToken(token, { onError: options.onOAuthStageError })),
  };
}

function oauthStageDependencies(
  dependencies: CoworkOAuthStageDependencies,
): Required<Omit<CoworkOAuthStageDependencies, "onError">> &
  Pick<CoworkOAuthStageDependencies, "onError"> {
  return {
    closeFile: dependencies.closeFile ?? closeSync,
    makeTemporaryDirectory: dependencies.makeTemporaryDirectory ?? mkdtempSync,
    onError: dependencies.onError,
    openFile: dependencies.openFile ?? ((filePath) => openSync(filePath, "r")),
    remove: dependencies.remove ?? rmSync,
    temporaryDirectory: dependencies.temporaryDirectory ?? tmpdir,
    writeFile: dependencies.writeFile ?? writeFileSync,
  };
}

function spawnNativeProcess(
  command: string,
  args: string[],
  options: CoworkHostNativeSpawnOptions,
): CoworkHostSpawnedProcess {
  return nodeSpawn(command, args, options) as unknown as CoworkHostSpawnedProcess;
}

function trackProcess(activeProcesses: Set<SpawnedProcess>, child: SpawnedProcess): void {
  activeProcesses.add(child);
  const remove = () => activeProcesses.delete(child);
  child.once("exit", remove);
  child.once("error", remove);
}

function terminateProcesses(activeProcesses: Set<SpawnedProcess>): void {
  for (const child of activeProcesses) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}

function attachStderr(child: CoworkHostSpawnedProcess, onStderr?: (chunk: string) => void): void {
  if (!onStderr || !child.stderr) return;
  child.stderr.on("data", (chunk) => onStderr(String(chunk)));
}

function identityCommand(command: CoworkHostCommand): CoworkHostCommand {
  return { args: [...command.args], command: command.command };
}

function safeClose(closeFile: (descriptor: number) => void, descriptor: number): void {
  try {
    closeFile(descriptor);
  } catch {}
}

function safeRemove(remove: CoworkOAuthStageDependencies["remove"], directory: string): void {
  try {
    remove?.(directory, { force: true, recursive: true });
  } catch {}
}
