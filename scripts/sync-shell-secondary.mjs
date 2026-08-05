/**
 * One-time import of secondary Electron shell assets into OUR project tree.
 *
 * These are residual compiled secondary windows / workers / renderer shells that
 * we have not fully turned into TypeScript yet. They live under:
 *   resources/shell-secondary/.vite/{build,renderer}
 *
 * Package/build then only read this project path — never Downloads / external
 * mirrors at build time (unless you re-run this sync).
 *
 * Sources (first hit):
 *   1) CLAUDE_ELECTRON_SHELL_MIRROR
 *   2) resources/original-claude.app/Contents/Resources/app.asar (extract)
 *   3) sibling electron-shell-source/app-asar
 *
 * Usage:
 *   npm run sync:shell-secondary
 *   npm run sync:shell-secondary -- /path/to/app-asar-or-mirror-root
 */
import asar from "@electron/asar";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProjectRoot, resolveOriginalApp } from "./originalAppPaths.mjs";

const projectRoot = getProjectRoot();
const destRoot = path.join(projectRoot, "resources/shell-secondary");

/**
 * Residual vendor pack contents (one-time import).
 * Product TypeScript now owns about/quick/buddy/computerUseTeach preloads and
 * shell-path / transcript-search / nodeHost workers — those are still mirrored
 * here only as emergency residual seed; ensure-secondary-shell will NOT place
 * product-owned entries over built TS outputs.
 */
const SECONDARY_BUILD_ENTRIES = [
  "aboutWindow.js",
  "buddy.js",
  "computerUseTeach.js",
  "quickWindow.js",
  "window-shared.css",
  "mcp-runtime",
  "shell-path-worker",
  "transcript-search-worker",
];

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(src, dest) {
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, { recursive: true, force: true });
}

function mirrorCandidates() {
  const workspaceRoot = path.resolve(projectRoot, "..");
  return [
    process.argv[2] ? path.resolve(process.argv[2]) : undefined,
    process.env.CLAUDE_ELECTRON_SHELL_MIRROR,
    path.join(workspaceRoot, "electron-shell-source/app-asar"),
    path.join(workspaceRoot, "claude-ion-react-workbench/electron-shell-source/app-asar"),
  ].filter(Boolean);
}

async function resolveViteSource() {
  for (const candidate of mirrorCandidates()) {
    const build = path.join(candidate, ".vite/build");
    if (fsSync.existsSync(build)) {
      return { kind: "dir", root: candidate };
    }
    // raw asar path
    if (candidate.endsWith(".asar") && fsSync.existsSync(candidate)) {
      return { kind: "asar", root: candidate };
    }
  }

  // Project residual app.asar
  try {
    const app = resolveOriginalApp();
    const asarPath = path.join(app, "Contents/Resources/app.asar");
    if (fsSync.existsSync(asarPath)) {
      return { kind: "asar", root: asarPath };
    }
  } catch {
    // optional
  }

  return null;
}

async function materializeAsarToTemp(asarPath) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "claudex-shell-secondary-"));
  asar.extractAll(asarPath, temp);
  return temp;
}

const source = await resolveViteSource();
if (!source) {
  throw new Error(
    "No secondary shell source found. Pass mirror path or ensure resources/original-claude.app has app.asar.\n" +
      "Tried CLAUDE_ELECTRON_SHELL_MIRROR / electron-shell-source / original-claude.app",
  );
}

let viteRoot;
let tempToClean = null;
if (source.kind === "asar") {
  tempToClean = await materializeAsarToTemp(source.root);
  viteRoot = path.join(tempToClean, ".vite");
} else {
  viteRoot = path.join(source.root, ".vite");
}

if (!(await exists(path.join(viteRoot, "build")))) {
  if (tempToClean) await fs.rm(tempToClean, { recursive: true, force: true });
  throw new Error(`secondary shell .vite/build missing under ${source.root}`);
}

const destBuild = path.join(destRoot, ".vite/build");
const destRenderer = path.join(destRoot, ".vite/renderer");
await fs.mkdir(destBuild, { recursive: true });
await fs.mkdir(destRenderer, { recursive: true });

const copied = [];
for (const entry of SECONDARY_BUILD_ENTRIES) {
  const src = path.join(viteRoot, "build", entry);
  if (!(await exists(src))) {
    console.warn(`[sync-shell-secondary] skip missing: ${entry}`);
    continue;
  }
  const dest = path.join(destBuild, entry);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, { recursive: true });
  copied.push(`build/${entry}`);
}

// Full secondary renderer trees (about / buddy / quick / …)
const rendererSrc = path.join(viteRoot, "renderer");
if (await exists(rendererSrc)) {
  await copyTree(rendererSrc, destRenderer);
  copied.push("renderer/*");
}

if (tempToClean) {
  await fs.rm(tempToClean, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      source: source.root,
      dest: path.relative(projectRoot, destRoot),
      copied,
      note: "Product main/preload are NOT stored here — built from electron/** TypeScript.",
    },
    null,
    2,
  ),
);
