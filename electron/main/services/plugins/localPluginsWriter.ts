/**
 * Official LocalPluginsWriter residual (app.asar class TGi / ku):
 *
 *   pI = "local-desktop-app-uploads"
 *   Wle = { name:pI, version:"1.0.0", description:"Locally uploaded plugins…",
 *           owner:{name:"Local User"}, plugins:[] }
 *   uC / TL / Nw / XV / e4 / eK path helpers under account/org
 *   ensureMarketplaceExistsWithPaths → marketplaces/pI + known_marketplaces.json
 *   installPluginFromZipWithPaths → validate plugin.json (V9t), copy into marketplace,
 *     write installed_plugins.json, set enabledPlugins in cowork_settings.json
 *
 * Product residual (honest):
 *   - No Anthropic cloud marketplace fetch (gQ / n9 / lMA).
 *   - Zip + directory install work fully on disk when account/org present.
 *   - Custom directory marketplaces register into known_marketplaces.json and
 *     can install plugins already on disk under that marketplace tree.
 *   - Does not invent install success without .claude-plugin/plugin.json + disk write.
 */
import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import {
  coworkAccountStorageDir,
} from "../coworkSessions/coworkAutoMemoryPaths";
import {
  coworkInstalledPluginsFile,
  coworkPluginsDir,
  coworkSettingsFile,
} from "../coworkSessions/coworkReadOnlyPluginPaths";

/** Official pI */
export const LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE = "local-desktop-app-uploads";

/** Official Hp */
export const ORG_PROVISIONED_MARKETPLACE = "org-provisioned";

/**
 * Product residual account/org when login identity is not ready yet.
 * Ensures download/install always lands on disk under a stable layout so
 * sessions can load plugins without inventing cloud marketplace success.
 */
export const LOCAL_PLUGINS_FALLBACK_ACCOUNT_ID = "local-desktop";
export const LOCAL_PLUGINS_FALLBACK_ORG_ID = "local-default";

/** Official _bA — kebab-case plugin name */
export const PLUGIN_NAME_KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type LocalPluginsAccountCtx = {
  accountId: string;
  orgId: string;
};

export type LocalPluginsPathBag = {
  pluginsDir: string;
  marketplacesDir: string;
  installedPluginsFile: string;
  knownMarketplacesFile: string;
  settingsFile: string;
  remotePluginsDir: string;
};

export type KnownMarketplaceEntry = {
  source: { source: string; path?: string; url?: string; repo?: string };
  installLocation: string;
  lastUpdated: string;
};

export type MarketplaceJson = {
  name: string;
  version: string;
  description?: string;
  owner?: { name?: string };
  plugins: Array<{ name: string; version?: string; source?: string }>;
};

export type InstalledPluginsManifest = {
  version: number;
  plugins: Record<
    string,
    Array<{
      scope: string;
      installPath: string;
      version?: string;
      installedAt?: string;
      lastUpdated?: string;
      projectPath?: string;
    }>
  >;
};

export type PluginJsonValidation = {
  valid: boolean;
  userErrors: string[];
  securityErrors: string[];
};

export type InstallPluginResult =
  | {
      success: true;
      pluginName: string;
      pluginVersion: string;
      installPath: string;
      pluginId: string;
      isNew: boolean;
    }
  | { success: false; error: string; userFacing?: boolean };

export type ListedPlugin = {
  id: string;
  name: string;
  version?: string;
  installPath: string;
  source: string;
  marketplaceName?: string;
  enabled?: boolean;
  installedAt?: string;
};

const DEFAULT_LOCAL_MARKETPLACE_JSON: MarketplaceJson = {
  name: LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE,
  version: "1.0.0",
  description: "Locally uploaded plugins via Claude Desktop app",
  owner: { name: "Local User" },
  plugins: [],
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readJsonSync(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function writeJsonSync(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Official V9t residual — name + basic shape only (no full clis/oauth security tree). */
export function validatePluginJson(raw: unknown): PluginJsonValidation {
  const userErrors: string[] = [];
  const securityErrors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      userErrors: ["plugin.json must be a JSON object."],
      securityErrors: [],
    };
  }
  const obj = raw as Record<string, unknown>;
  if (!isNonEmptyString(obj.name)) {
    userErrors.push("Plugin name is required.");
  } else if (obj.name.trim().length === 0) {
    userErrors.push("Plugin name can't be empty.");
  } else if (!PLUGIN_NAME_KEBAB_RE.test(obj.name)) {
    userErrors.push(
      'Plugin name must be kebab-case: lowercase letters, numbers, and hyphens (e.g. "my-plugin").',
    );
  }
  return {
    valid: userErrors.length === 0 && securityErrors.length === 0,
    userErrors,
    securityErrors,
  };
}

/** Official tB residual */
export function readInstalledPluginsManifest(
  filePath: string,
): InstalledPluginsManifest {
  const raw = readJsonSync(filePath);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { version: 2, plugins: {} };
  }
  const plugins = (raw as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) {
    return { version: 2, plugins: {} };
  }
  return {
    version: 2,
    plugins: { ...(plugins as InstalledPluginsManifest["plugins"]) },
  };
}

export function knownMarketplacesFile(
  userDataPath: string,
  accountId: string,
  orgId: string,
): string {
  return path.join(
    coworkPluginsDir(userDataPath, accountId, orgId),
    "known_marketplaces.json",
  );
}

export function marketplacesDir(
  userDataPath: string,
  accountId: string,
  orgId: string,
): string {
  return path.join(
    coworkPluginsDir(userDataPath, accountId, orgId),
    "marketplaces",
  );
}

export function remotePluginsRpmDir(
  userDataPath: string,
  accountId: string,
  orgId: string,
): string {
  return path.join(
    coworkAccountStorageDir(userDataPath, accountId, orgId),
    "rpm",
  );
}

/** Official TGi.resolvePathsFromCtx residual (userData-aware). */
export function resolveLocalPluginsPaths(
  userDataPath: string,
  ctx: LocalPluginsAccountCtx,
): LocalPluginsPathBag {
  return {
    pluginsDir: coworkPluginsDir(userDataPath, ctx.accountId, ctx.orgId),
    marketplacesDir: marketplacesDir(userDataPath, ctx.accountId, ctx.orgId),
    installedPluginsFile: coworkInstalledPluginsFile(
      userDataPath,
      ctx.accountId,
      ctx.orgId,
    ),
    knownMarketplacesFile: knownMarketplacesFile(
      userDataPath,
      ctx.accountId,
      ctx.orgId,
    ),
    settingsFile: coworkSettingsFile(userDataPath, ctx.accountId, ctx.orgId),
    remotePluginsDir: remotePluginsRpmDir(
      userDataPath,
      ctx.accountId,
      ctx.orgId,
    ),
  };
}

export function localUploadMarketplaceDir(paths: LocalPluginsPathBag): string {
  return path.join(paths.marketplacesDir, LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE);
}

/** Official ensureMarketplaceExistsWithPaths residual for pI. */
export function ensureLocalUploadMarketplace(paths: LocalPluginsPathBag): void {
  const marketplaceRoot = localUploadMarketplaceDir(paths);
  const markerDir = path.join(marketplaceRoot, ".claude-plugin");
  const marketplaceJson = path.join(markerDir, "marketplace.json");
  fs.mkdirSync(markerDir, { recursive: true });
  if (!fs.existsSync(marketplaceJson)) {
    writeJsonSync(marketplaceJson, DEFAULT_LOCAL_MARKETPLACE_JSON);
  }
  const known =
    (readJsonSync(paths.knownMarketplacesFile) as Record<
      string,
      KnownMarketplaceEntry
    > | null) ?? {};
  const entry = known[LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE];
  if (!entry || entry.installLocation !== marketplaceRoot) {
    known[LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE] = {
      source: { source: "directory", path: marketplaceRoot },
      installLocation: marketplaceRoot,
      lastUpdated: new Date().toISOString(),
    };
    writeJsonSync(paths.knownMarketplacesFile, known);
  }
}

/**
 * Register a local directory as a custom marketplace (product residual for
 * "add marketplace" without cloud). Does not invent remote git/url clone.
 */
export function addLocalDirectoryMarketplace(
  paths: LocalPluginsPathBag,
  input: { name?: string | null; directoryPath: string },
):
  | { success: true; marketplace: Record<string, unknown> }
  | { success: false; error: string } {
  const resolved = path.resolve(input.directoryPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { success: false, error: "Marketplace path is not a directory." };
  }

  // Prefer .claude-plugin/marketplace.json name when present.
  const marketplaceJsonPath = path.join(
    resolved,
    ".claude-plugin",
    "marketplace.json",
  );
  let marketplaceMeta = readJsonSync(marketplaceJsonPath) as MarketplaceJson | null;
  let name =
    (isNonEmptyString(input.name) ? input.name.trim() : null)
    ?? (isNonEmptyString(marketplaceMeta?.name) ? marketplaceMeta!.name : null)
    ?? path.basename(resolved);

  // Safe marketplace id segment (official marketplace dir name).
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!safeName) {
    return { success: false, error: "Invalid marketplace name." };
  }

  // Materialize under marketplaces/<name> so session layout is official-shaped.
  // Prefer copy when source is outside marketplacesDir; if already inside, keep.
  const destRoot = path.join(paths.marketplacesDir, safeName);
  fs.mkdirSync(paths.marketplacesDir, { recursive: true });
  if (path.resolve(resolved) !== path.resolve(destRoot)) {
    copyDirRecursive(resolved, destRoot);
  }

  const destMarketplaceJson = path.join(
    destRoot,
    ".claude-plugin",
    "marketplace.json",
  );
  if (!fs.existsSync(destMarketplaceJson)) {
    // Build marketplace.json from scanned plugin children when missing.
    const plugins = scanMarketplacePlugins(destRoot).map((p) => ({
      name: p.name,
      version: p.version ?? "0.0.0",
      source: `./${p.name}`,
    }));
    writeJsonSync(destMarketplaceJson, {
      name: safeName,
      version: "1.0.0",
      description: `Local marketplace ${safeName}`,
      owner: { name: "Local User" },
      plugins,
    });
  }
  marketplaceMeta =
    (readJsonSync(destMarketplaceJson) as MarketplaceJson | null)
    ?? marketplaceMeta;

  const known =
    (readJsonSync(paths.knownMarketplacesFile) as Record<
      string,
      KnownMarketplaceEntry
    > | null) ?? {};
  known[safeName] = {
    source: { source: "directory", path: destRoot },
    installLocation: destRoot,
    lastUpdated: new Date().toISOString(),
  };
  writeJsonSync(paths.knownMarketplacesFile, known);

  return {
    success: true,
    marketplace: {
      id: safeName,
      name: marketplaceMeta?.name ?? safeName,
      url: destRoot,
      source: { source: "directory", path: destRoot },
      installLocation: destRoot,
      plugins: marketplaceMeta?.plugins ?? [],
      lastUpdated: known[safeName]!.lastUpdated,
    },
  };
}

export function listKnownMarketplaces(
  paths: LocalPluginsPathBag,
): Array<Record<string, unknown>> {
  ensureLocalUploadMarketplace(paths);
  const known =
    (readJsonSync(paths.knownMarketplacesFile) as Record<
      string,
      KnownMarketplaceEntry
    > | null) ?? {};
  return Object.entries(known).map(([id, entry]) => {
    const marketplaceJson = readJsonSync(
      path.join(entry.installLocation, ".claude-plugin", "marketplace.json"),
    ) as MarketplaceJson | null;
    const plugins =
      marketplaceJson?.plugins
      ?? scanMarketplacePlugins(entry.installLocation).map((p) => ({
        name: p.name,
        version: p.version ?? "0.0.0",
        source: `./${p.name}`,
      }));
    return {
      id,
      name: marketplaceJson?.name ?? id,
      url: entry.source.path ?? entry.installLocation,
      source: entry.source,
      installLocation: entry.installLocation,
      plugins,
      lastUpdated: entry.lastUpdated,
    };
  });
}

export function removeKnownMarketplace(
  paths: LocalPluginsPathBag,
  marketplaceId: string,
): boolean {
  const id = marketplaceId.trim();
  if (!id) return false;
  // Never delete the local-upload marketplace tree via remove; only drop registry.
  const known =
    (readJsonSync(paths.knownMarketplacesFile) as Record<
      string,
      KnownMarketplaceEntry
    > | null) ?? {};
  if (!(id in known)) return false;
  delete known[id];
  writeJsonSync(paths.knownMarketplacesFile, known);
  return true;
}

export function refreshKnownMarketplace(
  paths: LocalPluginsPathBag,
  marketplaceId: string,
): Record<string, unknown> | null {
  const id = marketplaceId.trim();
  const known =
    (readJsonSync(paths.knownMarketplacesFile) as Record<
      string,
      KnownMarketplaceEntry
    > | null) ?? {};
  const entry = known[id];
  if (!entry) return null;
  // Rescan plugins on disk into marketplace.json when directory marketplace.
  if (entry.source.source === "directory" && fs.existsSync(entry.installLocation)) {
    const marketplaceJsonPath = path.join(
      entry.installLocation,
      ".claude-plugin",
      "marketplace.json",
    );
    const existing =
      (readJsonSync(marketplaceJsonPath) as MarketplaceJson | null) ?? {
        name: id,
        version: "1.0.0",
        plugins: [],
      };
    existing.plugins = scanMarketplacePlugins(entry.installLocation).map((p) => ({
      name: p.name,
      version: p.version ?? "0.0.0",
      source: `./${p.name}`,
    }));
    writeJsonSync(marketplaceJsonPath, existing);
    entry.lastUpdated = new Date().toISOString();
    known[id] = entry;
    writeJsonSync(paths.knownMarketplacesFile, known);
  }
  const listed = listKnownMarketplaces(paths).find((m) => m.id === id);
  return listed ?? null;
}

type ScannedPlugin = {
  name: string;
  version?: string;
  path: string;
  description?: string;
};

export function scanMarketplacePlugins(marketplaceRoot: string): ScannedPlugin[] {
  if (!fs.existsSync(marketplaceRoot)) return [];
  const out: ScannedPlugin[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(marketplaceRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".")) continue;
    const dir = path.join(marketplaceRoot, ent.name);
    const marker = path.join(dir, ".claude-plugin", "plugin.json");
    if (!fs.existsSync(marker)) continue;
    const raw = readJsonSync(marker) as Record<string, unknown> | null;
    const name =
      isNonEmptyString(raw?.name) ? raw!.name : ent.name;
    out.push({
      name,
      version: isNonEmptyString(raw?.version) ? raw!.version : undefined,
      path: dir,
      description: isNonEmptyString(raw?.description)
        ? raw!.description
        : undefined,
    });
  }
  return out;
}

/**
 * List plugins available from known local marketplaces (on-disk only).
 * Does not invent remote Anthropic catalog entries.
 */
export function listAvailableLocalMarketplacePlugins(
  paths: LocalPluginsPathBag,
): Array<Record<string, unknown>> {
  const marketplaces = listKnownMarketplaces(paths);
  const items: Array<Record<string, unknown>> = [];
  for (const market of marketplaces) {
    const root = String(market.installLocation ?? "");
    if (!root) continue;
    for (const plugin of scanMarketplacePlugins(root)) {
      items.push({
        id: `${plugin.name}@${String(market.id)}`,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        marketplaceId: market.id,
        marketplaceName: market.name,
        path: plugin.path,
        source: "marketplace",
        pluginSource: "marketplace",
      });
    }
  }
  return items;
}

export function listInstalledPluginsFromDisk(
  paths: LocalPluginsPathBag,
): ListedPlugin[] {
  const manifest = readInstalledPluginsManifest(paths.installedPluginsFile);
  const settings = readJsonSync(paths.settingsFile) as {
    enabledPlugins?: Record<string, unknown>;
  } | null;
  const enabledMap =
    settings?.enabledPlugins && typeof settings.enabledPlugins === "object"
      ? settings.enabledPlugins
      : {};
  const out: ListedPlugin[] = [];
  for (const [pluginId, entries] of Object.entries(manifest.plugins)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || !isNonEmptyString(entry.installPath)) continue;
      const installPath = path.resolve(entry.installPath);
      if (!fs.existsSync(installPath)) continue;
      const at = pluginId.lastIndexOf("@");
      const name = at > 0 ? pluginId.slice(0, at) : pluginId;
      const marketplaceName = at > 0 ? pluginId.slice(at + 1) : undefined;
      const enabled =
        typeof enabledMap[pluginId] === "boolean"
          ? (enabledMap[pluginId] as boolean)
          : true;
      out.push({
        id: pluginId,
        name,
        version: entry.version,
        installPath,
        source:
          marketplaceName === LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE
            ? "local-upload"
            : marketplaceName
              ? "marketplace"
              : "local",
        marketplaceName,
        enabled,
        installedAt: entry.installedAt,
      });
    }
  }
  return out;
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (ent.isSymbolicLink()) {
      // Skip links — residual honest install without following arbitrary targets.
      continue;
    } else if (ent.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function addPluginToMarketplaceJson(
  paths: LocalPluginsPathBag,
  marketplaceName: string,
  pluginName: string,
  version: string,
): void {
  const marketplaceJsonPath = path.join(
    paths.marketplacesDir,
    marketplaceName,
    ".claude-plugin",
    "marketplace.json",
  );
  const existing =
    (readJsonSync(marketplaceJsonPath) as MarketplaceJson | null) ?? {
      ...DEFAULT_LOCAL_MARKETPLACE_JSON,
      name: marketplaceName,
      plugins: [],
    };
  const plugins = Array.isArray(existing.plugins) ? [...existing.plugins] : [];
  const idx = plugins.findIndex((p) => p.name === pluginName);
  const entry = { name: pluginName, version, source: `./${pluginName}` };
  if (idx >= 0) plugins[idx] = entry;
  else plugins.push(entry);
  existing.plugins = plugins;
  writeJsonSync(marketplaceJsonPath, existing);
}

function addPluginToInstalled(
  paths: LocalPluginsPathBag,
  pluginId: string,
  version: string,
  installPath: string,
): void {
  const manifest = readInstalledPluginsManifest(paths.installedPluginsFile);
  const now = new Date().toISOString();
  const list = manifest.plugins[pluginId] ?? [];
  const userIdx = list.findIndex((e) => e.scope === "user");
  const entry = {
    scope: "user",
    installPath,
    version,
    installedAt: userIdx >= 0 ? list[userIdx]!.installedAt ?? now : now,
    lastUpdated: now,
  };
  if (userIdx >= 0) list[userIdx] = entry;
  else list.push(entry);
  manifest.plugins[pluginId] = list;
  writeJsonSync(paths.installedPluginsFile, manifest);
}

function setPluginEnabled(
  paths: LocalPluginsPathBag,
  pluginId: string,
  enabled: boolean,
): void {
  const raw =
    (readJsonSync(paths.settingsFile) as Record<string, unknown> | null) ?? {};
  const enabledPlugins =
    raw.enabledPlugins && typeof raw.enabledPlugins === "object"
      ? { ...(raw.enabledPlugins as Record<string, unknown>) }
      : {};
  enabledPlugins[pluginId] = enabled;
  raw.enabledPlugins = enabledPlugins;
  writeJsonSync(paths.settingsFile, raw);
}

function removePluginFromInstalled(
  paths: LocalPluginsPathBag,
  pluginIdOrName: string,
): string | null {
  const manifest = readInstalledPluginsManifest(paths.installedPluginsFile);
  let removedPath: string | null = null;
  for (const key of Object.keys(manifest.plugins)) {
    const at = key.lastIndexOf("@");
    const name = at > 0 ? key.slice(0, at) : key;
    if (key === pluginIdOrName || name === pluginIdOrName) {
      const entries = manifest.plugins[key] ?? [];
      removedPath = entries[0]?.installPath ?? removedPath;
      delete manifest.plugins[key];
    }
  }
  writeJsonSync(paths.installedPluginsFile, manifest);
  return removedPath;
}

function removePluginFromMarketplaceJson(
  paths: LocalPluginsPathBag,
  marketplaceName: string,
  pluginName: string,
): void {
  const marketplaceJsonPath = path.join(
    paths.marketplacesDir,
    marketplaceName,
    ".claude-plugin",
    "marketplace.json",
  );
  const existing = readJsonSync(marketplaceJsonPath) as MarketplaceJson | null;
  if (!existing || !Array.isArray(existing.plugins)) return;
  existing.plugins = existing.plugins.filter((p) => p.name !== pluginName);
  writeJsonSync(marketplaceJsonPath, existing);
}

function removePluginEnabled(
  paths: LocalPluginsPathBag,
  pluginId: string,
): void {
  const raw = readJsonSync(paths.settingsFile) as Record<string, unknown> | null;
  if (!raw?.enabledPlugins || typeof raw.enabledPlugins !== "object") return;
  const enabled = { ...(raw.enabledPlugins as Record<string, unknown>) };
  delete enabled[pluginId];
  raw.enabledPlugins = enabled;
  writeJsonSync(paths.settingsFile, raw);
}

function findExistingInstall(
  paths: LocalPluginsPathBag,
  pluginName: string,
): { installPath: string; pluginId: string } | null {
  const manifest = readInstalledPluginsManifest(paths.installedPluginsFile);
  const orgKey = `${pluginName}@${ORG_PROVISIONED_MARKETPLACE}`;
  const orgEntries = manifest.plugins[orgKey];
  if (orgEntries?.[0]?.installPath) {
    return {
      installPath: path.resolve(orgEntries[0].installPath),
      pluginId: orgKey,
    };
  }
  for (const [pluginId, entries] of Object.entries(manifest.plugins)) {
    const at = pluginId.lastIndexOf("@");
    const name = at > 0 ? pluginId.slice(0, at) : pluginId;
    if (name !== pluginName) continue;
    const user = entries.find((e) => e.scope === "user") ?? entries[0];
    if (user?.installPath) {
      return {
        installPath: path.resolve(user.installPath),
        pluginId,
      };
    }
  }
  return null;
}

function readPluginJsonFromDir(
  pluginDir: string,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const marker = path.join(pluginDir, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(marker)) {
    return {
      ok: false,
      error: "Invalid plugin: missing .claude-plugin/plugin.json",
    };
  }
  try {
    const data = JSON.parse(fs.readFileSync(marker, "utf8")) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return {
        ok: false,
        error: "Invalid plugin: plugin.json is not valid JSON.",
      };
    }
    return { ok: true, data: data as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      error: "Invalid plugin: plugin.json is not valid JSON.",
    };
  }
}

/**
 * Official-ish install from an already-extracted plugin directory into
 * local-desktop-app-uploads marketplace (or another marketplace when provided).
 */
export function installPluginFromDirectory(
  paths: LocalPluginsPathBag,
  sourceDir: string,
  options: {
    replaceExisting?: boolean;
    marketplaceName?: string;
  } = {},
): InstallPluginResult {
  const marketplaceName =
    options.marketplaceName ?? LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE;
  if (marketplaceName === LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE) {
    ensureLocalUploadMarketplace(paths);
  } else {
    // Ensure marketplace root + registry entry for non-upload markets (e.g. org-provisioned).
    const marketplaceRoot = path.join(paths.marketplacesDir, marketplaceName);
    const markerDir = path.join(marketplaceRoot, ".claude-plugin");
    const marketplaceJson = path.join(markerDir, "marketplace.json");
    fs.mkdirSync(markerDir, { recursive: true });
    if (!fs.existsSync(marketplaceJson)) {
      writeJsonSync(marketplaceJson, {
        name: marketplaceName,
        version: "1.0.0",
        description: `Local marketplace ${marketplaceName}`,
        owner: { name: "Local User" },
        plugins: [],
      });
    }
    const known =
      (readJsonSync(paths.knownMarketplacesFile) as Record<
        string,
        KnownMarketplaceEntry
      > | null) ?? {};
    if (!known[marketplaceName]) {
      known[marketplaceName] = {
        source: { source: "directory", path: marketplaceRoot },
        installLocation: marketplaceRoot,
        lastUpdated: new Date().toISOString(),
      };
      writeJsonSync(paths.knownMarketplacesFile, known);
    }
  }

  const source = path.resolve(sourceDir);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    return { success: false, error: "Plugin path is not a directory.", userFacing: true };
  }

  const pluginJson = readPluginJsonFromDir(source);
  if (!pluginJson.ok) {
    return { success: false, error: pluginJson.error, userFacing: true };
  }
  const validation = validatePluginJson(pluginJson.data);
  if (!validation.valid) {
    const msg =
      validation.securityErrors[0]
      ?? validation.userErrors.join(" ")
      ?? "Invalid plugin.json";
    return {
      success: false,
      error: msg,
      userFacing: validation.securityErrors.length === 0,
    };
  }

  const pluginName = String(pluginJson.data.name);
  const version = isNonEmptyString(pluginJson.data.version)
    ? pluginJson.data.version
    : "0.0.0";
  const existing = findExistingInstall(paths, pluginName);
  if (
    existing?.pluginId.endsWith(`@${ORG_PROVISIONED_MARKETPLACE}`)
  ) {
    return {
      success: false,
      error: `"${pluginName}" is managed by your organization and cannot be replaced.`,
      userFacing: true,
    };
  }
  if (existing && !options.replaceExisting) {
    return {
      success: false,
      error: `Plugin "${pluginName}" is already installed. Pass replaceExisting to overwrite.`,
      userFacing: true,
    };
  }

  const marketplaceRoot = path.join(paths.marketplacesDir, marketplaceName);
  fs.mkdirSync(marketplaceRoot, { recursive: true });
  const installPath = path.join(marketplaceRoot, pluginName);

  // Guard installPath stays under marketplacesDir.
  const rel = path.relative(paths.marketplacesDir, installPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { success: false, error: "Invalid plugin install path." };
  }

  if (fs.existsSync(installPath)) {
    fs.rmSync(installPath, { recursive: true, force: true });
  }
  copyDirRecursive(source, installPath);

  const pluginId =
    existing && !existing.pluginId.endsWith(`@${LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE}`)
      ? existing.pluginId
      : `${pluginName}@${marketplaceName}`;

  if (
    !existing
    || existing.pluginId.endsWith(`@${LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE}`)
    || pluginId.endsWith(`@${marketplaceName}`)
  ) {
    addPluginToMarketplaceJson(paths, marketplaceName, pluginName, version);
  }
  addPluginToInstalled(paths, pluginId, version, installPath);
  setPluginEnabled(paths, pluginId, true);

  return {
    success: true,
    pluginName,
    pluginVersion: version,
    installPath,
    pluginId,
    isNew: existing === null,
  };
}

/**
 * Official installPluginFromZip residual using fflate unzip (product residual).
 * Accepts Buffer (decoded base64) or .zip file path.
 */
export function installPluginFromZip(
  paths: LocalPluginsPathBag,
  zipInput: Buffer | string,
  options: { replaceExisting?: boolean } = {},
): InstallPluginResult {
  ensureLocalUploadMarketplace(paths);
  let zipBytes: Uint8Array;
  try {
    if (typeof zipInput === "string") {
      zipBytes = fs.readFileSync(zipInput);
    } else {
      zipBytes = zipInput;
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to read zip",
      userFacing: true,
    };
  }
  if (zipBytes.byteLength === 0) {
    return { success: false, error: "Zip buffer is empty (0 bytes).", userFacing: true };
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? `Invalid zip: ${err.message}`
          : "Invalid zip archive",
      userFacing: true,
    };
  }

  const tempRoot = path.join(
    localUploadMarketplaceDir(paths),
    `.temp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  );
  try {
    // Strip single top-level folder if all entries share it and root has no plugin.json.
    const names = Object.keys(files).filter((n) => !n.endsWith("/"));
    if (names.length === 0) {
      return { success: false, error: "Zip archive is empty.", userFacing: true };
    }
    const tops = new Set(
      names.map((n) => n.split("/")[0]).filter(Boolean) as string[],
    );
    let stripPrefix = "";
    if (tops.size === 1) {
      const only = [...tops][0]!;
      const hasNested = names.some((n) => n.startsWith(`${only}/`));
      if (
        hasNested
        && names.every((n) => n === only || n.startsWith(`${only}/`))
        && !names.includes(".claude-plugin/plugin.json")
      ) {
        stripPrefix = `${only}/`;
      }
    }

    for (const [name, content] of Object.entries(files)) {
      if (name.endsWith("/")) continue;
      const rel = stripPrefix && name.startsWith(stripPrefix)
        ? name.slice(stripPrefix.length)
        : name;
      if (!rel || rel.includes("..")) continue;
      const dest = path.join(tempRoot, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content);
    }

    const result = installPluginFromDirectory(paths, tempRoot, {
      replaceExisting: options.replaceExisting,
      marketplaceName: LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE,
    });
    return result;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Install a plugin that already lives under a known marketplace directory
 * (pluginId form: name@marketplace).
 */
export function installPluginByIdFromDisk(
  paths: LocalPluginsPathBag,
  pluginId: string,
  options: { replaceExisting?: boolean } = {},
): InstallPluginResult {
  const id = pluginId.trim();
  if (!id) {
    return { success: false, error: "Missing plugin id.", userFacing: true };
  }
  const at = id.lastIndexOf("@");
  if (at <= 0) {
    return {
      success: false,
      error:
        "Local residual requires pluginId as name@marketplace (no cloud fetch).",
      userFacing: true,
    };
  }
  const name = id.slice(0, at);
  const marketplace = id.slice(at + 1);
  const marketplaces = listKnownMarketplaces(paths);
  const market = marketplaces.find((m) => m.id === marketplace);
  if (!market) {
    return {
      success: false,
      error: `Marketplace "${marketplace}" is not registered locally.`,
      userFacing: true,
    };
  }
  const root = String(market.installLocation ?? "");
  const candidate = path.join(root, name);
  if (!fs.existsSync(path.join(candidate, ".claude-plugin", "plugin.json"))) {
    // Try scan by plugin.json name
    const hit = scanMarketplacePlugins(root).find((p) => p.name === name);
    if (!hit) {
      return {
        success: false,
        error: `Plugin "${name}" not found under marketplace "${marketplace}" on disk.`,
        userFacing: true,
      };
    }
    return installPluginFromDirectory(paths, hit.path, {
      replaceExisting: options.replaceExisting,
      marketplaceName: marketplace,
    });
  }
  return installPluginFromDirectory(paths, candidate, {
    replaceExisting: options.replaceExisting,
    marketplaceName: marketplace,
  });
}

export function uninstallPluginFromDisk(
  paths: LocalPluginsPathBag,
  pluginId: string,
): boolean {
  const id = pluginId.trim();
  if (!id) return false;
  const at = id.lastIndexOf("@");
  const name = at > 0 ? id.slice(0, at) : id;
  const marketplace =
    at > 0 ? id.slice(at + 1) : LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE;

  const removedPath = removePluginFromInstalled(paths, id);
  removePluginFromMarketplaceJson(paths, marketplace, name);
  removePluginEnabled(paths, id);
  // Also try bare name key variants
  removePluginEnabled(paths, `${name}@${marketplace}`);

  const installPath =
    removedPath
    ?? path.join(paths.marketplacesDir, marketplace, name);
  if (installPath && fs.existsSync(installPath)) {
    // Only delete if under marketplacesDir
    const rel = path.relative(paths.marketplacesDir, path.resolve(installPath));
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      fs.rmSync(installPath, { recursive: true, force: true });
    }
  }
  return true;
}

export function setPluginEnabledOnDisk(
  paths: LocalPluginsPathBag,
  pluginId: string,
  enabled: boolean,
): Record<string, unknown> | null {
  const installed = listInstalledPluginsFromDisk(paths);
  const hit = installed.find((p) => p.id === pluginId);
  if (!hit) return null;
  setPluginEnabled(paths, pluginId, enabled);
  return { ...hit, enabled };
}

/**
 * Parse addMarketplace input residual:
 * - string path / file:// → local directory marketplace
 * - object { path | url | name } with local path → directory
 * - remote URL/git → not implemented (honest error, no invent success)
 */
export function resolveLocalMarketplaceInput(
  nameOrInput: unknown,
  url?: unknown,
  meta?: unknown,
):
  | { kind: "directory"; name?: string; directoryPath: string }
  | { kind: "unsupported"; error: string } {
  const metaObj =
    meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : {};

  if (typeof nameOrInput === "object" && nameOrInput !== null) {
    const obj = nameOrInput as Record<string, unknown>;
    const pathCandidate =
      (isNonEmptyString(obj.path) && obj.path)
      || (isNonEmptyString(obj.directory) && obj.directory)
      || (isNonEmptyString(obj.url) && obj.url)
      || null;
    if (pathCandidate) {
      const normalized = normalizeMaybeFileUrl(pathCandidate);
      if (normalized.localPath) {
        return {
          kind: "directory",
          name: isNonEmptyString(obj.name) ? obj.name : undefined,
          directoryPath: normalized.localPath,
        };
      }
      return {
        kind: "unsupported",
        error:
          "Remote marketplace URLs are not synced in this residual (local directory only).",
      };
    }
    return {
      kind: "unsupported",
      error: "Marketplace input must include a local directory path.",
    };
  }

  const name = isNonEmptyString(nameOrInput) ? nameOrInput : undefined;
  const urlStr = isNonEmptyString(url)
    ? url
    : isNonEmptyString(metaObj.url)
      ? metaObj.url
      : isNonEmptyString(metaObj.path)
        ? metaObj.path
        : null;

  if (urlStr) {
    const normalized = normalizeMaybeFileUrl(urlStr);
    if (normalized.localPath) {
      return {
        kind: "directory",
        name,
        directoryPath: normalized.localPath,
      };
    }
    // bare path without scheme
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(urlStr) && path.isAbsolute(urlStr)) {
      return { kind: "directory", name, directoryPath: urlStr };
    }
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(urlStr) && fs.existsSync(urlStr)) {
      return {
        kind: "directory",
        name,
        directoryPath: path.resolve(urlStr),
      };
    }
    return {
      kind: "unsupported",
      error:
        "Remote marketplace URLs are not synced in this residual (local directory only).",
    };
  }

  // name alone treated as directory if it exists on disk
  if (name && fs.existsSync(name)) {
    return {
      kind: "directory",
      directoryPath: path.resolve(name),
    };
  }

  return {
    kind: "unsupported",
    error: "Missing local marketplace path (cloud marketplace not required for local residual).",
  };
}

function normalizeMaybeFileUrl(
  value: string,
): { localPath: string | null; remote: boolean } {
  if (value.startsWith("file://")) {
    try {
      const u = new URL(value);
      return { localPath: decodeURIComponent(u.pathname), remote: false };
    } catch {
      return { localPath: null, remote: true };
    }
  }
  if (/^https?:\/\//i.test(value) || /^git@/i.test(value) || value.startsWith("git+")) {
    return { localPath: null, remote: true };
  }
  if (path.isAbsolute(value) || value.startsWith("./") || value.startsWith("../")) {
    return { localPath: path.resolve(value), remote: false };
  }
  if (fs.existsSync(value)) {
    return { localPath: path.resolve(value), remote: false };
  }
  return { localPath: null, remote: true };
}

/**
 * Resolve account/org for plugin disk layout.
 * Prefer real identity; fall back to stable local residual so installs always
 * write to disk (never invent network marketplace success).
 */
export function resolvePluginsAccountCtx(input: {
  accountId?: string | null;
  orgId?: string | null;
  identity?: { accountUuid?: string | null; organizationUuid?: string | null } | null;
  /**
   * When true (default), missing identity uses local-desktop/local-default.
   * Pass false only for callers that must detect "no identity yet".
   */
  allowFallback?: boolean;
}): LocalPluginsAccountCtx | null {
  const accountId =
    input.accountId?.trim()
    || input.identity?.accountUuid?.trim()
    || null;
  const orgId =
    input.orgId?.trim()
    || input.identity?.organizationUuid?.trim()
    || null;
  if (accountId && orgId) return { accountId, orgId };
  if (input.allowFallback === false) return null;
  return {
    accountId: LOCAL_PLUGINS_FALLBACK_ACCOUNT_ID,
    orgId: LOCAL_PLUGINS_FALLBACK_ORG_ID,
  };
}

/**
 * Account/org pairs to scan for installed plugins when starting a session.
 * Includes real identity (when present) + local fallback so pre-login installs
 * remain loadable after identity arrives.
 */
export function pluginCollectAccountPairs(input: {
  accountId?: string | null;
  orgId?: string | null;
  identity?: { accountUuid?: string | null; organizationUuid?: string | null } | null;
}): LocalPluginsAccountCtx[] {
  const pairs: LocalPluginsAccountCtx[] = [];
  const seen = new Set<string>();
  const push = (accountId: string, orgId: string) => {
    const key = `${accountId}\0${orgId}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ accountId, orgId });
  };
  const primary = resolvePluginsAccountCtx({ ...input, allowFallback: false });
  if (primary) push(primary.accountId, primary.orgId);
  push(LOCAL_PLUGINS_FALLBACK_ACCOUNT_ID, LOCAL_PLUGINS_FALLBACK_ORG_ID);
  return pairs;
}

/** Test helper: write a minimal plugin tree under root. */
export function writeMinimalPluginFixture(
  root: string,
  plugin: { name: string; version?: string; description?: string },
): string {
  const dir = path.join(root, plugin.name);
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  writeJsonSync(path.join(dir, ".claude-plugin", "plugin.json"), {
    name: plugin.name,
    version: plugin.version ?? "1.0.0",
    description: plugin.description ?? `${plugin.name} fixture`,
  });
  return dir;
}

