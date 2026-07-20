import { randomUUID } from "node:crypto";
import { resolveCoworkStartChromeSeed } from "./coworkChromeCicHelpers";
import {
  appendCoworkPreUserMessageHints,
  consumeCoworkPendingSystemReminder,
  drainCoworkPendingNotifications,
} from "./coworkSessionNotifications";
import type {
  CoworkChromePermissionMode,
  CoworkImagePayload,
  CoworkRendererSession,
  CoworkSdkUserMessage,
  CoworkSessionRuntimeState,
  CoworkStartSessionInput,
  CoworkToolPermissionRequest,
  CoworkToolState,
} from "./coworkSessionTypes";

function buildMessageContent(
  message: string,
  images?: CoworkImagePayload[],
): string | unknown[] {
  const validImages = images?.filter((image) => image.base64.length > 0);
  if (!validImages?.length) return message;
  const content: unknown[] = validImages.map((image) => ({
    source: {
      data: image.base64,
      media_type: image.mimeType,
      type: "base64",
    },
    type: "image",
  }));
  if (message.trim()) content.push({ text: message, type: "text" });
  return content;
}

function selectedFolders(input: CoworkStartSessionInput) {
  return (input.userSelectedFolders ?? []).map((folder) => ({
    canonical: folder,
    display: folder,
    kind: "local" as const,
  }));
}

export function createDefaultCoworkSessionId(): string {
  return `local_${randomUUID()}`;
}

export function createDefaultCoworkProcessName(sessionId: string): string {
  return sessionId.replace(/^local_/, "");
}

export function isValidCoworkSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(sessionId);
}

export type CoworkCreateRuntimeChromeOptions = {
  /** Official gi("allowAllBrowserActions"). */
  allowAllBrowserActions?: boolean;
  /** Official K2(). */
  allowSkipAllOutsideUnsupervised?: boolean;
  /** Official ps.getChromePermissions(scheduledTaskId). */
  scheduledChrome?: {
    domains?: string[];
    mode?: CoworkChromePermissionMode;
  };
};

export function createRuntimeState(
  input: CoworkStartSessionInput,
  sessionId: string,
  processName: string,
  now: number,
  chromeOptions?: CoworkCreateRuntimeChromeOptions,
): CoworkSessionRuntimeState {
  // Official startSession chrome seed: E_(scheduled.mode)??m + unsupervised gXi-like snapshot.
  // See resolveCoworkStartChromeSeed (K2 + gi allowAllBrowserActions + ps.getChromePermissions).
  const seed = resolveCoworkStartChromeSeed({
    allowAllBrowserActions: chromeOptions?.allowAllBrowserActions,
    allowSkipAllOutsideUnsupervised:
      chromeOptions?.allowSkipAllOutsideUnsupervised,
    chromeSkipAllPermissionChecks: input.chromeSkipAllPermissionChecks,
    permissionMode: input.permissionMode,
    scheduledChrome: chromeOptions?.scheduledChrome,
  });
  // Official D seed: chromeAllowedDomains = f.domains only (or void 0 when unsupervised
  // chromeSkipAll is set). Never residual-fill from A.chromeAllowedDomains — that undoes
  // the official unsupervised clear.
  const chromeAllowedDomains = seed.chromeAllowedDomains
    ? [...seed.chromeAllowedDomains]
    : undefined;
  return {
    chromeAllowedDomains,
    chromePermissionMode: seed.chromePermissionMode,
    chromePermsBeforeUnsupervised: seed.chromePermsBeforeUnsupervised,
    createdAt: now,
    cwd: `/sessions/${processName}`,
    egressAllowedDomains: input.egressAllowedDomains
      ? [...input.egressAllowedDomains]
      : undefined,
    enabledMcpTools: input.enabledMcpTools,
    fsDetectedFiles: new Map(),
    hostLoopMode: input.hostLoopMode,
    initialMessage: input.message,
    inputStream: null,
    isFirstTurn: true,
    lastActivityAt: now,
    lifecycleState: "initializing",
    messageBuffer: [],
    mcpServers: input.mcpServers,
    memoryEnabled: input.memoryEnabled,
    model: input.model,
    otelConfig: input.otelConfig,
    parentSessionId: input.parentSessionId,
    pendingNotifications: [],
    permissionMode: input.permissionMode,
    processName,
    query: null,
    remoteMcpServersConfig: input.remoteMcpServers,
    resolvedFolders: selectedFolders(input),
    scheduledTaskId: input.scheduledTaskId,
    sessionId,
    sessionType: input.sessionType,
    spaceId: input.spaceId,
    spaceIdSetBy: input.spaceId ? "user" : undefined,
    systemPrompt: input.systemPrompt,
    title: input.title,
    userSelectedProjectUuids: input.userSelectedProjectUuids,
    vmProcessName: processName,
  };
}

export function applyStartInput(
  session: CoworkSessionRuntimeState,
  input: CoworkStartSessionInput,
): void {
  // Official start chrome seed lives in createRuntimeState (K2/gi/scheduled/E_).
  // Do not re-apply input.chromeAllowedDomains here — manager.start always calls
  // applyStartInput after create, and stomping would undo unsupervised chromeSkipAll
  // clearing active domains (official keeps void 0). Domain mutations go through
  // setChromePermissionMode / updateChromePermission.
  // Official unsupervised chromeSkipAll only applies inside createRuntimeState seed.
  // Do not stomp chromePermissionMode to skip_all here for non-unsupervised modes.
  if (input.egressAllowedDomains !== undefined) {
    session.egressAllowedDomains = [...input.egressAllowedDomains];
  }
  session.enabledMcpTools = input.enabledMcpTools ?? session.enabledMcpTools;
  session.hostLoopMode = input.hostLoopMode ?? session.hostLoopMode;
  session.mcpServers = input.mcpServers ?? session.mcpServers;
  if (input.memoryEnabled !== undefined) {
    session.memoryEnabled = input.memoryEnabled;
  }
  session.model = input.model ?? session.model;
  if (input.otelConfig !== undefined) {
    session.otelConfig = input.otelConfig;
  }
  session.parentSessionId = input.parentSessionId ?? session.parentSessionId;
  session.permissionMode = input.permissionMode ?? session.permissionMode;
  session.remoteMcpServersConfig =
    input.remoteMcpServers ?? session.remoteMcpServersConfig;
  // Official does NOT stomp resolvedFolders from start.userSelectedFolders here —
  // doSessionInitialization runs resolveAndFilterSessionFolders(De) then
  // resolvedFolders = [...be, ...Ke] with Ke = prior.slice(De.length).
  // createRuntimeState still seeds stubs for brand-new sessions.
  session.sessionType = input.sessionType ?? session.sessionType;
  session.spaceId = input.spaceId ?? session.spaceId;
  session.systemPrompt = input.systemPrompt ?? session.systemPrompt;
  session.title = input.title ?? session.title;
  session.userSelectedProjectUuids =
    input.userSelectedProjectUuids ?? session.userSelectedProjectUuids;
}

export function createUserMessage(
  session: CoworkSessionRuntimeState,
  message: string,
  messageUuid: string,
  images?: CoworkImagePayload[],
  userSelectedFiles?: string[],
  toolStates?: CoworkToolState[],
  /**
   * Official pre-user-message pipeline:
   *   consumePendingSystemReminder → drainPendingNotifications
   * Prefer true (ft("2979038612")); false clears queue without wrapping.
   */
  options: { preferSessionNotifications?: boolean } = {},
): CoworkSdkUserMessage {
  // Official order:
  //   appendWidgetContextHint(session, appendCuWindowHint(session, message))
  //   → consumePendingSystemReminder → drainPendingNotifications
  const withHints = appendCoworkPreUserMessageHints(session, message);
  const afterReminder = consumeCoworkPendingSystemReminder(session, withHints);
  const drained = drainCoworkPendingNotifications(session, afterReminder, {
    preferSessionNotifications: options.preferSessionNotifications,
  });
  return {
    client_platform: "desktop_app",
    message: { content: buildMessageContent(drained, images), role: "user" },
    parent_tool_use_id: null,
    session_id:
      session.cliSessionId ?? session.sessionId.replace(/^local_/, ""),
    tool_states: toolStates?.length ? toolStates : undefined,
    type: "user",
    user_selected_files: userSelectedFiles?.length
      ? userSelectedFiles
      : undefined,
    uuid: messageUuid,
  };
}

export function createResumeInput(
  session: CoworkSessionRuntimeState,
  message: string,
  images?: CoworkImagePayload[],
  userSelectedFiles?: string[],
  messageUuid?: string,
  toolStates?: CoworkToolState[],
): CoworkStartSessionInput {
  return {
    egressAllowedDomains: session.egressAllowedDomains
      ? [...session.egressAllowedDomains]
      : undefined,
    enabledMcpTools: session.enabledMcpTools,
    hostLoopMode: session.hostLoopMode,
    images,
    mcpServers: session.mcpServers,
    message,
    messageUuid,
    model: session.model,
    otelConfig: session.otelConfig,
    permissionMode: session.permissionMode,
    remoteMcpServers: session.remoteMcpServersConfig,
    sessionId: session.sessionId,
    sessionType: session.sessionType,
    spaceId: session.spaceId,
    systemPrompt: session.systemPrompt,
    // Official `"toolStates"in o` — omit key when absent so resume does not wipe
    // session.widgetToolStates via recordUserMessage assign.
    ...(toolStates !== undefined ? { toolStates } : {}),
    userSelectedFiles,
    userSelectedFolders: session.resolvedFolders.map(
      (folder) => folder.canonical ?? folder.display,
    ),
  };
}

export function toRendererSession(
  session: CoworkSessionRuntimeState,
  pendingToolPermissions: CoworkToolPermissionRequest[],
  homePath: string,
  folderExists: (folder: string) => boolean,
): CoworkRendererSession {
  return {
    bufferedMessages:
      session.messageBuffer.length > 0 ? [...session.messageBuffer] : undefined,
    chromeAllowedDomains: session.chromeAllowedDomains
      ? [...session.chromeAllowedDomains]
      : undefined,
    chromePermissionMode: session.chromePermissionMode,
    chromePermsBeforeUnsupervised: session.chromePermsBeforeUnsupervised
      ? {
          mode: session.chromePermsBeforeUnsupervised.mode,
          domains: session.chromePermsBeforeUnsupervised.domains
            ? [...session.chromePermsBeforeUnsupervised.domains]
            : undefined,
        }
      : undefined,
    // Official getSession chromeTabGroupId:A.chromeTabGroupId
    chromeTabGroupId: session.chromeTabGroupId,
    // Official getSession cuAllowedApps / cuGrantFlags
    cuAllowedApps: session.cuAllowedApps
      ? session.cuAllowedApps.map((app) => ({ ...app }))
      : undefined,
    cuGrantFlags: session.cuGrantFlags
      ? { ...session.cuGrantFlags }
      : undefined,
    cliSessionId: session.cliSessionId,
    createdAt: session.createdAt,
    cwd: session.cwd,
    enabledMcpTools: session.enabledMcpTools,
    error: session.error,
    // Official hydrate (D1e ~114116): n.fsDetectedFiles → Me Map for activity merge.
    ...(session.fsDetectedFiles.size > 0
      ? { fsDetectedFiles: [...session.fsDetectedFiles.values()] }
      : {}),
    folderExists: folderExists(session.cwd),
    homePath,
    hostLoopMode: session.hostLoopMode,
    isAgentCompleted: session.isAgentCompleted,
    isArchived: session.lifecycleState === "archived",
    isRunning: !["archived", "idle"].includes(session.lifecycleState),
    isStarred: session.isStarred,
    lastActivityAt: session.lastActivityAt,
    model: session.model,
    overrideLabel: session.overrideLabel,
    parentSessionId: session.parentSessionId,
    pendingToolPermissions:
      pendingToolPermissions.length > 0 ? pendingToolPermissions : undefined,
    permissionMode: session.permissionMode,
    promptSuggestion: session.promptSuggestion,
    scheduledTaskId: session.scheduledTaskId,
    sessionId: session.sessionId,
    sessionType: session.sessionType,
    spaceId: session.spaceId,
    title: session.title,
    userSelectedFolders: session.resolvedFolders.map(
      (folder) => folder.canonical ?? folder.display,
    ),
    userSelectedProjectUuids: session.userSelectedProjectUuids,
  };
}
