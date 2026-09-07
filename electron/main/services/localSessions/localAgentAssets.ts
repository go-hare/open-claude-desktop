import { app, shell } from "electron";
import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

type LocalAgentRecord = Record<string, unknown> & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
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

/** Official CUi aUi / gUi / pP / fQe / cUi / IUi. */
const SKILLS_SESSIONS_DIR = "local-agent-mode-sessions";
const SKILLS_PLUGIN_DIR = "skills-plugin";
const SKILLS_SUBDIR = "skills";
const SKILLS_MANIFEST = "manifest.json";
const SKILLS_PLUGIN_META_DIR = ".claude-plugin";
const SKILLS_PLUGIN_JSON = "plugin.json";

/** Official ST() names blocked by saveLocalSkill. */
const BUILT_IN_SKILL_NAMES = new Set([
  "schedule",
  "setup-cowork",
  "consolidate-memory",
]);

type SkillsPluginManifestSkill = {
  creatorType?: string;
  description?: string;
  enabled?: boolean;
  name: string;
  skillId?: string;
  syncManaged?: boolean;
  updatedAt?: string | null;
};

type SkillsPluginManifest = {
  lastUpdated?: number;
  skills: SkillsPluginManifestSkill[];
};

type SkillsPluginHooks = {
  getUserDataPath?: () => string;
  resolveIdentity?: () => Promise<{
    accountUuid: string;
    organizationUuid: string;
  } | null>;
};

let skillsPluginHooks: SkillsPluginHooks = {};
let migratedLegacy = false;

export function setSkillsPluginTestHooks(hooks: SkillsPluginHooks): void {
  skillsPluginHooks = hooks;
  migratedLegacy = false;
}

export function resetSkillsPluginTestHooks(): void {
  skillsPluginHooks = {};
  migratedLegacy = false;
}

function userDataPath(): string {
  return skillsPluginHooks.getUserDataPath?.() ?? app.getPath("userData");
}

/** Official CUi.sanitizeSkillName */
export function sanitizeSkillsPluginName(name: string): string {
  return name.replace(/[<>"|?*\\/]/g, "_");
}

function skillsPluginBaseDir(): string {
  return path.join(userDataPath(), SKILLS_SESSIONS_DIR, SKILLS_PLUGIN_DIR);
}

async function resolveSkillsIdentity(): Promise<{
  accountUuid: string;
  organizationUuid: string;
} | null> {
  if (skillsPluginHooks.resolveIdentity) {
    return skillsPluginHooks.resolveIdentity();
  }
  try {
    const { loadCoworkBootstrapIdentity } = await import(
      "../coworkAccount/coworkBootstrapIdentity"
    );
    return await loadCoworkBootstrapIdentity();
  } catch {
    return null;
  }
}

/** Official CUi.getPluginDir: baseDir / orgUuid / accountUuid */
async function getPluginDir(): Promise<string | null> {
  const identity = await resolveSkillsIdentity();
  if (!identity) return null;
  return path.join(
    skillsPluginBaseDir(),
    identity.organizationUuid,
    identity.accountUuid,
  );
}

function getSkillDir(pluginDir: string, name: string): string {
  const sanitized = sanitizeSkillsPluginName(name);
  const skillsRoot = path.join(pluginDir, SKILLS_SUBDIR);
  const skillDir = path.join(skillsRoot, sanitized);
  const relative = path.relative(skillsRoot, skillDir);
  if (path.isAbsolute(relative) || relative.startsWith("..")) {
    throw new Error(`Invalid skill name: "${name}"`);
  }
  return skillDir;
}

function ensurePluginStructure(pluginDir: string): void {
  const skillsRoot = path.join(pluginDir, SKILLS_SUBDIR);
  fsSync.mkdirSync(skillsRoot, { recursive: true, mode: 0o700 });
  const metaDir = path.join(pluginDir, SKILLS_PLUGIN_META_DIR);
  const pluginJson = path.join(metaDir, SKILLS_PLUGIN_JSON);
  if (!fsSync.existsSync(pluginJson)) {
    fsSync.mkdirSync(metaDir, { recursive: true, mode: 0o700 });
    fsSync.writeFileSync(
      pluginJson,
      JSON.stringify(
        {
          name: "anthropic-skills",
          version: "1.0.0",
          description: "Anthropic-managed skills for Claude Desktop",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
}

function readManifest(pluginDir: string): SkillsPluginManifest | null {
  const filePath = path.join(pluginDir, SKILLS_MANIFEST);
  try {
    const parsed = JSON.parse(fsSync.readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const skills = (parsed as { skills?: unknown }).skills;
    if (!Array.isArray(skills)) return { lastUpdated: Date.now(), skills: [] };
    return {
      lastUpdated:
        typeof (parsed as { lastUpdated?: unknown }).lastUpdated === "number"
          ? (parsed as { lastUpdated: number }).lastUpdated
          : Date.now(),
      skills: skills.filter(
        (item): item is SkillsPluginManifestSkill =>
          Boolean(item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"),
      ),
    };
  } catch {
    return null;
  }
}

async function writeManifest(
  pluginDir: string,
  manifest: SkillsPluginManifest,
): Promise<void> {
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, SKILLS_MANIFEST),
    JSON.stringify(manifest, null, 2),
  );
}

async function migrateLegacyAppLocalSkills(pluginDir: string): Promise<void> {
  if (migratedLegacy) return;
  migratedLegacy = true;
  const legacyRoot = path.join(userDataPath(), "local-skills");
  const entries = await fs.readdir(legacyRoot, { withFileTypes: true }).catch(() => []);
  if (entries.length === 0) return;
  ensurePluginStructure(pluginDir);
  const manifest = readManifest(pluginDir) ?? { lastUpdated: Date.now(), skills: [] };
  const known = new Set(manifest.skills.map((skill) => skill.name));
  let changed = false;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = await fs
      .readFile(path.join(legacyRoot, entry.name, "SKILL.md"), "utf8")
      .catch(() => null);
    if (!skillMd) continue;
    const name = sanitizeSkillsPluginName(entry.name);
    if (!name || known.has(name) || BUILT_IN_SKILL_NAMES.has(name)) continue;
    const skillDir = getSkillDir(pluginDir, name);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd);
    manifest.skills.push({
      skillId: name,
      name,
      description: parseSkillMetadata(skillMd, name).description,
      creatorType: "user",
      syncManaged: false,
      updatedAt: new Date().toISOString(),
      enabled: true,
    });
    known.add(name);
    changed = true;
  }
  if (changed) {
    manifest.lastUpdated = Date.now();
    await writeManifest(pluginDir, manifest);
  }
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

/** Official CUi.listLocalSkills — creatorType==="user" from manifest. */
export async function listLocalSkills(): Promise<Array<Record<string, unknown>>> {
  const pluginDir = await getPluginDir();
  if (!pluginDir) return [];
  await migrateLegacyAppLocalSkills(pluginDir);
  const manifest = readManifest(pluginDir);
  return ((manifest?.skills ?? []).filter((skill) => skill.creatorType === "user")).map(
    (skill) => ({
      skillId: skill.skillId ?? skill.name,
      name: skill.name,
      description: skill.description ?? "",
      creatorType: "user",
      updatedAt: skill.updatedAt ?? undefined,
      enabled: skill.enabled !== false,
    }),
  );
}

/** Official CUi.getLocalSkillFiles — relative path + utf-8 content. */
export async function getLocalSkillFiles(
  skillName: unknown,
): Promise<Array<Record<string, unknown>>> {
  const name = asString(skillName);
  const pluginDir = await getPluginDir();
  if (!name || !pluginDir) return [];
  const manifest = readManifest(pluginDir);
  const row = manifest?.skills.find((skill) => skill.name === name);
  if (!row || row.creatorType !== "user") return [];
  const skillDir = getSkillDir(pluginDir, name);
  try {
    const entries = await fs.readdir(skillDir, { withFileTypes: true, recursive: true });
    const files: Array<Record<string, unknown>> = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parentPath =
        "parentPath" in entry && typeof entry.parentPath === "string"
          ? entry.parentPath
          : skillDir;
      const absolute = path.join(parentPath, entry.name);
      const relative = absolute.slice(skillDir.length + 1).replace(/\\/g, "/");
      const content = await fs.readFile(absolute, "utf8");
      files.push({ path: relative, content });
    }
    return files;
  } catch {
    return [];
  }
}

/** Official CUi.saveLocalSkill(name, description, skillMd, overwrite). */
export async function saveLocalSkill(
  name: string,
  description: string,
  skillMd: string,
  overwrite: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const pluginDir = await getPluginDir();
  if (!pluginDir) return { ok: false, error: "No plugin directory available" };
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    return { ok: false, error: `Invalid skill name: "${name}"` };
  }
  if (BUILT_IN_SKILL_NAMES.has(trimmed)) {
    return { ok: false, error: `"${trimmed}" is a built-in skill name` };
  }
  await migrateLegacyAppLocalSkills(pluginDir);
  ensurePluginStructure(pluginDir);
  const manifest = readManifest(pluginDir);
  const existing = manifest?.skills.find((skill) => skill.name === trimmed);
  if (existing && !overwrite) return { ok: false, error: "already_exists" };
  let skillDir: string;
  try {
    skillDir = getSkillDir(pluginDir, trimmed);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : `Invalid skill name: "${name}"`,
    };
  }
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd);
  const row: SkillsPluginManifestSkill = {
    skillId: trimmed,
    name: trimmed,
    description,
    creatorType: "user",
    syncManaged: false,
    updatedAt: new Date().toISOString(),
    enabled: existing?.enabled ?? true,
  };
  const skills = [...(manifest?.skills.filter((skill) => skill.name !== trimmed) ?? []), row];
  await writeManifest(pluginDir, { lastUpdated: Date.now(), skills });
  return { ok: true };
}

/** Official CUi.deleteLocalSkill — user-created only. */
export async function deleteLocalSkill(
  skillName: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const name = asString(skillName);
  const pluginDir = await getPluginDir();
  if (!name) return { ok: false, error: `"" is not a user-created skill` };
  if (!pluginDir) return { ok: false, error: "No plugin directory" };
  const manifest = readManifest(pluginDir);
  if (!manifest) return { ok: false, error: `"${name}" is not a user-created skill` };
  const row = manifest.skills.find((skill) => skill.name === name);
  if (!row || row.creatorType !== "user") {
    return { ok: false, error: `"${name}" is not a user-created skill` };
  }
  await fs.rm(getSkillDir(pluginDir, name), { recursive: true, force: true });
  await writeManifest(pluginDir, {
    lastUpdated: Date.now(),
    skills: manifest.skills.filter((skill) => skill.name !== name),
  });
  return { ok: true };
}

/** Official CUi.revealLocalSkill */
export async function revealLocalSkill(skillName: unknown): Promise<void> {
  const name = asString(skillName);
  const pluginDir = await getPluginDir();
  if (!name || !pluginDir) return;
  const manifest = readManifest(pluginDir);
  const row = manifest?.skills.find((skill) => skill.name === name);
  if (!row || row.creatorType !== "user") return;
  shell.showItemInFolder(path.join(getSkillDir(pluginDir, name), "SKILL.md"));
}

/** Official CUi.setLocalSkillEnabled */
export async function setLocalSkillEnabled(
  skillName: unknown,
  enabled: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const name = asString(skillName);
  const pluginDir = await getPluginDir();
  if (!pluginDir) return { ok: false, error: "No plugin directory" };
  if (!name) return { ok: false, error: `"" is not a user-created skill` };
  const manifest = readManifest(pluginDir);
  if (!manifest) return { ok: false, error: `"${name}" is not a user-created skill` };
  const row = manifest.skills.find((skill) => skill.name === name);
  if (!row || row.creatorType !== "user") {
    return { ok: false, error: `"${name}" is not a user-created skill` };
  }
  row.enabled = Boolean(enabled);
  row.updatedAt = new Date().toISOString();
  await writeManifest(pluginDir, { lastUpdated: Date.now(), skills: manifest.skills });
  return { ok: true };
}
