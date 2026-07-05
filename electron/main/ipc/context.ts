import type { DesktopWindowParts } from "../windows/types";
import type { LocalSessionStore } from "../services/localSessions/localSessionStore";
import type { ScheduledTaskStore } from "../services/scheduledTasks/scheduledTaskStore";
import type { SettingsStore } from "../services/settings/settingsStore";

export type IpcHandlerContext = {
  windows: DesktopWindowParts;
  localSessions: LocalSessionStore;
  localAgentModeSessions: LocalSessionStore;
  scheduledTasks: ScheduledTaskStore;
  settings: SettingsStore;
};
