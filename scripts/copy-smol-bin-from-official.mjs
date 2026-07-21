/**
 * Copy official smol-bin.<arch>.img into resources/ for Cowork dual-exec VM.
 * Source: Claude-Deepseek.app/Contents/Resources (or CLAUDE_ORIGINAL_RESOURCES).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  process.env.CLAUDE_ORIGINAL_RESOURCES,
  process.env.CLAUDE_ORIGINAL_APP_CONTENTS
    ? path.join(process.env.CLAUDE_ORIGINAL_APP_CONTENTS, "Resources")
    : null,
  "/Users/apple/Downloads/Claude code 汉化mac桌面版/Claude-Deepseek.app/Contents/Resources",
  path.resolve(projectRoot, "../../Claude-Deepseek.app/Contents/Resources"),
].filter(Boolean);

const originalResources = candidates.find((dir) => fs.existsSync(dir));
if (!originalResources) {
  console.error("No official Resources dir found. Set CLAUDE_ORIGINAL_RESOURCES.");
  process.exit(1);
}

const targetDir = path.join(projectRoot, "resources");
fs.mkdirSync(targetDir, { recursive: true });

for (const name of ["smol-bin.arm64.img", "smol-bin.x64.img"]) {
  const src = path.join(originalResources, name);
  const dest = path.join(targetDir, name);
  if (!fs.existsSync(src)) {
    console.warn(`skip missing ${src}`);
    continue;
  }
  fs.copyFileSync(src, dest);
  console.log(`copied ${name} -> ${dest}`);
}
