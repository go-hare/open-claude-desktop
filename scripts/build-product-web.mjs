/**
 * Build open-claude-web into resources/product-web for packaged app:// serving.
 *
 * Dev / test continues to use CLAUDE_DESKTOP_MAIN_VIEW_URL=http://localhost:5176.
 * Packaged product serves this tree via app://localhost (see electronShellPaths).
 *
 * Does NOT overwrite resources/ion-dist (residual audit still needs official bytes).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRootCandidates = [
  process.env.CLAUDE_PRODUCT_WEB_ROOT,
  path.resolve(projectRoot, "../open-claude-web"),
  path.resolve(projectRoot, "../../open-claude-web"),
].filter(Boolean);

const webRoot = webRootCandidates.find((candidate) => {
  try {
    return fsSync.existsSync(path.join(candidate, "package.json"));
  } catch {
    return false;
  }
});

if (!webRoot) {
  throw new Error(
    `open-claude-web not found. Set CLAUDE_PRODUCT_WEB_ROOT or place it next to open-claude-desktop.\nTried:\n${webRootCandidates.join("\n")}`,
  );
}

const distRoot = path.join(webRoot, "dist");
const targetRoot = path.join(projectRoot, "resources/product-web");
const skipBuild = process.env.CLAUDE_PRODUCT_WEB_SKIP_BUILD === "1";

/**
 * Windows: bare `npx`/`npm` via execFileSync is ENOENT (need .cmd + shell).
 * Prefer local vite bin via process.execPath — no PATH/shell dependency.
 */
function runWebBuild(strict) {
  const env = process.env;
  const isWin = process.platform === "win32";
  if (strict) {
    const npmCmd = isWin ? "npm.cmd" : "npm";
    execFileSync(npmCmd, ["run", "build"], {
      cwd: webRoot,
      stdio: "inherit",
      env,
      shell: isWin,
    });
    return;
  }
  const viteJs = path.join(webRoot, "node_modules", "vite", "bin", "vite.js");
  if (fsSync.existsSync(viteJs)) {
    execFileSync(process.execPath, [viteJs, "build"], {
      cwd: webRoot,
      stdio: "inherit",
      env,
    });
    return;
  }
  const npxCmd = isWin ? "npx.cmd" : "npx";
  execFileSync(npxCmd, ["vite", "build"], {
    cwd: webRoot,
    stdio: "inherit",
    env,
    shell: isWin,
  });
}

if (!skipBuild) {
  console.log(`building product web: ${webRoot}`);
  // Packaging serves static dist over app://. Prefer vite build even when
  // open-claude-web still has residual tsc reds (typecheck is separate).
  // Set CLAUDE_PRODUCT_WEB_STRICT=1 to require full `npm run build` (tsc + vite).
  const strict = process.env.CLAUDE_PRODUCT_WEB_STRICT === "1";
  try {
    runWebBuild(strict);
  } catch (error) {
    // Default: fail closed so package cannot silently ship stale dist.
    // Escape hatch for local iteration only:
    //   CLAUDE_PRODUCT_WEB_ALLOW_STALE_DIST=1
    const allowStale = process.env.CLAUDE_PRODUCT_WEB_ALLOW_STALE_DIST === "1";
    if (allowStale && fsSync.existsSync(path.join(distRoot, "index.html"))) {
      console.warn(
        "[build-product-web] vite/tsc build failed; reusing existing dist (CLAUDE_PRODUCT_WEB_ALLOW_STALE_DIST=1):",
        distRoot,
      );
      console.warn(String(error));
    } else {
      throw error;
    }
  }
}

if (!fsSync.existsSync(path.join(distRoot, "index.html"))) {
  throw new Error(`product web dist missing index.html: ${distRoot}`);
}

await fs.rm(targetRoot, { recursive: true, force: true });
await fs.mkdir(path.dirname(targetRoot), { recursive: true });
await fs.cp(distRoot, targetRoot, { recursive: true, preserveTimestamps: true });

const indexHtml = await fs.readFile(path.join(targetRoot, "index.html"), "utf8");
const buildId = indexHtml.match(/data-build-id="([^"]+)"/)?.[1] ?? "unknown";
console.log(`product-web ready: ${targetRoot} (data-build-id=${buildId})`);
