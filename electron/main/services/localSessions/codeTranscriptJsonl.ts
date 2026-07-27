/**
 * Code-side transcript reader aligned to official LocalSessionManager residual
 * (`open-claude-desktop/index.js` loadTranscriptFromDisk / resolveProjectDirForSession):
 *
 * - Session LIST comes from userData metadata only — never scan ~/.claude/projects here.
 * - Transcript is loaded ON DEMAND for a single cliSessionId via getTranscript.
 * - Prefer cwd-mangled project dir (also worktree/origin when provided); fall back to
 *   scanning project dirs for THAT one id (official resolveProjectDirForSession).
 * - Parse line-by-line with event-loop yields (official Az residual, every Ptr=200 lines).
 * - Byte-window reads snap to last newline (official ez residual).
 * - LRU cache of parsed transcripts (official diskTranscriptCache = new ItA(_tr=8)).
 * - Incremental append when same inode + size growth (official loadTranscriptFromDisk).
 * - Merge agent-*.jsonl tool rows discovered via toolUseResult.agentId (official).
 * - stripThinkingBlocks on assistant content (thinking / redacted_thinking).
 * - Metadata helpers read head/tail windows only (not whole multi-hundred-MB files).
 *
 * Mangling matches CLI: NFC + non-alnum → "-", 200-char cap.
 */

import { open, lstat, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

type JsonlRecord = Record<string, unknown>;

/**
 * Official p6e residual — message types kept from the main session jsonl.
 * Matches cowork officialTranscriptTypes / LocalSessionManager loadTranscriptFromDisk.
 */
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

/** Official residual: yield every 200 lines while parsing (Az / Ptr=200). */
const PARSE_YIELD_EVERY = 200;

/** Official residual: diskTranscriptCache = new ItA(_tr=8). */
const TRANSCRIPT_CACHE_CAPACITY = 8;

/**
 * Metadata only needs early fields (cwd / title / first user) + last timestamp.
 * Cap head/tail windows so a 400MB jsonl never fully enters V8 for list/title refresh.
 */
const METADATA_HEAD_BYTES = 512 * 1024;
const METADATA_TAIL_BYTES = 256 * 1024;

type AgentStat = { mtimeMs: number; size: number };

/**
 * Official diskTranscriptCache entry shape:
 * { mainMtimeMs, mainIno, mainSize, agentStats, messages }
 */
type TranscriptCacheEntry = {
  projectDir: string;
  mainMtimeMs: number;
  mainIno: number;
  mainSize: number;
  agentStats: Map<string, AgentStat>;
  messages: unknown[];
};

/** Keyed by cliSessionId — official diskTranscriptCache.get(cliSessionId). */
const transcriptCache = new Map<string, TranscriptCacheEntry>();
const projectDirCache = new Map<string, string>();

/** Optional path hints for resolve (official session.cwd / worktreePath / originCwd). */
export type CodeTranscriptResolveHints = {
  cwd?: string;
  worktreePath?: string;
  originCwd?: string;
};

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

function normalizeHints(
  cwdOrHints?: string | CodeTranscriptResolveHints,
): CodeTranscriptResolveHints {
  if (typeof cwdOrHints === "string") return { cwd: cwdOrHints };
  return cwdOrHints ?? {};
}

/**
 * Locate the project dir (and thus jsonl) for a cliSessionId.
 * Official resolveProjectDirForSession residual:
 *   cache → try mangled {cwd, worktreePath, originCwd, ssh-<id>} → readdir for THAT one id.
 */
export async function resolveCodeProjectDir(
  cliSessionId: string | undefined,
  cwdOrHints?: string | CodeTranscriptResolveHints,
  configDir: string = defaultConfigDir(),
): Promise<string | null> {
  if (!cliSessionId || !/^[a-zA-Z0-9_-]+$/.test(cliSessionId)) return null;

  const cachedDir = projectDirCache.get(cliSessionId);
  if (cachedDir) {
    const cached = join(cachedDir, `${cliSessionId}.jsonl`);
    if (await isRegularFile(cached)) return cachedDir;
    projectDirCache.delete(cliSessionId);
  }

  const projectsDir = join(configDir, "projects");
  const hints = normalizeHints(cwdOrHints);
  const candidates = new Set<string>();

  // Official also tries ssh-${cliSessionId} for remote mirrors.
  candidates.add(`ssh-${cliSessionId}`);

  for (const raw of [hints.cwd, hints.worktreePath, hints.originCwd]) {
    if (!raw) continue;
    const canonical = await realpath(raw).catch(() => raw);
    const mangled = mangleCodeProjectDir(canonical);
    if (mangled.length <= 200) candidates.add(mangled);
  }

  for (const name of candidates) {
    const dir = join(projectsDir, name);
    if (await isRegularFile(join(dir, `${cliSessionId}.jsonl`))) {
      projectDirCache.set(cliSessionId, dir);
      return dir;
    }
  }

  const projects = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  // Official pushes ssh-sessions to the end of the scan order.
  const ordered = [...projects];
  const sshIdx = ordered.findIndex((entry) => entry.name === "ssh-sessions");
  if (sshIdx !== -1) {
    const [ssh] = ordered.splice(sshIdx, 1);
    if (ssh) ordered.push(ssh);
  }

  for (const project of ordered) {
    if (!project.isDirectory()) continue;
    const dir = join(projectsDir, project.name);
    if (await isRegularFile(join(dir, `${cliSessionId}.jsonl`))) {
      projectDirCache.set(cliSessionId, dir);
      return dir;
    }
  }
  return null;
}

/**
 * Locate the jsonl for a cliSessionId. Prefer mangled-cwd dir (cheap), then scan project
 * dirs for THAT one file only — never bulk-read every jsonl (official resolveProjectDirForSession).
 */
export async function resolveCodeTranscriptPath(
  cliSessionId: string | undefined,
  cwdOrHints?: string | CodeTranscriptResolveHints,
  configDir: string = defaultConfigDir(),
): Promise<string | null> {
  const dir = await resolveCodeProjectDir(cliSessionId, cwdOrHints, configDir);
  if (!dir || !cliSessionId) return null;
  return join(dir, `${cliSessionId}.jsonl`);
}

/** Official Az residual: iterate lines, yield to event loop every N lines. */
async function* iterateLines(content: string): AsyncGenerator<string> {
  let index = 0;
  let count = 0;
  const length = content.length;
  while (index < length) {
    const next = content.indexOf("\n", index);
    const end = next === -1 ? length : next;
    if (end > index) {
      const line = content.substring(index, end);
      if (line.trim()) {
        yield line;
        count += 1;
        if (count % PARSE_YIELD_EVERY === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    }
    index = end + 1;
  }
}

/** Official ez residual: read a byte window, snap end to last newline. */
async function readByteWindow(
  filePath: string,
  start: number,
  end: number,
): Promise<{ content: string; bytesConsumed: number }> {
  const length = end - start;
  if (length <= 0) return { content: "", bytesConsumed: 0 };
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const lastNl = buffer.lastIndexOf(10, offset - 1);
    if (lastNl === -1) return { content: "", bytesConsumed: 0 };
    const consumed = lastNl + 1;
    return { content: buffer.toString("utf8", 0, consumed), bytesConsumed: consumed };
  } finally {
    await handle.close();
  }
}

/**
 * Official stripThinkingBlocks residual:
 * filter message.content blocks with type thinking / redacted_thinking.
 * Returns null when an assistant message becomes empty after strip (dropped from transcript).
 */
export function stripThinkingBlocks(event: unknown): unknown | null {
  const record = asRecord(event);
  if (record.type !== "assistant" || !("message" in record)) return event;
  const message = asRecord(record.message);
  if (!Array.isArray(message.content)) return event;
  const filtered = message.content.filter((block) => {
    if (typeof block === "object" && block !== null && "type" in block) {
      const type = (block as { type?: unknown }).type;
      return type !== "thinking" && type !== "redacted_thinking";
    }
    return true;
  });
  if (filtered.length === 0) return null;
  return { ...record, message: { ...message, content: filtered } };
}

/**
 * Official Utr residual — agent sub-transcript rows kept only when they carry
 * tool_use / tool_result content (assistant or user).
 */
export function isAgentToolMessage(event: unknown): boolean {
  const record = asRecord(event);
  if (record.type !== "assistant" && record.type !== "user") return false;
  const content = asRecord(record.message).content;
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (typeof block !== "object" || block === null || !("type" in block)) return false;
    const type = (block as { type?: unknown }).type;
    return type === "tool_use" || type === "tool_result";
  });
}

function extractAgentId(event: JsonlRecord): string | undefined {
  const result = asRecord(event.toolUseResult);
  const agentId = asString(result.agentId);
  if (agentId && /^[a-zA-Z0-9_-]+$/.test(agentId)) return agentId;
  return undefined;
}

function eventTimestamp(event: unknown): string | undefined {
  return asString(asRecord(event).timestamp);
}

function sortByTimestamp(events: unknown[]): void {
  events.sort((left, right) => {
    const a = eventTimestamp(left);
    const b = eventTimestamp(right);
    if (!a || !b) return 0;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
}

async function parseMainChunk(
  content: string,
  into: unknown[],
  agentIds: Set<string>,
): Promise<void> {
  for await (const line of iterateLines(content)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    const type = asString(record.type);
    if (!type || !CODE_TRANSCRIPT_TYPES.has(type)) continue;

    if (type === "assistant") {
      const stripped = stripThinkingBlocks(record);
      if (stripped !== null) into.push(stripped);
    } else {
      into.push(record);
    }

    const agentId = extractAgentId(record);
    if (agentId) agentIds.add(agentId);
  }
}

async function parseAgentChunk(content: string, into: unknown[]): Promise<void> {
  for await (const line of iterateLines(content)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isAgentToolMessage(parsed)) into.push(parsed);
  }
}

async function loadAgentFile(
  projectDir: string,
  agentId: string,
): Promise<{ agentId: string; stat?: AgentStat; agentMsgs: unknown[] }> {
  const filePath = join(projectDir, `agent-${agentId}.jsonl`);
  try {
    const stat = await lstat(filePath);
    if (!stat.isFile()) return { agentId, agentMsgs: [] };
    const window = await readByteWindow(filePath, 0, stat.size);
    const agentMsgs: unknown[] = [];
    await parseAgentChunk(window.content, agentMsgs);
    return {
      agentId,
      stat: { mtimeMs: stat.mtimeMs, size: window.bytesConsumed },
      agentMsgs,
    };
  } catch {
    return { agentId, agentMsgs: [] };
  }
}

function rememberTranscript(cliSessionId: string, entry: TranscriptCacheEntry): void {
  if (transcriptCache.has(cliSessionId)) transcriptCache.delete(cliSessionId);
  transcriptCache.set(cliSessionId, entry);
  while (transcriptCache.size > TRANSCRIPT_CACHE_CAPACITY) {
    const oldest = transcriptCache.keys().next().value;
    if (oldest === undefined) break;
    transcriptCache.delete(oldest);
  }
}

/** Test/dev helper — drop caches between cases. */
export function clearCodeTranscriptCaches(): void {
  transcriptCache.clear();
  projectDirCache.clear();
}

/**
 * Parse raw jsonl into transcript events for the renderer (raw CLI event shape preserved).
 * Official loadTranscriptFromDisk residual:
 *   resolve project dir → ez/Az parse main → stripThinking → collect agentIds →
 *   merge agent-*.jsonl (Utr) → sort by timestamp → LRU cache w/ incremental append.
 */
export async function readCodeTranscript(
  cliSessionId: string | undefined,
  cwdOrHints?: string | CodeTranscriptResolveHints,
  configDir: string = defaultConfigDir(),
): Promise<unknown[]> {
  if (!cliSessionId || !/^[a-zA-Z0-9_-]+$/.test(cliSessionId)) return [];

  const projectDir = await resolveCodeProjectDir(cliSessionId, cwdOrHints, configDir);
  if (!projectDir) return [];

  const mainPath = join(projectDir, `${cliSessionId}.jsonl`);
  let mainStat;
  try {
    mainStat = await lstat(mainPath);
  } catch {
    projectDirCache.delete(cliSessionId);
    transcriptCache.delete(cliSessionId);
    return [];
  }
  if (!mainStat.isFile()) return [];

  const cached = transcriptCache.get(cliSessionId);

  // ---- cache hit: identical main + agent stats ----
  if (cached && cached.projectDir === projectDir) {
    const agentChecks = await Promise.all(
      Array.from(cached.agentStats, async ([agentId, prev]) => {
        try {
          const cur = await lstat(join(projectDir, `agent-${agentId}.jsonl`));
          return { agentId, prev, cur };
        } catch {
          return { agentId, prev, cur: undefined as Awaited<ReturnType<typeof lstat>> | undefined };
        }
      }),
    );
    const mainUnchanged =
      cached.mainMtimeMs === mainStat.mtimeMs && cached.mainSize === mainStat.size;
    const agentsUnchanged = agentChecks.every(
      (row) =>
        row.cur
        && row.cur.mtimeMs === row.prev.mtimeMs
        && row.cur.size === row.prev.size,
    );
    if (mainUnchanged && agentsUnchanged) {
      rememberTranscript(cliSessionId, cached);
      return cached.messages.slice();
    }

    // ---- incremental append (same inode, size grew) — official residual ----
    const mainAppendable =
      mainStat.ino === cached.mainIno && mainStat.size >= cached.mainSize;
    const agentsAppendable = agentChecks.every(
      (row) => row.cur && row.cur.size >= row.prev.size,
    );
    if (mainAppendable && agentsAppendable) {
      try {
        const messages = cached.messages.slice();
        const agentStats = new Map(cached.agentStats);
        const newAgentIds = new Set<string>();

        const delta = await readByteWindow(mainPath, cached.mainSize, mainStat.size);
        await parseMainChunk(delta.content, messages, newAgentIds);
        const mainSize = cached.mainSize + delta.bytesConsumed;

        // Agents already known: only parse growth; drop from "new" set.
        for (const known of agentStats.keys()) newAgentIds.delete(known);

        const grown = await Promise.all(
          agentChecks.map(async ({ agentId, prev, cur }) => {
            if (!cur) return;
            if (cur.size === prev.size) {
              agentStats.set(agentId, { mtimeMs: cur.mtimeMs, size: prev.size });
              return;
            }
            const chunk = await readByteWindow(
              join(projectDir, `agent-${agentId}.jsonl`),
              prev.size,
              cur.size,
            );
            const extra: unknown[] = [];
            await parseAgentChunk(chunk.content, extra);
            agentStats.set(agentId, {
              mtimeMs: cur.mtimeMs,
              size: prev.size + chunk.bytesConsumed,
            });
            return extra;
          }),
        );
        for (const extra of grown) {
          if (extra) for (const event of extra) messages.push(event);
        }

        let agentsComplete = true;
        if (newAgentIds.size > 0) {
          const loaded = await Promise.all(
            Array.from(newAgentIds, (id) => loadAgentFile(projectDir, id)),
          );
          for (const { agentId, stat, agentMsgs } of loaded) {
            if (!stat) {
              agentsComplete = false;
              continue;
            }
            agentStats.set(agentId, stat);
            for (const event of agentMsgs) messages.push(event);
          }
        }

        sortByTimestamp(messages);
        if (agentsComplete) {
          rememberTranscript(cliSessionId, {
            projectDir,
            mainMtimeMs: mainStat.mtimeMs,
            mainIno: mainStat.ino,
            mainSize,
            agentStats,
            messages,
          });
        } else {
          transcriptCache.delete(cliSessionId);
        }
        return messages.slice();
      } catch {
        transcriptCache.delete(cliSessionId);
        // Fall through to full parse.
      }
    } else {
      transcriptCache.delete(cliSessionId);
    }
  }

  // ---- full parse ----
  let mainWindow: { content: string; bytesConsumed: number };
  try {
    mainWindow = await readByteWindow(mainPath, 0, mainStat.size);
  } catch {
    projectDirCache.delete(cliSessionId);
    transcriptCache.delete(cliSessionId);
    return [];
  }

  const messages: unknown[] = [];
  const agentIds = new Set<string>();
  await parseMainChunk(mainWindow.content, messages, agentIds);

  const agentStats = new Map<string, AgentStat>();
  if (agentIds.size > 0) {
    const loaded = await Promise.all(
      Array.from(agentIds, (id) => loadAgentFile(projectDir, id)),
    );
    for (const { agentId, stat, agentMsgs } of loaded) {
      if (stat) agentStats.set(agentId, stat);
      for (const event of agentMsgs) messages.push(event);
    }
  }

  sortByTimestamp(messages);

  // Official only caches when every discovered agent file loaded successfully.
  if (agentStats.size === agentIds.size) {
    rememberTranscript(cliSessionId, {
      projectDir,
      mainMtimeMs: mainStat.mtimeMs,
      mainIno: mainStat.ino,
      mainSize: mainWindow.bytesConsumed,
      agentStats,
      messages,
    });
  }

  return messages.slice();
}

export type CodeSessionFileInfo = {
  cliSessionId: string;
  filePath: string;
  mtimeMs: number;
  size: number;
  /** Project dir name (mangled cwd); real cwd is read from jsonl content. */
  projectDir: string;
};

/**
 * Enumerate CLI session jsonl files (metadata paths only — no content read).
 * Official does NOT call this on getAll. Keep for explicit import / diagnostics only.
 */
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
      // Skip agent sub-transcripts (official agent-*.jsonl) — never list as sessions.
      if (entry.name.startsWith("agent-")) continue;
      const filePath = join(dirPath, entry.name);
      const stat = await lstat(filePath).catch(() => null);
      if (!stat?.isFile()) continue;
      files.push({
        cliSessionId: basename(entry.name, ".jsonl"),
        filePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
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

function absorbMetadataLine(
  line: string,
  state: {
    cwd?: string;
    customTitle?: string;
    createdAt?: string;
    updatedAt?: string;
    firstUserText?: string;
  },
  mode: "head" | "tail",
): void {
  let record: JsonlRecord;
  try {
    record = JSON.parse(line) as JsonlRecord;
  } catch {
    return;
  }
  if (mode === "head") {
    if (!state.cwd) state.cwd = asString(record.cwd);
    if (!state.customTitle && record.type === "custom-title") {
      state.customTitle = asString(record.customTitle);
    }
    if (!state.firstUserText && record.type === "user") {
      const message = asRecord(record.message);
      const text = contentToText(message.content ?? record.content);
      if (text && !isBoilerplateUserText(text)) state.firstUserText = text;
    }
  }
  const timestamp = asString(record.timestamp);
  if (!timestamp) return;
  if (mode === "head") {
    if (!state.createdAt) state.createdAt = timestamp;
    state.updatedAt = timestamp;
  } else {
    state.updatedAt = timestamp;
    if (!state.createdAt) state.createdAt = timestamp;
  }
}

/**
 * Extract sidebar metadata from one jsonl WITHOUT reading the whole file.
 * Head window → cwd / custom-title / first user / createdAt.
 * Tail window → updatedAt (append-only last timestamps).
 */
export async function readCodeSessionMetadata(
  filePath: string,
  cliSessionId: string,
): Promise<CodeSessionMetadata | null> {
  const stat = await lstat(filePath).catch(() => null);
  if (!stat?.isFile()) return null;

  const state: {
    cwd?: string;
    customTitle?: string;
    createdAt?: string;
    updatedAt?: string;
    firstUserText?: string;
  } = {};

  const headEnd = Math.min(stat.size, METADATA_HEAD_BYTES);
  try {
    const head = await readByteWindow(filePath, 0, headEnd);
    // Scan the whole head window: custom-title may appear after the first user line.
    // Do not early-exit on firstUserText alone (official title: custom-title wins).
    for await (const line of iterateLines(head.content)) {
      absorbMetadataLine(line, state, "head");
    }
  } catch {
    return null;
  }

  if (stat.size > headEnd) {
    const tailStart = Math.max(0, stat.size - METADATA_TAIL_BYTES);
    try {
      const tail = await readByteWindow(filePath, tailStart, stat.size);
      // Drop first partial line after mid-file start.
      const firstNl = tail.content.indexOf("\n");
      const tailContent = firstNl >= 0 ? tail.content.slice(firstNl + 1) : "";
      for await (const line of iterateLines(tailContent)) {
        absorbMetadataLine(line, state, "tail");
      }
    } catch {
      // Head metadata is still usable.
    }
  }

  const titleSource =
    state.customTitle && state.customTitle !== "new session"
      ? state.customTitle
      : (state.firstUserText ?? "CLI session");
  const title = (titleSource.split("\n")[0] ?? titleSource).slice(0, 80);
  return {
    cliSessionId,
    cwd: state.cwd,
    title,
    createdAt: state.createdAt ?? new Date(0).toISOString(),
    updatedAt: state.updatedAt ?? state.createdAt ?? new Date(0).toISOString(),
  };
}

/** Expose dirname helper for tests that need the project dir next to a resolved path. */
export function projectDirFromTranscriptPath(transcriptPath: string): string {
  return dirname(transcriptPath);
}
