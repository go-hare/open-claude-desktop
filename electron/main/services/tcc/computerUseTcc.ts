import { shell, systemPreferences } from "electron";

export type TccGrantState = "granted" | "denied" | "not-determined" | "not-supported";
export type ComputerUseTccState = { accessibility: TccGrantState; screenRecording: TccGrantState };

function mediaStatusToGrant(status: string): TccGrantState {
  if (status === "granted") return "granted";
  if (status === "denied" || status === "restricted") return "denied";
  if (status === "not-determined" || status === "unknown") return "not-determined";
  return "not-supported";
}

export function getComputerUseTccState(): ComputerUseTccState {
  if (process.platform !== "darwin") return { accessibility: "not-supported", screenRecording: "not-supported" };
  const accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "not-determined";
  const screenRecording = mediaStatusToGrant(systemPreferences.getMediaAccessStatus("screen" as never));
  return { accessibility, screenRecording };
}

export async function requestAccessibilityGrant(): Promise<TccGrantState> {
  if (process.platform !== "darwin") return "not-supported";
  return systemPreferences.isTrustedAccessibilityClient(true) ? "granted" : "not-determined";
}

export async function requestScreenRecordingGrant(): Promise<TccGrantState> {
  if (process.platform !== "darwin") return "not-supported";
  const askForMediaAccess = (systemPreferences as unknown as { askForMediaAccess?: (mediaType: string) => Promise<boolean> }).askForMediaAccess;
  if (askForMediaAccess) {
    try {
      if (await askForMediaAccess.call(systemPreferences, "screen")) return "granted";
    } catch {
      // Electron/macOS can refuse programmatic screen-recording prompts; fall through to Settings.
    }
  }
  const current = getComputerUseTccState().screenRecording;
  if (current === "granted" || current === "denied") return current;
  await openTccSystemSettings("Privacy_ScreenCapture");
  return getComputerUseTccState().screenRecording;
}

export async function openTccSystemSettings(pane = "Privacy_Accessibility"): Promise<boolean> {
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
  return true;
}
