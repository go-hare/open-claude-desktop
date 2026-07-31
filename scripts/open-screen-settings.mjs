import { app, systemPreferences, shell } from "electron";
await app.whenReady();
const status = systemPreferences.getMediaAccessStatus("screen");
const ax = systemPreferences.isTrustedAccessibilityClient(false);
console.log(JSON.stringify({ name: app.getName(), screenStatus: status, accessibilityTrusted: ax, execPath: process.execPath }));
// Multiple deep links for different macOS versions
const urls = [
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
];
for (const u of urls) {
  try { await shell.openExternal(u); console.log("opened", u); } catch (e) { console.warn("fail", u, String(e)); }
}
// Also request Accessibility prompt (can show system dialog)
try {
  const ax2 = systemPreferences.isTrustedAccessibilityClient(true);
  console.log("ax prompt result", ax2);
} catch (e) { console.warn("ax prompt", e); }
await new Promise(r => setTimeout(r, 800));
app.exit(0);
