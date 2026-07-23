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

module.exports = {
  packagerConfig: {
    name: "Claude-Deepseek",
    executableName: "Claude-Deepseek",
    appBundleId: "com.local.claude-deepseek.desktop",
    appCategoryType: "public.app-category.productivity",
    asar: true,
    ...(electronZipDir ? { electronZipDir } : {}),
    download: {
      cacheRoot: path.join(root, ".electron-cache"),
    },
    ignore: [
      /^\/\.electron-cache(?:\/|$)/,
      /^\/\.gitignore$/,
      /^\/\.npm-cache(?:\/|$)/,
      /^\/\.smoke-user-data(?:[-\/]|$)/,
      /^\/forge\.config\.cjs$/,
      /^\/forge\.config\.cjs\.bak-/,
      /^\/package\.json\.bak-/,
      /^\/node_modules(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/resources(?:\/|$)/,
      /^\/scripts(?:\/|$)/,
      /^\/electron(?:\/|$)/,
      /^\/shared(?:\/|$)/,
      /^\/package-lock\.json$/,
      /^\/tsconfig\.json$/,
      /^\/vite\..*\.config\.ts$/,
      /^\/README\.md$/,
    ],
    icon: iconPath,
    extraResource,
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
  ],
};
