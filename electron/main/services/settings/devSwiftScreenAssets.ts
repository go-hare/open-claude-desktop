/**
 * Official Claude Desktop packs Quick Entry share residual assets under
 * Contents/Resources:
 *   - claude-screen.png / claude-screen-dark.png (QuickScreenshotView strip icons)
 *   - Assets.car (CFBundleIconName / NSImage catalog residual)
 *
 * Official asar + swift_addon residual:
 *   QuickScreenshotView + desktop.getOpenWindows + Localizable
 *   "Quickly share content with Claude" / 与 Claude 快速分享内容
 *
 * Dev Electron.app Resources has no official share assets — copy from project
 * resources/ (seeded from official residual, product tree only) into
 * process.resourcesPath so Swift NSImage / bundle resource lookup matches.
 *
 * Never invents assets; only copies files that already exist in the project.
 * Never writes into the Downloads official app.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type EnsureSwiftScreenAssetsResult = {
  linked: string[];
  skipped: string[];
};

/** Official Resources residual filenames for share strip / icon catalog. */
export const SWIFT_SCREEN_ASSET_FILES = [
  "claude-screen.png",
  "claude-screen-dark.png",
  "Assets.car",
] as const;

function projectResourcesRoot(appPath: string): string {
  return path.join(appPath, "resources");
}

export function ensureDevSwiftScreenAssets(
  projectResourcesRootArg?: string,
  resourcesPath: string = process.resourcesPath,
): EnsureSwiftScreenAssetsResult {
  const linked: string[] = [];
  const skipped: string[] = [];
  if (app.isPackaged) {
    return { linked, skipped };
  }

  const srcRoot =
    projectResourcesRootArg ?? projectResourcesRoot(app.getAppPath());
  if (!fs.existsSync(srcRoot)) {
    return { linked, skipped };
  }

  for (const name of SWIFT_SCREEN_ASSET_FILES) {
    const srcFile = path.join(srcRoot, name);
    if (!fs.existsSync(srcFile)) {
      skipped.push(name);
      continue;
    }
    try {
      fs.mkdirSync(resourcesPath, { recursive: true });
      const dstFile = path.join(resourcesPath, name);
      // Always refresh from residual source so updates take effect.
      fs.copyFileSync(srcFile, dstFile);
      linked.push(name);
    } catch (error) {
      console.warn("[devSwiftScreenAssets] copy failed", name, error);
      skipped.push(name);
    }
  }

  if (linked.length > 0) {
    console.info(
      `[devSwiftScreenAssets] share residual → ${linked.join(", ")} under ${resourcesPath}`,
    );
  }
  return { linked, skipped };
}
