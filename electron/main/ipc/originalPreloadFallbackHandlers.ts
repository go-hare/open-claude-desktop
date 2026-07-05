import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { IpcHandlerContext } from "./context";
import { recordIpcHandler } from "./handlerRegistry";

const ORIGINAL_PRELOAD_FILES = [
  "mainWindow.js",
  "mainView.js",
  "findInPage.js",
  "aboutWindow.js",
  "quickWindow.js",
  "buddy.js",
  "coworkArtifact.js",
] as const;

type ParsedChannel = {
  mode: "invoke" | "sendSync" | "send" | "on";
  channel: string;
  file: string;
};

type ParsedEipcChannel = {
  namespace: string;
  iface: string;
  method: string;
};

function parseEipcChannel(channel: string): ParsedEipcChannel | null {
  const parts = channel.split("_$_");
  if (parts.length < 4) return null;
  return {
    namespace: parts[1] ?? "",
    iface: parts[2] ?? "",
    method: parts.slice(3).join("_$_"),
  };
}

function defaultValueFor(channel: string, context: IpcHandlerContext): unknown {
  const parsed = parseEipcChannel(channel);
  const method = parsed?.method ?? channel;
  const iface = parsed?.iface ?? "";
  const lower = method.toLowerCase();

  if (method.endsWith("$store$_getState") || method.endsWith("$store$_getStateSync")) return null;
  if (method === "getInitialLocale") return { messages: {}, locale: "en-US" };
  if (method === "getSystemInfo") return { platform: process.platform, arch: process.arch };
  if (method === "getVisibility") return context.windows.mainWindow.isVisible();
  if (method === "getFullscreen") return context.windows.mainWindow.isFullScreen();
  if (method === "getZoomFactor") return context.windows.mainView.webContents.getZoomFactor();
  if (method === "captureScreenshot") return null;
  if (method === "getAuthorizationStatus" || method === "requestAuthorization") return "denied";
  if (method === "getPreferences" || method === "getAppConfig" || method === "getMcpServersConfig" || method === "getMcpServersConfigWithStatus") return {};
  if (method === "getSupportedFeatures") return {};
  if (method === "getAppName") return app.getName();
  if (method === "getBuildProps") return { appVersion: app.getVersion(), platform: process.platform, arch: process.arch };
  if (method === "getSupport") return {};
  if (method === "reportNavigationState" || method === "navigationState_") return { url: context.windows.mainView.webContents.getURL() };
  if (method === "status" && iface === "Buddy") return { status: "fallback" };
  if (method === "deviceStatus") return { status: "fallback" };

  if (/^(is|has|can|check)/.test(method)) return false;
  if (/^(list|search|fetch|getAll|getAvailable|getInstalled|getExtensions|getExtensionVersions|getConnected|getSessions|getAgents|getLocal|getDirect)/.test(method)) return [];
  if (/^(set|update|save|open|show|hide|close|request|reveal|focus|select|cancel|remove|delete|archive|clear|enable|disable|disconnect|forget|report|submit|navigate|resize)/.test(method)) return true;
  if (/^(create|start|install|download|run|authorize|probe|export|duplicate|rename|write|read|fork|send|add|adopt|dismiss|record|refresh|reload|restart)/.test(method)) return null;
  if (lower.includes("enabled") || lower.includes("available")) return false;
  if (lower.includes("status")) return { status: "fallback" };
  return null;
}

function preloadBuildDir(): string {
  return path.join(app.getAppPath(), ".vite", "build");
}

function readPreloadFile(fileName: string): string | null {
  const filePath = path.join(preloadBuildDir(), fileName);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function parseOriginalPreloadChannels(): ParsedChannel[] {
  const channels: ParsedChannel[] = [];
  const seen = new Set<string>();
  const callRegex = /ipcRenderer\.(invoke|sendSync|send|on)\(\s*"([^"]+)"/g;

  for (const file of ORIGINAL_PRELOAD_FILES) {
    const source = readPreloadFile(file);
    if (!source) continue;
    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(source))) {
      const mode = match[1] as ParsedChannel["mode"];
      const channel = match[2]!;
      const key = `${mode}\0${channel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      channels.push({ mode, channel, file });
    }
  }

  return channels;
}

/**
 * Compatibility safety net for the original compiled preload bundles.
 *
 * Real handlers are registered after this function and override the fallback via
 * ipcMain.removeHandler(channel). The fallback exists so the original preload API
 * surface can be exposed exactly while the source rewrite catches up method by method.
 */
export function registerOriginalPreloadFallbackHandlers(context: IpcHandlerContext): void {
  const channels = parseOriginalPreloadChannels();
  const invokeChannels = new Set(channels.filter((entry) => entry.mode === "invoke").map((entry) => entry.channel));
  const syncOrSendChannels = new Set(channels.filter((entry) => entry.mode === "sendSync" || entry.mode === "send").map((entry) => entry.channel));

  for (const channel of invokeChannels) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async () => defaultValueFor(channel, context));
    recordIpcHandler(channel, "invoke", "fallback", "originalPreloadFallback");
  }

  for (const channel of syncOrSendChannels) {
    ipcMain.removeAllListeners(channel);
    ipcMain.on(channel, (event) => {
      const value = defaultValueFor(channel, context);
      if ("returnValue" in event) event.returnValue = { result: value };
    });
    recordIpcHandler(channel, "sync", "fallback", "originalPreloadFallback");
  }

  if (process.env.CLAUDE_DESKTOP_DEBUG_IPC_FALLBACK) {
    console.log(
      `[claude-deepseek-ipc-fallback] parsed=${channels.length} invoke=${invokeChannels.size} syncOrSend=${syncOrSendChannels.size}`,
    );
  }
}
