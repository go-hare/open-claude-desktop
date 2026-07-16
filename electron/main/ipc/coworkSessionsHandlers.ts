import type { CoworkSessionManager } from "../services/coworkSessions/coworkSessionManager";
import type {
  CoworkPermissionDecision,
  CoworkPermissionMode,
  CoworkStartSessionInput,
} from "../services/coworkSessions/coworkSessionTypes";
import type { IpcHandlerContext } from "./context";
import { assertCoworkIpcOrigin } from "./coworkIpcOrigin";
import { parseCoworkSendMessageArgs } from "./coworkSendMessageContract";
import { createCoworkSessionWorkspaceHandlers } from "./coworkSessionWorkspaceHandlers";
import type { InterfaceHandlers, IpcHandler } from "./registerIpc";
import { registerInterfaceHandlers } from "./registerIpc";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return result.length > 0 ? result : undefined;
}

function parseStartInput(value: unknown): CoworkStartSessionInput {
  const input = record(value);
  if (typeof input.message !== "string") {
    throw new Error(
      'Argument "info.message" to method "start" in interface "LocalAgentModeSessions" failed to pass validation',
    );
  }
  return {
    ...input,
    images: Array.isArray(input.images) ? (input.images as never) : undefined,
    message: input.message,
    messageUuid: optionalString(input.messageUuid),
    model: optionalString(input.model),
    permissionMode: optionalString(input.permissionMode) as CoworkPermissionMode,
    sessionId: optionalString(input.sessionId),
    systemPrompt: optionalString(input.systemPrompt),
    title: optionalString(input.title),
    userSelectedFiles: stringArray(input.userSelectedFiles),
    userSelectedFolders: stringArray(input.userSelectedFolders),
    userSelectedProjectUuids: stringArray(input.userSelectedProjectUuids),
  } as CoworkStartSessionInput;
}

function sessionId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("LocalAgentModeSessions requires a sessionId");
  }
  return value;
}

function permissionDecision(value: unknown): CoworkPermissionDecision {
  if (value === "always" || value === "deny" || value === "once") return value;
  throw new Error("Invalid LocalAgentModeSessions permission decision");
}

function secured(handler: IpcHandler): IpcHandler {
  return (event, ...args) => {
    assertCoworkIpcOrigin(event);
    return handler(event, ...args);
  };
}

async function initialize(manager: CoworkSessionManager): Promise<void> {
  await manager.initialize();
}

export function createCoworkSessionHandlers(manager: CoworkSessionManager): InterfaceHandlers {
  return {
    archive: secured(async (_event, id, options) => manager.archive(sessionId(id), options)),
    delete: secured(async (_event, id) => manager.delete(sessionId(id))),
    getAll: secured(async () => {
      await initialize(manager);
      return manager.getAll();
    }),
    getSession: secured(async (_event, id, options) => {
      await initialize(manager);
      return manager.getSession(sessionId(id), options);
    }),
    getSessionsForScheduledTask: secured(async (_event, taskId) => {
      await initialize(manager);
      const scheduledTaskId = sessionId(taskId);
      return manager.getAll().filter((item) => item.scheduledTaskId === scheduledTaskId);
    }),
    getTranscript: secured(async (_event, id, options) => {
      await initialize(manager);
      return manager.getTranscript(sessionId(id), record(options));
    }),
    respondToToolPermission: secured(async (_event, requestId, decision, updatedInput) => {
      manager.respondToToolPermission(
        sessionId(requestId),
        permissionDecision(decision),
        updatedInput,
      );
    }),
    rewind: secured(async (_event, id, targetUuid) =>
      manager.rewind(sessionId(id), sessionId(targetUuid)),
    ),
    searchSessions: secured(async (_event, query) => {
      await initialize(manager);
      const needle = String(query ?? "").toLowerCase();
      return manager.getAll().filter((item) =>
        `${item.title ?? ""} ${item.sessionId}`.toLowerCase().includes(needle),
      );
    }),
    sendMessage: secured(async (_event, ...args) => {
      const request = parseCoworkSendMessageArgs(args);
      await manager.sendMessage(
        request.sessionId,
        request.message,
        request.images,
        request.userSelectedFiles,
        request.messageUuid,
        request.toolStates,
      );
    }),
    setModel: secured(async (_event, id, model) =>
      manager.setModel(sessionId(id), sessionId(model)),
    ),
    setPermissionMode: secured(async (_event, id, mode, domains, options) =>
      manager.setPermissionMode(
        sessionId(id),
        sessionId(mode) as CoworkPermissionMode,
        stringArray(domains),
        options,
      ),
    ),
    start: secured(async (_event, input) => ({
      sessionId: await manager.start(parseStartInput(input)),
    })),
    stop: secured(async (_event, id) => manager.stop(sessionId(id))),
    updateSession: secured(async (_event, id, update) =>
      manager.updateSession(sessionId(id), record(update)),
    ),
  };
}

export function registerCoworkSessionsHandlers(context: IpcHandlerContext): void {
  registerInterfaceHandlers(
    "claude.web",
    "LocalAgentModeSessions",
    {
      ...createCoworkSessionHandlers(context.localAgentModeSessions),
      ...createCoworkSessionWorkspaceHandlers(context),
      // Official Dispatch Ht (cc989143e): Xe.get/setSessionsBridgeEnabled on LocalAgentModeSessions.
      getSessionsBridgeEnabled: async () => {
        const prefs = context.settings.getPreferences();
        return prefs.sessionsBridgeEnabled !== false;
      },
      setSessionsBridgeEnabled: async (_event, enabled) => {
        context.settings.setPreference("sessionsBridgeEnabled", enabled !== false);
        return true;
      },
      sessionsBridgeStatus_$store$_getState: async () => {
        const enabled = context.settings.getPreferences().sessionsBridgeEnabled !== false;
        return { enabled, status: enabled ? "ready" : "disabled" };
      },
    },
    "claude.web.LocalAgentModeSessions",
  );
}
