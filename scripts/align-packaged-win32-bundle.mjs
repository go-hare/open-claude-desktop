/**
 * Windows packaged align (product web + CLI inject + asar runtime inject).
 *
 * Unlike macOS, there is no residual .app MacOS/Frameworks overlay on win32.
 * electron-forge already emits:
 *   out/Claudex-win32-<arch>/Claudex.exe
 *   resources/app.asar
 *   resources/* extraResource (ion-dist residual, product-web, claude-code-bin, …)
 *
 * Dual-root residual (must match electronShellPaths + staticIonDist):
 *   primary SPA  → resources/product-web  (open-claude-web)
 *   residual SPA → resources/ion-dist     (official spa-dev for setup-desktop-3p)
 * Do NOT overwrite ion-dist with product-web and do NOT delete product-web.
 *
 * Critical: forge asar allowlist no longer packs node_modules. Product runtime
 * (node-pty / @ant/*) must be injected into app.asar here. We also keep
 * resources/original-runtime-node_modules for originalRuntimeModules candidates.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectPackagedAsarRuntime } from "./inject-packaged-asar-runtime.mjs";
import {
  pruneClaudeCodeBinToHost,
  readIonBuildId,
  resolvePackagedTargets,
} from "./packagePaths.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = resolvePackagedTargets({ root: projectRoot, platform: "win32" });
const packagedRoot = targets.packagedRoot;
const packagedExe = targets.binary;
const packagedResources = targets.resourcesRoot;
const productWebSource = path.join(projectRoot, "resources/product-web");
const residualIonSource = path.join(projectRoot, "resources/ion-dist");
const claudeCodeBinSource = path.join(projectRoot, "resources/claude-code-bin");
const originalRuntimeSource = path.join(projectRoot, "resources/original-runtime-node_modules");
const appIconIco = path.join(projectRoot, "resources/electron.ico");

/**
 * Re-stamp Claudex.exe PE icon after forge.
 *
 * electron-packager/rcedit may leave Explorer showing the stock Electron atom when
 * the ICO is PNG-only or the shell icon cache is sticky. We re-apply
 * resources/electron.ico (BMP small sizes + PNG 256) via rcedit so Explorer /
 * taskbar resolve the residual Claude mark, not Atom.
 */
function stampWin32ExeIcon(exePath) {
  if (!fs.existsSync(appIconIco)) {
    return { ok: false, reason: "resources/electron.ico missing" };
  }
  const rceditCandidates = [
    path.join(projectRoot, "node_modules/electron-winstaller/vendor/rcedit.exe"),
    path.join(projectRoot, "node_modules/rcedit/bin/rcedit.exe"),
    path.join(projectRoot, "node_modules/rcedit/bin/rcedit-x64.exe"),
  ];
  const rcedit = rceditCandidates.find((p) => fs.existsSync(p));
  if (!rcedit) {
    return { ok: false, reason: "rcedit.exe not found (electron-winstaller vendor)" };
  }
  const result = spawnSync(
    rcedit,
    [
      exePath,
      "--set-icon",
      appIconIco,
      "--set-version-string",
      "FileDescription",
      "Claudex",
      "--set-version-string",
      "ProductName",
      "Claudex",
      "--set-version-string",
      "InternalName",
      "Claudex",
      "--set-version-string",
      "OriginalFilename",
      "Claudex.exe",
      "--set-version-string",
      "CompanyName",
      "local reconstruction",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return {
      ok: false,
      reason: `rcedit failed status=${result.status}`,
      stderr: (result.stderr || result.stdout || "").slice(0, 400),
    };
  }
  return { ok: true, rcedit: path.relative(projectRoot, rcedit), icon: "resources/electron.ico" };
}

function existsSync(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(source, target) {
  await fsPromises.rm(target, { recursive: true, force: true });
  await fsPromises.mkdir(path.dirname(target), { recursive: true });
  await fsPromises.cp(source, target, { recursive: true, force: true });
}

if (!existsSync(packagedRoot)) {
  if (process.platform !== "win32") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: "Windows package root missing — run electron-forge package on win32 first",
          packagedRoot: path.relative(projectRoot, packagedRoot),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  throw new Error(`packaged root missing (run forge package first): ${packagedRoot}`);
}

if (!existsSync(packagedExe)) {
  throw new Error(`packaged exe missing: ${packagedExe}`);
}
if (!existsSync(packagedResources)) {
  throw new Error(`packaged resources missing: ${packagedResources}`);
}
if (!existsSync(path.join(productWebSource, "index.html"))) {
  throw new Error(
    `product-web missing: build with npm run build:product-web first (${productWebSource}/index.html)`,
  );
}
if (!existsSync(path.join(residualIonSource, "index.html"))) {
  throw new Error(
    `residual ion-dist missing: run npm run sync:residual / keep resources/ion-dist for setup-desktop-3p (${residualIonSource}/index.html)`,
  );
}

// Keep both trees: product primary + residual ion-dist (never collapse).
const productWebTarget = path.join(packagedResources, "product-web");
const ionDistTarget = path.join(packagedResources, "ion-dist");
await copyTree(productWebSource, productWebTarget);
await copyTree(residualIonSource, ionDistTarget);

let claudeCodeBinInjected = false;
let claudeCodeBinPrune = null;
if (existsSync(claudeCodeBinSource)) {
  // Host-only: win package ships only platforms/win32-<arch> (+ top-level claude.exe).
  pruneClaudeCodeBinToHost(claudeCodeBinSource, { platform: "win32" });
  const claudeCodeBinTarget = path.join(packagedResources, "claude-code-bin");
  await copyTree(claudeCodeBinSource, claudeCodeBinTarget);
  claudeCodeBinPrune = pruneClaudeCodeBinToHost(claudeCodeBinTarget, { platform: "win32" });
  claudeCodeBinInjected = true;
}

// Ensure extraResource runtime tree is present (may already be from forge).
if (existsSync(originalRuntimeSource)) {
  const runtimeTarget = path.join(packagedResources, "original-runtime-node_modules");
  if (!existsSync(path.join(runtimeTarget, "node_modules/node-pty/package.json"))) {
    await copyTree(originalRuntimeSource, runtimeTarget);
  }
}

const asarInject = await injectPackagedAsarRuntime({
  appAsar: targets.appAsar,
  projectRoot,
  packagedResources,
  // Keep resources/original-runtime-node_modules for originalRuntimeModules path
  // candidates (swift / node-pty loaders).
  keepExtraResourceRuntime: true,
});

const productBuildId = readIonBuildId(path.join(productWebTarget, "index.html")) ?? "unknown";
const residualBuildId = readIonBuildId(path.join(ionDistTarget, "index.html")) ?? "unknown";
if (productBuildId === "spa-dev" || productBuildId === "unknown") {
  throw new Error(
    `packaged product-web is not product SPA (data-build-id=${productBuildId}) — re-run build:product-web`,
  );
}
if (residualBuildId === productBuildId) {
  throw new Error(
    `packaged residual ion-dist collides with product build id (${productBuildId}); keep official spa residual in resources/ion-dist`,
  );
}

const claudeExe = targets.claudeCodeBinary;
const claudeExeExists = existsSync(claudeExe);
if (!claudeExeExists) {
  throw new Error(
    `claude.exe missing after align: ${claudeExe}. Run npm run copy:claude-code-binary on Windows, then re-package.`,
  );
}

// PE icon must be residual Claude mark (not stock Electron atom). Re-stamp after
// forge so Explorer/taskbar pick up BMP+PNG ICO even when shell cache is sticky.
const exeIconStamp = stampWin32ExeIcon(packagedExe);
if (!exeIconStamp.ok) {
  console.warn("[align:win32] exe icon stamp skipped:", exeIconStamp.reason);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      platform: "win32",
      packagedRoot: path.relative(projectRoot, packagedRoot),
      executable: "Claudex.exe",
      productWebInjected: true,
      productBuildId,
      residualIonBuildId: residualBuildId,
      dualRoot: "product-web primary + ion-dist residual",
      claudeCodeBinInjected,
      claudeCodeBinPrune,
      claudeExeExists,
      asarRuntimeInjected: asarInject.ok,
      exeIconStamp,
      load: "app://localhost → resources/product-web (setup residual → ion-dist)",
    },
    null,
    2,
  ),
);
