import { app, dialog, globalShortcut, net, shell } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCustom3pConfigLibraryEntry,
  deleteCustom3pConfigLibraryEntry,
  duplicateCustom3pConfigLibraryEntry,
  listCustom3pConfigLibrary,
  migrateLegacyShellCustom3pConfigsToLibrary,
  readCustom3pConfigLibrary,
  renameCustom3pConfigLibraryEntry,
  revealCustom3pConfigLibraryPath,
  setAppliedCustom3pConfigLibraryId,
  writeCustom3pConfigLibrary,
} from "../services/custom3p/custom3pConfigLibrary";
import {
  DOT_CLAUDE_SETUP_CONFIG_ID,
  DOT_CLAUDE_SETUP_CONFIG_NAME,
  isDotClaudeSetupConfigId,
  listDotClaudeAsConfigLibrary,
  readDotClaudeAsConfigLibrary,
  revealDotClaudeSettingsPath,
  writeDotClaudeAsConfigLibrary,
} from "../services/custom3p/dotClaudeSetupBridge";
import {
  getConfigHealth as getCustom3pConfigHealth,
  invalidateConfigHealthCache,
  recheckConfigHealth as recheckCustom3pConfigHealth,
} from "../services/custom3p/custom3pConfigHealth";
import { custom3pBootstrapState, custom3pLoginDesktopStatus } from "../services/custom3p/custom3pStatus";
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
  updateInstalledExtension,
} from "../services/extensions/desktopExtensions";
import { describeMcpServer, mcpConfigEntries } from "../services/mcp/mcpRuntime";
import { handleSupportBundleAction } from "../services/support/supportBundle";
import { openCustom3pSetupWindow } from "../windows/custom3pSetupWindow";
import {
  applyKeepAwakeEnabled,
  syncKeepAwakeFromPreferences,
} from "../services/settings/keepAwake";
import {
  configureMenuBarTray,
  showMainWindowFromTray,
  syncMenuBarTray,
} from "../services/settings/menuBarTray";
import {
  runPreferencePostWriteEffects,
  runPreferencePreWriteHook,
} from "../services/settings/preferenceEffects";
import { resolveElectronShellPaths } from "../paths/electronShellPaths";
import {
  ensureWakeSchedulerController,
  getWakeSchedulerStatus,
  openWakeSchedulerSettings,
} from "../services/settings/wakeScheduler";
import {
  ensureNativeQuickEntry,
  tryActivateNativeQuickEntry,
} from "../services/settings/quickEntryNative";
import type { IpcHandlerContext } from "./context";
import { originalEventSurface } from "./originalEventSurface";
import { dispatchBridgeEvent, registerInterfaceSyncHandlers, registerNamespaceHandlers } from "./registerIpc";

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function applyKeepAwakeEnabledIfNeeded(key: string, value: unknown): void {
  if (key === "keepAwakeEnabled") {
    applyKeepAwakeEnabled(value === true);
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function configNameFromInput(input: unknown): string {
  if (typeof input === "string") return input;
  const record = asObject(input);
  return asString(record.name) ?? asString(record.id) ?? "Custom config";
}

/**
 * Official Cgr residual: create starts with empty bag (or explicit config).
 * Do not invent `{ inferenceProvider: "gateway" }` — that false-activates 3p.
 */
function custom3pConfigInput(input: unknown): unknown {
  if (input == null || typeof input === "string") return {};
  const record = asObject(input);
  if ("config" in record) return record.config ?? {};
  const rest: Record<string, unknown> = { ...record };
  delete rest.name;
  delete rest.id;
  return rest;
}

function settingsUserDataPath(context: IpcHandlerContext): string {
  try {
    return path.dirname(context.settings.getSettingsFile());
  } catch {
    return app.getPath("userData");
  }
}

/**
 * Official wrA residual: multi-config lives in userData/configLibrary.
 * One-shot migrate legacy desktop-shell-settings custom3pConfigs when library empty.
 */
function ensureCustom3pConfigLibrary(context: IpcHandlerContext): string {
  const userDataPath = settingsUserDataPath(context);
  try {
    migrateLegacyShellCustom3pConfigsToLibrary(userDataPath, {
      appliedCustom3pConfigId: context.settings.getAppliedCustom3pConfigId?.() ?? null,
      custom3pConfigs: Object.fromEntries(
        (context.settings.listCustom3pConfigs?.() ?? []).map((row) => [
          row.id,
          { id: row.id, name: row.name, config: row.config },
        ]),
      ),
    });
  } catch {
    // Migration is best-effort; library APIs still work on empty dir.
  }
  return userDataPath;
}

/**
 * Official cgr residual list shape (+ product isManaged/platform fields).
 */
function custom3pConfigList(context: IpcHandlerContext) {
  const userDataPath = ensureCustom3pConfigLibrary(context);
  return listCustom3pConfigLibrary(userDataPath);
}

function publishCustom3pBootstrapState(context: IpcHandlerContext): unknown {
  // Config write/apply invalidates health cache so next get/recheck re-probes.
  invalidateConfigHealthCache();
  const state = custom3pBootstrapState(settingsUserDataPath(context));
  // IpcHandlerContext has no `events` field — use originalEventSurface residual
  // (same as registerSettingsHandlers local `events`). context.events was always
  // undefined → setDeploymentMode threw after writing bag → renderer first Gateway
  // click looked dead (IPC reject) until a second click.
  originalEventSurface(context).custom3pBootstrapStateUpdated(state);
  return state;
}

/** Login chose ~/.claude → Custom3pSetup must list/read/write that file, not configLibrary. */
function isDotClaudeDeploymentMode(context: IpcHandlerContext): boolean {
  // SettingsStore exposes getPreferences() only (no singular getPreference).
  return context.settings.getPreferences()?.deploymentMode === "dotClaude";
}

/**
 * Official IKA residual (app.asar Sst.requestQuickWindowDismissWithPayload):
 *   if (text.trim().length > 2 || images.length) {
 *     analytics + process
 *     if chatId === undefined → FSe (new chat dispatchOnQuickEntrySubmit)
 *     else if main visible → svi(payload) else FSe
 *   } else restore prior focus (mst) — short prompts are residual no-op
 *
 * FSe: if mainView loaded → dispatchOnQuickEntrySubmit; else loadURL root then dispatch.
 * Product: mainView already hosts open-claude-web; dispatch + show/focus matches FSe/svi.
 */
function dispatchQuickEntrySubmitPayload(
  context: IpcHandlerContext,
  payload: {
    text: string;
    images: Array<{ base64: string; mimeType: string; filename?: string }>;
    chatId?: string;
  },
): void {
  const wc = context.windows.mainView.webContents;
  if (!wc || wc.isDestroyed()) {
    console.warn("[settingsHandlers] IKA: mainView webContents unavailable; dropping payload");
    return;
  }
  const send = () => {
    console.info("[settingsHandlers] IKA dispatchOnQuickEntrySubmit", {
      textLen: payload.text?.trim?.().length ?? 0,
      images: payload.images?.length ?? 0,
      chatId: payload.chatId ?? null,
      url: (() => {
        try {
          return wc.getURL();
        } catch {
          return null;
        }
      })(),
    });
    dispatchBridgeEvent(wc, "claude.web", "QuickEntry", "onQuickEntrySubmit", payload);
    try {
      showMainWindowFromTray(() => context.windows.mainWindow);
      context.windows.mainWindow.focus();
      wc.focus();
    } catch {
      /* ignore */
    }
  };
  // Official FSe: if still loading, wait for navigation then dispatch.
  if (wc.isLoading()) {
    console.info("[settingsHandlers] IKA: mainView loading — defer dispatch until did-finish-load");
    wc.once("did-finish-load", () => send());
    return;
  }
  send();
}

function quickEntryNativeDeps(context: IpcHandlerContext) {
  return {
    getMainWindow: () => context.windows.mainWindow,
    getMainViewWebContents: () => context.windows.mainView.webContents,
    account: context.coworkAccount,
    // Official owe residual: gi("quickEntryShortcut")
    getQuickEntryShortcut: () => context.settings.getPreferences().quickEntryShortcut,
    onSubmit: (payload: {
      text: string;
      images: Array<{ base64: string; mimeType: string; filename?: string }>;
      chatId?: string;
    }) => {
      // Official K9i → IKA residual (not raw always-dispatch).
      const text = typeof payload.text === "string" ? payload.text : "";
      const images = Array.isArray(payload.images) ? payload.images : [];
      const longEnough = text.trim().length > 2;
      const hasImages = images.length > 0;
      if (!longEnough && !hasImages) {
        // Official IKA else branch: short prompt — no web dispatch (Swift already shows
        // "Quick access prompts must be at least 3 characters").
        console.info("[settingsHandlers] IKA short prompt residual no-op", {
          textLen: text.trim().length,
        });
        return;
      }
      console.info("[settingsHandlers] IKA process quick entry", {
        textLen: text.trim().length,
        images: images.length,
        chatId: payload.chatId ?? null,
      });
      dispatchQuickEntrySubmitPayload(context, {
        text,
        images,
        chatId: payload.chatId,
      });
    },
    onNavigateToChat: (chatId: string) => {
      try {
        const wc = context.windows.mainView.webContents;
        if (!wc || wc.isDestroyed()) return;
        // Official cEr residual shape: /chat/:id?allow_dangling_human_message=1
        const current = wc.getURL();
        let origin = "https://claude.ai";
        try {
          origin = new URL(current).origin;
        } catch {
          /* keep default */
        }
        // Dev main view is localhost open-claude-web — keep current origin.
        void wc.loadURL(
          `${origin}/chat/${encodeURIComponent(chatId)}?allow_dangling_human_message=1`,
        );
      } catch {
        /* ignore */
      }
    },
    showMainWindow: () => {
      showMainWindowFromTray(() => context.windows.mainWindow);
      try {
        context.windows.mainView.webContents.focus();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Official Lst → yst residual:
 *   1) if i2A() (nr loaded + nativeQuickEntry supported): OSe ? H9i toggle : false
 *      → bottom native overlay + screenshot (Swift quickAccess.overlay)
 *   2) else Electron BrowserWindow quick panel (legacy, center residual)
 *   3) return false → Lst shows main
 *
 * Does not invent native success without real overlay.toggle.
 */
export async function activateQuickEntry(context: IpcHandlerContext): Promise<boolean> {
  // Official yst native branch first.
  try {
    const native = await tryActivateNativeQuickEntry(quickEntryNativeDeps(context));
    console.info("[settingsHandlers] yst native branch:", native);
    if (native === "handled") return true;
    if (native === "logged-out") {
      // Official: i2A && !OSe → return false → Lst shows main.
      try {
        showMainWindowFromTray(() => context.windows.mainWindow);
        context.windows.mainView.webContents.focus();
      } catch {
        /* ignore */
      }
      return false;
    }
  } catch (error) {
    console.warn("[settingsHandlers] native quick entry failed", error);
  }

  // Official yst Electron residual (legacyQuickEntry path when native unavailable).
  const openQuick = context.windows.secondaryWindows?.openQuickWindow;
  if (typeof openQuick === "function") {
    try {
      const win = await openQuick();
      // null = official toggle-dismiss while visible — still "handled" by yst.
      // BrowserWindow = shown. Either means Lst should not also open main.
      if (win === null || (win && !win.isDestroyed())) return true;
    } catch {
      /* fall through to main */
    }
  }
  try {
    showMainWindowFromTray(() => context.windows.mainWindow);
    context.windows.mainView.webContents.focus();
  } catch {
    /* ignore */
  }
  return false;
}

function acceleratorFromQuickEntryPreference(value: unknown): string | null {
  if (value === "off" || value === null || value === undefined) return null;
  if (value === "double-tap-option") {
    // Electron cannot register "double-tap Option"; product residual falls back
    // to Alt+Space so Quick Entry remains reachable without inventing native engine.
    return "Alt+Space";
  }
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "object" && value !== null) {
    const accelerator = (value as { accelerator?: unknown }).accelerator;
    if (typeof accelerator === "string" && accelerator.length > 0) return accelerator;
  }
  return null;
}

function configureGlobalShortcut(context: IpcHandlerContext, accelerator: unknown): boolean {
  const value = typeof accelerator === "string" && accelerator.length > 0 ? accelerator : null;
  const previous = context.settings.getGlobalShortcut();
  if (previous) {
    try {
      globalShortcut.unregister(previous);
    } catch {
      /* ignore unregister race */
    }
  }
  if (!value) {
    const result = context.settings.setGlobalShortcut(null);
    dispatchBridgeEvent(context.windows.mainView.webContents, "claude.settings", "GlobalShortcut", "globalShortcutChange", null);
    return result;
  }

  const registered = globalShortcut.register(value, () => {
    void activateQuickEntry(context);
  });
  if (!registered) return false;
  context.settings.setGlobalShortcut(value);
  dispatchBridgeEvent(context.windows.mainView.webContents, "claude.settings", "GlobalShortcut", "globalShortcutChange", value);
  return true;
}

/**
 * Sync Electron globalShortcut from quickEntryShortcut preference (native UI residual)
 * or legacy GlobalShortcut row. nativeQuickEntry flag itself follows official Dvi.
 *
 * Boot: prefer already-persisted globalShortcut (legacy row) so custom shortcuts
 * survive restart; fall back to quickEntryShortcut mapping (double-tap → Alt+Space).
 * Preference write of quickEntryShortcut always re-applies from that key.
 */
function syncQuickEntryShortcutFromPreferences(
  context: IpcHandlerContext,
  opts?: { preferPreference?: boolean },
): void {
  const prefs = context.settings.getPreferences();
  const fromPref = acceleratorFromQuickEntryPreference(prefs.quickEntryShortcut);
  const legacy = context.settings.getGlobalShortcut();
  if (opts?.preferPreference) {
    configureGlobalShortcut(context, fromPref);
    return;
  }
  const accelerator = legacy ?? fromPref;
  if (accelerator) configureGlobalShortcut(context, accelerator);
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

function buildCustom3pExportPayload(
  config: unknown,
  format: unknown,
  meta: { id: string; name: string },
): { exportFormat: "reg" | "mobileconfig"; defaultName: string; payload: string } {
  const exportFormat = format === "reg" ? "reg" : "mobileconfig";
  const defaultName = `${meta.name.replace(/[^a-z0-9._-]+/gi, "-") || "claude-3p-config"}.${exportFormat}`;
  const payload = exportFormat === "reg"
    ? [
        "Windows Registry Editor Version 5.00",
        "",
        "[HKEY_CURRENT_USER\\Software\\Anthropic\\Claude\\ThirdParty]",
        `"Config"=${JSON.stringify(JSON.stringify(config))}`,
        "",
      ].join("\r\n")
    : [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
        "<plist version=\"1.0\">",
        "<dict>",
        "  <key>PayloadType</key><string>com.anthropic.claude.third-party</string>",
        "  <key>PayloadVersion</key><integer>1</integer>",
        `  <key>PayloadIdentifier</key><string>com.anthropic.claude.${meta.id}</string>`,
        `  <key>PayloadDisplayName</key><string>${meta.name.replace(/[<>&]/g, "")}</string>`,
        `  <key>ConfigJSON</key><string>${JSON.stringify(config).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`,
        "</dict>",
        "</plist>",
        "",
      ].join("\n");
  return { exportFormat, defaultName, payload };
}

/** Export an in-memory bag (dotClaude projection) without a configLibrary entry. */
async function exportCustom3pConfigFromBag(
  context: IpcHandlerContext,
  config: unknown,
  format: unknown,
  meta: { id: string; name: string },
) {
  const { exportFormat, defaultName, payload } = buildCustom3pExportPayload(config, format, meta);
  const result = await dialog.showSaveDialog(context.windows.mainWindow, {
    title: "Export Claude configuration",
    defaultPath: defaultName,
    filters: exportFormat === "reg"
      ? [{ name: "Windows Registry", extensions: ["reg"] }]
      : [{ name: "Configuration Profile", extensions: ["mobileconfig"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  await fs.writeFile(result.filePath, payload);
  return { ok: true, path: result.filePath };
}

async function exportCustom3pConfig(context: IpcHandlerContext, id: unknown, format: unknown) {
  if (typeof id !== "string") return { ok: false, error: "invalid id" };
  const userDataPath = ensureCustom3pConfigLibrary(context);
  const listed = listCustom3pConfigLibrary(userDataPath);
  const entry = listed.entries.find((row) => row.id === id);
  const read = readCustom3pConfigLibrary(userDataPath, id);
  if (!entry || !read.ok) return { ok: false, error: "config not found" };
  return exportCustom3pConfigFromBag(context, read.config, format, {
    id: entry.id,
    name: entry.name,
  });
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
  const events = originalEventSurface(context);
  // Official keepAwakeEnabled: restore powerSaveBlocker from persisted prefs on boot.
  syncKeepAwakeFromPreferences(settings.getPreferences());
  // Official lKA / Rh.on("menuBarEnabled"): tray from gi("menuBarEnabled") on boot + toggle.
  // Official Lst click: yst() quick entry first, else show main (Qst).
  configureMenuBarTray({
    getEnabled: () => settings.isMenuBarEnabled(),
    getMainWindow: () => context.windows.mainWindow,
    resourcesRoot: resolveElectronShellPaths().resourcesRoot,
    // Official Lst → yst: native overlay (i2A/H9i) then Electron panel, then main.
    openQuickEntry: () => activateQuickEntry(context),
  });
  syncMenuBarTray();
  // Official Y9i residual: load @ant/claude-swift when Dvi says supported.
  // Fail soft — never invents overlay without real toggle.
  void ensureNativeQuickEntry(quickEntryNativeDeps(context)).catch((error) => {
    console.warn("[settingsHandlers] ensureNativeQuickEntry failed", error);
  });
  // Product residual: register Electron globalShortcut for Quick Entry.
  // nativeQuickEntry status follows official Dvi (darwin + macOS 13+).
  syncQuickEntryShortcutFromPreferences(context);

  // Official wvi/pvi residual: darwin controller only; native API remains null until bridge.
  // Reconcile is honest no-op without API (never invents install/enabled).
  const wakeController = ensureWakeSchedulerController({
    platform: process.platform,
    getPreference: (key) => settings.getPreferences()[key],
    setPreference: async (key, value) => {
      // Official xn residual for wake-driven preference writes (courtesy-flip / approval).
      const previous = settings.getPreferences()[key];
      const ok = settings.setPreference(key, value);
      if (!ok) return;
      // Avoid re-entrant reconcile on wakeSchedulerEnabled (already inside reconcile).
      if (key === "wakeSchedulerEnabled") {
        applyKeepAwakeEnabledIfNeeded(key, value);
        return;
      }
      await runPreferencePostWriteEffects(key, value, previous);
    },
    getAppVersion: () => app.getVersion(),
  });
  if (wakeController) {
    void wakeController.reconcile().catch(() => {
      /* native API absent → deferred */
    });
  }

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
        // Official: HSA validate → eZt pre-hook → xn write → Rh/effects → preferencesChanged.
        // Invalid key/value or blocked pre-hook does not write / notify.
        if (typeof key !== "string") return false;
        const previous = settings.getPreferences()[key];
        const preOk = await runPreferencePreWriteHook(key, value, previous);
        if (!preOk) return false;
        const result = settings.setPreference(key, value);
        if (!result) return false;
        await runPreferencePostWriteEffects(key, value, previous);
        // Product residual: quickEntryShortcut drives Electron globalShortcut → Quick Entry window.
        if (key === "quickEntryShortcut") {
          syncQuickEntryShortcutFromPreferences(context, { preferPreference: true });
        }
        dispatchBridgeEvent(
          mainView,
          "claude.settings",
          "AppPreferences",
          "preferencesChanged",
          settings.getPreferences(),
        );
        return true;
      },
    },
    Startup: {
      isStartupOnLoginEnabled: async () => app.getLoginItemSettings().openAtLogin,
      setStartupOnLoginEnabled: async (_event, enabled) => {
        app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
        return app.getLoginItemSettings().openAtLogin === Boolean(enabled);
      },
      // Official EKA: is → gi; set → xn("menuBarEnabled") which emits Rh → lKA + preferencesChanged.
      isMenuBarEnabled: async () => settings.isMenuBarEnabled(),
      setMenuBarEnabled: async (_event, enabled) => {
        const next = Boolean(enabled);
        const previous = settings.isMenuBarEnabled();
        const ok = settings.setMenuBarEnabled(next);
        if (!ok) return false;
        await runPreferencePostWriteEffects("menuBarEnabled", next, previous);
        dispatchBridgeEvent(
          mainView,
          "claude.settings",
          "AppPreferences",
          "preferencesChanged",
          settings.getPreferences(),
        );
        return true;
      },
    },
    GlobalShortcut: {
      setGlobalShortcut: async (_event, accelerator) => configureGlobalShortcut(context, accelerator),
      getGlobalShortcut: async () => settings.getGlobalShortcut(),
    },
    MCP: {
      // Official InA residual — absent enterprise/features key defaults enabled.
      // Do not Boolean(undefined) (that forced the "IT admin disabled" banner).
      isLocalDevMcpEnabled: async () => settings.isLocalDevMcpEnabled(),
      setMcpServerConfigs: async (_event, config) => settings.setMcpServersConfig(asObject(config)),
      getMcpServersConfig: async () => settings.getMcpServersConfig(),
      getMcpServersConfigWithStatus: async () => {
        const config = settings.getMcpServersConfig();
        return Object.fromEntries(mcpConfigEntries(config).map(([name, value]) => [name, { config: value, ...describeMcpServer(name, value) }]));
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
      // Official zYe getStatus: notFound until native $_A API present; never invent enabled.
      getStatus: async () =>
        getWakeSchedulerStatus({
          getApprovedThisCycle: () =>
            settings.getPreferences().wakeSchedulerApprovedThisCycle === true,
          controller: wakeController,
        }),
      openSettings: async () => {
        // Official openSettings → native; residual opens Login Items (wake approval surface).
        await openWakeSchedulerSettings({
          controller: wakeController,
          openLoginItemsSettings: async () => {
            // darwin Login Items; Battery settings also used historically for wake.
            if (process.platform === "darwin") {
              await shell.openExternal(
                "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
              );
            } else {
              await shell.openExternal(
                "ms-settings:startupapps",
              );
            }
          },
        });
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
      // Official cgr/Igr/Egr/Cgr/ugr/dgr residual — userData/configLibrary
      // Product: dotClaude mode projects ~/.claude into the same IPC shape so
      // "login chose X → Setup shows/edits X".
      listConfigs: async () => (
        isDotClaudeDeploymentMode(context)
          ? listDotClaudeAsConfigLibrary()
          : custom3pConfigList(context)
      ),
      readConfig: async (_event, id) => {
        if (typeof id !== "string") return { ok: false, error: "invalid id" };
        if (isDotClaudeDeploymentMode(context)) {
          if (!isDotClaudeSetupConfigId(id)) return { ok: false, error: "config not found" };
          return readDotClaudeAsConfigLibrary();
        }
        return readCustom3pConfigLibrary(ensureCustom3pConfigLibrary(context), id);
      },
      writeConfig: async (_event, id, config) => {
        if (typeof id !== "string") return { ok: false, error: "invalid id" };
        if (isDotClaudeDeploymentMode(context)) {
          if (!isDotClaudeSetupConfigId(id)) return { ok: false, error: "config not found" };
          const result = writeDotClaudeAsConfigLibrary(custom3pConfigInput(config));
          publishCustom3pBootstrapState(context);
          return result;
        }
        const result = writeCustom3pConfigLibrary(
          ensureCustom3pConfigLibrary(context),
          id,
          custom3pConfigInput(config),
        );
        publishCustom3pBootstrapState(context);
        return result;
      },
      createConfig: async (_event, input) => {
        if (isDotClaudeDeploymentMode(context)) {
          // Single live CLI file — no multi-config create under ~/.claude mode.
          return { id: DOT_CLAUDE_SETUP_CONFIG_ID, name: DOT_CLAUDE_SETUP_CONFIG_NAME };
        }
        const userDataPath = ensureCustom3pConfigLibrary(context);
        // Official Cgr: uuid + bag + meta; first create sets appliedId when none.
        const entry = createCustom3pConfigLibraryEntry(
          userDataPath,
          configNameFromInput(input),
          custom3pConfigInput(input),
        );
        publishCustom3pBootstrapState(context);
        return entry;
      },
      duplicateConfig: async (_event, id, name) => {
        if (isDotClaudeDeploymentMode(context)) return null;
        if (typeof id !== "string") return null;
        const entry = duplicateCustom3pConfigLibraryEntry(
          ensureCustom3pConfigLibrary(context),
          id,
          asString(name) ?? undefined,
        );
        if (entry) publishCustom3pBootstrapState(context);
        return entry;
      },
      renameConfig: async (_event, id, name) => {
        if (isDotClaudeDeploymentMode(context)) {
          if (!isDotClaudeSetupConfigId(id) || typeof name !== "string") return null;
          return { id: DOT_CLAUDE_SETUP_CONFIG_ID, name: DOT_CLAUDE_SETUP_CONFIG_NAME };
        }
        if (typeof id !== "string" || typeof name !== "string") return null;
        return renameCustom3pConfigLibraryEntry(
          ensureCustom3pConfigLibrary(context),
          id,
          name,
        );
      },
      deleteConfig: async (_event, id) => {
        if (isDotClaudeDeploymentMode(context)) {
          // Cannot delete the only ~/.claude projection.
          return listDotClaudeAsConfigLibrary();
        }
        const userDataPath = ensureCustom3pConfigLibrary(context);
        if (typeof id === "string") {
          try {
            return deleteCustom3pConfigLibraryEntry(userDataPath, id);
          } catch (error) {
            // Official Qgr: cannot delete the last configuration.
            if (
              error instanceof Error
              && error.message.includes("cannot delete the last configuration")
            ) {
              return listCustom3pConfigLibrary(userDataPath);
            }
            throw error;
          }
        }
        return listCustom3pConfigLibrary(userDataPath);
      },
      exportConfig: async (_event, id, format) => {
        if (isDotClaudeDeploymentMode(context) && isDotClaudeSetupConfigId(typeof id === "string" ? id : null)) {
          const read = readDotClaudeAsConfigLibrary();
          if (!read.ok) return { ok: false, error: read.error };
          return exportCustom3pConfigFromBag(context, read.config, format, {
            id: DOT_CLAUDE_SETUP_CONFIG_ID,
            name: DOT_CLAUDE_SETUP_CONFIG_NAME,
          });
        }
        return exportCustom3pConfig(context, id, format);
      },
      setAppliedConfig: async (_event, id) => {
        if (isDotClaudeDeploymentMode(context)) {
          // Only one live projection — Apply is a no-op success (already applied).
          publishCustom3pBootstrapState(context);
          return isDotClaudeSetupConfigId(typeof id === "string" ? id : null);
        }
        const ok =
          typeof id === "string"
            ? setAppliedCustom3pConfigLibraryId(ensureCustom3pConfigLibrary(context), id)
            : false;
        publishCustom3pBootstrapState(context);
        return ok;
      },
      revealConfig: async (_event, id) => {
        if (isDotClaudeDeploymentMode(context)) {
          const target = revealDotClaudeSettingsPath();
          if (target) shell.showItemInFolder(target);
          return Boolean(target);
        }
        const target = revealCustom3pConfigLibraryPath(
          ensureCustom3pConfigLibrary(context),
          typeof id === "string" ? id : null,
        );
        if (target) shell.showItemInFolder(target);
        return Boolean(target);
      },
      // Official KPe/KbA: get returns cache-or-recompute; recheck forces X6t probe.
      getConfigHealth: async () => getCustom3pConfigHealth(ensureCustom3pConfigLibrary(context)),
      recheckConfigHealth: async () => recheckCustom3pConfigHealth(ensureCustom3pConfigLibrary(context)),
      probeEgressHosts: async (_event, hosts) => Promise.all((Array.isArray(hosts) ? hosts : []).filter((host): host is string => typeof host === "string").map(probeEgressHost)),
      probeMcpServer: async (_event, config) => probeMcpServerConfig(config),
      authorizeAndProbeMcpServer: async (_event, config) => probeMcpServerConfig(config),
      forgetMcpOAuth: async () => true,
      triggerBootstrapAuth: async () => {
        publishCustom3pBootstrapState(context);
        return { ok: true };
      },
      openSetupWindow: async () => {
        await openCustom3pSetupWindow(context.windows.mainWindow);
        return true;
      },
      openDeviceCodeWindowForE2e: async () => true,
      getLoginDesktop3pStatus: async () => custom3pLoginDesktopStatus(settingsUserDataPath(context)),
      relaunchApp: async () => {
        app.relaunch();
        app.exit(0);
        return true;
      },
      // Official residual pot/got/jsA (app.asar):
      //   pot(e) → got(e==="clear"?void 0:e, enterprise)
      //   jsA writes preferences.deploymentMode (void on clear)
      //   if mode !== "3p" → clear session residual + relaunchApp
      // Tjt validation: mode ∈ {"1p","3p","clear"}
      // Product extension: "dotClaude" — run on existing ~/.claude CLI config.
      setDeploymentMode: async (_event, mode) => {
        if (mode !== "1p" && mode !== "3p" && mode !== "clear" && mode !== "dotClaude") {
          throw new Error(
            'Argument "mode" at position 0 to method "setDeploymentMode" in interface "Custom3pSetup" failed to pass validation',
          );
        }
        if (mode === "1p" || mode === "3p" || mode === "dotClaude") {
          settings.setPreference("deploymentMode", mode);
        } else {
          // Official jsA(undefined): delete persisted chooser mode.
          settings.deletePreference("deploymentMode");
        }
        publishCustom3pBootstrapState(context);
        // Official got: mode !== "3p" process relaunch after write.
        // Product soft SPA host (open-claude-web):
        //   - "3p" / "dotClaude": write only (renderer soft-leaves to Cowork)
        //   - "clear": write only (renderer soft-leaves to /login after signed-out
        //     interstitial). Process kill here made countdown-end wait for full
        //     relaunch (~seconds) and flashed chooser mid-exit.
        //   - "1p": still schedule relaunch (Anthropic host residual).
        if (mode === "1p") {
          setImmediate(() => {
            app.relaunch();
            app.exit(0);
          });
        }
        return true;
      },
      bootstrapState_$store$_getState: async () => custom3pBootstrapState(settingsUserDataPath(context)),
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
        const id = typeof extensionId === "string" ? extensionId : path.basename(dxtPath, path.extname(dxtPath));
        events.extensionDownloadProgress(id, 0, 0, 0, null, "installing");
        const installed = await installDxtArchive(extensionUserDataDir(context), dxtPath, typeof extensionId === "string" ? extensionId : null);
        events.extensionDownloadProgress(installed.id, 1, 1, 1, installed.manifest, "installed");
        dispatchExtensionsChanged(context);
        return installed.id;
      },
      installDxtFromDirectory: async (_event, extensionId) => {
        if (typeof extensionId !== "string") return null;
        return null;
      },
      installDxtUnpacked: async (_event, folderPath) => {
        if (typeof folderPath !== "string") return null;
        events.previewExtensionInstallation({ name: path.basename(folderPath) }, folderPath, path.basename(folderPath), null);
        const installed = await installUnpackedExtension(extensionUserDataDir(context), folderPath);
        events.extensionDownloadProgress(installed.id, 1, 1, 1, installed.manifest, "installed");
        dispatchExtensionsChanged(context);
        return installed.id;
      },
      installExtensionFromPreview: async (_event, extensionId, dxtPath) => {
        if (typeof dxtPath !== "string") return null;
        const id = typeof extensionId === "string" ? extensionId : path.basename(dxtPath, path.extname(dxtPath));
        events.extensionDownloadProgress(id, 0, 0, 0, null, "installing");
        const installed = await installDxtArchive(extensionUserDataDir(context), dxtPath, typeof extensionId === "string" ? extensionId : null);
        events.extensionDownloadProgress(installed.id, 1, 1, 1, installed.manifest, "installed");
        dispatchExtensionsChanged(context);
        return installed.id;
      },
      handleDxtFile: async (_event, dxtPath) => {
        if (typeof dxtPath !== "string") return;
        const id = path.basename(dxtPath, path.extname(dxtPath));
        events.previewExtensionInstallation({ name: id }, dxtPath, id, null);
        await installDxtArchive(extensionUserDataDir(context), dxtPath);
        dispatchExtensionsChanged(context);
      },
      deleteExtension: async (_event, extensionId) => {
        if (typeof extensionId !== "string") return false;
        const deleted = await deleteInstalledExtension(extensionUserDataDir(context), extensionId);
        dispatchExtensionsChanged(context);
        return deleted;
      },
      isDesktopExtensionDirectoryEnabled: async () => true,
    },
    SupportBundle: {
      submitAction: async (_event, action) => handleSupportBundleAction(context, action),
    },
  });

  // Official shape: { messages, locale }. Renderer loads /i18n/{locale}.json itself
  // (index-BELzQL5P G0t). Prefer stored preference locale over OS locale.
  // hybridBridgeSpec: getInitialLocale sync; electronIntl also exposes sync now.
  // Keep invoke for any residual that still calls ipcRenderer.invoke.
  const getInitialLocalePayload = () => {
    const prefs = settings.getPreferences();
    const fromPref =
      typeof prefs.locale === "string" && prefs.locale.length > 0 ? prefs.locale : null;
    return {
      messages: {},
      locale: fromPref || app.getLocale() || "en-US",
    };
  };
  registerNamespaceHandlers("claude.hybrid", {
    DesktopIntl: {
      requestLocaleChange: async (_event, locale) => {
        // Official residual: renderer owns /i18n catalogs (G0t fetch). Main only
        // persists preference + dispatches localeChanged. messages stay empty.
        const next =
          typeof locale === "string" && locale.length > 0
            ? locale
            : (settings.getPreferences().locale as string | undefined) || app.getLocale() || "en-US";
        settings.setPreference("locale", next);
        dispatchBridgeEvent(mainView, "claude.hybrid", "DesktopIntl", "localeChanged", next);
        return true;
      },
      getInitialLocale: async () => getInitialLocalePayload(),
    },
  });
  registerInterfaceSyncHandlers("claude.hybrid", "DesktopIntl", {
    getInitialLocale: () => getInitialLocalePayload(),
  });
}
