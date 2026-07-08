import type { WebContents } from "electron";
import type { IpcHandlerContext } from "./context";
import { dispatchBridgeEvent } from "./registerIpc";

export class OriginalRendererEventSurface {
  constructor(private readonly context: IpcHandlerContext) {}

  private mainWindow(): WebContents { return this.context.windows.mainWindow.webContents; }
  private mainView(): WebContents { return this.context.windows.mainView.webContents; }

  previewExtensionInstallation(manifest: unknown, sourcePath: string, extensionId: string, signatureInfo: unknown = null): void {
    dispatchBridgeEvent(this.mainWindow(), "claude.settings", "Extensions", "previewExtensionInstallation", manifest, sourcePath, extensionId, signatureInfo);
  }

  extensionDownloadProgress(extensionId: string, progress: number, receivedBytes: number, totalBytes: number, manifest: unknown = null, phase: string | null = null): void {
    dispatchBridgeEvent(this.mainWindow(), "claude.settings", "Extensions", "extensionDownloadProgress", extensionId, progress, receivedBytes, totalBytes, manifest, phase);
  }

  custom3pBootstrapStateUpdated(state: unknown): void {
    dispatchBridgeEvent(this.mainWindow(), "claude.settings", "Custom3pSetup", "bootstrapState_$store$_update", state);
  }

  supportBundleStateUpdated(state: unknown): void {
    dispatchBridgeEvent(this.mainWindow(), "claude.settings", "SupportBundle", "supportBundleState_$store$_update", state);
  }

  updateTitleBar(title: string): void {
    dispatchBridgeEvent(this.mainWindow(), "claude.internal.ui", "MainWindowTitleBar", "updateTitleBar", title);
  }

  showLoadError(details: unknown): void {
    dispatchBridgeEvent(this.mainWindow(), "claude.internal.ui", "MainWindowTitleBar", "showLoadError", details);
  }

  hideLoadError(): void {
    dispatchBridgeEvent(this.mainWindow(), "claude.internal.ui", "MainWindowTitleBar", "hideLoadError");
  }

  simulatorAttachmentUpdated(attachment: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.simulator", "Simulator", "attachment_$store$_update", attachment);
  }

  previewSkillFile(data: unknown, filename: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.skills", "Skills", "previewSkillFile", data, filename);
  }

  officeFileStateChanged(file: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.officeAddin", "OfficeAddinFiles", "onFileStateChanged", file);
  }

  officeFileAdded(file: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.officeAddin", "OfficeAddinFiles", "onFileAdded", file);
  }

  officeFileRemoved(fileId: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.officeAddin", "OfficeAddinFiles", "onFileRemoved", fileId);
  }

  officeAddinNeedsContext(): void {
    dispatchBridgeEvent(this.mainView(), "claude.officeAddin", "OfficeAddinFiles", "onAddinNeedsContext");
  }

  officeConnectedFilesStateUpdated(state: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.officeAddin", "OfficeAddinFiles", "connectedFilesState_$store$_update", state);
  }

  floatingPenguinMiniStateChanged(state: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "FloatingPenguinMini", "onMiniStateChanged", state);
  }

  navigate(routePath: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "Navigation", "navigate", routePath);
  }

  openFileMenu(): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "MenuEvents", "openFile");
  }

  closeWindowMenu(): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "MenuEvents", "closeWindow");
  }

  cuDockStateChanged(isDocked: boolean, holderSessionId: string | null = null): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "WindowState", "cuDockStateChanged", isDocked, holderSessionId);
  }

  showToast(message: string, toastType: string, opts: unknown = null): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "Toast", "showToast", message, toastType, opts);
  }

  autoUpdaterStateUpdated(state: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "AutoUpdater", "updaterState_$store$_update", state);
  }

  findClear(): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "FindInPageProvider", "findClear");
  }

  coworkArtifactsChanged(): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "CoworkArtifacts", "onArtifactsChanged");
  }

  buddyRemoteFeedPermissionDecision(sessionId: string, requestId: string, decision: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "BuddyRemoteFeed", "permissionDecision", sessionId, requestId, decision);
  }

  framebufferSessionResized(sessionId: string, width: number, height: number): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "FramebufferPreview", "sessionResized", sessionId, width, height);
  }

  framebufferSessionFatal(sessionId: string, message: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "FramebufferPreview", "sessionFatal", sessionId, message);
  }

  framebufferOpenSourceRequested(name: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "FramebufferPreview", "openSourceRequested", name);
  }

  localAgentModeDirectMcpServerStatusesChanged(statuses: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "LocalAgentModeSessions", "onDirectMcpServerStatusesChanged", statuses);
  }

  localAgentModeBridgePermissionPreflight(request: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "LocalAgentModeSessions", "onBridgePermissionPreflight", request);
  }

  localAgentModeEvent(event: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "LocalAgentModeSessions", "onEvent", event);
  }

  localAgentModeToolPermissionRequest(request: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "LocalAgentModeSessions", "onToolPermissionRequest", request);
  }

  localAgentModeRemoteSessionStart(request: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "LocalAgentModeSessions", "onRemoteSessionStart", request);
  }

  localAgentModeSessionsBridgeStatusUpdated(state: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "LocalAgentModeSessions", "sessionsBridgeStatus_$store$_update", state);
  }

  localAgentModeInteractiveAuthUpdated(state: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "LocalAgentModeSessions", "interactiveAuth_$store$_update", state);
  }

  coworkSpaceEvent(event: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "CoworkSpaces", "onSpaceEvent", event);
  }

  resourcesFindRequested(): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "Resources", "findRequested");
  }

  grandPrixStatusUpdated(state: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "GrandPrix", "grandPrixStatus_$store$_update", state);
  }

  launchElementSelected(serverId: string, elementContext: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "Launch", "elementSelected", serverId, elementContext);
  }

  launchPreviewUrlChanged(serverId: string, url: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "Launch", "previewUrlChanged", serverId, url);
  }

  launchPreviewSelectionShortcut(serverId: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "Launch", "previewSelectionShortcut", serverId);
  }

  launchDeployEvent(serverId: string, event: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "Launch", "deployEvent", serverId, event);
  }

  launchActiveServersUpdated(servers: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "Launch", "activeServers_$store$_update", servers);
  }

  localSessionEvent(event: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "LocalSessions", "onEvent", event);
  }

  localSessionToolPermissionRequest(request: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "LocalSessions", "onToolPermissionRequest", request);
  }

  localSessionSshPasswordRequired(request: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "LocalSessions", "onSSHPasswordRequired", request);
  }

  localPluginsCliOpAlwaysAllowed(keys: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "LocalPlugins", "onCliOpAlwaysAllowed", keys);
  }

  customPluginsInstallProgress(pluginId: string, message: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "CustomPlugins", "installProgress", pluginId, message);
  }

  coworkRadarUpdated(): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "CoworkRadar", "onRadarUpdated");
  }

  claudeVmDownloadProgress(percent: number): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "ClaudeVM", "downloadProgress", percent);
  }

  claudeVmDownloadStatusChanged(status: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "ClaudeVM", "downloadStatusChanged", status);
  }

  claudeVmRunningStatusChanged(status: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "ClaudeVM", "runningStatusChanged", status);
  }

  claudeVmStartupError(error: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "ClaudeVM", "startupError", error);
  }

  claudeVmApiReachabilityUpdated(state: unknown): void {
    dispatchBridgeEvent(this.mainView(), "claude.web", "ClaudeVM", "apiReachability_$store$_update", state);
  }

  buddyProgress(msg: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.buddy", "Buddy", "progress", msg);
  }

  buddyPairingPrompt(deviceName: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.buddy", "Buddy", "pairingPrompt", deviceName);
  }

  buddyBleTx(line: string): void {
    dispatchBridgeEvent(this.mainView(), "claude.buddy", "BuddyBleTransport", "tx", line);
  }
}

const surfaces = new WeakMap<IpcHandlerContext, OriginalRendererEventSurface>();

export function registerOriginalEventSurface(context: IpcHandlerContext): OriginalRendererEventSurface {
  const surface = new OriginalRendererEventSurface(context);
  surfaces.set(context, surface);
  return surface;
}

export function originalEventSurface(context: IpcHandlerContext): OriginalRendererEventSurface {
  const existing = surfaces.get(context);
  if (existing) return existing;
  return registerOriginalEventSurface(context);
}
