import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Product renderer shells written in-repo.
 * About / Quick / Buddy are residual-structure product UI (no residual React/Lit bundle).
 */
const copies = [
  ["electron/renderer-shell/main-window.html", ".vite/renderer/main_window/index.html"],
  ["electron/renderer-shell/find-in-page.html", ".vite/renderer/find_in_page/find-in-page.html"],
  ["electron/renderer-shell/about-window.html", ".vite/renderer/about_window/about.html"],
  ["electron/renderer-shell/about-window.js", ".vite/renderer/about_window/about-window.js"],
  ["electron/renderer-shell/quick-window.html", ".vite/renderer/quick_window/quick-window.html"],
  ["electron/renderer-shell/quick-window.js", ".vite/renderer/quick_window/quick-window.js"],
  ["electron/renderer-shell/buddy-window.html", ".vite/renderer/buddy_window/buddy.html"],
  ["electron/renderer-shell/buddy-window.js", ".vite/renderer/buddy_window/buddy-window.js"],
  // Residual product ownership: shared chrome CSS for secondary shells / workers.
  ["electron/renderer-shell/window-shared.css", ".vite/build/window-shared.css"],
];

for (const [source, target] of copies) {
  const sourcePath = path.join(root, source);
  const targetPath = path.join(root, target);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  console.log(`${source} -> ${target}`);
}
