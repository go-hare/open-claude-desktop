/**
 * Login-shell PATH / CC env extraction via UtilityProcess worker.
 * data-official-source: app.asar index.js NFi / E5e / TFi / vFi / lq / kFi
 *
 * Worker: .vite/build/shell-path-worker/shellPathWorker.js (product TS)
 * Protocol: init MessagePort → getEnvironment → envResult | error
 */
import { app, utilityProcess, MessageChannelMain } from "electron";
import fs from "node:fs";
import path from "node:path";

const SHELL_ENV_TIMEOUT_MS = 5000;

let cachedEnv: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;
let appliedToProcessEnv = false;

function resolveShellPathWorker(): string {
  // residual mHi-style: packaged → resources/app.asar; dev → app.getAppPath()
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar")
    : app.getAppPath();
  return path.join(root, ".vite/build/shell-path-worker/shellPathWorker.js");
}

/**
 * Official vFi residual: fork shellPathWorker, ask getEnvironment, return env map.
 */
export async function extractShellEnvironment(): Promise<Record<string, string>> {
  if (process.platform === "win32") {
    return {};
  }
  if (cachedEnv !== null) return cachedEnv;
  if (inflight) return inflight;

  inflight = (async () => {
    const workerPath = resolveShellPathWorker();
    if (!fs.existsSync(workerPath)) {
      throw new Error(`Shell path worker not found at: ${workerPath}`);
    }

    const env = await new Promise<Record<string, string>>((resolve, reject) => {
      let settled = false;
      const child = utilityProcess.fork(workerPath, [], {
        serviceName: "Claude Desktop Shell Environment Extractor",
      });
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        reject(new Error("Shell environment extraction timed out"));
      }, SHELL_ENV_TIMEOUT_MS);

      const { port1, port2 } = new MessageChannelMain();
      port1.on("message", (event) => {
        if (settled) return;
        const data = event.data as { type?: string; env?: Record<string, string>; message?: string };
        if (data.type === "envResult") {
          settled = true;
          clearTimeout(timeout);
          port1.close();
          try {
            child.kill();
          } catch {
            /* ignore */
          }
          resolve(data.env && typeof data.env === "object" ? data.env : {});
        } else if (data.type === "error") {
          settled = true;
          clearTimeout(timeout);
          port1.close();
          try {
            child.kill();
          } catch {
            /* ignore */
          }
          reject(new Error(data.message || "Shell environment extraction error"));
        }
      });
      port1.start();

      child.once("spawn", () => {
        child.postMessage({ type: "init" }, [port2]);
        port1.postMessage({ type: "getEnvironment" });
      });
      child.once("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        port1.close();
        reject(new Error(`Utility process exited with code: ${code}`));
      });
    });

    cachedEnv = env;
    return env;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/**
 * Official E5e / TFi residual with process.env fill (lq once).
 * Failures → empty object (caller keeps process.env).
 */
export async function getShellEnvironment(): Promise<Record<string, string>> {
  if (process.platform === "win32") {
    cachedEnv = {};
    return cachedEnv;
  }
  try {
    const env = await extractShellEnvironment();
    if (!appliedToProcessEnv) {
      appliedToProcessEnv = true;
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
    return env;
  } catch (error) {
    console.warn(
      "[CCD] Shell environment extraction failed, using process.env:",
      error instanceof Error ? error.message : error,
    );
    cachedEnv = {};
    return cachedEnv;
  }
}

/** Official lq residual: PATH string after env extract. */
export async function getShellPath(): Promise<string> {
  const env = await getShellEnvironment();
  return env.PATH || process.env.PATH || "";
}

/** Official kFi residual: extracted PATH or undefined. */
export async function getExtractedShellPath(): Promise<string | undefined> {
  const env = await getShellEnvironment();
  return env.PATH || undefined;
}

export function resetShellEnvironmentCacheForTests(): void {
  cachedEnv = null;
  inflight = null;
  appliedToProcessEnv = false;
}
