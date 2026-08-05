/**
 * Official Custom3pHelperRun residual (app.asar MPe / LbA / yPe / G0A / Gre / _Pe).
 *
 * runCredentialHelper(helperPath: string) → Gre bag (spawn real local absolute path).
 * getCredentialHelperLastRun() → last Gre bag | null (in-memory k1).
 *
 * Gre shape (validator):
 *   ok:boolean, state:"success"|"warning"|"failed", at:string, elapsedMs:number,
 *   exitCode?:number, stdoutBytes:number, outputFormat:"bare-token"|"json"|"unrecognized",
 *   headerCount:number, reason?: "bad-path"|"spawn-failed"|"timed-out"|"non-zero-exit"|"empty",
 *   parseWarnings?:string[], parseErrorReason?:string, stderrRedacted:string,
 *   spawnError?:string, helperPath:string
 *
 * Never invent `{ ok:true }` without a real helper run.
 *
 * data-official-source: app.asar MPe / LbA / G0A / Gre / f6t / yPe / k1=_Pe
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Official mPe. */
export const CREDENTIAL_HELPER_TIMEOUT_MS = 60_000;
/** Official h6t settle grace after timeout. */
export const CREDENTIAL_HELPER_SETTLE_MS = 2_000;

export type CredentialHelperState = "success" | "warning" | "failed";
export type CredentialHelperOutputFormat =
  | "bare-token"
  | "json"
  | "unrecognized";
export type CredentialHelperFailReason =
  | "bad-path"
  | "spawn-failed"
  | "timed-out"
  | "non-zero-exit"
  | "empty";

export type CredentialHelperRunResult = {
  ok: boolean;
  state: CredentialHelperState;
  at: string;
  elapsedMs: number;
  exitCode?: number;
  stdoutBytes: number;
  outputFormat: CredentialHelperOutputFormat;
  headerCount: number;
  reason?: CredentialHelperFailReason;
  parseWarnings?: string[];
  parseErrorReason?: string;
  stderrRedacted: string;
  spawnError?: string;
  helperPath: string;
};

const CONTROL_CHARS = /[\r\n\0]/;

/**
 * Official f6t: absolute local path (no UNC).
 * data-official-source: app.asar f6t
 *   const A = path.normalize(e); return path.isAbsolute(e) && !A.startsWith("\\\\") && !A.startsWith("//")
 *
 * POSIX path.normalize("//host/share") → "/host/share", which would pass the official
 * post-normalize check. Reject raw // and \\ *before* normalize so UNC cannot collapse
 * into a local absolute path (stricter residual, still no invent ok run).
 */
export function isCredentialHelperAbsolutePath(helperPath: string): boolean {
  if (typeof helperPath !== "string" || !helperPath) return false;
  // Pre-normalize UNC / double-slash reject (POSIX collapse hole).
  if (helperPath.startsWith("\\\\") || helperPath.startsWith("//")) return false;
  if (!path.isAbsolute(helperPath)) return false;
  const normalized = path.normalize(helperPath);
  if (normalized.startsWith("\\\\") || normalized.startsWith("//")) return false;
  return true;
}

/** Official Gre residual validator. */
export function isCredentialHelperRunResult(
  value: unknown,
): value is CredentialHelperRunResult {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (typeof o.ok !== "boolean") return false;
  if (o.state !== "success" && o.state !== "warning" && o.state !== "failed") {
    return false;
  }
  if (typeof o.at !== "string") return false;
  if (typeof o.elapsedMs !== "number") return false;
  if (o.exitCode !== undefined && typeof o.exitCode !== "number") return false;
  if (typeof o.stdoutBytes !== "number") return false;
  if (
    o.outputFormat !== "bare-token" &&
    o.outputFormat !== "json" &&
    o.outputFormat !== "unrecognized"
  ) {
    return false;
  }
  if (typeof o.headerCount !== "number") return false;
  if (
    o.reason !== undefined &&
    o.reason !== "bad-path" &&
    o.reason !== "spawn-failed" &&
    o.reason !== "timed-out" &&
    o.reason !== "non-zero-exit" &&
    o.reason !== "empty"
  ) {
    return false;
  }
  if (o.parseWarnings !== undefined) {
    if (
      !Array.isArray(o.parseWarnings) ||
      !o.parseWarnings.every((w) => typeof w === "string")
    ) {
      return false;
    }
  }
  if (
    o.parseErrorReason !== undefined &&
    typeof o.parseErrorReason !== "string"
  ) {
    return false;
  }
  if (typeof o.stderrRedacted !== "string") return false;
  if (o.spawnError !== undefined && typeof o.spawnError !== "string") {
    return false;
  }
  if (typeof o.helperPath !== "string") return false;
  return true;
}

function redactStderr(stderr: string): string {
  // Official PI(OV(stderr)).slice(-65536) — product: truncate only (no secret invent).
  return stderr.slice(-65_536);
}

function winSpawn(helperPath: string): { cmd: string; args: string[] } {
  if (process.platform !== "win32") return { cmd: helperPath, args: [] };
  const systemRoot = process.env.SYSTEMROOT ?? "C:\\Windows";
  const system32 = path.win32.join(systemRoot, "System32");
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
      args: ["/d", "/s", "/c", helperPath],
    };
  }
  return { cmd: helperPath, args: [] };
}

type ParsedCredential = {
  token: string;
  headers?: Record<string, string>;
  isJson: boolean;
  parseWarnings?: string[];
};

function parseJsonCredential(raw: string): ParsedCredential | null {
  const warnings: string[] = [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const token =
      typeof parsed.token === "string" ? parsed.token.trim() : undefined;
    if (!token) return null;
    let headers: Record<string, string> | undefined;
    if (parsed.headers != null) {
      if (typeof parsed.headers !== "object" || Array.isArray(parsed.headers)) {
        return null;
      }
      headers = {};
      for (const [k, v] of Object.entries(
        parsed.headers as Record<string, unknown>,
      )) {
        if (typeof v === "string") headers[k] = v;
        else warnings.push(`header ${k} ignored (non-string)`);
      }
    }
    return {
      token,
      headers,
      isJson: true,
      parseWarnings: warnings.length ? warnings : undefined,
    };
  } catch {
    return null;
  }
}

/** Official yPe residual — parse helper stdout to token/json or null. */
export function parseCredentialHelperStdout(
  stdout: string,
): ParsedCredential | null {
  const text = stdout.trim();
  if (!text) return null;
  let parsed: ParsedCredential | null = null;
  let isJson = false;
  if (text.startsWith("{")) {
    parsed = parseJsonCredential(text);
    isJson = true;
  } else {
    const idx = text.search(/^[ \t]*\{/m);
    if (idx > 0) {
      const recovered = parseJsonCredential(text.slice(idx));
      if (recovered) {
        const lead = Buffer.byteLength(text.slice(0, idx));
        parsed = {
          ...recovered,
          parseWarnings: [
            `Recovered credential after ${lead} bytes of leading output on stdout; print only the credential to stdout`,
            ...(recovered.parseWarnings ?? []),
          ],
        };
        isJson = true;
      }
    } else if (text.includes("\n")) {
      return null;
    } else {
      parsed = { token: text, isJson: false };
    }
  }
  if (!parsed?.token) return null;
  if (CONTROL_CHARS.test(parsed.token)) return null;
  return { ...parsed, isJson };
}

function parseErrorReason(stdout: string | undefined): string {
  const A = (stdout ?? "").trim();
  if (A.startsWith("{")) {
    return "Output starts with '{' but isn't valid JSON with a 'token' string.";
  }
  if (A.includes("\n")) {
    return "Output has multiple lines; print only the token or a JSON object to stdout.";
  }
  return "Token contains control characters.";
}

type SpawnOutcome =
  | {
      ok: true;
      stdout: string;
      stderr: string;
      elapsedMs: number;
      exitCode: number;
      stdoutBytes: number;
    }
  | {
      ok: false;
      reason: CredentialHelperFailReason;
      elapsedMs: number;
      exitCode?: number;
      stderr?: string;
      stdout?: string;
      stdoutBytes?: number;
      spawnError?: string;
    };

/** Official LbA residual. */
export async function spawnCredentialHelper(
  helperPath: string,
  options: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    logTag?: string;
  } = {},
): Promise<SpawnOutcome> {
  const timeoutMs = options.timeoutMs ?? CREDENTIAL_HELPER_TIMEOUT_MS;
  const logTag = options.logTag ?? "custom-3p";
  if (!isCredentialHelperAbsolutePath(helperPath)) {
    console.error(`[${logTag}] helper must be a local absolute path, ignoring`, {
      helperPath,
    });
    return { ok: false, reason: "bad-path", elapsedMs: 0 };
  }
  const { cmd, args } = winSpawn(helperPath);
  console.info(`[${logTag}] running helper`, { helperPath });
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
      env: options.env ?? process.env,
      windowsHide: true,
      encoding: "utf8",
    });
    const elapsedMs = Date.now() - started;
    const trimmed = String(stdout ?? "").trim();
    const stdoutBytes = Buffer.byteLength(trimmed, "utf8");
    // execFile throws on non-zero; success path is exit 0.
    if (!trimmed) {
      return {
        ok: false,
        reason: "empty",
        elapsedMs,
        exitCode: 0,
        stderr: String(stderr ?? ""),
        stdout: trimmed,
        stdoutBytes,
      };
    }
    return {
      ok: true,
      stdout: String(stdout ?? ""),
      stderr: String(stderr ?? ""),
      elapsedMs,
      exitCode: 0,
      stdoutBytes,
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const e = err as {
      code?: string | number;
      killed?: boolean;
      signal?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const stderr = String(e.stderr ?? "");
    const stdout = String(e.stdout ?? "");
    const stdoutBytes = Buffer.byteLength(stdout.trim(), "utf8");
    const exitCode = typeof e.code === "number" ? e.code : undefined;
    // timed-out: killed by timeout or elapsed >= timeout
    if (
      e.killed ||
      e.signal === "SIGKILL" ||
      elapsedMs >= timeoutMs ||
      e.code === "ETIMEDOUT"
    ) {
      return {
        ok: false,
        reason: "timed-out",
        elapsedMs,
        exitCode,
        stderr,
        stdout,
        stdoutBytes,
      };
    }
    if (typeof e.code === "number" && e.code !== 0) {
      return {
        ok: false,
        reason: "non-zero-exit",
        elapsedMs,
        exitCode: e.code,
        stderr,
        stdout,
        stdoutBytes,
      };
    }
    return {
      ok: false,
      reason: "spawn-failed",
      elapsedMs,
      exitCode,
      stderr,
      stdout,
      stdoutBytes,
      spawnError: e.message ?? String(err),
    };
  }
}

/** Official G0A residual. */
export function buildCredentialHelperRunResult(
  helperPath: string,
  spawn: SpawnOutcome,
  parsed: ParsedCredential | null,
): CredentialHelperRunResult {
  const stderr = "stderr" in spawn && spawn.stderr ? spawn.stderr : "";
  const base: CredentialHelperRunResult = {
    ok: false,
    state: "failed",
    at: new Date().toISOString(),
    elapsedMs: spawn.elapsedMs,
    exitCode: "exitCode" in spawn ? spawn.exitCode : undefined,
    stdoutBytes: "stdoutBytes" in spawn && spawn.stdoutBytes != null
      ? spawn.stdoutBytes
      : 0,
    outputFormat: "unrecognized",
    headerCount: 0,
    stderrRedacted: redactStderr(stderr),
    helperPath,
    spawnError: spawn.ok ? undefined : spawn.spawnError,
  };

  if (!spawn.ok) {
    return {
      ...base,
      ok: false,
      state: "failed",
      reason: spawn.reason,
      parseErrorReason:
        spawn.reason === "empty"
          ? "Helper exited cleanly but printed nothing to stdout."
          : undefined,
      spawnError:
        spawn.reason === "bad-path"
          ? "Path must be absolute and on the local filesystem."
          : base.spawnError,
    };
  }

  if (parsed) {
    const warnings = parsed.parseWarnings ?? [];
    const hasWarn = stderr.trim().length > 0 || warnings.length > 0;
    return {
      ...base,
      ok: true,
      state: hasWarn ? "warning" : "success",
      outputFormat: parsed.isJson ? "json" : "bare-token",
      headerCount: parsed.headers ? Object.keys(parsed.headers).length : 0,
      parseWarnings: warnings.length ? warnings : undefined,
    };
  }

  return {
    ...base,
    ok: false,
    state: "failed",
    parseErrorReason: parseErrorReason(spawn.stdout),
  };
}

let lastRun: CredentialHelperRunResult | null = null;

/** Official _Pe. */
export function getCredentialHelperLastRunResidual(): CredentialHelperRunResult | null {
  return lastRun;
}

/** Official MPe residual body. */
export async function runCredentialHelperResidual(
  helperPath: string,
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CredentialHelperRunResult> {
  const env = { ...(options.env ?? process.env), CLAUDE_HELPER_MANUAL_RUN: "1" };
  const spawn = await spawnCredentialHelper(helperPath, {
    timeoutMs: options.timeoutMs,
    env,
    logTag: "custom-3p",
  });
  const parsed =
    spawn.ok && "stdout" in spawn
      ? parseCredentialHelperStdout(spawn.stdout)
      : null;
  const result = buildCredentialHelperRunResult(helperPath, spawn, parsed);
  lastRun = result;
  return result;
}

/** Test helper. */
export function resetCredentialHelperLastRunForTests(): void {
  lastRun = null;
}
