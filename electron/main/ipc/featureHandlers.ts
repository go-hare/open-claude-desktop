import { app, BrowserWindow, desktopCapturer, dialog, shell } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  installClaudeChromeExtension,
  isClaudeChromeExtensionInstalled,
  openChromeExtensionListing,
  restartChromeForExtension,
  syncClaudeChromeNativeHost,
} from "../services/chrome/chromeExtension";
import {
  ensureExtensionFolders,
  installDxtArchive,
  revealInstalledExtension,
} from "../services/extensions/desktopExtensions";
import { FeatureStateStore } from "../services/featureState/featureStateStore";
import { LocalLaunchManager } from "../services/launch/localLaunchManager";
import { LaunchPreviewViewManager } from "../services/launch/launchPreviewViewManager";
import {
  buildClaudePreviewCliMcpConfig,
  type ClaudePreviewMcpHost,
} from "../services/launch/claudePreviewMcpServer";
import {
  getClaudePreviewSessionCwd,
  registerClaudePreviewMcpHost,
  setClaudePreviewCliMcpConfigCache,
} from "../services/launch/claudePreviewHostRegistry";
import { getLocalSkillFiles, listLocalSkills } from "../services/localSessions/localAgentAssets";
import { mcpConfigEntries, requestMcpServer } from "../services/mcp/mcpRuntime";
import { listOpenDocuments, readOpenDocumentAsBase64 } from "../services/openDocuments/openDocumentsStore";
import {
  coworkAccountStorageDir,
  resolveCoworkAutoMemoryDir,
} from "../services/coworkSessions/coworkAutoMemoryPaths";
import {
  deleteAccountMemory as deleteCoworkAccountMemory,
  listAccountMemories as listCoworkAccountMemories,
  migrateLegacyMemoriesMap,
  readAccountMemory as readCoworkAccountMemory,
  readGlobalMemory as readCoworkGlobalMemory,
  resetMemories as resetCoworkMemories,
  writeAccountMemory as writeCoworkAccountMemory,
  writeGlobalMemory as writeCoworkGlobalMemory,
  type CoworkMemoryStoreDeps,
} from "../services/coworkSessions/coworkMemoryStore";
import { getCoworkClaudeVmService } from "../services/coworkVm/coworkClaudeVm";
import { getHardwareBuddyService } from "../services/buddy/hardwareBuddyService";
import {
  addLocalDirectoryMarketplace,
  installPluginByIdFromDisk,
  installPluginFromDirectory,
  installPluginFromZip,
  listAvailableLocalMarketplacePlugins,
  listInstalledPluginsFromDisk,
  listKnownMarketplaces,
  refreshKnownMarketplace,
  removeKnownMarketplace,
  resolveLocalMarketplaceInput,
  resolveLocalPluginsPaths,
  resolvePluginsAccountCtx,
  setPluginEnabledOnDisk,
  uninstallPluginFromDisk,
  type LocalPluginsPathBag,
} from "../services/plugins/localPluginsWriter";
import { getComputerUseTccState, openTccSystemSettings, requestAccessibilityGrant, requestScreenRecordingGrant } from "../services/tcc/computerUseTcc";
import { createCoworkHostLoopModeResolver } from "../services/coworkHostLoop/createCoworkHostLoopModeResolver";
import { isCoworkHostLoopGrowthBookFeatureEnabled } from "../services/coworkHostLoop/coworkGrowthBookFeatures";
import {
  resolveCoworkRequireFullVmSandbox,
} from "../services/coworkHostLoop/coworkHostLoopMode";
import { isCoworkEnterpriseRequireFullVmSandbox } from "../services/coworkHostLoop/coworkEnterpriseConfig";
import { restoreCoworkArtifactVersionLocal } from "../services/coworkRuntime/coworkArtifactLocalStore";
import {
  listOfficialArtifactsOnDisk,
  normalizeCoworkArtifactRecord,
  resolveCoworkArtifactHostDir,
  resolveOfficialArtifactsRoot,
} from "../windows/coworkArtifactViewManager";
import type { IpcHandlerContext } from "./context";
import { originalEventSurface } from "./originalEventSurface";
import { dispatchBridgeEvent, registerInterfaceSyncHandlers, registerNamespaceHandlers } from "./registerIpc";
import { runScheduledTaskNow } from "./scheduledTasksHandlers";

const execFileAsync = promisify(execFile);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Official qsr — Spaces.readFileContents size cap (50 MiB). */
const SPACES_READ_FILE_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Official EAA — hide dotfiles / Office lock / tmp junk from Spaces.listFolderContents.
 */
function isHiddenSpaceListingName(name: string): boolean {
  return (
    name.startsWith(".") ||
    name.startsWith("~$") ||
    (name.startsWith("~") && name.endsWith(".tmp"))
  );
}

function spaceFolderPathsFromRecord(space: Record<string, unknown> | undefined): string[] {
  const folders = space && Array.isArray(space.folders) ? space.folders : [];
  return folders
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && typeof (entry as { path?: unknown }).path === "string") {
        return (entry as { path: string }).path;
      }
      return null;
    })
    .filter((folderPath): folderPath is string => Boolean(folderPath && folderPath.length > 0));
}

/**
 * Official emA(spaceId): space folder paths ∪ getAutoMemoryDir(spaceId).
 * Used as the allow-list root set for list/read/open.
 */
function spaceAllowedRootsForPathChecks(
  spaces: Map<string, Record<string, unknown>>,
  spaceId: string,
  autoMemoryDir: string | null,
): string[] {
  const roots = spaceFolderPathsFromRecord(spaces.get(spaceId));
  if (autoMemoryDir) roots.push(autoMemoryDir);
  return roots;
}

function isPathInsideAllowedRoots(targetPath: string, allowedRoots: string[]): boolean {
  const resolvedTarget = path.resolve(targetPath);
  for (const root of allowedRoots) {
    const resolvedRoot = path.resolve(root);
    if (resolvedTarget === resolvedRoot) return true;
    const relative = path.relative(resolvedRoot, resolvedTarget);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return true;
  }
  return false;
}

/**
 * Official whA-lite for Spaces list/read/open:
 * absolute path, inside space folders or auto-memory dir.
 */
async function resolveSpaceAccessiblePath(
  spaces: Map<string, Record<string, unknown>>,
  spaceId: string,
  rawPath: string,
  autoMemoryDir: string | null,
): Promise<string | null> {
  if (!path.isAbsolute(rawPath)) return null;
  if (!spaces.has(spaceId)) return null;
  const allowed = spaceAllowedRootsForPathChecks(spaces, spaceId, autoMemoryDir);
  if (allowed.length === 0) return null;
  if (!isPathInsideAllowedRoots(rawPath, allowed)) return null;
  try {
    // Prefer realpath when the path exists; fall back to resolved string for empty memory dirs.
    return await fs.realpath(rawPath);
  } catch {
    return path.resolve(rawPath);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function ok(payload: Record<string, unknown> = {}) {
  return { ok: true, ...payload };
}

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function configuredMcpServers(context: IpcHandlerContext): Array<[string, unknown]> {
  return mcpConfigEntries(context.settings.getMcpServersConfig());
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return null;
}

function parseMcpToolRequest(value: unknown) {
  const raw = asObject(value);
  const nestedTool = asObject(raw.tool);
  const source = Object.keys(nestedTool).length > 0 ? { ...raw, ...nestedTool } : raw;
  let serverName = firstString(source.serverName, source.server, source.mcpServer, source.mcpServerName);
  let toolName = firstString(source.toolName, source.name, source.id);
  const prefixed = toolName?.match(/^mcp__(.+?)__(.+)$/);
  if (prefixed?.[1] && prefixed[2]) {
    serverName ??= prefixed[1];
    toolName = prefixed[2];
  }
  return {
    serverName,
    toolName,
    input: source.input ?? source.arguments ?? source.args ?? source.parameters ?? source.params ?? {},
  };
}

function findMcpServer(context: IpcHandlerContext, requestedName: string | null) {
  const servers = configuredMcpServers(context);
  if (!requestedName && servers.length === 1) {
    const [name, config] = servers[0]!;
    return { name, config };
  }
  const match = requestedName
    ? servers.find(([name]) => name === requestedName) ?? servers.find(([name]) => name.toLowerCase() === requestedName.toLowerCase())
    : null;
  return match ? { name: match[0], config: match[1] } : null;
}

async function runOptional(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

async function listSimulatorDevices(): Promise<Array<Record<string, unknown>>> {
  const devices: Array<Record<string, unknown>> = [];
  if (process.platform === "darwin") {
    const json = await runOptional("xcrun", ["simctl", "list", "devices", "--json"]);
    let parsed: { devices?: Record<string, Array<Record<string, unknown>>> } | null = null;
    try {
      parsed = json ? JSON.parse(json) as { devices?: Record<string, Array<Record<string, unknown>>> } : null;
    } catch {
      parsed = null;
    }
    for (const [runtime, items] of Object.entries(parsed?.devices ?? {})) {
      for (const item of items) {
        devices.push({ ...item, runtime, platform: "ios", source: "xcrun" });
      }
    }
  }

  const avds = await runOptional("emulator", ["-list-avds"]);
  for (const name of (avds ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    devices.push({ id: `android-avd:${name}`, name, platform: "android", state: "available", source: "emulator" });
  }

  const adb = await runOptional("adb", ["devices", "-l"]);
  for (const line of (adb ?? "").split(/\r?\n/).slice(1)) {
    const [serial, state, ...rest] = line.trim().split(/\s+/);
    if (!serial || !state) continue;
    devices.push({ id: `adb:${serial}`, name: serial, platform: "android", state, details: rest.join(" "), source: "adb" });
  }

  return devices;
}

function pluginShimOps(plugins: Array<Record<string, unknown>>) {
  return plugins.flatMap((plugin) => {
    const manifest = asObject(plugin.manifest ?? asObject(plugin.plugin).manifest ?? plugin.plugin);
    const server = asObject(manifest.server);
    const mcpConfig = asObject(server.mcp_config ?? manifest.mcp_config);
    const ops: Array<Record<string, unknown>> = [];
    if (Object.keys(mcpConfig).length > 0) {
      ops.push({ id: `${String(plugin.id)}:mcp`, pluginId: plugin.id, kind: "mcp", status: "configured", config: mcpConfig });
    }
    const entryPoint = asString(server.entry_point) ?? asString(server.entryPoint);
    if (entryPoint) {
      ops.push({ id: `${String(plugin.id)}:server`, pluginId: plugin.id, kind: "server", status: "available", entryPoint, runtime: server.type ?? "node" });
    }
    return ops;
  });
}

async function captureUrlScreenshot(url: string, options: unknown): Promise<string> {
  const raw = asObject(options);
  const width = Number(raw.width) || 1280;
  const height = Number(raw.height) || 800;
  const window = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true } });
  try {
    await window.loadURL(url);
    await new Promise((resolve) => setTimeout(resolve, Number(raw.settleMs) || 500));
    return window.webContents.capturePage().then((image) => image.toDataURL());
  } finally {
    window.close();
  }
}

async function listApplications(): Promise<Array<{ name: string; path: string }>> {
  const roots = ["/Applications", path.join(app.getPath("home"), "Applications")];
  const apps: Array<{ name: string; path: string }> = [];
  for (const root of roots) {
    try {
      for (const entry of await fs.readdir(root)) {
        if (entry.endsWith(".app")) apps.push({ name: entry.replace(/\.app$/, ""), path: path.join(root, entry) });
      }
    } catch {
      // ignore missing app folders
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

/** Residual space folders are objects with `.path` (ce283 `r.map(e=>e.path)`). */
function normalizeSpaceFolderEntry(value: unknown): unknown {
  if (typeof value === "string" && value.length > 0) return { path: value };
  const record = asObject(value);
  const folderPath = asString(record.path) ?? asString(record.folderPath) ?? asString(record.folder);
  if (folderPath) return { ...record, path: folderPath };
  return value;
}

function spaceListItemKey(value: unknown): string {
  const normalized = normalizeSpaceFolderEntry(value);
  const record = asObject(normalized);
  return asString(record.path) ?? asString(record.uuid) ?? asString(record.id) ?? JSON.stringify(normalized);
}

async function updateSpaceList(
  spaces: Map<string, Record<string, unknown>>,
  persist: () => void,
  spaceId: string,
  key: "folders" | "links" | "projects",
  value: unknown,
  add: boolean,
): Promise<Record<string, unknown>> {
  const existing = spaces.get(spaceId) ?? { id: spaceId, createdAt: new Date().toISOString() };
  const list = Array.isArray(existing[key]) ? [...existing[key] as unknown[]] : [];
  const entry = key === "folders" ? normalizeSpaceFolderEntry(value) : value;
  const valueKey = spaceListItemKey(entry);
  const next = add
    ? [...list.filter((item) => spaceListItemKey(item) !== valueKey), entry]
    : list.filter((item) => spaceListItemKey(item) !== valueKey);
  const updated = { ...existing, [key]: next, updatedAt: new Date().toISOString() };
  spaces.set(spaceId, updated);
  persist();
  return updated;
}

export function registerFeatureHandlers(context: IpcHandlerContext): void {
  const events = originalEventSurface(context);
  const featureState = new FeatureStateStore();
  const launch = new LocalLaunchManager();
  // Official gi("launchEnabled"): SSA default true; only explicit false disables.
  // Manager-level gate covers startFromConfig / startCommand / restart (tool path).
  launch.setLaunchEnabledReader(
    () => context.settings.getPreferences().launchEnabled !== false,
  );
  // Official gi("launchPreviewPersistSession") + launchPreviewPersistedWorkspaces residual.
  const previewPersistStore = {
    getPersistedWorkspaces: () => {
      const raw = context.settings.getPreferences().launchPreviewPersistedWorkspaces;
      return Array.isArray(raw)
        ? raw.filter((item): item is string => typeof item === "string")
        : [];
    },
    setPersistedWorkspaces: (keys: string[]) => {
      context.settings.setPreference("launchPreviewPersistedWorkspaces", keys);
    },
  };
  launch.setPreviewPersistAccess({
    isPersistEnabled: () =>
      context.settings.getPreferences().launchPreviewPersistSession === true,
    store: previewPersistStore,
  });
  /**
   * Official Launch Preview WebContentsView residual (w5e / showPreview):
   * host-owned overlay over mainWindow.contentView; partition from launchPreviewPersist.
   */
  const previewViews = new LaunchPreviewViewManager({
    getMainWindow: () => context.windows.mainWindow,
    getMainWebContents: () => context.windows.mainView?.webContents,
    isPersistEnabled: () =>
      context.settings.getPreferences().launchPreviewPersistSession === true,
    persistStore: previewPersistStore,
    // Official DMA residual — Launch.elementSelected for select-element mode.
    onElementSelected: (serverId, elementContext) => {
      events.launchElementSelected(serverId, elementContext);
    },
    log: (...args) => {
      try {
        console.info(...args);
      } catch {
        /* ignore */
      }
    },
  });
  const ensurePreviewContext = (serverId: string | null | undefined): void => {
    if (!serverId) return;
    const server = launch.getServer(serverId);
    if (!server) return;
    if (previewViews.has(serverId)) return;
    previewViews.ensureContext({
      serverId,
      port: server.port,
      cwd: server.cwd,
      initialUrl: launch.getPreviewUrl(serverId) ?? undefined,
    });
  };
  /**
   * Official Claude Preview MCP host residual (voA / KOi / InternalMcp):
   * register Launch + preview view managers for Code CLI HTTP bridge + tool dispatch.
   */
  const claudePreviewHost: ClaudePreviewMcpHost = {
    launch,
    previewViews,
    isLaunchEnabled: () => launch.isEnabled(),
    ensurePreviewContext: (serverId) => ensurePreviewContext(serverId),
    isSSH: () => false,
  };
  registerClaudePreviewMcpHost(claudePreviewHost);
  void buildClaudePreviewCliMcpConfig({
    host: claudePreviewHost,
    getSessionCwd: () => getClaudePreviewSessionCwd(),
    isSSH: false,
  })
    .then((config) => {
      setClaudePreviewCliMcpConfigCache(config);
    })
    .catch(() => {
      setClaudePreviewCliMcpConfigCache(null);
    });
  const spaces = featureState.loadMap<Record<string, unknown>>("spaces");
  const artifacts = featureState.loadMap<Record<string, unknown>>("artifacts");
  // Legacy featureState memories map — migrate once into official on-disk residual.
  const legacyMemories = featureState.loadMap<string>("memories");
  const orbitDeploys = featureState.loadMap<Record<string, unknown>>("orbitDeploys");
  // Legacy in-memory maps kept as fallback when account/org identity is absent.
  // Prefer official on-disk residual (TGi / known_marketplaces / installed_plugins).
  const customMarketplaces = featureState.loadMap<Record<string, unknown>>("customMarketplaces");
  const localPlugins = featureState.loadMap<Record<string, unknown>>("localPlugins");
  const vmStateMap = featureState.loadMap<Record<string, unknown>>("vmState");
  const persistSpaces = () => featureState.saveMap("spaces", spaces);
  /**
   * Official Spaces.getAutoMemoryDir(spaceId) / ZrA residual:
   * known space + account/org identity → userData/local-agent-mode-sessions/.../spaces/<id>/memory
   */
  const resolveSpaceAutoMemoryDir = (spaceId: string): string | null => {
    if (!spaceId || !spaces.has(spaceId)) return null;
    const identity = context.coworkAccount.getIdentity();
    if (!identity?.accountUuid || !identity?.organizationUuid) return null;
    return resolveCoworkAutoMemoryDir(
      coworkAccountStorageDir(
        app.getPath("userData"),
        identity.accountUuid,
        identity.organizationUuid,
      ),
      { spaceId },
    );
  };
  /**
   * Official CoworkMemory n() residual: accountUuid + orgUuid or null.
   * Does not invent local-desktop fallback (official returns null without identity).
   */
  const resolveCoworkMemoryIdentity = async () => {
    let identity = context.coworkAccount.getIdentity();
    if (!identity?.accountUuid || !identity?.organizationUuid) {
      identity = await context.coworkAccount.waitForIdentity(2_000);
    }
    if (!identity?.accountUuid || !identity?.organizationUuid) return null;
    return {
      accountId: identity.accountUuid,
      orgId: identity.organizationUuid,
    };
  };
  const coworkMemoryDeps = (): CoworkMemoryStoreDeps => ({
    userDataPath: app.getPath("userData"),
    resolveIdentity: resolveCoworkMemoryIdentity,
    log: console,
  });
  let legacyMemoryMigration: Promise<void> | null = null;
  const ensureLegacyMemoryMigrated = () => {
    if (!legacyMemoryMigration) {
      legacyMemoryMigration = migrateLegacyMemoriesMap(
        coworkMemoryDeps(),
        legacyMemories,
      )
        .then((result) => {
          if (result.migratedGlobal || result.migratedAccount > 0) {
            legacyMemories.clear();
            featureState.saveMap("memories", legacyMemories);
            console.info(
              "[CoworkMemory] migrated legacy map global=%s account=%s",
              result.migratedGlobal,
              result.migratedAccount,
            );
          }
        })
        .catch((error) => {
          console.warn("[CoworkMemory] legacy migrate failed", error);
        });
    }
    return legacyMemoryMigration;
  };
  const persistArtifacts = () => featureState.saveMap("artifacts", artifacts);
  const persistOrbitDeploys = () => featureState.saveMap("orbitDeploys", orbitDeploys);
  const persistCustomMarketplaces = () => featureState.saveMap("customMarketplaces", customMarketplaces);
  const persistLocalPlugins = () => featureState.saveMap("localPlugins", localPlugins);
  const persistVmState = () => featureState.saveMap("vmState", vmStateMap);

  /**
   * Always resolves disk layout (identity or local-desktop fallback).
   * Installs must write installed_plugins.json so sessions can load plugins.
   */
  const resolvePluginPaths = (): LocalPluginsPathBag => {
    const identity = context.coworkAccount.getIdentity();
    const ctx = resolvePluginsAccountCtx({ identity })!;
    return resolveLocalPluginsPaths(app.getPath("userData"), ctx);
  };

  const installedPlugins = (): Array<Record<string, unknown>> => {
    const paths = resolvePluginPaths();
    const fromDisk = listInstalledPluginsFromDisk(paths).map((plugin) => ({
      ...plugin,
      path: plugin.installPath,
      plugin: { name: plugin.name, version: plugin.version },
    }));
    // Merge any pre-residual memory-only entries that still have a live path.
    const fromMemory = Array.from(localPlugins.values()).filter((plugin) => {
      const id = String(plugin.id ?? "");
      return id && !fromDisk.some((d) => String(d.id) === id);
    });
    return [...fromDisk, ...fromMemory];
  };
  const marketplacePlugins = (): Array<Record<string, unknown>> => {
    const paths = resolvePluginPaths();
    const fromDisk = listAvailableLocalMarketplacePlugins(paths);
    const fromMemory = Array.from(customMarketplaces.values()).map(
      (marketplace) => ({
        ...marketplace,
        source: "marketplace",
      }),
    );
    // Prefer disk entries; keep memory-only marketplaces as residual.
    const diskIds = new Set(fromDisk.map((p) => String(p.id)));
    return [
      ...fromDisk,
      ...fromMemory.filter((m) => !diskIds.has(String(m.id))),
    ];
  };
  const cachedCommands = async () => [
    ...(await listLocalSkills()).map((skill) => ({
      id: `skill:${String(skill.id)}`,
      name: String(skill.name ?? skill.title ?? skill.id),
      description: String(skill.description ?? ""),
      source: "skill",
      path: skill.path,
    })),
    ...installedPlugins().map((plugin) => ({
      id: `plugin:${String(plugin.id)}`,
      name: String(plugin.name ?? asObject(plugin.plugin).name ?? plugin.id),
      description: String(plugin.description ?? asObject(plugin.plugin).description ?? ""),
      source: "plugin",
      pluginId: plugin.id,
    })),
  ];
  let simulatorAttachment: unknown = null;
  let framebufferSource: Record<string, unknown> | null = null;
  let activeOfficeFileId: string | null = null;
  let miniExpanded = false;
  let grandPrixPaired = false;
  let previewUrl: string | null = null;
  const localSessions = () => [
    ...context.localSessions.getAll(true).map((session) => ({
      cwd: session.cwd ?? session.folders?.[0] ?? session.userSelectedFolders?.[0],
      kind: session.kind,
      sessionId: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
    })),
    ...context.localAgentModeSessions.getAll().map((session) => ({
      cwd: session.cwd ?? session.userSelectedFolders[0],
      kind: "epitaxy",
      sessionId: session.sessionId,
      title: session.title,
      updatedAt: new Date(session.lastActivityAt).toISOString(),
    })),
  ];
  context.windows.coworkFilePreview.setSessionRootsResolver((sessionId) => {
    const local = context.localSessions.getSession(sessionId);
    if (local) {
      return [
        local.cwd,
        ...(local.folders ?? []),
        ...(local.trustedFolders ?? []),
        ...(local.userSelectedFolders ?? []),
        ...(local.mountedProjects ?? []).map((project) => project.hostPath),
      ].filter((root): root is string => typeof root === "string" && root.length > 0);
    }
    const cowork = context.localAgentModeSessions.getSession(sessionId);
    if (!cowork) return [];
    return [
      cowork.cwd,
      ...cowork.userSelectedFolders,
      ...(cowork.mountedProjects ?? []).map((project) => project.hostPath),
    ].filter((root): root is string => typeof root === "string" && root.length > 0);
  });
  const rememberPreview = (result: { serverId?: string; error?: string }) => {
    if (result.serverId) {
      // Official D5e residual: ensure WebContentsView context on start.
      ensurePreviewContext(result.serverId);
      previewUrl = launch.getPreviewUrl(result.serverId);
      if (previewUrl) events.launchPreviewUrlChanged(result.serverId, previewUrl);
      events.launchActiveServersUpdated(launch.getActiveServers());
    }
    return result;
  };
  const classifyLocalSessions = () => localSessions().map((session) => {
    const cwd = session.cwd;
    const space = cwd ? Array.from(spaces.values()).find((candidate) => {
      const folders = Array.isArray(candidate.folders) ? candidate.folders.filter((item): item is string => typeof item === "string") : [];
      return folders.some((folder) => pathContains(folder, cwd));
    }) : null;
    return {
      sessionId: session.sessionId,
      title: session.title,
      cwd,
      kind: session.kind,
      updatedAt: session.updatedAt,
      spaceId: space?.id ?? null,
      spaceName: space?.name ?? space?.title ?? null,
    };
  });
  const connectedOfficeFiles = () => listOpenDocuments().map((document) => ({ ...document, active: document.id === activeOfficeFileId }));
  const officeFilesState = () => {
    const files = connectedOfficeFiles();
    const activeFile = files.find((file) => file.id === activeOfficeFileId) ?? files[0] ?? null;
    return { files, activeFile };
  };
  const coworkVm = getCoworkClaudeVmService();
  const vmStateFromSnapshot = (snap: Awaited<ReturnType<typeof coworkVm.snapshot>>) => ({
    downloadStatus: snap.downloadStatus,
    runningStatus: snap.runningStatus,
    mode: snap.mode,
    platform: snap.platform,
    updatedAt: snap.updatedAt,
    connected: snap.connected,
    running: snap.running,
    swiftLoaded: snap.swiftLoaded,
    bundleReady: snap.bundleReady,
    bundlePath: snap.bundlePath,
    smolBinPath: snap.smolBinPath,
    error: snap.error,
  });
  const setVmRuntime = (status: string, extra: Record<string, unknown> = {}) => {
    const next = {
      status,
      mode: extra.mode ?? "vm",
      updatedAt: new Date().toISOString(),
      ...extra,
    };
    vmStateMap.set("runtime", next);
    persistVmState();
    return next;
  };

  // Official Buddy residual (validators Trr/brr/Vrt/Orr in app.asar):
  // status → {connected, error, paired:{id,name}|null}
  // deviceStatus → null | {name, owner?, sec?, bat, sys, stats}
  // pairDevice() → boolean; pickDevice(id) → boolean; setName → boolean
  // scanDevices → {id,name}[]; preview(folder) → gif|text|null; install(folder) throws + progress
  const buddy = getHardwareBuddyService();
  buddy.setProgressSink((msg) => events.buddyProgress(msg));
  buddy.setPairingPromptSink((deviceName) => events.buddyPairingPrompt(deviceName));

  registerNamespaceHandlers("claude.buddy", {
    Buddy: {
      status: async () => buddy.status(),
      deviceStatus: async () => buddy.deviceStatus(),
      setName: async (_event, name) => buddy.setName(String(name ?? "")),
      // Official: pairDevice has zero args (reconnect).
      pairDevice: async () => buddy.pairDevice(),
      scanDevices: async () => buddy.scanDevices(),
      // Official: pickDevice(id: string) → boolean
      pickDevice: async (_event, deviceId) => buddy.pickDevice(String(deviceId ?? "")),
      cancelScan: async () => {
        await buddy.cancelScan();
      },
      // Official: submitPin(pin: string|null) → void
      submitPin: async (_event, pin) => {
        await buddy.submitPin(pin === null || pin === undefined ? null : String(pin));
      },
      forgetDevice: async () => {
        await buddy.forgetDevice();
      },
      pickFolder: async () => {
        const buddyWin = context.windows.secondaryWindows.getWindow("buddy");
        return buddy.pickFolder(buddyWin ?? context.windows.mainWindow);
      },
      // Official: preview(folderPath: string)
      preview: async (_event, folderPath) => {
        if (typeof folderPath !== "string" || !folderPath) return null;
        return buddy.preview(folderPath);
      },
      // Official: install(folderPath: string) — void, progress via Buddy.progress events
      install: async (_event, folderPath) => {
        if (typeof folderPath !== "string" || !folderPath) {
          throw new Error("folderPath required");
        }
        await buddy.install(folderPath);
      },
    },
    BuddyBleTransport: {
      rx: async (_event, payload) => buddy.bleRx(payload),
      reportState: async (_event, state, _details) => {
        const result = await buddy.reportBleState(state);
        // Official: main may also push tx frames to the transport side.
        events.buddyBleTx(String(state ?? ""));
        return result;
      },
      log: async (_event, message) => {
        console.log(`[buddy] ${String(message ?? "")}`);
        return true;
      },
    },
  });

  registerNamespaceHandlers("claude.simulator", {
    Simulator: {
      listDevices: async () => listSimulatorDevices(),
      installAndLaunch: async (_event, options) => {
        simulatorAttachment = { id: "local-simulator", status: "running", launchedAt: new Date().toISOString(), options };
        events.simulatorAttachmentUpdated(simulatorAttachment);
        return simulatorAttachment;
      },
      attach: async (_event, device) => {
        simulatorAttachment = device ?? { attachedAt: new Date().toISOString() };
        events.simulatorAttachmentUpdated(simulatorAttachment);
        return simulatorAttachment;
      },
      detach: async () => {
        simulatorAttachment = null;
        events.simulatorAttachmentUpdated(simulatorAttachment);
        return true;
      },
      gesture: async (_event, gesture) => ok({ gesture }),
      attachment_$store$_getState: async () => simulatorAttachment,
    },
  });

  registerNamespaceHandlers("claude.officeAddin", {
    OfficeAddinFiles: {
      connectedFilesState_$store$_getState: async () => officeFilesState(),
      getConnectedFiles: async () => connectedOfficeFiles(),
      isFeatureEnabled: async () => true,
      focusFile: async (_event, fileIdOrPath) => {
        const file = connectedOfficeFiles().find((item) => item.id === fileIdOrPath || item.path === fileIdOrPath);
        if (!file) return false;
        activeOfficeFileId = file.id;
        events.officeFileStateChanged({ ...file, active: true });
        events.officeConnectedFilesStateUpdated(officeFilesState());
        shell.showItemInFolder(file.path);
        return true;
      },
      selectFile: async (_event, fileIdOrPath) => {
        const file = connectedOfficeFiles().find((item) => item.id === fileIdOrPath || item.path === fileIdOrPath) ?? null;
        activeOfficeFileId = file?.id ?? activeOfficeFileId;
        if (file) events.officeFileStateChanged({ ...file, active: true });
        events.officeConnectedFilesStateUpdated(officeFilesState());
        return file;
      },
      updateActiveConversationSummary: async () => true,
    },
  });

  registerNamespaceHandlers("claude.coworkArtifact", {
    CoworkArtifactBridge: {
      askClaude: async (_event, prompt) => ({ ok: true, response: String(prompt ?? ""), localOnly: true }),
      callMcpTool: async (_event, tool) => {
        const request = parseMcpToolRequest(tool);
        const server = findMcpServer(context, request.serverName);
        if (!server) return { ok: false, error: "mcp_server_not_configured", serverName: request.serverName };
        if (!request.toolName) return { ok: false, error: "missing_mcp_tool_name", serverName: server.name };
        return requestMcpServer({
          serverName: server.name,
          config: server.config,
          method: "tools/call",
          params: { name: request.toolName, arguments: asObject(request.input) },
        });
      },
      navigateHost: async (_event, url) => {
        const target = asString(url) ?? asString(asObject(url).url);
        if (target) await context.windows.mainView.webContents.loadURL(target);
        return Boolean(target);
      },
      openExternalUrl: async (_event, url) => {
        const target = asString(url) ?? asString(asObject(url).url);
        if (!target) return false;
        await shell.openExternal(target);
        return true;
      },
      runScheduledTask: async (_event, input) => {
        const request = asObject(input);
        const id = asString(request.scheduledTaskId) ?? asString(request.id);
        const task = id ? context.scheduledTasks.getScheduledTask(id) : context.scheduledTasks.createScheduledTask(request as never);
        return task ? runScheduledTaskNow(context, task, "manual") : null;
      },
    },
  });

  registerNamespaceHandlers("claude.web", {
    AgentModeFeedback: {
      openFeedbackWindow: async (_event, payload) => {
        await shell.openExternal(`mailto:support@anthropic.com?subject=${encodeURIComponent("Claude Desktop feedback")}&body=${encodeURIComponent(JSON.stringify(payload ?? {}, null, 2))}`);
        return true;
      },
      openFeedbackAndConfirmReinstall: async () => {
        shell.showItemInFolder(app.getPath("exe"));
        return true;
      },
      reportErrorToSlack: async (_event, error) => ({ ok: false, reason: "slack_bridge_absent", error }),
    },
    BuddyRemoteFeed: {
      sync: async () => ({ ok: true, items: [] }),
    },
    ChromeExtension: {
      isInstalled: async () => isClaudeChromeExtensionInstalled(),
      installExtension: async () => {
        const result = await installClaudeChromeExtension();
        // Official residual: install path re-syncs native host (vrt) inside installClaudeChromeExtension.
        if (result.status === "error") await openChromeExtensionListing().catch(() => undefined);
        return result;
      },
      restartChrome: async () => {
        // Re-sync manifests before relaunch so Chrome picks up host path.
        try {
          await syncClaudeChromeNativeHost();
        } catch {
          /* ignore */
        }
        // Official Nrt(skipped): if extension already present, skip prefs cleanup.
        const alreadyInstalled = await isClaudeChromeExtensionInstalled().catch(() => false);
        return restartChromeForExtension(alreadyInstalled);
      },
    },
    ClaudeCode: {
      checkGitAvailable: async () => {
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          await promisify(execFile)(process.platform === "win32" ? "git" : "/usr/bin/env", process.platform === "win32" ? ["--version"] : ["git", "--version"], { timeout: 3000 });
          return { available: true };
        } catch (error) {
          return { available: false, errorMessage: error instanceof Error ? error.message : String(error) };
        }
      },
      getStatus: async () => "ready",
      prepare: async () => ({ success: true }),
      resolveLocalSettings: async (_event, workspacePath) => {
        const workspace = asString(workspacePath);
        const result: Record<string, unknown> = {};
        const readSetting = async (source: "project" | "projectLocal", filePath: string) => {
          try {
            const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
            for (const [key, value] of Object.entries(parsed)) {
              if (typeof value === "string" || typeof value === "boolean" || Array.isArray(value)) result[key] = { value, source, path: filePath };
            }
          } catch {
            // Missing or invalid Claude Code settings files are treated as absent settings.
          }
        };
        if (workspace && path.isAbsolute(workspace)) {
          await readSetting("project", path.join(workspace, ".claude", "settings.json"));
          await readSetting("projectLocal", path.join(workspace, ".claude", "settings.local.json"));
        }
        return result;
      },
    },
    ClaudeVM: {
      /**
       * Official downloadVM (KZe/QGi): ensure rootfs under userData/vm_bundles/claudevm.bundle.
       * When already ready (linked/copied), no network. Else CDN rootfs.img.zst + origin sha.
       */
      download: async () => {
        events.claudeVmDownloadProgress(0);
        const snap = await coworkVm.downloadVM({
          onProgress: (pct) => events.claudeVmDownloadProgress(pct),
        });
        const status = {
          status: snap.bundleReady
            ? "downloaded"
            : snap.error
              ? "failed"
              : "missing",
          mode: snap.mode,
          updatedAt: snap.updatedAt,
          bundlePath: snap.bundlePath,
          error: snap.error,
        };
        vmStateMap.set("download", status);
        persistVmState();
        events.claudeVmDownloadProgress(snap.bundleReady ? 100 : coworkVm.getDownloadProgress());
        events.claudeVmDownloadStatusChanged(status);
        events.claudeVmApiReachabilityUpdated({
          reachability: snap.bundleReady ? "ok" : "unknown",
          willTryRecover: false,
          mode: snap.mode,
        });
        return { success: snap.bundleReady, ...status };
      },
      /**
       * Official DU/startVM → Mn() swift addon startVM(bundlePath, …).
       * No host-loop fake "running" — status reflects swift probe.
       */
      startVM: async (_event, options) => {
        const opts = asObject(options);
        const snap = await coworkVm.startVM({
          memoryGB: typeof opts.memoryGB === "number" ? opts.memoryGB : undefined,
          cpuCount: typeof opts.cpuCount === "number" ? opts.cpuCount : undefined,
          apiProbeURL: typeof opts.apiProbeURL === "string" ? opts.apiProbeURL : undefined,
        });
        const runtime = setVmRuntime(snap.runningStatus, vmStateFromSnapshot(snap));
        events.claudeVmRunningStatusChanged(runtime);
        if (snap.error && snap.runningStatus === "failed") {
          events.claudeVmStartupError(snap.error);
        }
        events.claudeVmApiReachabilityUpdated({
          reachability: snap.connected ? "ok" : snap.running ? "unknown" : "offline",
          willTryRecover: false,
          mode: snap.mode,
        });
        return {
          success: snap.runningStatus === "running" || snap.connected,
          ...vmStateFromSnapshot(snap),
        };
      },
      getDownloadStatus: async () => {
        const snap = await coworkVm.snapshot();
        return {
          status: snap.downloadStatus,
          mode: snap.mode,
          bundleReady: snap.bundleReady,
          bundlePath: snap.bundlePath,
        };
      },
      getRunningStatus: async () => {
        const snap = await coworkVm.snapshot();
        const runtime = setVmRuntime(snap.runningStatus, vmStateFromSnapshot(snap));
        return runtime;
      },
      setForceDisableHostLoop: async (_event, enabled) => {
        featureState.setBoolean("vmForceDisableHostLoop", "global", Boolean(enabled));
        return true;
      },
      setYukonSilverConfig: async (_event, config) => {
        vmStateMap.set("config", { config, updatedAt: new Date().toISOString() });
        persistVmState();
        return true;
      },
      deleteAndReinstall: async () => {
        await coworkVm.stopVM(false);
        vmStateMap.clear();
        const snap = await coworkVm.snapshot();
        const runtime = setVmRuntime("stopped", vmStateFromSnapshot(snap));
        events.claudeVmRunningStatusChanged(runtime);
        events.claudeVmDownloadStatusChanged({
          status: snap.downloadStatus,
          mode: snap.mode,
        });
        return { success: true, status: snap.downloadStatus, mode: snap.mode };
      },
      checkVirtualMachinePlatform: async () => {
        const snap = await coworkVm.snapshot();
        return {
          supported: process.platform === "darwin" && snap.swiftLoaded,
          mode: snap.mode,
          platform: process.platform,
          swiftLoaded: snap.swiftLoaded,
          bundleReady: snap.bundleReady,
        };
      },
      enableVirtualMachinePlatform: async () => ({
        success: process.platform === "darwin",
        restartNeeded: false,
        mode: "vm",
      }),
      restartAfterVMPInstall: async () => ({ success: true, restartNeeded: false, mode: "vm" }),
      apiReachability_$store$_getState: async () => {
        const snap = await coworkVm.snapshot();
        return {
          reachability: snap.connected ? "ok" : "unknown",
          willTryRecover: false,
          mode: snap.mode,
        };
      },
    },
    ComputerUseTcc: {
      getState: async () => getComputerUseTccState(),
      /**
       * Official ComputerUseTcc.getCurrentSessionGrants(sessionId):
       *   ai.getComputerUseGrants(e).map({bundleId,displayName,grantedAt})
       * Not TCC accessibility status (that is getState).
       */
      getCurrentSessionGrants: async (_event, sessionId) => {
        const id = asString(sessionId);
        if (!id) {
          throw new Error(
            'Argument "sessionId" at position 0 to method "getCurrentSessionGrants" in interface "ComputerUseTcc" failed to pass validation',
          );
        }
        return context.localAgentModeSessions
          .getComputerUseGrants(id)
          .map((app) => ({
            bundleId: app.bundleId,
            displayName: app.displayName,
            grantedAt: app.grantedAt,
          }));
      },
      listInstalledApps: async () => listApplications(),
      openSystemSettings: async (_event, pane) => {
        return openTccSystemSettings(asString(pane) ?? "Privacy_Accessibility");
      },
      requestAccessibility: async () => requestAccessibilityGrant(),
      requestScreenRecording: async () => requestScreenRecordingGrant(),
      /**
       * Official ComputerUseTcc.revokeGrant(sessionId, bundleId) →
       * ai.revokeComputerUseGrant; logs success/warn (no return body required).
       */
      revokeGrant: async (_event, sessionId, bundleId) => {
        const id = asString(sessionId);
        const bundle = asString(bundleId);
        if (!id) {
          throw new Error(
            'Argument "sessionId" at position 0 to method "revokeGrant" in interface "ComputerUseTcc" failed to pass validation',
          );
        }
        if (!bundle) {
          throw new Error(
            'Argument "bundleId" at position 1 to method "revokeGrant" in interface "ComputerUseTcc" failed to pass validation',
          );
        }
        const okRevoke =
          context.localAgentModeSessions.revokeComputerUseGrant(id, bundle);
        if (okRevoke) {
          console.info(
            `[computer-use] Revoked grant for "${bundle}" in session ${id}`,
          );
        } else {
          console.warn(
            `[computer-use] revokeGrant: session ${id} not found or "${bundle}" not in allowlist`,
          );
        }
        return okRevoke;
      },
    },
    CoworkArtifacts: {
      // Official yn.getAllWithDiskStatus residual (app.asar):
      // return bag rows only; annotate ArtifactFolderMissing when dir gone.
      // Do NOT re-import soft-deleted disk orphans into the bag (list soft-delete).
      // MCP create_artifact writes bag via FeatureStateStore; reload file first.
      getAllArtifacts: async () => {
        const getDocs = () => app.getPath("documents");
        featureState.reload();
        const fresh = featureState.loadMap<Record<string, unknown>>("artifacts");
        artifacts.clear();
        for (const [id, row] of fresh) {
          artifacts.set(id, row);
        }

        const onDiskById = new Map<string, Record<string, unknown>>();
        for (const diskRow of await listOfficialArtifactsOnDisk(getDocs)) {
          onDiskById.set(String(diskRow.id), diskRow);
        }

        const rows: Array<Record<string, unknown>> = [];
        for (const row of artifacts.values()) {
          const normalized = normalizeCoworkArtifactRecord(asObject(row));
          if (!normalized?.id) continue;
          const id = String(normalized.id);
          const diskRow = onDiskById.get(id);
          const bagVersions = Array.isArray(normalized.versions)
            ? (normalized.versions as number[])
            : [];
          const diskVersions = Array.isArray(diskRow?.versions)
            ? (diskRow!.versions as number[])
            : [];
          const versions = Array.from(
            new Set(
              [...bagVersions, ...diskVersions]
                .map((v) => Number(v))
                .filter((v) => Number.isFinite(v)),
            ),
          ).sort((a, b) => a - b);
          const merged: Record<string, unknown> = {
            ...normalized,
            indexHtmlPath:
              asString(normalized.indexHtmlPath) ??
              asString(diskRow?.indexHtmlPath) ??
              undefined,
            ...(versions.length > 0 ? { versions } : {}),
          };
          if (!diskRow) {
            merged.errors = [
              ...(Array.isArray(merged.errors) ? merged.errors : []),
              "artifactFolderMissing",
            ];
          }
          rows.push(merged);
        }

        return rows.sort(
          (a, b) =>
            (typeof b.createdAt === "number" ? b.createdAt : 0) -
            (typeof a.createdAt === "number" ? a.createdAt : 0),
        );
      },
      getArtifactMetadata: async (_event, artifactId) => {
        const raw = artifacts.get(String(artifactId));
        return raw ? normalizeCoworkArtifactRecord(asObject(raw)) : null;
      },
      getArtifactIndexHtmlPath: async (_event, artifactId) => {
        const key = String(artifactId);
        const existing = asString(artifacts.get(key)?.indexHtmlPath);
        if (existing) return existing;
        const dir = await resolveCoworkArtifactHostDir(key, artifacts.get(key) as Record<string, unknown> | undefined, () =>
          app.getPath("documents"),
        );
        return dir ? path.join(dir, "index.html") : null;
      },
      getArtifactThumbnail: async (_event, artifactId) => {
        const artifact = artifacts.get(String(artifactId));
        const thumbnailPath = asString(artifact?.thumbnailPath);
        if (thumbnailPath) {
          const buffer = await fs.readFile(thumbnailPath).catch(() => null);
          // Official readThumbnail returns raw base64; FE prefixes data:image/png.
          if (buffer) return buffer.toString("base64");
        }
        const officialThumb = path.join(
          resolveOfficialArtifactsRoot(() => app.getPath("documents")),
          String(artifactId),
          "thumbnail.png",
        );
        const fromOfficial = await fs.readFile(officialThumb).catch(() => null);
        if (fromOfficial) return fromOfficial.toString("base64");
        const indexPath =
          asString(artifact?.indexHtmlPath) ??
          path.join(
            resolveOfficialArtifactsRoot(() => app.getPath("documents")),
            String(artifactId),
            "index.html",
          );
        const shot = await captureUrlScreenshot(`file://${indexPath}`, { width: 640, height: 400 });
        const raw = asString(shot);
        if (!raw) return null;
        return raw.startsWith("data:") ? raw.replace(/^data:[^;]+;base64,/, "") : raw;
      },
      // Official CXe: capture shown WebContentsView PNG base64 (not create/persist invent).
      parkAndCaptureArtifact: async (_event, bounds) => {
        const manager = context.windows.coworkArtifacts;
        if (!manager) return null;
        return manager.parkAndCaptureArtifact(bounds);
      },
      // Official import requires sharing residual — honest fail for 3p (no Anthropic share backend).
      importArtifact: async () => ({ ok: false, error: "Sharing is not enabled." }),
      // Official yn.delete(id, {removeFiles}) residual:
      // deleteArtifact:(e,A)=>yn.delete(e,{removeFiles:A}); missing bag → false.
      // List page omits A (soft-delete: bag only). Import-fail dialog passes true.
      deleteArtifact: async (_event, artifactId, removeFiles) => {
        const key = String(artifactId ?? "").trim();
        if (!key) return false;
        featureState.reload();
        const fresh = featureState.loadMap<Record<string, unknown>>("artifacts");
        artifacts.clear();
        for (const [id, row] of fresh) artifacts.set(id, row);

        const existing = artifacts.get(key);
        if (!existing) return false;

        artifacts.delete(key);
        persistArtifacts();

        if (removeFiles === true) {
          const dir = await resolveCoworkArtifactHostDir(key, existing, () =>
            app.getPath("documents"),
          );
          if (dir) {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
          }
        }

        context.windows.coworkArtifacts?.hideArtifact();
        events.coworkArtifactsChanged();
        return true;
      },
      // Official YD → boolean.
      hideArtifact: async () => context.windows.coworkArtifacts?.hideArtifact() ?? false,
      // Official IXe → number token.
      reloadArtifactView: async () =>
        (await context.windows.coworkArtifacts?.reloadArtifactView()) ?? 0,
      refreshImportedArtifact: async () => ({ ok: false, error: "Sharing is not enabled." }),
      // Official EXe → boolean: printToPDF of **shown artifact view** (not mainView invent).
      printArtifactToPdf: async () => {
        const manager = context.windows.coworkArtifacts;
        if (!manager) return false;
        try {
          const pdf = await manager.printShownArtifactToPdf();
          if (!pdf) return false;
          const dir = path.join(app.getPath("userData"), "artifacts");
          await fs.mkdir(dir, { recursive: true });
          const id = manager.getShownArtifactId() ?? "artifact";
          const filePath = path.join(dir, `${id}-${Date.now()}.pdf`);
          await fs.writeFile(filePath, pdf);
          return true;
        } catch {
          return false;
        }
      },
      // Official share when sharing disabled: {ok:false,error}.
      shareArtifact: async () => ({ ok: false, error: "Sharing is not enabled." }),
      unshareArtifact: async () => false,
      // Official yn.restoreVersion(id, version) → boolean.
      restoreArtifactVersion: async (_event, artifactId, version) => {
        const key = String(artifactId ?? "").trim();
        const stamp = typeof version === "number" ? version : Number(version);
        if (!key || !Number.isFinite(stamp)) return false;
        // Bridge FeatureState API onto the handler-owned bag Map (same residual store).
        const bagBridge = {
          loadMap: <T extends Record<string, unknown>>() =>
            new Map(artifacts) as Map<string, T>,
          saveMap: <T extends Record<string, unknown>>(
            _name: string,
            map: Map<string, T>,
          ) => {
            artifacts.clear();
            for (const [id, row] of map) {
              artifacts.set(id, row as Record<string, unknown>);
            }
            persistArtifacts();
          },
        };
        const ok = await restoreCoworkArtifactVersionLocal(key, stamp, {
          featureState: bagBridge as never,
          getDocumentsPath: () => app.getPath("documents"),
        });
        if (ok) {
          events.coworkArtifactsChanged();
          if (context.windows.coworkArtifacts?.getShownArtifactId?.() === key) {
            await context.windows.coworkArtifacts.reloadArtifactView?.();
          }
        }
        return ok;
      },
      /**
       * Official yn.setMcpTools(artifactId, tools) → boolean:
       * missing artifact → false; filter non-null tool names; write HTML frontmatter
       * (product residual: bag + persist; no invent of full uZ/twA frontmatter rewriter);
       * emit changed → true.
       * Never soft-true when artifact missing.
       */
      setArtifactMcpTools: async (_event, artifactId, tools) => {
        const key = asString(artifactId);
        if (!key) return false;
        const existing = artifacts.get(key);
        if (!existing) return false;
        const list = Array.isArray(tools)
          ? tools.filter(
              (item): item is string => typeof item === "string" && item.length > 0,
            )
          : [];
        artifacts.set(key, { ...existing, mcpTools: list });
        persistArtifacts();
        events.coworkArtifactsChanged();
        return true;
      },
      /**
       * Official setArtifactStarred residual:
       * missing bag + no on-disk folder → null (never invent ghost starred row);
       * known id → persist isStarred + emit changed.
       */
      setArtifactStarred: async (_event, artifactId, starred) => {
        const key = asString(artifactId);
        if (!key) return null;
        let existing = artifacts.get(key) as Record<string, unknown> | undefined;
        if (!existing) {
          const dir = await resolveCoworkArtifactHostDir(key, null, () =>
            app.getPath("documents"),
          );
          if (!dir) return null;
          existing = {
            id: key,
            name: key,
            createdAt: Date.now(),
            indexHtmlPath: path.join(dir, "index.html"),
            schemaVersion: 1,
          };
        }
        const updated = {
          ...existing,
          id: key,
          isStarred: Boolean(starred),
          starred: Boolean(starred),
        };
        artifacts.set(key, updated);
        persistArtifacts();
        events.coworkArtifactsChanged();
        return normalizeCoworkArtifactRecord(asObject(updated));
      },
      // Official lT() residual — product has no Anthropic share backend.
      isSharingEnabled: async () => false,
      // Official cXe(artifactId, bounds, version?) → number.
      showArtifact: async (_event, artifactId, bounds, version) => {
        const manager = context.windows.coworkArtifacts;
        if (!manager) return 0;
        const key = String(artifactId);
        manager.setArtifactDirResolver(async (id) =>
          resolveCoworkArtifactHostDir(
            id,
            artifacts.get(id) as Record<string, unknown> | undefined,
            () => app.getPath("documents"),
          ),
        );
        const ver =
          typeof version === "number" && Number.isFinite(version) ? version : undefined;
        return manager.showArtifact(key, bounds, ver);
      },
    },
    CoworkFilePreview: {
      isEnabled: async () => context.windows.coworkFilePreview.isEnabled(),
      isVmReady: async () => context.windows.coworkFilePreview.isVmReady(),
      show: async (_event, sessionId, encodedPath, bounds) =>
        context.windows.coworkFilePreview.show(sessionId, encodedPath, bounds),
      hide: async () => {
        context.windows.coworkFilePreview.hide();
        return true;
      },
      parkAndCapture: async (_event, bounds) =>
        context.windows.coworkFilePreview.parkAndCapture(bounds),
    },
    CoworkMemory: {
      // Official rxt residual: on-disk CLAUDE.md + memory/memory/*.md under RB.
      readGlobalMemory: async () => {
        await ensureLegacyMemoryMigrated();
        // Official lze returns null; product bridge treats null as empty string in UI.
        return (await readCoworkGlobalMemory(coworkMemoryDeps())) ?? null;
      },
      writeGlobalMemory: async (_event, value) => {
        await ensureLegacyMemoryMigrated();
        return writeCoworkGlobalMemory(coworkMemoryDeps(), String(value ?? ""));
      },
      // Official yLi / ion-dist gt/xt: list items { path, content } (cc989143e Yt).
      listAccountMemories: async () => {
        await ensureLegacyMemoryMigrated();
        return listCoworkAccountMemories(coworkMemoryDeps());
      },
      readAccountMemory: async (_event, memoryPath) => {
        await ensureLegacyMemoryMigrated();
        const file = await readCoworkAccountMemory(
          coworkMemoryDeps(),
          String(memoryPath ?? ""),
        );
        return file?.content ?? null;
      },
      writeAccountMemory: async (_event, memoryPath, value) => {
        await ensureLegacyMemoryMigrated();
        return writeCoworkAccountMemory(
          coworkMemoryDeps(),
          String(memoryPath ?? ""),
          String(value ?? ""),
        );
      },
      deleteAccountMemory: async (_event, memoryPath) => {
        await ensureLegacyMemoryMigrated();
        return deleteCoworkAccountMemory(
          coworkMemoryDeps(),
          String(memoryPath ?? ""),
        );
      },
      resetMemories: async () => {
        await ensureLegacyMemoryMigrated();
        return resetCoworkMemories(coworkMemoryDeps());
      },
    },
    CoworkRadar: {
      getCards: async () => classifyLocalSessions().slice(0, 20).map((session) => ({
        id: `session:${session.sessionId}`,
        type: "local-session",
        title: session.title,
        cwd: session.cwd,
        spaceId: session.spaceId,
        updatedAt: session.updatedAt,
        action: "adoptSession",
      })),
      getLastRun: async () => {
        const session = localSessions().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        return session ? { id: session.sessionId, title: session.title, updatedAt: session.updatedAt, cwd: session.cwd } : null;
      },
      revealLastRunTranscript: async () => {
        shell.showItemInFolder(context.localSessions.getStorageFile());
        return true;
      },
      dismissCard: async () => true,
      setCardStatus: async () => true,
      recordCardEngagement: async () => true,
      adoptSession: async (_event, card) => context.localSessions.start({ title: asString(asObject(card).title) ?? "Radar session", prompt: asString(asObject(card).prompt) ?? undefined }),
    },
    CoworkSpaces: {
      getAllSpaces: async () => Array.from(spaces.values()),
      getSpace: async (_event, spaceId) => spaces.get(String(spaceId)) ?? null,
      createSpace: async (_event, input) => {
        const payload = asObject(input);
        const now = new Date().toISOString();
        const space = {
          id: id("space"),
          createdAt: now,
          updatedAt: now,
          folders: [],
          links: [],
          projects: [],
          ...payload,
          // Ensure name is never dropped when payload omits it.
          name: asString(payload.name) ?? "Untitled project",
        };
        spaces.set(String(space.id), space);
        persistSpaces();
        return space;
      },
      updateSpace: async (_event, spaceId, input) => {
        const existing = spaces.get(String(spaceId)) ?? { id: String(spaceId) };
        const updated = { ...existing, ...asObject(input), updatedAt: new Date().toISOString() };
        spaces.set(String(spaceId), updated);
        persistSpaces();
        return updated;
      },
      deleteSpace: async (_event, spaceId) => {
        const deleted = spaces.delete(String(spaceId));
        persistSpaces();
        return deleted;
      },
      addFolderToSpace: async (_event, spaceId, folder) => updateSpaceList(spaces, persistSpaces, String(spaceId), "folders", folder, true),
      removeFolderFromSpace: async (_event, spaceId, folder) => updateSpaceList(spaces, persistSpaces, String(spaceId), "folders", folder, false),
      addLinkToSpace: async (_event, spaceId, link) => updateSpaceList(spaces, persistSpaces, String(spaceId), "links", link, true),
      removeLinkFromSpace: async (_event, spaceId, link) => updateSpaceList(spaces, persistSpaces, String(spaceId), "links", link, false),
      addProjectToSpace: async (_event, spaceId, project) => updateSpaceList(spaces, persistSpaces, String(spaceId), "projects", project, true),
      removeProjectFromSpace: async (_event, spaceId, project) => updateSpaceList(spaces, persistSpaces, String(spaceId), "projects", project, false),
      classifySessions: async () => classifyLocalSessions(),
      /**
       * Official residual gT.copyFilesToSpaceFolder(spaceId, filePaths)
       * (index-BELzQL5P bkt). Legacy product used (files, destinationFolder).
       */
      copyFilesToSpaceFolder: async (_event, spaceIdOrFiles, filesOrDestination) => {
        let destination: string | null = null;
        let files: unknown[] = [];
        const spaceId = asString(spaceIdOrFiles);
        if (spaceId && Array.isArray(filesOrDestination)) {
          const space = spaces.get(spaceId);
          const folderList = Array.isArray(space?.folders) ? (space?.folders as unknown[]) : [];
          const first = folderList[0];
          destination =
            asString(first) ??
            asString(asObject(first).path) ??
            asString(asObject(first).folderPath) ??
            null;
          files = filesOrDestination;
        } else if (Array.isArray(spaceIdOrFiles)) {
          // Legacy (files, destinationFolder)
          files = spaceIdOrFiles;
          destination = asString(filesOrDestination);
        }
        if (!destination || files.length === 0) return [];
        await fs.mkdir(destination, { recursive: true });
        const copied: string[] = [];
        for (const file of files) {
          const source = asString(file) ?? asString(asObject(file).path);
          if (!source) continue;
          const target = path.join(destination, path.basename(source));
          await fs.copyFile(source, target);
          copied.push(target);
        }
        return copied;
      },
      /**
       * Official gT.createSpaceFolder(location, name) residual (index-BELzQL5P bkt):
       * creates `<location>/<name>` on disk and returns the folder path string.
       * Does NOT create a space record — createSpace runs after this.
       * Legacy product signature was (spaceId, folderName) under userData — wrong arg order.
       */
      createSpaceFolder: async (_event, location, folderName) => {
        const parent = asString(location);
        const name = asString(folderName);
        if (!parent || !name) return null;
        const dir = path.join(parent, name);
        await fs.mkdir(dir, { recursive: true });
        return dir;
      },
      /**
       * Official gT.listFolderContents(spaceId, folderPath) residual
       * (electron-shell Spaces API + ce283 Ya/Va):
       *   args: (spaceId, folderPath)
       *   returns: { name, path, isDirectory }[]
       *   roots: space.folders ∪ getAutoMemoryDir(spaceId)
       *   hides EAA names (dotfiles / ~$ / ~*.tmp)
       */
      listFolderContents: async (_event, spaceIdArg, folderPathArg) => {
        // Official residual: always (spaceId, folderPath) — never unscoped readdir.
        const spaceId = asString(spaceIdArg);
        const folderPath = asString(folderPathArg);
        if (!spaceId || !folderPath || !spaces.has(spaceId)) return [];
        const autoMemoryDir = resolveSpaceAutoMemoryDir(spaceId);
        const accessible = await resolveSpaceAccessiblePath(
          spaces,
          spaceId,
          folderPath,
          autoMemoryDir,
        );
        if (!accessible) return [];
        try {
          const entries = await fs.readdir(accessible, { withFileTypes: true });
          return entries
            .filter((entry) => !isHiddenSpaceListingName(entry.name))
            .map((entry) => ({
              name: entry.name,
              // Official maps path with the request folderPath join, not realpath.
              path: path.join(folderPath, entry.name),
              isDirectory: entry.isDirectory(),
            }));
        } catch {
          return [];
        }
      },
      /**
       * Official CoworkSpaces.getAutoMemoryDir(spaceId):
       *   spaces.has(spaceId) ? ZrA(accountId, orgId, spaceId) : null
       * (was inventing userData/cowork-memory — corrected to product path).
       */
      getAutoMemoryDir: async (_event, spaceId) => resolveSpaceAutoMemoryDir(asString(spaceId) ?? ""),
      /**
       * Official gT.openFile(spaceId, filePath) — shell.openPath after allow-list check.
       */
      openFile: async (_event, spaceIdArg, filePathArg) => {
        const spaceId = asString(spaceIdArg);
        const filePath = asString(filePathArg);
        if (!spaceId || !filePath || !spaces.has(spaceId)) return false;
        const autoMemoryDir = resolveSpaceAutoMemoryDir(spaceId);
        const accessible = await resolveSpaceAccessiblePath(
          spaces,
          spaceId,
          filePath,
          autoMemoryDir,
        );
        if (!accessible) return false;
        try {
          return (await shell.openPath(accessible)).length === 0;
        } catch {
          return false;
        }
      },
      /**
       * Official gT.readFileContents(spaceId, filePath):
       *   allow-listed path, size ≤ 50MiB, utf-8 text bag or null.
       */
      readFileContents: async (_event, spaceIdArg, filePathArg) => {
        const spaceId = asString(spaceIdArg);
        const filePath = asString(filePathArg);
        if (!spaceId || !filePath || !spaces.has(spaceId)) return null;
        const autoMemoryDir = resolveSpaceAutoMemoryDir(spaceId);
        const accessible = await resolveSpaceAccessiblePath(
          spaces,
          spaceId,
          filePath,
          autoMemoryDir,
        );
        if (!accessible) return null;
        try {
          const stat = await fs.stat(accessible);
          if (!stat.isFile()) return null;
          if (stat.size > SPACES_READ_FILE_MAX_BYTES) return null;
          const content = await fs.readFile(accessible, "utf8");
          return {
            content,
            mimeType: "text/plain",
            fileName: path.basename(filePath),
            encoding: "utf-8",
          };
        } catch {
          return null;
        }
      },
      setAutoDescription: async (_event, spaceId, description) => {
        const existing = spaces.get(String(spaceId)) ?? { id: String(spaceId) };
        const updated = { ...existing, autoDescription: description };
        spaces.set(String(spaceId), updated);
        persistSpaces();
        return updated;
      },
      summarizeSpace: async (_event, spaceId) => JSON.stringify(spaces.get(String(spaceId)) ?? {}).slice(0, 1000),
    },
    CustomPlugins: {
      /**
       * Official addMarketplace residual — local directory only.
       * Remote URL/git clone is intentionally unsupported (no invent network success).
       * Args residual: (name, url, meta) or single input object (ion-dist).
       */
      addMarketplace: async (_event, name, url, meta) => {
        const resolved = resolveLocalMarketplaceInput(name, url, meta);
        if (resolved.kind === "unsupported") {
          // Do not invent remote marketplace registration.
          return {
            success: false,
            error: resolved.error,
            id: null,
            name: asString(name),
            url: asString(url),
          };
        }
        const paths = resolvePluginPaths();
        const added = addLocalDirectoryMarketplace(paths, {
          name: resolved.name,
          directoryPath: resolved.directoryPath,
        });
        if (!added.success) {
          return { success: false, error: added.error };
        }
        customMarketplaces.set(String(added.marketplace.id), added.marketplace);
        persistCustomMarketplaces();
        return added.marketplace;
      },
      removeMarketplace: async (_event, marketplaceId) => {
        const paths = resolvePluginPaths();
        const deleted = removeKnownMarketplace(paths, String(marketplaceId));
        customMarketplaces.delete(String(marketplaceId));
        persistCustomMarketplaces();
        return deleted;
      },
      refreshMarketplace: async (_event, marketplaceId) => {
        const paths = resolvePluginPaths();
        return refreshKnownMarketplace(paths, String(marketplaceId));
      },
      listMarketplaces: async () => {
        const paths = resolvePluginPaths();
        return listKnownMarketplaces(paths);
      },
      /**
       * Official installPlugin residual:
       *   (pluginId, egressAllowedDomains, pluginContext?)
       * Product residual also accepts path/object when local install.
       * No cloud fetch — requires name@marketplace on disk or directory path.
       */
      installPlugin: async (_event, plugin, _egress?, contextOrOpts?) => {
        const paths = resolvePluginPaths();
        const pluginObj = asObject(plugin);
        const pluginId =
          asString(plugin)
          ?? asString(pluginObj.id)
          ?? asString(pluginObj.pluginId)
          ?? null;
        const pluginPath =
          asString(pluginObj.path)
          ?? asString(pluginObj.filePath)
          ?? asString(asObject(contextOrOpts).path)
          ?? null;
        const replaceExisting =
          asObject(contextOrOpts).replaceExisting === true
          || pluginObj.replaceExisting === true;

        let result;
        if (pluginPath) {
          result = installPluginFromDirectory(paths, pluginPath, { replaceExisting });
        } else if (pluginId) {
          result = installPluginByIdFromDisk(paths, pluginId, { replaceExisting });
        } else {
          return {
            success: false,
            pluginId: "",
            error: "Missing pluginId or local path (cloud install not available in residual).",
          };
        }
        if (!result.success) {
          return {
            success: false,
            pluginId: pluginId ?? "",
            error: result.error,
          };
        }
        events.customPluginsInstallProgress(result.pluginId, "installed");
        return {
          success: true,
          pluginId: result.pluginId,
          pluginName: result.pluginName,
          filePath: result.installPath,
          installPath: result.installPath,
          isNew: result.isNew,
          path: result.installPath,
          id: result.pluginId,
          name: result.pluginName,
          version: result.pluginVersion,
          source: "marketplace",
        };
      },
      updatePlugin: async (_event, pluginId, update) => {
        const paths = resolvePluginPaths();
        const updateObj = asObject(update);
        const sourcePath =
          asString(updateObj.path)
          ?? asString(updateObj.filePath)
          ?? null;
        if (sourcePath) {
          const result = installPluginFromDirectory(paths, sourcePath, {
            replaceExisting: true,
          });
          if (!result.success) {
            return { success: false, error: result.error, id: String(pluginId) };
          }
          events.customPluginsInstallProgress(result.pluginId, "updated");
          return {
            success: true,
            id: result.pluginId,
            installPath: result.installPath,
            updatedAt: new Date().toISOString(),
          };
        }
        // No path → cannot invent remote update.
        return {
          success: false,
          id: String(pluginId),
          error: "Local residual update requires a plugin path (no cloud update).",
        };
      },
      uninstallPlugin: async (_event, pluginId) => {
        const paths = resolvePluginPaths();
        const okDisk = uninstallPluginFromDisk(paths, String(pluginId));
        localPlugins.delete(String(pluginId));
        persistLocalPlugins();
        return okDisk;
      },
      listInstalledPlugins: async () => installedPlugins(),
      listAvailablePlugins: async () => [...marketplacePlugins(), ...installedPlugins()],
      getCachedCommands: async () => cachedCommands(),
      getInstallCounts: async () => {
        const installed = installedPlugins();
        return { installed: installed.length, available: marketplacePlugins().length };
      },
      /**
       * Official listRemotePluginsPage residual shape used by ion-dist:
       *   { plugins, hasMore }  (product also returns items/nextPage for older callers)
       * Local residual: page over on-disk marketplace plugins only — no cloud.
       */
      listRemotePluginsPage: async (_event, limit?, offset?) => {
        const all = marketplacePlugins();
        const lim =
          typeof limit === "number" && Number.isFinite(limit) && limit > 0
            ? Math.floor(limit)
            : 100;
        const off =
          typeof offset === "number" && Number.isFinite(offset) && offset > 0
            ? Math.floor(offset)
            : 0;
        const slice = all.slice(off, off + lim);
        const hasMore = off + slice.length < all.length;
        return {
          plugins: slice,
          items: slice,
          hasMore,
          nextPage: hasMore ? off + slice.length : null,
        };
      },
      checkPluginHasLocalChanges: async (_event, pluginId) => {
        const plugins = installedPlugins();
        const plugin = plugins.find((p) => String(p.id) === String(pluginId))
          ?? localPlugins.get(String(pluginId));
        const pluginPath = asString(plugin?.path)
          ?? asString(plugin?.installPath)
          ?? asString(asObject(plugin?.plugin).path);
        if (!pluginPath) return false;
        try { await fs.access(pluginPath); return true; } catch { return false; }
      },
      getAndClearMigrationIssues: async () => {
        const issues = [];
        for (const plugin of installedPlugins()) {
          const pluginPath = asString(plugin.path)
            ?? asString(plugin.installPath)
            ?? asString(asObject(plugin.plugin).path);
          if (!pluginPath) continue;
          try {
            await fs.access(pluginPath);
          } catch {
            issues.push({ pluginId: plugin.id, path: pluginPath, kind: "missing_path", message: "Plugin path is no longer available." });
          }
        }
        return issues;
      },
      listLocalOrgPlugins: async () => installedPlugins().filter((plugin) => plugin.source === "local-org"),
      installLocalOrgPlugin: async (_event, pluginPath) => {
        const target = asString(pluginPath) ?? asString(asObject(pluginPath).path);
        if (!target) return { success: false, error: "missing plugin path" };
        const paths = resolvePluginPaths();
        const result = installPluginFromDirectory(paths, target, {
          replaceExisting: true,
          marketplaceName: "org-provisioned",
        });
        if (!result.success) {
          return { success: false, pluginId: "", error: result.error };
        }
        events.customPluginsInstallProgress(result.pluginId, "installed");
        return { success: true, pluginId: result.pluginId, filePath: result.installPath };
      },
    },
    LocalPlugins: {
      getPlugins: async () => installedPlugins(),
      deletePlugin: async (_event, pluginId) => {
        const paths = resolvePluginPaths();
        const okDisk = uninstallPluginFromDisk(paths, String(pluginId));
        localPlugins.delete(String(pluginId));
        persistLocalPlugins();
        return okDisk;
      },
      getDownloadedRemotePlugins: async () => installedPlugins().filter((plugin) => plugin.source === "local-upload" || plugin.source === "marketplace"),
      getPluginCliStatus: async () => ({ installed: false }),
      getPluginOAuthStatus: async () => ({ connected: false }),
      getPluginShimOps: async () => pluginShimOps(installedPlugins()),
      listSkillFiles: async (_event, skillRef) => {
        if (skillRef) return getLocalSkillFiles(skillRef);
        const skills = await listLocalSkills();
        return (await Promise.all(skills.map((skill) => getLocalSkillFiles(skill)))).flat();
      },
      revokePluginOAuth: async () => true,
      setPluginEnabled: async (_event, pluginId, enabled) => {
        const paths = resolvePluginPaths();
        const updated = setPluginEnabledOnDisk(paths, String(pluginId), Boolean(enabled));
        if (updated) return updated;
        const existing = localPlugins.get(String(pluginId)) ?? { id: String(pluginId) };
        const mem = { ...existing, enabled: Boolean(enabled) };
        localPlugins.set(String(pluginId), mem);
        persistLocalPlugins();
        return mem;
      },
      setPluginEnvVars: async () => true,
      setPluginOAuthClient: async () => true,
      setPluginShimPermission: async () => true,
      startPluginOAuthFlow: async (_event, url) => {
        const target = asString(url) ?? asString(asObject(url).url);
        if (target) await shell.openExternal(target);
        return { success: Boolean(target) };
      },
      /**
       * Official syncRemotePlugins residual — product does not invent cloud sync.
       * Returns on-disk installed plugins only.
       */
      syncRemotePlugins: async () => installedPlugins(),
      /**
       * Official uploadPlugin residual: filename + base64Content + replaceExisting.
       * Also accepts local directory/zip path (product residual).
       * Always writes to disk (identity or local-desktop fallback).
       */
      uploadPlugin: async (_event, filenameOrPath, base64Content?, replaceExisting?, _pluginContext?) => {
        const paths = resolvePluginPaths();
        const replace = replaceExisting === true;
        const nameOrPath = asString(filenameOrPath);
        const b64 = asString(base64Content);

        if (b64) {
          try {
            const buf = Buffer.from(b64, "base64");
            const result = installPluginFromZip(paths, buf, { replaceExisting: replace });
            if (!result.success) {
              return { success: false, error: result.error };
            }
            events.localPluginsCliOpAlwaysAllowed([result.pluginId]);
            events.customPluginsInstallProgress(result.pluginId, "installed");
            return {
              success: true,
              pluginId: result.pluginId,
              filePath: result.installPath,
              isNew: result.isNew,
            };
          } catch (err) {
            return {
              success: false,
              error: err instanceof Error ? err.message : "upload failed",
            };
          }
        }

        const target =
          nameOrPath
          ?? asString(asObject(filenameOrPath).path)
          ?? asString(asObject(filenameOrPath).filePath);
        if (!target) return { success: false, error: "missing plugin path or base64 content" };

        const lower = target.toLowerCase();
        const result = lower.endsWith(".zip")
          ? installPluginFromZip(paths, target, { replaceExisting: replace })
          : installPluginFromDirectory(paths, target, { replaceExisting: replace });
        if (!result.success) {
          return { success: false, error: result.error };
        }
        events.localPluginsCliOpAlwaysAllowed([result.pluginId]);
        events.customPluginsInstallProgress(result.pluginId, "installed");
        return {
          success: true,
          pluginId: result.pluginId,
          filePath: result.installPath,
          isNew: result.isNew,
        };
      },
    },
    // Official lr (c11959232 YR):
    //   T = capabilities.framebufferPreview.status === "supported"
    //   A = listSources(cwd) real simulator/device streams
    //   Screen menu: T && (A || pane open)
    // Product residual: RFB / simulator framebuffer MessagePort is NOT wired.
    // Do not invent support via desktopCapturer screen/window sources — that made
    // Screen always appear unlike official (Preview/Diff/Terminal/Tasks/Plan only).
    FramebufferPreview: {
      /** Explicit capability residual for web T gate. Always unsupported until RFB lands. */
      getStatus: async () => ({ status: "unsupported" as const }),
      isSupported: async () => false,
      listSources: async (_event, _cwd?: unknown) => {
        // Official listSources returns device/sim framebuffer origins, not Electron
        // desktopCapturer screen:/window: ids. Empty until real sources exist.
        return [];
      },
      attach: async (_event, _cwdOrSource: unknown, _sessionName?: unknown) => {
        // Honest residual: cannot attach a live framebuffer stream yet.
        return null;
      },
      detach: async (_event, _sessionId?: unknown) => {
        framebufferSource = null;
        return true;
      },
      requestFramePort: async () => {
        // Full RFB frame MessagePort not wired in open-claude-desktop yet.
        if (!framebufferSource) return { attached: false };
        return { attached: true, source: framebufferSource, sessionId: framebufferSource.id };
      },
      sendKey: async () => true,
      sendPointer: async () => true,
      sendScroll: async () => true,
      setStreamHints: async () => true,
    },
    GrandPrix: {
      pair: async (_event, device) => {
        grandPrixPaired = true;
        events.grandPrixStatusUpdated({ paired: true, status: "connected" });
        return { paired: true, device };
      },
      disconnect: async () => {
        grandPrixPaired = false;
        events.grandPrixStatusUpdated({ paired: false, status: "disconnected" });
        return true;
      },
      grandPrixStatus_$store$_getState: async () => ({ paired: grandPrixPaired, status: grandPrixPaired ? "connected" : "disconnected" }),
    },
    Launch: {
      activeServers_$store$_getState: async () => launch.getActiveServers(),
      getConfiguredServices: async (_event, cwd) => launch.getConfiguredServices(asString(cwd) ?? process.cwd()),
      getAutoVerify: async (_event, cwd) => featureState.getBoolean("autoVerify", asString(cwd) ?? process.cwd(), false),
      setAutoVerify: async (_event, cwd, enabled) => {
        featureState.setBoolean("autoVerify", asString(cwd) ?? process.cwd(), Boolean(enabled));
        return true;
      },
      deployPreview: async (_event, serverId, appName) => {
        const deploy = { id: id("deploy"), serverId, appName, deployedAt: new Date().toISOString(), localOnly: true };
        orbitDeploys.set(String(deploy.id), deploy);
        persistOrbitDeploys();
        return true;
      },
      destroyPreview: async (_event, serverId) => {
        const id = asString(serverId) ?? asString(asObject(serverId).serverId);
        if (!id) return false;
        return previewViews.destroy(id);
      },
      getPreviewUrl: async (_event, serverId) => previewUrl ?? launch.getPreviewUrl(asString(serverId) ?? undefined),
      getLogs: async (_event, serverId) => launch.getLogs(String(serverId ?? "")),
      /**
       * Official capturePreviewScreenshot(serverId) residual — QOi via WebContentsView CDP.
       * Args: serverId string (primary). Legacy url/options bag still accepted as fallback.
       * Returns raw base64 PNG string (no data: prefix) or null.
       */
      capturePreviewScreenshot: async (_event, serverIdOrUrl, maybeOptions) => {
        const bag = asObject(serverIdOrUrl);
        const serverId =
          asString(serverIdOrUrl)
          ?? asString(bag.serverId)
          ?? null;
        if (serverId && previewViews.has(serverId)) {
          return previewViews.capturePreviewScreenshot(serverId);
        }
        // Legacy / html-file path: offscreen BrowserWindow capture of a URL.
        const target =
          asString(bag.url)
          ?? (asString(serverIdOrUrl)?.startsWith("http") || asString(serverIdOrUrl)?.startsWith("file:")
            ? asString(serverIdOrUrl)
            : null)
          ?? previewUrl
          ?? (serverId ? launch.getPreviewUrl(serverId) : null);
        if (!target) return null;
        const dataUrl = await captureUrlScreenshot(target, maybeOptions ?? serverIdOrUrl);
        // Normalize to raw base64 like official QOi (FE adds data: prefix).
        const raw = asString(dataUrl);
        if (!raw) return null;
        const comma = raw.indexOf(",");
        return raw.startsWith("data:") && comma >= 0 ? raw.slice(comma + 1) : raw;
      },
      /**
       * Official clearPreviewViewport(serverId) residual — clear device metrics.
       * Not hidePreview (that is a separate API).
       */
      clearPreviewViewport: async (_event, serverId) => {
        const id = asString(serverId) ?? asString(asObject(serverId).serverId);
        return id ? previewViews.clearPreviewViewport(id) : false;
      },
      goBack: async (_event, serverId) => {
        const id = asString(serverId) ?? asString(asObject(serverId).serverId);
        return id ? previewViews.goBack(id) : false;
      },
      goForward: async (_event, serverId) => {
        const id = asString(serverId) ?? asString(asObject(serverId).serverId);
        return id ? previewViews.goForward(id) : false;
      },
      /**
       * Official hidePreview residual — hide WebContentsView (optionally by serverId).
       */
      hidePreview: async (_event, serverId) => {
        const id = asString(serverId) ?? asString(asObject(serverId).serverId) ?? undefined;
        return previewViews.hidePreview(id);
      },
      /**
       * Official showPreview(serverId, bounds) residual — scale by main zoom, addChildView.
       * Args may be (serverId, bounds) or single options bag.
       */
      showPreview: async (_event, serverIdOrOpts, boundsMaybe) => {
        const bag = asObject(serverIdOrOpts);
        const id =
          asString(serverIdOrOpts)
          ?? asString(bag.serverId)
          ?? null;
        const boundsRaw = boundsMaybe !== undefined ? asObject(boundsMaybe) : asObject(bag.bounds ?? bag);
        if (!id) return false;
        ensurePreviewContext(id);
        const bounds = {
          x: Number(boundsRaw.x) || 0,
          y: Number(boundsRaw.y) || 0,
          width: Number(boundsRaw.width) || 0,
          height: Number(boundsRaw.height) || 0,
        };
        return previewViews.showPreview(id, bounds);
      },
      loadHtmlPreview: async (_event, filePath) => {
        const target = asString(filePath);
        if (!target) return "";
        previewUrl = `file://${target}`;
        return previewUrl;
      },
      navigatePreview: async (_event, serverIdOrUrl, maybeUrl) => {
        // Official: navigatePreview(serverId, url) or navigatePreview(url).
        const asId = asString(serverIdOrUrl);
        const asUrl = asString(maybeUrl) ?? asString(asObject(serverIdOrUrl).url);
        if (asId && asUrl && previewViews.has(asId)) {
          previewUrl = asUrl;
          return ok({ url: asUrl, navigated: previewViews.navigate(asId, asUrl) });
        }
        const url = asUrl ?? asId ?? previewUrl;
        if (url && asId && launch.getServer(asId)) {
          ensurePreviewContext(asId);
          previewUrl = url;
          return ok({ url, navigated: previewViews.navigate(asId, url) });
        }
        previewUrl = url ?? previewUrl;
        return ok({ url: previewUrl });
      },
      pickHtmlFile: async (_event, cwd) => {
        const result = await dialog.showOpenDialog(context.windows.mainWindow, { defaultPath: asString(cwd) ?? undefined, properties: ["openFile"], filters: [{ name: "HTML", extensions: ["html", "htm"] }] });
        return result.canceled ? null : result.filePaths[0] ?? null;
      },
      refreshPreview: async (_event, serverId) => {
        const id = asString(serverId) ?? asString(asObject(serverId).serverId);
        return id ? previewViews.refresh(id) : false;
      },
      /**
       * Official setPreviewColorScheme(serverId, scheme) residual.
       * scheme: "light" | "dark"
       */
      setPreviewColorScheme: async (_event, serverId, scheme) => {
        const id = asString(serverId) ?? asString(asObject(serverId).serverId);
        const value =
          asString(scheme)
          ?? asString(asObject(serverId).scheme)
          ?? asString(asObject(scheme).scheme);
        if (!id || !value) return false;
        return previewViews.setPreviewColorScheme(id, value);
      },
      /**
       * Official setPreviewViewport(serverId, width, height) residual.
       * FE mobile preset: 375×812; desktop uses clearPreviewViewport.
       */
      setPreviewViewport: async (_event, serverId, width, height) => {
        const bag = asObject(serverId);
        const id = asString(serverId) ?? asString(bag.serverId);
        const w =
          typeof width === "number"
            ? width
            : typeof bag.width === "number"
              ? bag.width
              : Number(width);
        const h =
          typeof height === "number"
            ? height
            : typeof bag.height === "number"
              ? bag.height
              : Number(height);
        if (!id || !Number.isFinite(w) || !Number.isFinite(h)) return false;
        return previewViews.setPreviewViewport(id, w, h);
      },
      startFromConfig: async (_event, cwd, name) => {
        // launchEnabled gate lives in LocalLaunchManager (IPC + startCommand/tool path).
        return rememberPreview(
          await launch.startFromConfig(asString(cwd) ?? process.cwd(), asString(name) ?? undefined),
        );
      },
      /**
       * Official MCP/tool isEnabled residual — preference gate (not isAvailable).
       * Settings Ea() still = launchEnabled && isAvailable on the web side.
       */
      isEnabled: async () => launch.isEnabled(),
      // isAvailable is registered via registerInterfaceSyncHandlers below (capability residual).
      stopServer: async (_event, serverId) => {
        const id = String(serverId ?? "");
        const stopped = await launch.stopServer(id);
        if (id) previewViews.destroy(id);
        events.launchActiveServersUpdated(launch.getActiveServers());
        return stopped;
      },
      suggestDeployName: async (_event, input) => {
        const value = asString(input) ?? asString(asObject(input).name) ?? `deploy-${Date.now()}`;
        return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `deploy-${Date.now()}`;
      },
      /**
       * Official toggleSelectionMode(serverId, enabled) residual — CDP Overlay inspect.
       * On pick → Launch.elementSelected event with ZFt context.
       */
      toggleSelectionMode: async (_event, serverId, enabled) => {
        const bag = asObject(serverId);
        const id = asString(serverId) ?? asString(bag.serverId);
        const on =
          typeof enabled === "boolean"
            ? enabled
            : typeof bag.enabled === "boolean"
              ? bag.enabled
              : Boolean(enabled);
        if (!id) return false;
        return previewViews.toggleSelectionMode(id, on);
      },
      unpublishDeploy: async (_event, appName) => {
        for (const [deployId, deploy] of orbitDeploys.entries()) {
          if (deploy.appName === appName || deploy.id === appName) orbitDeploys.delete(deployId);
        }
        persistOrbitDeploys();
        return null;
      },
    },
    FloatingPenguinMini: {
      requestToggleMini: async () => {
        miniExpanded = !miniExpanded;
        events.floatingPenguinMiniStateChanged({ expanded: miniExpanded });
        return miniExpanded;
      },
      requestSetMiniExpanded: async (_event, expanded) => {
        miniExpanded = Boolean(expanded);
        events.floatingPenguinMiniStateChanged({ expanded: miniExpanded });
        return miniExpanded;
      },
    },
    NestDev: {
      getState: async () => ({ enabled: false }),
      focus: async () => {
        context.windows.mainWindow.focus();
        return true;
      },
    },
    OpenDocuments: {
      getOpenDocuments: async () => listOpenDocuments(),
      readOpenDocumentAsBase64: async (_event, idOrPath) => readOpenDocumentAsBase64(idOrPath),
    },
    OrbitDeploys: {
      getAll: async () => Array.from(orbitDeploys.values()),
      setDeploy: async (_event, deploy) => {
        const record = { id: id("deploy"), ...asObject(deploy) };
        orbitDeploys.set(String(record.id), record);
        persistOrbitDeploys();
        return record;
      },
      removeDeploy: async (_event, deployId) => {
        const deleted = orbitDeploys.delete(String(deployId));
        persistOrbitDeploys();
        return deleted;
      },
      setPinned: async (_event, deployId, pinned) => {
        const existing = orbitDeploys.get(String(deployId)) ?? { id: String(deployId) };
        const updated = { ...existing, pinned: Boolean(pinned) };
        orbitDeploys.set(String(deployId), updated);
        persistOrbitDeploys();
        return updated;
      },
    },
  });

  // Official ClaudeVM.isHostLoopModeEnabled → v4():
  //   uHA()||neA() ? false
  //   : devUrlOverride && CLAUDE_FORCE_HOST_LOOP==="1" ? true
  //   : mZe() // ft("1143815894")
  // Product: same pure policy as CoworkSessionManager start (kni + env residual).
  const resolveClaudeVmHostLoopMode = createCoworkHostLoopModeResolver({
    getForceDisableHostLoop: () =>
      featureState.getBoolean("vmForceDisableHostLoop", "global", false),
    getHostLoopFeatureEnabled: () => isCoworkHostLoopGrowthBookFeatureEnabled(),
    getRequireCoworkFullVmSandbox: () =>
      resolveCoworkRequireFullVmSandbox({
        enterpriseValue: isCoworkEnterpriseRequireFullVmSandbox({
          getUserDataPath: () => app.getPath("userData"),
        }),
        preferenceValue: context.settings.getPreferences().requireCoworkFullVmSandbox,
      }),
  });
  registerInterfaceSyncHandlers("claude.web", "ClaudeVM", {
    isHostLoopModeEnabled: () => resolveClaudeVmHostLoopMode(),
    // Official dTi: force-disable active while host-loop feature would be on
    // (not FORCE_HOST_LOOP). Product also surfaces FORCE_HOST_LOOP under
    // developer override as an explicit on-override diagnostic.
    isHostLoopDevOverrideActive: () => {
      const forceHostOn =
        process.env.CLAUDE_FORCE_HOST_LOOP === "1"
        && (globalThis as { isDeveloperApprovedDevUrlOverrideEnabled?: boolean })
          .isDeveloperApprovedDevUrlOverrideEnabled === true;
      if (forceHostOn) return true;
      const forceDisable = featureState.getBoolean("vmForceDisableHostLoop", "global", false);
      return forceDisable && isCoworkHostLoopGrowthBookFeatureEnabled();
    },
  }, "claude.web.ClaudeVM");
  /**
   * Official Launch residual (cadc35a07 P/k + app.asar MCP isEnabled):
   *   isAvailable = process capability (always true when LocalLaunchManager present)
   *   isEnabled / launchEnabled = preference gate (tool + startCommand + startFromConfig)
   *   settings Ea() = launchEnabled && isAvailable
   */
  registerInterfaceSyncHandlers("claude.web", "Launch", {
    isAvailable: () => true,
    isEnabled: () => launch.isEnabled(),
  }, "claude.web.Launch");

  // Custom3pSetup is fully owned by settingsHandlers (pot/got/jsA residual).
  // Do not re-register any Custom3pSetup methods here — registerDirectInvokeHandler
  // replaces handlers and would clobber clear/relaunch.
  registerNamespaceHandlers("claude.settings", {
    Extensions: {
      isExtensionsEnabled: async () => true,
      isDirectoryEnabled: async () => true,
      isDesktopExtensionSignatureRequired: async () => false,
      isDesktopExtensionDirectoryEnabled: async () => true,
      showInstallDxtDialog: async () => {
        const result = await dialog.showOpenDialog(context.windows.mainWindow, {
          title: "Install Extension",
          properties: ["openFile"],
          filters: [
            { name: "Desktop Extensions", extensions: ["dxt", "zip"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });
        const source = result.filePaths[0];
        if (result.canceled || !source) return;
        const extensionId = path.basename(source, path.extname(source));
        events.extensionDownloadProgress(extensionId, 0, 0, 0, null, "installing");
        await installDxtArchive(context.settings.getUserDataDir(), source);
        events.extensionDownloadProgress(extensionId, 1, 1, 1, null, "installed");
        dispatchBridgeEvent(context.windows.mainView.webContents, "claude.settings", "Extensions", "extensionsChanged");
      },
      showExtensionInFolder: async (_event, extensionId) => {
        return typeof extensionId === "string" ? revealInstalledExtension(context.settings.getUserDataDir(), extensionId) : false;
      },
      openExtensionsFolder: async () => {
        await shell.openPath((await ensureExtensionFolders(context.settings.getUserDataDir())).extensionsDir);
        return true;
      },
      openExtensionSettingsFolder: async () => {
        await shell.openPath((await ensureExtensionFolders(context.settings.getUserDataDir())).settingsDir);
        return true;
      },
      refreshAllowlistCheck: async () => true,
    },
  });
}
