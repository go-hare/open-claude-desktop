import { CoworkTrustedFolders } from "../services/coworkSessions/coworkTrustedFolders";
import type { IpcHandlerContext } from "./context";
import { assertCoworkIpcOrigin } from "./coworkIpcOrigin";
import type { InterfaceHandlers, IpcHandler } from "./registerIpc";

function secured(handler: IpcHandler): IpcHandler {
  return (event, ...args) => {
    assertCoworkIpcOrigin(event);
    return handler(event, ...args);
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`LocalAgentModeSessions requires ${name}`);
}

function optionalSessionId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const sessionId = (value as Record<string, unknown>).sessionId;
  return typeof sessionId === "string" ? sessionId : undefined;
}

export function createCoworkSessionWorkspaceHandlers(
  context: IpcHandlerContext,
): InterfaceHandlers {
  const trustedFolders = new CoworkTrustedFolders(context.settings);
  const manager = context.localAgentModeSessions;
  return {
    addFolderToSession: secured(async (_event, id, folder) =>
      manager.addFolderToSession(
        requiredString(id, "sessionId"),
        requiredString(folder, "folderPath"),
      ),
    ),
    addTrustedFolder: secured(async (_event, folder) => {
      trustedFolders.add(requiredString(folder, "folderPath"));
    }),
    getSupportedCommands: secured(async (_event, request) =>
      manager.getSupportedCommands(optionalSessionId(request)),
    ),
    getTrustedFolders: secured(async () => trustedFolders.getAll()),
    isFolderTrusted: secured(async (_event, folder) =>
      trustedFolders.isTrusted(requiredString(folder, "folderPath")),
    ),
    removeTrustedFolder: secured(async (_event, folder) => {
      trustedFolders.remove(requiredString(folder, "folderPath"));
    }),
  };
}
