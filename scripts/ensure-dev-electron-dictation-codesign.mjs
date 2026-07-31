#!/usr/bin/env node
/**
 * Align bare dev Electron.app codesign with residual packaged Claude-Deepseek:
 *
 * Residual / Downloads / out package (codesign --entitlements):
 *   Identifier = com.local.claude-deepseek.desktop  (product; Downloads residual
 *     may still show com.anthropic… until align — product never uses Anthropic id)
 *   com.apple.security.device.audio-input = true   (+ residual device set)
 *
 * Stock node_modules/electron:
 *   Identifier = Electron
 *   entitlements empty
 * → AVAudio can still InputAvailable, but menu-bar system mic privacy light and
 *   hardened identity diverge from residual. Same class of gap as missing
 *   NSSpeechRecognitionUsageDescription (devSwiftPrivacyPlist).
 *
 * Product residual: ad-hoc re-sign Electron.app BEFORE launch with residual
 * entitlement bag + product bundle id. Does NOT touch Downloads residual app.
 * Does NOT invent non-residual entitlement keys beyond residual dump.
 *
 * Prefer outer-app sign (no --deep) so Frameworks/Helpers keep stock signatures
 * (align-packaged-macos-bundle reCodesign residual note).
 *
 * Run: node scripts/ensure-dev-electron-dictation-codesign.mjs
 * Wired from scripts/dev-electron.mjs before spawn.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Product forge residual — never com.anthropic.claudefordesktop. */
export const PRODUCT_CF_BUNDLE_IDENTIFIER =
  "com.local.claude-deepseek.desktop";

/**
 * Residual packaged entitlements bag (codesign dump of residual Claude binary).
 * Keys match Downloads / AppTranslocation / out Claude-Deepseek residual.
 */
export const RESIDUAL_DESKTOP_ENTITLEMENTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
`;

export function resolveDevElectronAppPath(
  projectRoot = root,
) {
  return path.join(
    projectRoot,
    "node_modules",
    "electron",
    "dist",
    "Electron.app",
  );
}

function codesignDv(appPath) {
  const dv = spawnSync(
    "/usr/bin/codesign",
    ["-dv", "--verbose=2", appPath],
    { encoding: "utf8" },
  );
  return `${dv.stderr ?? ""}${dv.stdout ?? ""}`;
}

function codesignEntitlementsDump(appPath) {
  const check = spawnSync(
    "/usr/bin/codesign",
    ["-d", "--entitlements", "-", appPath],
    { encoding: "utf8" },
  );
  return `${check.stdout ?? ""}${check.stderr ?? ""}`;
}

/**
 * @returns {{
 *   appPath: string,
 *   alreadyAligned: boolean,
 *   signed: boolean,
 *   identifier: string | null,
 *   hasAudioInput: boolean,
 *   error?: string,
 * }}
 */
export function ensureDevElectronDictationCodesign(
  projectRoot = root,
  options = {},
) {
  const appPath =
    typeof options.appPath === "string" && options.appPath.length > 0
      ? options.appPath
      : resolveDevElectronAppPath(projectRoot);
  const bundleId =
    typeof options.bundleId === "string" && options.bundleId.length > 0
      ? options.bundleId
      : PRODUCT_CF_BUNDLE_IDENTIFIER;

  if (process.platform !== "darwin") {
    return {
      appPath,
      alreadyAligned: true,
      signed: false,
      identifier: null,
      hasAudioInput: false,
      error: "darwin only",
    };
  }
  if (!fs.existsSync(appPath)) {
    return {
      appPath,
      alreadyAligned: false,
      signed: false,
      identifier: null,
      hasAudioInput: false,
      error: `Electron.app missing: ${appPath}`,
    };
  }

  const beforeDv = codesignDv(appPath);
  const beforeEnt = codesignEntitlementsDump(appPath);
  const beforeId =
    beforeDv.match(/^Identifier=(.+)$/m)?.[1]?.trim() ?? null;
  const beforeAudio = beforeEnt.includes(
    "com.apple.security.device.audio-input",
  );

  if (beforeId === bundleId && beforeAudio) {
    return {
      appPath,
      alreadyAligned: true,
      signed: false,
      identifier: beforeId,
      hasAudioInput: true,
    };
  }

  const entDir = path.join(projectRoot, ".vite");
  fs.mkdirSync(entDir, { recursive: true });
  const entPath = path.join(entDir, "dev-electron-dictation.entitlements");
  fs.writeFileSync(entPath, RESIDUAL_DESKTOP_ENTITLEMENTS_XML, "utf8");

  // Outer app only — residual align note: --deep rewrites Frameworks.
  const sign = spawnSync(
    "/usr/bin/codesign",
    [
      "--force",
      "--sign",
      "-",
      "--identifier",
      bundleId,
      "--entitlements",
      entPath,
      appPath,
    ],
    { encoding: "utf8" },
  );
  if (sign.status !== 0) {
    return {
      appPath,
      alreadyAligned: false,
      signed: false,
      identifier: beforeId,
      hasAudioInput: beforeAudio,
      error: `codesign failed: ${sign.stderr || sign.stdout}`,
    };
  }

  const afterDv = codesignDv(appPath);
  const afterEnt = codesignEntitlementsDump(appPath);
  const afterId =
    afterDv.match(/^Identifier=(.+)$/m)?.[1]?.trim() ?? null;
  const afterAudio = afterEnt.includes(
    "com.apple.security.device.audio-input",
  );

  if (afterId !== bundleId || !afterAudio) {
    return {
      appPath,
      alreadyAligned: false,
      signed: true,
      identifier: afterId,
      hasAudioInput: afterAudio,
      error: `post-sign mismatch id=${afterId} audio-input=${afterAudio}`,
    };
  }

  return {
    appPath,
    alreadyAligned: false,
    signed: true,
    identifier: afterId,
    hasAudioInput: true,
  };
}

const isMain =
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = ensureDevElectronDictationCodesign(root);
  console.log(JSON.stringify(result, null, 2));
  if (result.error && !result.hasAudioInput) process.exit(1);
  if (result.signed) {
    console.info(
      "[ensure-dev-electron-dictation-codesign] residual audio-input + product id applied — use this Electron for next dev launch",
    );
  } else if (result.alreadyAligned) {
    console.info(
      "[ensure-dev-electron-dictation-codesign] already aligned",
      result.identifier,
    );
  }
}
