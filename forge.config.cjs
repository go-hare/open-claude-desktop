const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const resourcesDir = path.join(root, "resources");
const iconPath = path.join(resourcesDir, "electron");
const ionDistRoot = path.join(resourcesDir, "ion-dist");
const originalRuntimeRoot = path.join(resourcesDir, "original-runtime-node_modules");
const claudeCodeBinRoot = path.join(resourcesDir, "claude-code-bin");
const extraResource = [];
const electronVersion = require("electron/package.json").version;
const packagePlatform = process.env.CLAUDE_PACKAGE_PLATFORM || process.platform;
const packageArch = process.env.CLAUDE_PACKAGE_ARCH || process.arch;

// Residual document / URL types (official Info.plist — product identity stays Claudex).
const residualDocumentTypes = [
  {
    CFBundleTypeName: "Desktop Extension",
    CFBundleTypeExtensions: ["dxt", "mcpb"],
    CFBundleTypeRole: "Viewer",
  },
  {
    CFBundleTypeName: "Skill File",
    CFBundleTypeExtensions: ["skill"],
    CFBundleTypeRole: "Viewer",
  },
  {
    CFBundleTypeName: "Folder",
    CFBundleTypeRole: "Editor",
    LSItemContentTypes: ["public.folder"],
  },
  {
    CFBundleTypeName: "All Files",
    CFBundleTypeRole: "Viewer",
    LSItemContentTypes: ["public.data"],
  },
];
const residualUrlTypes = [
  {
    CFBundleURLName: "Claude",
    CFBundleURLSchemes: ["claude"],
  },
];
const electronZipName = `electron-v${electronVersion}-${packagePlatform}-${packageArch}.zip`;
const electronZipDir = (() => {
  const cacheRoot = path.join(root, ".electron-cache");
  const localZip = path.join(cacheRoot, "local", electronZipName);
  if (fs.existsSync(localZip)) return path.dirname(localZip);
  if (!fs.existsSync(cacheRoot)) return undefined;
  for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(cacheRoot, entry.name, electronZipName);
    if (fs.existsSync(candidate)) return path.dirname(candidate);
  }
  return undefined;
})();

if (fs.existsSync(ionDistRoot)) {
  extraResource.push(ionDistRoot);
}
// Product open-claude-web build for app:// primary SPA (packaged dual-root).
// Residual ion-dist (above) stays official spa for setup-desktop-3p; align must
// keep both trees and must NOT overwrite ion-dist with product-web.
const productWebRoot = path.join(resourcesDir, "product-web");
if (fs.existsSync(path.join(productWebRoot, "index.html"))) {
  extraResource.push(productWebRoot);
}
if (fs.existsSync(originalRuntimeRoot)) {
  extraResource.push(originalRuntimeRoot);
}
if (fs.existsSync(claudeCodeBinRoot)) {
  extraResource.push(claudeCodeBinRoot);
}

// Official Hot() tray assets (TrayIconTemplate*.png / Tray-Win32*.ico) must sit in
// Contents/Resources so nativeImage.createFromPath(resourcesPath + icon) works.
for (const trayAsset of [
  "TrayIconTemplate.png",
  "TrayIconTemplate@2x.png",
  "TrayIconTemplate@3x.png",
  "TrayIconTemplate-Dark.png",
  "TrayIconTemplate-Dark@2x.png",
  "TrayIconTemplate-Dark@3x.png",
  "Tray-Win32.ico",
  "Tray-Win32-Dark.ico",
]) {
  const trayPath = path.join(resourcesDir, trayAsset);
  if (fs.existsSync(trayPath)) extraResource.push(trayPath);
}

// Official Swift FontLoader residual: Contents/Resources/fonts/Anthropic*.ttf
// (native Quick Entry overlay). Pack as directory when present.
const fontsDir = path.join(resourcesDir, "fonts");
if (fs.existsSync(fontsDir)) {
  extraResource.push(fontsDir);
}

// Official Swift Quick Entry share residual assets (QuickScreenshotView strip icons + Assets.car).
// Align package also copies them from official Resources; forge must ship them for non-align paths.
for (const screenAsset of [
  "claude-screen.png",
  "claude-screen-dark.png",
  "Assets.car",
]) {
  const screenPath = path.join(resourcesDir, screenAsset);
  if (fs.existsSync(screenPath)) extraResource.push(screenPath);
}

// Residual-extracted PNG for Electron dock.setIcon. Chromium nativeImage cannot
// decode official electron.icns (ic07-only → empty); LaunchServices still uses icns.
const electronAppIconPng = path.join(resourcesDir, "electron-app-icon.png");
if (fs.existsSync(electronAppIconPng)) {
  extraResource.push(electronAppIconPng);
}

// Official Swift Quick Entry i18n residual: Contents/Resources/*.lproj/Localizable.strings
// Share/screenshot strip ("Quickly share content with Claude", "Send a screenshot of ", …).
const swiftLprojRoot = path.join(resourcesDir, "swift-lproj");
if (fs.existsSync(swiftLprojRoot)) {
  for (const name of fs.readdirSync(swiftLprojRoot)) {
    if (!name.endsWith(".lproj")) continue;
    const lprojPath = path.join(swiftLprojRoot, name);
    if (fs.statSync(lprojPath).isDirectory()) {
      extraResource.push(lprojPath);
    }
  }
}

// Cowork dual-exec residual images (host-loop default does not require them at runtime).
for (const smol of ["smol-bin.arm64.img", "smol-bin.x64.img"]) {
  const smolPath = path.join(resourcesDir, smol);
  if (fs.existsSync(smolPath)) extraResource.push(smolPath);
}

// Official Resources/*.json locale bags (not Swift .lproj).
// Flat files under Resources/ (not a locale-json/ subfolder).
const localeJsonRoot = path.join(resourcesDir, "locale-json");
if (fs.existsSync(localeJsonRoot)) {
  for (const name of fs.readdirSync(localeJsonRoot)) {
    if (!name.endsWith(".json")) continue;
    extraResource.push(path.join(localeJsonRoot, name));
  }
}

// Product Helpers binaries (chrome-native-host / disclaimer).
// Forge places directory at Resources/Helpers; align lifts to Contents/Helpers.
// Source is OUR resources/Helpers only — never original-claude.app at package time.
const helpersRoot = path.join(resourcesDir, "Helpers");
if (fs.existsSync(path.join(helpersRoot, "chrome-native-host"))) {
  extraResource.push(helpersRoot);
}

module.exports = {
  packagerConfig: {
    name: "Claudex",
    executableName: "Claudex",
    appBundleId: "com.local.claudex.desktop",
    // Official residual category.
    appCategoryType: "public.app-category.developer-tools",
    // Official residual deep link.
    protocols: [
      {
        name: "Claude",
        schemes: ["claude"],
      },
    ],
    // Official Claude Desktop Info.plist residual for voice dictation (Swift
    // LiveSpeechRecognizer + ClaudeAiSpeechSession). Without speech key, macOS
    // refuses SFSpeech authorization and dictation never opens the mic.
    // Document types / URL types / ATS match official residual (product Bundle ID separate).
    extendInfo: {
      CFBundleIconFile: "electron.icns",
      CFBundleIconName: "Claude",
      CFBundleDocumentTypes: residualDocumentTypes,
      CFBundleURLTypes: residualUrlTypes,
      NSMicrophoneUsageDescription:
        "Claude needs access to your microphone for voice dictation.",
      NSSpeechRecognitionUsageDescription:
        "Claude needs access to speech recognition for voice dictation.",
      NSAudioCaptureUsageDescription: "This app needs access to audio capture",
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: true,
      },
      LSEnvironment: {
        MallocNanoZone: "0",
      },
      NSSupportsAutomaticGraphicsSwitching: true,
    },
    asar: true,
    ...(electronZipDir ? { electronZipDir } : {}),
    download: {
      cacheRoot: path.join(root, ".electron-cache"),
    },
    // Allowlist only — workspace pollution (.dev-user-data, smoke trees, docs,
    // vendor, tmp-*.png, residual root index.js, …) must never enter app.asar.
    // Product entry is package.json "main": ".vite/build/index.pre.js".
    // Runtime natives are re-injected by align:bundle from
    // resources/original-runtime-node_modules (mac: into asar; win: asar + keep
    // extraResource tree for originalRuntimeModules candidates).
    //
    // electron-packager ignore(file): return true ⇒ exclude.
    // file is relative to app dir with leading slash (POSIX even on win).
    ignore: (file) => {
      const rel = String(file || "").replace(/\\/g, "/");
      if (rel === "" || rel === "/") return false;
      if (rel === "/package.json") return false;
      // Do NOT pack workspace root index.js — it is a ~12MB residual official
      // shell dump (not product main). Product main lives under /.vite/build/.
      if (rel === "/.vite" || rel.startsWith("/.vite/")) return false;
      return true;
    },
    icon: iconPath,
    extraResource,
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "win32"],
    },
  ],
};
