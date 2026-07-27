import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { readCodeSessionMetadata, readCodeTranscript, resolveCodeTranscriptPath } from "./codeTranscriptJsonl";

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
  /**
   * Chat content is read live from `~/.claude/projects/<mangled-cwd>/<cliSessionId>.jsonl`
   * (official `createCoworkRawTranscriptLoader`/`resolveTranscriptPath`). These fields are
   * legacy compatibility for old code-sessions.json: load keeps them in memory until
   * migrateStripContent runs; nothing new is written here.
   */
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
function titleFromLiveEvents(liveEvents: unknown[], kind?: string): string | null {
  for (const event of liveEvents) {
    const raw = asRecord(event);
    const isUser = raw.type === "user" || asRecord(raw.message).role === "user";
    if (!isUser) continue;
    const text = typeof raw.text === "string" ? raw.text : typeof asRecord(raw.message).content === "string" ? asRecord(raw.message).content as string : "";
    if (!text.trim()) continue;
    const next = titleFromPrompt(text, kind === "code" ? "code" : "cowork");
    if (!isPlaceholderSessionTitle(next, kind === "code" ? "code" : "cowork")) return next;
  }
  return null;
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

function sliceThroughMessageId<T>(items: T[] | undefined, messageId?: string): T[] {
  const source = items ?? [];
  if (!messageId) return [...source];
  const index = source.findIndex((item) => messageIdentity(item) === messageId);
  return index < 0 ? [...source] : source.slice(0, index + 1);
}

export class LocalSessionStore {
  private pendingSaveTimer: NodeJS.Timeout | null = null;
  private sessions = new Map<string, LocalSession>();
  /** In-memory incremental events for a running turn. Never persisted — the CLI flushes the
   * same events to the jsonl at turn end, where clearLiveBuffer swaps the source back to disk. */
  private liveBuffers = new Map<string, unknown[]>();
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
    this.migrateStripContent();
  }

  /**
   * One-time startup migration: chat content (messages/transcript) is no longer persisted
   * — the CLI jsonl under ~/.claude/projects is the durable source. Strip the fields from
   * the on-disk file (133MB → KB). Idempotent: marker set after the first strip.
   */
  private migrateStripContent(): void {
    let stripped = 0;
    for (const session of this.sessions.values()) {
      const metadata = (session.metadata ?? {}) as Record<string, unknown>;
      if (metadata.contentStrippedAt) continue;
      const hadContent = (Array.isArray(session.messages) && session.messages.length > 0)
        || (Array.isArray(session.transcript) && session.transcript.length > 0);
      if (!hadContent) continue;
      session.messages = [];
      session.transcript = [];
      session.metadata = { ...metadata, contentStrippedAt: nowIso() };
      stripped += 1;
    }
    if (stripped > 0) this.saveNow();
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

  /**
   * Register a metadata-only stub for a session discovered by scanning ~/.claude/projects
   * jsonl (origin "cli-jsonl"). Lets getSession/getTranscript resolve the row while its
   * content stays on disk in the jsonl. Debounced save — the sidebar scan can adopt many.
   */
  adoptScannedSession(session: LocalSession): void {
    if (this.sessions.has(session.id)) return;
    this.sessions.set(session.id, session);
    this.saveSoon();
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

  /** Live (running-turn) incremental events — memory only, never saved to userData. */
  appendLiveEvent(id: string, event: unknown): void {
    const buffer = this.liveBuffers.get(id);
    if (buffer) buffer.push(event);
    else this.liveBuffers.set(id, [event]);
  }

  getLiveEvents(id: string): unknown[] {
    return [...(this.liveBuffers.get(id) ?? [])];
  }

  clearLiveBuffer(id: string): void {
    this.liveBuffers.delete(id);
  }

  /**
   * Official-aligned: transcript always comes from the CLI jsonl on disk
   * (`~/.claude/projects/...`). A running turn appends its in-memory live tail because the
   * CLI only flushes to jsonl as events finalize. Sessions with no cliSessionId yet
   * (drafts never sent to the CLI) return just the live tail.
   */
  async getTranscript(id: string): Promise<unknown[]> {
    const session = this.sessions.get(id);
    if (!session) return [];
    let liveEvents = this.getLiveEvents(id);
    if (session.cliSessionId) {
      const fromDisk = await readCodeTranscript(session.cliSessionId, session.cwd);
      if (fromDisk.length > 0) {
        // The CLI echoes desktop-sent user rows into the jsonl with the same outer uuid —
        // drop live-tail rows already on disk so the merged view has no duplicates.
        const onDisk = new Set(fromDisk.map((event) => outerEventUuid(event)).filter(Boolean));
        liveEvents = liveEvents.filter((event) => {
          const outer = outerEventUuid(event);
          return !outer || !onDisk.has(outer);
        });
        return [...fromDisk, ...liveEvents];
      }
    }
    return liveEvents;
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
      // Chat content is never persisted — first prompt lives only in the live tail until the
      // CLI echoes it into the jsonl (official single-source-of-truth).
      messages: [],
      transcript: [],
    };
    if (prompt || userSelectedFiles.length > 0) {
      const firstMessage = createMessage("user", prompt, timestamp, messageRaw);
      this.liveBuffers.set(session.id, [transcriptMessage(session.id, firstMessage)]);
    }
    this.sessions.set(session.id, session);
    this.save();
    return session;
  }

  importSession(input: Partial<LocalSession>): LocalSession {
    const session = this.start({ prompt: input.messages?.[0]?.text, cwd: input.cwd, title: input.title, kind: input.kind ?? this.defaultKind });
    // Imported rows stay in the live tail (memory) — no userData messages copy.
    for (const message of input.messages ?? []) {
      this.liveBuffers.set(session.id, [...(this.liveBuffers.get(session.id) ?? []), transcriptMessage(session.id, message)]);
    }
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
    // Live tail only (memory) — the CLI jsonl is the durable transcript; userData must not
    // accumulate a messages/transcript copy (133MB code-sessions.json root cause). Skip when
    // the row is already in the tail (start() seeded it) or already on disk (CLI echoed it).
    const event = transcriptMessage(session.id, message);
    const outer = outerEventUuid(event);
    if (!outer || !this.liveBuffers.get(id)?.some((item) => outerEventUuid(item) === outer)) {
      this.appendLiveEvent(id, event);
    }
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
    if (includeTranscript) {
      const event = raw ?? transcriptMessage(session.id, message);
      // Live tail only (memory) — durable transcript is the CLI jsonl, not userData.
      // Dedupe on outer uuid: the CLI echoes user/system rows the desktop already appended.
      const outer = outerEventUuid(event);
      if (!outer || !this.liveBuffers.get(id)?.some((item) => outerEventUuid(item) === outer)) {
        this.appendLiveEvent(id, event);
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
    // Running-turn live tail (memory only) — getTranscript layers it over the disk jsonl.
    // Nothing is written to userData transcript (CLI jsonl is the durable source).
    // Dedupe on outer uuid: sendMessage's row and the CLI's echo share the same uuid.
    const outer = outerEventUuid(event);
    if (!outer || !this.liveBuffers.get(id)?.some((item) => outerEventUuid(item) === outer)) {
      this.appendLiveEvent(id, event);
    }
    session.updatedAt = timestamp;
    session.lastActivityAt = timestamp;
    this.save();
    return session;
  }

  setRunning(id: string, isRunning: boolean, runtime?: Partial<LocalSessionRuntime>): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const timestamp = nowIso();
    session.isRunning = isRunning;
    session.stopped = !isRunning && session.stopped ? session.stopped : false;
    session.runtime = { ...(session.runtime ?? { kind: "local" }), ...runtime } as LocalSessionRuntime;
    // Promote placeholder titles BEFORE clearing the live tail — the title comes from the
    // first user prompt which lives in the buffer until the CLI flushes the jsonl.
    if (!isRunning && isPlaceholderSessionTitle(session.title, session.kind === "code" ? "code" : "cowork")) {
      const derived = titleFromLiveEvents(this.getLiveEvents(id), session.kind);
      if (derived) session.title = derived;
    }
    // Turn ended → the CLI has flushed these events into the jsonl; drop the in-memory tail
    // so the next getTranscript reads from disk alone (single source of truth, like official).
    if (!isRunning) this.clearLiveBuffer(id);
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
    const derived = titleFromLiveEvents(this.getLiveEvents(id), session.kind);
    if (!derived) return session;
    return this.update(id, { title: derived });
  }

  /**
   * Refresh a placeholder title from the durable jsonl (custom-title wins, else first user
   * text). Called after a turn settles — the live buffer may already be cleared, so this
   * reads the CLI jsonl directly instead of the buffer.
   */
  async refreshTitleFromTranscript(id: string): Promise<LocalSession | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (!isPlaceholderSessionTitle(session.title, session.kind === "code" ? "code" : "cowork")) return session;
    if (!session.cliSessionId) return this.refreshTitleFromMessages(id);
    const jsonlPath = await resolveCodeTranscriptPath(session.cliSessionId, session.cwd);
    if (!jsonlPath) return this.refreshTitleFromMessages(id);
    const meta = await readCodeSessionMetadata(jsonlPath, session.cliSessionId).catch(() => null);
    const derived = meta && !isPlaceholderSessionTitle(meta.title, session.kind === "code" ? "code" : "cowork") ? meta.title : null;
    if (!derived) return this.refreshTitleFromMessages(id);
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
    this.clearLiveBuffer(id);
    session.updatedAt = nowIso();
    session.lastActivityAt = session.updatedAt;
    this.sessions.set(id, session);
    this.save();
    return true;
  }

  async fork(id: string, messageId?: string): Promise<LocalSession | null> {
    const source = this.sessions.get(id);
    if (!source) return null;
    const timestamp = nowIso();
    const transcript = sliceThroughMessageId(await this.getTranscript(id), messageId);
    const forked: LocalSession = {
      ...source,
      id: `${source.kind}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      sessionId: undefined,
      title: `${source.title} fork`,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      // Sliced content stays in the live tail (memory) — not persisted to userData.
      messages: [],
      transcript: [],
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
    this.liveBuffers.set(forked.id, transcript);
    this.save();
    return forked;
  }

  async rewind(id: string, messageId?: string): Promise<LocalSession | null> {
    const session = this.sessions.get(id);
    if (!session || !messageId) return null;
    const timestamp = nowIso();
    const transcript = sliceThroughMessageId(await this.getTranscript(id), messageId);
    const updated: LocalSession = {
      ...session,
      // Sliced content stays in the live tail (memory) — not persisted to userData.
      messages: [],
      transcript: [],
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
    this.liveBuffers.set(id, transcript);
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
    this.clearLiveBuffer(id);
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
