import { LocalSessionStore } from "../services/localSessions/localSessionStore";
import { ScheduledTaskStore } from "../services/scheduledTasks/scheduledTaskStore";
import { SettingsStore } from "../services/settings/settingsStore";
import type { DesktopWindowParts } from "../windows/types";
import type { IpcHandlerContext } from "./context";
import { registerAppBindingsHandlers } from "./appBindingsHandlers";
import { registerFeatureHandlers } from "./featureHandlers";
import { registerFindInPageHandlers } from "./findInPageHandlers";
import { registerLocalSessionsHandlers } from "./localSessionsHandlers";
import { registerScheduledTasksHandlers } from "./scheduledTasksHandlers";
import { registerSettingsHandlers } from "./settingsHandlers";
import { registerStoreStateHandlers } from "./storeStateHandlers";
import { registerWebMiscHandlers } from "./webMiscHandlers";
import { registerWindowHandlers } from "./windowHandlers";

export function createDefaultIpcContext(windows: DesktopWindowParts): IpcHandlerContext {
  return {
    windows,
    localSessions: new LocalSessionStore("code"),
    localAgentModeSessions: new LocalSessionStore("epitaxy"),
    scheduledTasks: new ScheduledTaskStore(),
    settings: new SettingsStore(),
  };
}

export function registerDesktopIpc(context: IpcHandlerContext): void {
  registerWindowHandlers(context);
  registerAppBindingsHandlers(context);
  registerFindInPageHandlers(context);
  registerLocalSessionsHandlers(context);
  registerScheduledTasksHandlers(context);
  registerSettingsHandlers(context);
  registerStoreStateHandlers(context);
  registerWebMiscHandlers(context);
  registerFeatureHandlers(context);
}
