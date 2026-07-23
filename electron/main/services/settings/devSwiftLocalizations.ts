/**
 * Official Claude Desktop packs Localizable.strings under Contents/Resources/*.lproj
 * for Swift Quick Entry overlay residual:
 *   - "Quickly share content with Claude" / 与 Claude 快速分享内容
 *   - "Drag to take a screenshot" / "Send a screenshot of "
 *   - "Turn on screenshots" permission bar
 *   - "Send to new chat" / recent conversations headings
 *
 * Dev Electron.app Resources only has empty chrome lproj dirs — no Localizable.
 * Copy official residual strings from project resources/swift-lproj into
 * process.resourcesPath/{locale}.lproj/Localizable.strings.
 *
 * Never invents copy; only copies files that already exist in the project.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type EnsureSwiftLocalizationsResult = {
  linked: string[];
  skipped: string[];
};

function projectSwiftLprojRoot(appPath: string): string {
  return path.join(appPath, "resources", "swift-lproj");
}

/**
 * Additional locale folder aliases so macOS preferred languages still resolve.
 * Official ships zh_CN.lproj; some systems prefer zh-Hans.
 */
const LOCALE_ALIASES: Record<string, string[]> = {
  "zh_CN.lproj": ["zh-Hans.lproj", "zh_Hans.lproj", "zh-CN.lproj"],
  "en.lproj": ["Base.lproj", "en-US.lproj"],
};

export function ensureDevSwiftLocalizations(
  projectLprojRoot?: string,
  resourcesPath: string = process.resourcesPath,
): EnsureSwiftLocalizationsResult {
  const linked: string[] = [];
  const skipped: string[] = [];
  if (app.isPackaged) {
    return { linked, skipped };
  }

  const srcRoot =
    projectLprojRoot ?? projectSwiftLprojRoot(app.getAppPath());
  if (!fs.existsSync(srcRoot)) {
    return { linked, skipped };
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(srcRoot).filter((name) => name.endsWith(".lproj"));
  } catch (error) {
    console.warn("[devSwiftLocalizations] readdir failed", error);
    return { linked, skipped };
  }

  for (const lproj of entries) {
    const srcFile = path.join(srcRoot, lproj, "Localizable.strings");
    if (!fs.existsSync(srcFile)) {
      skipped.push(lproj);
      continue;
    }
    const targets = [lproj, ...(LOCALE_ALIASES[lproj] ?? [])];
    for (const target of targets) {
      try {
        const dstDir = path.join(resourcesPath, target);
        fs.mkdirSync(dstDir, { recursive: true });
        const dstFile = path.join(dstDir, "Localizable.strings");
        // Always refresh from residual source so updates take effect.
        fs.copyFileSync(srcFile, dstFile);
        linked.push(target);
      } catch (error) {
        console.warn("[devSwiftLocalizations] copy failed", target, error);
        skipped.push(target);
      }
    }
  }

  if (linked.length > 0) {
    console.info(
      `[devSwiftLocalizations] Localizable.strings → ${linked.length} lproj under ${resourcesPath}`,
    );
  }
  return { linked, skipped };
}
