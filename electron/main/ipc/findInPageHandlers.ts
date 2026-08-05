import type { IpcHandlerContext } from "./context";
import { registerNamespaceHandlers } from "./registerIpc";
import {
  getFindInPageProviderState,
  reportFindResult,
  setFindProviderActive,
} from "../services/findInPage/findInPageProviderState";

export function registerFindInPageHandlers(context: IpcHandlerContext): void {
  const { mainView, findInPageView } = context.windows;
  const providerState = getFindInPageProviderState(mainView.webContents);

  registerNamespaceHandlers("claude.internal.findInPage", {
    FindInPage: {
      findInPage: async (_event, text, options) => {
        if (typeof text !== "string" || text.length === 0) return null;
        findInPageView.setVisible(true);
        return mainView.webContents.findInPage(
          text,
          typeof options === "object" && options !== null ? options : undefined,
        );
      },
      stopFindInPage: async (_event, action) => {
        const stopAction =
          action === "keepSelection" ||
          action === "activateSelection" ||
          action === "clearSelection"
            ? action
            : "clearSelection";
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

  /**
   * Official FindInPageProvider residual (ecr):
   *   setProviderActive → stopFind clearSelection + active flag + clear pending
   *   reportFindResult → resolve pending requestId map
   */
  registerNamespaceHandlers("claude.web", {
    FindInPageProvider: {
      reportFindResult: async (_event, requestId, result) => {
        if (typeof requestId !== "number") return;
        reportFindResult(providerState, requestId, result);
      },
      setProviderActive: async (_event, active) => {
        setFindProviderActive(providerState, active === true, () => {
          if (!mainView.webContents.isDestroyed()) {
            mainView.webContents.stopFindInPage("clearSelection");
          }
        });
      },
    },
  });
}
