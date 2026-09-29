/**
 * Official BinaryDeployment `Her` residual, host-pipe subset.
 *
 * Full official path: RemoteServerController + ssh2 SFTP + remote `server --install`.
 * Product SSH stack is spawn("ssh") / scp. Maps:
 *   probe uname/libc  → JDe platform id
 *   userData/ssh-cli-cache  → xer local zst cache
 *   scp + chmod       → Crt SFTP upload of decompressed binary
 *   remote path       → `$HOME/.claude/remote/ccd-cli/<VOe>/claude`
 *
 * Does not invent RPC `--serve` / `--socket` / RemoteServerController.
 * Override: CLAUDE_SSH_REMOTE_EXECUTABLE (absolute remote path).
 */
import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";
import {
  OFFICIAL_CLAUDE_CODE_RELEASE,
  type OfficialClaudeCodePlatformId,
} from "./officialClaudeCodeRelease";
import { materializeOfficialClaudeCliZstBinary } from "./officialClaudeCodeManager";
import {
  buildScpArgv,
  probeRemoteHome,
} from "./sshHostPipePluginSync";
import {
  buildSshArgv,
  shellQuote,
  type SessionSshConfig,
} from "./sshTranscriptSync";

const execFileAsync = promisify(execFile);

const REMOTE_DIR = ".claude/remote";
const CCD_CLI = "ccd-cli";

export type SshRemoteCliInstallDeps = {
  execSsh?: (config: SessionSshConfig, remoteCommand: string) => Promise<{
    exitCode: number;
    stderr: string;
    stdout: string;
  }>;
  scp?: (config: SessionSshConfig, localFile: string, remoteRel: string) => Promise<void>;
};

function execOptions(): ExecFileOptions {
  return { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 180_000 };
}

async function defaultExec(
  config: SessionSshConfig,
  remoteCommand: string,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const argv = buildSshArgv(config, remoteCommand, { batchMode: true, connectTimeoutSeconds: 30 });
  try {
    const { stdout, stderr } = await execFileAsync("ssh", argv, execOptions());
    return {
      exitCode: 0,
      stderr: typeof stderr === "string" ? stderr : String(stderr ?? ""),
      stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
    };
  } catch (error) {
    const err = error as { code?: unknown; message?: string; stderr?: string; stdout?: string };
    return {
      exitCode: typeof err.code === "number" ? err.code : 1,
      stderr: err.stderr ?? err.message ?? "",
      stdout: err.stdout ?? "",
    };
  }
}

async function defaultScp(
  config: SessionSshConfig,
  localFile: string,
  remoteRel: string,
): Promise<void> {
  await execFileAsync("scp", buildScpArgv(config, localFile, remoteRel), execOptions());
}

/** Official JDe residual (uname + musl → VOe platform id). */
export function mapRemoteUnameToClaudePlatform(input: {
  unameS: string;
  unameM: string;
  musl: boolean;
}): OfficialClaudeCodePlatformId {
  const os = input.unameS.toLowerCase();
  const machine = input.unameM.toLowerCase();
  const arch = machine === "arm64" || machine === "aarch64" ? "arm64" : "x64";
  if (os.includes("mingw") || os.includes("msys") || os.includes("cygwin") || os.includes("windows")) {
    return arch === "arm64" ? "win32-arm64" : "win32-x64";
  }
  if (os.includes("darwin")) {
    return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  }
  if (input.musl) {
    return arch === "arm64" ? "linux-arm64-musl" : "linux-x64-musl";
  }
  return arch === "arm64" ? "linux-arm64" : "linux-x64";
}

export function remoteCcdCliPath(remoteHome: string, platform: OfficialClaudeCodePlatformId): string {
  const binary = platform.startsWith("win32") ? "claude.exe" : "claude";
  const home = remoteHome.replace(/\/+$/, "");
  return `${home}/${REMOTE_DIR}/${CCD_CLI}/${OFFICIAL_CLAUDE_CODE_RELEASE.version}/${binary}`;
}

const probeInFlight = new Map<string, Promise<string>>();

export async function ensureSshRemoteClaudeExecutable(
  config: SessionSshConfig,
  deps: SshRemoteCliInstallDeps = {},
): Promise<string> {
  const override = process.env.CLAUDE_SSH_REMOTE_EXECUTABLE?.trim();
  if (override) return override;

  const key = `${config.user ?? ""}@${config.hostName || config.host}:${config.port ?? config.sshPort ?? 22}`;
  const pending = probeInFlight.get(key);
  if (pending) return pending;

  const run = (async () => {
    const execSsh = deps.execSsh ?? defaultExec;
    const scp = deps.scp ?? defaultScp;
    const home = await probeRemoteHome(config, execSsh);
    const probe = await execSsh(
      config,
      'sh -c \'printf %s "$(uname -s)\\t$(uname -m)\\t"; (ldd /bin/sh 2>/dev/null | grep -q musl && printf musl) || printf gnu\'',
    );
    if (probe.exitCode !== 0) {
      throw new Error(`SSH remote uname failed: ${probe.stderr || probe.stdout}`);
    }
    const [unameS, unameM, libc] = probe.stdout.trim().split("\t");
    const platform = mapRemoteUnameToClaudePlatform({
      unameS: unameS || "Linux",
      unameM: unameM || "x86_64",
      musl: libc === "musl",
    });
    const remotePath = remoteCcdCliPath(home, platform);
    const exists = await execSsh(config, `sh -c 'test -x ${shellQuote(remotePath)} && printf ready'`);
    if (exists.exitCode === 0 && exists.stdout.trim() === "ready") return remotePath;

    const local = await materializeOfficialClaudeCliZstBinary(platform);
    const remoteDir = remotePath.slice(0, remotePath.lastIndexOf("/"));
    const mkdir = await execSsh(config, `sh -c 'mkdir -p ${shellQuote(remoteDir)} && chmod 700 ${shellQuote(`${home}/${REMOTE_DIR}`)} || true'`);
    if (mkdir.exitCode !== 0) {
      throw new Error(`SSH remote mkdir failed: ${mkdir.stderr || mkdir.stdout}`);
    }
    await scp(config, local, remotePath);
    const chmod = await execSsh(config, `sh -c 'chmod 755 ${shellQuote(remotePath)}'`);
    if (chmod.exitCode !== 0) {
      throw new Error(`SSH remote chmod failed: ${chmod.stderr || chmod.stdout}`);
    }
    return remotePath;
  })();

  probeInFlight.set(key, run);
  try {
    return await run;
  } finally {
    probeInFlight.delete(key);
  }
}
