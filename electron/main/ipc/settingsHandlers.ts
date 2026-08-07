import { app, dialog, globalShortcut, net, screen, shell } from "electron";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createCustom3pConfigLibraryEntry,
  deleteCustom3pConfigLibraryEntry,
  duplicateCustom3pConfigLibraryEntry,
  listCustom3pConfigLibrary,
  migrateLegacyShellCustom3pConfigsToLibrary,
  readCustom3pConfigLibrary,
  readCustom3pConfigLibraryBag,
  renameCustom3pConfigLibraryEntry,
  revealCustom3pConfigLibraryPath,
  setAppliedCustom3pConfigLibraryId,
  writeCustom3pConfigLibrary,
} from "../services/custom3p/custom3pConfigLibrary";
import {
  deploymentModeIs3p,
  deploymentModeToPersistAfterApply,
  normalizePersistedDeploymentMode,
  resolveDeploymentModeFromUserData,
} from "../services/custom3p/deploymentMode";
import { clearCoworkOauthTokenCache } from "../services/coworkAccount/coworkOauthTokenCache";
import { revokeEnterpriseInteractiveAuth } from "../services/custom3p/enterpriseInteractiveAuth";
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
import { applyRendererProxyFromUserData } from "../services/network/applyRendererProxyFromBag";
import { custom3pBootstrapState, custom3pLoginDesktopStatus } from "../services/custom3p/custom3pStatus";
import {
  getCredentialHelperLastRunResidual,
  runCredentialHelperResidual,
} from "../services/custom3p/credentialHelperResidual";
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
import { isDesktopExtensionDirectoryEnabledResidual } from "../services/settings/extensionEnableGates";
import {
  authorizeAndProbeMcpServer,
  forgetMcpOAuth,
  probeMcpServer,
} from "../services/mcp/custom3pMcpProbe";
import { handleSupportBundleAction } from "../services/support/supportBundle";
import {
  closeCustom3pSetupWindow,
  openCustom3pSetupWindow,
} from "../windows/custom3pSetupWindow";
import { openDeviceCodeWindowForE2e } from "../windows/custom3pDeviceCodeWindow";
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
  setLaunchPreviewPersistPreferenceAccess,
  runPreferencePostWriteEffects,
  runPreferencePreWriteHook,
} from "../services/settings/preferenceEffects";
import { resolveElectronShellPaths } from "../paths/electronShellPaths";
import {
  bindWakeSchedulerAfterSwiftLoad,
  ensureWakeSchedulerController,
  getWakeSchedulerStatus,
  openWakeSchedulerSettings,
} from "../services/settings/wakeScheduler";
import {
  isStartupOnLoginEnabled,
  setStartupOnLoginEnabled,
} from "../services/settings/startupOnLogin";
import { getClaudeSwiftAddonCached } from "../services/settings/claudeSwiftAddon";
import {
  ensureNativeQuickEntry,
  tryActivateNativeQuickEntry,
} from "../services/settings/quickEntryNative";
import {
  applyDictationShortcutPreference,
  bootDictationHotkeys,
  ensureCapsLockDictationListener,
} from "../services/settings/dictationHotkey";
import type { DictationShortcutValue } from "../services/settings/desktopDialogI18n";
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

/** Single-flight process exit — prevents dual Dock icons from overlapping relaunches. */
let processRelaunchScheduled = false;

/**
 * Official-aligned process restart. Use setImmediate so IPC can return before exit,
 * and never schedule relaunch twice in one process lifetime.
 */
function performProcessRelaunchOnce(reason: string): void {
  if (processRelaunchScheduled) {
    console.info("[custom3p] process relaunch already scheduled", reason);
    return;
  }
  processRelaunchScheduled = true;
  console.info("[custom3p] process relaunch", reason);
  // Close Setup if still open (e.g. confirm from main after soft-close failed).
  try {
    closeCustom3pSetupWindow();
  } catch {
    /* ignore */
  }
  setImmediate(() => {
    try {
      app.relaunch();
    } catch (error) {
      console.error(
        "[custom3p] app.relaunch failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    app.exit(0);
  });
}

/**
 * Setup Apply → Relaunch now:
 * close small Setup window, show apply countdown on main product SPA, then exit once
 * when main calls confirmProcessRelaunch (after d2t-style 3s overlay).
 *
 * Residual setup SPA (c71860c77) used to run countdown on the setup window and call
 * relaunchApp immediately; product main-process owns close + main overlay trigger.
 *
 * No force-exit timer: Cancel on main overlay must leave the process alive (user
 * can re-open Setup). If main SPA never receives the event, fall back to immediate
 * process relaunch only when mainView is missing/destroyed.
 */
function scheduleApplyRelaunchWithMainCountdown(context: IpcHandlerContext): void {
  if (processRelaunchScheduled) return;

  try {
    closeCustom3pSetupWindow();
  } catch {
    /* ignore */
  }

  const mainWindow = context.windows.mainWindow;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } catch {
      /* continue — still emit / exit */
    }
  }

  const mainView = context.windows.mainView;
  const wc = mainView?.webContents;
  if (!wc || wc.isDestroyed()) {
    // No main SPA to host countdown — process relaunch immediately (still single-flight).
    performProcessRelaunchOnce("apply-relaunch-no-main-view");
    return;
  }

  try {
    dispatchBridgeEvent(
      wc,
      "claude.settings",
      "Custom3pSetup",
      "applyRelaunchRequested",
      { variant: "apply" },
    );
  } catch (error) {
    console.warn(
      "[custom3p] applyRelaunchRequested dispatch failed — falling back to process relaunch",
      error instanceof Error ? error.message : String(error),
    );
    performProcessRelaunchOnce("apply-relaunch-dispatch-failed");
  }
}

/**
 * Official wrA residual: multi-config lives in userData/configLibrary.
 * One-shot migrate legacy desktop-shell-settings custom3pConfigs when library empty.
 *
 * Residual setup SPA (c71860c77): after listConfigs always readConfig(appliedId).
 * Empty library returns appliedId:"" → readConfig("") fails → "Couldn't load
 * configuration" / toast "Couldn't update saved configurations". Official first
 * open effectively has a create path; product seeds one Default empty bag so
 * Setup can render Connection form on fresh userData (package:open isolated).
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
  try {
    const listed = listCustom3pConfigLibrary(userDataPath);
    if (listed.entries.length === 0) {
      // Official Cgr: create starts with empty bag; first entry becomes appliedId.
      createCustom3pConfigLibraryEntry(userDataPath, "Default", {});
    }
  } catch {
    // Seed is best-effort; list/create handlers still return shapes residual can show.
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
 *
 * Exported so windowHandlers.QuickWindow.requestDismissWithPayload uses the same path
 * (show main + focus + event). Dispatch-only left the main window behind → user saw
 * Quick Entry close with no desktop session.
 */
export function dispatchQuickEntrySubmitPayload(
  context: IpcHandlerContext,
  payload: unknown,
): void {
  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const text = typeof record.text === "string" ? record.text : "";
  const images = Array.isArray(record.images)
    ? (record.images as Array<{ base64: string; mimeType: string; filename?: string }>)
    : [];
  const chatId =
    typeof record.chatId === "string" && record.chatId.length > 0
      ? record.chatId
      : undefined;
  const normalized = { text, images, chatId };

  const wc = context.windows.mainView.webContents;
  if (!wc || wc.isDestroyed()) {
    console.warn("[settingsHandlers] IKA: mainView webContents unavailable; dropping payload");
    return;
  }
  /**
   * Platform strengthen on official FSe/svi (show main before/after QE submit):
   * session can start while main stays background after alwaysOnTop pill dismiss.
   * showMainWindowFromTray already does steal-focus + win32 alwaysOnTop flash.
   */
  const frontMain = (reason: string) => {
    try {
      showMainWindowFromTray(() => context.windows.mainWindow);
      const main = context.windows.mainWindow;
      if (!main || main.isDestroyed()) {
        console.warn("[settingsHandlers] IKA frontMain: main missing", reason);
        return;
      }
      try {
        if (typeof main.getOpacity === "function" && main.getOpacity() < 0.99) {
          main.setOpacity(1);
        }
      } catch {
        /* ignore */
      }
      main.show();
      main.focus();
      try {
        wc.focus();
      } catch {
        /* ignore */
      }
      console.info("[settingsHandlers] IKA frontMain", reason, {
        visible: main.isVisible(),
        minimized: main.isMinimized(),
        focused: main.isFocused(),
      });
    } catch (error) {
      console.warn("[settingsHandlers] IKA: failed to show/focus main", reason, error);
    }
  };

  const send = () => {
    // 1) Front main first (official FSe/svi order).
    frontMain("before-dispatch");
    console.info("[settingsHandlers] IKA dispatchOnQuickEntrySubmit", {
      textLen: text.trim().length,
      images: images.length,
      chatId: chatId ?? null,
      url: (() => {
        try {
          return wc.getURL();
        } catch {
          return null;
        }
      })(),
    });
    dispatchBridgeEvent(wc, "claude.web", "QuickEntry", "onQuickEntrySubmit", normalized);
    // 2) Close pill; re-front once so blur/hide cannot leave main in background.
    try {
      context.windows.secondaryWindows?.closeQuickWindow?.();
    } catch {
      /* ignore */
    }
    frontMain("after-dismiss");
    // One microtask re-front covers Windows focus handoff after alwaysOnTop pill.
    setTimeout(() => frontMain("after-focus-handoff"), 0);
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
    // Official Ii() residual for or()/PwA: 3p|dotClaude → app://localhost
    getDeploymentMode: () => {
      const prefs = context.settings.getPreferences();
      const mode = prefs.deploymentMode;
      return typeof mode === "string" && mode.length > 0 ? mode : null;
    },
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
  // macOS residual: after native open dialog, keyboard focus can stick off the
  // product webContents (composer looks focused but keystrokes never arrive).
  // Re-front main + focus the product view so Code/Cowork TipTap can type again.
  try {
    const main = context.windows.mainWindow;
    if (main && !main.isDestroyed()) {
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    }
    const wc = context.windows.mainView?.webContents;
    if (wc && !wc.isDestroyed()) wc.focus();
  } catch {
    /* ignore focus races during shutdown */
  }
  return result.canceled ? [] : result.filePaths;
}

function dispatchExtensionsChanged(context: IpcHandlerContext): void {
  dispatchBridgeEvent(context.windows.mainView.webContents, "claude.settings", "Extensions", "extensionsChanged");
}

function dispatchExtensionSettingsChanged(context: IpcHandlerContext, extensionId: string, settings: unknown): void {
  dispatchBridgeEvent(context.windows.mainView.webContents, "claude.settings", "Extensions", "extensionSettingsChanged", extensionId, settings);
}

/** Official MCP.mcpConfigChange residual — Developer list hot-reload. */
function dispatchMcpConfigChange(context: IpcHandlerContext): void {
  const wc = context.windows.mainView.webContents;
  if (!wc || wc.isDestroyed()) return;
  dispatchBridgeEvent(
    wc,
    "claude.settings",
    "MCP",
    "mcpConfigChange",
    context.settings.getMcpServersConfig(),
  );
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

export function registerSettingsHandlers(context: IpcHandlerContext): void {
  const settings = context.settings;
  const mainView = context.windows.mainView.webContents;
  const events = originalEventSurface(context);
  // Official keepAwakeEnabled: restore powerSaveBlocker from persisted prefs on boot.
  syncKeepAwakeFromPreferences(settings.getPreferences());
  // Official Rh.on("launchPreviewPersistSession") residual access for iOi clear.
  setLaunchPreviewPersistPreferenceAccess({
    getPersistedWorkspaces: () => {
      const raw = settings.getPreferences().launchPreviewPersistedWorkspaces;
      return Array.isArray(raw)
        ? raw.filter((item): item is string => typeof item === "string")
        : [];
    },
    setPersistedWorkspaces: (keys) => {
      settings.setPreference("launchPreviewPersistedWorkspaces", keys);
    },
  });
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

  // Official wvi/pvi residual: darwin controller first so F9i→dvi bind can
  // reconcile against real prefs. getApi re-reads activeNativeApi (hkA).
  // Reconcile before Swift load is honest no-op without API (never invents install).
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
      /* native API absent → deferred until Swift bind */
    });
  }

  // Official Y9i residual: load @ant/claude-swift when Dvi says supported.
  // Fail soft — never invents overlay without real toggle.
  // After load: swe() capsLock + F9i().then(() => dvi(wvi(hkA))) wake bind.
  void ensureNativeQuickEntry(quickEntryNativeDeps(context))
    .then(async () => {
      ensureCapsLockDictationListener();
      // Official hkA = nr?.wakeScheduler; dvi binds + reconcile. Never invents
      // enabled — Nest-only / unpackaged LaunchDaemons stay native truth.
      const bindResult = await bindWakeSchedulerAfterSwiftLoad(
        getClaudeSwiftAddonCached(),
        { isPackaged: app.isPackaged },
      );
      if (bindResult.bound) {
        console.info(
          "[settingsHandlers] wakeScheduler native bound status=%s%s",
          bindResult.status ?? "unknown",
          bindResult.error ? ` error=${bindResult.error}` : "",
        );
      } else {
        console.info(
          "[settingsHandlers] wakeScheduler native not exposed (hkA null)",
        );
      }
    })
    .catch((error) => {
      console.warn("[settingsHandlers] ensureNativeQuickEntry failed", error);
    });
  // Product residual: register Electron globalShortcut for Quick Entry.
  // nativeQuickEntry status follows official Dvi (darwin + macOS 13+).
  syncQuickEntryShortcutFromPreferences(context);

  // Official Nme/PR/uit residual for DICTATION slot (custom accelerator + capsLock).
  // Only when pw().quickEntryDictation.status === "supported".
  void bootDictationHotkeys({
    getDictationShortcut: () =>
      settings.getPreferences().quickEntryDictationShortcut as DictationShortcutValue,
    setDictationShortcut: (value) => {
      // Official xn residual on PR failure: write SSA default + emit preferencesChanged.
      const ok = settings.setPreference("quickEntryDictationShortcut", value);
      if (ok) {
        try {
          dispatchBridgeEvent(
            context.windows.mainView.webContents,
            "claude.settings",
            "AppPreferences",
            "preferencesChanged",
            settings.getPreferences(),
          );
        } catch {
          /* ignore */
        }
      }
      return ok;
    },
    isDictationFeatureSupported: () => {
      const features = settings.getSupportedFeatures();
      return features.quickEntryDictation?.status === "supported";
    },
    getLocale: () => {
      const prefs = settings.getPreferences();
      return typeof prefs.locale === "string" && prefs.locale.length > 0
        ? prefs.locale
        : app.getLocale() || null;
    },
    openClaudeSettings: () => {
      // HOTKEY denied dialog residual: open app settings surface if available.
      try {
        const wc = context.windows.mainView.webContents;
        if (wc && !wc.isDestroyed()) {
          dispatchBridgeEvent(wc, "claude.settings", "AppPreferences", "openSettingsRequested");
        }
      } catch {
        /* ignore */
      }
    },
  }).catch((error) => {
    console.warn("[settingsHandlers] bootDictationHotkeys failed", error);
  });

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
        // Official Rh.on("quickEntryDictationShortcut", d) + swe residual.
        if (key === "quickEntryDictationShortcut") {
          void applyDictationShortcutPreference(value as DictationShortcutValue).catch((error) => {
            console.warn("[settingsHandlers] applyDictationShortcutPreference failed", error);
          });
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
      // Official EKA residual: path=xSe(), openAtLogin||executableWillLaunchAtLogin;
      // set writes openAtLogin+enabled+path+name (product name Claudex).
      isStartupOnLoginEnabled: async () => isStartupOnLoginEnabled(),
      setStartupOnLoginEnabled: async (_event, enabled) =>
        setStartupOnLoginEnabled(Boolean(enabled)),
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
      setMcpServerConfigs: async (_event, config) => {
        const ok = settings.setMcpServersConfig(asObject(config));
        // Official residual: after write, push mcpConfigChange so Developer UI
        // (cadc35a07 onMcpConfigChange) hot-reloads without remount.
        dispatchMcpConfigChange(context);
        // Residual connectMcp hot-reload: URL remotes in bag → Direct MCP manager
        // (custom3p-mcp park/connect + status push). Fire-and-forget; do not block write.
        void import("../services/mcp/directMcpConnectionManager")
          .then(({ getDirectMcpConnectionManager }) =>
            getDirectMcpConnectionManager().connectFromConfigBag(
              settings.getMcpServersConfig(),
            ),
          )
          .catch((error) => {
            console.warn(
              "[custom3p-mcp] reconnect after setMcpServerConfigs failed",
              error instanceof Error ? error.message : String(error),
            );
          });
        return ok;
      },
      getMcpServersConfig: async () => settings.getMcpServersConfig(),
      getMcpServersConfigWithStatus: async () => {
        const config = settings.getMcpServersConfig();
        return Object.fromEntries(mcpConfigEntries(config).map(([name, value]) => [name, { config: value, ...describeMcpServer(name, value) }]));
      },
      revealConfig: async () => {
        // Official Edit Config: reveal claude_desktop_config.json (Fb residual).
        const target = settings.getMcpConfigFile();
        try {
          // Ensure file exists so Explorer can select it (empty official bag ok).
          if (!fsSync.existsSync(target)) {
            settings.setMcpServersConfig(settings.getMcpServersConfig());
          }
        } catch {
          /* best-effort */
        }
        shell.showItemInFolder(target);
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
    /**
     * Official Custom3pHelperRun residual (MPe / _Pe / Gre):
     *   runCredentialHelper(helperPath: string) → real spawn + Gre bag
     *   getCredentialHelperLastRun() → last Gre | null
     * Never invent `{ ok:true, ranAt, input }`.
     */
    Custom3pHelperRun: {
      getCredentialHelperLastRun: async () => {
        const last = getCredentialHelperLastRunResidual();
        // Keep settings mirror for residual readers; official is in-memory k1.
        return last ?? settings.getCredentialHelperLastRun() ?? null;
      },
      runCredentialHelper: async (_event, helperPath) => {
        if (typeof helperPath !== "string") {
          throw new Error(
            'Argument "helperPath" at position 0 to method "runCredentialHelper" in interface "Custom3pHelperRun" failed to pass validation',
          );
        }
        const result = await runCredentialHelperResidual(helperPath);
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
        // Product: bag proxy fields must reach Chromium sessions without waiting for relaunch
        // so MermaidIframe (claudeusercontent) can load after Network Proxy edit.
        void applyRendererProxyFromUserData(settingsUserDataPath(context)).catch(() => {});
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
        const userDataPath = ensureCustom3pConfigLibrary(context);
        const ok =
          typeof id === "string"
            ? setAppliedCustom3pConfigLibraryId(userDataPath, id)
            : false;
        // Product residual: Setup commitApply only calls setAppliedConfig + relaunchApp
        // (c71860c77). Login eMA needs persisted deploymentMode "3p" for synthetic
        // account — without it relaunch stays on /login dual chooser. Apply with an
        // activated bag is the explicit 3p chooser write (see deploymentModeToPersistAfterApply).
        if (ok && typeof id === "string") {
          try {
            const bag = readCustom3pConfigLibraryBag(userDataPath, id);
            const current = normalizePersistedDeploymentMode(
              settings.getPreferences()?.deploymentMode,
            );
            const next = deploymentModeToPersistAfterApply({
              appliedBag: bag,
              currentPersistedMode: current,
            });
            if (next) {
              settings.setPreference("deploymentMode", next);
            }
          } catch {
            // Mode write is best-effort; bag apply already succeeded.
          }
        }
        publishCustom3pBootstrapState(context);
        // Same as writeConfig: applied bag proxy must hit defaultSession for residual iframes.
        void applyRendererProxyFromUserData(settingsUserDataPath(context)).catch(() => {});
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
      // Official residual WYe: Bot / Qot / xv (custom3pMcpProbe). Not HEAD net.fetch invent.
      probeMcpServer: async (_event, config) => probeMcpServer(config),
      authorizeAndProbeMcpServer: async (_event, config) => authorizeAndProbeMcpServer(config),
      forgetMcpOAuth: async (_event, serverName) => {
        forgetMcpOAuth(serverName);
      },
      // Official kot residual — same bag as bootstrapState store getState.
      getInitialBootstrapStateState: async () =>
        custom3pBootstrapState(settingsUserDataPath(context)),
      triggerBootstrapAuth: async (_event, oidcHint) => {
        // Official Tot / _0A residual: interactive bootstrap OIDC pull when configured.
        // Never invent { ok:true } without a real fetch/auth success.
        const { triggerEnterpriseBootstrapAuth } = await import(
          "../services/custom3p/enterpriseInteractiveAuth"
        );
        const userDataPath = settingsUserDataPath(context);
        const result = await triggerEnterpriseBootstrapAuth(
          { getUserDataPath: () => userDataPath },
          oidcHint,
        );
        const state = publishCustom3pBootstrapState(context);
        return { ...result, state };
      },
      openSetupWindow: async () => {
        await openCustom3pSetupWindow(context.windows.mainWindow);
        return true;
      },
      // Official: only when CLAUDE_CDP_AUTH; not unconditional true invent.
      openDeviceCodeWindowForE2e: async () => openDeviceCodeWindowForE2e(),
      getLoginDesktop3pStatus: async () => custom3pLoginDesktopStatus(settingsUserDataPath(context)),
      /**
       * Product path B (locked): after Setup "Relaunch now" —
       *   close Setup → main SPA apply interstitial → confirmProcessRelaunch.
       * Official residual instead runs d2t on the Setup window then vot relaunch;
       * we intentionally diverge (patch L→void A) for dual-root + dual-Dock fixes.
       * No force-exit timer: Cancel on main overlay must leave the process alive.
       * Single-flight: concurrent relaunchApp / confirmProcessRelaunch share one exit.
       */
      relaunchApp: async () => {
        scheduleApplyRelaunchWithMainCountdown(context);
        return true;
      },
      /** Called by main SPA after apply countdown (or Cancel is not used for process exit). */
      confirmProcessRelaunch: async () => {
        performProcessRelaunchOnce("confirmProcessRelaunch");
        return true;
      },
      // Official residual pot/got/jsA (app.asar index.js):
      //   pot(e) → got(e==="clear"?void 0:e, vi())
      //   async function got(e,A){
      //     const t=SM(A); await jsA(e);
      //     if(e!=="3p"){ clearAllSessionCredentials; relaunchApp(); return }
      //     const r=SM(A);
      //     if(t===r){ if(!r)return; await mainView.loadURL(CUSTOM_3P_ORIGIN) }
      //     else relaunchApp()
      //   }
      //   jsA writes deploymentMode; when mode *changes* → F1t (unmanage+unlink window-state)
      //   SM = Hzt(enterprise) && (IHe || krA()!=="1p")
      // Tjt validation: mode ∈ {"1p","3p","clear"}
      // Product extension: "dotClaude" maps to 3p shell residual (same soft/relaunch gate).
      setDeploymentMode: async (_event, mode) => {
        if (mode !== "1p" && mode !== "3p" && mode !== "clear" && mode !== "dotClaude") {
          throw new Error(
            'Argument "mode" at position 0 to method "setDeploymentMode" in interface "Custom3pSetup" failed to pass validation',
          );
        }

        // Official got: t = SM(A) *before* jsA so soft vs relaunch sees activation flip.
        const userDataPath = settingsUserDataPath(context);
        let smBefore = false;
        try {
          const before = resolveDeploymentModeFromUserData(userDataPath);
          smBefore = deploymentModeIs3p(before.enterprise, before.persistedDeploymentMode);
        } catch {
          smBefore = false;
        }

        // Official jsA: only F1t when persisted mode actually changes.
        const prevPersisted = normalizePersistedDeploymentMode(
          settings.getPreferences()?.deploymentMode,
        );
        const nextPersisted =
          mode === "1p" || mode === "3p" || mode === "dotClaude" ? mode : undefined;
        const modeChanged = prevPersisted !== nextPersisted;

        if (mode === "1p" || mode === "3p" || mode === "dotClaude") {
          settings.setPreference("deploymentMode", mode);
        } else {
          // Official jsA(undefined): delete persisted chooser mode.
          settings.deletePreference("deploymentMode");
        }
        // Never publish bootstrap into the live SPA before exit / loadURL (product dual-root
        // soft SPA gate would remount LoginDesktop/DesktopFrame under d2t — not residual got).
        invalidateConfigHealthCache();

        // Official F1t (jsA when A!==e only): n5.unmanage + unlink window-state.json.
        const resetMainWindowBoundsF1t = async () => {
          try {
            context.windowState?.unmanage();
          } catch {
            /* continue unlink */
          }
          try {
            const stateFile = path.join(app.getPath("userData"), "window-state.json");
            await fs.unlink(stateFile).catch(() => {});
          } catch {
            /* ignore */
          }
        };
        if (modeChanged) {
          await resetMainWindowBoundsF1t();
        }

        // Official got: mode !== "3p" → clear session credentials + relaunchApp.
        // Product residual: clearCoworkOauthTokenCache + revoke enterprise interactive auth.
        // Do NOT invent session.clearStorageData.
        const clearSessionCredentialsResidual = async () => {
          try {
            const had = clearCoworkOauthTokenCache();
            if (had > 0) {
              console.info("[custom3p] got clear session: oauth cache entries=%d", had);
            }
          } catch (error) {
            console.warn(
              "[custom3p] got clear session oauth cache failed",
              error instanceof Error ? error.message : error,
            );
          }
          try {
            await revokeEnterpriseInteractiveAuth(
              userDataPath ? { getUserDataPath: () => userDataPath } : {},
            );
          } catch (error) {
            console.warn(
              "[custom3p] got clear session revoke interactive auth failed",
              error instanceof Error ? error.message : error,
            );
          }
        };

        // Official: only literal "3p" may soft-load; product "dotClaude" is 3p-shell residual.
        const isSoft3pShell = mode === "3p" || mode === "dotClaude";

        if (!isSoft3pShell) {
          // Official got: e !== "3p" → clear + relaunchApp(); return
          // Do NOT soft loadURL before exit (double-paint under d2t).
          await clearSessionCredentialsResidual();
          // Product dual-root: hide current shell before setImmediate exit so the gap
          // cannot flash DesktopFrame. Next process creates at opacity:0 (createMainWindow).
          try {
            const mw = context.windows.mainWindow;
            if (mw && !mw.isDestroyed()) mw.setOpacity(0);
          } catch {
            /* relaunch still proceeds */
          }
          performProcessRelaunchOnce(mode === "clear" ? "got-clear" : "got-1p");
          return true;
        }

        // Official 3p branch (verbatim):
        //   const r = SM(A);
        //   if (t === r) { if (!r) return; await mainView.loadURL(CUSTOM_3P_ORIGIN) }
        //   else relaunchApp()
        // No setOpacity(0), no setBounds(1200), no chrome wait.
        // LoginRoute jn pagehide → mnr resize(1200,800) during loadURL tear-down.
        let smAfter = false;
        try {
          const after = resolveDeploymentModeFromUserData(userDataPath);
          smAfter = deploymentModeIs3p(after.enterprise, after.persistedDeploymentMode);
        } catch {
          smAfter = false;
        }

        if (smBefore !== smAfter) {
          // Official: SM flipped (e.g. 1p → 3p) → full process relaunch, not soft loadURL.
          performProcessRelaunchOnce(mode === "dotClaude" ? "got-dotClaude-sm-flip" : "got-3p-sm-flip");
          return true;
        }
        if (!smAfter) {
          // Official: if (!r) return — still 3p write but not activated shell.
          return true;
        }

        // Official got soft (SM same && r): loadURL(CUSTOM_3P_ORIGIN) only.
        // Product dual-root delta when LoginRoute jn left the window at 600×600 opaque:
        //   jn pagehide → mnr setBounds(1200,800, animate:true) while open-claude-web
        //   still composites the chooser → user sees "从左上角往右扩展到 1200 才进主页".
        // Official ion-dist blanks on navigation in the same turn so the animate paints
        // empty chrome; product SPA keeps LoginDesktop through the grow.
        // Login-sized → process relaunch (createMainWindow opacity:0 + cold /task/new),
        // same end state as official cold 3p after jsA. Already shell-sized → soft loadURL.
        try {
          settings.setPreference("sidebarMode", "task");
        } catch {
          /* SPA home residual still redirects */
        }

        const mw = context.windows.mainWindow;
        let loginSized = false;
        try {
          if (mw && !mw.isDestroyed()) {
            const b = mw.getBounds();
            // LoginRoute jn residual size (exact 600×600). Shell is Cbe 1200×800.
            loginSized =
              b.width === 600
              && b.height === 600
              && !mw.isMaximized()
              && !mw.isFullScreen();
          }
        } catch {
          loginSized = false;
        }

        if (loginSized) {
          try {
            if (mw && !mw.isDestroyed()) mw.setOpacity(0);
          } catch {
            /* relaunch still proceeds */
          }
          performProcessRelaunchOnce(
            mode === "dotClaude" ? "got-dotClaude-from-login" : "got-3p-from-login",
          );
          return true;
        }

        const wc = context.windows.mainView?.webContents;
        if (wc && !wc.isDestroyed()) {
          // Official: const {CUSTOM_3P_ORIGIN:n}=…; await o.webContents.loadURL(n)
          // Product shell origin may be Vite CLAUDE_DESKTOP_MAIN_VIEW_URL; strip path.
          const raw =
            process.env.CLAUDE_DESKTOP_MAIN_VIEW_URL?.trim() || "app://localhost";
          let shellUrl = "app://localhost";
          try {
            const u = new URL(raw);
            u.pathname = "/";
            u.search = "";
            u.hash = "";
            // Normalize 127.0.0.1 → localhost (preload trust residual).
            if (
              (u.hostname === "127.0.0.1" || u.hostname === "::1")
              && (u.protocol === "http:" || u.protocol === "https:")
            ) {
              u.hostname = "localhost";
            }
            shellUrl = u.toString();
          } catch {
            shellUrl = "app://localhost";
          }
          try {
            await wc.loadURL(shellUrl);
          } catch (error) {
            console.warn(
              "[custom3p] setDeploymentMode soft loadURL failed",
              mode,
              error instanceof Error ? error.message : error,
            );
          }
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
      installDxtFromDirectory: async (_event, extensionId, folderPath?) => {
        // Residual: install unpacked extension directory (was stub null).
        const dir =
          typeof folderPath === "string" && folderPath.length > 0
            ? folderPath
            : typeof extensionId === "string" && extensionId.includes(path.sep)
              ? extensionId
              : null;
        if (!dir) return null;
        try {
          const installed = await installUnpackedExtension(
            extensionUserDataDir(context),
            dir,
            typeof extensionId === "string" && !extensionId.includes(path.sep)
              ? extensionId
              : null,
          );
          events.extensionDownloadProgress(
            installed.id,
            1,
            1,
            1,
            installed.manifest,
            "installed",
          );
          dispatchExtensionsChanged(context);
          return installed.id;
        } catch (error) {
          console.warn("[Extensions] installDxtFromDirectory failed", error);
          return null;
        }
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
      /** Official b6e — enterprise isDesktopExtensionDirectoryEnabled === true only. */
      isDesktopExtensionDirectoryEnabled: async () =>
        isDesktopExtensionDirectoryEnabledResidual({ settings: context.settings }),
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
