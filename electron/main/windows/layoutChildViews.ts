import type { BrowserWindow, WebContentsView } from "electron";
import { getFindInPageBounds } from "./findInPageBounds";

export function layoutMainView(mainWindow: BrowserWindow, mainView: WebContentsView): void {
  if (mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getContentBounds();
  mainView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
}

export function layoutFindInPageView(mainWindow: BrowserWindow, findInPageView: WebContentsView): void {
  if (mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getContentBounds();
  findInPageView.setBounds(getFindInPageBounds(bounds.width));
}

export function layoutDesktopViews(
  mainWindow: BrowserWindow,
  mainView: WebContentsView,
  findInPageView: WebContentsView,
): void {
  layoutMainView(mainWindow, mainView);
  layoutFindInPageView(mainWindow, findInPageView);
}
