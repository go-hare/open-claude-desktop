const SHELL_ACCESS_BUNDLE_IDS = /* @__PURE__ */ new Set([
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "com.microsoft.VSCode",
  "dev.warp.Warp-Stable",
  "com.github.wez.wezterm",
  "io.alacritty",
  "net.kovidgoyal.kitty",
  "com.jetbrains.intellij",
  "com.jetbrains.pycharm"
]);
const FILESYSTEM_ACCESS_BUNDLE_IDS = /* @__PURE__ */ new Set(["com.apple.finder"]);
const SYSTEM_SETTINGS_BUNDLE_IDS = /* @__PURE__ */ new Set(["com.apple.systempreferences"]);
const SENTINEL_BUNDLE_IDS = /* @__PURE__ */ new Set([
  ...SHELL_ACCESS_BUNDLE_IDS,
  ...FILESYSTEM_ACCESS_BUNDLE_IDS,
  ...SYSTEM_SETTINGS_BUNDLE_IDS
]);
function getSentinelCategory(bundleId) {
  if (SHELL_ACCESS_BUNDLE_IDS.has(bundleId)) return "shell";
  if (FILESYSTEM_ACCESS_BUNDLE_IDS.has(bundleId)) return "filesystem";
  if (SYSTEM_SETTINGS_BUNDLE_IDS.has(bundleId)) return "system_settings";
  return null;
}
export {
  SENTINEL_BUNDLE_IDS,
  getSentinelCategory
};
