import { app, Notification, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { IpcHandlerContext } from "./context";
import { createFileSystemHandlers } from "./fileSystemHandlers";
import { dispatchBridgeEvent, registerNamespaceHandlers } from "./registerIpc";
import { applyRecentChatsFromWeb } from "../services/settings/quickEntryNative";

const SEARCH_FILE_LIMIT = 500;
const SEARCH_TEXT_BYTES = 512 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "out", "coverage"]);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function notificationStatus(): string {
  return Notification.isSupported() ? "granted" : "denied";
}

function rootsForResources(context: IpcHandlerContext, focusedCwd: string | null): string[] {
  const codeRoots = context.localSessions
    .getAll(true)
    .flatMap((session) => [session.cwd, ...(session.folders ?? []), ...(session.userSelectedFolders ?? [])]);
  const coworkRoots = context.localAgentModeSessions
    .getAll()
    .flatMap((session) => [session.cwd, ...session.userSelectedFolders]);
  const roots = [
    focusedCwd,
    ...codeRoots,
    ...coworkRoots,
    process.cwd(),
  ];
  return [...new Set(roots.filter((item): item is string => Boolean(item)))];
}

function relativeLabel(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
}

async function collectFiles(root: string, limit = SEARCH_FILE_LIMIT, output: string[] = []): Promise<string[]> {
  if (output.length >= limit) return output;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= limit) break;
    if (entry.name.startsWith(".") && entry.name !== ".claude") continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await collectFiles(fullPath, limit, output);
    } else if (entry.isFile()) {
      output.push(fullPath);
    }
  }
  return output;
}

async function projectFiles(context: IpcHandlerContext, focusedCwd: string | null, limit = SEARCH_FILE_LIMIT) {
  const files: Array<{ root: string; path: string }> = [];
  for (const root of rootsForResources(context, focusedCwd)) {
    const stat = await fs.stat(root).catch(() => null);
    if (!stat?.isDirectory()) continue;
    for (const filePath of await collectFiles(root, limit - files.length)) files.push({ root, path: filePath });
    if (files.length >= limit) break;
  }
  return files;
}

async function fetchMentionOptions(context: IpcHandlerContext, focusedCwd: string | null, query: unknown) {
  const needle = String(query ?? "").trim().toLowerCase();
  const files = await projectFiles(context, focusedCwd, 200);
  return files
    .filter((file) => {
      const label = relativeLabel(file.root, file.path);
      return !needle || label.toLowerCase().includes(needle) || path.basename(file.path).toLowerCase().includes(needle);
    })
    .slice(0, 50)
    .map((file) => {
      const relative = relativeLabel(file.root, file.path);
      // Official QC (c11959232): id "file-${absPath}", metadata JSON with relative path.
      return {
        id: `file-${file.path}`,
        label: path.basename(file.path),
        description: relative,
        category: path.basename(file.root) || "Files",
        icon: "file",
        metadata: JSON.stringify({ path: relative, isDirectory: false }),
        providerId: "ccd-files",
        renderedText: relative,
      };
    });
}

async function searchFileContents(context: IpcHandlerContext, focusedCwd: string | null, query: unknown) {
  const needle = String(query ?? "").trim();
  if (!needle) return [];
  const lowerNeedle = needle.toLowerCase();
  const matches: Array<Record<string, unknown>> = [];
  for (const file of await projectFiles(context, focusedCwd, 300)) {
    const stat = await fs.stat(file.path).catch(() => null);
    if (!stat || stat.size > SEARCH_TEXT_BYTES) continue;
    const text = await fs.readFile(file.path, "utf8").catch(() => null);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const column = line.toLowerCase().indexOf(lowerNeedle);
      if (column < 0) continue;
      matches.push({
        path: file.path,
        relativePath: relativeLabel(file.root, file.path),
        line: index + 1,
        column: column + 1,
        preview: line.trim().slice(0, 300),
      });
      if (matches.length >= 100) return matches;
    }
  }
  return matches;
}

export function registerWebMiscHandlers(context: IpcHandlerContext): void {
  const { mainView } = context.windows;
  let focusedCwd: string | null = null;
  let recentChats: unknown[] = [];
  const fileSystemHandlers = createFileSystemHandlers(context);

  registerNamespaceHandlers("claude.web", {
    QuickEntry: {
      /**
       * Official WX residual:
       *   setRecentChats(chats, activeChatId)
       *   chats: AUe[] = { chatId, chatName } (ion-dist maps uuid→chatId, name→chatName)
       *   activeChatId: string | null
       * Forwards into Swift overlay setRecentChats / setActiveChatId (p5t/D5t → w5t/m5t).
       */
      setRecentChats: async (_event, chats, activeChatId) => {
        const normalized = applyRecentChatsFromWeb(chats, activeChatId);
        recentChats = normalized;
        return true;
      },
    },
    Account: {
      setAccountDetails: async (_event, details) => {
        // Official gbA / setAccountDetails → qa store + id() listeners.
        // GrowthBook I9t + oauth Lm identity-diff are subscribed in
        // registerDesktopIpc (BbA id residual), not inlined here.
        context.coworkAccount.setAccountDetails(details);
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
      restartToUpdate: async () => {
        app.relaunch();
        app.exit(0);
        return true;
      },
      restartToUpdateWhenIdle: async () => {
        if (context.localSessions.getAll().length + context.localAgentModeSessions.getAll().length > 0) return { scheduled: true, waitingForSessions: true };
        app.relaunch();
        app.exit(0);
        return { scheduled: false, restarted: true };
      },
      cancelPendingRestart: async () => true,
      getRunningLocalSessionCount: async () => context.localSessions.getAll().length + context.localAgentModeSessions.getAll().length,
    },
    DesktopNotifications: {
      getAuthorizationStatus: async () => notificationStatus(),
      requestAuthorization: async () => notificationStatus(),
      openNotificationSettings: async () => {
        await shell.openExternal("x-apple.systempreferences:com.apple.preference.notifications");
        return true;
      },
      /**
       * Official residual (g6t / nT.showNotification):
       *   showNotification(title, body, id?)
       * Also accept a single options object { title, body, id } for flexibility.
       */
      showNotification: async (_event, titleOrInput, bodyArg?, idArg?) => {
        if (!Notification.isSupported()) return false;
        let title = "Claude";
        let body = "";
        let id: string | null = null;
        if (typeof titleOrInput === "string") {
          title = titleOrInput;
          body = asString(bodyArg) ?? "";
          id = asString(idArg);
        } else {
          const opts = asObject(titleOrInput);
          title = asString(opts.title) ?? "Claude";
          body = asString(opts.body) ?? asString(opts.message) ?? "";
          id = asString(opts.id);
        }
        const notification = new Notification({
          title,
          body,
        });
        notification.on("click", () => {
          dispatchBridgeEvent(mainView.webContents, "claude.web", "DesktopNotifications", "onNotificationClicked", {
            title,
            body,
            id,
            clickedAt: new Date().toISOString(),
          });
        });
        notification.show();
        return true;
      },
    },
    FileSystem: fileSystemHandlers,
    Resources: {
      fetchMentionOptions: async (_event, query) => fetchMentionOptions(context, focusedCwd, query),
      handleMentionSelect: async () => true,
      listProjectFiles: async () => (await projectFiles(context, focusedCwd, 500)).map((file) => file.path),
      searchFileContents: async (_event, query) => searchFileContents(context, focusedCwd, query),
      setFocusedCwd: async (_event, cwd) => {
        focusedCwd = asString(cwd);
        return Boolean(focusedCwd);
      },
      setFindInPageClaimed: async (_event, claimed) => {
        return claimed !== false;
      },
    },
  });
}
