import { WebContentsView } from "electron";
import type { DesktopWindowOptions } from "./types";

export function createFindInPageView(options: DesktopWindowOptions): WebContentsView {
  const findInPageView = new WebContentsView({
    webPreferences: {
      preload: options.paths.findInPagePreload,
      enableBlinkFeatures: undefined,
    },
  });

  findInPageView.setBackgroundColor("#00000000");
  findInPageView.setVisible(false);
  return findInPageView;
}
