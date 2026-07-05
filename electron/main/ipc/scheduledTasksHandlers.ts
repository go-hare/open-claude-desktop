import type { IpcHandlerContext } from "./context";
import type { InterfaceHandlers } from "./registerIpc";
import { dispatchBridgeEvent, registerInterfaceHandlers } from "./registerIpc";

function createScheduledHandlers(context: IpcHandlerContext): InterfaceHandlers {
  const store = context.scheduledTasks;
  return {
    getAllScheduledTasks: async () => store.getAllScheduledTasks(),
    getScheduledTaskFileContent: async (_event, id) => (typeof id === "string" ? store.getScheduledTaskFileContent(id) : ""),
    updateScheduledTaskFileContent: async (_event, id, content) => (typeof id === "string" && typeof content === "string" ? store.updateScheduledTaskFileContent(id, content) : false),
    updateScheduledTaskStatus: async (_event, id, status) => {
      if (typeof id !== "string" || (status !== "enabled" && status !== "disabled" && status !== "deleted")) return false;
      const result = store.updateScheduledTaskStatus(id, status);
      dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", "CCDScheduledTasks", "onScheduledTaskEvent", { id, status });
      return result;
    },
    updateScheduledTask: async (_event, id, input) => (typeof id === "string" && typeof input === "object" && input !== null ? store.updateScheduledTask(id, input as never) : null),
    createScheduledTask: async (_event, input) => {
      const task = store.createScheduledTask(typeof input === "object" && input !== null ? input as never : {});
      dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", "CCDScheduledTasks", "onScheduledTaskEvent", { id: task.id, status: "created" });
      return task;
    },
    removeApprovedPermission: async (_event, id, toolName) => (typeof id === "string" && typeof toolName === "string" ? store.removeApprovedPermission(id, toolName) : false),
    onScheduledTaskEvent: async () => null,
    clearChromePermissions: async () => true,
  };
}

export function registerScheduledTasksHandlers(context: IpcHandlerContext): void {
  const handlers = createScheduledHandlers(context);
  registerInterfaceHandlers("claude.web", "CCDScheduledTasks", handlers);
  registerInterfaceHandlers("claude.web", "CoworkScheduledTasks", handlers);
}
