/**
 * Official CCD `al()` residual (app.asar LocalSessionManager start/send):
 *
 *   async function al(forceReload=false) {
 *     const extensions = await e6e({forceReload});
 *     const desktop = await cnA() ? zo(forceReload).mcpServers || {} : {};
 *     return { ...extensions, ...desktop };
 *   }
 *   startSession({ mcpServers: await al(), ... })
 *
 * Product:
 *   - e6e = enabled DXT/mcpb extensions via bqt/YSA (desktopExtensionMcpResidual)
 *   - desktop bag = claude_desktop_config.json#mcpServers (InA / cnA gated)
 *   - merge enterprise managedMcpServers as HTTP remotes so Setup-configured
 *     URL MCP reaches Query options.mcpServers (product has no coordinator
 *     proxy; Agent SDK accepts type:http configs)
 */
import fs from "node:fs";
import path from "node:path";
import { getCoworkEnterpriseBoolean } from "../coworkHostLoop/coworkEnterpriseConfig";
import { managedMcpServersFromEnterprise } from "../mcp/orgPluginMcpScan";
import { resolveIsLocalDevMcpEnabled } from "../settings/localDevMcpPolicy";
import {
  readOfficialAppConfigFile,
  readOfficialMcpServersSegment,
  resolveOfficialAppConfigPath,
} from "../settings/officialConfigJson";
import { asMcpServerMap } from "./mcpConfigWire";
import { loadOfficialE6eMcpServers } from "../extensions/desktopExtensionMcpResidual";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type CodeDesktopMcpResidualDeps = {
  userDataPath?: string;
  getUserDataPath?: () => string | undefined;
  /** Inject desktop bag (tests). When omitted, read official config. */
  getDesktopMcpServers?: () => Record<string, unknown>;
  /** Inject InA (tests). */
  isLocalDevMcpEnabled?: boolean;
  /** Inject managed remotes (tests). */
  getManagedMcpServers?: () => Array<{ name: string; url: string; transport?: string }>;
  /** Inject e6e extension MCP map (tests). */
  getExtensionMcpServers?: () => Record<string, unknown>;
  /**
   * Official al() includes e6e. CCD startSession uses al(); Cowork createAllServers
   * does not. Default true (al()). Pass false for Cowork Query merge.
   */
  includeExtensionMcp?: boolean;
};

function resolveUserDataPath(deps: CodeDesktopMcpResidualDeps): string | undefined {
  if (typeof deps.userDataPath === "string" && deps.userDataPath.length > 0) {
    return deps.userDataPath;
  }
  const fromDeps = deps.getUserDataPath?.();
  if (fromDeps) return fromDeps;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronApp = require("electron").app as { getPath?: (name: string) => string };
    return electronApp.getPath?.("userData");
  } catch {
    return process.env.CLAUDE_USER_DATA_DIR || undefined;
  }
}

/** Official InA / cnA residual for CCD al(). */
export function resolveCodeLocalDevMcpEnabled(
  deps: CodeDesktopMcpResidualDeps = {},
): boolean {
  if (typeof deps.isLocalDevMcpEnabled === "boolean") return deps.isLocalDevMcpEnabled;
  const userDataPath = resolveUserDataPath(deps);
  let feature: unknown;
  if (userDataPath) {
    try {
      const cfg = readOfficialAppConfigFile(resolveOfficialAppConfigPath(userDataPath));
      const features = asRecord(cfg.features);
      feature = features.isLocalDevMcpEnabled;
    } catch {
      feature = undefined;
    }
  }
  return resolveIsLocalDevMcpEnabled({
    enterpriseIsLocalDevMcpEnabled: getCoworkEnterpriseBoolean("isLocalDevMcpEnabled"),
    featureIsLocalDevMcpEnabled: feature,
  });
}

/**
 * Official zo().mcpServers (+ product shell dual-read when official bag empty).
 */
export function readCodeDesktopMcpServers(
  deps: CodeDesktopMcpResidualDeps = {},
): Record<string, unknown> {
  if (deps.getDesktopMcpServers) return { ...deps.getDesktopMcpServers() };
  const userDataPath = resolveUserDataPath(deps);
  if (!userDataPath) return {};
  const official = readOfficialMcpServersSegment(
    resolveOfficialAppConfigPath(userDataPath),
  );
  if (Object.keys(official).length > 0) return official;
  try {
    const shellPath = path.join(userDataPath, "desktop-shell-settings.json");
    if (!fs.existsSync(shellPath)) return {};
    const raw = JSON.parse(fs.readFileSync(shellPath, "utf8")) as unknown;
    const bag = asRecord(asRecord(raw).mcpServersConfig);
    return Object.keys(bag).length > 0 ? bag : {};
  } catch {
    return {};
  }
}

/** Official al() = e6e() + (cnA() ? zo().mcpServers : {}). */
export function loadOfficialAlMcpServers(
  deps: CodeDesktopMcpResidualDeps = {},
): Record<string, unknown> {
  const extensions =
    deps.includeExtensionMcp === false
      ? {}
      : deps.getExtensionMcpServers
        ? { ...deps.getExtensionMcpServers() }
        : loadOfficialE6eMcpServers({ userDataPath: resolveUserDataPath(deps) });
  const desktop = resolveCodeLocalDevMcpEnabled(deps)
    ? asMcpServerMap(readCodeDesktopMcpServers(deps))
    : {};
  return { ...extensions, ...desktop };
}

/**
 * Enterprise / Setup managed remotes as Agent SDK HTTP mcpServers entries.
 */
export function loadManagedMcpServersAsSdkMap(
  deps: CodeDesktopMcpResidualDeps = {},
): Record<string, unknown> {
  const list = deps.getManagedMcpServers
    ? deps.getManagedMcpServers()
    : managedMcpServersFromEnterprise();
  const out: Record<string, unknown> = {};
  for (const entry of list) {
    if (!entry?.name || !entry?.url) continue;
    const transport = entry.transport === "sse" ? "sse" : "http";
    out[entry.name] = {
      type: transport,
      url: entry.url,
    };
  }
  return out;
}

/**
 * CCD Query / CLI --mcp-config merge:
 *   al() desktop bag + managed HTTP remotes, then session/request overlay, then preview.
 */
export function mergeCodeQueryMcpServers(input: {
  sessionMcp?: unknown;
  requestMcp?: unknown;
  previewMcp?: unknown;
  remoteMcp?: unknown;
  deps?: CodeDesktopMcpResidualDeps;
}): Record<string, unknown> {
  const deps = input.deps ?? {};
  return {
    ...loadOfficialAlMcpServers(deps),
    ...loadManagedMcpServersAsSdkMap(deps),
    ...asMcpServerMap(input.requestMcp ?? input.sessionMcp),
    ...asMcpServerMap(input.previewMcp),
    ...asMcpServerMap(input.remoteMcp),
  };
}
