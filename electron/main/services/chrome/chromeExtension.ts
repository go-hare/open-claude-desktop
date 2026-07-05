import { app, shell } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CURRENT_EXTENSION_ID = "fcoeoabgfenejglbffodgkkbkcdhcgfn";
const LEGACY_EXTENSION_ID = "dihbgbndebgnbjfmelmegjepbnkhlgni";
const EXTENSION_IDS = [CURRENT_EXTENSION_ID, LEGACY_EXTENSION_ID];
const EXTERNAL_UPDATE_URL = "https://clients2.google.com/service/update2/crx";

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
  for (const profile of await profileNames(root)) {
    for (const extensionId of EXTENSION_IDS) {
      const extensionFolder = path.join(root.path, profile, "Extensions", extensionId);
      if (await extensionFolderHasManifest(extensionFolder)) return true;
    }
  }
  return false;
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

function cleanUninstallState(document: Record<string, unknown>, extensionId: string): boolean {
  let changed = false;
  const extensions = objectAt(document, "extensions");
  const externalUninstalls = extensions.external_uninstalls;
  if (Array.isArray(externalUninstalls) && externalUninstalls.includes(extensionId)) {
    extensions.external_uninstalls = externalUninstalls.filter((item) => item !== extensionId);
    changed = true;
  }
  const settings = objectAt(extensions, "settings");
  if (extensionId in settings) {
    delete settings[extensionId];
    changed = true;
  }
  const installSignature = objectAt(extensions, "install_signature");
  const ids = installSignature.ids;
  if (Array.isArray(ids) && ids.includes(extensionId)) {
    installSignature.ids = ids.filter((item) => item !== extensionId);
    delete installSignature.signature;
    delete installSignature.expire_date;
    changed = true;
  }
  const apps = objectAt(objectAt(document, "updateclientdata"), "apps");
  if (extensionId in apps) {
    delete apps[extensionId];
    changed = true;
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
    if (await isClaudeChromeExtensionInstalled()) return { status: "skipped" };
    await cleanChromeProfileUninstallState();
    const externalExtensionsDir = path.join(chromeUserDataRoot(), "External Extensions");
    await fs.mkdir(externalExtensionsDir, { recursive: true });
    await fs.writeFile(path.join(externalExtensionsDir, `${CURRENT_EXTENSION_ID}.json`), JSON.stringify({ external_update_url: EXTERNAL_UPDATE_URL }, null, 2), "utf8");
    return { status: "succeeded" };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function restartChromeForExtension(skipCleanup = false): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await execFileAsync("/usr/bin/osascript", ["-e", 'tell application "Google Chrome" to quit'], { timeout: 5000 }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (!skipCleanup) await cleanChromeProfileUninstallState();
    await execFileAsync("/usr/bin/open", ["-a", "Google Chrome"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function openChromeExtensionListing(): Promise<boolean> {
  const url = `https://chrome.google.com/webstore/detail/${CURRENT_EXTENSION_ID}`;
  await shell.openExternal(url);
  return true;
}

export function chromeNativeHostManifestPath(): string {
  return path.join(app.getPath("userData"), "ChromeNativeHost", "com.anthropic.claude_browser_extension.json");
}
