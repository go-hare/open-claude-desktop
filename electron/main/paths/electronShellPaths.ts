import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type ElectronShellPaths = {
  appRoot: string;
  resourcesRoot: string;
  ionDistRoot: string;
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
  if (fs.existsSync(path.join(projectResourcesRoot, "ion-dist"))) return projectResourcesRoot;

  return resourcesRoot;
}

export function resolveElectronShellPaths(appRoot = app.getAppPath(), resourcesRoot = process.resourcesPath): ElectronShellPaths {
  const normalizedResourcesRoot = resolveResourcesRoot(appRoot, resourcesRoot);
  return {
    appRoot,
    resourcesRoot: normalizedResourcesRoot,
    ionDistRoot: path.join(normalizedResourcesRoot, "ion-dist"),
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
