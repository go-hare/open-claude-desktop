#!/usr/bin/env node
/**
 * Trigger macOS Screen Capture permission prompt for this Electron binary.
 * Official Quick Entry window strip needs SCShareableContent / Screen Recording.
 */
import { app, desktopCapturer, systemPreferences, shell } from "electron";

await app.whenReady();

const screenStatus = systemPreferences.getMediaAccessStatus("screen");
const ax = systemPreferences.isTrustedAccessibilityClient(false);
console.log(
  JSON.stringify(
    {
      name: app.getName(),
      execPath: process.execPath,
      screenStatus,
      accessibilityTrusted: ax,
    },
    null,
    2,
  ),
);

// Open privacy pane so user can toggle Electron.
try {
  await shell.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  );
} catch {
  try {
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
    );
  } catch (error) {
    console.warn("open settings failed", error);
  }
}

// desktopCapturer often surfaces the Screen Recording grant UX for Electron.
try {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 150, height: 150 },
    fetchWindowIcons: true,
  });
  console.log(
    JSON.stringify({
      capturerSources: sources.length,
      sample: sources.slice(0, 3).map((s) => ({
        id: s.id,
        name: s.name,
        display_id: s.display_id,
      })),
      screenStatusAfter: systemPreferences.getMediaAccessStatus("screen"),
    }),
  );
} catch (error) {
  console.error("desktopCapturer failed", String(error));
}

// Keep alive briefly so any system dialog can appear.
await new Promise((r) => setTimeout(r, 2500));
app.exit(0);
