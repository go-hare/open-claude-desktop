import type { DesktopWindowParts } from "../windows/types";
import { dispatchBridgeEvent } from "../ipc/registerIpc";
import { handleClaudeDeepLink } from "./claudeUrlHandler";
import type { LaunchTarget } from "./deepLinks";

export function dispatchLaunchTarget(windows: DesktopWindowParts | null | undefined, target: LaunchTarget): void {
  if (!windows || windows.mainView.webContents.isDestroyed()) return;
  const webContents = windows.mainView.webContents;

  if (target.deepLink) {
    // Official Z8 first: MagicLink fully handled in-process — do not also bridge.
    const result = handleClaudeDeepLink(target.deepLink, webContents);
    if (!result.handled) {
      dispatchBridgeEvent(webContents, "claude.web", "DeepLink", "handleDeepLink", target.deepLink);
    }
  }

  if (target.filePaths.length > 0) {
    dispatchBridgeEvent(webContents, "claude.web", "LocalAgentModeSessions", "onCoworkFromMain", {
      selectedFiles: target.filePaths,
      source: "desktop-launch",
    });
  }

  if (target.extensionPath) {
    dispatchBridgeEvent(webContents, "claude.web", "LocalAgentModeSessions", "onCoworkFromMain", {
      selectedFiles: [target.extensionPath],
      source: "desktop-extension-package",
    });
  }
}
