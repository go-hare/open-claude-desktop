/**
 * Windows packaged align (product web + CLI inject + asar runtime inject).
 *
 * Unlike macOS, there is no residual .app MacOS/Frameworks overlay on win32.
 * electron-forge already emits:
 *   out/Claudex-win32-<arch>/Claudex.exe
 *   resources/app.asar
 *   resources/* extraResource (ion-dist residual, product-web, claude-code-bin, …)
 *
 * Official shell hardcodes app:// static root as resources/ion-dist
 * (Hot()+"ion-dist"). Product open-claude-web must land there — same as mac align.
 *
 * Critical: forge asar allowlist no longer packs node_modules. Product runtime
 * (node-pty / @ant/*) must be injected into app.asar here. We also keep
 * resources/original-runtime-node_modules for originalRuntimeModules candidates.
 */
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectPackagedAsarRuntime } from "./inject-packaged-asar-runtime.mjs";
import { readIonBuildId, resolvePackagedTargets } from "./packagePaths.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = resolvePackagedTargets({ root: projectRoot, platform: "win32" });
const packagedRoot = targets.packagedRoot;
const packagedExe = targets.binary;
const packagedResources = targets.resourcesRoot;
const productWebSource = path.join(projectRoot, "resources/product-web");
const claudeCodeBinSource = path.join(projectRoot, "resources/claude-code-bin");
const originalRuntimeSource = path.join(projectRoot, "resources/original-runtime-node_modules");

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

const ionDistTarget = path.join(packagedResources, "ion-dist");
await copyTree(productWebSource, ionDistTarget);

// Drop forge leftover product-web tree — ion-dist is the load root.
const leftoverProductWeb = path.join(packagedResources, "product-web");
if (existsSync(leftoverProductWeb)) {
  await fsPromises.rm(leftoverProductWeb, { recursive: true, force: true });
}

let claudeCodeBinInjected = false;
if (existsSync(claudeCodeBinSource)) {
  const claudeCodeBinTarget = path.join(packagedResources, "claude-code-bin");
  await copyTree(claudeCodeBinSource, claudeCodeBinTarget);
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

const buildId = readIonBuildId(path.join(ionDistTarget, "index.html")) ?? "unknown";
if (buildId === "spa-dev") {
  throw new Error(
    "packaged ion-dist still residual spa-dev after inject — product-web build wrong",
  );
}

const claudeExe = targets.claudeCodeBinary;
const claudeExeExists = existsSync(claudeExe);
if (!claudeExeExists) {
  throw new Error(
    `claude.exe missing after align: ${claudeExe}. Run npm run copy:claude-code-binary on Windows, then re-package.`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      platform: "win32",
      packagedRoot: path.relative(projectRoot, packagedRoot),
      executable: "Claudex.exe",
      productWebInjected: true,
      ionDistBuildId: buildId,
      claudeCodeBinInjected,
      claudeExeExists,
      asarRuntimeInjected: asarInject.ok,
      load: "app://localhost → resources/ion-dist",
    },
    null,
    2,
  ),
);
