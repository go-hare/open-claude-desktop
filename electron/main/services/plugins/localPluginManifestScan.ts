/**
 * Official asar Aye / fsr residual (index.js):
 *   RoA skills (SKILL.md + legacy commands/*.md)
 *   snA mcpServers (.mcp.json + plugin.json mcpServers)
 *   xor hooks (hooks/hooks.json)
 *   Uor agents (agents/*.md)
 *   Dsr README
 *   kSA required: id,name,installPath,scope,enabled,skills,mcpServers,hooks,agents
 *
 * Product residual: on-disk scan only. No cloud marketplace fetch.
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_COMPONENT_PATHS: Record<string, string> = {
  skills: "skills",
  commands: "commands",
  agents: "agents",
  hooks: "hooks",
  mcpServers: ".",
};

const README_NAMES = ["README.md", "readme.md", "README", "Readme.md"];

export type HostPluginSkill = {
  argumentHint?: string;
  content?: string;
  description: string;
  hostFilesystemLocation: string;
  location: string;
  name: string;
  source: "legacy-commands" | "skills";
  userInvocable?: boolean;
};

export type HostPluginMcpServer = {
  config: unknown;
  hostFilesystemLocation: string;
  isMcpb?: boolean;
  name: string;
};

export type HostPluginHookCommand = {
  command?: string;
  prompt?: string;
  type: string;
  url?: string;
};

export type HostPluginHook = {
  commands: HostPluginHookCommand[];
  event: string;
  hostFilesystemLocation: string;
  matcher?: string;
};

export type HostPluginAgent = {
  content: string;
  description: string;
  disallowedTools?: string[];
  hostFilesystemLocation?: string;
  model?: string;
  name: string;
  permissionMode?: string;
  skills?: string[];
  tools?: string[];
};

export type HostPluginRecord = {
  agents: HostPluginAgent[];
  author?: { email?: string; name: string; url?: string };
  clis?: unknown[];
  commands: unknown[];
  description?: string;
  enabled: boolean;
  hooks: HostPluginHook[];
  id: string;
  installationPreference?: string;
  installedAt?: string;
  installedBy?: string;
  installPath: string;
  lastUpdated?: string;
  marketplaceName?: string;
  mcpServers: HostPluginMcpServer[];
  name: string;
  readmePath?: string;
  scope: "local" | "project" | "user";
  skills: HostPluginSkill[];
  version?: string;
};

export type ScanPluginInput = {
  enabled?: boolean;
  id: string;
  installedAt?: string;
  installPath: string;
  lastUpdated?: string;
  marketplaceName?: string;
  name: string;
  scope?: string;
  version?: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readJson(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function pluginJsonPath(installPath: string): string {
  return path.join(installPath, ".claude-plugin", "plugin.json");
}

function readPluginJson(installPath: string): Record<string, unknown> | null {
  const raw = readJson(pluginJsonPath(installPath));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Official eAA — plugin.json component paths, default bse. */
function componentPaths(
  manifest: Record<string, unknown> | null,
  key: keyof typeof DEFAULT_COMPONENT_PATHS,
): string[] {
  const fallback = DEFAULT_COMPONENT_PATHS[key] ?? ".";
  const value = manifest?.[key];
  if (!value) return [fallback];
  if (typeof value === "object" && !Array.isArray(value)) return [fallback];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [fallback];
}

function parseFrontmatter(text: string): {
  body: string;
  fields: Record<string, string>;
} {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1] ?? "";
    let rest = (pair[2] ?? "").trim();
    if (
      (rest.startsWith('"') && rest.endsWith('"')) ||
      (rest.startsWith("'") && rest.endsWith("'"))
    ) {
      rest = rest.slice(1, -1);
    }
    fields[key] = rest;
  }
  return { fields, body: match[2] ?? "" };
}

function sanitizeSkillToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function pluginDisplayName(
  manifest: Record<string, unknown> | null,
  fallback: string,
): string {
  return isNonEmptyString(manifest?.name) ? manifest.name : fallback;
}

function posixJoin(...parts: string[]): string {
  return parts
    .filter((part) => part && part !== ".")
    .join("/")
    .replace(/\\/g, "/");
}

function resolveInside(root: string, target: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, target);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

function listDirSafe(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function scanSkills(
  installPath: string,
  pluginName: string,
  locationBase: string,
  manifest: Record<string, unknown> | null,
): HostPluginSkill[] {
  const display = pluginDisplayName(manifest, pluginName);
  const out: HostPluginSkill[] = [];
  const seen = new Set<string>();
  const skillRoots = componentPaths(manifest, "skills");

  const pushSkill = (
    dir: string,
    skillFile: string,
    location: string,
    folderName: string,
  ) => {
    if (!fs.existsSync(skillFile)) return;
    let text = "";
    try {
      text = fs.readFileSync(skillFile, "utf8");
    } catch {
      return;
    }
    const parsed = parseFrontmatter(text);
    const rawName = parsed.fields.name?.trim() || folderName;
    const token = sanitizeSkillToken(rawName);
    const name = `${display}:${token}`;
    if (seen.has(name)) return;
    seen.add(name);
    out.push({
      name,
      description: parsed.fields.description ?? "",
      argumentHint: parsed.fields.argumentHint || parsed.fields["argument-hint"],
      location,
      hostFilesystemLocation: dir,
      source: "skills",
      userInvocable: parsed.fields.userInvocable !== "false",
    });
  };

  for (const rel of skillRoots) {
    const root = resolveInside(installPath, rel);
    if (!root || !fs.existsSync(root)) continue;
    const skillMd = path.join(root, "SKILL.md");
    if (fs.existsSync(skillMd) && fs.statSync(root).isDirectory()) {
      const loc =
        path.normalize(rel).replace(/\\/g, "/") === "."
          ? locationBase
          : `${locationBase}/${posixJoin(rel)}`;
      pushSkill(root, skillMd, loc, path.basename(root));
      continue;
    }
    if (!fs.statSync(root).isDirectory()) continue;
    for (const ent of listDirSafe(root)) {
      if (!ent.isDirectory()) continue;
      const dir = path.join(root, ent.name);
      pushSkill(
        dir,
        path.join(dir, "SKILL.md"),
        `${locationBase}/${posixJoin(rel, ent.name)}`,
        ent.name,
      );
    }
  }

  const commandRoots = componentPaths(manifest, "commands");
  for (const rel of commandRoots) {
    const root = resolveInside(installPath, rel);
    if (!root || !fs.existsSync(root)) continue;
    const files = fs.statSync(root).isDirectory()
      ? listDirSafe(root).filter(
          (ent) => ent.isFile() && ent.name.toLowerCase().endsWith(".md"),
        )
      : [];
    for (const ent of files) {
      const filePath = path.join(root, ent.name);
      const token = sanitizeSkillToken(ent.name.replace(/\.md$/i, ""));
      const name = `${display}:${token}`;
      if (seen.has(name)) continue;
      seen.add(name);
      let text = "";
      try {
        text = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      const parsed = parseFrontmatter(text);
      out.push({
        name,
        description: parsed.fields.description ?? "",
        argumentHint: parsed.fields.argumentHint || parsed.fields["argument-hint"],
        content: text,
        location: `${locationBase}/${posixJoin(rel, ent.name)}`,
        hostFilesystemLocation: filePath,
        source: "legacy-commands",
        userInvocable: true,
      });
    }
  }
  return out;
}

function scanMcpServers(
  installPath: string,
  manifest: Record<string, unknown> | null,
): HostPluginMcpServer[] {
  const byName = new Map<string, HostPluginMcpServer>();
  const pushMap = (raw: unknown, host: string) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    for (const [name, config] of Object.entries(raw as Record<string, unknown>)) {
      byName.set(name, {
        name,
        config,
        hostFilesystemLocation: host,
      });
    }
  };

  const fromManifest = manifest?.mcpServers;
  if (fromManifest && typeof fromManifest === "object" && !Array.isArray(fromManifest)) {
    pushMap(fromManifest, pluginJsonPath(installPath));
  }

  const roots = componentPaths(manifest, "mcpServers");
  for (const rel of roots) {
    const target = resolveInside(installPath, rel);
    if (!target || !fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      const parsed = readJson(target);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        pushMap(obj.mcpServers ?? obj, target);
      }
      continue;
    }
    const mcpJson = path.join(target, ".mcp.json");
    const parsed = readJson(mcpJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      pushMap(obj.mcpServers ?? obj, mcpJson);
    }
  }
  return [...byName.values()];
}

function scanHooks(
  installPath: string,
  manifest: Record<string, unknown> | null,
): HostPluginHook[] {
  const out: HostPluginHook[] = [];
  for (const rel of componentPaths(manifest, "hooks")) {
    const file = rel.endsWith(".json")
      ? resolveInside(installPath, rel)
      : resolveInside(installPath, path.join(rel, "hooks.json"));
    if (!file || !fs.existsSync(file)) continue;
    const parsed = readJson(file);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const hooks = (parsed as { hooks?: unknown }).hooks;
    if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) continue;
    for (const [event, entries] of Object.entries(hooks as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const rec = entry as Record<string, unknown>;
        const commands: HostPluginHookCommand[] = [];
        if (Array.isArray(rec.hooks)) {
          for (const hook of rec.hooks) {
            if (!hook || typeof hook !== "object" || Array.isArray(hook)) continue;
            const item = hook as Record<string, unknown>;
            if (!isNonEmptyString(item.type)) continue;
            commands.push({
              type: item.type,
              command: isNonEmptyString(item.command) ? item.command : undefined,
              prompt: isNonEmptyString(item.prompt) ? item.prompt : undefined,
              url: isNonEmptyString(item.url) ? item.url : undefined,
            });
          }
        }
        out.push({
          event,
          matcher: isNonEmptyString(rec.matcher) ? rec.matcher : undefined,
          commands,
          hostFilesystemLocation: file,
        });
      }
    }
  }
  return out;
}

function scanAgents(
  installPath: string,
  pluginName: string,
  manifest: Record<string, unknown> | null,
): HostPluginAgent[] {
  const display = pluginDisplayName(manifest, pluginName);
  const out: HostPluginAgent[] = [];
  for (const rel of componentPaths(manifest, "agents")) {
    const root = resolveInside(installPath, rel);
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    for (const ent of listDirSafe(root)) {
      if (!ent.isFile()) continue;
      if (!ent.name.toLowerCase().endsWith(".md")) continue;
      if (ent.name.toLowerCase() === "readme.md") continue;
      const filePath = path.join(root, ent.name);
      let text = "";
      try {
        text = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      const parsed = parseFrontmatter(text);
      const token = parsed.fields.name || ent.name.replace(/\.md$/i, "");
      const csv = (value?: string) =>
        value
          ? value
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean)
          : undefined;
      out.push({
        name: `${display}:${token}`,
        description: parsed.fields.description ?? "",
        model: parsed.fields.model,
        tools: csv(parsed.fields.tools),
        disallowedTools: csv(parsed.fields.disallowedTools || parsed.fields["disallowed-tools"]),
        permissionMode: parsed.fields.permissionMode || parsed.fields["permission-mode"],
        skills: csv(parsed.fields.skills),
        content: text,
        hostFilesystemLocation: filePath,
      });
    }
  }
  return out;
}

function findReadme(installPath: string): string | undefined {
  for (const name of README_NAMES) {
    const filePath = path.join(installPath, name);
    try {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      return filePath;
    } catch {
      /* skip */
    }
  }
  return undefined;
}

function authorFromManifest(
  manifest: Record<string, unknown> | null,
): { email?: string; name: string; url?: string } | undefined {
  const author = manifest?.author;
  if (typeof author === "string" && author.trim()) return { name: author.trim() };
  if (author && typeof author === "object" && !Array.isArray(author)) {
    const rec = author as Record<string, unknown>;
    if (!isNonEmptyString(rec.name)) return undefined;
    return {
      name: rec.name,
      email: isNonEmptyString(rec.email) ? rec.email : undefined,
      url: isNonEmptyString(rec.url) ? rec.url : undefined,
    };
  }
  return undefined;
}

function normalizeScope(scope: string | undefined): "local" | "project" | "user" {
  if (scope === "local" || scope === "project") return scope;
  return "user";
}

/** Official Aye — build kSA plugin payload from an installed plugin directory. */
export function scanPluginManifest(input: ScanPluginInput): HostPluginRecord | null {
  const installPath = path.resolve(input.installPath);
  if (!fs.existsSync(installPath) || !fs.statSync(installPath).isDirectory()) {
    return null;
  }
  const manifest = readPluginJson(installPath);
  const name = isNonEmptyString(manifest?.name) ? manifest.name : input.name;
  const locationBase = installPath.replace(/\\/g, "/");
  const readmePath = findReadme(installPath);
  return {
    id: input.id,
    name,
    installPath,
    scope: normalizeScope(input.scope),
    enabled: input.enabled !== false,
    installedAt: input.installedAt,
    lastUpdated: input.lastUpdated,
    description: isNonEmptyString(manifest?.description)
      ? manifest.description
      : undefined,
    version: isNonEmptyString(manifest?.version)
      ? manifest.version
      : input.version,
    author: authorFromManifest(manifest),
    marketplaceName: input.marketplaceName,
    ...(readmePath ? { readmePath } : {}),
    skills: scanSkills(installPath, name, locationBase, manifest),
    mcpServers: scanMcpServers(installPath, manifest),
    hooks: scanHooks(installPath, manifest),
    agents: scanAgents(installPath, name, manifest),
    commands: [],
  };
}

/** Official ysr residual — list files under a plugin skill directory. */
export function listPluginSkillFiles(
  plugin: HostPluginRecord,
  skillName: string,
): Array<{ content: string; path: string }> {
  const skill = plugin.skills.find((entry) => entry.name === skillName);
  if (!skill) return [];
  if (skill.source === "legacy-commands") {
    if (!skill.hostFilesystemLocation || !fs.existsSync(skill.hostFilesystemLocation)) {
      return [];
    }
    try {
      return [
        {
          path: path.basename(skill.hostFilesystemLocation),
          content: fs.readFileSync(skill.hostFilesystemLocation, "utf8"),
        },
      ];
    } catch {
      return [];
    }
  }
  const dir = skill.hostFilesystemLocation;
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const files: Array<{ content: string; path: string }> = [];
  const walk = (current: string, rel: string) => {
    for (const ent of listDirSafe(current)) {
      const next = path.join(current, ent.name);
      const nextRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(next, nextRel);
      else if (ent.isFile()) {
        try {
          files.push({ path: nextRel, content: fs.readFileSync(next, "utf8") });
        } catch {
          /* skip unreadable */
        }
      }
    }
  };
  walk(dir, "");
  return files;
}
