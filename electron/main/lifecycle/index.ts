export { extractLaunchTarget, isClaudeDeepLink, isDesktopExtensionPackage } from "./deepLinks";
export { installDesktopAppLifecycle } from "./appLifecycle";
export { createQuitState, installQuitState } from "./quitState";
export { installSingleInstanceGuard, restoreMainWindow } from "./singleInstance";
export { dispatchLaunchTarget } from "./launchDispatch";
export {
  handleClaudeDeepLink,
  queuePendingClaudeOpenUrl,
  takePendingClaudeOpenUrl,
  resetClaudeUrlHandlerForTests,
} from "./claudeUrlHandler";
export { claimClaudeProtocolClients } from "./protocolClient";
export { createWindowStateKeeper, defaultWindowState, hasValidWindowBounds, isWindowInsideDisplay, normalizeWindowState } from "./windowState";
export { installWindowStateEventDispatch } from "./windowStateEvents";
export type { LaunchTarget } from "./deepLinks";
export type { DesktopLifecycleOptions } from "./appLifecycle";
export type { QuitState } from "./quitState";
export type { SingleInstanceOptions } from "./singleInstance";
export type { DesktopWindowState, WindowStateKeeper, WindowStateKeeperOptions } from "./windowState";
export type { ClaudeUrlHandleResult } from "./claudeUrlHandler";
