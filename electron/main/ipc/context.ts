import type { DesktopWindowParts } from "../windows/types";
import type { CoworkAccountContext } from "../services/coworkAccount/coworkAccountContext";
import type { CoworkSessionManager } from "../services/coworkSessions/coworkSessionManager";
import type { LocalSessionStore } from "../services/localSessions/localSessionStore";
import type { ScheduledTaskStore } from "../services/scheduledTasks/scheduledTaskStore";
import type { SettingsStore } from "../services/settings/settingsStore";

export type IpcHandlerContext = {
  windows: DesktopWindowParts;
  coworkAccount: CoworkAccountContext;
  localSessions: LocalSessionStore;
  localAgentModeSessions: CoworkSessionManager;
  scheduledTasks: ScheduledTaskStore;
  settings: SettingsStore;
};
