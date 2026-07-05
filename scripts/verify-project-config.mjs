import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const forgeConfig = require(path.join(root, "forge.config.cjs"));

const requiredFiles = [
  "electron/main/index.pre.ts",
  "electron/main/index.ts",
  "vite.main.config.ts",
  "vite.preload.config.ts",
  "electron/renderer-shell/main-window.html",
  "electron/renderer-shell/find-in-page.html",
  "resources/electron.icns",
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length > 0) {
  console.error("Missing project files:", missing);
  process.exit(1);
}

if (pkg.main !== ".vite/build/index.pre.js") {
  throw new Error(`Unexpected package main: ${pkg.main}`);
}
if (pkg.devDependencies.electron !== "41.5.0") {
  throw new Error(`Electron version should mirror source package: ${pkg.devDependencies.electron}`);
}
if (!forgeConfig.packagerConfig?.asar) {
  throw new Error("Forge asar packaging is not enabled");
}

console.log("project config ok");
