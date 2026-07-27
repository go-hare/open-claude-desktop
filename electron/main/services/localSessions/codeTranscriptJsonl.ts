/**
 * Code-side transcript reader aligned to the official residual:
 * transcripts are ALWAYS read live from `~/.claude/projects/<mangled-cwd>/<cliSessionId>.jsonl`
 * — never persisted into userData. Official: `createCoworkRawTranscriptLoader` +
 * `resolveTranscriptPath` (.vite/build/index.js:30168,:30222); product Cowork counterpart is
 * `coworkTranscriptJsonl.ts`. This is the Code-session equivalent.
 *
 * Three jobs:
 *  - resolveCodeTranscriptPath: locate a session's jsonl (preferred mangled-cwd dir, then scan)
 *  - readCodeTranscript: parse raw CLI events for the chat renderer
 *  - scanCodeSessions / readCodeSessionMetadata: list sessions for the sidebar (metadata only)
 *
 * Mangling matches the CLI exactly: NFC-normalize, replace every non-alphanumeric char with
 * "-", truncate at 200 chars (coworkTranscriptJsonl.ts:126-132). Note this is broader than
 * the old dotClaude `[\\/:.]`-only mangle — the CLI replaces ALL non-alphanumerics.
 */

import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

type JsonlRecord = Record<string, unknown>;

/** Message types worth surfacing in the chat renderer (matches cowork officialTranscriptTypes). */
const CODE_TRANSCRIPT_TYPES = new Set([
  "assistant",
  "auth_status",
  "prompt_suggestion",
  "rate_limit_event",
  "result",
  "stream_event",
  "system",
  "tool_progress",
  "tool_use_summary",
  "user",
]);

function defaultConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

function asRecord(value: unknown): JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonlRecord)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Official CLI cwd → project dir mangling (NFC + non-alnum → -, 200-char cap). */
export function mangleCodeProjectDir(cwd: string): string {
  const key = cwd.normalize("NFC").replace(/[^a-zA-Z0-9]/g, "-");
  return key.length <= 200 ? key : key.slice(0, 200);
}

async function isRegularFile(filePath: string): Promise<boolean> {
  return (await lstat(filePath).catch(() => null))?.isFile() ?? false;
}

/**
 * Locate the jsonl for a cliSessionId. Try the preferred mangled-cwd directory first (cheap),
 * then fall back to scanning every projects dir (session may have moved cwd).
 */
export async function resolveCodeTranscriptPath(
  cliSessionId: string | undefined,
  cwd?: string,
  configDir: string = defaultConfigDir(),
): Promise<string | null> {
  if (!cliSessionId || !/^[a-zA-Z0-9_-]+$/.test(cliSessionId)) return null;
  const projectsDir = join(configDir, "projects");
  if (cwd) {
    const canonical = await realpath(cwd).catch(() => cwd);
    const preferred = join(projectsDir, mangleCodeProjectDir(canonical), `${cliSessionId}.jsonl`);
    if (await isRegularFile(preferred)) return preferred;
  }
  const projects = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const candidate = join(projectsDir, project.name, `${cliSessionId}.jsonl`);
    if (await isRegularFile(candidate)) return candidate;
  }
  return null;
}

function splitLines(value: string): string[] {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\r?\n/) : [];
}

/** Parse raw jsonl lines into transcript events for the renderer (raw CLI event shape preserved). */
export async function readCodeTranscript(
  cliSessionId: string | undefined,
  cwd?: string,
  configDir: string = defaultConfigDir(),
): Promise<unknown[]> {
  const transcriptPath = await resolveCodeTranscriptPath(cliSessionId, cwd, configDir);
  if (!transcriptPath) return [];
  let raw: string;
  try {
    raw = await readFile(transcriptPath, "utf8");
  } catch {
    return [];
  }
  const events: unknown[] = [];
  for (const line of splitLines(raw)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    const type = asString(record.type);
    if (type && CODE_TRANSCRIPT_TYPES.has(type)) events.push(record);
  }
  return events;
}

export type CodeSessionFileInfo = {
  cliSessionId: string;
  filePath: string;
  mtimeMs: number;
  /** Project dir name (mangled cwd); real cwd is read from jsonl content. */
  projectDir: string;
};

/** List all CLI session jsonl files under projects/, newest first. */
export async function scanCodeSessionFiles(
  configDir: string = defaultConfigDir(),
  limit = 500,
): Promise<CodeSessionFileInfo[]> {
  const projectsDir = join(configDir, "projects");
  const projects = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  const files: CodeSessionFileInfo[] = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dirPath = join(projectsDir, project.name);
    const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const filePath = join(dirPath, entry.name);
      const stat = await lstat(filePath).catch(() => null);
      if (!stat) continue;
      files.push({
        cliSessionId: basename(entry.name, ".jsonl"),
        filePath,
        mtimeMs: stat.mtimeMs,
        projectDir: project.name,
      });
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const record = asRecord(item);
      if (record.type === "text") return asString(record.text) ?? "";
      if (record.type === "tool_result") {
        const inner = record.content;
        if (typeof inner === "string") return inner;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function isBoilerplateUserText(text: string): boolean {
  return (
    text.startsWith("<local-command-caveat>")
    || text.startsWith("<command-message>")
    || text.startsWith("Caveat:")
    || text.trim().length === 0
  );
}

export type CodeSessionMetadata = {
  cliSessionId: string;
  cwd?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Extract sidebar metadata from one jsonl. Reads the whole file (jsonl is append-only; the
 * first lines carry cwd/title/first-user-text and the last timestamp is updatedAt). Title:
 * custom-title wins, else first non-boilerplate user text, else "CLI session".
 */
export async function readCodeSessionMetadata(
  filePath: string,
  cliSessionId: string,
): Promise<CodeSessionMetadata | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  let cwd: string | undefined;
  let customTitle: string | undefined;
  let createdAt: string | undefined;
  let updatedAt: string | undefined;
  let firstUserText: string | undefined;
  for (const line of splitLines(raw)) {
    let record: JsonlRecord;
    try {
      record = JSON.parse(line) as JsonlRecord;
    } catch {
      continue;
    }
    if (!cwd) cwd = asString(record.cwd);
    if (!customTitle && record.type === "custom-title") {
      customTitle = asString(record.customTitle);
    }
    const timestamp = asString(record.timestamp);
    if (timestamp) {
      if (!createdAt) createdAt = timestamp;
      updatedAt = timestamp;
    }
    if (!firstUserText && record.type === "user") {
      const message = asRecord(record.message);
      const text = contentToText(message.content ?? record.content);
      if (text && !isBoilerplateUserText(text)) firstUserText = text;
    }
  }
  const titleSource = customTitle && customTitle !== "new session" ? customTitle : (firstUserText ?? "CLI session");
  const title = (titleSource.split("\n")[0] ?? titleSource).slice(0, 80);
  return {
    cliSessionId,
    cwd,
    title,
    createdAt: createdAt ?? new Date(0).toISOString(),
    updatedAt: updatedAt ?? createdAt ?? new Date(0).toISOString(),
  };
}
