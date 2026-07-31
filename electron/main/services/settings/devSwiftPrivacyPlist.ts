/**
 * Official Claude Desktop Info.plist residual (packaged app):
 *   CFBundleName / CFBundleDisplayName = "Claude"
 *   CFBundleIdentifier = com.anthropic.claudefordesktop
 *   NSMicrophoneUsageDescription =
 *     "Claude needs access to your microphone for voice dictation."
 *   NSSpeechRecognitionUsageDescription =
 *     "Claude needs access to speech recognition for voice dictation."
 *
 * Official JS residual (unpackaged only):
 *   gA.app.isPackaged || gA.app.setName("Claude")
 * so Fxe / systemPreferences dialogs are not titled "Electron".
 *
 * Product packaged forge residual (Dock-safe, never mutates residual Downloads app):
 *   CFBundleName = Claude
 *   CFBundleDisplayName = Claude-Deepseek
 *   CFBundleIdentifier = com.local.claude-deepseek.desktop
 *   same NSMicrophone / NSSpeechRecognition strings as official.
 *
 * Dev Electron.app (node_modules/electron/dist) ships:
 *   CFBundleName / DisplayName = Electron
 *   CFBundleIdentifier = com.github.Electron
 *   generic NSMicrophoneUsageDescription, historically no speech key.
 *
 * Without speech usage string, SFSpeech never authorizes and dictation looks
 * like "没开麦克风". Without DisplayName/Name patch, System Settings + TCC
 * prompt show "Electron" — user will not accept that name.
 *
 * Product residual: on unpackaged boot, patch Electron.app Contents/Info.plist
 * with official residual privacy strings + product display identity so the next
 * process launch is not titled Electron. Does not invent privacy keys beyond
 * official residual. Does not change CFBundleIdentifier (still com.github.Electron
 * in bare Electron; packaged product keeps com.local.claude-deepseek.desktop).
 *
 * Official Fxe residual (ONLY ask site in app.asar):
 *   getMediaAccessStatus("microphone")
 *   not-determined → systemPreferences.askForMediaAccess("microphone")
 * Call sites: eZt BEFORE_USE (setPreference ≠ off) + uit HOTKEY only.
 * When status is already granted/denied, official never re-asks — product matches.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { app } from "electron";

/** Official residual usage strings (packaged Claude / Claude-Deepseek Info.plist). */
export const OFFICIAL_MICROPHONE_USAGE_DESCRIPTION =
  "Claude needs access to your microphone for voice dictation.";

export const OFFICIAL_SPEECH_RECOGNITION_USAGE_DESCRIPTION =
  "Claude needs access to speech recognition for voice dictation.";

/**
 * Official residual CFBundleName for packaged Claude.app.
 * Product packaged also uses CFBundleName=Claude (forge/align).
 * Dev Electron defaults to "Electron" — patch so TCC prompt is not Electron.
 */
export const OFFICIAL_CF_BUNDLE_NAME = "Claude";

/**
 * Product forge residual Bundle ID (forge.config.cjs appBundleId).
 * Packaged Claude-Deepseek.app and the AppTranslocation build the user runs as
 * "官方" both use this id — and TCC already has kTCCServiceMicrophone for it.
 *
 * Bare Electron ships com.github.Electron. getMediaAccessStatus may still say
 * "granted" (Terminal inheritance) while AVAudioEngine / DictationBar never
 * actually capture — so the orange DictationBar never appears. Aligning dev
 * Info.plist CFBundleIdentifier to the product id lets Swift dictation use the
 * same TCC row as the packaged app (relaunch required).
 */
export const PRODUCT_CF_BUNDLE_IDENTIFIER = "com.local.claude-deepseek.desktop";

/**
 * Product Dock-safe display name residual (not bare official "Claude").
 * Matches package.json productName / forge DisplayName / app.setName default.
 */
export function resolveProductDisplayName(): string {
  return process.env.CLAUDE_PRODUCT_NAME?.trim() || "Claudex";
}

export type EnsureDevPrivacyPlistResult = {
  plistPath: string | null;
  updated: string[];
  skipped: string[];
};

function electronAppInfoPlistPath(): string | null {
  // process.execPath = .../Electron.app/Contents/MacOS/Electron
  try {
    const execPath = app.getPath("exe");
    const contents = path.resolve(execPath, "..", "..");
    const plist = path.join(contents, "Info.plist");
    if (fs.existsSync(plist)) return plist;
  } catch {
    /* fall through */
  }
  // Fallback: electron package dist
  try {
    const candidate = path.join(
      app.getAppPath(),
      "node_modules",
      "electron",
      "dist",
      "Electron.app",
      "Contents",
      "Info.plist",
    );
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    /* ignore */
  }
  return null;
}

function readPlistString(plistPath: string, key: string): string | null {
  try {
    const out = execFileSync("plutil", ["-extract", key, "raw", plistPath], {
      encoding: "utf8",
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function writePlistString(plistPath: string, key: string, value: string): boolean {
  try {
    // Replace existing or insert.
    try {
      execFileSync(
        "plutil",
        ["-replace", key, "-string", value, plistPath],
        { encoding: "utf8" },
      );
      return true;
    } catch {
      execFileSync(
        "plutil",
        ["-insert", key, "-string", value, plistPath],
        { encoding: "utf8" },
      );
      return true;
    }
  } catch (error) {
    console.warn("[devSwiftPrivacyPlist] plutil write failed", key, error);
    return false;
  }
}

/**
 * Ensure official residual mic + speech usage descriptions and product
 * display identity on dev Electron.app. No-op when packaged (forge/out aligned).
 *
 * LaunchServices reads CFBundle* at process start — patches apply on **next**
 * launch. Call early in bootstrap and relaunch after first-time patch.
 */
export function ensureDevSwiftPrivacyPlist(): EnsureDevPrivacyPlistResult {
  const updated: string[] = [];
  const skipped: string[] = [];

  if (app.isPackaged) {
    return { plistPath: null, updated, skipped };
  }
  if (process.platform !== "darwin") {
    return { plistPath: null, updated, skipped };
  }

  const plistPath = electronAppInfoPlistPath();
  if (!plistPath) {
    console.warn("[devSwiftPrivacyPlist] Electron Info.plist not found");
    return { plistPath: null, updated, skipped };
  }

  const displayName = resolveProductDisplayName();
  // Match product packaged residual: Name=Claude (official), DisplayName=product,
  // Bundle ID = forge appBundleId so DictationBar / mic TCC match packaged app.
  // Never leave bare "Electron" — that is the name the user refuses.
  //
  // Official Anthropic id is com.anthropic.claudefordesktop — product must NOT
  // use that (Dock/TCC collision with real Claude.app). Product id only.
  const desired: Record<string, string> = {
    NSMicrophoneUsageDescription: OFFICIAL_MICROPHONE_USAGE_DESCRIPTION,
    NSSpeechRecognitionUsageDescription:
      OFFICIAL_SPEECH_RECOGNITION_USAGE_DESCRIPTION,
    CFBundleDisplayName: displayName,
    CFBundleName: OFFICIAL_CF_BUNDLE_NAME,
    CFBundleIdentifier: PRODUCT_CF_BUNDLE_IDENTIFIER,
  };

  for (const [key, value] of Object.entries(desired)) {
    const current = readPlistString(plistPath, key);
    if (current === value) {
      skipped.push(key);
      continue;
    }
    if (writePlistString(plistPath, key, value)) {
      updated.push(key);
      console.info("[devSwiftPrivacyPlist] set", key, {
        from: current,
        to: value,
        plistPath,
      });
    } else {
      skipped.push(key);
    }
  }

  if (updated.length > 0) {
    console.info(
      `[devSwiftPrivacyPlist] patched ${updated.length} key(s) on ${plistPath} — relaunch required for LaunchServices/TCC to pick up CFBundle* + NSSpeechRecognitionUsageDescription (current process still booted as prior identity)`,
    );
  }

  return { plistPath, updated, skipped };
}
