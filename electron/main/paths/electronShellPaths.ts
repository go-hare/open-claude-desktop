import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type ElectronShellPaths = {
  appRoot: string;
  resourcesRoot: string;
  /**
   * Static root for app:// primary SPA (product-web when present, else ion-dist).
   * Named ionDistRoot for historical installAppProtocolHandler API.
   */
  ionDistRoot: string;
  /**
   * Official residual ion-dist (always resources/ion-dist when present).
   * Used for setup-desktop-3p / device-code-verify when primary root is product-web.
   */
  residualIonDistRoot: string;
  mainWindowPreload: string;
  mainViewPreload: string;
  findInPagePreload: string;
  aboutWindowPreload: string;
  quickWindowPreload: string;
  buddyPreload: string;
  mainWindowHtml: string;
  findInPageHtml: string;
  aboutWindowHtml: string;
  quickWindowHtml: string;
  buddyWindowHtml: string;
};

/**
 * Mirrors original app.asar paths:
 * - Contents/Resources/ion-dist
 * - .vite/build/mainWindow.js
 * - .vite/build/mainView.js
 * - .vite/build/findInPage.js
 * - .vite/build/aboutWindow.js / quickWindow.js / buddy.js
 * - .vite/renderer/main_window/index.html
 * - .vite/renderer/find_in_page/find-in-page.html
 * - .vite/renderer/about_window/about.html
 * - .vite/renderer/quick_window/quick-window.html
 * - .vite/renderer/buddy_window/buddy.html
 */
function resolveResourcesRoot(appRoot: string, resourcesRoot: string): string {
  const envResourcesRoot = process.env.CLAUDE_DESKTOP_RESOURCES_ROOT;
  if (envResourcesRoot) return envResourcesRoot;
  if (appRoot.endsWith("app.asar")) return path.dirname(appRoot);

  const projectResourcesRoot = path.join(appRoot, "resources");
  if (
    fs.existsSync(path.join(projectResourcesRoot, "product-web", "index.html"))
    || fs.existsSync(path.join(projectResourcesRoot, "ion-dist"))
  ) {
    return projectResourcesRoot;
  }

  return resourcesRoot;
}

/**
 * Static root for app://localhost.
 *
 * Two product routes (do not collapse):
 * - Packaged / local app:// → prefer resources/product-web (open-claude-web build).
 * - Residual ion-dist remains for audit / official asset comparison.
 * - Dev test still overrides main view with CLAUDE_DESKTOP_MAIN_VIEW_URL=http://…
 *
 * CLAUDE_DESKTOP_ION_DIST_ROOT forces an explicit static root when set.
 */
function resolveAppStaticRoot(resourcesRoot: string): string {
  const envRoot = process.env.CLAUDE_DESKTOP_ION_DIST_ROOT?.trim();
  if (envRoot) return envRoot;

  const productWeb = path.join(resourcesRoot, "product-web");
  if (fs.existsSync(path.join(productWeb, "index.html"))) return productWeb;

  return path.join(resourcesRoot, "ion-dist");
}

/** Official residual ion-dist directory (not product-web). */
function resolveResidualIonDistRoot(resourcesRoot: string): string {
  const envResidual = process.env.CLAUDE_DESKTOP_RESIDUAL_ION_DIST_ROOT?.trim();
  if (envResidual) return envResidual;
  return path.join(resourcesRoot, "ion-dist");
}

export function resolveElectronShellPaths(appRoot = app.getAppPath(), resourcesRoot = process.resourcesPath): ElectronShellPaths {
  const normalizedResourcesRoot = resolveResourcesRoot(appRoot, resourcesRoot);
  return {
    appRoot,
    resourcesRoot: normalizedResourcesRoot,
    ionDistRoot: resolveAppStaticRoot(normalizedResourcesRoot),
    residualIonDistRoot: resolveResidualIonDistRoot(normalizedResourcesRoot),
    mainWindowPreload: path.join(appRoot, ".vite/build/mainWindow.js"),
    mainViewPreload: path.join(appRoot, ".vite/build/mainView.js"),
    findInPagePreload: path.join(appRoot, ".vite/build/findInPage.js"),
    aboutWindowPreload: path.join(appRoot, ".vite/build/aboutWindow.js"),
    quickWindowPreload: path.join(appRoot, ".vite/build/quickWindow.js"),
    buddyPreload: path.join(appRoot, ".vite/build/buddy.js"),
    mainWindowHtml: path.join(appRoot, ".vite/renderer/main_window/index.html"),
    findInPageHtml: path.join(appRoot, ".vite/renderer/find_in_page/find-in-page.html"),
    aboutWindowHtml: path.join(appRoot, ".vite/renderer/about_window/about.html"),
    quickWindowHtml: path.join(appRoot, ".vite/renderer/quick_window/quick-window.html"),
    buddyWindowHtml: path.join(appRoot, ".vite/renderer/buddy_window/buddy.html"),
  };
}
