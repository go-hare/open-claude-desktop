import asar from "@electron/asar";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { getProjectRoot, resolveOriginalApp } from "./originalAppPaths.mjs";
import {
  OFFICIAL_BUNDLE_ID,
  PRODUCT_BUNDLE_ID,
  PRODUCT_NAME,
  pruneClaudeCodeBinToHost,
  resolvePackagedTargets,
} from "./packagePaths.mjs";

const projectRoot = getProjectRoot();
const originalApp = resolveOriginalApp();
const packagedApp = resolvePackagedTargets({ root: projectRoot, platform: "darwin" }).packagedRoot;

// Product identity — must stay distinct from official Claude Desktop so Dock /
// TCC / Login Items do not merge this package with com.anthropic.claudefordesktop.
// align still copies official MacOS/Frameworks/Helpers/Resources for native
// residual fidelity, but re-stamps Info.plist identity after that copy.
const PRODUCT_DISPLAY_NAME = process.env.CLAUDE_PRODUCT_DISPLAY_NAME ?? PRODUCT_NAME;

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
  // Renaming to Claudex → FATAL "Unable to find helper app".
  // Official residual already uses CFBundleName=Claude + DisplayName=Claudex.
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
  // Residual Desktop bag includes device.audio-input (dictation / menubar mic).
  // Re-sign without --entitlements can drop the bag on some adhoc paths — pin it.
  const entPath = path.join(projectRoot, ".vite", "packaged-dictation.entitlements");
  try {
    fsSync.mkdirSync(path.dirname(entPath), { recursive: true });
    fsSync.writeFileSync(
      entPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.cs.allow-jit</key>
	<true/>
	<key>com.apple.security.cs.disable-library-validation</key>
	<true/>
	<key>com.apple.security.device.audio-input</key>
	<true/>
	<key>com.apple.security.device.bluetooth</key>
	<true/>
	<key>com.apple.security.device.camera</key>
	<true/>
	<key>com.apple.security.device.print</key>
	<true/>
	<key>com.apple.security.device.usb</key>
	<true/>
	<key>com.apple.security.personal-information.location</key>
	<true/>
	<key>com.apple.security.personal-information.photos-library</key>
	<true/>
	<key>com.apple.security.virtualization</key>
	<true/>
</dict>
</plist>
`,
      "utf8",
    );
  } catch {
    /* soft — sign without ent file still attempts */
  }
  const signArgs = [
    "--force",
    "--sign",
    "-",
    "--identifier",
    bundleId,
  ];
  if (fsSync.existsSync(entPath)) {
    signArgs.push("--entitlements", entPath);
  }
  signArgs.push(appPath);
  const sign = spawnSync(
    "/usr/bin/codesign",
    signArgs,
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

async function rebuildAppAsarWithOriginalRuntime(appAsar) {
  // Prefer the forge asar snapshot saved before residual Resources overwrite.
  // injectPackagedAsarRuntime reads appAsar path; we first restore generatedAsar.
  await fs.copyFile(generatedAsar, appAsar);
  const { injectPackagedAsarRuntime } = await import("./inject-packaged-asar-runtime.mjs");
  await injectPackagedAsarRuntime({
    appAsar,
    projectRoot,
    packagedResources,
    // mac: runtime lives inside asar; drop extraResource tree after inject.
    keepExtraResourceRuntime: false,
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

  // Dual-root residual (must match electronShellPaths + staticIonDist):
  //   primary SPA  → Resources/product-web  (open-claude-web, react-shell)
  //   residual SPA → Resources/ion-dist     (official spa-dev from original
  //                  Contents/Resources copy above — setup-desktop-3p /
  //                  device-code-verify). NEVER overwrite ion-dist with product.
  // Official prr(Hot()+"ion-dist") is residual-only for those routes; product
  // main prefers product-web when present (resolveAppStaticRoot).
  const productWebSource = path.join(projectRoot, "resources/product-web");
  const residualIonIndex = path.join(packagedResources, "ion-dist/index.html");
  let productWebInjected = false;
  if (await exists(path.join(productWebSource, "index.html"))) {
    const productWebTarget = path.join(packagedResources, "product-web");
    await fs.rm(productWebTarget, { recursive: true, force: true });
    await copyPath(productWebSource, productWebTarget);
    productWebInjected = true;
  } else {
    throw new Error(
      `packaged app:// web missing: build product web first (npm run build:product-web). Expected ${productWebSource}/index.html`,
    );
  }
  if (!(await exists(residualIonIndex))) {
    throw new Error(
      `packaged residual ion-dist missing after official Resources copy: ${residualIonIndex} (setup-desktop-3p dual-root)`,
    );
  }
  const residualBuildId = (() => {
    try {
      return fsSync.readFileSync(residualIonIndex, "utf8").match(/data-build-id="([^"]+)"/)?.[1] ?? "unknown";
    } catch {
      return "unknown";
    }
  })();
  const productBuildId = (() => {
    try {
      return fsSync
        .readFileSync(path.join(packagedResources, "product-web/index.html"), "utf8")
        .match(/data-build-id="([^"]+)"/)?.[1] ?? "unknown";
    } catch {
      return "unknown";
    }
  })();
  if (productBuildId === "spa-dev" || productBuildId === "unknown") {
    throw new Error(
      `packaged product-web is not product SPA (data-build-id=${productBuildId}); re-run build:product-web`,
    );
  }
  if (residualBuildId === productBuildId) {
    throw new Error(
      `packaged residual ion-dist collides with product build id (${productBuildId}); ion-dist must stay official spa residual`,
    );
  }
  // Keep product CLI bundle if present under project resources (official residual may lack it).
  // Host-only: mac package ships only platforms/darwin-<arch> (+ top-level claude/vendor).
  // Full multi-platform matrix is opt-in via CLAUDE_CODE_ALL_PLATFORMS=1 (copy + no prune).
  const claudeCodeBinSource = path.join(projectRoot, "resources/claude-code-bin");
  let claudeCodeBinInjected = false;
  let claudeCodeBinPrune = null;
  if (await exists(claudeCodeBinSource)) {
    // Prune source tree too so subsequent packages / dev resources stay lean.
    pruneClaudeCodeBinToHost(claudeCodeBinSource, { platform: "darwin" });
    const claudeCodeBinTarget = path.join(packagedResources, "claude-code-bin");
    await fs.rm(claudeCodeBinTarget, { recursive: true, force: true });
    await copyPath(claudeCodeBinSource, claudeCodeBinTarget);
    claudeCodeBinPrune = pruneClaudeCodeBinToHost(claudeCodeBinTarget, { platform: "darwin" });
    claudeCodeBinInjected = true;
  }

  // Residual electron.icns is LaunchServices icon; Electron nativeImage cannot decode
  // this ic07-only file. Re-inject residual-extracted PNG for dock.setIcon after the
  // official Resources overwrite wiped forge extraResource copies.
  const electronAppIconPngSource = path.join(projectRoot, "resources/electron-app-icon.png");
  let electronAppIconPngInjected = false;
  if (await exists(electronAppIconPngSource)) {
    await fs.copyFile(
      electronAppIconPngSource,
      path.join(packagedResources, "electron-app-icon.png"),
    );
    electronAppIconPngInjected = true;
  }

  // The original signature no longer applies after replacing app.asar.
  await fs.rm(path.join(packagedApp, "Contents/_CodeSignature"), { recursive: true, force: true });
  await fs.rm(path.join(packagedApp, "Contents/CodeResources"), { force: true });

  const infoPlist = path.join(packagedApp, "Contents/Info.plist");
  const appAsar = path.join(packagedResources, "app.asar");
  // injectPackagedAsarRuntime already removes original-runtime-node_modules when
  // keepExtraResourceRuntime=false.
  await rebuildAppAsarWithOriginalRuntime(appAsar);
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
    productWebInjected,
    productBuildId,
    residualIonBuildId: residualBuildId,
    dualRoot: "product-web primary + ion-dist residual",
    claudeCodeBinInjected,
    claudeCodeBinPrune,
    electronAppIconPngInjected,
  }, null, 2));
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
