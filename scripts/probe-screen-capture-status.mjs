#!/usr/bin/env node
/**
 * Short-lived Screen Capture probe for product Electron.
 * Does NOT hang: logs status, opens Privacy_ScreenCapture, optional one-shot
 * desktopCapturer (races with 3s timeout), then exits.
 */
import { app, desktopCapturer, systemPreferences, shell } from "electron";

await app.whenReady();

const info = {
  name: app.getName(),
  execPath: process.execPath,
  screenStatus: systemPreferences.getMediaAccessStatus("screen"),
  accessibilityTrusted: systemPreferences.isTrustedAccessibilityClient(false),
};

console.log(JSON.stringify(info, null, 2));
console.log(
  "ADD_THIS_APP:",
  process.execPath.replace(/\/Contents\/MacOS\/.*$/, ""),
);

for (const url of [
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
]) {
  try {
    await shell.openExternal(url);
    console.log("opened", url);
    break;
  } catch (error) {
    console.warn("open failed", url, String(error));
  }
}

// One-shot request so Electron may appear in TCC list. Cap wait so we never hang.
try {
  const sources = await Promise.race([
    desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 1, height: 1 },
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("desktopCapturer timeout 3s")), 3000);
    }),
  ]);
  console.log(
    JSON.stringify({
      capturerSources: Array.isArray(sources) ? sources.length : 0,
      screenStatusAfter: systemPreferences.getMediaAccessStatus("screen"),
    }),
  );
} catch (error) {
  console.warn("desktopCapturer:", String(error));
  console.log(
    JSON.stringify({
      screenStatusAfter: systemPreferences.getMediaAccessStatus("screen"),
    }),
  );
}

app.exit(0);
