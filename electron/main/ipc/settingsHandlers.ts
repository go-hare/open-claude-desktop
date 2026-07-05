import { app, dialog, globalShortcut, net, shell } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { custom3pBootstrapState, custom3pHealth, custom3pLoginDesktopStatus } from "../services/custom3p/custom3pStatus";
import {
  deleteInstalledExtension,
  ensureExtensionFolders,
  getInstalledExtension,
  installDxtArchive,
  installUnpackedExtension,
  listInstalledExtensions,
  revealInstalledExtension,
  setInstalledExtensionEnabled,
  setInstalledExtensionSettings,
} from "../services/extensions/desktopExtensions";
import { handleSupportBundleAction } from "../services/support/supportBundle";
import { openCustom3pSetupWindow } from "../windows/custom3pSetupWindow";
import type { IpcHandlerContext } from "./context";
import { dispatchBridgeEvent, registerInterfaceSyncHandlers, registerNamespaceHandlers } from "./registerIpc";

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function configNameFromInput(input: unknown): string {
  if (typeof input === "string") return input;
  const record = asObject(input);
  return asString(record.name) ?? asString(record.id) ?? "Custom config";
}

function custom3pConfigInput(input: unknown): unknown {
  const record = asObject(input);
  return record.config ?? input ?? { inferenceProvider: "gateway" };
}

function ensureCustom3pConfig(settings: IpcHandlerContext["settings"]) {
  const existing = settings.listCustom3pConfigs();
  if (existing.length > 0) {
    if (!settings.getAppliedCustom3pConfigId()) settings.setAppliedCustom3pConfig(existing[0]!.id);
    return existing;
  }
  const created = settings.createCustom3pConfig("Claude-Deepseek Gateway", { inferenceProvider: "gateway" });
  settings.setAppliedCustom3pConfig(created.id);
  return [created];
}

function custom3pConfigList(settings: IpcHandlerContext["settings"]) {
  const entries = ensureCustom3pConfig(settings).map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt }));
  return {
    entries,
    appliedId: settings.getAppliedCustom3pConfigId() ?? entries[0]?.id ?? "",
    isManaged: false,
    platform: process.platform,
  };
}

function configureGlobalShortcut(context: IpcHandlerContext, accelerator: unknown): boolean {
  const value = typeof accelerator === "string" && accelerator.length > 0 ? accelerator : null;
  const previous = context.settings.getGlobalShortcut();
  if (previous) globalShortcut.unregister(previous);
  if (!value) return context.settings.setGlobalShortcut(null);

  const registered = globalShortcut.register(value, () => {
    context.windows.mainWindow.show();
    context.windows.mainWindow.focus();
    context.windows.mainView.webContents.focus();
  });
  if (!registered) return false;
  context.settings.setGlobalShortcut(value);
  dispatchBridgeEvent(context.windows.mainView.webContents, "claude.settings", "GlobalShortcut", "globalShortcutChange", value);
  return true;
}

async function choosePath(context: IpcHandlerContext, mode: "file" | "directory", options: unknown) {
  const opts = asObject(options);
  const allowMultiSelections = typeof options === "boolean" ? options : Boolean(opts.multiSelections);
  const result = await dialog.showOpenDialog(context.windows.mainWindow, {
    title: asString(opts.title) ?? undefined,
    defaultPath: asString(opts.defaultPath) ?? undefined,
    properties: mode === "file"
      ? ["openFile", ...(allowMultiSelections ? ["multiSelections" as const] : [])]
      : ["openDirectory", ...(allowMultiSelections ? ["multiSelections" as const] : [])],
  });
  return result.canceled ? [] : result.filePaths;
}

function dispatchExtensionsChanged(context: IpcHandlerContext): void {
  dispatchBridgeEvent(context.windows.mainView.webContents, "claude.settings", "Extensions", "extensionsChanged");
}

function dispatchExtensionSettingsChanged(context: IpcHandlerContext, extensionId: string, settings: unknown): void {
  dispatchBridgeEvent(context.windows.mainView.webContents, "claude.settings", "Extensions", "extensionSettingsChanged", extensionId, settings);
}

function extensionUserDataDir(context: IpcHandlerContext): string {
  return context.settings.getUserDataDir();
}

function extensionDirectoryUrl(context: IpcHandlerContext): string {
  return `app://localhost/api/organizations/local/dxt`;
}

async function exportCustom3pConfig(context: IpcHandlerContext, id: unknown, format: unknown) {
  if (typeof id !== "string") return { ok: false, error: "invalid id" };
  const record = context.settings.readCustom3pConfig(id);
  if (!record) return { ok: false, error: "config not found" };
  const exportFormat = format === "reg" ? "reg" : "mobileconfig";
  const defaultName = `${record.name.replace(/[^a-z0-9._-]+/gi, "-") || "claude-3p-config"}.${exportFormat}`;
  const result = await dialog.showSaveDialog(context.windows.mainWindow, {
    title: "Export Claude configuration",
    defaultPath: defaultName,
    filters: exportFormat === "reg"
      ? [{ name: "Windows Registry", extensions: ["reg"] }]
      : [{ name: "Configuration Profile", extensions: ["mobileconfig"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  const payload = exportFormat === "reg"
    ? [
        "Windows Registry Editor Version 5.00",
        "",
        "[HKEY_CURRENT_USER\\Software\\Anthropic\\Claude\\ThirdParty]",
        `"Config"=${JSON.stringify(JSON.stringify(record.config))}`,
        "",
      ].join("\r\n")
    : [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
        "<plist version=\"1.0\">",
        "<dict>",
        "  <key>PayloadType</key><string>com.anthropic.claude.third-party</string>",
        "  <key>PayloadVersion</key><integer>1</integer>",
        `  <key>PayloadIdentifier</key><string>com.anthropic.claude.${record.id}</string>`,
        `  <key>PayloadDisplayName</key><string>${record.name.replace(/[<>&]/g, "")}</string>`,
        `  <key>ConfigJSON</key><string>${JSON.stringify(record.config).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`,
        "</dict>",
        "</plist>",
        "",
      ].join("\n");
  await fs.writeFile(result.filePath, payload);
  return { ok: true, path: result.filePath };
}

function normalizeProbeHost(host: string): string | null {
  const trimmed = host.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("*.")) return trimmed.slice(2);
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0] || null;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("timed out")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function probeEgressHost(host: string) {
  const normalized = normalizeProbeHost(host);
  if (!normalized) return { host, reachable: false, error: "invalid host" };
  const started = Date.now();
  try {
    const response = await withTimeout(net.fetch(`https://${normalized}`, {
      method: "HEAD",
      bypassCustomProtocolHandlers: true,
    }), 5000);
    return { host, reachable: response.status < 500, latencyMs: Date.now() - started, ...(response.ok ? {} : { error: `HTTP ${response.status}` }) };
  } catch (error) {
    return { host, reachable: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

async function probeMcpServerConfig(config: unknown) {
  const record = asObject(config);
  const url = asString(record.url);
  const name = asString(record.name);
  const transport = asString(record.transport) ?? (url ? "http" : "stdio");
  if (!url) return { kind: "err", title: "Missing URL", message: "MCP server URL is required for network probing." };
  const started = Date.now();
  try {
    const response = await withTimeout(net.fetch(url, {
      method: "HEAD",
      bypassCustomProtocolHandlers: true,
    }), 5000);
    const latencyMs = Date.now() - started;
    if (response.status === 401 || response.status === 403) return { kind: "auth", serverName: name, transport, latencyMs, request: url };
    if (!response.ok) return { kind: "err", title: `HTTP ${response.status}`, message: response.statusText, request: url, latencyMs };
    return { kind: "ok", serverName: name, transport, latencyMs, tools: [] };
  } catch (error) {
    return { kind: "err", title: "Connection failed", message: error instanceof Error ? error.message : String(error), request: url, latencyMs: Date.now() - started };
  }
}

export function registerSettingsHandlers(context: IpcHandlerContext): void {
  const settings = context.settings;
  const mainView = context.windows.mainView.webContents;

  registerNamespaceHandlers("claude.settings", {
    AppConfig: {
      getAppConfig: async () => settings.getAppConfig(),
      setAppFeature: async (_event, key, value) => (typeof key === "string" ? settings.setAppFeature(key, value) : false),
      setIsUsingBuiltInNodeForMcp: async (_event, value) => settings.setAppFeature("isUsingBuiltInNodeForMcp", Boolean(value)),
      setIsDxtAutoUpdatesEnabled: async (_event, value) => settings.setAppFeature("isDxtAutoUpdatesEnabled", Boolean(value)),
    },
    AppFeatures: {
      getSupportedFeatures: async () => settings.getSupportedFeatures(),
    },
    AppPreferences: {
      getPreferences: async () => settings.getPreferences(),
      setPreference: async (_event, key, value) => {
        if (typeof key !== "string") return false;
        const result = settings.setPreference(key, value);
        dispatchBridgeEvent(mainView, "claude.settings", "AppPreferences", "preferencesChanged", settings.getPreferences());
        return result;
      },
      preferencesChanged: async () => settings.getPreferences(),
    },
    Startup: {
      isStartupOnLoginEnabled: async () => app.getLoginItemSettings().openAtLogin,
      setStartupOnLoginEnabled: async (_event, enabled) => {
        app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
        return app.getLoginItemSettings().openAtLogin === Boolean(enabled);
      },
      isMenuBarEnabled: async () => settings.isMenuBarEnabled(),
      setMenuBarEnabled: async (_event, enabled) => settings.setMenuBarEnabled(Boolean(enabled)),
    },
    GlobalShortcut: {
      setGlobalShortcut: async (_event, accelerator) => configureGlobalShortcut(context, accelerator),
      getGlobalShortcut: async () => settings.getGlobalShortcut(),
      globalShortcutChange: async () => settings.getGlobalShortcut(),
    },
    MCP: {
      isLocalDevMcpEnabled: async () => Boolean(settings.getAppConfig().isLocalDevMcpEnabled),
      setMcpServerConfigs: async (_event, config) => settings.setMcpServersConfig(asObject(config)),
      getMcpServersConfig: async () => settings.getMcpServersConfig(),
      getMcpServersConfigWithStatus: async () => {
        const config = settings.getMcpServersConfig();
        return Object.fromEntries(Object.entries(config).map(([name, value]) => [name, { config: value, status: "configured" }]));
      },
      revealConfig: async () => {
        shell.showItemInFolder(settings.getMcpConfigFile());
        return true;
      },
      revealLogs: async () => {
        await shell.openPath(settings.getLogsDir());
        return true;
      },
      revealServerLog: async (_event, serverName) => {
        const logFile = path.join(settings.getLogsDir(), `${String(serverName ?? "mcp")}.log`);
        shell.showItemInFolder(logFile);
        return true;
      },
      mcpConfigChange: async () => settings.getMcpServersConfig(),
      mcpStatusChanged: async () => null,
      revealMcpServerSettingsRequested: async () => null,
    },
    FilePickers: {
      getDirectoryPath: async (_event, options) => choosePath(context, "directory", options),
      getFilePath: async (_event, options) => choosePath(context, "file", options),
    },
    DesktopInfo: {
      getSystemInfo: async () => ({
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        hostname: os.hostname(),
        appVersion: app.getVersion(),
        app_version: app.getVersion(),
        os_version: `${process.platform} ${os.release()}`,
        cpu_model: os.cpus()[0]?.model ?? "unknown",
        total_memory: os.totalmem(),
        can_elevate_to_admin: null,
        is_msix: false,
        userData: app.getPath("userData"),
        logs: app.getPath("logs"),
      }),
      showLogsInFileManager: async () => {
        await shell.openPath(settings.getLogsDir());
        return true;
      },
    },
    WakeScheduler: {
      getStatus: async () => ({ enabled: false, supported: process.platform === "darwin" }),
      openSettings: async () => {
        await shell.openExternal("x-apple.systempreferences:com.apple.Battery-Settings.extension");
        return true;
      },
    },
    Custom3pHelperRun: {
      getCredentialHelperLastRun: async () => settings.getCredentialHelperLastRun(),
      runCredentialHelper: async (_event, input) => {
        const result = { ranAt: new Date().toISOString(), input: asObject(input), ok: true };
        settings.setCredentialHelperLastRun(result);
        return result;
      },
    },
    Custom3pSetup: {
      listConfigs: async () => custom3pConfigList(settings),
      readConfig: async (_event, id) => {
        if (typeof id !== "string") return { ok: false, error: "invalid id" };
        const record = settings.readCustom3pConfig(id);
        return record ? { ok: true, config: record.config } : { ok: false, error: "config not found" };
      },
      writeConfig: async (_event, id, config) => {
        if (typeof id !== "string") return { ok: false, error: "invalid id" };
        const record = settings.writeCustom3pConfig(id, custom3pConfigInput(config));
        return record ? { ok: true } : { ok: false, error: "config not found" };
      },
      createConfig: async (_event, input) => settings.createCustom3pConfig(configNameFromInput(input), custom3pConfigInput(input)),
      duplicateConfig: async (_event, id, name) => (typeof id === "string" ? settings.duplicateCustom3pConfig(id, asString(name) ?? undefined) : null),
      renameConfig: async (_event, id, name) => (typeof id === "string" && typeof name === "string" ? settings.renameCustom3pConfig(id, name) : null),
      deleteConfig: async (_event, id) => {
        if (typeof id === "string") settings.deleteCustom3pConfig(id);
        return custom3pConfigList(settings);
      },
      exportConfig: async (_event, id, format) => exportCustom3pConfig(context, id, format),
      setAppliedConfig: async (_event, id) => (typeof id === "string" ? settings.setAppliedCustom3pConfig(id) : false),
      unsetAppliedConfig: async () => settings.setAppliedCustom3pConfig(null),
      revealConfig: async () => {
        shell.showItemInFolder(settings.getSettingsFile());
        return true;
      },
      getConfigHealth: async () => custom3pHealth(),
      recheckConfigHealth: async () => custom3pHealth(),
      probeEgressHosts: async (_event, hosts) => Promise.all((Array.isArray(hosts) ? hosts : []).filter((host): host is string => typeof host === "string").map(probeEgressHost)),
      probeMcpServer: async (_event, config) => probeMcpServerConfig(config),
      authorizeAndProbeMcpServer: async (_event, config) => probeMcpServerConfig(config),
      forgetMcpOAuth: async () => true,
      triggerBootstrapAuth: async () => ({ ok: true }),
      openSetupWindow: async () => {
        await openCustom3pSetupWindow(context.windows.mainWindow);
        return true;
      },
      openDeviceCodeWindowForE2e: async () => true,
      getLoginDesktop3pStatus: async () => custom3pLoginDesktopStatus(),
      relaunchApp: async () => {
        app.relaunch();
        app.exit(0);
        return true;
      },
      bootstrapState_: async () => custom3pBootstrapState(),
    },
    Extensions: {
      getInstalledExtensionsWithState: async () => listInstalledExtensions(extensionUserDataDir(context)),
      getExtensions: async (_event, request) => ({ data: { extensions: [] , ...(typeof request === "object" && request !== null ? { request } : {}) }, url: `${extensionDirectoryUrl(context)}/extensions` }),
      getExtension: async (_event, request) => ({ data: { ...(typeof request === "object" && request !== null ? request as Record<string, unknown> : {}), manifest: null }, url: `${extensionDirectoryUrl(context)}/extensions/${asString(asObject(request).id) ?? "unknown"}` }),
      getExtensionSettings: async (_event, extensionId) => (typeof extensionId === "string" ? (await getInstalledExtension(extensionUserDataDir(context), extensionId))?.settings ?? { isEnabled: true } : { isEnabled: true }),
      setExtensionSettings: async (_event, extensionId, patch) => {
        if (typeof extensionId !== "string") return false;
        const next = await setInstalledExtensionSettings(extensionUserDataDir(context), extensionId, patch);
        dispatchExtensionSettingsChanged(context, extensionId, next);
        dispatchExtensionsChanged(context);
        return true;
      },
      getExtensionVersion: async (_event, request) => ({ data: { ...(typeof request === "object" && request !== null ? request as Record<string, unknown> : {}) }, url: `${extensionDirectoryUrl(context)}/versions` }),
      getExtensionVersions: async (_event, request) => ({ data: { versions: [] , ...(typeof request === "object" && request !== null ? { request } : {}) }, url: `${extensionDirectoryUrl(context)}/versions` }),
      getAvailableExtensionRuntimes: async () => [
        { name: "Node.js", versions: [process.versions.node], builtInVersion: process.versions.node },
        { name: "Python", versions: [], builtInVersion: null },
      ],
      getDirectoryUrl: async () => extensionDirectoryUrl(context),
      getIsUpdateAvailable: async () => null,
      getManifestCompatibilityResult: async () => ({ compatible: true, requirements: [] }),
      installDxt: async (_event, extensionId, dxtPath) => {
        if (typeof dxtPath !== "string") return null;
        const installed = await installDxtArchive(extensionUserDataDir(context), dxtPath, typeof extensionId === "string" ? extensionId : null);
        dispatchExtensionsChanged(context);
        return installed.id;
      },
      installDxtFromDirectory: async (_event, extensionId) => {
        if (typeof extensionId !== "string") return null;
        return null;
      },
      installDxtUnpacked: async (_event, folderPath) => {
        if (typeof folderPath !== "string") return null;
        const installed = await installUnpackedExtension(extensionUserDataDir(context), folderPath);
        dispatchExtensionsChanged(context);
        return installed.id;
      },
      installExtensionFromPreview: async (_event, extensionId, dxtPath) => {
        if (typeof dxtPath !== "string") return null;
        const installed = await installDxtArchive(extensionUserDataDir(context), dxtPath, typeof extensionId === "string" ? extensionId : null);
        dispatchExtensionsChanged(context);
        return installed.id;
      },
      handleDxtFile: async (_event, dxtPath) => {
        if (typeof dxtPath !== "string") return;
        await installDxtArchive(extensionUserDataDir(context), dxtPath);
        dispatchExtensionsChanged(context);
      },
      deleteExtension: async (_event, extensionId) => {
        if (typeof extensionId !== "string") return false;
        const deleted = await deleteInstalledExtension(extensionUserDataDir(context), extensionId);
        dispatchExtensionsChanged(context);
        return deleted;
      },
      uninstallExtension: async (_event, extensionId) => {
        if (typeof extensionId !== "string") return false;
        const deleted = await deleteInstalledExtension(extensionUserDataDir(context), extensionId);
        dispatchExtensionsChanged(context);
        return deleted;
      },
      updateExtension: async () => false,
      openDirectory: async () => shell.openPath((await ensureExtensionFolders(extensionUserDataDir(context))).extensionsDir),
      openExtensionDirectory: async () => shell.openPath((await ensureExtensionFolders(extensionUserDataDir(context))).extensionsDir),
      openLogsDirectory: async () => shell.openPath(settings.getLogsDir()),
      revealExtension: async (_event, extensionId) => (typeof extensionId === "string" ? revealInstalledExtension(extensionUserDataDir(context), extensionId) : false),
      reloadExtension: async () => true,
      isDesktopExtensionDirectoryEnabled: async () => true,
      setDesktopExtensionDirectoryEnabled: async (_event, enabled) => settings.setAppFeature("isDxtDirectoryEnabled", Boolean(enabled)),
      setExtensionEnabled: async (_event, extensionId, enabled) => {
        if (typeof extensionId !== "string") return false;
        const next = await setInstalledExtensionEnabled(extensionUserDataDir(context), extensionId, Boolean(enabled));
        dispatchExtensionSettingsChanged(context, extensionId, next);
        dispatchExtensionsChanged(context);
        return true;
      },
      extensionsChanged: async () => [],
      extensionSettingsChanged: async () => ({}),
      extensionDownloadProgress: async () => null,
    },
    SupportBundle: {
      submitAction: async (_event, action) => handleSupportBundleAction(context, action),
      supportBundleState_: async () => null,
    },
  });

  registerNamespaceHandlers("claude.hybrid", {
    DesktopIntl: {
      getInitialLocale: async () => ({ messages: {}, locale: app.getLocale() || "en-US" }),
      requestLocaleChange: async (_event, locale) => {
        settings.setPreference("locale", locale);
        dispatchBridgeEvent(mainView, "claude.hybrid", "DesktopIntl", "localeChanged", locale);
        return true;
      },
      localeChanged: async () => null,
    },
  });

  registerInterfaceSyncHandlers("claude.hybrid", "DesktopIntl", {
    getInitialLocale: () => ({ messages: {}, locale: app.getLocale() || "en-US" }),
  });
}
