import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const copies = [
  ["electron/renderer-shell/main-window.html", ".vite/renderer/main_window/index.html"],
  ["electron/renderer-shell/find-in-page.html", ".vite/renderer/find_in_page/find-in-page.html"],
];

for (const [source, target] of copies) {
  const sourcePath = path.join(root, source);
  const targetPath = path.join(root, target);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  console.log(`${source} -> ${target}`);
}
