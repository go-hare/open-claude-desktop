import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { resolveElectronShellPaths, type ElectronShellPaths } from "./paths/electronShellPaths";
import { installAppProtocolHandler, registerAppProtocolScheme } from "./protocol";
import { bundledClaudeExecutable, defaultClaudeExecutable } from "./services/localSessions/claudeCliRunner";
import { configureOriginalRuntimeModules } from "./services/originalRuntime/originalRuntimeModules";
import { createDefaultIpcContext, registerDesktopIpc } from "./ipc";
import { getIpcHandlerRegistrySummary } from "./ipc/handlerRegistry";
import { getApplicationMenuSummary, installApplicationMenu } from "./menu/applicationMenu";
import {
  applyOriginalTitleBarOverlay,
  createDesktopWindow,
  getOriginalWindowBackgroundColor,
  type DesktopTelemetryConfig,
  type DesktopWindowParts,
  type SidebarMode,
} from "./windows";
import {
  createWindowStateKeeper,
  dispatchLaunchTarget,
  extractLaunchTarget,
  installDesktopAppLifecycle,
  installQuitState,
  installSingleInstanceGuard,
  installWindowStateEventDispatch,
  type LaunchTarget,
} from "./lifecycle";
import {
  shouldQuitOnMainWindowClose,
  syncMenuBarTray,
} from "./services/settings/menuBarTray";
import { ensureDevSwiftFonts } from "./services/settings/devSwiftFonts";
import { ensureDevSwiftLocalizations } from "./services/settings/devSwiftLocalizations";
import { ensureDevSwiftScreenAssets } from "./services/settings/devSwiftScreenAssets";

export type DesktopAppOptions = {
  paths?: ElectronShellPaths;
  ionDistRoot?: string;
  baseUrl?: string;
  initialMainViewUrl?: string;
  sidebarMode?: SidebarMode;
  desktopFeatures?: Record<string, unknown>;
  desktopEnterpriseConfig?: Record<string, unknown>;
  desktopTelemetryConfig?: DesktopTelemetryConfig;
  hasRendererConfig?: boolean;
  onLaunchTarget?: (target: LaunchTarget) => void | Promise<void>;
};

export type DesktopAppRuntime = {
  getWindows: () => DesktopWindowParts | null;
  createAndLoadWindow: () => Promise<DesktopWindowParts>;
};

function defaultTelemetryConfig(): DesktopTelemetryConfig {
  return {
    deploymentMode: "3p",
    appVersion: app.getVersion(),
    cookielessOrigin: true,
  };
}

function installProcessSignalHandlers(): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGQUIT", "SIGHUP"] as const) {
    process.on(signal, () => app.quit());
  }
}

function applyUserDataOverride(): void {
  const userDataDir = process.env.CLAUDE_USER_DATA_DIR;
  if (!userDataDir) return;

  fs.mkdirSync(userDataDir, { recursive: true });
  app.setPath("userData", userDataDir);
  app.setPath("logs", path.join(userDataDir, "Logs"));
}

/**
 * Product display name for menus / about panel.
 * Must NOT be bare "Claude" — that collides with official Claude Desktop in Dock
 * naming and confuses TCC. Bundle ID is the real separator; name should match product.
 */
function applyProductAppName(): void {
  const productName = process.env.CLAUDE_PRODUCT_NAME ?? "Claude-Deepseek";
  if (app.getName() !== productName) app.setName(productName);
}

function getInitialMainViewUrlOverride(options: DesktopAppOptions): string | undefined {
  const value = options.initialMainViewUrl ?? process.env.CLAUDE_DESKTOP_MAIN_VIEW_URL;
  if (!value) return undefined;
  const url = new URL(value);
  if (!["app:", "http:", "https:"].includes(url.protocol)) throw new Error(`Unsupported CLAUDE_DESKTOP_MAIN_VIEW_URL protocol: ${url.protocol}`);
  // The original compiled mainView preload only exposes `claude.web` on the
  // official origins plus `localhost`/`app://localhost`. Keep the user's
  // loopback dev URL working, but load it through the origin the original JS
  // actually trusts so the desktop bridge is present before the React bundle
  // initializes.
  if ((url.hostname === "127.0.0.1" || url.hostname === "::1") && (url.protocol === "http:" || url.protocol === "https:")) {
    url.hostname = "localhost";
  }
  return url.toString();
}

function maybeCompleteSmoke(runtime: DesktopAppRuntime): void {
  if (!process.env.CLAUDE_DESKTOP_SMOKE_TEST) return;

  const windows = runtime.getWindows();
  const findInPageVisible =
    windows && typeof (windows.findInPageView as unknown as { getVisible?: () => boolean }).getVisible === "function"
      ? (windows.findInPageView as unknown as { getVisible: () => boolean }).getVisible()
      : null;
  const payload = {
    ok: Boolean(windows && !windows.mainWindow.isDestroyed() && !windows.mainView.webContents.isDestroyed()),
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    mainWindowVisible: windows?.mainWindow.isVisible() ?? false,
    mainViewUrl: windows?.mainView.webContents.getURL() ?? null,
    findInPageVisible,
    applicationMenu: getApplicationMenuSummary(),
    ipcHandlers: getIpcHandlerRegistrySummary(),
    claudeCode: {
      executable: defaultClaudeExecutable(),
      bundledExecutable: bundledClaudeExecutable() ?? null,
      usesBundledExecutable: defaultClaudeExecutable() === bundledClaudeExecutable(),
    },
  };

  fs.writeSync(1, `[claude-deepseek-smoke] ${JSON.stringify(payload)}\n`);
}

export function createDesktopAppRuntime(options: DesktopAppOptions = {}): DesktopAppRuntime {
  const paths = options.paths ?? resolveElectronShellPaths();
  const quitState = installQuitState(app);
  let windows: DesktopWindowParts | null = null;

  const handleLaunchTarget = (target: LaunchTarget) => {
    dispatchLaunchTarget(windows, target);
    void options.onLaunchTarget?.(target);
  };

  const createAndLoadWindow = async () => {
    const windowState = createWindowStateKeeper({ defaultWidth: 1200, defaultHeight: 800 });
    // context is created after window, but close residual needs settings.menuBarEnabled.
    // Wire tray-disabled quit after IPC context exists (see below).
    let shouldQuitWhenTrayDisabled = () => false;
    windows = createDesktopWindow({
      paths,
      baseUrl: options.baseUrl ?? "app://localhost",
      initialMainViewUrl: getInitialMainViewUrlOverride(options),
      sidebarMode: options.sidebarMode,
      hasRendererConfig: options.hasRendererConfig ?? true,
      desktopFeatures: options.desktopFeatures,
      desktopEnterpriseConfig: options.desktopEnterpriseConfig,
      desktopTelemetryConfig: options.desktopTelemetryConfig ?? defaultTelemetryConfig(),
      shouldQuitOnClose: quitState.shouldQuitOnClose,
      shouldQuitWhenTrayDisabled: () => shouldQuitWhenTrayDisabled(),
      windowState,
    });

    windowState.manage(windows.mainWindow);
    installWindowStateEventDispatch(windows);
    const context = createDefaultIpcContext(windows);
    // Official win32: close quits when !gi("menuBarEnabled").
    shouldQuitWhenTrayDisabled = () =>
      shouldQuitOnMainWindowClose({
        menuBarEnabled: context.settings.isMenuBarEnabled(),
      });
    registerDesktopIpc(context);
    installApplicationMenu(context);
    await windows.loadAll();
    return windows;
  };

  installSingleInstanceGuard({
    app,
    getMainWindow: () => windows?.mainWindow,
    onSecondInstanceTarget: handleLaunchTarget,
  });

  installDesktopAppLifecycle({
    app,
    getWindows: () => windows,
    createAndLoadWindow,
    onNativeThemeUpdated: () => {
      if (!windows || windows.mainWindow.isDestroyed()) return;
      windows.mainWindow.setBackgroundColor(getOriginalWindowBackgroundColor());
      applyOriginalTitleBarOverlay(windows.mainWindow);
      // Official nativeTheme.updated → lKA() refresh tray icon (win dark/light).
      syncMenuBarTray();
    },
  });

  return {
    getWindows: () => windows,
    createAndLoadWindow,
  };
}

/**
 * Main-process entry equivalent to original `.vite/build/index.js` ready block.
 * `registerAppProtocolScheme()` must run before `app.whenReady()`.
 */
export async function bootstrapDesktopApp(options: DesktopAppOptions = {}): Promise<DesktopAppRuntime> {
  configureOriginalRuntimeModules();
  applyProductAppName();
  applyUserDataOverride();
  registerAppProtocolScheme();
  installProcessSignalHandlers();

  const paths = options.paths ?? resolveElectronShellPaths();
  const runtime = createDesktopAppRuntime({ ...options, paths });
  const initialTarget = extractLaunchTarget(process.argv);

  await app.whenReady();
  // Official Swift FontLoader residual: process.resourcesPath/fonts.
  // Dev Electron framework Resources has no fonts — symlink project resources/fonts.
  ensureDevSwiftFonts();
  // Official Quick Entry share/screenshot residual: Localizable.strings in *.lproj
  // ("Quickly share content with Claude" / "Send a screenshot of " / permission bar).
  ensureDevSwiftLocalizations();
  // Official Quick Entry share residual assets: claude-screen*.png + Assets.car
  // (QuickScreenshotView strip / NSImage catalog). Dev Electron has none.
  ensureDevSwiftScreenAssets();
  // Official BbA: y7() + R0A() timer (1h / 5min) + id(() => I9t().finally(R0A)).
  // 3p kni short-circuits network; 1p uses /api/desktop/features + fcache.
  try {
    const { startCoworkGrowthBookLifecycle } = await import(
      "./services/coworkHostLoop/coworkGrowthBookLifecycle"
    );
    const { COWORK_HARDCODED_MAIN_GROWTHBOOK_FEATURES } = await import(
      "./services/coworkHostLoop/coworkGrowthBookFeatures"
    );
    const deploymentMode =
      process.env.CLAUDE_DEPLOYMENT_MODE
      ?? (options.desktopTelemetryConfig?.deploymentMode as string | undefined)
      ?? "3p";
    await startCoworkGrowthBookLifecycle({
      getHardcodedFeatures: () =>
        deploymentMode === "1p" ? null : COWORK_HARDCODED_MAIN_GROWTHBOOK_FEATURES,
      getClaudeAiBaseUrl: () =>
        process.env.CLAUDE_AI_URL?.trim() || "https://claude.ai",
      getUserDataPath: () => app.getPath("userData"),
      log: (...args) => console.info(...args),
    });
  } catch (error) {
    console.warn("[growthbook] init residual failed", error);
  }
  // Product residual: custom3p lists local plugins/dxt/MCP from userData (no Anthropic cloud invent).
  installAppProtocolHandler({
    ionDistRoot: options.ionDistRoot ?? paths.ionDistRoot,
    custom3p: {
      getUserDataPath: () => app.getPath("userData"),
      getMcpServersConfig: () => {
        try {
          const file = path.join(app.getPath("userData"), "mcp-servers.json");
          if (!fs.existsSync(file)) return {};
          const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
          return typeof raw === "object" && raw !== null && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {};
        } catch {
          return {};
        }
      },
    },
  });
  await runtime.createAndLoadWindow();

  if (initialTarget.deepLink || initialTarget.extensionPath || initialTarget.filePaths.length > 0) {
    dispatchLaunchTarget(runtime.getWindows(), initialTarget);
    void options.onLaunchTarget?.(initialTarget);
  }

  maybeCompleteSmoke(runtime);

  return runtime;
}

export function resolveIonDistFromResources(resourcesRoot = process.resourcesPath): string {
  return path.join(resourcesRoot, "ion-dist");
}
