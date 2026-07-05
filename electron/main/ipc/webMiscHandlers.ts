import { Notification, shell } from "electron";
import type { IpcHandlerContext } from "./context";
import { createFileSystemHandlers } from "./fileSystemHandlers";
import { dispatchBridgeEvent, registerNamespaceHandlers } from "./registerIpc";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function notificationStatus(): string {
  return Notification.isSupported() ? "granted" : "denied";
}

export function registerWebMiscHandlers(context: IpcHandlerContext): void {
  const { mainWindow, mainView } = context.windows;
  let focusedCwd: string | null = null;
  let recentChats: unknown[] = [];
  let accountDetails: unknown = null;
  const fileSystemHandlers = createFileSystemHandlers(context);

  registerNamespaceHandlers("claude.web", {
    Toast: {
      showToast: async (_event, input) => {
        const opts = asObject(input);
        const title = asString(opts.title) ?? "Claude-Deepseek";
        const body = asString(opts.body) ?? asString(opts.message) ?? "";
        if (Notification.isSupported()) new Notification({ title, body }).show();
        return true;
      },
    },
    Navigation: {
      navigate: async (_event, target) => {
        const url = asString(target) ?? asString(asObject(target).url);
        if (!url) return false;
        if (url.startsWith("app://") || url.startsWith("http://") || url.startsWith("https://")) await mainView.webContents.loadURL(url);
        return true;
      },
    },
    MenuEvents: {
      closeWindow: async () => {
        mainWindow.close();
        return true;
      },
      openFile: async (_event, filePath) => {
        const target = asString(filePath);
        if (!target) return false;
        return (await shell.openPath(target)).length === 0;
      },
    },
    QuickEntry: {
      setRecentChats: async (_event, chats) => {
        recentChats = Array.isArray(chats) ? chats : [];
        return true;
      },
      onQuickEntrySubmit: async () => ({ recentChats }),
    },
    Account: {
      setAccountDetails: async (_event, details) => {
        accountDetails = details;
        return true;
      },
    },
    Auth: {
      doAuthInBrowser: async (_event, url) => {
        const target = asString(url) ?? asString(asObject(url).url);
        if (!target) return false;
        await shell.openExternal(target);
        return true;
      },
    },
    AutoUpdater: {
      checkForUpdates: async () => ({ updateAvailable: false, reason: "third_party_shell" }),
      restartToUpdate: async () => false,
      restartToUpdateWhenIdle: async () => false,
      cancelPendingRestart: async () => true,
      getRunningLocalSessionCount: async () => context.localSessions.getAll().length + context.localAgentModeSessions.getAll().length,
      updaterState_: async () => ({ status: "disabled", updateAvailable: false }),
    },
    DesktopNotifications: {
      getAuthorizationStatus: async () => notificationStatus(),
      requestAuthorization: async () => notificationStatus(),
      openNotificationSettings: async () => {
        await shell.openExternal("x-apple.systempreferences:com.apple.preference.notifications");
        return true;
      },
      showNotification: async (_event, input) => {
        if (!Notification.isSupported()) return false;
        const opts = asObject(input);
        const notification = new Notification({
          title: asString(opts.title) ?? "Claude-Deepseek",
          body: asString(opts.body) ?? asString(opts.message) ?? "",
        });
        notification.on("click", () => dispatchBridgeEvent(mainView.webContents, "claude.web", "DesktopNotifications", "onNotificationClicked", input));
        notification.show();
        return true;
      },
      onNotificationClicked: async () => null,
    },
    FileSystem: fileSystemHandlers,
    Resources: {
      fetchMentionOptions: async () => [],
      handleMentionSelect: async () => true,
      listProjectFiles: async () => (focusedCwd && fileSystemHandlers.listFilesInFolder ? fileSystemHandlers.listFilesInFolder({} as never, focusedCwd, { recursive: false }) : []),
      searchFileContents: async () => [],
      setFocusedCwd: async (_event, cwd) => {
        focusedCwd = asString(cwd);
        return Boolean(focusedCwd);
      },
      setFindInPageClaimed: async () => true,
      findRequested: async () => null,
    },
  });
}
