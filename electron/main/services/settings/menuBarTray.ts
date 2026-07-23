/**
 * Official menu bar / tray residual (app.asar index.js lKA / bSe / Lst):
 *
 *   Rh.on("menuBarEnabled", () => { lKA() });
 *   function lKA() {
 *     if (!app.isReady()) return;
 *     const enabled = gi("menuBarEnabled");
 *     if (w2A()) return; // mac native Claude Menubar.app helper — skip when present
 *     const icon = win
 *       ? (dark ? "Tray-Win32-Dark.ico" : "Tray-Win32.ico")
 *       : "TrayIconTemplate.png";
 *     destroy tray; if (enabled) create Tray, click → show, context menu Show App / Quit
 *   }
 *   EKA.setMenuBarEnabled(e) → xn("menuBarEnabled", e)
 *   EKA.isMenuBarEnabled() → gi("menuBarEnabled")
 *   main window close (win32): if !menuBarEnabled → quit; else hide
 *
 * Product residual: Electron Tray only (never invents mac Menubar.app helper success).
 * Icons live under resourcesRoot (Hot residual: packaged → process.resourcesPath).
 */
import {
  app,
  Menu,
  Tray,
  nativeImage,
  nativeTheme,
  type BrowserWindow,
} from "electron";
import fs from "node:fs";
import path from "node:path";

export type MenuBarTrayDeps = {
  getEnabled: () => boolean;
  getMainWindow: () => BrowserWindow | null | undefined;
  /**
   * Official yst residual (Lst click path): open Quick Entry when available.
   * Return true if Quick Entry handled the click (do not also show main).
   * Return false/void to fall through to main window show (Qst residual).
   */
  openQuickEntry?: () => boolean | Promise<boolean | void>;
  /** Official Hot() — packaged resourcesPath / dev resources/. */
  resourcesRoot?: string;
  isQuitting?: () => boolean;
  platform?: NodeJS.Platform;
  /** Inject for tests. */
  shouldUseDarkColors?: () => boolean;
};

let tray: Tray | null = null;
let deps: MenuBarTrayDeps | null = null;
/** Tracks first tray create this process (official Gst balloon residual uses first-create). */
let trayWasUndefined = true;

export function configureMenuBarTray(next: MenuBarTrayDeps): void {
  deps = next;
}

export function resetMenuBarTrayForTests(): void {
  destroyMenuBarTray();
  deps = null;
  trayWasUndefined = true;
}

export function getMenuBarTrayForTests(): Tray | null {
  return tray;
}

/** Official Hot residual resolution for tray assets. */
export function resolveTrayResourcesRoot(
  resourcesRoot?: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (resourcesRoot && fs.existsSync(resourcesRoot)) return resourcesRoot;
  if (app.isPackaged && process.resourcesPath) return process.resourcesPath;
  // Dev: electron/main/services/settings → ../../../../resources
  const fromModule = path.resolve(__dirname, "../../../../resources");
  if (fs.existsSync(fromModule)) return fromModule;
  const fromCwd = path.join(process.cwd(), "resources");
  if (fs.existsSync(fromCwd)) return fromCwd;
  // Unused platform param keeps signature aligned with icon helpers.
  void platform;
  return process.resourcesPath || fromModule;
}

/**
 * Official icon name residual:
 *   win → Tray-Win32[-Dark].ico from nativeTheme
 *   else → TrayIconTemplate.png (Electron loads @2x/@3x automatically)
 */
export function resolveTrayIconFileName(options: {
  platform?: NodeJS.Platform;
  dark?: boolean;
}): string {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return options.dark ? "Tray-Win32-Dark.ico" : "Tray-Win32.ico";
  }
  return "TrayIconTemplate.png";
}

export function resolveTrayIconPath(
  resourcesRoot: string,
  options: { platform?: NodeJS.Platform; dark?: boolean } = {},
): string {
  return path.join(resourcesRoot, resolveTrayIconFileName(options));
}

/**
 * Official win32 close residual:
 *   if (fn && !gi("menuBarEnabled")) quit; else hide
 * mac always hides (dock/activate residual) unless process is quitting
 * (quitting is handled separately via shouldQuitOnClose).
 */
export function shouldQuitOnMainWindowClose(options: {
  platform?: NodeJS.Platform;
  menuBarEnabled: boolean;
}): boolean {
  const platform = options.platform ?? process.platform;
  return platform === "win32" && options.menuBarEnabled !== true;
}

function darkColors(): boolean {
  if (deps?.shouldUseDarkColors) return deps.shouldUseDarkColors();
  try {
    return nativeTheme.shouldUseDarkColors;
  } catch {
    return false;
  }
}

/**
 * Official Qst residual (Show App menu item):
 *   visible ? (minimized ? restore : focus) : show
 * Product residual: also steal focus on macOS so menu-bar click can front the app
 * when another app is active (Electron app.focus({ steal: true })).
 */
export function showMainWindowFromTray(
  getMainWindow: (() => BrowserWindow | null | undefined) | undefined = deps?.getMainWindow,
): boolean {
  const win = getMainWindow?.();
  if (!win || win.isDestroyed()) return false;
  try {
    // macOS: without steal, focus often no-ops when Claude is not the active app.
    if (process.platform === "darwin") {
      try {
        app.focus({ steal: true });
      } catch {
        try {
          app.focus();
        } catch {
          /* ignore */
        }
      }
      try {
        if (app.dock && !app.dock.isVisible()) app.dock.show();
      } catch {
        /* ignore dock residual */
      }
    }
  } catch {
    /* ignore focus residual */
  }
  if (win.isMinimized()) {
    win.restore();
  } else if (!win.isVisible()) {
    win.show();
  }
  try {
    win.show();
    win.moveTop();
    win.focus();
  } catch {
    try {
      win.show();
      win.focus();
    } catch {
      /* ignore */
    }
  }
  return true;
}

function showMainWindow(): void {
  showMainWindowFromTray();
}

/**
 * Official Lst residual (tray click):
 *   try { if (!await yst()) show+focus main }
 * yst = quick entry path; when it returns true, main is not shown.
 */
export async function activateFromMenuBarTray(): Promise<void> {
  try {
    const openQuick = deps?.openQuickEntry;
    if (openQuick) {
      const handled = await openQuick();
      if (handled === true) return;
    }
  } catch (error) {
    console.warn("[menuBarTray] quick entry activate failed", error);
  }
  showMainWindow();
}

function quitApplication(): void {
  try {
    app.quit();
  } catch {
    /* ignore */
  }
}

function buildContextMenu(): Menu {
  // Official bSe: Show App + Quit (i18n ids DQTgg21B7g / dKX0bpR+a2).
  return Menu.buildFromTemplate([
    {
      label: "Show App",
      click: () => showMainWindow(),
    },
    {
      label: "Quit",
      click: () => quitApplication(),
    },
  ]);
}

export function destroyMenuBarTray(): void {
  if (tray) {
    try {
      tray.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
  }
}

/**
 * Official lKA residual — recreate tray from gi("menuBarEnabled").
 * No-ops before app ready; does not invent Claude Menubar.app helper (w2A).
 */
export function syncMenuBarTray(): void {
  if (!deps) return;
  try {
    if (!app.isReady()) return;
  } catch {
    return;
  }

  const enabled = deps.getEnabled() === true;
  const platform = deps.platform ?? process.platform;
  const resourcesRoot = resolveTrayResourcesRoot(deps.resourcesRoot, platform);
  const iconPath = resolveTrayIconPath(resourcesRoot, {
    platform,
    dark: darkColors(),
  });

  const firstCreate = trayWasUndefined;
  destroyMenuBarTray();
  trayWasUndefined = false;

  if (!enabled) return;
  if (!fs.existsSync(iconPath)) {
    // Honest: no icon → no tray (do not invent success with empty nativeImage).
    console.warn("[menuBarTray] tray icon missing:", iconPath);
    return;
  }

  try {
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      console.warn("[menuBarTray] tray icon empty:", iconPath);
      return;
    }
    tray = new Tray(image);
    tray.setToolTip("Claude");
    // Official: qB.on("click", () => void Lst()) — Lst tries quick entry then main.
    tray.on("click", () => {
      void activateFromMenuBarTray();
    });
    // Double-click also fronts the app (macOS sometimes delivers double-click).
    tray.on("double-click", () => {
      void activateFromMenuBarTray();
    });
    if (platform === "darwin") {
      // Official sr (darwin): right-click popUpContextMenu; click still shows app.
      tray.on("right-click", () => {
        tray?.popUpContextMenu(buildContextMenu());
      });
    } else {
      tray.setContextMenu(buildContextMenu());
    }
    // Official Gst balloon only on Windows firstrun — skip inventing firstrun argv.
    void firstCreate;
  } catch (error) {
    console.warn("[menuBarTray] failed to create tray", error);
    destroyMenuBarTray();
  }
}

/** Preference / Startup path residual after xn("menuBarEnabled", value). */
export function applyMenuBarEnabled(enabled: boolean): void {
  void enabled;
  syncMenuBarTray();
}
