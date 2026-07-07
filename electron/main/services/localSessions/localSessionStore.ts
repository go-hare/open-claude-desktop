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
  cliSessionId?: string;
  slashCommands?: string[];
  runtime?: LocalSessionRuntime;
  metadata?: Record<string, unknown>;
  pendingToolPermissions?: LocalToolPermissionRequest[];
};

export type StartLocalSessionInput = {
  message?: string;
  prompt?: string;
  cwd?: string;
  kind?: LocalSessionKind;
  title?: string;
  folders?: string[];
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
};

function nowIso(): string {
  return new Date().toISOString();
}

function titleFromPrompt(prompt?: string): string {
  const first = prompt?.trim().split("\n")[0] ?? "New session";
  return first.length > 40 ? `${first.slice(0, 40)}…` : first || "New session";
}

function uniqueStrings(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))] : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function createMessage(role: LocalSessionMessage["role"], text: string, createdAt = nowIso(), raw?: unknown): LocalSessionMessage {
  return { id: `msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, role, text, createdAt, raw };
}

function transcriptMessage(sessionId: string, message: LocalSessionMessage): Record<string, unknown> {
  return {
    type: message.role,
    sessionId,
    uuid: message.id,
    timestamp: message.createdAt,
    message: { role: message.role, content: message.text },
    text: message.text,
  };
}

function messageIdentity(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const raw = asRecord(value);
  const nested = asRecord(raw.message);
  return typeof raw.id === "string" ? raw.id
    : typeof raw.uuid === "string" ? raw.uuid
      : typeof raw.message_id === "string" ? raw.message_id
        : typeof nested.id === "string" ? nested.id
          : typeof nested.uuid === "string" ? nested.uuid
            : undefined;
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
    return session?.transcript?.length ? session.transcript : session?.messages ?? [];
  }

  getSessionsForScheduledTask(scheduledTaskId: string): LocalSession[] {
    return this.getAll(true).filter((session) => session.scheduledTaskId === scheduledTaskId);
  }

  start(input: StartLocalSessionInput = {}): LocalSession {
    const timestamp = nowIso();
    const prompt = input.prompt ?? input.message ?? "";
    const folders = uniqueStrings(input.folders).length > 0 ? uniqueStrings(input.folders) : uniqueStrings(input.userSelectedFolders);
    const cwd = input.cwd ?? folders[0];
    const id = `${input.kind ?? this.defaultKind}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const session: LocalSession = {
      id,
      sessionId: id,
      title: input.title ?? titleFromPrompt(prompt),
      kind: input.kind ?? this.defaultKind,
      sessionKind: (input.kind ?? this.defaultKind) === "code" ? "code" : "cowork",
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
      isRunning: false,
      messages: prompt ? [createMessage("user", prompt, timestamp)] : [],
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

  sendMessage(id: string, text: string, role: LocalSessionMessage["role"] = "user"): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const timestamp = nowIso();
    const message = createMessage(role, text, timestamp);
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
    session.messages.push(message);
    if (includeTranscript) {
      session.transcript ??= [];
      session.transcript.push(raw ?? transcriptMessage(session.id, message));
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
    session.updatedAt = timestamp;
    session.lastActivityAt = timestamp;
    this.save();
    return session;
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
    return Boolean(this.update(id, { stopped: true }));
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
