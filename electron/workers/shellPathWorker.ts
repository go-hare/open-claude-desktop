/**
 * UtilityProcess worker: login-shell PATH / env extraction.
 * data-official-source: app.asar .vite/build/shell-path-worker/shellPathWorker.js
 *
 * Messages (MessagePort):
 *   → { type: "getPath" } → { type: "result", path } | { type: "error", message }
 *   → { type: "getEnvironment" } → { type: "envResult", env } | { type: "error", message }
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

type SpawnResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

type SpawnAsyncOptions = SpawnOptionsWithoutStdio & {
  ignoreExitCode?: boolean;
  maxBuffer?: number;
  stdin?: string | Buffer;
  timeout?: number;
};

function getDisclaimerBinaryPath(): string {
  const contentsPath = path.dirname(process.resourcesPath);
  return path.join(contentsPath, "Helpers", "disclaimer");
}

function getUntrustedLaunchOptions(options: { cmd: string; args: string[] }): {
  cmd: string;
  args: string[];
} {
  if (process.platform !== "darwin") {
    return options;
  }
  const disclaimerPath = getDisclaimerBinaryPath();
  return {
    cmd: disclaimerPath,
    args: [options.cmd, ...options.args],
  };
}

const DEFAULT_MAX_BUFFER = 512 * 1024 * 1024;

function spawnAsyncDirect(cmd: string, args: string[] = [], options: SpawnAsyncOptions = {}): Promise<SpawnResult> {
  const { ignoreExitCode, maxBuffer = DEFAULT_MAX_BUFFER, stdin, timeout, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      ...spawnOptions,
      stdio: [stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });

    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (typeof timeout === "number" && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout);
    }

    if (stdin !== undefined && proc.stdin) {
      proc.stdin.on("error", () => undefined);
      proc.stdin.write(stdin);
      proc.stdin.end();
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let totalBytes = 0;
    let killed = false;

    const onData = (chunks: Buffer[]) => (data: Buffer) => {
      totalBytes += data.length;
      if (totalBytes > maxBuffer) {
        killed = true;
        proc.kill();
        return;
      }
      chunks.push(data);
    };

    proc.stdout?.on("data", onData(stdout));
    proc.stderr?.on("data", onData(stderr));

    proc.on("error", (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(new Error(`Failed to spawn ${cmd}: ${error.message}`));
    });

    let exitGraceTimer: NodeJS.Timeout | undefined;
    proc.on("exit", () => {
      if (!proc.killed) return;
      exitGraceTimer = setTimeout(() => {
        proc.stdout?.destroy();
        proc.stderr?.destroy();
      }, 1000);
    });

    proc.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (exitGraceTimer) clearTimeout(exitGraceTimer);
      if (timedOut) {
        reject(new Error(`${cmd} timed out after ${timeout}ms`));
        return;
      }
      if (killed) {
        reject(new Error(`${cmd} output exceeded maxBuffer limit (${maxBuffer} bytes)`));
        return;
      }
      const result: SpawnResult = {
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        code,
      };
      if (!ignoreExitCode && code !== 0) {
        const error = new Error(`${cmd} exited with code ${code}: ${result.stderr || result.stdout}`) as Error & {
          result: SpawnResult;
        };
        error.result = result;
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

async function spawnAsync(cmd: string, args: string[] = [], options: SpawnAsyncOptions = {}): Promise<SpawnResult> {
  const untrusted = getUntrustedLaunchOptions({ cmd, args });
  try {
    return await spawnAsyncDirect(untrusted.cmd, untrusted.args, options);
  } catch (error) {
    if (untrusted.cmd !== cmd && error instanceof Error) {
      const isEnoent = error.message.includes("ENOENT");
      if (isEnoent) {
        throw new Error(`Failed to spawn ${cmd} (disclaimer binary not found): ${error.message}`);
      }
      throw new Error(`Failed to spawn ${cmd} (via disclaimer): ${error.message}`);
    }
    throw error;
  }
}

const OTEL_TRUST_SAFE_ENV_VARS = [
  "CLAUDE_CODE_ENABLE_TELEMETRY",
  "CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_LOGS_HEADERS",
  "OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
  "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
  "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
  "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
  "OTEL_LOG_TOOL_DETAILS",
  "OTEL_LOG_USER_PROMPTS",
  "OTEL_LOGS_EXPORT_INTERVAL",
  "OTEL_LOGS_EXPORTER",
  "OTEL_METRIC_EXPORT_INTERVAL",
  "OTEL_METRICS_EXPORTER",
  "OTEL_METRICS_INCLUDE_ACCOUNT_UUID",
  "OTEL_METRICS_INCLUDE_SESSION_ID",
  "OTEL_METRICS_INCLUDE_VERSION",
  "OTEL_RESOURCE_ATTRIBUTES",
] as const;

const OTEL_USER_ENV_VARS = [
  ...OTEL_TRUST_SAFE_ENV_VARS,
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_CLIENT_KEY",
  "OTEL_EXPORTER_OTLP_LOGS_CLIENT_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_LOGS_CLIENT_KEY",
  "OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY",
  "OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY",
] as const;

const SHELL_TIMEOUT_MS = 4000;
const PATH_SENTINEL = "___CLAUDE_PATH_EXTRACT___";
const ENV_SENTINEL = "___CLAUDE_ENV_EXTRACT___";

const CC_ENV_EXTRACT_LIST = new Set<string>([
  "PATH",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_TMPDIR",
  "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_CODE_SHELL",
  "CLAUDE_CODE_SHELL_PREFIX",
  "ANTHROPIC_BASE_URL",
  "SSH_AUTH_SOCK",
  "GPG_TTY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  ...OTEL_USER_ENV_VARS,
]);

const COMMON_SHELLS: Array<{ path: string; hints?: string[] }> = [
  {
    path: "/bin/zsh",
    hints: [path.resolve(os.homedir(), ".zshrc")],
  },
  { path: "/bin/bash", hints: [path.resolve(os.homedir(), ".bashrc")] },
  { path: "/bin/sh" },
];

function getSafeShell(): string {
  const envShell = process.env.SHELL;
  if (envShell?.startsWith("/") && fs.existsSync(envShell)) {
    return envShell;
  }
  for (const shell of COMMON_SHELLS) {
    if (fs.existsSync(shell.path) && shell.hints?.some((hint) => fs.existsSync(hint))) {
      return shell.path;
    }
  }
  for (const shell of COMMON_SHELLS) {
    if (fs.existsSync(shell.path)) {
      return shell.path;
    }
  }
  return "/bin/sh";
}

function probeEnv(): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    SHELL: process.env.SHELL,
    USER: process.env.USER,
    DISABLE_AUTO_UPDATE: "true",
    ZSH_DISABLE_COMPFIX: "true",
    CLAUDE_DESKTOP_RESOLVING_ENVIRONMENT: "1",
  };
}

async function extractPathFromShell(): Promise<string> {
  if (process.platform === "win32") {
    return process.env.PATH || "";
  }
  const shell = getSafeShell();
  const { stdout } = await spawnAsync(
    shell,
    ["-l", "-i", "-c", `/bin/sh -c 'printf "%s%s\\n" "${PATH_SENTINEL}" "$PATH"'`],
    {
      timeout: SHELL_TIMEOUT_MS,
      env: probeEnv(),
    },
  );
  const match = stdout.match(new RegExp(`${PATH_SENTINEL}(.*)$`, "m"));
  return match?.[1]?.trim() || process.env.PATH || "";
}

function isCCEnvVar(name: string): boolean {
  return CC_ENV_EXTRACT_LIST.has(name);
}

async function extractShellEnvironment(): Promise<Record<string, string>> {
  if (process.platform === "win32") {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && isCCEnvVar(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  const shell = getSafeShell();
  const { stdout } = await spawnAsync(shell, ["-l", "-i", "-c", `echo "${ENV_SENTINEL}"; env`], {
    timeout: SHELL_TIMEOUT_MS,
    env: probeEnv(),
  });

  const sentinelIdx = stdout.indexOf(ENV_SENTINEL);
  if (sentinelIdx === -1) {
    return { PATH: process.env.PATH || "" };
  }

  const envOutput = stdout.slice(sentinelIdx + ENV_SENTINEL.length + 1).trim();
  const result: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentValue: string | null = null;

  for (const line of envOutput.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, eqIdx))) {
      if (currentKey !== null && currentValue !== null && isCCEnvVar(currentKey)) {
        result[currentKey] = currentValue;
      }
      currentKey = line.slice(0, eqIdx);
      currentValue = line.slice(eqIdx + 1);
    } else if (eqIdx > 0) {
      if (currentKey !== null && currentValue !== null && isCCEnvVar(currentKey)) {
        result[currentKey] = currentValue;
      }
      currentKey = null;
      currentValue = null;
    } else if (currentKey !== null && currentValue !== null) {
      currentValue += `\n${line}`;
    }
  }

  if (currentKey !== null && currentValue !== null && isCCEnvVar(currentKey)) {
    result[currentKey] = currentValue;
  }
  if (!result.PATH) {
    result.PATH = process.env.PATH || "";
  }
  return result;
}

/**
 * Electron UtilityProcess MessagePort (MessagePortMain at runtime).
 * Structural type avoids DOM MessagePort vs MessagePortMain tsc clash.
 */
type UtilityMessagePort = {
  start: () => void;
  close: () => void;
  postMessage: (message: unknown) => void;
  on: (event: "message" | "close", listener: (...args: any[]) => void) => void;
};

type ParentPortLike = {
  once: (
    event: "message",
    listener: (e: {
      data?: { type?: string };
      ports?: UtilityMessagePort[];
    }) => void,
  ) => void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) {
  throw new Error("shellPathWorker must run as Electron UtilityProcess");
}

parentPort.once("message", (e) => {
  const port = e.ports?.[0] as unknown as UtilityMessagePort | undefined;
  if (e.data?.type !== "init" || !port) {
    process.exit(1);
  }
  port.on("message", async (event: { data?: { type?: string } }) => {
    const data = event.data as { type?: string } | undefined;
    if (data?.type === "getPath") {
      try {
        if (process.platform === "win32") {
          port.postMessage({ type: "result", path: process.env.PATH || "" });
          return;
        }
        const shellPath = await extractPathFromShell();
        port.postMessage({ type: "result", path: shellPath });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        port.postMessage({ type: "error", message });
      }
    } else if (data?.type === "getEnvironment") {
      try {
        const env = await extractShellEnvironment();
        port.postMessage({ type: "envResult", env });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        port.postMessage({ type: "error", message });
      }
    }
  });
  port.start();
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
