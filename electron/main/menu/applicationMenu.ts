import {
  app,
  BrowserWindow,
  clipboard,
  contentTracing,
  dialog,
  Menu,
  netLog,
  shell,
  webContents as electronWebContents,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import inspector from "node:inspector";
import path from "node:path";
import { promisify } from "node:util";
import v8 from "node:v8";
import {
  ensureExtensionFolders,
  installDxtArchive,
  installUnpackedExtension as installUnpackedDesktopExtension,
} from "../services/extensions/desktopExtensions";
import { handleSupportBundleAction } from "../services/support/supportBundle";
import { openCustom3pSetupWindow } from "../windows/custom3pSetupWindow";
import type { IpcHandlerContext } from "../ipc/context";
import { dispatchBridgeEvent } from "../ipc/registerIpc";

const execFileAsync = promisify(execFile);
let isPerformanceTraceRecording = false;
let isMemoryTraceRecording = false;

function getMainView(context: IpcHandlerContext): WebContents {
  return context.windows.mainView.webContents;
}

function showAndFocusMainWindow(context: IpcHandlerContext): void {
  const { mainWindow, mainView } = context.windows;
  if (mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainView.webContents.focus();
}

function loadAppPath(context: IpcHandlerContext, pathname: string): void {
  const url = new URL("app://localhost");
  url.pathname = pathname;
  void getMainView(context).loadURL(url.toString());
  showAndFocusMainWindow(context);
}

function openSettings(context: IpcHandlerContext): void {
  loadAppPath(context, "/settings/desktop");
}

function newConversation(context: IpcHandlerContext): void {
  loadAppPath(context, "/task/new");
}

async function openFile(context: IpcHandlerContext): Promise<void> {
  const result = await dialog.showOpenDialog(context.windows.mainWindow, {
    title: "打开文件",
    properties: ["openFile"],
  });
  const filePath = result.filePaths[0];
  if (result.canceled || !filePath) return;
  await shell.openPath(filePath);
}

function copyCurrentUrl(context: IpcHandlerContext): void {
  const url = getMainView(context).getURL();
  if (url) clipboard.writeText(url);
}

function requestFind(context: IpcHandlerContext): void {
  const { findInPageView } = context.windows;
  findInPageView.setVisible(true);
  context.windows.layout();
  findInPageView.webContents.focus();
  dispatchBridgeEvent(getMainView(context), "claude.web", "FindInPageProvider", "findRequest", null);
}

function revealPath(targetPath: string): void {
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    shell.showItemInFolder(targetPath);
    return;
  }
  void shell.openPath(targetPath);
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function tracesDir(): string {
  return path.join(app.getPath("logs"), "traces");
}

async function ensureJsonFile(filePath: string, initialValue: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.access(filePath);
  } catch {
    await fs.promises.writeFile(filePath, `${JSON.stringify(initialValue, null, 2)}\n`, "utf8");
  }
}

async function ensureEmptyFile(filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.access(filePath);
  } catch {
    await fs.promises.writeFile(filePath, "", "utf8");
  }
}

function getClaudeDesktopConfigFile(context: IpcHandlerContext): string {
  return path.join(context.settings.getUserDataDir(), "claude_desktop_config.json");
}

function getDeveloperConfigFile(context: IpcHandlerContext): string {
  return path.join(context.settings.getUserDataDir(), "developer_settings.json");
}

function getMcpLogFile(context: IpcHandlerContext): string {
  return path.join(context.settings.getLogsDir(), "main.log");
}

function getInstallationId(context: IpcHandlerContext): string {
  return crypto.createHash("sha256").update(context.settings.getUserDataDir()).digest("hex").slice(0, 24);
}

async function checkForUpdates(context: IpcHandlerContext): Promise<void> {
  await dialog.showMessageBox(context.windows.mainWindow, {
    type: "info",
    message: "当前构建未接入自动更新",
    detail: "这个重建版壳子不会从 Anthropic 自动更新；需要通过本地打包产物更新。",
    buttons: ["好"],
  });
}

async function recordNetLog(context: IpcHandlerContext): Promise<void> {
  if (netLog.currentlyLogging) return;

  const durationMs = 30_000;
  const startedAt = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(app.getPath("downloads"), `claude-netlog-${startedAt}.json`);
  await netLog.startLogging(target);
  context.windows.mainWindow.setProgressBar(0);

  let elapsed = 0;
  const interval = setInterval(() => {
    elapsed += 250;
    context.windows.mainWindow.setProgressBar(Math.min(elapsed / durationMs, 1));
  }, 250);

  await new Promise((resolve) => setTimeout(resolve, durationMs));
  clearInterval(interval);
  await netLog.stopLogging();
  context.windows.mainWindow.setProgressBar(-1);
  shell.showItemInFolder(target);
}

async function resetAppData(context: IpcHandlerContext): Promise<void> {
  const { response } = await dialog.showMessageBox(context.windows.mainWindow, {
    type: "warning",
    message: "确认重置应用数据？",
    detail: `这会删除当前壳子的本地设置目录：\n${context.settings.getUserDataDir()}\n\n应用会退出，重新启动后会重新生成。`,
    buttons: ["取消", "重置并退出"],
    defaultId: 0,
    cancelId: 0,
  });
  if (response !== 1) return;
  await fs.promises.rm(context.settings.getUserDataDir(), { recursive: true, force: true });
  app.quit();
}

function zoom(context: IpcHandlerContext, delta: number): void {
  const webContents = getMainView(context);
  webContents.setZoomLevel(webContents.getZoomLevel() + delta);
  dispatchBridgeEvent(webContents, "claude.web", "WindowState", "zoomFactorChanged", webContents.getZoomFactor());
}

function resetZoom(context: IpcHandlerContext): void {
  const webContents = getMainView(context);
  webContents.setZoomLevel(0);
  dispatchBridgeEvent(webContents, "claude.web", "WindowState", "zoomFactorChanged", webContents.getZoomFactor());
}

function showDevTools(context: IpcHandlerContext): void {
  const focused = electronWebContents.getFocusedWebContents() ?? getMainView(context);
  if (focused.isDestroyed()) return;
  if (focused.isDevToolsOpened()) {
    void focused.devToolsWebContents?.executeJavaScript("InspectorFrontendHost.bringToFront()").catch(() => undefined);
    return;
  }
  focused.openDevTools({ mode: "detach" });
}

function showAllDevTools(context: IpcHandlerContext): void {
  const targets = [
    context.windows.mainWindow.webContents,
    context.windows.mainView.webContents,
    context.windows.findInPageView.webContents,
    context.windows.secondaryWindows.getWindow("about")?.webContents,
    context.windows.secondaryWindows.getWindow("quick")?.webContents,
    context.windows.secondaryWindows.getWindow("buddy")?.webContents,
  ];

  for (const target of targets) {
    if (!target || target.isDestroyed() || target.isDevToolsOpened()) continue;
    target.openDevTools({ mode: "detach" });
  }
  showDevTools(context);
}

async function toggleMainProcessDebugger(context: IpcHandlerContext): Promise<void> {
  try {
    if (inspector.url()) {
      inspector.close();
      return;
    }
    inspector.open(0, "127.0.0.1", false);
    if (process.platform === "darwin") await execFileAsync("/usr/bin/open", ["-a", "Google Chrome", "chrome://inspect"]);
    else await shell.openExternal("chrome://inspect");
  } catch {
    await dialog.showMessageBox(context.windows.mainWindow, {
      type: "info",
      title: "Inspector",
      message: "Inspector session is active. Please open Chrome DevTools (chrome://inspect) in a browser of your choice.",
    });
  }
}

async function togglePerformanceTrace(context: IpcHandlerContext): Promise<void> {
  if (isPerformanceTraceRecording) {
    const targetDir = tracesDir();
    await fs.promises.mkdir(targetDir, { recursive: true });
    const target = path.join(targetDir, `desktop-trace-${timestampForFilename()}.json`);
    const tracePath = await contentTracing.stopRecording(target);
    isPerformanceTraceRecording = false;
    shell.showItemInFolder(tracePath);
    return;
  }

  if (isMemoryTraceRecording) {
    await dialog.showMessageBox(context.windows.mainWindow, {
      type: "warning",
      message: "Memory trace 正在运行，不能同时启动 Performance Trace。",
    });
    return;
  }

  await contentTracing.startRecording({
    included_categories: ["devtools.timeline", "blink.user_timing", "ipc", "toplevel", "electron"],
  });
  isPerformanceTraceRecording = true;
}

async function writeMainProcessHeapSnapshot(context: IpcHandlerContext): Promise<void> {
  try {
    const targetDir = tracesDir();
    await fs.promises.mkdir(targetDir, { recursive: true });
    const target = path.join(targetDir, `main-heap-${timestampForFilename()}.heapsnapshot`);
    const writtenPath = v8.writeHeapSnapshot(target);
    shell.showItemInFolder(writtenPath);
  } catch (error) {
    dialog.showErrorBox("Heap snapshot failed", `Could not write heap snapshot: ${String(error)}`);
    showAndFocusMainWindow(context);
  }
}

async function stopMemoryTrace(): Promise<void> {
  const targetDir = tracesDir();
  await fs.promises.mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, `memory-trace-${timestampForFilename()}.json`);
  const tracePath = await contentTracing.stopRecording(target);
  isMemoryTraceRecording = false;
  shell.showItemInFolder(tracePath);
}

async function startMemoryTrace(context: IpcHandlerContext): Promise<void> {
  if (isPerformanceTraceRecording || isMemoryTraceRecording) {
    await dialog.showMessageBox(context.windows.mainWindow, {
      type: "warning",
      message: "已有 trace 正在运行。",
    });
    return;
  }

  const minutes = Number(process.env.CU_MEMORY_TRACE_MINUTES) || 3;
  await contentTracing.startRecording({
    included_categories: ["disabled-by-default-memory-infra", "v8", "blink.user_timing"],
    memory_dump_config: { triggers: [{ mode: "detailed", periodic_interval_ms: 10_000 }] },
  });
  isMemoryTraceRecording = true;
  setTimeout(() => {
    void stopMemoryTrace().catch(() => {
      isMemoryTraceRecording = false;
    });
  }, minutes * 60_000);
}

async function openAppConfigFile(context: IpcHandlerContext): Promise<void> {
  const filePath = getClaudeDesktopConfigFile(context);
  await ensureJsonFile(filePath, {
    mcpServers: context.settings.getMcpServersConfig(),
    preferences: context.settings.getPreferences(),
  });
  await shell.openPath(filePath);
}

async function openDeveloperConfigFile(context: IpcHandlerContext): Promise<void> {
  const filePath = getDeveloperConfigFile(context);
  await ensureJsonFile(filePath, { allowDevTools: true });
  await shell.openPath(filePath);
}

async function openMcpLogFile(context: IpcHandlerContext): Promise<void> {
  const filePath = getMcpLogFile(context);
  await ensureEmptyFile(filePath);
  await shell.openPath(filePath);
}

async function installExtensionArchive(context: IpcHandlerContext): Promise<void> {
  const result = await dialog.showOpenDialog(context.windows.mainWindow, {
    title: "安装扩展",
    properties: ["openFile"],
    filters: [
      { name: "Extension Archives", extensions: ["dxt", "zip"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  const source = result.filePaths[0];
  if (result.canceled || !source) return;
  await installDxtArchive(context.settings.getUserDataDir(), source);
  dispatchBridgeEvent(getMainView(context), "claude.settings", "Extensions", "extensionsChanged");
  revealPath((await ensureExtensionFolders(context.settings.getUserDataDir())).extensionsDir);
}

async function installUnpackedExtension(context: IpcHandlerContext): Promise<void> {
  const result = await dialog.showOpenDialog(context.windows.mainWindow, {
    title: "选择扩展文件夹",
    buttonLabel: "安装",
    properties: ["openDirectory"],
  });
  const source = result.filePaths[0];
  if (result.canceled || !source) return;
  const installed = await installUnpackedDesktopExtension(context.settings.getUserDataDir(), source);
  dispatchBridgeEvent(getMainView(context), "claude.settings", "Extensions", "extensionsChanged");
  revealPath(installed.path);
}

function closeFocusedWindow(context: IpcHandlerContext): void {
  const browserWindow = BrowserWindow.getFocusedWindow() ?? context.windows.mainWindow;
  if (!browserWindow.isDestroyed()) browserWindow.close();
}

function createMacAppMenu(context: IpcHandlerContext): MenuItemConstructorOptions {
  return {
    label: app.getName(),
    submenu: [
      { label: "关于 Claude", click: () => void context.windows.secondaryWindows.openAboutWindow() },
      { type: "separator" },
      { label: "设置…", accelerator: "CommandOrControl+,", click: () => openSettings(context) },
      { label: "检查更新…", click: () => void checkForUpdates(context) },
      { type: "separator" },
      { role: "services", label: "服务" },
      { type: "separator" },
      { role: "hide", label: "隐藏 Claude" },
      { role: "hideOthers", label: "隐藏其他" },
      { role: "unhide", label: "全部显示" },
      { type: "separator" },
      { label: "退出 Claude", accelerator: "CommandOrControl+Q", click: () => app.quit() },
    ],
  };
}

function createFileMenu(context: IpcHandlerContext): MenuItemConstructorOptions {
  return {
    label: "文件",
    submenu: [
      { label: "新会话", accelerator: "CommandOrControl+N", click: () => newConversation(context) },
      { label: "打开文件…", accelerator: "CommandOrControl+O", click: () => void openFile(context) },
      { type: "separator" },
      { label: "关闭窗口", accelerator: "CommandOrControl+W", click: () => closeFocusedWindow(context) },
    ],
  };
}

function createEditMenu(context: IpcHandlerContext): MenuItemConstructorOptions {
  void context;
  return {
    label: "编辑",
    submenu: [
      { label: "撤销", accelerator: "CommandOrControl+Z", role: "undo" },
      { label: "重做", accelerator: "CommandOrControl+Shift+Z", role: "redo" },
      { type: "separator" },
      { label: "剪切", accelerator: "CommandOrControl+X", role: "cut" },
      { label: "复制", accelerator: "CommandOrControl+C", role: "copy" },
      { label: "粘贴", accelerator: "CommandOrControl+V", role: "paste" },
      { label: "粘贴并匹配样式", accelerator: "CommandOrControl+Shift+V", role: "pasteAndMatchStyle", visible: false, acceleratorWorksWhenHidden: true },
      { label: "全选", accelerator: "CommandOrControl+A", role: "selectAll" },
      { type: "separator" },
      { label: "查找", accelerator: "CommandOrControl+F", click: () => requestFind(context) },
    ],
  };
}

function createViewMenu(context: IpcHandlerContext): MenuItemConstructorOptions {
  return {
    label: "看法",
    submenu: [
      { label: "重新加载此页面", accelerator: "CommandOrControl+R", click: () => getMainView(context).reload() },
      { label: "后退", accelerator: "Command+[", click: () => getMainView(context).navigationHistory.goBack() },
      { label: "前进", accelerator: "Command+]", click: () => getMainView(context).navigationHistory.goForward() },
      { type: "separator" },
      { id: "actual-size", label: "实际大小", accelerator: "CommandOrControl+0", click: () => resetZoom(context) },
      { label: "放大", accelerator: "CommandOrControl+Plus", click: () => zoom(context, 1) },
      { label: "放大", accelerator: "CommandOrControl+=", visible: false, acceleratorWorksWhenHidden: true, click: () => zoom(context, 1) },
      { label: "缩小", accelerator: "CommandOrControl+-", click: () => zoom(context, -1) },
      { label: "放大（数字键盘）", accelerator: "CommandOrControl+numadd", visible: false, acceleratorWorksWhenHidden: true, click: () => zoom(context, 1) },
      { label: "缩小（数字键盘）", accelerator: "CommandOrControl+numsub", visible: false, acceleratorWorksWhenHidden: true, click: () => zoom(context, -1) },
      { label: "实际大小（数字键盘）", accelerator: "CommandOrControl+num0", visible: false, acceleratorWorksWhenHidden: true, click: () => resetZoom(context) },
      { type: "separator" },
      { label: "复制 URL", click: () => copyCurrentUrl(context) },
    ],
  };
}

function createDeveloperMenu(context: IpcHandlerContext): MenuItemConstructorOptions {
  return {
    label: "开发者",
    submenu: [
      { label: "打开 MCP 日志文件", click: () => void openMcpLogFile(context) },
      {
        label: "重新加载 MCP 配置",
        click: () => dispatchBridgeEvent(getMainView(context), "claude.settings", "MCP", "mcpConfigChange", context.settings.getMcpServersConfig()),
      },
      { type: "separator" },
      { label: "配置第三方推理…", click: () => void openCustom3pSetupWindow(context.windows.mainWindow) },
      { type: "separator" },
      {
        label: "扩展",
        submenu: [
          { label: "安装扩展…", click: () => void installExtensionArchive(context) },
          { label: "安装未打包扩展…", click: () => void installUnpackedExtension(context) },
          {
            label: "打开扩展文件夹…",
            click: async () => {
              revealPath((await ensureExtensionFolders(context.settings.getUserDataDir())).extensionsDir);
            },
          },
          {
            label: "打开扩展设置文件夹…",
            click: async () => {
              revealPath((await ensureExtensionFolders(context.settings.getUserDataDir())).settingsDir);
            },
          },
        ],
      },
      { type: "separator" },
      { label: "打开应用程序配置文件…", click: () => void openAppConfigFile(context) },
      { label: "打开开发者配置文件…", click: () => void openDeveloperConfigFile(context) },
      { type: "separator" },
      { label: "显示开发工具", accelerator: "CommandOrControl+Alt+I", acceleratorWorksWhenHidden: true, click: () => showDevTools(context) },
      { label: "显示所有开发工具", click: () => showAllDevTools(context) },
      { type: "separator" },
      { label: "Enable Main Process Debugger", type: "checkbox", checked: Boolean(inspector.url()), click: () => void toggleMainProcessDebugger(context) },
      { label: "Record Performance Trace", type: "checkbox", checked: isPerformanceTraceRecording, click: () => void togglePerformanceTrace(context) },
      { label: "Write Main Process Heap Snapshot", click: () => void writeMainProcessHeapSnapshot(context) },
      { label: "Record Memory Trace (auto-stop)", enabled: !isPerformanceTraceRecording && !isMemoryTraceRecording, click: () => void startMemoryTrace(context) },
    ],
  };
}

function createWindowMenu(context: IpcHandlerContext): MenuItemConstructorOptions {
  return {
    role: "window",
    label: "窗口",
    submenu: [
      { label: "显示主窗口", click: () => showAndFocusMainWindow(context) },
      { role: "minimize", label: "最小化" },
      { label: "关闭窗口", accelerator: "CommandOrControl+W", click: () => closeFocusedWindow(context) },
      { type: "separator" },
      { role: "front", label: "全部置于前面" },
    ],
  };
}

function createHelpMenu(context: IpcHandlerContext): MenuItemConstructorOptions {
  return {
    role: "help",
    label: "帮助",
    submenu: [
      { label: "Claude 帮助", click: () => void shell.openExternal("https://support.anthropic.com/") },
      { label: "打开文档", click: () => void shell.openExternal("https://docs.anthropic.com/") },
      { label: "检查更新…", click: () => void checkForUpdates(context) },
      { type: "separator" },
      {
        label: "故障排除",
        submenu: [
          { label: "在 Finder 中显示日志", click: () => revealPath(context.settings.getLogsDir()) },
          { label: "在 Finder 中显示会话数据", click: () => revealPath(context.settings.getUserDataDir()) },
          { label: "复制安装 ID", click: () => clipboard.writeText(getInstallationId(context)) },
          { label: "生成诊断报告", click: () => void handleSupportBundleAction(context, "open") },
          { label: "记录网络日志（30 秒）", click: () => void recordNetLog(context) },
          { type: "separator" },
          { label: "重置应用数据…", click: () => void resetAppData(context) },
        ],
      },
      { type: "separator" },
      { label: "获取支持", click: () => void shell.openExternal("https://support.claude.com/en/articles/9015913-how-to-get-support") },
      { label: "关于…", click: () => void context.windows.secondaryWindows.openAboutWindow() },
    ],
  };
}

function createApplicationMenuTemplate(context: IpcHandlerContext): MenuItemConstructorOptions[] {
  const template = [
    createFileMenu(context),
    createEditMenu(context),
    createViewMenu(context),
    createDeveloperMenu(context),
    createWindowMenu(context),
    createHelpMenu(context),
  ];
  if (process.platform === "darwin") template.unshift(createMacAppMenu(context));
  return template;
}

export function installApplicationMenu(context: IpcHandlerContext): void {
  app.setName("Claude");
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(context)));
}

export function getApplicationMenuSummary(): string[] {
  const menu = Menu.getApplicationMenu();
  if (!menu) return [];
  return menu.items.map((item) => item.label || item.role || "");
}
