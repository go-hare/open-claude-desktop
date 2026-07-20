import { app, BrowserWindow, desktopCapturer, dialog, shell } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { installClaudeChromeExtension, isClaudeChromeExtensionInstalled, openChromeExtensionListing, restartChromeForExtension } from "../services/chrome/chromeExtension";
import {
  ensureExtensionFolders,
  installDxtArchive,
  revealInstalledExtension,
} from "../services/extensions/desktopExtensions";
import { FeatureStateStore } from "../services/featureState/featureStateStore";
import { LocalLaunchManager } from "../services/launch/localLaunchManager";
import { getLocalSkillFiles, listLocalSkills } from "../services/localSessions/localAgentAssets";
import { mcpConfigEntries, requestMcpServer } from "../services/mcp/mcpRuntime";
import { listOpenDocuments, readOpenDocumentAsBase64 } from "../services/openDocuments/openDocumentsStore";
import {
  coworkAccountStorageDir,
  resolveCoworkAutoMemoryDir,
} from "../services/coworkSessions/coworkAutoMemoryPaths";
import { getComputerUseTccState, openTccSystemSettings, requestAccessibilityGrant, requestScreenRecordingGrant } from "../services/tcc/computerUseTcc";
import type { IpcHandlerContext } from "./context";
import { originalEventSurface } from "./originalEventSurface";
import { dispatchBridgeEvent, registerInterfaceSyncHandlers, registerNamespaceHandlers } from "./registerIpc";
import { runScheduledTaskNow } from "./scheduledTasksHandlers";

const execFileAsync = promisify(execFile);

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
  const events = originalEventSurface(context);
  const featureState = new FeatureStateStore();
  const launch = new LocalLaunchManager();
  const spaces = featureState.loadMap<Record<string, unknown>>("spaces");
  const artifacts = featureState.loadMap<Record<string, unknown>>("artifacts");
  const memories = featureState.loadMap<string>("memories");
  const orbitDeploys = featureState.loadMap<Record<string, unknown>>("orbitDeploys");
  const customMarketplaces = featureState.loadMap<Record<string, unknown>>("customMarketplaces");
  const localPlugins = featureState.loadMap<Record<string, unknown>>("localPlugins");
  const vmStateMap = featureState.loadMap<Record<string, unknown>>("vmState");
  const persistSpaces = () => featureState.saveMap("spaces", spaces);
  const persistArtifacts = () => featureState.saveMap("artifacts", artifacts);
  const persistMemories = () => featureState.saveMap("memories", memories);
  const persistOrbitDeploys = () => featureState.saveMap("orbitDeploys", orbitDeploys);
  const persistCustomMarketplaces = () => featureState.saveMap("customMarketplaces", customMarketplaces);
  const persistLocalPlugins = () => featureState.saveMap("localPlugins", localPlugins);
  const persistVmState = () => featureState.saveMap("vmState", vmStateMap);
  const installedPlugins = () => Array.from(localPlugins.values());
  const marketplacePlugins = () => Array.from(customMarketplaces.values()).map((marketplace) => ({ ...marketplace, source: "marketplace" }));
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
  let buddyInstalled = true;
  let buddyDevice: Record<string, unknown> | null = null;
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
  const vmState = () => ({
    downloadStatus: "downloaded",
    runningStatus: vmStateMap.get("runtime")?.status ?? "stopped",
    mode: "host-loop",
    platform: process.platform,
    updatedAt: vmStateMap.get("runtime")?.updatedAt,
  });
  const setVmRuntime = (status: string, extra: Record<string, unknown> = {}) => {
    const next = { status, mode: "host-loop", updatedAt: new Date().toISOString(), ...extra };
    vmStateMap.set("runtime", next);
    persistVmState();
    return next;
  };

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
        events.buddyPairingPrompt(String(buddyDevice.name ?? "Local Buddy"));
        events.buddyProgress("paired");
        return { paired: true, device: buddyDevice };
      },
      scanDevices: async () => {
        events.buddyProgress("scanning");
        return buddyDevice ? [buddyDevice] : [{ id: "local-buddy", name: "Local Buddy", transport: "local" }];
      },
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
      reportState: async (_event, state, details) => {
        events.buddyBleTx(String(state ?? ""));
        return ok({ state, details });
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
      download: async () => {
        const status = { status: "downloaded", mode: "host-loop", updatedAt: new Date().toISOString() };
        vmStateMap.set("download", status);
        persistVmState();
        events.claudeVmDownloadProgress(100);
        events.claudeVmDownloadStatusChanged(status);
        events.claudeVmApiReachabilityUpdated({ reachability: "ok", willTryRecover: false, mode: "host-loop" });
        return { success: true, status: "downloaded", mode: "host-loop" };
      },
      startVM: async (_event, options) => {
        const runtime = setVmRuntime("running", { options });
        events.claudeVmRunningStatusChanged(runtime);
        events.claudeVmApiReachabilityUpdated({ reachability: "ok", willTryRecover: false, mode: "host-loop" });
        return { success: true, ...runtime };
      },
      getDownloadStatus: async () => ({ status: "downloaded", mode: "host-loop" }),
      getRunningStatus: async () => vmState(),
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
        vmStateMap.clear();
        const runtime = setVmRuntime("stopped");
        events.claudeVmRunningStatusChanged(runtime);
        events.claudeVmDownloadStatusChanged({ status: "downloaded", mode: "host-loop" });
        return { success: true, status: "downloaded", mode: "host-loop" };
      },
      checkVirtualMachinePlatform: async () => ({ supported: true, mode: "host-loop", platform: process.platform }),
      enableVirtualMachinePlatform: async () => ({ success: true, restartNeeded: false, mode: "host-loop" }),
      restartAfterVMPInstall: async () => ({ success: true, restartNeeded: false, mode: "host-loop" }),
      apiReachability_$store$_getState: async () => ({ reachability: "ok", willTryRecover: false, mode: "host-loop" }),
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
      getAllArtifacts: async () => Array.from(artifacts.values()),
      getArtifactMetadata: async (_event, artifactId) => artifacts.get(String(artifactId)) ?? null,
      getArtifactIndexHtmlPath: async (_event, artifactId) => asString(artifacts.get(String(artifactId))?.indexHtmlPath) ?? null,
      getArtifactThumbnail: async (_event, artifactId) => {
        const artifact = artifacts.get(String(artifactId));
        const thumbnailPath = asString(artifact?.thumbnailPath);
        if (thumbnailPath) {
          const buffer = await fs.readFile(thumbnailPath).catch(() => null);
          if (buffer) return `data:image/${path.extname(thumbnailPath).slice(1) || "png"};base64,${buffer.toString("base64")}`;
        }
        const indexPath = asString(artifact?.indexHtmlPath);
        return indexPath ? captureUrlScreenshot(`file://${indexPath}`, { width: 640, height: 400 }) : null;
      },
      parkAndCaptureArtifact: async (_event, input) => {
        const artifact = { id: id("artifact"), createdAt: new Date().toISOString(), ...asObject(input) };
        artifacts.set(String(artifact.id), artifact);
        persistArtifacts();
        events.coworkArtifactsChanged();
        return artifact;
      },
      importArtifact: async (_event, input) => {
        const artifact = { id: id("artifact"), imported: true, createdAt: new Date().toISOString(), ...asObject(input) };
        artifacts.set(String(artifact.id), artifact);
        persistArtifacts();
        events.coworkArtifactsChanged();
        return artifact;
      },
      deleteArtifact: async (_event, artifactId) => {
        const deleted = artifacts.delete(String(artifactId));
        persistArtifacts();
        if (deleted) events.coworkArtifactsChanged();
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
      shareArtifact: async (_event, artifactId) => {
        const existing = artifacts.get(String(artifactId)) ?? { id: String(artifactId) };
        const updated = { ...existing, shared: true, shareUrl: `cowork-artifact://${String(artifactId)}` };
        artifacts.set(String(artifactId), updated);
        persistArtifacts();
        events.coworkArtifactsChanged();
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
        events.coworkArtifactsChanged();
        return updated;
      },
      isSharingEnabled: async () => true,
      showArtifact: async () => true,
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
      classifySessions: async () => classifyLocalSessions(),
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
      /**
       * Official CoworkSpaces.getAutoMemoryDir(spaceId):
       *   spaces.has(spaceId) ? ZrA(accountId, orgId, spaceId) : null
       * (was inventing userData/cowork-memory — corrected to product path).
       */
      getAutoMemoryDir: async (_event, spaceId) => {
        const id = asString(spaceId);
        if (!id || !spaces.has(id)) return null;
        const identity = context.coworkAccount.getIdentity();
        if (!identity?.accountUuid || !identity?.organizationUuid) return null;
        return resolveCoworkAutoMemoryDir(
          coworkAccountStorageDir(
            app.getPath("userData"),
            identity.accountUuid,
            identity.organizationUuid,
          ),
          { spaceId: id },
        );
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
        events.customPluginsInstallProgress(String(record.id), "installed");
        return record;
      },
      updatePlugin: async (_event, pluginId, update) => {
        const existing = localPlugins.get(String(pluginId)) ?? { id: String(pluginId) };
        const updated = { ...existing, update, updatedAt: new Date().toISOString() };
        localPlugins.set(String(pluginId), updated);
        persistLocalPlugins();
        events.customPluginsInstallProgress(String(pluginId), "updated");
        return updated;
      },
      uninstallPlugin: async (_event, pluginId) => {
        const deleted = localPlugins.delete(String(pluginId));
        persistLocalPlugins();
        return deleted;
      },
      listInstalledPlugins: async () => installedPlugins(),
      listAvailablePlugins: async () => [...marketplacePlugins(), ...installedPlugins()],
      getCachedCommands: async () => cachedCommands(),
      getInstallCounts: async () => ({}),
      listRemotePluginsPage: async () => ({ items: marketplacePlugins(), nextPage: null }),
      checkPluginHasLocalChanges: async (_event, pluginId) => {
        const plugin = localPlugins.get(String(pluginId));
        const pluginPath = asString(plugin?.path) ?? asString(asObject(plugin?.plugin).path);
        if (!pluginPath) return false;
        try { await fs.access(pluginPath); return true; } catch { return false; }
      },
      getAndClearMigrationIssues: async () => {
        const issues = [];
        for (const plugin of installedPlugins()) {
          const pluginPath = asString(plugin.path) ?? asString(asObject(plugin.plugin).path);
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
        const record = { id: id("plugin"), installedAt: new Date().toISOString(), source: "local-org", path: target };
        localPlugins.set(String(record.id), record);
        persistLocalPlugins();
        events.customPluginsInstallProgress(String(record.id), "installed");
        return { success: true, pluginId: record.id };
      },
    },
    LocalPlugins: {
      getPlugins: async () => installedPlugins(),
      deletePlugin: async (_event, pluginId) => {
        const deleted = localPlugins.delete(String(pluginId));
        persistLocalPlugins();
        return deleted;
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
      syncRemotePlugins: async () => installedPlugins(),
      uploadPlugin: async (_event, pluginPath) => {
        const target = asString(pluginPath) ?? asString(asObject(pluginPath).path);
        if (!target) return { success: false, error: "missing plugin path" };
        const record = { id: id("plugin"), uploadedAt: new Date().toISOString(), source: "local-upload", path: target };
        localPlugins.set(String(record.id), record);
        persistLocalPlugins();
        events.localPluginsCliOpAlwaysAllowed([String(record.id)]);
        return { success: true, pluginId: record.id };
      },
    },
    // Official lr (c11959232): listSources(cwd), attach(cwd, sessionName) → {sessionId,name,width,height}.
    FramebufferPreview: {
      listSources: async (_event, _cwd?: unknown) => {
        const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 200 } });
        return sources.map((source) => ({
          id: source.id,
          name: source.name,
          displayId: source.display_id,
          origin: source.display_id || source.id,
          appIcon: source.appIcon?.isEmpty() ? undefined : source.appIcon?.toDataURL(),
          thumbnail: source.thumbnail.isEmpty() ? undefined : source.thumbnail.toDataURL(),
        }));
      },
      attach: async (_event, cwdOrSource: unknown, sessionName?: unknown) => {
        // Official web: attach(cwd: string, sessionName: string).
        // Legacy/stub: attach(source: object) still accepted.
        if (typeof cwdOrSource === "string") {
          const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 1, height: 1 } });
          const primary = sources[0];
          if (!primary) return null;
          const name = asString(sessionName) || primary.name || "Screen";
          const sessionId = `${cwdOrSource}::${name}`;
          const width = 1280;
          const height = 720;
          framebufferSource = {
            id: sessionId,
            name,
            width,
            height,
            sourceId: primary.id,
            cwd: cwdOrSource,
          };
          events.framebufferSessionResized(sessionId, width, height);
          return { sessionId, name, width, height, attached: true, source: framebufferSource };
        }
        framebufferSource = asObject(cwdOrSource);
        const sessionId = String(framebufferSource.id ?? framebufferSource.sessionId ?? "default");
        const width = Number(framebufferSource.width ?? 0) || 0;
        const height = Number(framebufferSource.height ?? 0) || 0;
        events.framebufferSessionResized(sessionId, width, height);
        return {
          sessionId,
          name: asString(framebufferSource.name) ?? undefined,
          width,
          height,
          attached: true,
          source: framebufferSource,
        };
      },
      detach: async (_event, _sessionId?: unknown) => {
        // Official: detach is intentional unmount — do NOT emit sessionFatal
        // (that event is for hard failures; Strict Mode remount + cleanup would
        // otherwise race the next attach into the error UI).
        framebufferSource = null;
        return true;
      },
      requestFramePort: async () => {
        // Full RFB frame MessagePort not wired in open-claude-desktop yet — UI canvas shell after attach.
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
      destroyPreview: async () => true,
      getPreviewUrl: async (_event, serverId) => previewUrl ?? launch.getPreviewUrl(asString(serverId) ?? undefined),
      getLogs: async (_event, serverId) => launch.getLogs(String(serverId ?? "")),
      capturePreviewScreenshot: async (_event, urlOrOptions, maybeOptions) => {
        const target = asString(urlOrOptions) ?? asString(asObject(urlOrOptions).url) ?? previewUrl ?? launch.getPreviewUrl(asString(asObject(urlOrOptions).serverId) ?? undefined);
        if (!target) return null;
        return captureUrlScreenshot(target, maybeOptions ?? urlOrOptions);
      },
      clearPreviewViewport: async () => true,
      goBack: async () => true,
      goForward: async () => true,
      hidePreview: async () => true,
      showPreview: async () => true,
      loadHtmlPreview: async (_event, filePath) => {
        const target = asString(filePath);
        if (!target) return "";
        previewUrl = `file://${target}`;
        return previewUrl;
      },
      navigatePreview: async (_event, url) => {
        previewUrl = asString(url) ?? asString(asObject(url).url) ?? previewUrl;
        return ok({ url: previewUrl });
      },
      pickHtmlFile: async (_event, cwd) => {
        const result = await dialog.showOpenDialog(context.windows.mainWindow, { defaultPath: asString(cwd) ?? undefined, properties: ["openFile"], filters: [{ name: "HTML", extensions: ["html", "htm"] }] });
        return result.canceled ? null : result.filePaths[0] ?? null;
      },
      refreshPreview: async () => true,
      setPreviewColorScheme: async () => true,
      setPreviewViewport: async () => true,
      startFromConfig: async (_event, cwd, name) => rememberPreview(await launch.startFromConfig(asString(cwd) ?? process.cwd(), asString(name) ?? undefined)),
      stopServer: async (_event, serverId) => {
        const stopped = await launch.stopServer(String(serverId ?? ""));
        events.launchActiveServersUpdated(launch.getActiveServers());
        return stopped;
      },
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

  registerInterfaceSyncHandlers("claude.web", "ClaudeVM", {
    // Official v4() feature gate 1143815894 is not bridged yet; report disabled
    // rather than hard-true. Dev force path remains env + override based.
    isHostLoopModeEnabled: () => {
      if (featureState.getBoolean("vmForceDisableHostLoop", "global", false)) return false;
      const forced =
        process.env.CLAUDE_FORCE_HOST_LOOP === "1"
        && (globalThis as { isDeveloperApprovedDevUrlOverrideEnabled?: boolean })
          .isDeveloperApprovedDevUrlOverrideEnabled === true;
      if (forced) return true;
      const feature = process.env.CLAUDE_HOST_LOOP_FEATURE ?? process.env.CLAUDE_HOST_LOOP_FLAG;
      return feature === "1" || feature === "true";
    },
    isHostLoopDevOverrideActive: () =>
      process.env.CLAUDE_FORCE_HOST_LOOP === "1"
      && (globalThis as { isDeveloperApprovedDevUrlOverrideEnabled?: boolean })
        .isDeveloperApprovedDevUrlOverrideEnabled === true,
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
