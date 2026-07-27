import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { resolveElectronShellPaths, type ElectronShellPaths } from "./paths/electronShellPaths";
import { installAppProtocolHandler, registerAppProtocolScheme } from "./protocol";
import { resolveDeploymentModeFromUserData } from "./services/custom3p/deploymentMode";
import { bundledClaudeExecutable, defaultClaudeExecutable } from "./services/localSessions/claudeCliRunner";
import { configureOriginalRuntimeModules } from "./services/originalRuntime/originalRuntimeModules";
import { createDefaultIpcContext, registerDesktopIpc } from "./ipc";
import { getIpcHandlerRegistrySummary } from "./ipc/handlerRegistry";
import { getApplicationMenuSummary, installApplicationMenu } from "./menu/applicationMenu";
import {
  applyOriginalTitleBarOverlay,
  createDesktopWindow,
  getOriginalWindowBackgroundColor,
  resolveMainWindowLoadUrl,
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
  // Official N1e residual — do not hardcode "3p"; empty userData bag is 1p.
  // Official vst residual: cookielessOrigin: e.type === "3p"
  // Product dotClaude mode resolves to the 3p shell, so it lands in "3p" here.
  let deploymentMode: "1p" | "3p" = "1p";
  try {
    const mode = resolveDeploymentModeFromUserData(app.getPath("userData")).resolution.mode;
    deploymentMode = mode === "3p" ? "3p" : "1p";
  } catch {
    deploymentMode = "1p";
  }
  return {
    deploymentMode,
    appVersion: app.getVersion(),
    cookielessOrigin: deploymentMode === "3p",
  };
}

function installProcessSignalHandlers(): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGQUIT", "SIGHUP"] as const) {
    process.on(signal, () => app.quit());
  }
}

/**
 * Dev-mode stdio guard: when the launching shell dies (taskkill / terminal close),
 * electron's stdout pipe breaks. Any later console.info → EPIPE would otherwise
 * surface as an uncaughtException system dialog and kill the main process.
 * Swallow only harmless stdio/connection teardown codes; rethrow everything else.
 */
function installStdioGuards(): void {
  const SWALLOW = new Set(["EPIPE", "ERR_STREAM_DESTROYED", "ECONNRESET"]);
  process.on("uncaughtException", (err) => {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code && SWALLOW.has(code)) return;
    throw err;
  });
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

/**
 * Official getMainWindowUrl residual (two layers — do not collapse):
 *   1p Anthropic binary → mN https://claude.ai (ion then /login LoginRoute email form)
 *   3p → app://localhost
 * Product shell always hosts open-claude-web / app:// so LoginDesktop sVt/M5t can run.
 * CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW=1 opts into official mN host (rare debug).
 */
function getInitialMainViewUrlOverride(options: DesktopAppOptions): string {
  let deploymentMode: "1p" | "3p" = "1p";
  try {
    const telemetryMode = options.desktopTelemetryConfig?.deploymentMode;
    const resolved =
      telemetryMode === "3p" || telemetryMode === "1p"
        ? telemetryMode
        : resolveDeploymentModeFromUserData(app.getPath("userData")).resolution.mode;
    deploymentMode = resolved === "3p" ? "3p" : "1p";
  } catch {
    deploymentMode = "1p";
  }

  const productMainViewUrl =
    options.initialMainViewUrl ?? process.env.CLAUDE_DESKTOP_MAIN_VIEW_URL;

  return resolveMainWindowLoadUrl({
    deploymentMode,
    baseUrl: options.baseUrl ?? "app://localhost",
    productMainViewUrl,
    sidebarMode: options.sidebarMode,
    hasRendererConfig: options.hasRendererConfig ?? true,
  });
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
  installStdioGuards();

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
    // Official N1e residual: 1p uses remote features/fcache; 3p kni short-circuits.
    // Prefer userData desktop-shell-settings over hard default "3p".
    const deploymentMode =
      process.env.CLAUDE_DEPLOYMENT_MODE
      ?? (options.desktopTelemetryConfig?.deploymentMode as string | undefined)
      ?? resolveDeploymentModeFromUserData(app.getPath("userData")).resolution.mode;
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
  // Official N1e: bootstrap account synthesis gated by deployment mode from
  // userData/desktop-shell-settings applied bag (Hzt/SM). Empty bag → 1p logged-out.
  installAppProtocolHandler({
    ionDistRoot: options.ionDistRoot ?? paths.ionDistRoot,
    custom3p: {
      getUserDataPath: () => app.getPath("userData"),
      getDeploymentMode: () =>
        resolveDeploymentModeFromUserData(app.getPath("userData")).resolution,
      // Official eMA/u2 residual: bootstrap models come from applied enterprise bag
      // (userData/configLibrary inferenceModels), not hardcoded Sonnet/Opus.
      bootstrap: () => {
        const snapshot = resolveDeploymentModeFromUserData(app.getPath("userData"));
        const bag =
          snapshot.appliedConfig && typeof snapshot.appliedConfig === "object"
            ? (snapshot.appliedConfig as Record<string, unknown>)
            : {};
        return {
          provider: typeof bag.inferenceProvider === "string" ? bag.inferenceProvider : undefined,
          inferenceModels: Array.isArray(bag.inferenceModels) ? bag.inferenceModels : [],
          models: Array.isArray(bag.inferenceModels)
            ? bag.inferenceModels
                .map((row) => {
                  if (!row || typeof row !== "object") return null;
                  const item = row as Record<string, unknown>;
                  const id =
                    (typeof item.name === "string" && item.name) ||
                    (typeof item.id === "string" && item.id) ||
                    (typeof item.model === "string" && item.model) ||
                    "";
                  if (!id) return null;
                  return { id, name: id };
                })
                .filter((row): row is { id: string; name: string } => row !== null)
            : [],
        };
      },
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
