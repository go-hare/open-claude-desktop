import { app, shell } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  CHROME_EXTENSION_IDS_DETECT,
  CHROME_EXTENSION_LISTING_URL,
} from "./chromeNativeHost";

const execFileAsync = promisify(execFile);
/** Product + official residual ids for install detect / Preferences cleanup. */
const EXTENSION_IDS = [...CHROME_EXTENSION_IDS_DETECT];

type BrowserProfileRoot = { name: string; path: string };
export type ChromeInstallResult = { status: "succeeded" | "skipped" | "error"; error?: string };

function browserProfileRoots(): BrowserProfileRoot[] {
  const home = os.homedir();
  if (process.platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    return [
      { name: "Chrome", path: path.join(base, "Google", "Chrome") },
      { name: "Edge", path: path.join(base, "Microsoft Edge") },
      { name: "Brave", path: path.join(base, "BraveSoftware", "Brave-Browser") },
      { name: "Chromium", path: path.join(base, "Chromium") },
      { name: "Arc", path: path.join(base, "Arc", "User Data") },
      { name: "Vivaldi", path: path.join(base, "Vivaldi") },
      { name: "Opera", path: path.join(base, "com.operasoftware.Opera") },
    ];
  }
  if (process.platform === "win32") {
    const base = path.join(home, "AppData", "Local");
    return [
      { name: "Chrome", path: path.join(base, "Google", "Chrome", "User Data") },
      { name: "Edge", path: path.join(base, "Microsoft", "Edge", "User Data") },
    ];
  }
  return [];
}

async function profileNames(root: BrowserProfileRoot): Promise<string[]> {
  try {
    const entries = await fs.readdir(root.path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && (entry.name === "Default" || entry.name.startsWith("Profile "))).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function extensionFolderHasManifest(extensionFolder: string): Promise<boolean> {
  try {
    const versions = await fs.readdir(extensionFolder, { withFileTypes: true });
    await Promise.any(versions.filter((entry) => entry.isDirectory()).map((entry) => fs.access(path.join(extensionFolder, entry.name, "manifest.json"))));
    return true;
  } catch {
    return false;
  }
}

async function browserHasExtension(root: BrowserProfileRoot): Promise<boolean> {
  // Prefer shared residual detector (packed + unpacked Secure Preferences path).
  try {
    const { browserHasClaudeChromeExtension } = await import("./chromeNativeHost");
    return browserHasClaudeChromeExtension(root, EXTENSION_IDS);
  } catch {
    for (const profile of await profileNames(root)) {
      for (const extensionId of EXTENSION_IDS) {
        const extensionFolder = path.join(root.path, profile, "Extensions", extensionId);
        if (await extensionFolderHasManifest(extensionFolder)) return true;
      }
    }
    return false;
  }
}

export async function isClaudeChromeExtensionInstalled(): Promise<boolean> {
  const checks = await Promise.all(browserProfileRoots().map(browserHasExtension));
  return checks.some(Boolean);
}

function chromeUserDataRoot(): string {
  return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function objectAt(root: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = root[key];
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  root[key] = next;
  return next;
}

/**
 * Clear only Chrome's external-uninstall blocklist so a future External
 * Extension / reinstall can proceed.
 *
 * Product path is go-hare unpacked sideload (Secure Preferences path), not
 * Chrome Web Store External Extensions. Official residual also wipes
 * settings[id] / install_signature / updateclientdata — that is safe for
 * store reinstall of a *missing* extension, but destroys a live developer
 * load (location 4). Never delete settings[id] here.
 */
function cleanUninstallState(document: Record<string, unknown>, extensionId: string): boolean {
  let changed = false;
  const extensions = objectAt(document, "extensions");
  const externalUninstalls = extensions.external_uninstalls;
  if (Array.isArray(externalUninstalls) && externalUninstalls.includes(extensionId)) {
    extensions.external_uninstalls = externalUninstalls.filter((item) => item !== extensionId);
    changed = true;
  }
  // Also clear macs residual for external_uninstalls when present (Secure Preferences).
  const protection = document.protection;
  if (protection && typeof protection === "object" && !Array.isArray(protection)) {
    const macs = (protection as Record<string, unknown>).macs;
    if (macs && typeof macs === "object" && !Array.isArray(macs)) {
      const extMacs = (macs as Record<string, unknown>).extensions;
      if (extMacs && typeof extMacs === "object" && !Array.isArray(extMacs)) {
        if ("external_uninstalls" in (extMacs as Record<string, unknown>)) {
          delete (extMacs as Record<string, unknown>).external_uninstalls;
          delete (protection as Record<string, unknown>).super_mac;
          changed = true;
        }
      }
    }
  }
  return changed;
}

async function cleanChromeProfileUninstallState(): Promise<void> {
  const root = chromeUserDataRoot();
  for (const profile of await profileNames({ name: "Chrome", path: root })) {
    for (const fileName of ["Preferences", "Secure Preferences"]) {
      const filePath = path.join(root, profile, fileName);
      const document = await readJson(filePath);
      if (!document) continue;
      const changed = EXTENSION_IDS.some((extensionId) => cleanUninstallState(document, extensionId));
      if (changed) await fs.writeFile(filePath, JSON.stringify(document), "utf8");
    }
  }
}

export async function installClaudeChromeExtension(): Promise<ChromeInstallResult> {
  if (process.platform !== "darwin") return { status: "error", error: `Unsupported platform: ${process.platform}. Only macOS is supported.` };
  try {
    if (await isClaudeChromeExtensionInstalled()) {
      // Official residual: still re-sync native host when install is skipped (already present).
      await reSyncNativeHostAfterInstallChange();
      return { status: "skipped" };
    }
    // Product: go-hare agent-extension is not on Chrome Web Store External Extensions.
    // Open GitHub listing for sideload / release install; re-sync host manifests for when user loads it.
    await cleanChromeProfileUninstallState();
    await openChromeExtensionListing();
    await reSyncNativeHostAfterInstallChange();
    return { status: "succeeded" };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

/** Official vrt after install/extension change (Kir order: host path → Oir). */
async function reSyncNativeHostAfterInstallChange(): Promise<void> {
  try {
    const { syncChromeNativeHost } = await import("./chromeNativeHost");
    await syncChromeNativeHost({
      userDataPath: app.getPath("userData"),
      log: (msg) => console.info(msg),
    });
  } catch (error) {
    console.warn(
      "[Chrome Extension MCP] Native host re-sync after install failed:",
      error,
    );
  }
}

/**
 * Official Nrt(skipCleanup): when extension is already installed (install
 * status Skipped), restart must NOT run uninstall-state cleanup.
 * Default: detect install first — never wipe prefs for a live extension.
 */
export async function restartChromeForExtension(skipCleanup?: boolean): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    const skip =
      skipCleanup === true ||
      (skipCleanup !== false && (await isClaudeChromeExtensionInstalled()));
    await execFileAsync("/usr/bin/osascript", ["-e", 'tell application "Google Chrome" to quit'], { timeout: 5000 }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (!skip) await cleanChromeProfileUninstallState();
    await execFileAsync("/usr/bin/open", ["-a", "Google Chrome"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function openChromeExtensionListing(): Promise<boolean> {
  // Product Claudex: go-hare agent-extension releases / install docs.
  await shell.openExternal(CHROME_EXTENSION_LISTING_URL);
  return true;
}

/**
 * Official Fai residual path helper (win32 shared / product userData fallback).
 * macOS primary manifests live under Chrome/Edge NativeMessagingHosts (HFA).
 */
export function chromeNativeHostManifestPath(): string {
  return path.join(
    app.getPath("userData"),
    "ChromeNativeHost",
    "com.anthropic.claude_browser_extension.json",
  );
}

/** Re-export primary sync for install/restart hooks. */
export async function syncClaudeChromeNativeHost(): Promise<void> {
  await reSyncNativeHostAfterInstallChange();
}
