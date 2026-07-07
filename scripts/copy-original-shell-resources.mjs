import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mirrorRoot = path.resolve(projectRoot, "../electron-shell-source/app-asar");
const buildMirror = path.join(mirrorRoot, ".vite/build");
const rendererMirror = path.join(mirrorRoot, ".vite/renderer");
const buildTarget = path.join(projectRoot, ".vite/build");
const rendererTarget = path.join(projectRoot, ".vite/renderer");

const buildEntriesToCopy = [
  "aboutWindow.js",
  "buddy.js",
  "computerUseTeach.js",
  "quickWindow.js",
  "index.js",
  "index.pre.js",
  "window-shared.css",
  "mcp-runtime",
  "shell-path-worker",
  "transcript-search-worker",
];

// Full alignment mode intentionally uses the original compiled preload bundles.
// The TypeScript preloads remain in the project as the in-progress "turned source" layer.
const originalPreloadMode = process.env.CLAUDE_SHELL_PRELOAD_MODE !== "source";
if (originalPreloadMode) {
  buildEntriesToCopy.push("mainWindow.js", "mainView.js", "findInPage.js", "coworkArtifact.js");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyEntry(sourceRoot, targetRoot, relativePath) {
  const source = path.join(sourceRoot, relativePath);
  const target = path.join(targetRoot, relativePath);
  if (!(await exists(source))) throw new Error(`Missing original shell resource: ${source}`);
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true });
  console.log(`${path.relative(projectRoot, source)} -> ${path.relative(projectRoot, target)}`);
}

await fs.mkdir(buildTarget, { recursive: true });
await fs.mkdir(rendererTarget, { recursive: true });

for (const entry of buildEntriesToCopy) {
  await copyEntry(buildMirror, buildTarget, entry);
}

// Keep packaged .vite/build entry list aligned with the original app.asar.
for (const mapFile of ["index.js.map", "index.pre.js.map", "mainWindow.js.map", "mainView.js.map", "findInPage.js.map"]) {
  await fs.rm(path.join(buildTarget, mapFile), { force: true });
}

// The renderer windows are part of the Electron shell, not the web app payload.
// Copy all five original windows: main, find-in-page, about, buddy, quick.
await fs.rm(rendererTarget, { recursive: true, force: true });
await fs.cp(rendererMirror, rendererTarget, { recursive: true });
console.log(`${path.relative(projectRoot, rendererMirror)} -> ${path.relative(projectRoot, rendererTarget)}`);
