import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type LocalSessionKind = "epitaxy" | "code";

export type LocalSessionMessage = { id: string; role: "user" | "assistant" | "system"; text: string; createdAt: string; raw?: unknown };

export type LocalSessionRuntime = {
  kind: "local" | "claude-cli";
  executable?: string;
  lastExitCode?: number | null;
  lastError?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type LocalMountedProject = {
  uuid: string;
  name: string;
  hostPath: string;
};

export type LocalToolPermissionRequest = {
  alwaysAllowScope?: string;
  decisionReason?: string;
  description?: string;
  hasAlwaysAllow?: boolean;
  input?: unknown;
  requestId: string;
  sessionId: string;
  suggestions?: unknown;
  toolName: string;
  toolUseId?: string;
};

export type LocalSession = {
  id: string;
  sessionId?: string;
  title: string;
  kind: LocalSessionKind;
  createdAt: string;
  updatedAt: string;
  cwd?: string;
  folders?: string[];
  trustedFolders?: string[];
  model?: string;
  effort?: string;
  permissionMode?: string;
  sourceBranch?: string;
  useWorktree?: boolean;
  worktreeName?: string;
  visibility?: string;
  agent?: string;
  agents?: unknown;
  enabledMcpTools?: unknown[];
  mcpServers?: unknown;
  remoteMcpServers?: unknown;
  systemPrompt?: string;
  systemPromptAppend?: string;
  tools?: unknown[];
  messages: LocalSessionMessage[];
  transcript?: unknown[];
  archived?: boolean;
  stopped?: boolean;
  sessionKind?: string;
  scheduledTaskId?: string;
  lastActivityAt?: string;
  isRunning?: boolean;
  origin?: string;
  userSelectedFolders?: string[];
  userSelectedFiles?: string[];
  mountedProjects?: LocalMountedProject[];
  cliSessionId?: string;
  slashCommands?: string[];
  runtime?: LocalSessionRuntime;
  metadata?: Record<string, unknown>;
  pendingToolPermissions?: LocalToolPermissionRequest[];
};

export type StartLocalSessionInput = {
  sessionId?: string;
  message?: string;
  prompt?: string;
  cwd?: string;
  kind?: LocalSessionKind;
  title?: string;
  folders?: string[];
  messageUuid?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  sourceBranch?: string;
  useWorktree?: boolean;
  worktreeName?: string;
  agent?: string;
  agents?: unknown;
  enabledMcpTools?: unknown[];
  mcpServers?: unknown;
  remoteMcpServers?: unknown;
  scheduledTaskId?: string;
  systemPrompt?: string;
  systemPromptAppend?: string;
  tools?: unknown[];
  origin?: string;
  userSelectedFolders?: string[];
  userSelectedFiles?: string[];
  mountedProjects?: LocalMountedProject[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function titleFromPrompt(prompt?: string, kind?: string): string {
  const visiblePrompt = prompt?.replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>\s*/g, "").trim();
  const first = visiblePrompt?.split("\n")[0]?.trim() ?? "";
  // Official local code empty/placeholder → "Coding session" (c11959232 header fallback path).
  if (!first || /^\d+$/.test(first)) {
    return kind === "code" ? "Coding session" : "New session";
  }
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

function isPlaceholderSessionTitle(title?: string, kind?: string): boolean {
  const text = title?.trim() ?? "";
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (text === "Untitled" || text === "Untitled session") return true;
  if (kind === "code" && (text === "Coding session" || text === "General coding session" || text === "New session")) return true;
  if (kind !== "code" && text === "New session") return true;
  return false;
}

/** Prefer first user prompt line for list/header once a turn has content. */
function titleFromSessionMessages(session: LocalSession): string | null {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const user = messages.find((message) => message.role === "user" && typeof message.text === "string" && message.text.trim());
  if (!user?.text) return null;
  const next = titleFromPrompt(user.text, session.kind === "code" ? "code" : "cowork");
  return isPlaceholderSessionTitle(next, session.kind === "code" ? "code" : "cowork") ? null : next;
}

function uniqueStrings(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))] : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function messageIdFromRaw(raw: unknown, role?: LocalSessionMessage["role"]): string | undefined {
  const envelope = asRecord(raw);
  // Prefer explicit bridge uuid, then Anthropic message.id for assistants (official eke key).
  // Outer CLI NDJSON `uuid` is per event and must not mint a new durable row per partial.
  const nested = asRecord(envelope.message);
  const nestedInRaw = asRecord(asRecord(envelope.raw).message);
  const anthropicId =
    (typeof nested.id === "string" && nested.id.length > 0 ? nested.id : undefined)
    ?? (typeof nestedInRaw.id === "string" && nestedInRaw.id.length > 0 ? nestedInRaw.id : undefined)
    ?? (typeof envelope.message_id === "string" && envelope.message_id.length > 0 ? envelope.message_id : undefined);
  if ((role === "assistant" || envelope.type === "assistant" || nested.role === "assistant") && anthropicId) {
    return anthropicId;
  }
  const messageUuid = envelope.messageUuid;
  if (typeof messageUuid === "string" && messageUuid.length > 0) return messageUuid;
  if (typeof envelope.uuid === "string" && envelope.uuid.length > 0) return envelope.uuid;
  if (typeof envelope.id === "string" && envelope.id.length > 0) return envelope.id;
  return anthropicId;
}

function createMessage(role: LocalSessionMessage["role"], text: string, createdAt = nowIso(), raw?: unknown): LocalSessionMessage {
  return {
    id: messageIdFromRaw(raw, role) ?? `msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    role,
    text,
    createdAt,
    raw,
  };
}

function transcriptMessage(sessionId: string, message: LocalSessionMessage): Record<string, unknown> {
  // Prefer the original CLI/event envelope when present so eke sees nested Anthropic message.id
  // and tool_use blocks instead of a flattened text-only reconstruction.
  const original = asRecord(message.raw);
  if (typeof original.type === "string" && (original.type === "assistant" || original.type === "user" || original.type === "system" || original.type === "result")) {
    return {
      ...original,
      sessionId: typeof original.sessionId === "string" ? original.sessionId : sessionId,
      uuid: typeof original.uuid === "string" ? original.uuid : message.id,
      timestamp: typeof original.timestamp === "string" ? original.timestamp : message.createdAt,
      text: typeof original.text === "string" ? original.text : message.text,
    };
  }
  const userSelectedFiles = uniqueStrings(original.userSelectedFiles);
  return {
    type: message.role,
    sessionId,
    uuid: message.id,
    timestamp: message.createdAt,
    message: { role: message.role, content: message.text },
    text: message.text,
    ...(userSelectedFiles.length > 0 ? { userSelectedFiles } : {}),
  };
}

/**
 * Official-aligned identity for transcript collapse (index-BELzQL5P eke / Lt stream replace):
 * - Assistant: Anthropic `message.id` first so multi-emit NDJSON partials + durable chat row collapse.
 * - Other roles: outer CLI uuid / id (each user event is unique).
 * Also accepts LocalSessionMessage shape where the CLI envelope lives under `.raw`.
 */
function messageIdentity(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const raw = asRecord(value);
  // LocalSessionMessage: { id, role, text, raw: cliEvent }
  const nestedEnvelope = asRecord(raw.raw);
  const envelope = typeof nestedEnvelope.type === "string" || nestedEnvelope.message ? nestedEnvelope : raw;
  const nested = asRecord(envelope.message);
  const role = typeof raw.role === "string" ? raw.role : typeof envelope.type === "string" ? envelope.type : typeof nested.role === "string" ? nested.role : undefined;
  const anthropicId =
    (typeof nested.id === "string" && nested.id.length > 0 ? nested.id : undefined)
    ?? (typeof envelope.message_id === "string" && envelope.message_id.length > 0 ? envelope.message_id : undefined);
  if ((role === "assistant" || envelope.type === "assistant") && anthropicId) {
    return anthropicId;
  }
  if (typeof envelope.uuid === "string" && envelope.uuid.length > 0) return envelope.uuid;
  if (typeof envelope.id === "string" && envelope.id.length > 0) return envelope.id;
  if (typeof raw.uuid === "string" && raw.uuid.length > 0) return raw.uuid;
  if (typeof raw.id === "string" && raw.id.length > 0) return raw.id;
  if (anthropicId) return anthropicId;
  if (typeof nested.uuid === "string" && nested.uuid.length > 0) return nested.uuid;
  return undefined;
}

function timestampValue(value: unknown): string | undefined {
  const raw = asRecord(value);
  const nested = asRecord(raw.message);
  return typeof raw.createdAt === "string" ? raw.createdAt
    : typeof raw.timestamp === "string" ? raw.timestamp
      : typeof nested.createdAt === "string" ? nested.createdAt
        : typeof nested.timestamp === "string" ? nested.timestamp
          : undefined;
}

/**
 * Outer CLI NDJSON uuid (per-event). Official eke/zke identity for live rows —
 * multi-emit assistants share Anthropic message.id but have DIFFERENT outer uuids.
 * Host transcript must keep both; eke f() merges consecutive assistant items.
 */
function outerEventUuid(value: unknown): string | undefined {
  const raw = asRecord(value);
  const nestedEnvelope = asRecord(raw.raw);
  const envelope = typeof nestedEnvelope.type === "string" || nestedEnvelope.message ? nestedEnvelope : raw;
  if (typeof envelope.uuid === "string" && envelope.uuid.length > 0) return envelope.uuid;
  if (typeof envelope.id === "string" && envelope.id.length > 0 && envelope.type !== "assistant") {
    // Prefer uuid; bare id only when not risking Anthropic message.id collision.
    return envelope.id;
  }
  if (typeof raw.uuid === "string" && raw.uuid.length > 0) return raw.uuid;
  if (typeof raw.id === "string" && raw.id.length > 0) return raw.id;
  return undefined;
}

/**
 * Same-outer-uuid replace only (not Anthropic message.id collapse).
 * Official never winner-take-all multi-emit by thinking/text length.
 */
function preferRicherTranscriptEvent(prev: unknown, next: unknown): unknown {
  const prevScore = transcriptEventRichness(prev);
  const nextScore = transcriptEventRichness(next);
  return nextScore >= prevScore ? next : prev;
}

function contentBlocksOf(raw: Record<string, unknown>): unknown[] {
  const nested = asRecord(raw.message);
  const content = nested.content ?? raw.content;
  if (Array.isArray(content)) return content.slice();
  if (typeof content === "string" && content.length > 0) return [{ type: "text", text: content }];
  if (typeof raw.text === "string" && raw.text.length > 0) return [{ type: "text", text: raw.text }];
  return [];
}

function contentBlockKey(block: unknown): string {
  const record = asRecord(block);
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "tool_use" && typeof record.id === "string") return `tool_use:${record.id}`;
  if (type === "thinking") return `thinking:${typeof record.thinking === "string" ? record.thinking : ""}`;
  if (type === "text") return `text:${typeof record.text === "string" ? record.text : ""}`;
  try {
    return `${type}:${JSON.stringify(record)}`;
  } catch {
    return type || "block";
  }
}

/**
 * Durable session.messages only: one chat-history row per Anthropic message.id
 * may still union content (search/title). Transcript itself stays multi-emit.
 */
function mergeAssistantTranscriptEvents(
  prevRaw: Record<string, unknown>,
  nextRaw: Record<string, unknown>,
): Record<string, unknown> {
  const prevNested = asRecord(prevRaw.message);
  const nextNested = asRecord(nextRaw.message);
  const mergedBlocks: unknown[] = [];
  const seen = new Set<string>();
  for (const block of [...contentBlocksOf(prevRaw), ...contentBlocksOf(nextRaw)]) {
    const key = contentBlockKey(block);
    if (seen.has(key)) continue;
    seen.add(key);
    mergedBlocks.push(block);
  }
  const prevText = typeof prevRaw.text === "string" ? prevRaw.text : "";
  const nextText = typeof nextRaw.text === "string" ? nextRaw.text : "";
  const textFromBlocks = mergedBlocks
    .map((block) => {
      const record = asRecord(block);
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
  const text =
    textFromBlocks
    || (nextText.length >= prevText.length ? nextText : prevText);
  return {
    ...prevRaw,
    ...nextRaw,
    uuid: typeof prevRaw.uuid === "string" ? prevRaw.uuid : nextRaw.uuid,
    timestamp: typeof prevRaw.timestamp === "string" ? prevRaw.timestamp : nextRaw.timestamp,
    text,
    message: {
      ...prevNested,
      ...nextNested,
      id: typeof nextNested.id === "string" ? nextNested.id : prevNested.id,
      role: "assistant",
      content: mergedBlocks,
    },
  };
}

function transcriptEventRichness(value: unknown): number {
  const raw = asRecord(value);
  const nested = asRecord(raw.message);
  const content = nested.content ?? raw.content;
  if (Array.isArray(content)) {
    let score = content.length * 1000;
    for (const block of content) {
      const record = asRecord(block);
      const type = typeof record.type === "string" ? record.type : "";
      if (type === "tool_use") score += 500;
      if (type === "text" && typeof record.text === "string") score += record.text.length;
      if (type === "thinking" && typeof record.thinking === "string") score += record.thinking.length;
    }
    return score;
  }
  if (typeof content === "string") return content.length;
  if (typeof raw.text === "string") return raw.text.length;
  return 0;
}

function sliceThroughMessageId<T>(items: T[] | undefined, messageId?: string): T[] {
  const source = items ?? [];
  if (!messageId) return [...source];
  const index = source.findIndex((item) => messageIdentity(item) === messageId);
  return index < 0 ? [...source] : source.slice(0, index + 1);
}

function sliceMessagesForTranscriptCutoff(messages: LocalSessionMessage[] | undefined, transcript: unknown[], messageId?: string): LocalSessionMessage[] {
  const source = messages ?? [];
  if (!messageId) return [...source];
  const directIndex = source.findIndex((message) => messageIdentity(message) === messageId || messageIdentity(message.raw) === messageId);
  if (directIndex >= 0) return source.slice(0, directIndex + 1);
  const transcriptIndex = transcript.findIndex((item) => messageIdentity(item) === messageId);
  const cutoffTimestamp = transcriptIndex >= 0 ? timestampValue(transcript[transcriptIndex]) : undefined;
  if (!cutoffTimestamp) return [...source];
  return source.filter((message) => message.createdAt <= cutoffTimestamp);
}

export class LocalSessionStore {
  private pendingSaveTimer: NodeJS.Timeout | null = null;
  private sessions = new Map<string, LocalSession>();
  private readonly filePath: string;

  constructor(private readonly defaultKind: LocalSessionKind, filePath = path.join(app.getPath("userData"), `${defaultKind}-sessions.json`)) {
    this.filePath = filePath;
    this.load();
  }

  getStorageFile(): string {
    return this.filePath;
  }

  getOutputsDir(): string {
    const dir = path.join(path.dirname(this.filePath), `${this.defaultKind}-outputs`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      this.sessions = new Map(sessions.map((session: LocalSession) => [session.id, session]));
    } catch {
      this.sessions = new Map();
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({ sessions: Array.from(this.sessions.values()) }, null, 2));
  }

  private saveSoon(): void {
    if (this.pendingSaveTimer) return;
    this.pendingSaveTimer = setTimeout(() => {
      this.pendingSaveTimer = null;
      this.save();
    }, 250);
  }

  private saveNow(): void {
    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = null;
    }
    this.save();
  }

  getAll(includeArchived = false): LocalSession[] {
    return Array.from(this.sessions.values())
      .filter((session) => includeArchived || !session.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  search(query: string): LocalSession[] {
    const lower = query.toLowerCase();
    return this.getAll(true).filter(
      (session) =>
        session.title.toLowerCase().includes(lower) ||
        session.cwd?.toLowerCase().includes(lower) ||
        session.messages.some((message) => message.text.toLowerCase().includes(lower)),
    );
  }

  getSession(id: string): LocalSession | null {
    return this.sessions.get(id) ?? null;
  }

  getTranscript(id: string): unknown[] {
    const session = this.sessions.get(id);
    if (!session) return [];
    // transcript is the raw CLI event log and includes stream_event noise. Chat UI must not
    // treat a stream-only log as the full history — otherwise durable assistants that only
    // live in session.messages disappear mid-stream ("new wipes old").
    const eventLog = Array.isArray(session.transcript) ? session.transcript : [];
    const durable = Array.isArray(session.messages) ? session.messages : [];
    const durableEvents = eventLog.filter((event) => {
      const type = asRecord(event).type;
      return type !== "stream_event";
    });
    if (durableEvents.length === 0) {
      return durable.map((message) => transcriptMessage(session.id, message));
    }
    // Official eke (index-BELzQL5P): KEEP multi-emit assistant rows that share Anthropic
    // message.id but differ on outer uuid (thinking emit + text emit). eke ake + f() merges
    // consecutive assistant items into one bubble. Host must NOT collapse by message.id.
    // Only de-dupe exact outer-uuid replays (same NDJSON event written twice).
    const out: unknown[] = [];
    const indexByOuterUuid = new Map<string, number>();
    const anthropicIdsPresent = new Set<string>();
    const putEvent = (event: unknown) => {
      const anthropicId = (() => {
        const raw = asRecord(event);
        const nested = asRecord(raw.message);
        if (raw.type === "assistant" || nested.role === "assistant") {
          return typeof nested.id === "string" && nested.id.length > 0
            ? nested.id
            : (typeof raw.message_id === "string" ? raw.message_id : undefined);
        }
        return undefined;
      })();
      if (anthropicId) anthropicIdsPresent.add(anthropicId);
      const outer = outerEventUuid(event);
      if (!outer) {
        out.push(event);
        return;
      }
      const existingIndex = indexByOuterUuid.get(outer);
      if (existingIndex === undefined) {
        indexByOuterUuid.set(outer, out.length);
        out.push(event);
        return;
      }
      // Same outer uuid only — richer replace (not multi-emit mid collapse).
      out[existingIndex] = preferRicherTranscriptEvent(out[existingIndex], event);
    };
    for (const event of durableEvents) putEvent(event);
    // Back-fill durable-only rows (optimistic user / appendMessage-only) missing from event log.
    // Assistants: if any multi-emit for this Anthropic id already exists, skip durable
    // (durable is mid-collapsed chat history, not a substitute for multi-emit transcript).
    for (const message of durable) {
      const event = transcriptMessage(session.id, message);
      if (message.role === "assistant") {
        const mid = messageIdentity(message) ?? message.id;
        if (mid && anthropicIdsPresent.has(mid)) continue;
      }
      const outer = outerEventUuid(event) ?? outerEventUuid(message) ?? message.id;
      if (outer && indexByOuterUuid.has(outer)) continue;
      putEvent(event);
    }
    return out;
  }

  getSessionsForScheduledTask(scheduledTaskId: string): LocalSession[] {
    return this.getAll(true).filter((session) => session.scheduledTaskId === scheduledTaskId);
  }

  start(input: StartLocalSessionInput = {}): LocalSession {
    const timestamp = nowIso();
    const prompt = input.prompt ?? input.message ?? "";
    const folders = uniqueStrings(input.folders).length > 0 ? uniqueStrings(input.folders) : uniqueStrings(input.userSelectedFolders);
    const userSelectedFiles = uniqueStrings(input.userSelectedFiles);
    const messageRaw = input.messageUuid || userSelectedFiles.length > 0 ? {
      ...(input.messageUuid ? { messageUuid: input.messageUuid } : {}),
      ...(userSelectedFiles.length > 0 ? { userSelectedFiles } : {}),
    } : undefined;
    const cwd = input.cwd ?? folders[0];
    const kind = input.kind ?? this.defaultKind;
    const sessionKind = kind === "code" ? "code" : "cowork";
    const idPrefix = sessionKind === "cowork" ? "local" : kind;
    const requestedId = typeof input.sessionId === "string" && input.sessionId.length > 0 ? input.sessionId : undefined;
    const id = requestedId && !this.sessions.has(requestedId)
      ? requestedId
      : `${idPrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const session: LocalSession = {
      id,
      sessionId: id,
      title: input.title ?? titleFromPrompt(prompt, kind === "code" ? "code" : "cowork"),
      kind,
      sessionKind,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      cwd,
      folders,
      userSelectedFolders: folders,
      model: input.model,
      effort: input.effort,
      permissionMode: input.permissionMode,
      sourceBranch: input.sourceBranch,
      useWorktree: input.useWorktree,
      worktreeName: input.worktreeName,
      agent: input.agent,
      agents: input.agents,
      enabledMcpTools: input.enabledMcpTools,
      mcpServers: input.mcpServers,
      remoteMcpServers: input.remoteMcpServers,
      systemPrompt: input.systemPrompt,
      systemPromptAppend: input.systemPromptAppend,
      tools: input.tools,
      scheduledTaskId: input.scheduledTaskId,
      origin: input.origin,
      userSelectedFiles,
      mountedProjects: input.mountedProjects,
      isRunning: false,
      messages: prompt || userSelectedFiles.length > 0 ? [createMessage("user", prompt, timestamp, messageRaw)] : [],
      transcript: [],
    };
    if (session.messages[0]) session.transcript = [transcriptMessage(session.id, session.messages[0])];
    this.sessions.set(session.id, session);
    this.save();
    return session;
  }

  importSession(input: Partial<LocalSession>): LocalSession {
    const session = this.start({ prompt: input.messages?.[0]?.text, cwd: input.cwd, title: input.title, kind: input.kind ?? this.defaultKind });
    const existing = input.messages;
    if (existing) session.messages = existing;
    session.metadata = { ...(session.metadata ?? {}), imported: true };
    this.sessions.set(session.id, session);
    this.save();
    return session;
  }

  update(id: string, input: Partial<LocalSession>): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const updatedAt = nowIso();
    const updated = { ...session, ...input, id, sessionId: id, kind: session.kind, updatedAt, lastActivityAt: updatedAt };
    this.sessions.set(id, updated);
    this.save();
    return updated;
  }

  sendMessage(id: string, text: string, role: LocalSessionMessage["role"] = "user", raw?: unknown): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const timestamp = nowIso();
    const message = createMessage(role, text, timestamp, raw);
    session.messages.push(message);
    session.transcript ??= [];
    session.transcript.push(transcriptMessage(session.id, message));
    session.updatedAt = timestamp;
    session.lastActivityAt = timestamp;
    this.save();
    return session;
  }

  appendMessage(id: string, role: LocalSessionMessage["role"], text: string, raw?: unknown, includeTranscript = true): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const timestamp = nowIso();
    const message = createMessage(role, text, timestamp, raw);
    // Official path keeps one durable assistant row per Anthropic message.id.
    // CLI multi-emit (thinking then text, same message.id) must MERGE content
    // blocks — never winner-take-all by length (thinking often longer than text).
    const identity = messageIdentity(message) ?? message.id;
    const existingIndex = session.messages.findIndex((item) => (messageIdentity(item) ?? item.id) === identity);
    if (existingIndex >= 0) {
      const existing = session.messages[existingIndex]!;
      if (existing.role === "assistant" && message.role === "assistant") {
        const existingRaw = asRecord(existing.raw ?? transcriptMessage(session.id, existing));
        const incomingRaw = asRecord(message.raw ?? transcriptMessage(session.id, message));
        const mergedRaw = mergeAssistantTranscriptEvents(existingRaw, incomingRaw);
        const mergedText =
          (typeof mergedRaw.text === "string" && mergedRaw.text.length > 0)
            ? mergedRaw.text
            : ((existing.text?.length ?? 0) >= (message.text?.length ?? 0) ? existing.text : message.text);
        session.messages[existingIndex] = {
          ...existing,
          text: mergedText,
          raw: mergedRaw,
        };
      } else {
        const preferIncoming = transcriptEventRichness(message) >= transcriptEventRichness(existing);
        session.messages[existingIndex] = preferIncoming
          ? { ...message, createdAt: existing.createdAt }
          : {
              ...existing,
              raw: existing.raw ?? message.raw,
              text: (existing.text?.length ?? 0) >= (message.text?.length ?? 0) ? existing.text : message.text,
            };
      }
    } else {
      session.messages.push(message);
    }
    if (includeTranscript) {
      session.transcript ??= [];
      const event = raw ?? transcriptMessage(session.id, message);
      // Outer uuid only — never Anthropic message.id (would collapse multi-emit).
      const eventIdentity = outerEventUuid(event);
      if (eventIdentity) {
        const transcriptIndex = session.transcript.findIndex((item) => outerEventUuid(item) === eventIdentity);
        if (transcriptIndex >= 0) {
          session.transcript[transcriptIndex] = preferRicherTranscriptEvent(session.transcript[transcriptIndex], event);
        } else {
          session.transcript.push(event);
        }
      } else {
        session.transcript.push(event);
      }
    }
    session.updatedAt = timestamp;
    session.lastActivityAt = timestamp;
    this.save();
    return session;
  }

  appendTranscriptEvent(id: string, event: unknown): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const timestamp = nowIso();
    session.transcript ??= [];
    session.transcript.push(event);
    session.updatedAt = timestamp;
    session.lastActivityAt = timestamp;
    asRecord(event).type === "stream_event" ? this.saveSoon() : this.saveNow();
    return session;
  }

  setRunning(id: string, isRunning: boolean, runtime?: Partial<LocalSessionRuntime>): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const timestamp = nowIso();
    session.isRunning = isRunning;
    session.stopped = !isRunning && session.stopped ? session.stopped : false;
    session.runtime = { ...(session.runtime ?? { kind: "local" }), ...runtime } as LocalSessionRuntime;
    // When a turn finishes, promote placeholder titles from the first user prompt (list + header parity).
    if (!isRunning && isPlaceholderSessionTitle(session.title, session.kind === "code" ? "code" : "cowork")) {
      const derived = titleFromSessionMessages(session);
      if (derived) session.title = derived;
    }
    session.updatedAt = timestamp;
    session.lastActivityAt = timestamp;
    this.save();
    return session;
  }

  /** Optional explicit title refresh after summarize / transcript settle. */
  refreshTitleFromMessages(id: string): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (!isPlaceholderSessionTitle(session.title, session.kind === "code" ? "code" : "cowork")) return session;
    const derived = titleFromSessionMessages(session);
    if (!derived) return session;
    return this.update(id, { title: derived });
  }

  setCliSessionId(id: string, cliSessionId: string): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.cliSessionId = cliSessionId;
    session.updatedAt = nowIso();
    this.save();
    return session;
  }

  setSlashCommands(id: string, slashCommands: string[]): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.slashCommands = [...new Set(slashCommands.filter((command) => typeof command === "string" && command.length > 0))];
    session.updatedAt = nowIso();
    this.save();
    return session;
  }

  setPendingToolPermission(id: string, request: LocalToolPermissionRequest): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const timestamp = nowIso();
    const pending = session.pendingToolPermissions ?? [];
    const index = pending.findIndex((item) => item.requestId === request.requestId);
    session.pendingToolPermissions = index < 0
      ? [...pending, request]
      : pending.map((item) => item.requestId === request.requestId ? request : item);
    session.updatedAt = timestamp;
    session.lastActivityAt = timestamp;
    this.save();
    return session;
  }

  clearPendingToolPermission(id: string, requestId: string): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const next = (session.pendingToolPermissions ?? []).filter((item) => item.requestId !== requestId);
    if (next.length === (session.pendingToolPermissions ?? []).length) return session;
    const timestamp = nowIso();
    session.pendingToolPermissions = next;
    session.updatedAt = timestamp;
    session.lastActivityAt = timestamp;
    this.save();
    return session;
  }

  clearPendingToolPermissions(id: string): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (!session.pendingToolPermissions?.length) return session;
    const timestamp = nowIso();
    session.pendingToolPermissions = [];
    session.updatedAt = timestamp;
    session.lastActivityAt = timestamp;
    this.save();
    return session;
  }

  archive(id: string): boolean {
    return Boolean(this.update(id, { archived: true }));
  }

  unarchive(id: string): boolean {
    return Boolean(this.update(id, { archived: false }));
  }

  stop(id: string): boolean {
    // Official LocalSessions.stop ends the turn: both stopped + not running.
    // Leaving isRunning=true keeps the composer stop button stuck (isResponding).
    const session = this.sessions.get(id);
    if (!session) return false;
    session.stopped = true;
    session.isRunning = false;
    session.pendingToolPermissions = [];
    session.updatedAt = nowIso();
    session.lastActivityAt = session.updatedAt;
    this.sessions.set(id, session);
    this.save();
    return true;
  }

  fork(id: string, messageId?: string): LocalSession | null {
    const source = this.sessions.get(id);
    if (!source) return null;
    const timestamp = nowIso();
    const transcript = sliceThroughMessageId(source.transcript, messageId);
    const messages = sliceMessagesForTranscriptCutoff(source.messages, transcript, messageId);
    const forked: LocalSession = {
      ...source,
      id: `${source.kind}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      sessionId: undefined,
      title: `${source.title} fork`,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      messages,
      transcript,
      isRunning: false,
      stopped: false,
      runtime: { kind: "local", finishedAt: timestamp },
      cliSessionId: undefined,
      metadata: {
        ...(source.metadata ?? {}),
        forkedFromCliSessionId: source.cliSessionId,
        forkedAtMessageId: messageId,
        sourceSessionId: source.id,
      },
    };
    forked.sessionId = forked.id;
    this.sessions.set(forked.id, forked);
    this.save();
    return forked;
  }

  rewind(id: string, messageId?: string): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session || !messageId) return null;
    const timestamp = nowIso();
    const transcript = sliceThroughMessageId(session.transcript, messageId);
    const messages = sliceMessagesForTranscriptCutoff(session.messages, transcript, messageId);
    const updated: LocalSession = {
      ...session,
      messages,
      transcript,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      isRunning: false,
      stopped: false,
      runtime: { ...(session.runtime ?? { kind: "local" }), finishedAt: timestamp },
      metadata: {
        ...(session.metadata ?? {}),
        rewoundAtMessageId: messageId,
      },
    };
    this.sessions.set(id, updated);
    this.save();
    return updated;
  }

  delete(id: string): boolean {
    const deleted = this.sessions.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  clearSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.messages = [];
    session.transcript = [];
    session.updatedAt = nowIso();
    this.save();
    return true;
  }

  addFolders(id: string, folders: unknown): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.folders = [...new Set([...(session.folders ?? []), ...uniqueStrings(folders)])];
    session.cwd ??= session.folders[0];
    session.userSelectedFolders = session.folders;
    session.updatedAt = nowIso();
    session.lastActivityAt = session.updatedAt;
    this.save();
    return session;
  }

  addTrustedFolder(folder: string): void {
    const session = this.getAll(true)[0] ?? this.start({ title: "Trusted folders" });
    session.trustedFolders = [...new Set([...(session.trustedFolders ?? []), folder])];
    session.updatedAt = nowIso();
    this.save();
  }

  removeTrustedFolder(folder: string): void {
    for (const session of this.sessions.values()) {
      session.trustedFolders = (session.trustedFolders ?? []).filter((item) => item !== folder);
    }
    this.save();
  }

  getTrustedFolders(): string[] {
    return [...new Set(Array.from(this.sessions.values()).flatMap((session) => session.trustedFolders ?? []))];
  }
}
