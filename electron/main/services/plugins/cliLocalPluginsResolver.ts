/**
 * Official ZLi / DkA / SI / GAr residual (app.asar index.js).
 *
 *   SI() = CLAUDE_CONFIG_DIR || ~/.claude
 *   fy() = join(SI(), "plugins")
 *   TsA() = join(fy(), "installed_plugins.json")
 *   DkA(cwd) = { installedPluginsFile:TsA(), pluginsDir:fy(),
 *                getEnabledPluginsMap:()=>GAr(cwd), translateInstallPath:A=>A,
 *                allowProjectScopedPaths:!0 }
 *   zme(ccd): getAllLocalPluginsWithResolver(DkA(workspacePath), workspacePath)
 *   zme(cowork): getAllLocalPlugins(account) under fusion cowork_plugins
 *
 * CCD plugin list is the CLI tree, not fusion. Project/local rows require
 * workspacePath + entry.projectPath prefix match. enabled = map[id] === true.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveOrgPluginsRoot } from "../mcp/orgPluginMcpScan";
import type { ListedPlugin } from "./localPluginsWriter";

export type CliPluginsResolverDeps = {
  homedir?: string;
  env?: NodeJS.ProcessEnv;
  orgPluginsRoot?: string | null;
  readFile?: (file: string) => string;
  exists?: (file: string) => boolean;
};

function envOf(deps: CliPluginsResolverDeps): NodeJS.ProcessEnv {
  return deps.env ?? process.env;
}

function homeOf(deps: CliPluginsResolverDeps): string {
  return deps.homedir ?? os.homedir();
}

function readText(file: string, deps: CliPluginsResolverDeps): string | null {
  try {
    if (deps.readFile) return deps.readFile(file);
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function existsPath(file: string, deps: CliPluginsResolverDeps): boolean {
  try {
    if (deps.exists) return deps.exists(file);
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

/** Official SI() */
export function resolveClaudeConfigDir(deps: CliPluginsResolverDeps = {}): string {
  const raw = envOf(deps).CLAUDE_CONFIG_DIR;
  if (raw === "~" || raw?.startsWith("~/") || raw?.startsWith("~\\")) {
    return path.join(homeOf(deps), raw.slice(1));
  }
  if (typeof raw === "string" && raw.length > 0) return raw;
  return path.join(homeOf(deps), ".claude");
}

/** Official fy() */
export function cliPluginsDir(deps: CliPluginsResolverDeps = {}): string {
  return path.join(resolveClaudeConfigDir(deps), "plugins");
}

/** Official TsA() */
export function cliInstalledPluginsFile(deps: CliPluginsResolverDeps = {}): string {
  return path.join(cliPluginsDir(deps), "installed_plugins.json");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Official RJ — settings.json enabledPlugins bag. */
export function readEnabledPluginsMap(
  file: string,
  deps: CliPluginsResolverDeps = {},
): Record<string, boolean> {
  const text = readText(file, deps);
  if (!text) return {};
  try {
    const bag = asRecord(JSON.parse(text)).enabledPlugins;
    const raw = asRecord(bag);
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Official GAr(workspace): user settings.json + project .claude/settings.json +
 * settings.local.json + utA() managed-settings.json. Missing files are empty maps.
 * Official NAr — managed settings directory.
 */
export function resolveClaudeCodeManagedSettingsDir(
  deps: CliPluginsResolverDeps = {},
): string {
  const override = envOf(deps).CLAUDE_CODE_MANAGED_SETTINGS_PATH;
  if (typeof override === "string" && override.length > 0) return override;
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/ClaudeCode";
    case "win32": {
      const programFiles = "C:\\Program Files\\ClaudeCode";
      if (existsPath(programFiles, deps)) return programFiles;
      return "C:\\ProgramData\\ClaudeCode";
    }
    default:
      return "/etc/claude-code";
  }
}

export function mergeCliEnabledPluginsMap(
  workspacePath?: string | null,
  deps: CliPluginsResolverDeps = {},
): Record<string, boolean> {
  const userFile = path.join(resolveClaudeConfigDir(deps), "settings.json");
  const merged: Record<string, boolean> = {
    ...readEnabledPluginsMap(userFile, deps),
  };
  if (workspacePath) {
    Object.assign(
      merged,
      readEnabledPluginsMap(path.join(workspacePath, ".claude", "settings.json"), deps),
      readEnabledPluginsMap(
        path.join(workspacePath, ".claude", "settings.local.json"),
        deps,
      ),
    );
  }
  // Official GAr: utA() managed-settings.json last.
  Object.assign(
    merged,
    readEnabledPluginsMap(
      path.join(resolveClaudeCodeManagedSettingsDir(deps), "managed-settings.json"),
      deps,
    ),
  );
  return merged;
}

function isUnderRoot(candidate: string, root: string): boolean {
  const resolved = path.resolve(candidate);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(base + path.sep);
}

/**
 * Official isValidPluginPath: absolute, no `..`, under pluginsDir /
 * org-plugins / (ccd) workspace.
 */
export function isValidCliPluginPath(
  installPath: string,
  pluginsDir: string,
  workspacePath?: string | null,
  deps: CliPluginsResolverDeps = {},
): string | undefined {
  try {
    if (!path.isAbsolute(installPath) || installPath.includes("..")) return undefined;
    const resolved = path.normalize(installPath);
    if (isUnderRoot(resolved, pluginsDir)) return pluginsDir;
    const orgRoot =
      deps.orgPluginsRoot !== undefined
        ? deps.orgPluginsRoot
        : resolveOrgPluginsRoot();
    if (orgRoot && isUnderRoot(resolved, orgRoot)) return orgRoot;
    if (workspacePath && isUnderRoot(resolved, path.normalize(workspacePath))) {
      return workspacePath;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

type InstalledEntry = {
  installPath?: unknown;
  lastUpdated?: unknown;
  installedAt?: unknown;
  projectPath?: unknown;
  scope?: unknown;
  version?: unknown;
};

function parseInstalledEntries(text: string): Array<{
  id: string;
  entry: InstalledEntry;
}> {
  try {
    const plugins = asRecord(asRecord(JSON.parse(text)).plugins);
    const out: Array<{ id: string; entry: InstalledEntry }> = [];
    for (const [id, rows] of Object.entries(plugins)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (row && typeof row === "object") {
          out.push({ id, entry: row as InstalledEntry });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

function listedFromEntry(
  id: string,
  entry: InstalledEntry,
  installPath: string,
  enabled: boolean,
): ListedPlugin {
  const at = id.lastIndexOf("@");
  const name = at > 0 ? id.slice(0, at) : id;
  const marketplaceName = at > 0 ? id.slice(at + 1) : undefined;
  const scope =
    entry.scope === "local" || entry.scope === "project" ? entry.scope : "user";
  return {
    id,
    name,
    installPath,
    enabled,
    installedAt: typeof entry.installedAt === "string" ? entry.installedAt : undefined,
    lastUpdated: typeof entry.lastUpdated === "string" ? entry.lastUpdated : undefined,
    marketplaceName,
    scope,
    source: marketplaceName ?? "local",
    version: typeof entry.version === "string" ? entry.version : undefined,
  };
}

/**
 * Official getAllLocalPluginsWithResolver(DkA(cwd), cwd).
 * When workspacePath is omitted, project/local rows are skipped (no prefix match).
 */
export function listCliLocalPlugins(
  workspacePath?: string | null,
  deps: CliPluginsResolverDeps = {},
): ListedPlugin[] {
  const pluginsDir = cliPluginsDir(deps);
  const file = cliInstalledPluginsFile(deps);
  const text = readText(file, deps);
  if (!text) return [];
  const enabledMap = mergeCliEnabledPluginsMap(workspacePath, deps);
  const workspace = workspacePath ? path.normalize(workspacePath) : null;
  const out: ListedPlugin[] = [];
  for (const { id, entry } of parseInstalledEntries(text)) {
    if (typeof entry.installPath !== "string" || !entry.installPath) continue;
    const installPath = path.resolve(entry.installPath);
    if (!isValidCliPluginPath(installPath, pluginsDir, workspace, deps)) continue;
    if (!existsPath(installPath, deps)) continue;
    const scope =
      entry.scope === "local" || entry.scope === "project" ? entry.scope : "user";
    if (scope === "project" || scope === "local") {
      if (!workspace || typeof entry.projectPath !== "string") continue;
      const project = path.normalize(entry.projectPath);
      if (workspace !== project && !workspace.startsWith(project + path.sep)) continue;
    }
    out.push(listedFromEntry(id, entry, installPath, enabledMap[id] === true));
  }
  return out;
}

export function listEnabledCliLocalPlugins(
  workspacePath?: string | null,
  deps: CliPluginsResolverDeps = {},
): ListedPlugin[] {
  return listCliLocalPlugins(workspacePath, deps).filter((plugin) => plugin.enabled);
}
