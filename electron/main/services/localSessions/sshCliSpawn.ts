/**
 * Official LocalSessionManager SSH spawn residual (product host-pipe subset):
 *
 * Full official path (`configureSSHSpawn` + remote harness `createSpawnFunction` /
 * `htA` / RemoteServerController RPC) runs Claude CLI *on the remote host* via a
 * long-lived SSH controller with:
 *   - ensureReady + initialization_status steps
 *   - auto-reconnect (RECONNECT_BACKOFF_IDLE / CAP)
 *   - liveProcesses abandon on intentionalDisconnect
 *   - createSpawnFunction over RPC (not local `ssh` binary argv)
 *
 * Product host-pipe subset (no remote harness RPC — DO NOT invent controller):
 *   spawn("ssh", [...buildSshArgv, remoteShell]) where remoteShell is
 *   `cd <remoteCwd> && env … claude <args…>`
 * Wired as Options.spawnClaudeCodeProcess so SDK Query stays warm multi-turn.
 *
 * Already residual-aligned on product:
 *   - spawnClaudeCodeProcess host-pipe (this file)
 *   - W7i.adjustSdkOptions pt("1496676413") plugins/mcp strip
 *   - network_error → ssh_disconnected + query teardown
 *   - initialization_status ssh_spawn / complete / error (host-pipe steps only)
 *
 * Explicitly NOT productized (needs remote harness):
 *   - RemoteServerController auto-reconnect / ensureReady warm_up loops
 *   - RPC createSpawnFunction / liveProcesses abandon
 *   - full setupSshPluginsAndMcp coordinator
 *
 * Stdin/stdout remain NDJSON stream-json (same as local spawnClaude).
 * Transcript still lands on the remote host under ~/.claude/projects; getTranscript
 * byte-syncs via sshTranscriptSync (class Atr).
 *
 * Env filter matches official createSpawnFunction: only CLAUDE_*, ANTHROPIC_*,
 * DISABLE_AUTOUPDATER — drop host-only *_FILE_DESCRIPTOR / CLAUDE_CODE_HOST_* /
 * CLAUDE_CODE_SSE_PORT / CLAUDE_CODE_CONTAINER_ID / CLAUDE_CONFIG_DIR /
 * CLAUDE_CODE_TMPDIR / CLAUDE_AI_URL.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import {
  buildSshArgv,
  shellQuote,
  type SessionSshConfig,
} from "./sshTranscriptSync";

export type SshClaudeSpawnOptions = {
  sshConfig: SessionSshConfig;
  /** Remote working directory (official remoteCwd / worktreePath / cwd). */
  remoteCwd: string;
  /** CLI argv after the executable (e.g. --print --output-format stream-json …). */
  args: string[];
  /** Remote CLI binary name/path (official pathToClaudeCodeExecutable default "claude"). */
  remoteExecutable?: string;
  /**
   * Host-resolved env map (buildClaudeCliSpawnEnv). Only a filtered subset is
   * forwarded to the remote process (official createSpawnFunction filter).
   */
  hostEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Local spawn cwd (unused by remote CLI; defaults process.cwd()). */
  localCwd?: string;
};

const HOST_ONLY_ENV = new Set([
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_CODE_CONTAINER_ID",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_TMPDIR",
  "CLAUDE_AI_URL",
]);

/**
 * Official createSpawnFunction env filter residual.
 * Keep CLAUDE_* / ANTHROPIC_* / DISABLE_AUTOUPDATER; drop host-only keys.
 */
export function filterRemoteClaudeEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!env) return out;
  for (const [key, value] of Object.entries(env)) {
    if (value == null || value === "") continue;
    if (
      !(
        key.startsWith("CLAUDE_") ||
        key.startsWith("ANTHROPIC_") ||
        key === "DISABLE_AUTOUPDATER"
      )
    ) {
      continue;
    }
    if (key.endsWith("_FILE_DESCRIPTOR")) continue;
    if (key.startsWith("CLAUDE_CODE_HOST_")) continue;
    if (HOST_ONLY_ENV.has(key)) continue;
    out[key] = String(value);
  }
  return out;
}

function shellEscapeArg(value: string): string {
  // Prefer single-quote form for remote sh -c payload pieces.
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return shellQuote(value);
}

/**
 * Build remote `sh -c` payload:
 *   cd <cwd> && env K=V … claude <args>
 */
export function buildRemoteClaudeShellCommand(options: {
  remoteCwd: string;
  remoteExecutable: string;
  args: string[];
  env: Record<string, string>;
}): string {
  const cwd = options.remoteCwd || ".";
  const envPrefix = Object.entries(options.env)
    .map(([key, value]) => `${key}=${shellEscapeArg(value)}`)
    .join(" ");
  const cli = [shellEscapeArg(options.remoteExecutable), ...options.args.map(shellEscapeArg)].join(" ");
  const body = envPrefix ? `env ${envPrefix} ${cli}` : cli;
  return `cd ${shellEscapeArg(cwd)} && ${body}`;
}

/**
 * Spawn Claude CLI on the remote host over SSH (host-pipe).
 * Child stdin/stdout are the remote CLI's stream-json pipes.
 */
export function spawnClaudeOverSsh(options: SshClaudeSpawnOptions): ChildProcessWithoutNullStreams {
  const remoteExecutable = options.remoteExecutable || process.env.CLAUDE_SSH_REMOTE_EXECUTABLE || "claude";
  const remoteEnv = filterRemoteClaudeEnv(options.hostEnv ?? process.env);
  const remoteShell = buildRemoteClaudeShellCommand({
    remoteCwd: options.remoteCwd,
    remoteExecutable,
    args: options.args,
    env: remoteEnv,
  });
  // Outer sh -c so remote login shells don't mangle argv; matches transcript exec style.
  const remoteCommand = `sh -c ${shellQuote(remoteShell)}`;
  const argv = buildSshArgv(options.sshConfig, remoteCommand, {
    batchMode: true,
    connectTimeoutSeconds: 30,
  });
  const localCwd = options.localCwd || process.cwd();
  return spawn("ssh", argv, {
    cwd: localCwd,
    env: process.env,
    windowsHide: true,
  });
}

/** Resolve remote cwd for an SSH session (official remoteCwd / worktree / cwd order). */
export function resolveSshRemoteCwd(session: {
  sshConfig?: SessionSshConfig | null;
  worktreePath?: string;
  cwd?: string;
  originCwd?: string;
}): string {
  const fromConfig = session.sshConfig?.remoteCwd;
  if (fromConfig && fromConfig.trim()) return fromConfig.trim();
  if (session.worktreePath && session.worktreePath.trim()) return session.worktreePath.trim();
  if (session.cwd && session.cwd.trim()) return session.cwd.trim();
  if (session.originCwd && session.originCwd.trim()) return session.originCwd.trim();
  return "~";
}

/**
 * Official configureSSHSpawn → spawnClaudeCodeProcess residual (product host-pipe):
 * ProcessTransport calls this instead of local spawn; remote CLI still speaks stream-json.
 * Full official path uses long-lived SSH controller RPC (htA); product host-pipe is the
 * residual subset that keeps Query warm multi-turn without inventing remote harness.
 */
export function createSshSpawnClaudeCodeProcess(input: {
  sshConfig: SessionSshConfig;
  remoteCwd: string;
  /** Optional stderr capture (official createSpawnFunction wires stderr.on data). */
  onStderr?: (chunk: string) => void;
}): (options: SpawnOptions) => SpawnedProcess {
  return (options) => {
    const child = spawnClaudeOverSsh({
      sshConfig: input.sshConfig,
      remoteCwd: input.remoteCwd || options.cwd || "~",
      args: options.args,
      remoteExecutable: options.command || process.env.CLAUDE_SSH_REMOTE_EXECUTABLE || "claude",
      hostEnv: options.env,
      localCwd: process.cwd(),
    });
    if (input.onStderr) {
      child.stderr.on("data", (chunk: Buffer | string) => {
        input.onStderr?.(chunk.toString());
      });
    }
    // ChildProcess satisfies SpawnedProcess (stdin/stdout + exit/error/kill).
    return child as unknown as SpawnedProcess;
  };
}
