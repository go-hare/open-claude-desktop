import { FeatureStateStore } from "../services/featureState/featureStateStore";
import {
  resolveScheduledTaskChannel,
  type ScheduledTask,
  type ScheduledTaskChannel,
} from "../services/scheduledTasks/scheduledTaskStore";
import { resolveScheduledTaskRunMessage } from "../services/scheduledTasks/scheduledTaskPromptWrap";
import type { IpcHandlerContext } from "./context";
import { dispatchLocalSessionEvent, getLocalSessionRunner } from "./localSessionRunner";
import type { InterfaceHandlers } from "./registerIpc";
import { dispatchBridgeEvent, registerInterfaceHandlers } from "./registerIpc";

let scheduledTaskPumpStarted = false;

function dispatchScheduledTaskEvent(
  context: IpcHandlerContext,
  payload: Record<string, unknown>,
  channel?: ScheduledTaskChannel,
): void {
  // Residual: CCD events feed Code list; Cowork events feed CYt. Broadcast both only when unknown.
  if (!channel || channel === "code") {
    dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", "CCDScheduledTasks", "onScheduledTaskEvent", payload);
  }
  if (!channel || channel === "cowork") {
    dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", "CoworkScheduledTasks", "onScheduledTaskEvent", payload);
  }
}

/**
 * Residual scheduled run + iKt: effective folders = task.userSelectedFolders ∪ space.folders.
 * Space folders are granted by project link (spaceId); extra dirs live only on the task.
 */
function spaceFolderPathsForTask(spaceId: string | undefined): string[] {
  if (!spaceId) return [];
  try {
    const spaces = new FeatureStateStore().loadMap<Record<string, unknown>>("spaces");
    const space = spaces.get(spaceId);
    const folders = space && Array.isArray(space.folders) ? space.folders : [];
    return folders
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && typeof (entry as { path?: unknown }).path === "string") {
          return (entry as { path: string }).path;
        }
        return null;
      })
      .filter((path): path is string => Boolean(path && path.length > 0));
  } catch {
    return [];
  }
}

function effectiveScheduledFolders(task: ScheduledTask): string[] {
  const fromTask = task.userSelectedFolders?.length
    ? task.userSelectedFolders
    : task.cwd
      ? [task.cwd]
      : [];
  const fromSpace = spaceFolderPathsForTask(task.spaceId);
  return [...new Set([...fromTask, ...fromSpace])];
}

export function runScheduledTaskNow(context: IpcHandlerContext, task: ScheduledTask, source = "manual"): unknown {
  const channel = resolveScheduledTaskChannel(task);
  const folders = effectiveScheduledFolders(task);
  const cwd = task.cwd ?? folders[0];

  // Residual pYt: file content → Uwe → Lwe/Fwe wrap (not raw task.prompt alone).
  // Empty after Uwe aborts as no-op — do not recordRun / disable fireAt one-shot.
  const fileContent = context.scheduledTasks.getScheduledTaskFileContent(task.id);
  const wrapped = resolveScheduledTaskRunMessage({
    taskId: task.id,
    fileContent,
    prompt: task.prompt,
  });
  if (!wrapped) {
    dispatchScheduledTaskEvent(
      context,
      { id: task.id, status: "error", source, task, error: "empty_scheduled_task_prompt" },
      channel,
    );
    return { channel, scheduledTaskId: task.id, error: "empty_scheduled_task_prompt" };
  }

  // Only stamp lastRunAt (and complete fireAt) once we have a real wrapped body to fire.
  const updatedTask = context.scheduledTasks.recordRun(task.id) ?? task;

  // Residual: Code scheduled → LocalSessions (CCD); Cowork scheduled → LocalAgentModeSessions (jT).
  if (channel === "cowork") {
    void context.localAgentModeSessions
      .start({
        message: wrapped,
        model: task.model,
        permissionMode: task.permissionMode,
        scheduledTaskId: task.id,
        spaceId: task.spaceId,
        title: task.title,
        userSelectedFolders: folders.length > 0 ? folders : undefined,
      })
      .then((sessionId) => {
        dispatchScheduledTaskEvent(
          context,
          { id: task.id, status: "ran", source, sessionId, task: updatedTask },
          "cowork",
        );
      })
      .catch(() => {
        dispatchScheduledTaskEvent(
          context,
          { id: task.id, status: "error", source, task: updatedTask },
          "cowork",
        );
      });
    return { channel: "cowork", scheduledTaskId: task.id };
  }

  const session = context.localSessions.start({
    kind: "code",
    title: task.title,
    prompt: wrapped,
    cwd,
    folders,
    userSelectedFolders: folders,
    model: task.model,
    permissionMode: task.permissionMode,
    scheduledTaskId: task.id,
    origin: "scheduled",
  });
  dispatchLocalSessionEvent(context, { type: "start", sessionId: session.id, session });
  getLocalSessionRunner(context).runTurn(session.id, wrapped, {
    model: task.model,
    permissionMode: task.permissionMode,
    scheduledTaskId: task.id,
    origin: "scheduled",
  });
  dispatchLocalSessionEvent(context, {
    type: "scheduled_task_run",
    sessionId: session.id,
    scheduledTaskId: task.id,
    session,
  });
  dispatchScheduledTaskEvent(
    context,
    { id: task.id, status: "ran", source, sessionId: session.id, task: updatedTask },
    "code",
  );
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

/**
 * Residual us.updateScheduledTask({ scheduledTaskId, spaceId, ... }) bag form,
 * or product (id, patch). Empty spaceId unlinks from project (Qa).
 */
function updateScheduledTaskFromArgs(
  store: IpcHandlerContext["scheduledTasks"],
  idOrBag: unknown,
  maybeInput?: unknown,
): ReturnType<IpcHandlerContext["scheduledTasks"]["updateScheduledTask"]> {
  if (typeof idOrBag === "string" && typeof maybeInput === "object" && maybeInput !== null) {
    return store.updateScheduledTask(idOrBag, maybeInput as never);
  }
  if (typeof idOrBag === "object" && idOrBag !== null) {
    const bag = idOrBag as Record<string, unknown>;
    const id =
      (typeof bag.scheduledTaskId === "string" && bag.scheduledTaskId) ||
      (typeof bag.id === "string" && bag.id) ||
      null;
    if (!id) return null;
    const { scheduledTaskId: _scheduledTaskId, id: _id, ...patch } = bag;
    return store.updateScheduledTask(id, patch as never);
  }
  return null;
}

function createChannelScheduledHandlers(
  context: IpcHandlerContext,
  channel: ScheduledTaskChannel,
): InterfaceHandlers {
  const store = context.scheduledTasks;
  return {
    getAllScheduledTasks: async () => store.getAllScheduledTasks(channel),
    getScheduledTask: async (_event, id) =>
      typeof id === "string" ? store.getScheduledTask(id, channel) : null,
    getScheduledTaskFileContent: async (_event, id) =>
      typeof id === "string" ? store.getScheduledTaskFileContent(id) : "",
    updateScheduledTaskFileContent: async (_event, id, content) =>
      typeof id === "string" && typeof content === "string"
        ? store.updateScheduledTaskFileContent(id, content)
        : false,
    updateScheduledTaskStatus: async (_event, id, status) => {
      if (
        typeof id !== "string" ||
        (status !== "enabled" && status !== "disabled" && status !== "deleted")
      ) {
        return false;
      }
      // Only mutate tasks that belong to this channel.
      if (!store.getScheduledTask(id, channel)) return false;
      const result = store.updateScheduledTaskStatus(id, status);
      dispatchScheduledTaskEvent(context, { id, status }, channel);
      return result;
    },
    updateScheduledTask: async (_event, idOrBag, input) => {
      // Resolve id first so we can reject cross-channel updates.
      let id: string | null = null;
      if (typeof idOrBag === "string") id = idOrBag;
      else if (typeof idOrBag === "object" && idOrBag !== null) {
        const bag = idOrBag as Record<string, unknown>;
        id =
          (typeof bag.scheduledTaskId === "string" && bag.scheduledTaskId) ||
          (typeof bag.id === "string" && bag.id) ||
          null;
      }
      if (!id || !store.getScheduledTask(id, channel)) return null;
      const updated = updateScheduledTaskFromArgs(store, idOrBag, input);
      if (updated) {
        // Preserve channel ownership even if client omits it.
        const sealed =
          resolveScheduledTaskChannel(updated) === channel
            ? updated
            : store.updateScheduledTask(updated.id, { channel }) ?? updated;
        dispatchScheduledTaskEvent(
          context,
          { id: sealed.id, status: "updated", task: sealed },
          channel,
        );
        return sealed;
      }
      return updated;
    },
    createScheduledTask: async (_event, input) => {
      const base =
        typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      const task = store.createScheduledTask({
        ...(base as never),
        channel,
      });
      dispatchScheduledTaskEvent(context, { id: task.id, status: "created", task }, channel);
      return task;
    },
    // Residual jT.removeApprovedPermission(taskId, toolName) → boolean.
    removeApprovedPermission: async (_event, id, toolName) => {
      if (typeof id !== "string" || typeof toolName !== "string") return false;
      if (!store.getScheduledTask(id, channel)) return false;
      const result = store.removeApprovedPermission(id, toolName);
      if (result) {
        const task = store.getScheduledTask(id, channel);
        dispatchScheduledTaskEvent(
          context,
          { id, status: "updated", task: task ?? undefined },
          channel,
        );
      }
      return result;
    },
    // Residual jT.clearChromePermissions(taskId) → boolean (false if already empty).
    clearChromePermissions: async (_event, id) => {
      if (typeof id !== "string") return false;
      if (!store.getScheduledTask(id, channel)) return false;
      const result = store.clearChromePermissions(id);
      if (result) {
        const task = store.getScheduledTask(id, channel);
        dispatchScheduledTaskEvent(
          context,
          { id, status: "updated", task: task ?? undefined },
          channel,
        );
      }
      return result;
    },
  };
}

function createCcdScheduledHandlers(context: IpcHandlerContext): InterfaceHandlers {
  return createChannelScheduledHandlers(context, "code");
}

function createCoworkScheduledHandlers(context: IpcHandlerContext): InterfaceHandlers {
  return createChannelScheduledHandlers(context, "cowork");
}

export function registerScheduledTasksHandlers(context: IpcHandlerContext): void {
  registerInterfaceHandlers("claude.web", "CCDScheduledTasks", createCcdScheduledHandlers(context));
  registerInterfaceHandlers("claude.web", "CoworkScheduledTasks", createCoworkScheduledHandlers(context));
  startScheduledTaskPump(context);
}
