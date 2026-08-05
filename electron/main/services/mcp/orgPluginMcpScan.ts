/**
 * Residual enterprise org-plugin MCP scan (app.asar index.js oce / By / gnA / SRA / nai / w1e).
 *
 * - Path: darwin `/Library/Application Support/Claude/org-plugins`
 *         win32 `C:\Program Files\Claude\org-plugins`
 * - Gate: residual R1(vi()) ≡ UV(cHe(raw)) — credentials on **snap.raw**
 *         (inferenceProvider primary; never invent from thin config surface)
 * - enabledPlugins via residual eFA: readCoworkEnabledPluginsMap / cowork_settings
 * - Parse http/sse URL configs; skip mcpb/dxt
 *
 * data-official-source: app.asar index.js oce / By / Hp / eFA / cHe
 */
import fs from "node:fs/promises";
import path from "node:path";
import { loadCoworkEnterpriseConfig } from "../coworkHostLoop/coworkEnterpriseConfig";
import { readCoworkEnabledPluginsMap } from "../coworkSessions/coworkReadOnlyPluginPaths";
import { pluginCollectAccountPairs } from "../plugins/localPluginsWriter";

export const ORG_PROVISIONED_SUFFIX = "org-provisioned" as const;
const LOG_TAG = "[custom3p-mcp:plugin]";

export type OrgPluginMcpDescriptor = {
  name: string;
  url: string;
  transport?: string;
  headers?: Record<string, string>;
  oauth?: unknown;
  source: "org-plugin";
};

export type OrgPluginScanContext = {
  accountId?: string;
  orgId?: string;
  /** Injectable enabledPlugins bag (tests). Residual: cowork_settings.json. */
  enabledPlugins?: Record<string, unknown>;
  /** Injectable enterprise gate. Residual: R1(vi()). */
  enterpriseActive?: boolean;
  /** Injectable org-plugins root. */
  orgPluginsRoot?: string | null;
};

/** Residual By() — platform org-plugins dir, gated by enterprise. */
export function resolveOrgPluginsRoot(
  platform: NodeJS.Platform = process.platform,
  enterpriseActive = isEnterpriseConfigActive(),
): string | null {
  if (!enterpriseActive) return null;
  switch (platform) {
    case "darwin":
      return "/Library/Application Support/Claude/org-plugins";
    case "win32":
      return path.join("C:\\Program Files", "Claude", "org-plugins");
    default:
      return null;
  }
}

/**
 * Residual Hzt / cHe gate on enterprise **raw** bag (not thin snap.config).
 * Primary: inferenceProvider non-empty string. Secondary product residual:
 * bootstrapUrl present and not disabled. Never invent true from empty.
 */
export function hasEnterpriseCredentials(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const bag = raw as Record<string, unknown>;
  if (typeof bag.inferenceProvider === "string" && bag.inferenceProvider.length > 0) {
    return true;
  }
  if (
    typeof bag.bootstrapUrl === "string" &&
    bag.bootstrapUrl.length > 0 &&
    bag.bootstrapEnabled !== false
  ) {
    return true;
  }
  return false;
}

/**
 * Residual R1(vi()) — enterprise credentials present on snap.raw.
 */
export function isEnterpriseConfigActive(): boolean {
  try {
    const snap = loadCoworkEnterpriseConfig();
    return hasEnterpriseCredentials(snap.raw);
  } catch {
    return false;
  }
}

/** Residual nai — normalize oauth bag. */
export function normalizePluginOAuth(oauth: unknown): unknown {
  if (oauth == null) return undefined;
  if (typeof oauth !== "object") return true;
  const bag = oauth as Record<string, unknown>;
  const clientId =
    typeof bag.clientId === "string" && bag.clientId.length > 0
      ? bag.clientId
      : undefined;
  if (!clientId) return true;
  const scopeRaw = bag.scope ?? bag.scopes;
  const scope =
    typeof scopeRaw === "string"
      ? scopeRaw || undefined
      : Array.isArray(scopeRaw)
        ? scopeRaw.filter((s): s is string => typeof s === "string").join(" ") ||
          undefined
        : undefined;
  const tenantId =
    typeof bag.tenantId === "string" && scope !== undefined
      ? bag.tenantId
      : undefined;
  return {
    clientId,
    ...(tenantId ? { tenantId } : {}),
    ...(scope ? { scope } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const bag = asRecord(value);
  const entries = Object.entries(bag).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isMcpbPath(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith(".dxt") || lower.endsWith(".mcpb");
}

/** Residual w1e-ish parse: only http/sse URL remotes. */
export function parseHttpSseMcpConfig(
  name: string,
  config: unknown,
): OrgPluginMcpDescriptor | null {
  const bag = asRecord(config);
  const nested = asRecord(bag.config);
  const merged = { ...bag, ...nested };
  const type = asString(merged.type) ?? asString(merged.transport);
  const url = asString(merged.url);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  // Residual w1e type enum http|sse — accept missing as http default.
  if (type && type !== "http" && type !== "sse") return null;
  if (merged.oauth && (merged.headers || merged.headersHelper)) {
    // Mutual exclusion residual.
    return null;
  }
  return {
    name,
    url,
    transport: type === "sse" ? "sse" : type === "http" ? "http" : undefined,
    headers: stringRecord(merged.headers),
    oauth: normalizePluginOAuth(merged.oauth),
    source: "org-plugin",
  };
}

function extractMcpEntries(
  raw: unknown,
): Array<{ name: string; config: unknown }> {
  if (!raw || typeof raw !== "object") return [];
  const bag = raw as Record<string, unknown>;
  if (bag.mcpServers && typeof bag.mcpServers === "object" && !Array.isArray(bag.mcpServers)) {
    return Object.entries(bag.mcpServers as Record<string, unknown>).map(
      ([name, config]) => ({ name, config }),
    );
  }
  return Object.entries(bag).map(([name, config]) => ({ name, config }));
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Residual Vb-ish: resolved path must stay under plugin root. */
function isPathInsidePluginRoot(pluginRoot: string, candidate: string): boolean {
  const root = path.resolve(pluginRoot);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(root + path.sep);
}

async function collectHttpEntriesFromJson(
  json: unknown,
  out: Array<OrgPluginMcpDescriptor & { isMcpb?: boolean }>,
): Promise<void> {
  for (const entry of extractMcpEntries(json)) {
    if (
      isMcpbPath(entry.name) ||
      (typeof entry.config === "string" && isMcpbPath(entry.config))
    ) {
      continue;
    }
    const parsed = parseHttpSseMcpConfig(entry.name, entry.config);
    if (parsed) out.push(parsed);
  }
}

/**
 * Residual SRA subset — scan plugin dir for .mcp.json / named json files with URL remotes.
 * Portable adds: .claude-plugin/plugin.json + relative nested mcpServers paths (no mcpb invent).
 */
export async function scanPluginDirForMcp(
  pluginDir: string,
  pluginName: string,
): Promise<Array<OrgPluginMcpDescriptor & { isMcpb?: boolean }>> {
  const out: Array<OrgPluginMcpDescriptor & { isMcpb?: boolean }> = [];
  const candidates = [".mcp.json", "mcp.json", "mcp_servers.json"];
  const visited = new Set<string>();

  async function scanJsonFile(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    if (visited.has(resolved)) return;
    if (!isPathInsidePluginRoot(pluginDir, resolved)) return;
    visited.add(resolved);
    const json = await readJsonFile(resolved);
    if (!json) return;
    await collectHttpEntriesFromJson(json, out);
  }

  for (const rel of candidates) {
    await scanJsonFile(path.join(pluginDir, rel));
  }

  // Residual EI: plugin.json under root or .claude-plugin/
  const manifests = [
    path.join(pluginDir, ".claude-plugin", "plugin.json"),
    path.join(pluginDir, "plugin.json"),
    path.join(pluginDir, "manifest.json"),
  ];
  for (const manifestPath of manifests) {
    const manifest = await readJsonFile(manifestPath);
    if (!manifest || typeof manifest !== "object") continue;
    const mcpServers = (manifest as { mcpServers?: unknown }).mcpServers;
    if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
      continue;
    }
    for (const [name, config] of Object.entries(
      mcpServers as Record<string, unknown>,
    )) {
      if (typeof config === "string") {
        if (isMcpbPath(config)) continue;
        // Relative local path → nested .mcp.json / dir inside plugin (portable residual).
        if (/^https?:\/\//i.test(config)) continue;
        const nested = path.resolve(pluginDir, config);
        if (!isPathInsidePluginRoot(pluginDir, nested)) {
          console.warn(
            `${LOG_TAG} nested mcp path escapes plugin root — skipped`,
            { plugin: pluginName, path: config },
          );
          continue;
        }
        try {
          const st = await fs.stat(nested);
          if (st.isDirectory()) {
            await scanJsonFile(path.join(nested, ".mcp.json"));
            await scanJsonFile(path.join(nested, "mcp.json"));
          } else if (st.isFile()) {
            await scanJsonFile(nested);
          }
        } catch {
          /* missing nested path */
        }
        continue;
      }
      const parsed = parseHttpSseMcpConfig(name, config);
      if (parsed) out.push(parsed);
    }
  }

  if (out.length === 0) {
    // Best-effort: list top-level json files that look like MCP configs.
    try {
      const names = await fs.readdir(pluginDir);
      for (const name of names) {
        if (!name.endsWith(".json") || name.startsWith(".")) continue;
        if (
          candidates.includes(name) ||
          name === "plugin.json" ||
          name === "manifest.json"
        ) {
          continue;
        }
        await scanJsonFile(path.join(pluginDir, name));
      }
    } catch {
      /* ignore */
    }
  }

  void pluginName;
  return out;
}

/** Residual gnA — resolve plugin directory entry (dir or symlink-to-dir). */
async function resolvePluginDir(
  root: string,
  dirent: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean },
): Promise<string | null> {
  if (dirent.name.startsWith(".")) return null;
  const full = path.join(root, dirent.name);
  if (dirent.isDirectory()) return full;
  if (!dirent.isSymbolicLink()) return null;
  try {
    const st = await fs.stat(full);
    if (st.isDirectory()) {
      console.debug(`${LOG_TAG} following symlinked plugin dir`, {
        name: dirent.name,
      });
      return full;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Residual oce — scan enabled org plugins for remote MCP descriptors.
 */
export async function scanOrgPluginMcpServers(
  ctx: OrgPluginScanContext = {},
): Promise<OrgPluginMcpDescriptor[]> {
  const enterpriseActive =
    ctx.enterpriseActive !== undefined
      ? ctx.enterpriseActive
      : isEnterpriseConfigActive();
  const root =
    ctx.orgPluginsRoot !== undefined
      ? ctx.orgPluginsRoot
      : resolveOrgPluginsRoot(process.platform, enterpriseActive);
  if (!root) return [];

  let entries: Array<{ name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      console.warn(`${LOG_TAG} failed to read ${root} — skipping`, { err });
    }
    return [];
  }

  const enabledPlugins = ctx.enabledPlugins ?? (await loadEnabledPlugins(ctx));
  const out: OrgPluginMcpDescriptor[] = [];

  for (const entry of entries) {
    const pluginDir = await resolvePluginDir(root, entry);
    if (!pluginDir) continue;
    const pluginName = entry.name;
    if (enabledPlugins[`${pluginName}@${ORG_PROVISIONED_SUFFIX}`] !== true) {
      continue;
    }
    let scanned: Array<OrgPluginMcpDescriptor & { isMcpb?: boolean }>;
    try {
      scanned = await scanPluginDirForMcp(pluginDir, pluginName);
    } catch (error) {
      console.warn(`${LOG_TAG} scan failed for ${pluginName} — skipping`, {
        error,
      });
      continue;
    }
    for (const item of scanned) {
      if (item.isMcpb) continue;
      out.push({
        name: item.name,
        url: item.url,
        transport: item.transport,
        headers: item.headers,
        oauth: item.oauth,
        source: "org-plugin",
      });
    }
  }
  return out;
}

/**
 * Residual eFA — enabledPlugins from cowork_settings.json via e4 paths.
 * Reuses readCoworkEnabledPluginsMap + pluginCollectAccountPairs (no invent uuids).
 */
async function loadEnabledPlugins(
  ctx: OrgPluginScanContext,
): Promise<Record<string, unknown>> {
  if (ctx.enabledPlugins) return ctx.enabledPlugins;
  try {
    const { app } = await import("electron");
    const userData = app.getPath("userData");
    if (ctx.accountId && ctx.orgId) {
      return readCoworkEnabledPluginsMap(userData, ctx.accountId, ctx.orgId);
    }
    const pairs = pluginCollectAccountPairs({});
    const merged: Record<string, unknown> = {};
    for (const pair of pairs) {
      Object.assign(
        merged,
        readCoworkEnabledPluginsMap(userData, pair.accountId, pair.orgId),
      );
    }
    return merged;
  } catch {
    return {};
  }
}

/** Residual JLA: drop headers/headersHelper when oauth present. */
function applyManagedOAuthExclusion<T extends {
  name: string;
  oauth?: unknown;
  headers?: Record<string, string>;
  headersHelper?: string;
  headersHelperTtlSec?: number;
}>(entry: T): T {
  if (!entry.oauth) return entry;
  if (!entry.headers && !entry.headersHelper) return entry;
  console.warn(
    `[custom3p-mcp] managed MCP "${entry.name}" — dropping headers/headersHelper (oauth exclusive, JLA)`,
  );
  const {
    headers: _h,
    headersHelper: _hh,
    headersHelperTtlSec: _ttl,
    ...rest
  } = entry;
  return rest as T;
}

/**
 * Residual mergePluginConfigs — mdm/managed first, drop plugin name collisions.
 */
export function mergePluginMcpConfigs<T extends { name: string }>(
  existing: readonly T[],
  plugins: readonly T[],
): T[] {
  const names = new Set(existing.map((e) => e.name));
  const merged = [...existing];
  for (const plugin of plugins) {
    if (names.has(plugin.name)) {
      console.warn(
        `[custom3p-mcp] plugin MCP "${plugin.name}" dropped — name collides with existing server`,
      );
      continue;
    }
    names.add(plugin.name);
    merged.push(plugin);
  }
  return merged;
}

export type ManagedMcpDescriptor = {
  name: string;
  url: string;
  transport?: string;
  headers?: Record<string, string>;
  oauth?: unknown;
  headersHelper?: string;
  headersHelperTtlSec?: number;
  source: "mdm";
  toolPolicy?: Record<string, string>;
};

/**
 * Parse residual cHe.mcpServers / enterprise managedMcpServers from a raw bag.
 * Applies JLA oauth vs headers/headersHelper exclusion.
 */
export function parseEnterpriseMcpServers(rawBag: unknown): ManagedMcpDescriptor[] {
  if (!rawBag) return [];
  const build = (
    name: string,
    bag: Record<string, unknown>,
  ): ManagedMcpDescriptor | null => {
    const url = asString(bag.url);
    if (!url || !/^https?:\/\//i.test(url)) return null;
    return applyManagedOAuthExclusion({
      name,
      url,
      transport: asString(bag.transport) ?? asString(bag.type),
      headers: stringRecord(bag.headers),
      oauth: bag.oauth,
      headersHelper: asString(bag.headersHelper),
      headersHelperTtlSec:
        typeof bag.headersHelperTtlSec === "number"
          ? bag.headersHelperTtlSec
          : undefined,
      source: "mdm" as const,
      toolPolicy: stringRecord(bag.toolPolicy),
    });
  };

  if (Array.isArray(rawBag)) {
    return rawBag
      .map((entry) => {
        const bag = asRecord(entry);
        const name = asString(bag.name);
        if (!name) return null;
        return build(name, bag);
      })
      .filter((x): x is ManagedMcpDescriptor => x !== null);
  }
  if (typeof rawBag === "object") {
    const out: ManagedMcpDescriptor[] = [];
    for (const [key, value] of Object.entries(rawBag as Record<string, unknown>)) {
      const bag = asRecord(value);
      const parsed = build(asString(bag.name) ?? key, bag);
      if (parsed) out.push(parsed);
    }
    return out;
  }
  return [];
}

/**
 * Residual managedMcpServers from enterprise **raw** bag (cHe.mcpServers).
 * Never reads thin snap.config — that surface only materializes require-full-vm.
 */
export function managedMcpServersFromEnterprise(): ManagedMcpDescriptor[] {
  try {
    const snap = loadCoworkEnterpriseConfig();
    return parseEnterpriseMcpServers(snap.raw?.managedMcpServers);
  } catch {
    return [];
  }
}
