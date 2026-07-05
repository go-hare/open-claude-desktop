import { app, dialog, shell, type WebContents } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dispatchBridgeEvent } from "../../ipc/registerIpc";
import type { IpcHandlerContext } from "../../ipc/context";

type SupportBundleStage = "closed" | "packaging" | "ready" | "exporting" | "sending" | "sent" | "saved";
type SupportBundleState = {
  stage: SupportBundleStage;
  stepLabel?: string;
  referenceId?: string;
  sizeBytes?: number;
  previewLines?: string[];
  canSend?: boolean;
  error?: string;
  savedPath?: string;
};

type DiagnosticBundle = {
  referenceId: string;
  createdAt: string;
  payload: Record<string, unknown>;
  text: string;
};

const UPDATE_METHOD = "supportBundleState_$store$_update";
const TOKEN_RE = /(?:sk|api|key|token|secret|password|authorization|bearer)[A-Za-z0-9_\-:.=\/]{6,}/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

let state: SupportBundleState = { stage: "closed" };
let lastBundle: DiagnosticBundle | null = null;
let lastSavedPath: string | null = null;

function setState(next: SupportBundleState, target?: WebContents): SupportBundleState {
  state = next;
  if (target) dispatchBridgeEvent(target, "claude.settings", "SupportBundle", UPDATE_METHOD, state);
  return state;
}

export function getSupportBundleState(): SupportBundleState {
  return state;
}

function scrubLine(line: string): string {
  return line
    .replace(os.homedir(), "~")
    .replace(EMAIL_RE, "[email]")
    .replace(IPV4_RE, "[ip]")
    .replace(TOKEN_RE, "[redacted]");
}

async function readJsonSafe(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return typeof value === "string" ? scrubLine(value) : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (/token|secret|password|api[_-]?key|authorization|bearer/i.test(key)) return [key, "[redacted]"];
    return [key, redact(item)];
  }));
}

async function recentLogLines(logsDir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(logsDir, { withFileTypes: true });
    const files = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
      const filePath = path.join(logsDir, entry.name);
      const stat = await fsp.stat(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    }));
    const newest = files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 5);
    const lines: string[] = [];
    for (const file of newest) {
      const content = await fsp.readFile(file.filePath, "utf8").catch(() => "");
      const tail = content.split(/\r?\n/).filter(Boolean).slice(-20);
      lines.push(...tail.map(scrubLine));
    }
    return lines.slice(-80);
  } catch {
    return [];
  }
}

async function crashReportNames(userData: string): Promise<string[]> {
  const roots = [path.join(userData, "Crashpad", "completed"), path.join(userData, "Crashpad", "pending")];
  const names: string[] = [];
  for (const root of roots) {
    try {
      for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
        if (entry.isFile()) names.push(entry.name);
      }
    } catch {
      // Missing crash directories are normal.
    }
  }
  return names.sort().slice(-50);
}

function collectSystemInfo(context: IpcHandlerContext): Record<string, unknown> {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: typeof os.version === "function" ? os.version() : undefined,
    locale: app.getLocale(),
    userData: scrubLine(app.getPath("userData")),
    logs: scrubLine(app.getPath("logs")),
    mainViewUrl: context.windows.mainView.webContents.getURL(),
  };
}

async function collectConfig(context: IpcHandlerContext): Promise<Record<string, unknown>> {
  return {
    appConfig: redact(context.settings.getAppConfig()),
    preferences: redact(context.settings.getPreferences()),
    mcpServers: redact(context.settings.getMcpServersConfig()),
    appliedCustom3pConfigId: context.settings.getAppliedCustom3pConfigId?.() ?? null,
    settingsFile: scrubLine(context.settings.getSettingsFile()),
    settingsJson: redact(await readJsonSafe(context.settings.getSettingsFile())),
  };
}

async function buildDiagnosticBundle(context: IpcHandlerContext): Promise<DiagnosticBundle> {
  const referenceId = `diag_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  const payload = {
    referenceId,
    createdAt: new Date().toISOString(),
    system: collectSystemInfo(context),
    config: await collectConfig(context),
    reachability: { appProtocol: "ok", inference: "not_probed", mcp: "not_probed" },
    logs: await recentLogLines(app.getPath("logs")),
    crashReports: await crashReportNames(app.getPath("userData")),
  };
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  return { referenceId, createdAt: String(payload.createdAt), payload, text };
}

async function prepareBundle(context: IpcHandlerContext): Promise<SupportBundleState> {
  setState({ stage: "packaging", stepLabel: "Collecting app and system info" }, context.windows.mainView.webContents);
  try {
    lastBundle = await buildDiagnosticBundle(context);
    const previewLines = lastBundle.text.split(/\r?\n/).slice(0, 60).map(scrubLine);
    return setState({
      stage: "ready",
      referenceId: lastBundle.referenceId,
      sizeBytes: Buffer.byteLength(lastBundle.text),
      previewLines,
      canSend: false,
    }, context.windows.mainView.webContents);
  } catch (error) {
    return setState({
      stage: "ready",
      error: error instanceof Error ? error.message : String(error),
      canSend: false,
    }, context.windows.mainView.webContents);
  }
}

async function exportBundle(context: IpcHandlerContext): Promise<SupportBundleState> {
  if (!lastBundle) await prepareBundle(context);
  if (!lastBundle) return state;
  setState({ ...state, stage: "exporting" }, context.windows.mainView.webContents);
  const result = await dialog.showSaveDialog(context.windows.mainWindow, {
    title: "Export Diagnostic Report",
    defaultPath: path.join(app.getPath("downloads"), `${lastBundle.referenceId}.json`),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return setState({ ...state, stage: "ready" }, context.windows.mainView.webContents);
  await fsp.writeFile(result.filePath, lastBundle.text, "utf8");
  lastSavedPath = result.filePath;
  return setState({ stage: "saved", savedPath: scrubLine(result.filePath), referenceId: lastBundle.referenceId }, context.windows.mainView.webContents);
}

export async function handleSupportBundleAction(context: IpcHandlerContext, action: unknown): Promise<boolean> {
  switch (action) {
    case "cancel":
      setState({ stage: "closed" }, context.windows.mainView.webContents);
      return true;
    case "export":
      await exportBundle(context);
      return true;
    case "reveal":
      if (lastSavedPath && fs.existsSync(lastSavedPath)) shell.showItemInFolder(lastSavedPath);
      return true;
    case "send":
      return false;
    default:
      await prepareBundle(context);
      return true;
  }
}
