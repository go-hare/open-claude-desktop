import { app, dialog, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { installClaudeChromeExtension, isClaudeChromeExtensionInstalled, openChromeExtensionListing, restartChromeForExtension } from "../services/chrome/chromeExtension";
import {
  ensureExtensionFolders,
  installDxtArchive,
  revealInstalledExtension,
} from "../services/extensions/desktopExtensions";
import { FeatureStateStore } from "../services/featureState/featureStateStore";
import { LocalLaunchManager } from "../services/launch/localLaunchManager";
import { getComputerUseTccState, openTccSystemSettings, requestAccessibilityGrant, requestScreenRecordingGrant } from "../services/tcc/computerUseTcc";
import type { IpcHandlerContext } from "./context";
import { dispatchBridgeEvent, registerInterfaceSyncHandlers, registerNamespaceHandlers } from "./registerIpc";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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
  const valueKey = JSON.stringify(value);
  const next = add ? [...list.filter((item) => JSON.stringify(item) !== valueKey), value] : list.filter((item) => JSON.stringify(item) !== valueKey);
  const updated = { ...existing, [key]: next, updatedAt: new Date().toISOString() };
  spaces.set(spaceId, updated);
  persist();
  return updated;
}

export function registerFeatureHandlers(context: IpcHandlerContext): void {
  const featureState = new FeatureStateStore();
  const launch = new LocalLaunchManager();
  const spaces = featureState.loadMap<Record<string, unknown>>("spaces");
  const artifacts = featureState.loadMap<Record<string, unknown>>("artifacts");
  const memories = featureState.loadMap<string>("memories");
  const orbitDeploys = featureState.loadMap<Record<string, unknown>>("orbitDeploys");
  const customMarketplaces = featureState.loadMap<Record<string, unknown>>("customMarketplaces");
  const localPlugins = featureState.loadMap<Record<string, unknown>>("localPlugins");
  const persistSpaces = () => featureState.saveMap("spaces", spaces);
  const persistArtifacts = () => featureState.saveMap("artifacts", artifacts);
  const persistMemories = () => featureState.saveMap("memories", memories);
  const persistOrbitDeploys = () => featureState.saveMap("orbitDeploys", orbitDeploys);
  const persistCustomMarketplaces = () => featureState.saveMap("customMarketplaces", customMarketplaces);
  const persistLocalPlugins = () => featureState.saveMap("localPlugins", localPlugins);
  let simulatorAttachment: unknown = null;
  let coworkFilePreview: unknown = null;
  let miniExpanded = false;
  let buddyInstalled = true;
  let buddyDevice: Record<string, unknown> | null = null;
  let grandPrixPaired = false;

  registerNamespaceHandlers("claude.buddy", {
    Buddy: {
      status: async () => ({ status: "ready", installed: buddyInstalled, paired: Boolean(buddyDevice), device: buddyDevice }),
      deviceStatus: async () => ({ connected: Boolean(buddyDevice), paired: Boolean(buddyDevice), device: buddyDevice }),
      setName: async (_event, name) => {
        buddyDevice = { ...(buddyDevice ?? { id: "local-buddy" }), name: String(name ?? "Claude Buddy") };
        return ok({ name });
      },
      pairDevice: async (_event, device) => {
        buddyDevice = { id: id("buddy"), name: "Local Buddy", pairedAt: new Date().toISOString(), ...asObject(device) };
        return { paired: true, device: buddyDevice };
      },
      scanDevices: async () => buddyDevice ? [buddyDevice] : [{ id: "local-buddy", name: "Local Buddy", transport: "local" }],
      pickDevice: async (_event, device) => device ?? null,
      cancelScan: async () => true,
      submitPin: async () => ({ paired: Boolean(buddyDevice), device: buddyDevice }),
      forgetDevice: async () => {
        buddyDevice = null;
        return true;
      },
      pickFolder: async () => {
        const result = await dialog.showOpenDialog(context.windows.mainWindow, { properties: ["openDirectory"] });
        return result.canceled ? null : result.filePaths[0] ?? null;
      },
      preview: async (_event, options) => ({ preview: true, options }),
      install: async () => {
        buddyInstalled = true;
        return { success: true };
      },
    },
    BuddyBleTransport: {
      rx: async (_event, payload) => ok({ received: payload }),
      reportState: async (_event, state, details) => ok({ state, details }),
      log: async (_event, message) => {
        console.log(`[buddy] ${String(message ?? "")}`);
        return true;
      },
    },
  });

  registerNamespaceHandlers("claude.simulator", {
    Simulator: {
      listDevices: async () => [],
      installAndLaunch: async (_event, options) => {
        simulatorAttachment = { id: "local-simulator", status: "running", launchedAt: new Date().toISOString(), options };
        dispatchBridgeEvent(context.windows.mainView.webContents, "claude.simulator", "Simulator", "attachment_", simulatorAttachment);
        return simulatorAttachment;
      },
      attach: async (_event, device) => {
        simulatorAttachment = device ?? { attachedAt: new Date().toISOString() };
        dispatchBridgeEvent(context.windows.mainView.webContents, "claude.simulator", "Simulator", "attachment_", simulatorAttachment);
        return simulatorAttachment;
      },
      detach: async () => {
        simulatorAttachment = null;
        dispatchBridgeEvent(context.windows.mainView.webContents, "claude.simulator", "Simulator", "attachment_", simulatorAttachment);
        return true;
      },
      gesture: async (_event, gesture) => ok({ gesture }),
      attachment_$store$_getState: async () => simulatorAttachment,
    },
  });

  registerNamespaceHandlers("claude.officeAddin", {
    OfficeAddinFiles: {
      connectedFilesState_$store$_getState: async () => ({ files: [], activeFile: null }),
      getConnectedFiles: async () => [],
      isFeatureEnabled: async () => false,
      focusFile: async () => false,
      selectFile: async () => null,
      updateActiveConversationSummary: async () => true,
    },
  });

  registerNamespaceHandlers("claude.coworkArtifact", {
    CoworkArtifactBridge: {
      askClaude: async (_event, prompt) => ({ ok: true, response: String(prompt ?? ""), localOnly: true }),
      callMcpTool: async (_event, tool) => ({ ok: false, reason: "mcp_tool_runtime_absent", tool }),
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
      runScheduledTask: async (_event, input) => context.scheduledTasks.createScheduledTask(asObject(input) as never),
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
        if (result.status === "error") await openChromeExtensionListing().catch(() => undefined);
        return result;
      },
      restartChrome: async () => restartChromeForExtension(),
    },
    ClaudeCode: {
      checkGitAvailable: async () => {
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          await promisify(execFile)("/usr/bin/env", ["git", "--version"], { timeout: 3000 });
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
      download: async () => ({ success: false, error: "vm_bundle_backend_absent" }),
      startVM: async () => ({ success: false, error: "vm_runtime_absent" }),
      getDownloadStatus: async () => ({ status: "not_downloaded" }),
      getRunningStatus: async () => ({ status: "stopped" }),
      setForceDisableHostLoop: async () => true,
      setYukonSilverConfig: async () => true,
      deleteAndReinstall: async () => ({ success: true }),
      checkVirtualMachinePlatform: async () => ({ supported: process.platform !== "darwin" ? false : null }),
      enableVirtualMachinePlatform: async () => ({ success: false, restartNeeded: false, error: "Virtual Machine Platform is not used on this platform." }),
      restartAfterVMPInstall: async () => ({ success: false, restartNeeded: false, error: "Restart is not required." }),
      apiReachability_$store$_getState: async () => ({ reachability: "unknown", willTryRecover: false }),
    },
    ComputerUseTcc: {
      getState: async () => getComputerUseTccState(),
      getCurrentSessionGrants: async () => [],
      listInstalledApps: async () => listApplications(),
      openSystemSettings: async (_event, pane) => {
        return openTccSystemSettings(asString(pane) ?? "Privacy_Accessibility");
      },
      requestAccessibility: async () => requestAccessibilityGrant(),
      requestScreenRecording: async () => requestScreenRecordingGrant(),
      revokeGrant: async () => true,
    },
    CoworkArtifacts: {
      getAllArtifacts: async () => Array.from(artifacts.values()),
      getArtifactMetadata: async (_event, artifactId) => artifacts.get(String(artifactId)) ?? null,
      getArtifactIndexHtmlPath: async (_event, artifactId) => asString(artifacts.get(String(artifactId))?.indexHtmlPath) ?? null,
      getArtifactThumbnail: async () => null,
      parkAndCaptureArtifact: async (_event, input) => {
        const artifact = { id: id("artifact"), createdAt: new Date().toISOString(), ...asObject(input) };
        artifacts.set(String(artifact.id), artifact);
        persistArtifacts();
        return artifact;
      },
      importArtifact: async (_event, input) => {
        const artifact = { id: id("artifact"), imported: true, createdAt: new Date().toISOString(), ...asObject(input) };
        artifacts.set(String(artifact.id), artifact);
        persistArtifacts();
        return artifact;
      },
      deleteArtifact: async (_event, artifactId) => {
        const deleted = artifacts.delete(String(artifactId));
        persistArtifacts();
        return deleted;
      },
      hideArtifact: async () => true,
      reloadArtifactView: async () => true,
      refreshImportedArtifact: async () => true,
      printArtifactToPdf: async (_event, artifactId) => {
        const pdf = await context.windows.mainView.webContents.printToPDF({});
        const dir = path.join(app.getPath("userData"), "artifacts", String(artifactId));
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, "artifact.pdf");
        await fs.writeFile(filePath, pdf);
        return filePath;
      },
      saveArtifactFile: async (_event, artifactId, fileName, content) => {
        const dir = path.join(app.getPath("userData"), "artifacts", String(artifactId));
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, asString(fileName) ?? "artifact.txt");
        await fs.writeFile(filePath, typeof content === "string" ? content : JSON.stringify(content ?? {}, null, 2));
        return filePath;
      },
      shareArtifact: async (_event, artifactId) => {
        const existing = artifacts.get(String(artifactId)) ?? { id: String(artifactId) };
        const updated = { ...existing, shared: true, shareUrl: `cowork-artifact://${String(artifactId)}` };
        artifacts.set(String(artifactId), updated);
        persistArtifacts();
        return updated;
      },
      unshareArtifact: async () => true,
      restoreArtifactVersion: async () => true,
      setArtifactMcpTools: async () => true,
      setArtifactStarred: async (_event, artifactId, starred) => {
        const existing = artifacts.get(String(artifactId)) ?? { id: String(artifactId) };
        const updated = { ...existing, starred: Boolean(starred) };
        artifacts.set(String(artifactId), updated);
        persistArtifacts();
        return updated;
      },
      isSharingEnabled: async () => false,
      showArtifact: async () => true,
      updateArtifactMetadata: async (_event, artifactId, metadata) => {
        const existing = artifacts.get(String(artifactId)) ?? { id: String(artifactId) };
        const updated = { ...existing, ...asObject(metadata), updatedAt: new Date().toISOString() };
        artifacts.set(String(artifactId), updated);
        persistArtifacts();
        return updated;
      },
      writeArtifactFile: async (_event, artifactId, fileName, content) => {
        const dir = path.join(app.getPath("userData"), "artifacts", String(artifactId));
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, asString(fileName) ?? "artifact.txt");
        await fs.writeFile(filePath, typeof content === "string" ? content : JSON.stringify(content ?? {}, null, 2));
        return filePath;
      },
    },
    CoworkFilePreview: {
      isEnabled: async () => true,
      isVmReady: async () => false,
      show: async (_event, input) => {
        coworkFilePreview = input;
        return true;
      },
      hide: async () => {
        coworkFilePreview = null;
        return true;
      },
      parkAndCapture: async () => ({ preview: coworkFilePreview, capturedAt: new Date().toISOString() }),
    },
    CoworkMemory: {
      readGlobalMemory: async () => memories.get("global") ?? "",
      writeGlobalMemory: async (_event, value) => {
        memories.set("global", String(value ?? ""));
        persistMemories();
        return true;
      },
      listAccountMemories: async () => Array.from(memories.entries()).filter(([key]) => key !== "global").map(([key, value]) => ({ key, value })),
      readAccountMemory: async (_event, key) => memories.get(String(key)) ?? "",
      writeAccountMemory: async (_event, key, value) => {
        memories.set(String(key), String(value ?? ""));
        persistMemories();
        return true;
      },
      deleteAccountMemory: async (_event, key) => {
        const deleted = memories.delete(String(key));
        persistMemories();
        return deleted;
      },
      resetMemories: async () => {
        memories.clear();
        persistMemories();
        return true;
      },
    },
    CoworkRadar: {
      getCards: async () => [],
      getLastRun: async () => null,
      revealLastRunTranscript: async () => false,
      dismissCard: async () => true,
      setCardStatus: async () => true,
      recordCardEngagement: async () => true,
      adoptSession: async (_event, card) => context.localSessions.start({ title: asString(asObject(card).title) ?? "Radar session", prompt: asString(asObject(card).prompt) ?? undefined }),
    },
    CoworkSpaces: {
      getAllSpaces: async () => Array.from(spaces.values()),
      getSpace: async (_event, spaceId) => spaces.get(String(spaceId)) ?? null,
      createSpace: async (_event, input) => {
        const space = { id: id("space"), createdAt: new Date().toISOString(), folders: [], links: [], projects: [], ...asObject(input) };
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
      classifySessions: async () => [],
      copyFilesToSpaceFolder: async (_event, files, destinationFolder) => {
        const destination = asString(destinationFolder);
        if (!destination || !Array.isArray(files)) return [];
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
      createSpaceFolder: async (_event, spaceId, folderName) => {
        const dir = path.join(app.getPath("userData"), "cowork-spaces", String(spaceId), asString(folderName) ?? "folder");
        await fs.mkdir(dir, { recursive: true });
        await updateSpaceList(spaces, persistSpaces, String(spaceId), "folders", dir, true);
        return { spaceId, folderName, path: dir };
      },
      listFolderContents: async (_event, folderPath) => {
        try { return await fs.readdir(String(folderPath)); } catch { return []; }
      },
      getAutoMemoryDir: async () => path.join(app.getPath("userData"), "cowork-memory"),
      readSpaceFile: async (_event, filePath) => fs.readFile(String(filePath), "utf8").catch(() => null),
      writeSpaceFile: async (_event, filePath, content) => {
        await fs.mkdir(path.dirname(String(filePath)), { recursive: true });
        await fs.writeFile(String(filePath), String(content ?? ""));
        return true;
      },
      openFile: async (_event, filePath) => {
        const target = asString(filePath);
        if (!target) return false;
        return (await shell.openPath(target)).length === 0;
      },
      readFileContents: async (_event, filePath) => fs.readFile(String(filePath), "utf8").catch(() => null),
      setAutoDescription: async (_event, spaceId, description) => {
        const existing = spaces.get(String(spaceId)) ?? { id: String(spaceId) };
        const updated = { ...existing, autoDescription: description };
        spaces.set(String(spaceId), updated);
        persistSpaces();
        return updated;
      },
      summarizeSpace: async (_event, spaceId) => JSON.stringify(spaces.get(String(spaceId)) ?? {}).slice(0, 1000),
      revealSpaceFolder: async (_event, folderPath) => {
        shell.showItemInFolder(String(folderPath));
        return true;
      },
      searchSpaces: async (_event, query) => Array.from(spaces.values()).filter((space) => JSON.stringify(space).toLowerCase().includes(String(query ?? "").toLowerCase())),
    },
    CustomPlugins: {
      addMarketplace: async (_event, name, url, meta) => {
        const marketplace = { id: id("market"), name, url, meta };
        customMarketplaces.set(String(marketplace.id), marketplace);
        persistCustomMarketplaces();
        return marketplace;
      },
      removeMarketplace: async (_event, marketplaceId) => {
        const deleted = customMarketplaces.delete(String(marketplaceId));
        persistCustomMarketplaces();
        return deleted;
      },
      refreshMarketplace: async (_event, marketplaceId) => customMarketplaces.get(String(marketplaceId)) ?? null,
      listMarketplaces: async () => Array.from(customMarketplaces.values()),
      installPlugin: async (_event, plugin) => {
        const record = { id: id("plugin"), installedAt: new Date().toISOString(), plugin };
        localPlugins.set(String(record.id), record);
        persistLocalPlugins();
        return record;
      },
      updatePlugin: async (_event, pluginId, update) => {
        const existing = localPlugins.get(String(pluginId)) ?? { id: String(pluginId) };
        const updated = { ...existing, update, updatedAt: new Date().toISOString() };
        localPlugins.set(String(pluginId), updated);
        persistLocalPlugins();
        return updated;
      },
      uninstallPlugin: async (_event, pluginId) => {
        const deleted = localPlugins.delete(String(pluginId));
        persistLocalPlugins();
        return deleted;
      },
      listInstalledPlugins: async () => Array.from(localPlugins.values()),
      listAvailablePlugins: async () => [],
      getCachedCommands: async () => [],
      getInstallCounts: async () => ({}),
      listRemotePluginsPage: async () => ({ items: [], nextPage: null }),
      checkPluginHasLocalChanges: async () => false,
      getAndClearMigrationIssues: async () => [],
      listLocalOrgPlugins: async () => [],
      installLocalOrgPlugin: async (_event, pluginPath) => {
        const target = asString(pluginPath) ?? asString(asObject(pluginPath).path);
        if (!target) return { success: false, error: "missing plugin path" };
        const record = { id: id("plugin"), installedAt: new Date().toISOString(), source: "local-org", path: target };
        localPlugins.set(String(record.id), record);
        persistLocalPlugins();
        return { success: true, pluginId: record.id };
      },
    },
    LocalPlugins: {
      getPlugins: async () => Array.from(localPlugins.values()),
      deletePlugin: async (_event, pluginId) => {
        const deleted = localPlugins.delete(String(pluginId));
        persistLocalPlugins();
        return deleted;
      },
      getDownloadedRemotePlugins: async () => [],
      getPluginCliStatus: async () => ({ installed: false }),
      getPluginOAuthStatus: async () => ({ connected: false }),
      getPluginShimOps: async () => [],
      listSkillFiles: async () => [],
      revokePluginOAuth: async () => true,
      setPluginEnabled: async (_event, pluginId, enabled) => {
        const existing = localPlugins.get(String(pluginId)) ?? { id: String(pluginId) };
        const updated = { ...existing, enabled: Boolean(enabled) };
        localPlugins.set(String(pluginId), updated);
        persistLocalPlugins();
        return updated;
      },
      setPluginEnvVars: async () => true,
      setPluginOAuthClient: async () => true,
      setPluginShimPermission: async () => true,
      startPluginOAuthFlow: async (_event, url) => {
        const target = asString(url) ?? asString(asObject(url).url);
        if (target) await shell.openExternal(target);
        return { success: Boolean(target) };
      },
      syncRemotePlugins: async () => [],
      uploadPlugin: async (_event, pluginPath) => {
        const target = asString(pluginPath) ?? asString(asObject(pluginPath).path);
        if (!target) return { success: false, error: "missing plugin path" };
        const record = { id: id("plugin"), uploadedAt: new Date().toISOString(), source: "local-upload", path: target };
        localPlugins.set(String(record.id), record);
        persistLocalPlugins();
        return { success: true, pluginId: record.id };
      },
    },
    FramebufferPreview: {
      listSources: async () => [],
      attach: async (_event, source) => ({ attached: true, source }),
      detach: async () => true,
      requestFramePort: async () => null,
      sendKey: async () => true,
      sendPointer: async () => true,
      sendScroll: async () => true,
      setStreamHints: async () => true,
    },
    GrandPrix: {
      pair: async (_event, device) => {
        grandPrixPaired = true;
        return { paired: true, device };
      },
      disconnect: async () => {
        grandPrixPaired = false;
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
      destroyPreview: async () => true,
      getPreviewUrl: async () => null,
      getLogs: async (_event, serverId) => launch.getLogs(String(serverId ?? "")),
      capturePreviewScreenshot: async () => null,
      clearPreviewViewport: async () => true,
      goBack: async () => true,
      goForward: async () => true,
      hidePreview: async () => true,
      showPreview: async () => true,
      reloadPreview: async () => true,
      openPreviewExternal: async (_event, url) => {
        const target = asString(url);
        if (!target) return false;
        await shell.openExternal(target);
        return true;
      },
      loadHtmlPreview: async (_event, filePath) => {
        const target = asString(filePath);
        if (!target) return "";
        return `file://${target}`;
      },
      navigatePreview: async (_event, url) => ok({ url }),
      pickHtmlFile: async (_event, cwd) => {
        const result = await dialog.showOpenDialog(context.windows.mainWindow, { defaultPath: asString(cwd) ?? undefined, properties: ["openFile"], filters: [{ name: "HTML", extensions: ["html", "htm"] }] });
        return result.canceled ? null : result.filePaths[0] ?? null;
      },
      refreshPreview: async () => true,
      setPreviewColorScheme: async () => true,
      setPreviewViewport: async () => true,
      startFromConfig: async (_event, cwd, name) => launch.startFromConfig(asString(cwd) ?? process.cwd(), asString(name) ?? undefined),
      stopServer: async (_event, serverId) => launch.stopServer(String(serverId ?? "")),
      suggestDeployName: async (_event, input) => {
        const value = asString(input) ?? asString(asObject(input).name) ?? `deploy-${Date.now()}`;
        return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `deploy-${Date.now()}`;
      },
      toggleSelectionMode: async () => true,
      unpublishDeploy: async (_event, appName) => {
        for (const [deployId, deploy] of orbitDeploys.entries()) {
          if (deploy.appName === appName || deploy.id === appName) orbitDeploys.delete(deployId);
        }
        persistOrbitDeploys();
        return null;
      },
      setPreviewBounds: async () => true,
      setPreviewZoom: async () => true,
      startServer: async (_event, cwd, nameOrPort) => {
        if (typeof nameOrPort === "number") return launch.startPackageScript(asString(cwd) ?? process.cwd(), "dev", nameOrPort);
        return launch.startFromConfig(asString(cwd) ?? process.cwd(), asString(nameOrPort) ?? undefined);
      },
      restartServer: async (_event, serverId) => launch.restartServer(String(serverId ?? "")),
      readServerFile: async (_event, filePath) => fs.readFile(String(filePath), "utf8").catch(() => null),
      writeServerFile: async (_event, filePath, content) => {
        await fs.mkdir(path.dirname(String(filePath)), { recursive: true });
        await fs.writeFile(String(filePath), String(content ?? ""));
        return true;
      },
      validateService: async (_event, cwd, name) => {
        const services = await launch.getConfiguredServices(asString(cwd) ?? process.cwd());
        return { valid: services.some((service) => !name || service.name === name), services };
      },
      waitForServer: async (_event, serverId, timeoutMs) => launch.waitForServer(String(serverId ?? ""), Number(timeoutMs) || 15000),
    },
    FloatingPenguinMini: {
      requestToggleMini: async () => {
        miniExpanded = !miniExpanded;
        return miniExpanded;
      },
      requestSetMiniExpanded: async (_event, expanded) => {
        miniExpanded = Boolean(expanded);
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
      getOpenDocuments: async () => [],
      readOpenDocumentAsBase64: async () => null,
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

  registerInterfaceSyncHandlers("claude.web", "ClaudeVM", {
    isHostLoopModeEnabled: () => false,
    isHostLoopDevOverrideActive: () => false,
  }, "claude.web.ClaudeVM");
  registerInterfaceSyncHandlers("claude.web", "Launch", {
    isAvailable: () => true,
  }, "claude.web.Launch");

  registerNamespaceHandlers("claude.settings", {
    Custom3pSetup: {
      writeConfig: async (_event, idOrInput, maybeConfig) => {
        const idValue = asString(idOrInput);
        if (idValue) return context.settings.writeCustom3pConfig(idValue, maybeConfig);
        const input = asObject(idOrInput);
        return context.settings.createCustom3pConfig(asString(input.name) ?? "Custom config", input.config ?? input);
      },
      setDeploymentMode: async (_event, mode) => context.settings.setPreference("deploymentMode", mode),
      triggerBootstrapAuth: async () => ({ ok: false, reason: "bootstrap_auth_not_required" }),
    },
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
        await installDxtArchive(context.settings.getUserDataDir(), source);
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
