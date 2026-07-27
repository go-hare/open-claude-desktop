/**
 * Official LocalSessionManager SSH transcript byte-sync residual (`class Atr` in index.js):
 *
 * Remote Code sessions write jsonl on the SSH host under
 *   $CLAUDE_CONFIG_DIR/projects/<mangled>/...
 * Desktop mirrors bytes locally to:
 *   ~/.claude/projects/ssh-<cliSessionId>/<cliSessionId>.jsonl
 * (+ agent-*.jsonl) via `tail -c +offset`, then loadTranscriptFromDisk reads the mirror.
 *
 * This module is the Atr surface. Full remote CLI spawn is separate; once a session
 * carries sshConfig + cliSessionId, getTranscript uses fetchRemoteTranscript.
 */

import { createWriteStream, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFile, type ExecFileOptions } from "node:child_process";
import { mkdir, open, stat, truncate, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { readCodeTranscript } from "./codeTranscriptJsonl";

const execFileAsync = promisify(execFile);

/**
 * Minimal SSH target.
 * Product host form uses `host` / `identityFile` (ssh_configs.json + ~/.ssh/config).
 * Official residual (`Hd` / session.sshConfig) uses `sshHost` / `sshPort` / `sshIdentityFile` / `remoteCwd`.
 * Both shapes are accepted via normalizeSessionSshConfig.
 */
export type SessionSshConfig = {
  host: string;
  hostName?: string;
  user?: string;
  port?: number | string;
  identityFile?: string;
  proxyJump?: string;
  /** Official residual field — remote working directory for spawn / PTY / worktree. */
  remoteCwd?: string;
  /** Official residual aliases kept for bridge fidelity. */
  sshHost?: string;
  sshPort?: number | string;
  sshIdentityFile?: string;
  /** Extra ssh -o options (BatchMode etc. applied by default for non-interactive). */
  extraOptions?: string[];
  /** Optional display name from ssh_configs.json. */
  name?: string;
  id?: string;
};

export type SshTranscriptSession = {
  sessionId: string;
  cliSessionId?: string;
  sshConfig?: SessionSshConfig | null;
  sshRemoteTranscriptPath?: string;
  sshRemoteProjectDir?: string;
  /** Bytes already mirrored for the main jsonl (official sshLocalTranscriptSize). */
  sshLocalTranscriptSize?: number;
};

export type SshTranscriptSyncHooks = {
  configDir?: string;
  /** Persist cursor / remote path fields back onto the session store. */
  onSessionPatch?: (patch: Partial<SshTranscriptSession>) => void;
  /** Official onLocalFileRewritten — invalidate disk transcript cache for cliSessionId. */
  onLocalFileRewritten?: (cliSessionId: string) => void;
  /** Injected exec for tests. */
  execSsh?: (config: SessionSshConfig, remoteCommand: string) => Promise<SshExecResult>;
};

export type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/** In-memory agent tail cursors (official sshSubagentSyncedSizes Map) — not persisted. */
const subagentSyncedSizes = new Map<string, Map<string, number>>();
/** Single-flight per session (official sshSyncInFlight). */
const syncInFlight = new Map<string, Promise<void>>();

function defaultConfigDir(configDir?: string): string {
  return configDir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

/** POSIX single-quote for remote sh -c payloads (official ys residual subset). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function getLocalSSHSessionDir(
  cliSessionId: string,
  configDir?: string,
): string {
  return join(defaultConfigDir(configDir), "projects", `ssh-${cliSessionId}`);
}

export function getLocalSSHTranscriptPath(
  cliSessionId: string,
  configDir?: string,
): string {
  return join(getLocalSSHSessionDir(cliSessionId, configDir), `${cliSessionId}.jsonl`);
}

export type BuildSshArgvOptions = {
  /** Non-interactive default: BatchMode + ConnectTimeout. Interactive PTY should disable. */
  batchMode?: boolean;
  /** Force remote TTY allocation (`-tt`) for node-pty shells. */
  forceTty?: boolean;
  connectTimeoutSeconds?: number;
};

/**
 * Build `ssh` argv for a remote command (or bare login when remoteCommand omitted).
 * Target order: options → identity → jump → port → [ -tt ] → user@host → [command].
 */
export function buildSshArgv(
  config: SessionSshConfig,
  remoteCommand?: string,
  options: BuildSshArgvOptions = {},
): string[] {
  const batchMode = options.batchMode !== false;
  const args: string[] = [];
  if (batchMode) {
    args.push("-o", "BatchMode=yes");
    args.push("-o", `ConnectTimeout=${options.connectTimeoutSeconds ?? 15}`);
  } else if (options.connectTimeoutSeconds != null) {
    args.push("-o", `ConnectTimeout=${options.connectTimeoutSeconds}`);
  }
  for (const option of config.extraOptions ?? []) args.push("-o", option);
  const identity = config.identityFile || config.sshIdentityFile;
  if (identity) args.push("-i", identity);
  if (config.proxyJump) args.push("-J", config.proxyJump);
  const port = config.port ?? config.sshPort;
  if (port != null && String(port).length > 0) {
    args.push("-p", String(port));
  }
  if (options.forceTty) args.push("-tt");
  args.push(sshTarget(config));
  if (remoteCommand != null && remoteCommand.length > 0) args.push(remoteCommand);
  return args;
}

/** user@hostName (or host / sshHost). */
export function sshTarget(config: SessionSshConfig): string {
  const hostName = config.hostName || config.host || config.sshHost || "";
  return config.user ? `${config.user}@${hostName}` : hostName;
}

/**
 * Normalize official (`sshHost`/`sshPort`/`sshIdentityFile`/`remoteCwd`) and product
 * (`host`/`port`/`identityFile`) into a single SessionSshConfig.
 */
export function normalizeSessionSshConfig(value: unknown): SessionSshConfig | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return { host: value.trim(), sshHost: value.trim() };
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const host =
    (typeof raw.host === "string" && raw.host) ||
    (typeof raw.sshHost === "string" && raw.sshHost) ||
    (typeof raw.hostName === "string" && raw.hostName) ||
    (typeof raw.name === "string" && raw.name) ||
    "";
  if (!host) return null;
  const hostName =
    (typeof raw.hostName === "string" && raw.hostName) ||
    (typeof raw.hostname === "string" && raw.hostname) ||
    host;
  const user = typeof raw.user === "string" && raw.user ? raw.user : undefined;
  const port = raw.port ?? raw.sshPort;
  const identityFile =
    (typeof raw.identityFile === "string" && raw.identityFile) ||
    (typeof raw.identityfile === "string" && raw.identityfile) ||
    (typeof raw.sshIdentityFile === "string" && raw.sshIdentityFile) ||
    undefined;
  const proxyJump =
    (typeof raw.proxyJump === "string" && raw.proxyJump) ||
    (typeof raw.ProxyJump === "string" && raw.ProxyJump) ||
    undefined;
  const remoteCwd =
    (typeof raw.remoteCwd === "string" && raw.remoteCwd) ||
    (typeof raw.cwd === "string" && raw.cwd) ||
    undefined;
  const extraOptions = Array.isArray(raw.extraOptions)
    ? raw.extraOptions.filter((item): item is string => typeof item === "string" && item.length > 0)
    : undefined;
  return {
    host,
    hostName,
    user,
    port: port as number | string | undefined,
    identityFile,
    proxyJump,
    remoteCwd,
    sshHost: typeof raw.sshHost === "string" ? raw.sshHost : host,
    sshPort: (raw.sshPort ?? port) as number | string | undefined,
    sshIdentityFile: typeof raw.sshIdentityFile === "string" ? raw.sshIdentityFile : identityFile,
    extraOptions,
    name: typeof raw.name === "string" ? raw.name : undefined,
    id: typeof raw.id === "string" ? raw.id : undefined,
  };
}

export async function defaultExecSsh(
  config: SessionSshConfig,
  remoteCommand: string,
): Promise<SshExecResult> {
  const argv = buildSshArgv(config, remoteCommand, { batchMode: true });
  const options: ExecFileOptions = {
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    encoding: "utf8",
  };
  try {
    const { stdout, stderr } = await execFileAsync("ssh", argv, options);
    return {
      stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
      stderr: typeof stderr === "string" ? stderr : String(stderr ?? ""),
      exitCode: 0,
    };
  } catch (error) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
      code?: unknown;
    };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? "",
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

function sessionKey(session: SshTranscriptSession): string {
  return session.sessionId || session.cliSessionId || "unknown";
}

/**
 * Official resolveRemoteTranscriptPath:
 *   find "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects -name <id>.jsonl -print -quit
 */
export async function resolveRemoteTranscriptPath(
  session: SshTranscriptSession,
  hooks: SshTranscriptSyncHooks = {},
): Promise<string | null> {
  if (session.sshRemoteTranscriptPath) return session.sshRemoteTranscriptPath;
  if (!session.sshConfig || !session.cliSessionId) return null;

  const execSsh = hooks.execSsh ?? defaultExecSsh;
  const id = session.cliSessionId;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;

  const remote = `find "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects -name ${shellQuote(`${id}.jsonl`)} -print -quit 2>/dev/null`;
  const result = await execSsh(session.sshConfig, `sh -c ${shellQuote(remote)}`);
  if (result.exitCode !== 0 || !result.stdout.trim()) return null;

  const remotePath = result.stdout.trim().split(/\r?\n/)[0]?.trim();
  if (!remotePath) return null;

  const projectDir = remotePath.replace(/\/[^/]+$/, "");
  hooks.onSessionPatch?.({
    sshRemoteTranscriptPath: remotePath,
    sshRemoteProjectDir: projectDir,
  });
  session.sshRemoteTranscriptPath = remotePath;
  session.sshRemoteProjectDir = projectDir;
  return remotePath;
}

/**
 * Official bootstrapLocalTranscriptSize: if local first line matches remote head -n1,
 * keep local size as the sync cursor; otherwise truncate and resync from 0.
 */
export async function bootstrapLocalTranscriptSize(
  session: SshTranscriptSession,
  localPath: string,
  remotePath: string,
  hooks: SshTranscriptSyncHooks = {},
): Promise<number> {
  let localStat;
  try {
    localStat = await stat(localPath);
  } catch {
    return 0;
  }
  if (localStat.size === 0 || !session.sshConfig) return 0;

  const execSsh = hooks.execSsh ?? defaultExecSsh;
  const head = await execSsh(
    session.sshConfig,
    `sh -c ${shellQuote(`head -n1 ${shellQuote(remotePath)}`)}`,
  );
  if (head.exitCode !== 0) {
    await truncate(localPath, 0);
    if (session.cliSessionId) hooks.onLocalFileRewritten?.(session.cliSessionId);
    return 0;
  }
  const remoteFirst = head.stdout.replace(/\n$/, "");

  let localFirst = "";
  try {
    const handle = await open(localPath, "r");
    try {
      const buf = Buffer.alloc(Math.min(localStat.size, 65_536));
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      const text = buf.subarray(0, bytesRead).toString("utf8");
      const nl = text.indexOf("\n");
      localFirst = (nl === -1 ? text : text.slice(0, nl)).replace(/\uFFFD+$/, "");
    } finally {
      await handle.close();
    }
  } catch {
    await truncate(localPath, 0);
    if (session.cliSessionId) hooks.onLocalFileRewritten?.(session.cliSessionId);
    return 0;
  }

  if (localFirst.length > 0 && remoteFirst.startsWith(localFirst)) {
    return localStat.size;
  }

  await truncate(localPath, 0);
  if (session.cliSessionId) hooks.onLocalFileRewritten?.(session.cliSessionId);
  return 0;
}

async function appendUtf8(filePath: string, chunk: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createWriteStream(filePath, { flags: "a", encoding: "utf8" });
    stream.on("error", reject);
    stream.end(chunk, (error?: Error | null) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

/**
 * Official syncRemoteSubagentTranscripts — tail each remote agent-*.jsonl into the
 * local ssh-<id> mirror dir with per-file size cursors.
 */
export async function syncRemoteSubagentTranscripts(
  session: SshTranscriptSession,
  hooks: SshTranscriptSyncHooks = {},
): Promise<void> {
  if (!session.sshConfig || !session.sshRemoteProjectDir || !session.cliSessionId) return;

  const execSsh = hooks.execSsh ?? defaultExecSsh;
  const listCmd = `ls -1 ${shellQuote(session.sshRemoteProjectDir)}/agent-*.jsonl 2>/dev/null`;
  const listed = await execSsh(session.sshConfig, `sh -c ${shellQuote(listCmd)}`);
  if (listed.exitCode !== 0 || !listed.stdout.trim()) return;

  const localDir = getLocalSSHSessionDir(session.cliSessionId, hooks.configDir);
  await mkdir(localDir, { recursive: true });

  const key = sessionKey(session);
  let sizes = subagentSyncedSizes.get(key);
  if (!sizes) {
    sizes = new Map();
    subagentSyncedSizes.set(key, sizes);
  }

  const resolvedLocalDir = resolve(localDir);
  for (const remoteFile of listed.stdout.trim().split(/\r?\n/)) {
    const name = basename(remoteFile.trim());
    if (!name.startsWith("agent-") || !name.endsWith(".jsonl")) continue;
    // Path traversal guard (official kw resolve under local dir).
    const localFile = resolve(localDir, name);
    if (!localFile.startsWith(resolvedLocalDir + "/") && localFile !== resolvedLocalDir) {
      continue;
    }

    let cursor = sizes.get(name);
    if (cursor == null) {
      try {
        cursor = (await stat(localFile)).size;
      } catch {
        cursor = 0;
      }
      sizes.set(name, cursor);
    }

    const tailCmd = `tail -c +${cursor + 1} ${shellQuote(remoteFile.trim())}`;
    const tailed = await execSsh(session.sshConfig, `sh -c ${shellQuote(tailCmd)}`);
    if (tailed.exitCode !== 0 || tailed.stdout.length === 0) continue;
    const lastNl = tailed.stdout.lastIndexOf("\n");
    if (lastNl === -1) continue;
    const chunk = tailed.stdout.slice(0, lastNl + 1);
    await appendUtf8(localFile, chunk);
    sizes.set(name, cursor + Buffer.byteLength(chunk, "utf8"));
  }
}

async function doPersistSSHTranscript(
  session: SshTranscriptSession,
  hooks: SshTranscriptSyncHooks = {},
): Promise<void> {
  if (!session.sshConfig || !session.cliSessionId) return;

  const remotePath = await resolveRemoteTranscriptPath(session, hooks);
  if (!remotePath) return;

  const localDir = getLocalSSHSessionDir(session.cliSessionId, hooks.configDir);
  await mkdir(localDir, { recursive: true });
  const localPath = getLocalSSHTranscriptPath(session.cliSessionId, hooks.configDir);

  if (!existsSync(localPath)) {
    await writeFile(localPath, "", "utf8");
  }

  let cursor = session.sshLocalTranscriptSize;
  if (cursor == null) {
    cursor = await bootstrapLocalTranscriptSize(session, localPath, remotePath, hooks);
    session.sshLocalTranscriptSize = cursor;
    hooks.onSessionPatch?.({ sshLocalTranscriptSize: cursor });
  }

  const execSsh = hooks.execSsh ?? defaultExecSsh;
  const tailCmd = `tail -c +${cursor + 1} ${shellQuote(remotePath)}`;
  const tailed = await execSsh(session.sshConfig, `sh -c ${shellQuote(tailCmd)}`);
  if (tailed.exitCode !== 0) return;

  if (tailed.stdout.length > 0) {
    const lastNl = tailed.stdout.lastIndexOf("\n");
    if (lastNl !== -1) {
      const chunk = tailed.stdout.slice(0, lastNl + 1);
      await appendUtf8(localPath, chunk);
      const next = cursor + Buffer.byteLength(chunk, "utf8");
      session.sshLocalTranscriptSize = next;
      hooks.onSessionPatch?.({ sshLocalTranscriptSize: next });

      // Official deletes stale projects/ssh-sessions/<id>.jsonl alias if present.
      const staleAlias = join(
        defaultConfigDir(hooks.configDir),
        "projects",
        "ssh-sessions",
        `${session.cliSessionId}.jsonl`,
      );
      await unlink(staleAlias).catch(() => undefined);
    }
  }

  await syncRemoteSubagentTranscripts(session, hooks);
}

/** Official persistSSHTranscript — single-flight per session. */
export function persistSSHTranscript(
  session: SshTranscriptSession,
  hooks: SshTranscriptSyncHooks = {},
): Promise<void> {
  if (!session.sshConfig || !session.cliSessionId) return Promise.resolve();
  const key = sessionKey(session);
  const existing = syncInFlight.get(key);
  if (existing) return existing;
  const pending = doPersistSSHTranscript(session, hooks).finally(() => {
    syncInFlight.delete(key);
  });
  syncInFlight.set(key, pending);
  return pending;
}

/** Official flushSSHTranscript: await in-flight then sync once more. */
export async function flushSSHTranscript(
  session: SshTranscriptSession,
  hooks: SshTranscriptSyncHooks = {},
): Promise<void> {
  if (!session.sshConfig) return;
  const key = sessionKey(session);
  await syncInFlight.get(key);
  await persistSSHTranscript(session, hooks);
}

/**
 * Official fetchRemoteTranscript:
 *   persistSSHTranscript → loadTranscriptFromDisk (local ssh-<id> mirror).
 */
export async function fetchRemoteTranscript(
  session: SshTranscriptSession,
  hooks: SshTranscriptSyncHooks = {},
): Promise<unknown[]> {
  if (!session.sshConfig || !session.cliSessionId) return [];
  await persistSSHTranscript(session, hooks);
  return readCodeTranscript(session.cliSessionId, {
    // Prefer the ssh-<id> mirror dir; resolveCodeProjectDir always tries ssh-${id}.
    cwd: getLocalSSHSessionDir(session.cliSessionId, hooks.configDir),
  }, hooks.configDir);
}

/** Test helper. */
export function clearSshTranscriptSyncState(): void {
  subagentSyncedSizes.clear();
  syncInFlight.clear();
}
