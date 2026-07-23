/**
 * Official Swift FontLoader residual expects:
 *   process.resourcesPath/fonts/Anthropic*.ttf
 * Packaged app: Contents/Resources/fonts (Hot residual / extraResource).
 * Dev: Electron framework Resources has no fonts — symlink project resources/fonts.
 *
 * Never invents fonts content; only links if project fonts already exist.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export function ensureDevSwiftFonts(
  projectFontsDir?: string,
  resourcesPath: string = process.resourcesPath,
): string | null {
  if (app.isPackaged) return null;
  const src =
    projectFontsDir ??
    path.join(app.getAppPath(), "resources", "fonts");
  if (!fs.existsSync(src)) return null;
  const hasTtf = fs.readdirSync(src).some((name) => name.endsWith(".ttf"));
  if (!hasTtf) return null;

  const dst = path.join(resourcesPath, "fonts");
  try {
    if (fs.existsSync(dst)) {
      const st = fs.lstatSync(dst);
      if (st.isSymbolicLink()) {
        try {
          if (fs.realpathSync(dst) === fs.realpathSync(src)) return dst;
        } catch {
          /* relink */
        }
        fs.unlinkSync(dst);
      } else if (st.isDirectory()) {
        // Real directory already present (user/manual copy) — leave alone.
        return dst;
      }
    }
    fs.symlinkSync(src, dst);
    return dst;
  } catch (error) {
    console.warn("[devSwiftFonts] ensure failed", error);
    return null;
  }
}
