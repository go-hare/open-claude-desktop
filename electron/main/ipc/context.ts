import type { DesktopWindowParts } from "../windows/types";
import type { CoworkAccountContext } from "../services/coworkAccount/coworkAccountContext";
import type { CoworkSessionManager } from "../services/coworkSessions/coworkSessionManager";
import type { LocalSessionStore } from "../services/localSessions/localSessionStore";
import type { ScheduledTaskStore } from "../services/scheduledTasks/scheduledTaskStore";
import type { SettingsStore } from "../services/settings/settingsStore";
import type { WindowStateKeeper } from "../lifecycle/windowState";

export type IpcHandlerContext = {
  windows: DesktopWindowParts;
  coworkAccount: CoworkAccountContext;
  localSessions: LocalSessionStore;
  localAgentModeSessions: CoworkSessionManager;
  scheduledTasks: ScheduledTaskStore;
  settings: SettingsStore;
  /**
   * Official n5 / OOe residual — window-state keeper for F1t resetMainWindowBounds
   * (unmanage + unlink window-state.json before got("1p") relaunch).
   */
  windowState?: WindowStateKeeper;
};
