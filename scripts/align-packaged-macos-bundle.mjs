import asar from "@electron/asar";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const originalAppCandidates = [
  process.env.CLAUDE_ORIGINAL_APP,
  process.env.CLAUDE_ORIGINAL_APP_CONTENTS ? path.dirname(process.env.CLAUDE_ORIGINAL_APP_CONTENTS) : undefined,
  path.resolve(projectRoot, "../Claude-Deepseek.app"),
  path.resolve(projectRoot, "../../Claude-Deepseek.app"),
  "/Users/apple/Downloads/Claude code 汉化mac桌面版/Claude-Deepseek.app",
  "D:\\BaiduNetdiskDownload\\Claude code 汉化mac桌面版\\Claude-Deepseek\\Claude-Deepseek.app",
].filter(Boolean);
const originalApp = originalAppCandidates.find((candidate) => fsSync.existsSync(candidate)) ?? originalAppCandidates[0];
const packagedApp = path.join(projectRoot, "out/Claude-Deepseek-darwin-arm64/Claude-Deepseek.app");

// Product identity — must stay distinct from official Claude Desktop so Dock /
// TCC / Login Items do not merge this package with com.anthropic.claudefordesktop.
// align still copies official MacOS/Frameworks/Helpers/Resources for native
// residual fidelity, but re-stamps Info.plist identity after that copy.
const PRODUCT_BUNDLE_ID = process.env.CLAUDE_PRODUCT_BUNDLE_ID ?? "com.local.claude-deepseek.desktop";
const PRODUCT_NAME = process.env.CLAUDE_PRODUCT_NAME ?? "Claude-Deepseek";
const PRODUCT_DISPLAY_NAME = process.env.CLAUDE_PRODUCT_DISPLAY_NAME ?? PRODUCT_NAME;
const OFFICIAL_BUNDLE_ID = "com.anthropic.claudefordesktop";

if (process.platform !== "darwin" && !fsSync.existsSync(packagedApp)) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: "macOS bundle alignment requires a darwin .app package",
    packagedApp: path.relative(projectRoot, packagedApp),
  }, null, 2));
  process.exit(0);
}

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

function plistBuddyTry(infoPlist, command) {
  try {
    plistBuddy(infoPlist, command);
    return true;
  } catch {
    return false;
  }
}

/**
 * After copying official Info.plist, re-stamp product identity so this package
 * is not treated as official Claude Desktop (Dock icon merge, TCC, userData).
 * Keep CFBundleExecutable = Claude (align installs official MacOS/Claude binary).
 */
function plutilReplaceString(infoPlist, key, value) {
  execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, infoPlist], { stdio: "pipe" });
}

function reStampProductIdentity(infoPlist) {
  if (PRODUCT_BUNDLE_ID === OFFICIAL_BUNDLE_ID) {
    throw new Error(
      `product bundle id must not equal official ${OFFICIAL_BUNDLE_ID}; got ${PRODUCT_BUNDLE_ID}`,
    );
  }
  // TCC / Dock / userData key off CFBundleIdentifier — product-only.
  plutilReplaceString(infoPlist, "CFBundleIdentifier", PRODUCT_BUNDLE_ID);
  // CFBundleName MUST stay residual "Claude" so Electron finds
  // Frameworks/Claude Helper*.app (electron_main_delegate_mac helper lookup).
  // Renaming to Claude-Deepseek → FATAL "Unable to find helper app".
  // Official residual already uses CFBundleName=Claude + DisplayName=Claude-Deepseek.
  plutilReplaceString(infoPlist, "CFBundleName", "Claude");
  // Display name may already exist (copied from official / forge); replace, else insert.
  try {
    plutilReplaceString(infoPlist, "CFBundleDisplayName", PRODUCT_DISPLAY_NAME);
  } catch {
    execFileSync(
      "/usr/bin/plutil",
      ["-insert", "CFBundleDisplayName", "-string", PRODUCT_DISPLAY_NAME, infoPlist],
      { stdio: "pipe" },
    );
  }
  // Drop official team id / provision linkage — this is not the Anthropic-signed app.
  plistBuddyTry(infoPlist, "Delete :ElectronTeamID");
  try {
    plutilReplaceString(infoPlist, "NSHumanReadableCopyright", "local reconstruction");
  } catch {
    // optional
  }
}

/**
 * Ad-hoc re-sign the aligned product .app so codesign Identifier matches
 * PRODUCT_BUNDLE_ID (not leftover official com.anthropic.claudefordesktop from
 * the copied MacOS residual).
 *
 * IMPORTANT: do NOT use --deep. Deep re-sign rewrites nested Frameworks/Helpers
 * and can desync residual native binaries. Outer-app adhoc sign is enough for
 * LaunchServices / TCC client id (Quick Entry AXIsProcessTrustedWithOptions).
 *
 * Note: re-signing rewrites the main executable's embedded signature blob, so
 * MacOS/Claude content hash will differ from the official residual copy — that
 * is expected and does not mean the residual code pages were replaced.
 */
function reCodesignProductBundle(appPath, bundleId) {
  if (bundleId === OFFICIAL_BUNDLE_ID) {
    throw new Error(
      `refusing to codesign product with official id ${OFFICIAL_BUNDLE_ID}`,
    );
  }
  try {
    fsSync.rmSync(path.join(appPath, "Contents/_CodeSignature"), {
      recursive: true,
      force: true,
    });
  } catch {
    /* ignore */
  }
  try {
    fsSync.rmSync(path.join(appPath, "Contents/CodeResources"), { force: true });
  } catch {
    /* ignore */
  }
  // Outer only — keep Frameworks/Helpers residual signatures intact.
  const sign = spawnSync(
    "/usr/bin/codesign",
    [
      "--force",
      "--sign",
      "-",
      "--identifier",
      bundleId,
      appPath,
    ],
    { encoding: "utf8" },
  );
  if (sign.status !== 0) {
    throw new Error(
      `codesign --sign failed (status ${sign.status}): ${sign.stderr || sign.stdout}`,
    );
  }
  const dv = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=2", appPath], {
    encoding: "utf8",
  });
  const dvText = `${dv.stderr ?? ""}${dv.stdout ?? ""}`;
  const signedId = dvText.match(/^Identifier=(.+)$/m)?.[1]?.trim() ?? null;
  if (signedId !== bundleId) {
    throw new Error(
      `codesign Identifier mismatch: expected ${bundleId}, got ${signedId ?? "null"}\n${dvText}`,
    );
  }
  return signedId;
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

  // Critical: official Info.plist was just copied (CFBundleIdentifier =
  // com.anthropic.claudefordesktop). Re-stamp so Dock/TCC treat us as a
  // separate product. Executable stays Claude (native binary residual).
  reStampProductIdentity(infoPlist);

  await fs.chmod(path.join(packagedApp, "Contents/MacOS/Claude"), 0o755);

  // Official binary copy leaves codesign Identifier = com.anthropic.claudefordesktop
  // even after Info.plist re-stamp. macOS TCC / LaunchServices key off the signed
  // Identifier for Accessibility / Screen Capture. Without re-sign, residual
  // Quick Entry permission CTA (setOverlayVisible → AXIsProcessTrustedWithOptions)
  // may not match the product Bundle ID's TCC row, and Dock can still merge
  // identity with official Claude. Ad-hoc re-sign with product Identifier only —
  // never touches the Downloads residual app.
  const codesignIdentity = reCodesignProductBundle(packagedApp, PRODUCT_BUNDLE_ID);

  console.log(JSON.stringify({
    ok: true,
    packagedApp: path.relative(projectRoot, packagedApp),
    executable: "Contents/MacOS/Claude",
    productBundleId: PRODUCT_BUNDLE_ID,
    productName: PRODUCT_NAME,
    productDisplayName: PRODUCT_DISPLAY_NAME,
    asarHeaderHash: headerHash,
    codesignIdentity,
  }, null, 2));
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
