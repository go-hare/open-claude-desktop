import { app, shell } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type LocalAgentRecord = Record<string, unknown> & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type SkillState = {
  enabled?: Record<string, boolean>;
};

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || `local-${Date.now()}`;
}

function agentsFile(): string {
  return path.join(app.getPath("userData"), "local-agents.json");
}

function skillStateFile(): string {
  return path.join(app.getPath("userData"), "local-skills-state.json");
}

function appSkillsRoot(): string {
  return path.join(app.getPath("userData"), "local-skills");
}

function homeSkillsRoot(): string {
  return path.join(app.getPath("home"), ".claude", "skills");
}

function skillRoots(): Array<{ root: string; source: string; writable: boolean }> {
  return [
    { root: homeSkillsRoot(), source: "claude-home", writable: true },
    { root: appSkillsRoot(), source: "app-local", writable: true },
  ];
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeRelativePath(value: unknown): string | null {
  const text = asString(value);
  if (!text || path.isAbsolute(text)) return null;
  const normalized = path.normalize(text);
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
  return normalized;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return null;
}

export async function listLocalAgents(): Promise<LocalAgentRecord[]> {
  const records = await readJson<LocalAgentRecord[]>(agentsFile(), []);
  return records.filter((item) => Boolean(item?.id && item.name)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createLocalAgent(input: unknown): Promise<LocalAgentRecord> {
  const raw = asObject(input);
  const now = new Date().toISOString();
  const name = firstText(raw.name, raw.title, raw.displayName) ?? "New agent";
  const record: LocalAgentRecord = {
    ...raw,
    id: firstText(raw.id) ?? `agent_${slug(name)}_${randomUUID().slice(0, 8)}`,
    name,
    title: firstText(raw.title) ?? name,
    description: firstText(raw.description) ?? "",
    source: "local",
    enabled: raw.enabled !== false,
    createdAt: firstText(raw.createdAt) ?? now,
    updatedAt: now,
  };
  const existing = await listLocalAgents();
  const next = [record, ...existing.filter((agent) => agent.id !== record.id)];
  await writeJson(agentsFile(), next);
  return record;
}

async function loadSkillState(): Promise<SkillState> {
  return readJson<SkillState>(skillStateFile(), {});
}

async function saveSkillState(state: SkillState): Promise<void> {
  await writeJson(skillStateFile(), state);
}

function parseSkillMetadata(content: string, fallback: string) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields = new Map<string, string>();
  for (const line of (frontmatter?.[1] ?? "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (match?.[1] && match[2]) fields.set(match[1].toLowerCase(), match[2].replace(/^["']|["']$/g, ""));
  }
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const description = fields.get("description") ?? content.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#") && !line.startsWith("---"));
  return {
    name: fields.get("name") ?? heading ?? fallback,
    description: description ?? "",
  };
}

async function summarizeSkill(root: string, source: string, state: SkillState, entryName: string) {
  const dir = path.join(root, entryName);
  const filePath = path.join(dir, "SKILL.md");
  const content = await fs.readFile(filePath, "utf8").catch(() => null);
  if (content === null) return null;
  const metadata = parseSkillMetadata(content, entryName);
  const stat = await fs.stat(filePath).catch(() => null);
  const id = `${source}:${entryName}`;
  return {
    id,
    key: entryName,
    name: metadata.name,
    title: metadata.name,
    description: metadata.description,
    enabled: state.enabled?.[id] !== false,
    source,
    path: dir,
    filePath,
    updatedAt: stat?.mtime.toISOString(),
  };
}

export async function listLocalSkills(): Promise<Array<Record<string, unknown>>> {
  const state = await loadSkillState();
  const results: Array<Record<string, unknown>> = [];
  for (const { root, source } of skillRoots()) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = await summarizeSkill(root, source, state, entry.name);
      if (skill) results.push(skill);
    }
  }
  return results.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function resolveSkill(value: unknown): Promise<Record<string, unknown> | null> {
  const raw = asObject(value);
  const candidate = firstText(value, raw.path, raw.filePath, raw.dir, raw.id, raw.name, raw.key);
  if (!candidate) return null;
  const absolute = path.isAbsolute(candidate) ? (path.basename(candidate).toLowerCase() === "skill.md" ? path.dirname(candidate) : candidate) : null;
  const rootMatch = absolute ? skillRoots().find(({ root }) => isInside(root, absolute)) : null;
  if (absolute && rootMatch) {
    return summarizeSkill(path.dirname(absolute), rootMatch.source, await loadSkillState(), path.basename(absolute));
  }
  const skills = await listLocalSkills();
  return skills.find((skill) => [skill.id, skill.name, skill.key, skill.path, skill.filePath].some((item) => item === candidate)) ?? null;
}

async function listFiles(dir: string, relative = ""): Promise<string[]> {
  const target = path.join(dir, relative);
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(dir, next));
    else files.push(next);
  }
  return files;
}

export async function getLocalSkillFiles(skillRef: unknown): Promise<Array<Record<string, unknown>>> {
  const skill = await resolveSkill(skillRef);
  const dir = asString(skill?.path);
  if (!dir) return [];
  const files = await listFiles(dir);
  return Promise.all(files.map(async (relativePath) => {
    const filePath = path.join(dir, relativePath);
    const stat = await fs.stat(filePath).catch(() => null);
    const content = stat && stat.size <= 512_000 ? await fs.readFile(filePath, "utf8").catch(() => undefined) : undefined;
    return { name: path.basename(relativePath), relativePath, path: filePath, content, size: stat?.size, updatedAt: stat?.mtime.toISOString() };
  }));
}

export async function saveLocalSkill(skillInput: unknown, filesInput?: unknown): Promise<Record<string, unknown> | null> {
  const raw = asObject(skillInput);
  const name = firstText(raw.name, raw.title, raw.key, raw.id) ?? "local-skill";
  const dir = path.join(appSkillsRoot(), slug(name));
  const content = firstText(raw.content, raw.markdown, raw.skill, raw.body)
    ?? `# ${name}\n\n${firstText(raw.description) ?? "Local skill."}\n`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), content);
  const files = Array.isArray(filesInput) ? filesInput : Array.isArray(raw.files) ? raw.files : [];
  for (const file of files) {
    const fileRaw = asObject(file);
    const relative = safeRelativePath(firstText(fileRaw.relativePath, fileRaw.path, fileRaw.name));
    if (!relative || relative.toLowerCase() === "skill.md") continue;
    const target = path.join(dir, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, String(fileRaw.content ?? ""));
  }
  return resolveSkill(dir);
}

export async function deleteLocalSkill(skillRef: unknown): Promise<boolean> {
  const skill = await resolveSkill(skillRef);
  const dir = asString(skill?.path);
  if (!dir || !skillRoots().some(({ root }) => isInside(root, dir))) return false;
  await fs.rm(dir, { recursive: true, force: true });
  const state = await loadSkillState();
  const id = asString(skill?.id);
  if (state.enabled && id) delete state.enabled[id];
  await saveSkillState(state);
  return true;
}

export async function revealLocalSkill(skillRef: unknown): Promise<boolean> {
  const skill = await resolveSkill(skillRef);
  const filePath = asString(skill?.filePath) ?? asString(skill?.path);
  if (!filePath) return false;
  shell.showItemInFolder(filePath);
  return true;
}

export async function setLocalSkillEnabled(skillRef: unknown, enabled: unknown): Promise<Record<string, unknown> | null> {
  const skill = await resolveSkill(skillRef);
  const id = asString(skill?.id);
  if (!id) return null;
  const state = await loadSkillState();
  state.enabled ??= {};
  state.enabled[id] = Boolean(enabled);
  await saveSkillState(state);
  return { ...skill, enabled: Boolean(enabled) };
}
