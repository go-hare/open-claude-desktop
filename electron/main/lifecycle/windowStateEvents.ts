import type { BrowserWindow, WebContentsView } from "electron";
import { dispatchBridgeEvent } from "../ipc/registerIpc";

export type WindowStateEventTargets = {
  mainWindow: BrowserWindow;
  mainView: WebContentsView;
};

export function installWindowStateEventDispatch(targets: WindowStateEventTargets): void {
  const { mainWindow, mainView } = targets;
  const webContents = mainView.webContents;

  const dispatchFullscreen = () => {
    dispatchBridgeEvent(webContents, "claude.web", "WindowState", "fullscreenChanged", mainWindow.isFullScreen());
  };
  const dispatchVisibility = () => {
    dispatchBridgeEvent(webContents, "claude.web", "WindowState", "visibilityChanged", mainWindow.isVisible());
  };
  const dispatchZoom = () => {
    dispatchBridgeEvent(webContents, "claude.web", "WindowState", "zoomFactorChanged", webContents.getZoomFactor());
  };

  mainWindow.on("enter-full-screen", dispatchFullscreen);
  mainWindow.on("leave-full-screen", dispatchFullscreen);
  mainWindow.on("show", dispatchVisibility);
  mainWindow.on("hide", dispatchVisibility);
  mainWindow.on("minimize", dispatchVisibility);
  mainWindow.on("restore", dispatchVisibility);
  webContents.on("zoom-changed", dispatchZoom);
}
