/**
 * Official macOS app icon residual:
 *   Info.plist CFBundleIconFile = "electron.icns"
 *   Info.plist CFBundleIconName = "Claude"
 *   Contents/Resources/electron.icns  (+ Assets.car catalog)
 *
 * Packaged forge packs `resources/electron.icns` via packagerConfig.icon
 * (LaunchServices / Finder use the icns). Dev `electron .` uses Electron.app
 * → default Atom Dock icon unless we call app.dock.setIcon.
 *
 * Electron nativeImage (Chromium) cannot decode this residual icns family
 * (ic07-only 1024; createFromPath / createFromBuffer → empty). PNG extracted
 * from the same residual icns (resources/electron-app-icon.png) is the Dock
 * setIcon path — same bitmap, not an invented brand mark.
 *
 * Identity (bundle id / display name) stays product-local so Dock/TCC do not
 * merge with com.anthropic.claudefordesktop — only the *bitmap* matches official.
 */
import { app, nativeImage, type NativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";

const OFFICIAL_APP_ICON_BASENAME = "electron.icns";
/** Residual-extracted PNG (iconutil from electron.icns) for Electron dock.setIcon. */
const OFFICIAL_APP_ICON_PNG = "electron-app-icon.png";

function candidateRoots(resourcesRoot: string): string[] {
  const roots = [resourcesRoot];
  if (process.resourcesPath) roots.push(process.resourcesPath);
  return [...new Set(roots.filter(Boolean))];
}

export function resolveOfficialAppIconPath(resourcesRoot: string): string | null {
  for (const root of candidateRoots(resourcesRoot)) {
    const candidate = path.join(root, OFFICIAL_APP_ICON_BASENAME);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveOfficialAppIconPngPath(resourcesRoot: string): string | null {
  for (const root of candidateRoots(resourcesRoot)) {
    const candidate = path.join(root, OFFICIAL_APP_ICON_PNG);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadNativeImage(filePath: string): NativeImage | null {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (!image.isEmpty()) return image;
  } catch {
    /* try buffer */
  }
  try {
    const buf = fs.readFileSync(filePath);
    const image = nativeImage.createFromBuffer(buf);
    if (!image.isEmpty()) return image;
  } catch {
    /* empty */
  }
  return null;
}

/**
 * Apply residual app icon to Dock (darwin) after app.whenReady().
 * Prefer residual PNG for Electron nativeImage; fall back to icns when Chromium can read it.
 * No-op when both missing/empty — never invent a placeholder icon.
 */
export function applyOfficialAppIcon(resourcesRoot: string): boolean {
  const pngPath = resolveOfficialAppIconPngPath(resourcesRoot);
  const icnsPath = resolveOfficialAppIconPath(resourcesRoot);

  let image: NativeImage | null = null;
  let usedPath: string | null = null;

  // PNG first: residual-extracted; Electron decodes reliably.
  if (pngPath) {
    image = loadNativeImage(pngPath);
    if (image) usedPath = pngPath;
  }

  // icns second: LaunchServices reads it for the .app; Electron often returns empty.
  if (!image && icnsPath) {
    image = loadNativeImage(icnsPath);
    if (image) usedPath = icnsPath;
  }

  if (!image) {
    if (!icnsPath && !pngPath) {
      console.warn("[appIcon] residual electron.icns / electron-app-icon.png missing under", resourcesRoot);
    } else {
      console.warn(
        "[appIcon] residual icon unreadable by nativeImage",
        { icnsPath, pngPath },
      );
    }
    return false;
  }

  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(image);
    } catch (error) {
      console.warn("[appIcon] dock.setIcon failed", error, usedPath);
      return false;
    }
  }
  return true;
}
