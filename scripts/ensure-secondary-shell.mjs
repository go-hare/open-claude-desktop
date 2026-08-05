/**
 * Place residual secondary shell assets into .vite from project resources.
 *
 * Product TypeScript owns (built by build:preload / build:workers — never overwritten here):
 *   aboutWindow.js / quickWindow.js / buddy.js / computerUseTeach.js
 *   shell-path-worker / transcript-search-worker
 *   mcp-runtime/nodeHost.js / mcp-runtime/directMcpHost.js
 *   index.js / index.pre.js / chunks / mainWindow.js / mainView.js /
 *   findInPage.js / coworkArtifact.js
 *   window-shared.css (product source: electron/renderer-shell/window-shared.css)
 *
 * Still residual (vendor merge only):
 *   mcp-runtime layout seed (product hosts kept on merge)
 *
 * Source (required for residual pieces): resources/shell-secondary/.vite
 *   populate once via: npm run sync:shell-secondary
 *
 * Optional legacy: CLAUDE_SHELL_SECONDARY_FROM_MIRROR=1 also tries old mirrors
 * (not default — normal project uses resources/shell-secondary only).
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Residual-only entries still copied from vendor pack (product hosts kept on merge). */
const RESIDUAL_BUILD_ENTRIES = [
  // mcp-runtime may seed layout; product nodeHost/directMcpHost kept when already built
  "mcp-runtime",
];

// Product-owned — never replace from residual secondary pack.
const PRODUCT_BUILD_ENTRIES = new Set([
  "index.js",
  "index.pre.js",
  "chunks",
  "mainWindow.js",
  "mainView.js",
  "findInPage.js",
  "coworkArtifact.js",
  "aboutWindow.js",
  "quickWindow.js",
  "buddy.js",
  "computerUseTeach.js",
  "shell-path-worker",
  "transcript-search-worker",
  "window-shared.css",
]);

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function resolveSecondaryRoot() {
  const projectSecondary = path.join(projectRoot, "resources/shell-secondary");
  if (fsSync.existsSync(path.join(projectSecondary, ".vite/build"))) {
    return projectSecondary;
  }

  if (process.env.CLAUDE_SHELL_SECONDARY_FROM_MIRROR === "1") {
    const workspaceRoot = path.resolve(projectRoot, "..");
    const candidates = [
      process.env.CLAUDE_ELECTRON_SHELL_MIRROR,
      path.join(workspaceRoot, "electron-shell-source/app-asar"),
    ].filter(Boolean);
    for (const c of candidates) {
      if (fsSync.existsSync(path.join(c, ".vite/build"))) return c;
    }
  }
  return null;
}

const secondaryRoot = resolveSecondaryRoot();
if (!secondaryRoot) {
  throw new Error(
    [
      "Secondary shell assets missing under resources/shell-secondary/.vite",
      "One-time import: npm run sync:shell-secondary",
      "(optional source: CLAUDE_ELECTRON_SHELL_MIRROR or resources/original-claude.app)",
      "Default build does not copy from external residual mirrors.",
    ].join("\n"),
  );
}

const srcBuild = path.join(secondaryRoot, ".vite/build");
const srcRenderer = path.join(secondaryRoot, ".vite/renderer");
const destBuild = path.join(projectRoot, ".vite/build");
const destRenderer = path.join(projectRoot, ".vite/renderer");

await fs.mkdir(destBuild, { recursive: true });
await fs.mkdir(destRenderer, { recursive: true });

const placed = [];
for (const entry of RESIDUAL_BUILD_ENTRIES) {
  if (PRODUCT_BUILD_ENTRIES.has(entry)) {
    throw new Error(`refusing to place product entry from secondary pack: ${entry}`);
  }
  const src = path.join(srcBuild, entry);
  if (!(await exists(src))) {
    console.warn(`[ensure-secondary-shell] missing ${entry} in ${srcBuild}`);
    continue;
  }
  const dest = path.join(destBuild, entry);
  if (entry === "mcp-runtime") {
    // Merge residual mcp-runtime but do not wipe product hosts if already built.
    await fs.mkdir(dest, { recursive: true });
    const PRODUCT_MCP_RUNTIME = new Set(["nodeHost.js", "directMcpHost.js"]);
    for (const name of await fs.readdir(src)) {
      // Prefer product workers when present after build:workers; residual may still seed first.
      if (PRODUCT_MCP_RUNTIME.has(name) && (await exists(path.join(dest, name)))) {
        placed.push(`mcp-runtime/${name}(kept-product)`);
        continue;
      }
      const from = path.join(src, name);
      const to = path.join(dest, name);
      await fs.rm(to, { recursive: true, force: true });
      await fs.cp(from, to, { recursive: true });
      placed.push(`mcp-runtime/${name}`);
    }
    continue;
  }
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, { recursive: true });
  placed.push(entry);
}

// Product-owned renderer shells — residual pack must not own these trees.
const PRODUCT_RENDERER_ENTRIES = new Set([
  "main_window",
  "find_in_page",
  "about_window",
  "quick_window",
  "buddy_window",
]);

if (await exists(srcRenderer)) {
  // Residual pack must not overwrite product secondary shells.
  for (const name of await fs.readdir(srcRenderer)) {
    if (PRODUCT_RENDERER_ENTRIES.has(name)) {
      placed.push(`renderer/${name}(skipped-product)`);
      continue;
    }
    const src = path.join(srcRenderer, name);
    const dest = path.join(destRenderer, name);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(src, dest, { recursive: true });
    placed.push(`renderer/${name}`);
  }
}

// Product renderer shells from our source (if present).
const productRendererCopies = [
  ["electron/renderer-shell/main-window.html", ".vite/renderer/main_window/index.html"],
  ["electron/renderer-shell/find-in-page.html", ".vite/renderer/find_in_page/find-in-page.html"],
  ["electron/renderer-shell/about-window.html", ".vite/renderer/about_window/about.html"],
  ["electron/renderer-shell/about-window.js", ".vite/renderer/about_window/about-window.js"],
  ["electron/renderer-shell/quick-window.html", ".vite/renderer/quick_window/quick-window.html"],
  ["electron/renderer-shell/quick-window.js", ".vite/renderer/quick_window/quick-window.js"],
  ["electron/renderer-shell/buddy-window.html", ".vite/renderer/buddy_window/buddy.html"],
  ["electron/renderer-shell/buddy-window.js", ".vite/renderer/buddy_window/buddy-window.js"],
];
// Wipe leftover residual subtrees (e.g. assets/*.js) under product shells.
for (const name of PRODUCT_RENDERER_ENTRIES) {
  const destDir = path.join(destRenderer, name);
  if (!(await exists(destDir))) continue;
  for (const entry of await fs.readdir(destDir)) {
    // keep only product-copied files; drop residual assets/window-shared packs
    if (entry === "assets" || entry === "window-shared.css") {
      await fs.rm(path.join(destDir, entry), { recursive: true, force: true });
      placed.push(`renderer/${name}/${entry}(removed-residual)`);
    }
  }
}

for (const [relSrc, relDest] of productRendererCopies) {
  const src = path.join(projectRoot, relSrc);
  if (!(await exists(src))) continue;
  const dest = path.join(projectRoot, relDest);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  placed.push(relDest);
}

// Product-owned window-shared.css — residual seed only if product source missing.
{
  const productCss = path.join(projectRoot, "electron/renderer-shell/window-shared.css");
  const destCss = path.join(destBuild, "window-shared.css");
  if (await exists(productCss)) {
    await fs.copyFile(productCss, destCss);
    placed.push("window-shared.css(product)");
  } else {
    const residualCss = path.join(srcBuild, "window-shared.css");
    if (await exists(residualCss)) {
      await fs.copyFile(residualCss, destCss);
      placed.push("window-shared.css(residual-fallback)");
      console.warn(
        "[ensure-secondary-shell] product electron/renderer-shell/window-shared.css missing — residual fallback",
      );
    } else {
      console.warn("[ensure-secondary-shell] window-shared.css missing (product + residual)");
    }
  }
}

// Sanity: product main must still be present (built before this step).
for (const required of ["index.js", "index.pre.js", "aboutWindow.js", "quickWindow.js", "buddy.js"]) {
  if (!(await exists(path.join(destBuild, required)))) {
    throw new Error(
      `product entry missing after ensure-secondary-shell: .vite/build/${required} — run build:main / build:preload first`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      secondaryRoot: path.relative(projectRoot, secondaryRoot),
      placed,
      preservedProduct: [...PRODUCT_BUILD_ENTRIES],
      residualOnly: RESIDUAL_BUILD_ENTRIES,
    },
    null,
    2,
  ),
);
