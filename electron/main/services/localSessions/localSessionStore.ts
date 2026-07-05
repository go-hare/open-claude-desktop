import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type LocalSessionKind = "epitaxy" | "code";

export type LocalSessionMessage = { id: string; role: "user" | "assistant" | "system"; text: string; createdAt: string };

export type LocalSession = {
  id: string;
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
  visibility?: string;
  messages: LocalSessionMessage[];
  archived?: boolean;
  stopped?: boolean;
  metadata?: Record<string, unknown>;
};

export type StartLocalSessionInput = {
  prompt?: string;
  cwd?: string;
  kind?: LocalSessionKind;
  title?: string;
  folders?: string[];
  model?: string;
  effort?: string;
  permissionMode?: string;
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

export class LocalSessionStore {
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

  getTranscript(id: string): LocalSessionMessage[] {
    return this.sessions.get(id)?.messages ?? [];
  }

  start(input: StartLocalSessionInput = {}): LocalSession {
    const timestamp = nowIso();
    const prompt = input.prompt ?? "";
    const folders = uniqueStrings(input.folders);
    const cwd = input.cwd ?? folders[0];
    const session: LocalSession = {
      id: `${input.kind ?? this.defaultKind}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      title: input.title ?? titleFromPrompt(prompt),
      kind: input.kind ?? this.defaultKind,
      createdAt: timestamp,
      updatedAt: timestamp,
      cwd,
      folders,
      model: input.model,
      effort: input.effort,
      permissionMode: input.permissionMode,
      messages: prompt ? [{ id: `msg_${Date.now()}`, role: "user", text: prompt, createdAt: timestamp }] : [],
    };
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
    const updated = { ...session, ...input, id, kind: session.kind, updatedAt: nowIso() };
    this.sessions.set(id, updated);
    this.save();
    return updated;
  }

  sendMessage(id: string, text: string, role: LocalSessionMessage["role"] = "user"): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const timestamp = nowIso();
    session.messages.push({ id: `msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, role, text, createdAt: timestamp });
    session.updatedAt = timestamp;
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

  delete(id: string): boolean {
    const deleted = this.sessions.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  clearSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.messages = [];
    session.updatedAt = nowIso();
    this.save();
    return true;
  }

  addFolders(id: string, folders: unknown): LocalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.folders = [...new Set([...(session.folders ?? []), ...uniqueStrings(folders)])];
    session.cwd ??= session.folders[0];
    session.updatedAt = nowIso();
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
