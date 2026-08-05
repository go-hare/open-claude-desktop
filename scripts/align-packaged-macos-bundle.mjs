/**
 * macOS post-package finalize — NOT a residual-copy step.
 *
 * Normal Electron model:
 *   - forge already packed OUR project resources/ into Contents/Resources
 *     (product-web, ion-dist, claude-code-bin, smol-bin, locale JSON, …)
 *   - This script only finalizes what forge cannot do alone:
 *       1) lift Resources/Helpers → Contents/Helpers (chrome-native-host path residual)
 *       2) inject runtime natives into app.asar (forge asar allowlist excludes node_modules)
 *       3) host-only prune of claude-code-bin
 *       4) product identity + adhoc codesign
 *
 * Package NEVER reads resources/original-claude.app or Downloads.
 * Assets must already live under resources/ (one-time: npm run sync:residual / sync:helpers).
 */
import asar from "@electron/asar";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./originalAppPaths.mjs";
import {
  OFFICIAL_BUNDLE_ID,
  PRODUCT_BUNDLE_ID,
  PRODUCT_NAME,
  pruneClaudeCodeBinToHost,
  resolvePackagedTargets,
} from "./packagePaths.mjs";

const projectRoot = getProjectRoot();
const packagedApp = resolvePackagedTargets({ root: projectRoot, platform: "darwin" }).packagedRoot;
const PRODUCT_DISPLAY_NAME = process.env.CLAUDE_PRODUCT_DISPLAY_NAME ?? PRODUCT_NAME;

if (process.platform !== "darwin" && !fsSync.existsSync(packagedApp)) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        reason: "macOS bundle alignment requires a darwin .app package",
        packagedApp: path.relative(projectRoot, packagedApp),
      },
      null,
      2,
    ),
  );
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

function plutilReplaceString(infoPlist, key, value) {
  execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, infoPlist], {
    stdio: "pipe",
  });
}

function ensureProductIdentity(infoPlist) {
  if (PRODUCT_BUNDLE_ID === OFFICIAL_BUNDLE_ID) {
    throw new Error(
      `product bundle id must not equal official ${OFFICIAL_BUNDLE_ID}; got ${PRODUCT_BUNDLE_ID}`,
    );
  }
  plutilReplaceString(infoPlist, "CFBundleIdentifier", PRODUCT_BUNDLE_ID);
  plutilReplaceString(infoPlist, "CFBundleName", PRODUCT_NAME);
  try {
    plutilReplaceString(infoPlist, "CFBundleDisplayName", PRODUCT_DISPLAY_NAME);
  } catch {
    execFileSync(
      "/usr/bin/plutil",
      ["-insert", "CFBundleDisplayName", "-string", PRODUCT_DISPLAY_NAME, infoPlist],
      { stdio: "pipe" },
    );
  }
  try {
    plutilReplaceString(infoPlist, "CFBundleExecutable", PRODUCT_NAME);
  } catch {
    // optional
  }
  plistBuddyTry(infoPlist, "Delete :ElectronTeamID");
  try {
    plutilReplaceString(infoPlist, "NSHumanReadableCopyright", "local reconstruction");
  } catch {
    // optional
  }
}

function reCodesignProductBundle(appPath, bundleId) {
  if (bundleId === OFFICIAL_BUNDLE_ID) {
    throw new Error(`refusing to codesign product with official id ${OFFICIAL_BUNDLE_ID}`);
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
    /* soft */
  }

  const signArgs = ["--force", "--sign", "-", "--identifier", bundleId];
  if (fsSync.existsSync(entPath)) {
    signArgs.push("--entitlements", entPath);
  }
  signArgs.push(appPath);
  const sign = spawnSync("/usr/bin/codesign", signArgs, { encoding: "utf8" });
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

if (!(await exists(packagedApp))) {
  throw new Error(`packaged app not found: ${packagedApp}`);
}

const packagedResources = path.join(packagedApp, "Contents/Resources");
const forgeExecutable = path.join(packagedApp, "Contents/MacOS", PRODUCT_NAME);
const residualClaudeExecutable = path.join(packagedApp, "Contents/MacOS/Claude");

if (!(await exists(forgeExecutable))) {
  throw new Error(
    `forge product shell missing: ${forgeExecutable}. ` +
      `Package must keep electron-forge Claudex binary.`,
  );
}
if (await exists(residualClaudeExecutable)) {
  await fs.rm(residualClaudeExecutable, { force: true });
}

// --- Require forge-packed project assets (no residual re-fetch) ---
const productWebIndex = path.join(packagedResources, "product-web/index.html");
const residualIonIndex = path.join(packagedResources, "ion-dist/index.html");
if (!(await exists(productWebIndex))) {
  throw new Error(
    `product-web missing in package Resources (forge must pack resources/product-web). ` +
      `Run: npm run build:product-web && npm run package`,
  );
}
if (!(await exists(residualIonIndex))) {
  throw new Error(
    `ion-dist missing in package Resources (forge must pack resources/ion-dist). ` +
      `Ensure resources/ion-dist exists before package (npm run sync:ion-dist once).`,
  );
}

const productBuildId = (() => {
  try {
    return (
      fsSync.readFileSync(productWebIndex, "utf8").match(/data-build-id="([^"]+)"/)?.[1] ??
      "unknown"
    );
  } catch {
    return "unknown";
  }
})();
const residualBuildId = (() => {
  try {
    return (
      fsSync.readFileSync(residualIonIndex, "utf8").match(/data-build-id="([^"]+)"/)?.[1] ??
      "unknown"
    );
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
    `packaged residual ion-dist collides with product build id (${productBuildId})`,
  );
}

// --- Helpers: forge puts resources/Helpers → Resources/Helpers; runtime wants Contents/Helpers ---
const contentsHelpers = path.join(packagedApp, "Contents/Helpers");
const resourcesHelpers = path.join(packagedResources, "Helpers");
const projectHelpers = path.join(projectRoot, "resources/Helpers");
let helpersPlaced = [];

async function placeHelperBinary(srcDir, name) {
  const src = path.join(srcDir, name);
  if (!(await exists(src))) return false;
  await fs.mkdir(contentsHelpers, { recursive: true });
  const dest = path.join(contentsHelpers, name);
  // Move/copy within package tree or from OUR resources/ only (never original-claude.app).
  await fs.copyFile(src, dest);
  await fs.chmod(dest, 0o755);
  helpersPlaced.push(name);
  return true;
}

if (await exists(path.join(resourcesHelpers, "chrome-native-host"))) {
  for (const name of ["chrome-native-host", "disclaimer"]) {
    await placeHelperBinary(resourcesHelpers, name);
  }
  // Drop Resources/Helpers after lift (official layout is Contents/Helpers only).
  await fs.rm(resourcesHelpers, { recursive: true, force: true });
} else if (await exists(path.join(projectHelpers, "chrome-native-host"))) {
  // Forge missed extraResource — place from project resources (still OUR tree, not residual .app).
  for (const name of ["chrome-native-host", "disclaimer"]) {
    await placeHelperBinary(projectHelpers, name);
  }
} else {
  throw new Error(
    "Helpers missing: put chrome-native-host under resources/Helpers (npm run sync:helpers once), then re-package. " +
      "Package does not read original-claude.app.",
  );
}

// Host-only CLI prune (files already in package from forge extraResource).
let claudeCodeBinPrune = null;
const claudeCodeBinTarget = path.join(packagedResources, "claude-code-bin");
if (await exists(claudeCodeBinTarget)) {
  claudeCodeBinPrune = pruneClaudeCodeBinToHost(claudeCodeBinTarget, { platform: "darwin" });
}

// Runtime natives → app.asar (project resources/original-runtime-node_modules only).
const appAsar = path.join(packagedResources, "app.asar");
if (!(await exists(appAsar))) {
  throw new Error(`forge app.asar missing: ${appAsar}`);
}
const { injectPackagedAsarRuntime } = await import("./inject-packaged-asar-runtime.mjs");
await injectPackagedAsarRuntime({
  appAsar,
  projectRoot,
  packagedResources,
  keepExtraResourceRuntime: false,
});

const infoPlist = path.join(packagedApp, "Contents/Info.plist");
ensureProductIdentity(infoPlist);

const headerHash = asarHeaderSha256(appAsar);
const hasIntegrity = plistBuddyTry(
  infoPlist,
  `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${headerHash}`,
);
if (!hasIntegrity) {
  try {
    plistBuddy(infoPlist, "Add :ElectronAsarIntegrity dict");
    plistBuddy(infoPlist, "Add :ElectronAsarIntegrity:Resources/app.asar dict");
    plistBuddy(infoPlist, "Add :ElectronAsarIntegrity:Resources/app.asar:algorithm string SHA256");
    plistBuddy(
      infoPlist,
      `Add :ElectronAsarIntegrity:Resources/app.asar:hash string ${headerHash}`,
    );
  } catch {
    // optional
  }
}

await fs.chmod(forgeExecutable, 0o755);
await fs.rm(path.join(packagedApp, "Contents/_CodeSignature"), {
  recursive: true,
  force: true,
});
await fs.rm(path.join(packagedApp, "Contents/CodeResources"), { force: true });

const codesignIdentity = reCodesignProductBundle(packagedApp, PRODUCT_BUNDLE_ID);

const smolPresent = await exists(
  path.join(
    packagedResources,
    process.arch === "arm64" ? "smol-bin.arm64.img" : "smol-bin.x64.img",
  ),
);
const localePresent = await exists(path.join(packagedResources, "en-US.json"));

console.log(
  JSON.stringify(
    {
      ok: true,
      shellModel: "own-forge-electron",
      packageModel: "project-resources-only",
      packagedApp: path.relative(projectRoot, packagedApp),
      executable: `Contents/MacOS/${PRODUCT_NAME}`,
      productBundleId: PRODUCT_BUNDLE_ID,
      productName: PRODUCT_NAME,
      asarHeaderHash: headerHash,
      codesignIdentity,
      productBuildId,
      residualIonBuildId: residualBuildId,
      dualRoot: "product-web + ion-dist (forge-packed)",
      helpersPlaced,
      claudeCodeBinPrune,
      smolPresent,
      localePresent,
      note: "No residual .app copy at package time. Assets must already be under resources/.",
    },
    null,
    2,
  ),
);
