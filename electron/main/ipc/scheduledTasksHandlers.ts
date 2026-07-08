import type { ScheduledTask } from "../services/scheduledTasks/scheduledTaskStore";
import type { IpcHandlerContext } from "./context";
import { dispatchLocalSessionEvent, getLocalSessionRunner } from "./localSessionRunner";
import type { InterfaceHandlers } from "./registerIpc";
import { dispatchBridgeEvent, registerInterfaceHandlers } from "./registerIpc";

let scheduledTaskPumpStarted = false;

function dispatchScheduledTaskEvent(context: IpcHandlerContext, payload: Record<string, unknown>): void {
  dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", "CCDScheduledTasks", "onScheduledTaskEvent", payload);
  dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", "CoworkScheduledTasks", "onScheduledTaskEvent", payload);
}

export function runScheduledTaskNow(context: IpcHandlerContext, task: ScheduledTask, source = "manual"): unknown {
  const folders = task.userSelectedFolders ?? (task.cwd ? [task.cwd] : []);
  const session = context.localSessions.start({
    kind: "code",
    title: task.title,
    prompt: task.prompt,
    cwd: task.cwd,
    folders,
    userSelectedFolders: folders,
    model: task.model,
    permissionMode: task.permissionMode,
    scheduledTaskId: task.id,
    origin: "scheduled",
  });
  const updatedTask = context.scheduledTasks.recordRun(task.id) ?? task;
  dispatchLocalSessionEvent(context, { type: "start", sessionId: session.id, session });
  const prompt = task.prompt?.trim();
  if (prompt) {
    getLocalSessionRunner(context).runTurn(session.id, prompt, {
      model: task.model,
      permissionMode: task.permissionMode,
      scheduledTaskId: task.id,
      origin: "scheduled",
    });
  }
  dispatchLocalSessionEvent(context, {
    type: "scheduled_task_run",
    sessionId: session.id,
    scheduledTaskId: task.id,
    session,
  });
  dispatchScheduledTaskEvent(context, { id: task.id, status: "ran", source, sessionId: session.id, task: updatedTask });
  return session;
}

function startScheduledTaskPump(context: IpcHandlerContext): void {
  if (scheduledTaskPumpStarted) return;
  scheduledTaskPumpStarted = true;
  const tick = () => {
    for (const task of context.scheduledTasks.getDueScheduledTasks()) {
      runScheduledTaskNow(context, task, "schedule");
    }
  };
  const interval = setInterval(tick, 60_000);
  interval.unref?.();
  const startup = setTimeout(tick, 5_000);
  startup.unref?.();
}

function createCcdScheduledHandlers(context: IpcHandlerContext): InterfaceHandlers {
  const store = context.scheduledTasks;
  return {
    getAllScheduledTasks: async () => store.getAllScheduledTasks(),
    getScheduledTaskFileContent: async (_event, id) => (typeof id === "string" ? store.getScheduledTaskFileContent(id) : ""),
    updateScheduledTaskFileContent: async (_event, id, content) => (typeof id === "string" && typeof content === "string" ? store.updateScheduledTaskFileContent(id, content) : false),
    updateScheduledTaskStatus: async (_event, id, status) => {
      if (typeof id !== "string" || (status !== "enabled" && status !== "disabled" && status !== "deleted")) return false;
      const result = store.updateScheduledTaskStatus(id, status);
      dispatchScheduledTaskEvent(context, { id, status });
      return result;
    },
    updateScheduledTask: async (_event, id, input) => (typeof id === "string" && typeof input === "object" && input !== null ? store.updateScheduledTask(id, input as never) : null),
    createScheduledTask: async (_event, input) => {
      const task = store.createScheduledTask(typeof input === "object" && input !== null ? input as never : {});
      dispatchScheduledTaskEvent(context, { id: task.id, status: "created", task });
      return task;
    },
    removeApprovedPermission: async (_event, id, toolName) => (typeof id === "string" && typeof toolName === "string" ? store.removeApprovedPermission(id, toolName) : false),
  };
}

function createCoworkScheduledHandlers(context: IpcHandlerContext): InterfaceHandlers {
  const store = context.scheduledTasks;
  return {
    getAllScheduledTasks: async () => store.getAllScheduledTasks(),
    getScheduledTaskFileContent: async (_event, id) => (typeof id === "string" ? store.getScheduledTaskFileContent(id) : ""),
    updateScheduledTaskFileContent: async (_event, id, content) => (typeof id === "string" && typeof content === "string" ? store.updateScheduledTaskFileContent(id, content) : false),
    updateScheduledTaskStatus: async (_event, id, status) => {
      if (typeof id !== "string" || (status !== "enabled" && status !== "disabled" && status !== "deleted")) return false;
      const result = store.updateScheduledTaskStatus(id, status);
      dispatchScheduledTaskEvent(context, { id, status });
      return result;
    },
    updateScheduledTask: async (_event, id, input) => (typeof id === "string" && typeof input === "object" && input !== null ? store.updateScheduledTask(id, input as never) : null),
    createScheduledTask: async (_event, input) => {
      const task = store.createScheduledTask(typeof input === "object" && input !== null ? input as never : {});
      dispatchScheduledTaskEvent(context, { id: task.id, status: "created", task });
      return task;
    },
    removeApprovedPermission: async (_event, id, toolName) => (typeof id === "string" && typeof toolName === "string" ? store.removeApprovedPermission(id, toolName) : false),
    clearChromePermissions: async () => true,
  };
}

export function registerScheduledTasksHandlers(context: IpcHandlerContext): void {
  registerInterfaceHandlers("claude.web", "CCDScheduledTasks", createCcdScheduledHandlers(context));
  registerInterfaceHandlers("claude.web", "CoworkScheduledTasks", createCoworkScheduledHandlers(context));
  startScheduledTaskPump(context);
}
