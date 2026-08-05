/**
 * Residual custom3p-mcp headersHelper (app.asar index.js m2e / LbA / f6t / p6t / pni).
 *
 * - Absolute local helper path only (no UNC / //)
 * - Ignore for source === "user"
 * - Spawn helper, parse JSON stdout, validate header map
 * - TTL cache default 300s (uni)
 *
 * data-official-source: app.asar index.js m2e / LbA
 */
import { spawn } from "node:child_process";
import path from "node:path";

const HELPER_TIMEOUT_MS = 30_000;
const HELPER_MAX_BUFFER = 64 * 1024;
const DEFAULT_TTL_SEC = 300;
const MAX_HEADERS = 32;
const MAX_HEADER_VALUE_BYTES = 8 * 1024;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export type HeadersHelperServerConfig = {
  name: string;
  headersHelper?: string;
  headersHelperTtlSec?: number;
  source?: string;
  headers?: Record<string, string>;
};

type CacheEntry = {
  headers: Record<string, string>;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

/**
 * Residual f6t — absolute local path only (no UNC / //).
 * Official asar post-normalize check has a POSIX hole: normalize("//x") → "/x".
 * Reject raw // and \\ before normalize (same honesty as credentialHelperResidual).
 * data-official-source: app.asar f6t / m2e
 */
export function isLocalAbsoluteHelperPath(helperPath: string): boolean {
  if (typeof helperPath !== "string" || helperPath.length === 0) return false;
  // Pre-normalize UNC / double-slash reject (POSIX collapse hole).
  if (helperPath.startsWith("\\\\") || helperPath.startsWith("//")) return false;
  if (!path.isAbsolute(helperPath)) return false;
  const normalized = path.normalize(helperPath);
  if (normalized.startsWith("\\\\") || normalized.startsWith("//")) return false;
  return true;
}

/** Residual p6t — win32 script shells. */
export function resolveHelperCommand(
  helperPath: string,
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform !== "win32") return { cmd: helperPath, args: [] };
  const system32 = path.win32.join(process.env.SYSTEMROOT ?? "C:\\Windows", "System32");
  const ext = path.extname(helperPath).toLowerCase();
  if (ext === ".ps1") {
    return {
      cmd: path.win32.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe"),
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        helperPath,
      ],
    };
  }
  if (ext === ".cmd" || ext === ".bat") {
    return {
      cmd: path.win32.join(system32, "cmd.exe"),
      args: ["/d", "/s", "/c", `""${helperPath}""`],
      windowsVerbatimArguments: true,
    };
  }
  return { cmd: helperPath, args: [] };
}

/** Residual pni header map validation. */
export function validateHelperHeaders(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_HEADERS) return null;
  for (const [name, raw] of entries) {
    if (!HEADER_NAME_RE.test(name)) return null;
    if (typeof raw !== "string") return null;
    if (Buffer.byteLength(raw, "utf8") > MAX_HEADER_VALUE_BYTES) return null;
    if (/[\r\n]/.test(raw)) return null;
    out[name] = raw;
  }
  return out;
}

type SpawnHelperResult =
  | { ok: true; stdout: string; exitCode: number | null; elapsedMs: number }
  | { ok: false; reason: string; elapsedMs?: number; spawnError?: string };

async function spawnHelper(
  helperPath: string,
  opts: { timeoutMs: number; maxBuffer: number },
): Promise<SpawnHelperResult> {
  if (!isLocalAbsoluteHelperPath(helperPath)) {
    console.error(
      "[custom3p-mcp-headers] helper must be a local absolute path, ignoring",
      { helperPath },
    );
    return { ok: false, reason: "bad-path" };
  }
  const resolved = resolveHelperCommand(helperPath);
  console.info("[custom3p-mcp-headers] running helper", { helperPath });
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    const child = spawn(resolved.cmd, resolved.args, {
      windowsHide: true,
      windowsVerbatimArguments: resolved.windowsVerbatimArguments,
      env: process.env,
    });
    const finish = (result: SpawnHelperResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      finish({
        ok: false,
        reason: "timeout",
        elapsedMs: Date.now() - started,
        spawnError: `helper did not settle within ${opts.timeoutMs}ms`,
      });
    }, opts.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > opts.maxBuffer) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        finish({
          ok: false,
          reason: "max-buffer",
          elapsedMs: Date.now() - started,
        });
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        reason: "spawn-failed",
        elapsedMs: Date.now() - started,
        spawnError: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("close", (code) => {
      finish({
        ok: true,
        stdout,
        exitCode: code,
        elapsedMs: Date.now() - started,
      });
      if (stderr.trim()) {
        console.warn("[custom3p-mcp-headers] helper stderr", {
          helperPath,
          stderr: stderr.slice(0, 500),
        });
      }
    });
  });
}

/**
 * Residual m2e — resolve headers from headersHelper for non-user-sourced servers.
 * Returns undefined when no helper; {} on failure (residual continues open/headers path).
 */
export async function resolveHeadersHelper(
  config: HeadersHelperServerConfig,
): Promise<Record<string, string> | undefined> {
  const helper = config.headersHelper;
  if (!helper) return undefined;
  if (config.source === "user") {
    console.warn(
      "[custom3p-mcp-headers] headersHelper ignored for user-sourced server",
      { server: config.name },
    );
    return undefined;
  }
  const now = Date.now();
  const cached = cache.get(config.name);
  if (cached && cached.expiresAt > now) return cached.headers;

  const result = await spawnHelper(helper, {
    timeoutMs: HELPER_TIMEOUT_MS,
    maxBuffer: HELPER_MAX_BUFFER,
  });
  if (!result.ok) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    console.error("[custom3p-mcp-headers] helper output is not valid JSON", {
      server: config.name,
    });
    return {};
  }
  const headers = validateHelperHeaders(parsed);
  if (!headers) {
    console.error("[custom3p-mcp-headers] helper output failed validation", {
      server: config.name,
    });
    return {};
  }
  const ttlSec =
    typeof config.headersHelperTtlSec === "number" &&
    Number.isFinite(config.headersHelperTtlSec) &&
    config.headersHelperTtlSec > 0
      ? config.headersHelperTtlSec
      : DEFAULT_TTL_SEC;
  cache.set(config.name, { headers, expiresAt: now + ttlSec * 1000 });
  console.info("[custom3p-mcp-headers] resolved", {
    server: config.name,
    headerNames: Object.keys(headers),
  });
  return headers;
}

/** Test helper. */
export function resetHeadersHelperCacheForTests(): void {
  cache.clear();
}
