import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CoworkTranscriptOptions } from "../coworkSessions/coworkSessionManagerTypes";
import type {
  CoworkSdkMessage,
  CoworkSessionRuntimeState,
} from "../coworkSessions/coworkSessionTypes";

const officialTranscriptTypes = new Set([
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

type ParseOptions = { dropPreBoundary?: boolean };
type PreservedSegment = { headUuid?: string; tailUuid?: string };
type RawTranscriptLoader = (
  session: CoworkSessionRuntimeState,
  options?: CoworkTranscriptOptions,
) => Promise<CoworkSdkMessage[] | null>;

export function parseCoworkTranscriptLines(
  lines: string[],
  options?: ParseOptions,
): CoworkSdkMessage[] {
  const entries = parseLines(lines);
  const boundary = findLastBoundary(entries);
  const preserved = preservedUuids(entries, boundary);
  const firstIndex =
    (options?.dropPreBoundary ?? true) && boundary.index >= 0 ? boundary.index + 1 : 0;
  return entries.filter((entry, index) => {
    const visible = index >= firstIndex || Boolean(entry.uuid && preserved.has(entry.uuid));
    return visible && !entry.isCompactSummary && !entry.isVisibleInTranscriptOnly;
  });
}

export function createCoworkRawTranscriptLoader(
  configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
): RawTranscriptLoader {
  return async (session, options) => {
    if (!session.cliSessionId) return null;
    const transcriptPath = await resolveTranscriptPath(configDir, session);
    if (!transcriptPath) return null;
    const lines = splitLines(await readFile(transcriptPath, "utf8"));
    const selected = options?.limit ? tailLines(lines, options) : lines;
    const parsed = parseCoworkTranscriptLines(selected, {
      dropPreBoundary: options?.limit !== undefined,
    });
    return parsed.filter((message) => officialTranscriptTypes.has(message.type));
  };
}

function parseLines(lines: string[]): CoworkSdkMessage[] {
  return lines.flatMap((line) => {
    if (line.length === 0) return [];
    try {
      const parsed: unknown = JSON.parse(line);
      return isMessage(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

function findLastBoundary(entries: CoworkSdkMessage[]) {
  let index = -1;
  let preservedIndex = -1;
  let segment: PreservedSegment | undefined;
  entries.forEach((entry, entryIndex) => {
    if (entry.type !== "system" || entry.subtype !== "compact_boundary") return;
    index = entryIndex;
    const current = asRecord(asRecord(entry.compactMetadata).preservedSegment);
    if (Object.keys(current).length === 0) return;
    preservedIndex = entryIndex;
    segment = current;
  });
  return { index, preservedIndex, segment };
}

function preservedUuids(
  entries: CoworkSdkMessage[],
  boundary: ReturnType<typeof findLastBoundary>,
) {
  if (!boundary.segment || boundary.preservedIndex !== boundary.index) return new Set<string>();
  const byUuid = new Map(entries.map((entry, index) => [entry.uuid, { entry, index }]));
  const preserved = new Set<string>();
  const visited = new Set<string>();
  let uuid = stringValue(boundary.segment.tailUuid);
  while (uuid && !visited.has(uuid)) {
    visited.add(uuid);
    const current = byUuid.get(uuid);
    if (!current || current.index >= boundary.index) break;
    preserved.add(uuid);
    if (uuid === boundary.segment.headUuid) return preserved;
    uuid = stringValue(current.entry.parentUuid);
  }
  return new Set<string>();
}

async function resolveTranscriptPath(configDir: string, session: CoworkSessionRuntimeState) {
  const sessionId = session.cliSessionId;
  if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) return null;
  const projectsDir = join(configDir, "projects");
  const preferred = await preferredProjectDirectory(projectsDir, session);
  if (preferred) {
    const candidate = join(preferred, `${sessionId}.jsonl`);
    if (await isRegularFile(candidate)) return candidate;
  }
  const projects = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const candidate = join(projectsDir, project.name, `${sessionId}.jsonl`);
    if (await isRegularFile(candidate)) return candidate;
  }
  return null;
}

async function preferredProjectDirectory(projectsDir: string, session: CoworkSessionRuntimeState) {
  const directory = transcriptDirectory(session);
  if (!directory) return null;
  const canonical = await realpath(directory).catch(() => directory);
  const key = canonical.normalize("NFC").replace(/[^a-zA-Z0-9]/g, "-");
  return key.length <= 200 ? join(projectsDir, key) : null;
}

function transcriptDirectory(session: CoworkSessionRuntimeState) {
  if (!session.hostLoopMode) return session.cwd;
  return session.resolvedFolders[0]?.canonical ?? session.resolvedFolders[0]?.display;
}

function tailLines(lines: string[], options: CoworkTranscriptOptions) {
  const output: string[] = [];
  const maxScan = Math.min(options.maxScan ?? lines.length, lines.length);
  for (let index = lines.length - 1; index >= lines.length - maxScan; index -= 1) {
    const line = lines[index] ?? "";
    if (lineHasType(line, "stream_event")) continue;
    if (options.types?.length && !options.types.some((type) => lineHasType(line, type))) continue;
    output.push(line);
    if (output.length >= (options.limit ?? 0)) break;
  }
  return output.reverse();
}

function lineHasType(line: string, type: string) {
  return line.includes(`"type":"${type}"`) || line.includes(`"type": "${type}"`);
}

function splitLines(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\r?\n/) : [];
}

async function isRegularFile(path: string) {
  return (await lstat(path).catch(() => null))?.isFile() ?? false;
}

function isMessage(value: unknown): value is CoworkSdkMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
