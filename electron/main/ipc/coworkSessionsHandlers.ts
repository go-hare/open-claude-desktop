import type { CoworkSessionManager } from "../services/coworkSessions/coworkSessionManager";
import { isCoworkShareSessionResult } from "../services/coworkSessions/coworkSessionShareExport";
import { isCoworkTranscriptFeedback } from "../services/coworkSessions/coworkTranscriptFeedback";
import {
  isCoworkChromePermissionMode,
  type CoworkCuMentionedWindow,
  type CoworkPermissionDecision,
  type CoworkPermissionMode,
  type CoworkStartSessionInput,
} from "../services/coworkSessions/coworkSessionTypes";
import { respondCoworkDirectoryServers } from "../services/coworkRuntime/coworkMcpDirectoryBridge";
import { respondCoworkPluginSearch } from "../services/coworkRuntime/coworkPluginSearchBridge";
import { respondCoworkSlashMenuSkills } from "../services/coworkRuntime/coworkSkillsSlashBridge";
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

function parseOtelConfig(
  value: unknown,
): CoworkStartSessionInput["otelConfig"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const config = value as Record<string, unknown>;
  const endpoint =
    typeof config.endpoint === "string"
      ? config.endpoint
      : config.endpoint === null
        ? null
        : undefined;
  const protocol =
    typeof config.protocol === "string"
      ? config.protocol
      : config.protocol === null
        ? null
        : undefined;
  if (
    endpoint === undefined &&
    protocol === undefined &&
    config.headers === undefined &&
    config.resourceAttributes === undefined
  ) {
    return undefined;
  }
  return {
    endpoint,
    headers: config.headers,
    protocol,
    resourceAttributes: config.resourceAttributes,
  };
}

function parseStartInput(value: unknown): CoworkStartSessionInput {
  const input = record(value);
  if (typeof input.message !== "string") {
    throw new Error(
      'Argument "info.message" to method "start" in interface "LocalAgentModeSessions" failed to pass validation',
    );
  }
  // Official startSession validates egressAllowedDomains as string[].
  // Spread keeps unknown bridge fields; normalize known product ports explicitly.
  return {
    ...input,
    egressAllowedDomains: stringArray(input.egressAllowedDomains),
    images: Array.isArray(input.images) ? (input.images as never) : undefined,
    message: input.message,
    messageUuid: optionalString(input.messageUuid),
    model: optionalString(input.model),
    otelConfig: parseOtelConfig(input.otelConfig),
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
    /**
     * Official LocalAgentModeSessions.replaceEnabledMcpTools(sessionId, { tools }).
     * NUe: payload object with tools map of booleans; manager coerces.
     */
    replaceEnabledMcpTools: secured(async (_event, id, enabledMcpTools) =>
      manager.replaceEnabledMcpTools(sessionId(id), enabledMcpTools),
    ),
    /**
     * Official LocalAgentModeSessions.replaceRemoteMcpServers(sessionId, servers[]).
     * MUe: uuid/name/tools/toolKeys on wire; manager assigns uuid/name/tools.
     */
    replaceRemoteMcpServers: secured(async (_event, id, servers) =>
      manager.replaceRemoteMcpServers(sessionId(id), servers),
    ),
    /**
     * Official LocalAgentModeSessions.setMcpServers(sessionId, servers[]).
     * createMcpServer residual inject; applyMcpServersIfIdle dirty/defer product.
     */
    setMcpServers: secured(async (_event, id, servers) =>
      manager.setMcpServers(sessionId(id), servers),
    ),
    /**
     * Official LocalAgentModeSessions.setDraftSessionFolders(folders: string[]).
     * Manager eBe-filters via Th inject residual.
     */
    setDraftSessionFolders: secured(async (_event, folders) => {
      if (!(Array.isArray(folders) && folders.every((item) => typeof item === "string"))) {
        throw new Error(
          'Argument "folders" at position 0 to method "setDraftSessionFolders" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      manager.setDraftSessionFolders(folders);
    }),
    /**
     * Official LocalAgentModeSessions.openOutputsDir(sessionId).
     */
    openOutputsDir: secured(async (_event, id) =>
      manager.openOutputsDir(sessionId(id)),
    ),
    /**
     * Official LocalAgentModeSessions.setFocusedSession(sessionId | null).
     * Wire validates null or string (including empty); manager stores as-is.
     */
    setFocusedSession: secured(async (_event, id) => {
      if (!(id === null || typeof id === "string")) {
        throw new Error(
          'Argument "sessionId" at position 0 to method "setFocusedSession" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      manager.setFocusedSession(id);
    }),
    /**
     * Official LocalAgentModeSessions.submitTranscriptFeedback(sessionId, feedback).
     * G$A validator: freeText string, steps YUt[], submittedAt number → boolean.
     */
    submitTranscriptFeedback: secured(async (_event, id, feedback) => {
      if (typeof id !== "string") {
        throw new Error(
          'Argument "sessionId" at position 0 to method "submitTranscriptFeedback" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      if (!isCoworkTranscriptFeedback(feedback)) {
        throw new Error(
          'Argument "feedback" at position 1 to method "submitTranscriptFeedback" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      return manager.submitTranscriptFeedback(id, feedback);
    }),
    /**
     * Official LocalAgentModeSessions.getTranscriptFeedback(sessionId) → feedback[].
     */
    getTranscriptFeedback: secured(async (_event, id) => {
      if (typeof id !== "string") {
        throw new Error(
          'Argument "sessionId" at position 0 to method "getTranscriptFeedback" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      return manager.getTranscriptFeedback(id);
    }),
    /**
     * Official LocalAgentModeSessions.shareSession(sessionId) → RUe result.
     * Wire validates sessionId string; result RUe (success boolean + optional filePath/error).
     */
    shareSession: secured(async (_event, id) => {
      if (typeof id !== "string") {
        throw new Error(
          'Argument "sessionId" at position 0 to method "shareSession" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      const result = await manager.shareSession(id);
      if (!isCoworkShareSessionResult(result)) {
        throw new Error(
          'Result from method "shareSession" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      return result;
    }),
    /**
     * Official LocalAgentModeSessions.setChromePermissionMode(sessionId, mode).
     * Wire: sessionId string + QV mode (xUt: ask | skip_all_permission_checks |
     * follow_a_plan); result boolean.
     */
    setChromePermissionMode: secured(async (_event, id, mode) => {
      if (typeof id !== "string") {
        throw new Error(
          'Argument "sessionId" at position 0 to method "setChromePermissionMode" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      if (!isCoworkChromePermissionMode(mode)) {
        throw new Error(
          'Argument "mode" at position 1 to method "setChromePermissionMode" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      const result = manager.setChromePermissionMode(id, mode);
      if (typeof result !== "boolean") {
        throw new Error(
          'Result from method "setChromePermissionMode" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      return result;
    }),
    /**
     * Official LocalAgentModeSessions.noteCuWindowMentions(sessionId, apps).
     * mGA wire: bundleId/displayName/windowId/title; product stores title+bundleId.
     */
    noteCuWindowMentions: secured(async (_event, id, apps) => {
      if (!Array.isArray(apps)) {
        throw new Error(
          'Argument "apps" at position 1 to method "noteCuWindowMentions" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      const windows: CoworkCuMentionedWindow[] = [];
      for (const raw of apps) {
        if (!raw || typeof raw !== "object") {
          throw new Error(
            'Argument "apps" at position 1 to method "noteCuWindowMentions" in interface "LocalAgentModeSessions" failed to pass validation',
          );
        }
        const item = raw as Record<string, unknown>;
        if (
          typeof item.bundleId !== "string" ||
          typeof item.title !== "string"
        ) {
          throw new Error(
            'Argument "apps" at position 1 to method "noteCuWindowMentions" in interface "LocalAgentModeSessions" failed to pass validation',
          );
        }
        windows.push({
          bundleId: item.bundleId,
          title: item.title,
        });
      }
      manager.noteCuWindowMentions(sessionId(id), windows);
    }),
    /**
     * Official LocalAgentModeSessions.setPermissionMode(sessionId, mode, domains?, options?).
     * BUe options: optional chromeSkipAllPermissionChecks boolean.
     * Residual: full rB permission mode enum wire (sessionId(mode) keeps string path).
     */
    setPermissionMode: secured(async (_event, id, mode, domains, options) => {
      const opts =
        options && typeof options === "object"
          ? (options as Record<string, unknown>)
          : undefined;
      const chromeSkip =
        opts && typeof opts.chromeSkipAllPermissionChecks === "boolean"
          ? opts.chromeSkipAllPermissionChecks
          : undefined;
      return manager.setPermissionMode(
        sessionId(id),
        sessionId(mode) as CoworkPermissionMode,
        stringArray(domains),
        chromeSkip === undefined
          ? undefined
          : { chromeSkipAllPermissionChecks: chromeSkip },
      );
    }),
    start: secured(async (_event, input) => ({
      sessionId: await manager.start(parseStartInput(input)),
    })),
    stop: secured(async (_event, id) => manager.stop(sessionId(id))),
    updateSession: secured(async (_event, id, update) =>
      manager.updateSession(sessionId(id), record(update)),
    ),
    // Official D1e → Yxi: web responds to directory_servers_* reverse-RPC.
    respondDirectoryServers: secured(async (_event, requestId, servers) => {
      if (typeof requestId !== "string" || requestId.length === 0) {
        throw new Error("LocalAgentModeSessions.respondDirectoryServers requires requestId");
      }
      respondCoworkDirectoryServers(requestId, servers);
    }),
    // Official D1e → Jxi: web responds to slash_menu / addable_skills reverse-RPC.
    respondSlashMenuSkills: secured(async (_event, requestId, skillsJson) => {
      if (typeof requestId !== "string" || requestId.length === 0) {
        throw new Error("LocalAgentModeSessions.respondSlashMenuSkills requires requestId");
      }
      respondCoworkSlashMenuSkills(requestId, skillsJson);
    }),
    // Official D1e → jxi: web responds to plugins_search reverse-RPC.
    respondPluginSearch: secured(async (_event, requestId, resultsJson) => {
      if (typeof requestId !== "string" || requestId.length === 0) {
        throw new Error("LocalAgentModeSessions.respondPluginSearch requires requestId");
      }
      respondCoworkPluginSearch(requestId, resultsJson);
    }),
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
