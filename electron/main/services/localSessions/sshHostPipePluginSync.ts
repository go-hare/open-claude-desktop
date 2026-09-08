/**
 * Host-pipe adapter for official _Cr controller methods.
 *
 * Official FI: ssh2 SFTP mkdir/fastPut + RPC files.stat / files.extract_tar.
 * Product SSH stack is spawn("ssh") / scp (same as sshTranscriptSync / worktree).
 * Maps:
 *   remoteHome     → printf %s "$HOME"
 *   statFile       → test -e
 *   withSftp.mkdir → mkdir -p
 *   withSftp.fastPut → scp
 *   extractTar     → mkdir -p dest && tar -xzf archive -C dest && : > dest/.synced
 *
 * Does not invent RemoteServerController RPC / heartbeat / createSpawnFunction.
 */
import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";
import {
  buildSshArgv,
  shellQuote,
  sshTarget,
  type SessionSshConfig,
} from "./sshTranscriptSync";
import type { RemotePluginSyncController, RemotePluginSftp } from "./remotePluginSync";

const execFileAsync = promisify(execFile);

export type HostPipePluginSyncDeps = {
  execSsh?: (config: SessionSshConfig, remoteCommand: string) => Promise<{
    exitCode: number;
    stderr: string;
    stdout: string;
  }>;
  scp?: (config: SessionSshConfig, localFile: string, remoteRel: string) => Promise<void>;
};

function execOptions(): ExecFileOptions {
  return { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60_000 };
}

export function buildScpArgv(
  config: SessionSshConfig,
  localFile: string,
  remoteRel: string,
): string[] {
  const args: string[] = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
  for (const option of config.extraOptions ?? []) args.push("-o", option);
  const identity = config.identityFile || config.sshIdentityFile;
  if (identity) args.push("-i", identity);
  if (config.proxyJump) args.push("-J", config.proxyJump);
  const port = config.port ?? config.sshPort;
  if (port != null && String(port).length > 0) args.push("-P", String(port));
  args.push(localFile, `${sshTarget(config)}:${remoteRel}`);
  return args;
}

async function defaultScp(
  config: SessionSshConfig,
  localFile: string,
  remoteRel: string,
): Promise<void> {
  await execFileAsync("scp", buildScpArgv(config, localFile, remoteRel), execOptions());
}

async function defaultExec(
  config: SessionSshConfig,
  remoteCommand: string,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const argv = buildSshArgv(config, remoteCommand, { batchMode: true });
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

export async function probeRemoteHome(
  config: SessionSshConfig,
  execSsh: HostPipePluginSyncDeps["execSsh"] = defaultExec,
): Promise<string> {
  const result = await execSsh(config, 'sh -c \'printf %s "$HOME"\'');
  const home = result.stdout.trim().replace(/\\/g, "/");
  if (result.exitCode !== 0 || !home) {
    throw new Error(`RemotePluginSync: failed to probe remote HOME: ${result.stderr || result.stdout}`);
  }
  return home;
}

export type CcdSdkPluginPath = { path: string; type: "local" };

/**
 * Official setupSshPluginsAndMcp plugin rewrite:
 *   syncPluginDirsToRemote(controller, localPaths)
 *   A.plugins = mapped remote dirs; empty or throw → delete A.plugins
 */
export async function rewriteCcdPluginsForSsh(
  plugins: readonly CcdSdkPluginPath[],
  config: SessionSshConfig,
  deps: HostPipePluginSyncDeps & {
    createController?: (
      sshConfig: SessionSshConfig,
      pipeDeps: HostPipePluginSyncDeps,
    ) => Promise<RemotePluginSyncController>;
    sync?: typeof import("./remotePluginSync").syncPluginDirsToRemote;
  } = {},
): Promise<CcdSdkPluginPath[] | undefined> {
  if (plugins.length === 0) return undefined;
  try {
    const { syncPluginDirsToRemote } = await import("./remotePluginSync");
    const sync = deps.sync ?? syncPluginDirsToRemote;
    const controller = await (deps.createController ?? createHostPipeRemotePluginSyncController)(
      config,
      deps,
    );
    const mapped = await sync(
      controller,
      plugins.map((plugin) => plugin.path),
    );
    const rewritten = plugins.flatMap((plugin) => {
      const remote = mapped.get(plugin.path);
      return remote ? [{ type: "local" as const, path: remote }] : [];
    });
    return rewritten.length > 0 ? rewritten : undefined;
  } catch {
    return undefined;
  }
}

export async function createHostPipeRemotePluginSyncController(
  config: SessionSshConfig,
  deps: HostPipePluginSyncDeps = {},
): Promise<RemotePluginSyncController> {
  const execSsh = deps.execSsh ?? defaultExec;
  const scp = deps.scp ?? defaultScp;
  const remoteHome = await probeRemoteHome(config, execSsh);
  return {
    remoteHome,
    statFile: async (remotePath) => {
      const quoted = shellQuote(remotePath);
      const result = await execSsh(config, `sh -c ${shellQuote(`test -e ${quoted}`)}`);
      return { exists: result.exitCode === 0 };
    },
    withSftp: async (fn) => {
      const sftp: RemotePluginSftp = {
        mkdir: async (remote) => {
          const result = await execSsh(
            config,
            `sh -c ${shellQuote(`mkdir -p ${shellQuote(remoteHome + "/" + remote)}`)}`,
          );
          if (result.exitCode !== 0) {
            throw new Error(result.stderr || result.stdout || "mkdir failed");
          }
        },
        fastPut: async (local, remote) => {
          // Official SFTP cwd is remoteHome; host-pipe scp must use the same abs path
          // as extractTar / statFile (not login-cwd relative).
          const abs =
            remote.startsWith("/") || /^[A-Za-z]:/.test(remote)
              ? remote
              : `${remoteHome.replace(/\\/g, "/")}/${remote.replace(/^\.\//, "")}`;
          await scp(config, local, abs);
        },
      };
      await fn(sftp);
    },
    extractTar: async (archivePath, destDir) => {
      const cmd = [
        `mkdir -p ${shellQuote(destDir)}`,
        `tar -xzf ${shellQuote(archivePath)} -C ${shellQuote(destDir)}`,
        `: > ${shellQuote(`${destDir}/.synced`)}`,
      ].join(" && ");
      const result = await execSsh(config, `sh -c ${shellQuote(cmd)}`);
      if (result.exitCode !== 0) {
        return { success: false, error: result.stderr || result.stdout || "extract failed" };
      }
      return { success: true };
    },
  };
}
