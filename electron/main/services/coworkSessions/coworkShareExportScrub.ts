/**
 * Official share/export log scrub (S1 + Qw) used by J6e LeA transform:
 *   LeA(logs, "logs", files, zJi, (name, bytes) => S1(name, bytes, Qw))
 *
 * S1(name, bytes, { lineScrub, jsonScrubOpts, onError }):
 *   .log/.txt  → lineScrub each line (szt = truncate 8KiB + $LA)
 *   .json      → B7(JSON.parse, jsonScrubOpts)
 *   .jsonl     → per-line JSON B7 else lineScrub
 *   on error   → onError + return raw bytes
 *
 * $LA(line, paths) = pathScrub(eHe) → email → ip → token patterns (PI)
 * Qw.lineScrub = szt; Qw.jsonScrubOpts = { ...JHe, scrubString: $LA }
 *
 * Residuals (honest):
 *   - Full JHe.keyHandlers (raw_output envelope, model/plugin specials) not
 *     ported; recursive scrubString still redacts secrets/paths on those keys.
 *   - skipKeys set matches official JHe telemetry keys left un-scrubbed.
 */

import { homedir as osHomedir } from "node:os";

/** Official Eoe = 8 * 1024 for szt line truncate. */
export const COWORK_SHARE_SCRUB_LINE_MAX = 8 * 1024;

export type CoworkShareScrubPaths = {
  appPath?: string;
  homedir?: string;
};

export type CoworkShareScrubOpts = CoworkShareScrubPaths & {
  onError?: (error: unknown, fileName: string) => void;
};

/** Official JHe.skipKeys — leave diagnostic enums/ids un-scrubbed. */
export const COWORK_SHARE_JSON_SKIP_KEYS = new Set([
  "product_surface",
  "desktop_variant",
  "deployment_mode",
  "inference_provider",
  "inference_host",
  "inference_host_kind",
  "app_version",
  "commit_hash",
  "platform",
  "arch",
  "os_version",
  "os_release",
  "os_build",
  "cpu_model",
  "app_session_id",
  "organization_id",
  "vm_network_mode",
  "error_code",
  "nest_local_user",
]);

// Official Azt email → <email>
const EMAIL_RE =
  /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){0,7}\.[A-Za-z][\w-]{0,62}/g;

// Official tzt / izt IP patterns → <ip> (keep HH:MM:SS clock-looking)
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_RE =
  /\b(?:[A-Fa-f0-9]{1,4}:){2,7}(?::?[A-Fa-f0-9]{1,4}){1,7}\b/g;
const CLOCK_RE = /^\d{1,2}:\d{2}:\d{2}$/;

// Official ozt token replacements (PI)
const TOKEN_REPLACERS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <token>"],
  [/(:\s*)Basic\s+[A-Za-z0-9+/=]{8,}/gi, "$1Basic <token>"],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "<token>"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "<token>"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "<token>"],
  [/\bASIA[0-9A-Z]{16}\b/g, "<token>"],
  [/\bgh[opusr]_[A-Za-z0-9]{36,}/g, "<token>"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "<token>"],
  [
    /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    "<jwt>",
  ],
  [/\b[A-Za-z0-9+_-]{40,}={0,2}\b/g, "<blob>"],
];

function defaultPaths(
  paths: CoworkShareScrubPaths = {},
): Required<CoworkShareScrubPaths> {
  return {
    appPath: paths.appPath ?? "",
    homedir: paths.homedir ?? osHomedir(),
  };
}

/** Official ezt */
export function scrubCoworkShareEmails(text: string): string {
  return text.replace(EMAIL_RE, "<email>");
}

/** Official nzt */
export function scrubCoworkShareIps(text: string): string {
  return text
    .replace(IPV4_RE, "<ip>")
    .replace(IPV6_RE, (match) => (CLOCK_RE.test(match) ? match : "<ip>"));
}

/** Official PI */
export function scrubCoworkShareTokens(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TOKEN_REPLACERS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Official eHe path scrub (D7 paths).
 * Skips rewriting path-looking segments that sit inside unfinished http URLs.
 */
export function scrubCoworkSharePaths(
  text: string,
  paths: CoworkShareScrubPaths = {},
): string {
  const { appPath, homedir } = defaultPaths(paths);
  const insideHttp = (source: string, index: number): boolean =>
    /https?:\/\/[^\s'",;|()]*$/i.test(source.slice(0, index));

  let out = text;
  if (appPath) out = out.split(appPath).join("app://");
  if (homedir) out = out.split(homedir).join("~");
  out = out
    .replace(
      /([/\\]+(?:Users|home)[/\\]+)[^/\\\n]+/gi,
      (match, prefix: string, offset: number, source: string) =>
        insideHttp(source, offset) ? match : `${prefix}<user>`,
    )
    .replace(
      /(\/(?:Volumes|mnt|media)\/)[^/\n]+/g,
      (match, prefix: string, offset: number, source: string) =>
        insideHttp(source, offset) ? match : `${prefix}<vol>`,
    )
    .replace(/\b([A-Za-z]):[\\/]/g, "<drv>:\\")
    .replace(/\\\\[^\\]+\\[^\\\s'",:()]+/g, "<unc>");
  return out;
}

/**
 * Official $LA: URL userinfo → path scrub → email → ip → tokens.
 */
export function scrubCoworkShareLineBody(
  text: string,
  paths: CoworkShareScrubPaths = {},
): string {
  const withoutUserinfo = text.replace(
    /:\/\/[^\s/]*@(?=[^@\s]*(?:[/:\s]|$))/g,
    "://<userinfo>@",
  );
  return scrubCoworkShareTokens(
    scrubCoworkShareIps(
      scrubCoworkShareEmails(scrubCoworkSharePaths(withoutUserinfo, paths)),
    ),
  );
}

/**
 * Official szt: truncate to Eoe then $LA.
 * Qw.lineScrub = szt(line, D7()).
 */
export function scrubCoworkShareLogLine(
  line: string,
  paths: CoworkShareScrubPaths = {},
): string {
  // Official szt: e.slice(0,Eoe)+"…<truncated>" (U+2026 ellipsis, not "...")
  const truncated =
    line.length > COWORK_SHARE_SCRUB_LINE_MAX
      ? `${line.slice(0, COWORK_SHARE_SCRUB_LINE_MAX)}…<truncated>`
      : line;
  return scrubCoworkShareLineBody(truncated, paths);
}

/**
 * Official B7 recursive JSON scrub with skipKeys + scrubString.
 * keyHandlers residual: scrubString applied for all non-skip keys.
 */
export function scrubCoworkShareJsonValue(
  value: unknown,
  paths: CoworkShareScrubPaths = {},
  options: {
    scrubString?: (text: string) => string;
    skipKeys?: ReadonlySet<string>;
  } = {},
): unknown {
  const scrubString =
    options.scrubString ?? ((text) => scrubCoworkShareLineBody(text, paths));
  const skipKeys = options.skipKeys ?? COWORK_SHARE_JSON_SKIP_KEYS;
  const seen = new WeakMap<object, unknown>();

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return scrubString(node);
    if (typeof node !== "object" || node === null) return node;
    if (seen.has(node)) return seen.get(node);
    seen.set(node, "[Circular]");
    if (Array.isArray(node)) {
      const next = node.map(walk);
      seen.set(node, next);
      return next;
    }
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      out[key] = skipKeys.has(key) ? child : walk(child);
    }
    seen.set(node, out);
    return out;
  };

  try {
    return walk(value);
  } catch {
    return value;
  }
}

/**
 * Official S1(name, bytes, Qw) for share export log tree entries.
 */
export function scrubCoworkShareExportFile(
  fileName: string,
  bytes: Uint8Array,
  options: CoworkShareScrubOpts = {},
): Uint8Array {
  const lower = fileName.toLowerCase();
  const paths: CoworkShareScrubPaths = {
    appPath: options.appPath,
    homedir: options.homedir,
  };
  const encode = (text: string): Uint8Array =>
    new TextEncoder().encode(text);

  try {
    if (lower.endsWith(".log") || lower.endsWith(".txt")) {
      const text = new TextDecoder().decode(bytes);
      const scrubbed = text
        .split("\n")
        .map((line) => scrubCoworkShareLogLine(line, paths))
        .join("\n");
      return encode(scrubbed);
    }
    if (lower.endsWith(".json")) {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      const scrubbed = scrubCoworkShareJsonValue(parsed, paths);
      return encode(JSON.stringify(scrubbed));
    }
    if (lower.endsWith(".jsonl")) {
      const text = new TextDecoder().decode(bytes);
      const scrubbed = text
        .split("\n")
        .map((line) => {
          if (!line.trim()) return line;
          try {
            const parsed = JSON.parse(line) as unknown;
            return JSON.stringify(scrubCoworkShareJsonValue(parsed, paths));
          } catch {
            return scrubCoworkShareLogLine(line, paths);
          }
        })
        .join("\n");
      return encode(scrubbed);
    }
  } catch (error) {
    options.onError?.(error, fileName);
  }
  return bytes;
}
