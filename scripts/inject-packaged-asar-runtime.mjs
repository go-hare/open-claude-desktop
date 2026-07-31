/**
 * Inject resources/original-runtime-node_modules into packaged app.asar and
 * strip residual workspace root index.js if present.
 *
 * Used by:
 *   align-packaged-macos-bundle.mjs (after residual Resources copy)
 *   align-packaged-win32-bundle.mjs (after forge package — required now that
 *   forge ignore allowlists only package.json + .vite)
 *
 * @param {{
 *   appAsar: string,
 *   projectRoot: string,
 *   packagedResources?: string,
 *   keepExtraResourceRuntime?: boolean,
 * }} opts
 */
import asar from "@electron/asar";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export async function injectPackagedAsarRuntime(opts) {
  const {
    appAsar,
    projectRoot,
    packagedResources = path.dirname(appAsar),
    keepExtraResourceRuntime = false,
  } = opts;

  if (!existsSync(appAsar)) {
    throw new Error(`app.asar missing for runtime inject: ${appAsar}`);
  }

  const runtimeCandidates = [
    path.join(projectRoot, "resources/original-runtime-node_modules/node_modules"),
    path.join(packagedResources, "original-runtime-node_modules/node_modules"),
  ];
  const runtimeNodeModules = runtimeCandidates.find((candidate) =>
    existsSync(path.join(candidate, "node-pty/package.json")),
  );
  if (!runtimeNodeModules) {
    throw new Error(
      "missing original runtime node_modules source (resources/original-runtime-node_modules)",
    );
  }

  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "claudex-asar-inject-"));
  const stagedAsarRoot = path.join(tempRoot, "asar-root");
  try {
    await fsPromises.mkdir(stagedAsarRoot, { recursive: true });
    asar.extractAll(appAsar, stagedAsarRoot);

    // Drop residual official shell dump if forge / workspace still shipped it.
    await fsPromises.rm(path.join(stagedAsarRoot, "index.js"), { force: true });
    await fsPromises.rm(path.join(stagedAsarRoot, "index.js.map"), { force: true });

    const targetNodeModules = path.join(stagedAsarRoot, "node_modules");
    await fsPromises.rm(targetNodeModules, { recursive: true, force: true });
    if (process.platform === "darwin" && existsSync("/usr/bin/ditto")) {
      execFileSync("/usr/bin/ditto", [runtimeNodeModules, targetNodeModules], { stdio: "pipe" });
    } else {
      await copyTree(runtimeNodeModules, targetNodeModules);
    }

    const spawnHelper = path.join(targetNodeModules, "node-pty/build/Release/spawn-helper");
    if (existsSync(spawnHelper) && process.platform !== "win32") {
      await fsPromises.chmod(spawnHelper, 0o755);
    }

    await fsPromises.rm(appAsar, { force: true });
    await fsPromises.rm(`${appAsar}.unpacked`, { recursive: true, force: true });
    await asar.createPackageWithOptions(stagedAsarRoot, appAsar, {
      unpack: "{*.node,spawn-helper}",
    });

    if (!keepExtraResourceRuntime) {
      await fsPromises.rm(path.join(packagedResources, "original-runtime-node_modules"), {
        recursive: true,
        force: true,
      });
    }

    return {
      ok: true,
      runtimeSource: runtimeNodeModules,
      strippedRootIndex: true,
      keepExtraResourceRuntime,
    };
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
}

// CLI: node scripts/inject-packaged-asar-runtime.mjs <app.asar> [projectRoot]
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const appAsar = process.argv[2];
  const cliRoot =
    process.argv[3] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (!appAsar) {
    console.error("usage: inject-packaged-asar-runtime.mjs <app.asar> [projectRoot]");
    process.exit(2);
  }
  const result = await injectPackagedAsarRuntime({ appAsar, projectRoot: cliRoot });
  console.log(JSON.stringify(result, null, 2));
}
