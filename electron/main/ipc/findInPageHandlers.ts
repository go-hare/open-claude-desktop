import type { IpcHandlerContext } from "./context";
import { registerNamespaceHandlers } from "./registerIpc";

export function registerFindInPageHandlers(context: IpcHandlerContext): void {
  const { mainView, findInPageView } = context.windows;

  registerNamespaceHandlers("claude.internal.findInPage", {
    FindInPage: {
      findInPage: async (_event, text, options) => {
        if (typeof text !== "string" || text.length === 0) return null;
        findInPageView.setVisible(true);
        return mainView.webContents.findInPage(text, typeof options === "object" && options !== null ? options : undefined);
      },
      stopFindInPage: async (_event, action) => {
        const stopAction = action === "keepSelection" || action === "activateSelection" || action === "clearSelection" ? action : "clearSelection";
        mainView.webContents.stopFindInPage(stopAction);
        return true;
      },
      endFindSession: async () => {
        findInPageView.setVisible(false);
        mainView.webContents.stopFindInPage("clearSelection");
        return true;
      },
    },
  });

  registerNamespaceHandlers("claude.web", {
    FindInPageProvider: {
      reportFindResult: async () => true,
      setProviderActive: async () => true,
    },
  });
}
