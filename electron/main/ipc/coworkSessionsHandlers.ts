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
import { resolveCoworkTranscriptPath } from "../services/coworkRuntime/coworkTranscriptJsonl";
import {
  getTranscriptSearchWorkerHost,
  type TranscriptSearchSession,
} from "../services/shell/transcriptSearchWorkerHost";
import type { IpcHandlerContext } from "./context";
import { assertCoworkIpcOrigin } from "./coworkIpcOrigin";
import { parseCoworkSendMessageArgs } from "./coworkSendMessageContract";
import { createCoworkLocalAgentResidualHandlers } from "./coworkLocalAgentResidualHandlers";
import { createCoworkSessionWorkspaceHandlers } from "./coworkSessionWorkspaceHandlers";
import type { InterfaceHandlers, IpcHandler } from "./registerIpc";
import { registerInterfaceHandlers } from "./registerIpc";
import {
  getSessionsBridgeEnabled,
  getSessionsBridgeStatusState,
  identityFromSettingsPrefs,
} from "../services/coworkSessions/sessionsBridgeResidual";
import { setSessionsBridgeEnabledLive } from "../services/coworkSessions/sessionsBridgeLifecycle";

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
    // Residual UZe/Ks: space detail sessions filter on spaceId; keep explicit so
    // empty strings do not stick via the spread.
    scheduledTaskId: optionalString(input.scheduledTaskId),
    sessionId: optionalString(input.sessionId),
    spaceId: optionalString(input.spaceId),
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
    /**
     * Title/id filter first; query ≥ 2 also searches CLI jsonl body via
     * TranscriptSearchWorkerHost (yHi residual) when transcriptPath resolves.
     */
    searchSessions: secured(async (_event, query) => {
      await initialize(manager);
      const raw = String(query ?? "");
      const needle = raw.toLowerCase().trim();
      const all = manager.getAll();
      const titleHits = all.filter((item) =>
        `${item.title ?? ""} ${item.sessionId}`.toLowerCase().includes(needle),
      );
      if (needle.length < 2) return titleHits;

      const titleIds = new Set(titleHits.map((item) => item.sessionId));
      const candidates = all.filter(
        (item) => !titleIds.has(item.sessionId) && Boolean(item.cliSessionId),
      );
      if (candidates.length === 0) return titleHits;

      const searchSessions: TranscriptSearchSession[] = [];
      for (const item of candidates) {
        const transcriptPath = await resolveCoworkTranscriptPath({
          cliSessionId: item.cliSessionId,
          cwd: item.cwd,
          hostLoopMode: item.hostLoopMode,
          userSelectedFolders: item.userSelectedFolders,
        });
        if (!transcriptPath) continue;
        searchSessions.push({
          sessionId: item.sessionId,
          transcriptPath,
          lastActivityAt: item.lastActivityAt,
        });
      }
      if (searchSessions.length === 0) return titleHits;

      try {
        const hits = await getTranscriptSearchWorkerHost().search(raw.trim(), searchSessions, {
          limit: 50,
        });
        if (hits.length === 0) return titleHits;
        const hitIds = new Set(hits.map((hit) => hit.sessionId));
        const bodyHits = all.filter(
          (item) => hitIds.has(item.sessionId) && !titleIds.has(item.sessionId),
        );
        return [...titleHits, ...bodyHits];
      } catch (error) {
        console.warn(
          "[LocalAgentModeSessions.searchSessions] transcript body search failed",
          error,
        );
        return titleHits;
      }
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
    /**
     * Official LocalAgentModeSessions.cancelQueuedMessage(sessionId, messageUuid).
     * Same residual as LocalSessions — drop deferred/inputStream uuid before too-late.
     */
    cancelQueuedMessage: secured(async (_event, id, messageUuid) => {
      if (typeof id !== "string" || id.length === 0) {
        throw new Error(
          'Argument "sessionId" at position 0 to method "cancelQueuedMessage" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      if (typeof messageUuid !== "string" || messageUuid.length === 0) {
        throw new Error(
          'Argument "messageUuid" at position 1 to method "cancelQueuedMessage" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      return manager.cancelQueuedMessage(id, messageUuid);
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
      // Skills / bridge / TCC / direct-MCP / interactiveAuth / mcp resources residuals.
      ...createCoworkLocalAgentResidualHandlers(context),
      // Official Dispatch Ht: get/setSessionsBridgeEnabled + yit status (QcA).
      // custom-3p residual: enabled true, set void (persist bridge-state + pref), yit bag.
      getSessionsBridgeEnabled: async () => {
        const prefs = context.settings.getPreferences() as Record<string, unknown>;
        return getSessionsBridgeEnabled(identityFromSettingsPrefs(prefs));
      },
      setSessionsBridgeEnabled: async (_event, enabled) => {
        if (typeof enabled !== "boolean") {
          throw new Error(
            'Argument "enabled" at position 0 to method "setSessionsBridgeEnabled" in interface "LocalAgentModeSessions" failed to pass validation',
          );
        }
        // Pref round-trip for UI + residual fwe / setEnabledFlag + NJ reconcile.
        context.settings.setPreference("sessionsBridgeEnabled", enabled === true);
        const prefs = context.settings.getPreferences() as Record<string, unknown>;
        await setSessionsBridgeEnabledLive(
          identityFromSettingsPrefs(prefs),
          enabled,
        );
        // Official IPC: await set… void (no boolean result).
      },
      sessionsBridgeStatus_$store$_getState: async () => {
        // Official getInitialSessionsBridgeStatusState → yit() (QcA fields only).
        return getSessionsBridgeStatusState();
      },
      /**
       * Official BrowserUse / Gir internal MCP route:
       * mcpCallTool("Claude in Chrome", list_connected_browsers|select_browser|…).
       * Not user mcp-servers.json — socket client residual (no OAuth bridge invent).
       */
      mcpCallTool: async (_event, serverName, toolName, input) => {
        const name =
          typeof toolName === "string" && toolName.length > 0
            ? toolName
            : typeof toolName === "object" &&
                toolName !== null &&
                typeof (toolName as { name?: unknown }).name === "string"
              ? (toolName as { name: string }).name
              : null;
        if (!name) {
          return { ok: false, error: "missing_mcp_tool_name", serverName };
        }
        try {
          const {
            isClaudeInChromeMcpServerName,
            callClaudeInChromeTool,
          } = await import("../services/chrome/claudeInChromeMcp");
          if (isClaudeInChromeMcpServerName(serverName)) {
            // Live re-read each call — do not freeze prefs into singleton MCP context.
            // BrowserUse hits LocalAgentModeSessions.mcpCallTool; may race Kir init.
            return callClaudeInChromeTool(
              name,
              typeof input === "object" && input !== null
                ? (input as Record<string, unknown>)
                : {},
              {
                isEnabled: () => {
                  const prefs = context.settings.getPreferences();
                  return prefs.chromeExtensionEnabled !== false;
                },
                getPersistedDeviceId: () => {
                  const prefs = context.settings.getPreferences();
                  const bag =
                    prefs.chromeExtension &&
                    typeof prefs.chromeExtension === "object" &&
                    !Array.isArray(prefs.chromeExtension)
                      ? (prefs.chromeExtension as Record<string, unknown>)
                      : {};
                  return typeof bag.pairedDeviceId === "string"
                    ? bag.pairedDeviceId
                    : undefined;
                },
                onExtensionPaired: (deviceId, pairedName) => {
                  const prefs = context.settings.getPreferences();
                  const prev =
                    prefs.chromeExtension &&
                    typeof prefs.chromeExtension === "object" &&
                    !Array.isArray(prefs.chromeExtension)
                      ? (prefs.chromeExtension as Record<string, unknown>)
                      : {};
                  context.settings.setPreference("chromeExtension", {
                    ...prev,
                    pairedDeviceId: deviceId,
                    pairedDeviceName: pairedName,
                  });
                },
              },
            );
          }
        } catch (error) {
          console.warn(
            "[Chrome Extension MCP] LocalAgentModeSessions.mcpCallTool failed",
            error,
          );
        }
        return { ok: false, error: "mcp_server_not_configured", serverName };
      },
    },
    "claude.web.LocalAgentModeSessions",
  );
}
