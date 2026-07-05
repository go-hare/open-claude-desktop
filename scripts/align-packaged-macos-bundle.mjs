import asar from "@electron/asar";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const originalApp = path.resolve(projectRoot, "../../Claude-Deepseek.app");
const packagedApp = path.join(projectRoot, "out/Claude-Deepseek-darwin-arm64/Claude-Deepseek.app");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyPath(source, target) {
  if (!(await exists(source))) throw new Error(`missing original bundle path: ${source}`);
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  // macOS .app/.framework bundles rely on relative symlinks. Node fs.cp turns
  // those into absolute symlinks unless verbatimSymlinks is used; ditto keeps
  // the original bundle layout and xattrs intact.
  execFileSync("/usr/bin/ditto", [source, target], { stdio: "pipe" });
}

function asarHeaderSha256(asarPath) {
  const { headerString } = asar.getRawHeader(asarPath);
  return crypto.createHash("sha256").update(headerString).digest("hex");
}

function plistBuddy(infoPlist, command) {
  execFileSync("/usr/libexec/PlistBuddy", ["-c", command, infoPlist], { stdio: "pipe" });
}

if (!(await exists(originalApp))) throw new Error(`original app not found: ${originalApp}`);
if (!(await exists(packagedApp))) throw new Error(`packaged app not found: ${packagedApp}`);

const packagedResources = path.join(packagedApp, "Contents/Resources");
const tempRoot = await fs.mkdtemp(path.join(projectRoot, ".bundle-align-"));
const generatedAsar = path.join(tempRoot, "app.asar");
const stagedAsarRoot = path.join(tempRoot, "asar-root");

async function getRuntimeNodeModulesSource() {
  const candidates = [
    path.join(projectRoot, "resources/original-runtime-node_modules/node_modules"),
    path.join(packagedResources, "original-runtime-node_modules/node_modules"),
  ];
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "node-pty/package.json"))) return candidate;
  }
  throw new Error("missing original runtime node_modules source");
}

async function rebuildAppAsarWithOriginalRuntime(appAsar) {
  const runtimeNodeModules = await getRuntimeNodeModulesSource();
  await fs.rm(stagedAsarRoot, { recursive: true, force: true });
  await fs.mkdir(stagedAsarRoot, { recursive: true });
  asar.extractAll(generatedAsar, stagedAsarRoot);

  const targetNodeModules = path.join(stagedAsarRoot, "node_modules");
  await fs.rm(targetNodeModules, { recursive: true, force: true });
  execFileSync("/usr/bin/ditto", [runtimeNodeModules, targetNodeModules], { stdio: "pipe" });
  await fs.chmod(path.join(targetNodeModules, "node-pty/build/Release/spawn-helper"), 0o755);

  await fs.rm(appAsar, { force: true });
  await fs.rm(`${appAsar}.unpacked`, { recursive: true, force: true });
  await asar.createPackageWithOptions(stagedAsarRoot, appAsar, {
    // @electron/asar matches this glob against absolute filenames. Keep the
    // pattern slash-free so minimatch's matchBase behavior catches native
    // files regardless of this workspace's localized path.
    unpack: "{*.node,spawn-helper}",
  });
}

try {
  await fs.copyFile(path.join(packagedResources, "app.asar"), generatedAsar);

  await copyPath(path.join(originalApp, "Contents/MacOS"), path.join(packagedApp, "Contents/MacOS"));
  await copyPath(path.join(originalApp, "Contents/Frameworks"), path.join(packagedApp, "Contents/Frameworks"));
  await copyPath(path.join(originalApp, "Contents/Helpers"), path.join(packagedApp, "Contents/Helpers"));
  await copyPath(path.join(originalApp, "Contents/Resources"), packagedResources);
  await fs.copyFile(path.join(originalApp, "Contents/Info.plist"), path.join(packagedApp, "Contents/Info.plist"));
  await fs.copyFile(path.join(originalApp, "Contents/PkgInfo"), path.join(packagedApp, "Contents/PkgInfo"));
  if (await exists(path.join(originalApp, "Contents/embedded.provisionprofile"))) {
    await fs.copyFile(path.join(originalApp, "Contents/embedded.provisionprofile"), path.join(packagedApp, "Contents/embedded.provisionprofile"));
  }

  // The original signature no longer applies after replacing app.asar.
  await fs.rm(path.join(packagedApp, "Contents/_CodeSignature"), { recursive: true, force: true });
  await fs.rm(path.join(packagedApp, "Contents/CodeResources"), { force: true });

  const infoPlist = path.join(packagedApp, "Contents/Info.plist");
  const appAsar = path.join(packagedResources, "app.asar");
  await rebuildAppAsarWithOriginalRuntime(appAsar);
  await fs.rm(path.join(packagedResources, "original-runtime-node_modules"), { recursive: true, force: true });
  const headerHash = asarHeaderSha256(appAsar);
  plistBuddy(infoPlist, `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${headerHash}`);

  await fs.chmod(path.join(packagedApp, "Contents/MacOS/Claude"), 0o755);
  console.log(JSON.stringify({
    ok: true,
    packagedApp: path.relative(projectRoot, packagedApp),
    executable: "Contents/MacOS/Claude",
    asarHeaderHash: headerHash,
  }, null, 2));
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
