/**
 * Official Chrome native-messaging residual (app.asar Kir / Oir / krt / x1e / HFA / bai / xir / vrt):
 * - Manifest name FFA = com.anthropic.claude_browser_extension
 * - File OFA = com.anthropic.claude_browser_extension.json
 * - Host binary CAA = chrome-native-host (macOS Helpers when packaged)
 * - allowed_origins: legacy + current + third extension ids
 * - darwin HFA: Chrome + Edge NativeMessagingHosts only
 * - darwin bai: non-primary browsers cleaned (remove stale manifests)
 *
 * Product: macOS-first; do not invent Windows registry / Claude Native.
 * Host path: packaged Helpers, else known residual binary, else Node launcher
 * wrapping @ant/chrome-native-host runChromeNativeHost (stdio host for Chrome).
 */

import { app } from "electron";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

/** Official FFA */
export const NATIVE_HOST_NAME = "com.anthropic.claude_browser_extension";
/** Official OFA */
export const NATIVE_HOST_MANIFEST_FILE = `${NATIVE_HOST_NAME}.json`;
/** Official CAA */
export const NATIVE_HOST_BINARY_NAME = "chrome-native-host";

/**
 * Product Claudex / go-hare agent-extension (primary).
 * Install listing: https://github.com/go-hare/agent-extension
 */
export const CHROME_EXTENSION_ID_PRODUCT = "bbkeopmjdjdiiaahndbbjhckdbgblpjn";
/** Alias — product is current for Claudex (not Anthropic Web Store id). */
export const CHROME_EXTENSION_ID_CURRENT = CHROME_EXTENSION_ID_PRODUCT;

/** Official U1e residual (Anthropic current) — allowed_origins / optional detect */
export const CHROME_EXTENSION_ID_OFFICIAL_CURRENT =
  "fcoeoabgfenejglbffodgkkbkcdhcgfn";
/** Official b1e residual (legacy) */
export const CHROME_EXTENSION_ID_LEGACY = "dihbgbndebgnbjfmelmegjepbnkhlgni";
/** Official Tai residual (third) — allowed_origins only historically */
export const CHROME_EXTENSION_ID_THIRD = "dngcpimnedloihjnnfngkgjoidhnaolf";

/** Product install / download page (not Chrome Web Store). */
export const CHROME_EXTENSION_LISTING_URL =
  "https://github.com/go-hare/agent-extension";

/**
 * Install detection: product first, then official residual ids if still present.
 */
export const CHROME_EXTENSION_IDS_DETECT = [
  CHROME_EXTENSION_ID_PRODUCT,
  CHROME_EXTENSION_ID_OFFICIAL_CURRENT,
  CHROME_EXTENSION_ID_LEGACY,
] as const;

/**
 * Native host allowed_origins: product first, then official residual order
 * (b1e, U1e, Tai) so Anthropic builds remain attachable if installed.
 */
export const CHROME_EXTENSION_ALLOWED_ORIGINS = [
  `chrome-extension://${CHROME_EXTENSION_ID_PRODUCT}/`,
  `chrome-extension://${CHROME_EXTENSION_ID_LEGACY}/`,
  `chrome-extension://${CHROME_EXTENSION_ID_OFFICIAL_CURRENT}/`,
  `chrome-extension://${CHROME_EXTENSION_ID_THIRD}/`,
] as const;

export type BrowserNativeMessagingRoot = { name: string; path: string };
export type BrowserProfileRoot = { name: string; path: string };

export type NativeHostManifest = {
  name: string;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins: string[];
};

/**
 * Official HFA() — primary browsers that receive native host manifests.
 * darwin: Chrome + Edge under Application Support.
 * win32 residual uses userData/ChromeNativeHost shared path (product: not invent registry).
 */
export function primaryNativeMessagingRoots(
  home = os.homedir(),
  platform: NodeJS.Platform = process.platform,
  userDataPath?: string,
): BrowserNativeMessagingRoot[] {
  if (platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    return [
      {
        name: "Chrome",
        path: path.join(base, "Google", "Chrome", "NativeMessagingHosts"),
      },
      {
        name: "Edge",
        path: path.join(base, "Microsoft Edge", "NativeMessagingHosts"),
      },
    ];
  }
  if (platform === "win32") {
    const root =
      userDataPath ??
      (typeof app?.getPath === "function" ? app.getPath("userData") : "");
    if (!root) return [];
    return [{ name: "All", path: path.join(root, "ChromeNativeHost") }];
  }
  return [];
}

/**
 * Official bai() — non-primary darwin browsers: only remove stale manifests (xir).
 */
export function nonPrimaryNativeMessagingRoots(
  home = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): BrowserNativeMessagingRoot[] {
  if (platform !== "darwin") return [];
  const base = path.join(home, "Library", "Application Support");
  return [
    {
      name: "Brave",
      path: path.join(base, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
    },
    {
      name: "Chromium",
      path: path.join(base, "Chromium", "NativeMessagingHosts"),
    },
    {
      name: "Arc",
      path: path.join(base, "Arc", "User Data", "NativeMessagingHosts"),
    },
    {
      name: "Vivaldi",
      path: path.join(base, "Vivaldi", "NativeMessagingHosts"),
    },
    {
      name: "Opera",
      path: path.join(base, "com.operasoftware.Opera", "NativeMessagingHosts"),
    },
  ];
}

/**
 * Official YFA() — browser profile roots for extension install detection / watch.
 */
export function browserProfileRootsForExtensionDetect(
  home = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): BrowserProfileRoot[] {
  if (platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    return [
      { name: "Chrome", path: path.join(base, "Google", "Chrome") },
      { name: "Edge", path: path.join(base, "Microsoft Edge") },
    ];
  }
  if (platform === "win32") {
    const base = path.join(home, "AppData", "Local");
    return [
      { name: "Chrome", path: path.join(base, "Google", "Chrome", "User Data") },
      { name: "Edge", path: path.join(base, "Microsoft", "Edge", "User Data") },
    ];
  }
  return [];
}

/** Official krt manifest JSON shape (pure). */
export function buildNativeHostManifest(hostPath: string): NativeHostManifest {
  return {
    name: NATIVE_HOST_NAME,
    description: "Claude Browser Extension Native Host",
    path: hostPath,
    type: "stdio",
    allowed_origins: [...CHROME_EXTENSION_ALLOWED_ORIGINS],
  };
}

/**
 * Official x1e() packaged residual + product dev fallbacks.
 * Returns absolute path to an executable Chrome can spawn, or null if none.
 */
export function resolveChromeNativeHostBinaryPath(options?: {
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  exePath?: string;
  resourcesPath?: string;
  appPath?: string;
  userDataPath?: string;
}): string | null {
  const platform = options?.platform ?? process.platform;
  const binary =
    platform === "win32" ? `${NATIVE_HOST_BINARY_NAME}.exe` : NATIVE_HOST_BINARY_NAME;
  const isPackaged =
    options?.isPackaged ??
    (typeof app?.isPackaged === "boolean" ? app.isPackaged : false);

  const candidates: string[] = [];

  if (isPackaged) {
    if (platform === "darwin") {
      // Official: dirname(dirname(exe)) / Helpers / chrome-native-host
      // exe = .../Contents/MacOS/App → Contents/Helpers/chrome-native-host
      const exe =
        options?.exePath ??
        (typeof app?.getPath === "function" ? app.getPath("exe") : process.execPath);
      const contents = path.dirname(path.dirname(exe));
      candidates.push(path.join(contents, "Helpers", binary));
    } else {
      const resources =
        options?.resourcesPath ?? process.resourcesPath ?? "";
      if (resources) candidates.push(path.join(resources, binary));
    }
  }

  // Packaged residual may also live next to resources (align script copies Helpers).
  const resources = options?.resourcesPath ?? process.resourcesPath ?? "";
  if (resources) {
    candidates.push(path.join(resources, "..", "Helpers", binary));
    candidates.push(path.join(resources, binary));
  }

  // Dev: electron dist has no Helpers — try official residual app if present (read-only).
  const home = os.homedir();
  candidates.push(
    path.join(
      home,
      "Downloads",
      "Claude code 汉化mac桌面版",
      "Claude-Deepseek.app",
      "Contents",
      "Helpers",
      binary,
    ),
  );

  // Dev product package output (if previously packaged).
  try {
    const appPath = options?.appPath ?? (typeof app?.getAppPath === "function" ? app.getAppPath() : "");
    if (appPath) {
      candidates.push(
        path.join(
          appPath,
          "..",
          "out",
          "Claude-Deepseek-darwin-arm64",
          "Claude-Deepseek.app",
          "Contents",
          "Helpers",
          binary,
        ),
      );
      candidates.push(
        path.join(appPath, "resources", "Helpers", binary),
      );
    }
  } catch {
    /* ignore */
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        const st = fs.statSync(candidate);
        if (st.isFile()) return candidate;
      }
    } catch {
      /* continue */
    }
  }

  // Last resort: ensure a Node launcher under userData (Chrome can exec shell scripts).
  try {
    const userData =
      options?.userDataPath ??
      (typeof app?.getPath === "function" ? app.getPath("userData") : "");
    if (userData) {
      return ensureNodeChromeNativeHostLauncher(userData);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Product residual when Helpers binary is absent: shell launcher →
 * `node -e require('@ant/chrome-native-host').runChromeNativeHost()`.
 * Official uses real Mach-O; this keeps local extension↔socket channel workable in dev.
 */
export function ensureNodeChromeNativeHostLauncher(userDataPath: string): string | null {
  try {
    const dir = path.join(userDataPath, "ChromeNativeHost");
    fs.mkdirSync(dir, { recursive: true });
    const launcher = path.join(dir, NATIVE_HOST_BINARY_NAME);
    const requireFn = createRequire(
      typeof import.meta?.url === "string"
        ? import.meta.url
        : path.join(process.cwd(), "package.json"),
    );
    let hostEntry: string;
    try {
      hostEntry = requireFn.resolve("@ant/chrome-native-host");
    } catch {
      // vendor path fallback
      hostEntry = path.join(
        process.cwd(),
        "vendor",
        "ant",
        "chrome-native-host",
        "index.js",
      );
      if (!fs.existsSync(hostEntry)) return null;
    }
    const nodeBin = process.execPath.includes("Electron")
      ? process.env.npm_node_execpath ||
        (fs.existsSync("/usr/local/bin/node")
          ? "/usr/local/bin/node"
          : fs.existsSync("/opt/homebrew/bin/node")
            ? "/opt/homebrew/bin/node"
            : "node")
      : process.execPath;
    const script = `#!/bin/bash
# Product residual launcher for Claude Browser Extension Native Host
# Official residual: Contents/Helpers/chrome-native-host Mach-O.
set -euo pipefail
export ELECTRON_RUN_AS_NODE=1
exec ${JSON.stringify(nodeBin)} -e ${JSON.stringify(
      `require(${JSON.stringify(hostEntry)}).runChromeNativeHost()`,
    )}
`;
    const existing = fs.existsSync(launcher) ? fs.readFileSync(launcher, "utf8") : "";
    if (existing !== script) {
      fs.writeFileSync(launcher, script, { mode: 0o755 });
    } else {
      try {
        fs.chmodSync(launcher, 0o755);
      } catch {
        /* ignore */
      }
    }
    return launcher;
  } catch {
    return null;
  }
}

export async function browserHasClaudeChromeExtension(
  root: BrowserProfileRoot,
  extensionIds: readonly string[] = CHROME_EXTENSION_IDS_DETECT,
): Promise<boolean> {
  try {
    const entries = await fsPromises.readdir(root.path, { withFileTypes: true });
    const profiles = entries
      .filter(
        (e) =>
          e.isDirectory() &&
          (e.name === "Default" || e.name.startsWith("Profile ")),
      )
      .map((e) => e.name);
    for (const profile of profiles) {
      const profilePath = path.join(root.path, profile);
      if (await profileHasClaudeChromeExtension(profilePath, extensionIds)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Detect packed store install (Extensions/<id>/<ver>/manifest.json),
 * unpacked / developer load (Secure Preferences path → manifest.json),
 * or residual Local Extension Settings/<id> with a resolvable path.
 */
export async function profileHasClaudeChromeExtension(
  profilePath: string,
  extensionIds: readonly string[] = CHROME_EXTENSION_IDS_DETECT,
): Promise<boolean> {
  for (const id of extensionIds) {
    const packed = path.join(profilePath, "Extensions", id);
    if (await extensionFolderHasManifest(packed)) return true;
  }
  // Unpacked / developer: Preferences or Secure Preferences settings[id].path
  for (const fileName of ["Secure Preferences", "Preferences"] as const) {
    const prefsPath = path.join(profilePath, fileName);
    try {
      const raw = await fsPromises.readFile(prefsPath, "utf8");
      const doc = JSON.parse(raw) as {
        extensions?: { settings?: Record<string, unknown> };
      };
      const settings = doc.extensions?.settings;
      if (!settings || typeof settings !== "object") continue;
      for (const id of extensionIds) {
        const entry = settings[id];
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const bag = entry as Record<string, unknown>;
        const installPath = typeof bag.path === "string" ? bag.path : "";
        if (installPath) {
          const manifest = path.isAbsolute(installPath)
            ? path.join(installPath, "manifest.json")
            : path.join(profilePath, installPath, "manifest.json");
          try {
            await fsPromises.access(manifest);
            return true;
          } catch {
            /* continue */
          }
        }
        // Present in settings bag even without path (encrypted residual) —
        // Local Extension Settings confirms storage for this id.
        const les = path.join(profilePath, "Local Extension Settings", id);
        try {
          await fsPromises.access(les);
          return true;
        } catch {
          /* continue */
        }
      }
    } catch {
      /* try next prefs file */
    }
  }
  return false;
}

async function extensionFolderHasManifest(extensionFolder: string): Promise<boolean> {
  try {
    const versions = await fsPromises.readdir(extensionFolder, {
      withFileTypes: true,
    });
    await Promise.any(
      versions
        .filter((e) => e.isDirectory())
        .map((e) =>
          fsPromises.access(path.join(extensionFolder, e.name, "manifest.json")),
        ),
    );
    return true;
  } catch {
    return false;
  }
}

/** Official Y1e(name) */
export async function primaryBrowserHasExtension(
  browserName: string,
  home = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const root = browserProfileRootsForExtensionDetect(home, platform).find(
    (r) => r.name === browserName,
  );
  if (!root) return false;
  return browserHasClaudeChromeExtension(root);
}

/** Official u2A — remove manifest if present. */
export async function removeNativeHostManifest(
  nativeMessagingDir: string,
  browserLabel: string,
  log: (msg: string) => void = () => undefined,
): Promise<void> {
  const file = path.join(nativeMessagingDir, NATIVE_HOST_MANIFEST_FILE);
  try {
    await fsPromises.unlink(file);
    log(
      `[Chrome Extension MCP] Removed native host manifest for ${browserLabel} at ${file}`,
    );
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code !== "ENOENT") {
      log(
        `[Chrome Extension MCP] Could not remove manifest for ${browserLabel}: ${String(error)}`,
      );
    }
  }
}

/** Official krt — write manifest pointing at host binary. */
export async function installNativeHostManifest(
  nativeMessagingDir: string,
  browserLabel: string,
  hostBinaryPath: string,
  log: (msg: string) => void = () => undefined,
): Promise<void> {
  await fsPromises.mkdir(nativeMessagingDir, { recursive: true });
  const manifest = buildNativeHostManifest(hostBinaryPath);
  const file = path.join(nativeMessagingDir, NATIVE_HOST_MANIFEST_FILE);
  await fsPromises.writeFile(file, JSON.stringify(manifest, null, 2), "utf8");
  log(
    `[Chrome Extension MCP] Installed native host manifest for ${browserLabel} at ${file}`,
  );
}

/**
 * Official Oir() (non-win32): for each HFA root, write if Y1e else remove.
 */
export async function syncPrimaryNativeHostManifests(options?: {
  hostBinaryPath?: string | null;
  home?: string;
  platform?: NodeJS.Platform;
  userDataPath?: string;
  log?: (msg: string) => void;
}): Promise<{ wrote: string[]; removed: string[] }> {
  const log = options?.log ?? ((msg) => console.info(msg));
  const home = options?.home ?? os.homedir();
  const platform = options?.platform ?? process.platform;
  const host =
    options?.hostBinaryPath ??
    resolveChromeNativeHostBinaryPath({
      userDataPath: options?.userDataPath,
      platform,
    });
  const wrote: string[] = [];
  const removed: string[] = [];
  for (const root of primaryNativeMessagingRoots(
    home,
    platform,
    options?.userDataPath,
  )) {
    try {
      const hasExt =
        platform === "win32"
          ? // win32 residual: any of Chrome/Edge profile detect
            (
              await Promise.all(
                browserProfileRootsForExtensionDetect(home, platform).map((r) =>
                  browserHasClaudeChromeExtension(r),
                ),
              )
            ).some(Boolean)
          : await primaryBrowserHasExtension(root.name, home, platform);
      if (hasExt) {
        if (!host) {
          log(
            `[Chrome Extension MCP] Extension present for ${root.name} but native host binary missing`,
          );
          continue;
        }
        await installNativeHostManifest(root.path, root.name, host, log);
        wrote.push(root.name);
      } else {
        await removeNativeHostManifest(root.path, root.name, log);
        removed.push(root.name);
      }
    } catch (error) {
      log(
        `[Chrome Extension MCP] Could not sync manifest for ${root.name}: ${String(error)}`,
      );
    }
  }
  return { wrote, removed };
}

/** Official xir() — strip non-primary browser manifests. */
export async function cleanNonPrimaryNativeHostManifests(options?: {
  home?: string;
  platform?: NodeJS.Platform;
  log?: (msg: string) => void;
}): Promise<void> {
  const log = options?.log ?? ((msg) => console.info(msg));
  const home = options?.home ?? os.homedir();
  const platform = options?.platform ?? process.platform;
  for (const root of nonPrimaryNativeMessagingRoots(home, platform)) {
    await removeNativeHostManifest(root.path, root.name, log);
  }
}

/**
 * Official vrt() non-win: xir already separate; Oir sync primary.
 * Product combines clean + sync for Kir order: xir → vrt.
 */
export async function syncChromeNativeHost(options?: {
  hostBinaryPath?: string | null;
  home?: string;
  platform?: NodeJS.Platform;
  userDataPath?: string;
  log?: (msg: string) => void;
}): Promise<{
  hostPath: string | null;
  wrote: string[];
  removed: string[];
}> {
  const log = options?.log ?? ((msg) => console.info(msg));
  const host =
    options?.hostBinaryPath ??
    resolveChromeNativeHostBinaryPath({
      userDataPath: options?.userDataPath,
      platform: options?.platform,
    });
  await cleanNonPrimaryNativeHostManifests({
    home: options?.home,
    platform: options?.platform,
    log,
  });
  const result = await syncPrimaryNativeHostManifests({
    ...options,
    hostBinaryPath: host,
    log,
  });
  log("[Chrome Extension MCP] Native host sync complete");
  return { hostPath: host, ...result };
}

