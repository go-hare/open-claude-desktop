/**
 * Official LocalAgentModeSessionManager session notification queue + drain
 * (app.asar queueSessionNotification / drainPendingNotifications /
 * DANGEROUS_invalidateBuiltPromptAndTools / consumePendingSystemReminder / $MA).
 *
 * Mount host-loop strings use U+2014 em dash (exact asar bytes).
 */

import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

/** Official ft("2979038612") gate — product injects; default prefer notifications. */
export type CoworkPreferSessionNotifications = () => boolean;

/**
 * Official $MA(e,A):
 *   slash command keeps order `message + " " + reminder`
 *   else prepends reminder with blank line: `${reminder}\n\n${message}`
 */
export function mergeCoworkPendingSystemReminder(
  message: string,
  reminder: string,
): string {
  return message.trimStart().startsWith("/")
    ? `${message} ${reminder}`
    : `${reminder}\n\n${message}`;
}

/**
 * Official consumePendingSystemReminder(A,t):
 *   if pendingSystemReminder → clear + $MA(t, reminder); else t.
 */
export function consumeCoworkPendingSystemReminder(
  session: Pick<CoworkSessionRuntimeState, "pendingSystemReminder">,
  message: string,
): string {
  const reminder = session.pendingSystemReminder;
  if (!reminder) return message;
  session.pendingSystemReminder = undefined;
  return mergeCoworkPendingSystemReminder(message, reminder);
}

/** Official network-drive mount access notification (U+2014). */
export function coworkHostLoopNetworkDriveAccessMessage(
  folderPath: string,
): string {
  return `You now have access to ${folderPath}. It's on a network drive \u2014 Read/Write/Edit/Grep/Glob work there; bash cannot reach it.`;
}

/** Official local host-loop mount access notification. */
export function coworkHostLoopLocalFolderAccessMessage(
  folderPath: string,
): string {
  return `You now have access to ${folderPath}. Read/Bash work there directly.`;
}

export function coworkHostLoopFolderAccessMessage(
  folderPath: string,
  networkDrive: boolean,
): string {
  return networkDrive
    ? coworkHostLoopNetworkDriveAccessMessage(folderPath)
    : coworkHostLoopLocalFolderAccessMessage(folderPath);
}

/**
 * Official resolveAndFilterSessionFolders resume missing notify:
 *   `The folder(s) X is/are no longer available (deleted from disk).`
 */
export function coworkFoldersNoLongerAvailableMessage(
  missingFolders: readonly string[],
): string {
  if (missingFolders.length === 0) return "";
  const plural = missingFolders.length !== 1;
  return `The folder${plural ? "s" : ""} ${missingFolders.join(", ")} ${
    plural ? "are" : "is"
  } no longer available (deleted from disk).`;
}

/**
 * Official updateSession spaceId change notify:
 *   g ? `This session is now in the "${g}" Space.` : "This session is no longer in a Space."
 */
export function coworkSessionSpaceChangedMessage(
  spaceName: string | null | undefined,
): string {
  return spaceName
    ? `This session is now in the "${spaceName}" Space.`
    : "This session is no longer in a Space.";
}

/**
 * Official rG(e): native ToolSearch bulk models (opus-4-6 / sonnet-4-6 [1m]).
 * Used by setModel notify CU suffix when leaving these models.
 */
export function isCoworkNativeToolSearchModel(
  model: string | null | undefined,
): boolean {
  return model
    ? /opus-4-6/.test(model) || /sonnet-4-6.*\[1m\]/.test(model)
    : false;
}

/**
 * Official setModel ToolSearch CU discovery suffix (leading space + U+2014).
 * Appended when old model rG true and new model rG false.
 */
export const COWORK_MODEL_SWITCH_TOOLSEARCH_CU_SUFFIX =
  " Chrome and Computer Use tools are now discovered via ToolSearch \u2014 load them in bulk (one query for the whole server) rather than one-by-one.";

/**
 * Official setModel notify:
 *   `Model switched to ${label}.${suffix?}`
 * Product uses the assigned model id as label (overrideLabel residual omitted).
 */
export function coworkModelSwitchedMessage(
  modelLabel: string,
  options: {
    previousModel?: string | null;
    nextModel?: string | null;
  } = {},
): string {
  const previous = options.previousModel ?? undefined;
  const next = options.nextModel ?? modelLabel;
  const suffix =
    isCoworkNativeToolSearchModel(previous) &&
    !isCoworkNativeToolSearchModel(next)
      ? COWORK_MODEL_SWITCH_TOOLSEARCH_CU_SUFFIX
      : "";
  return `Model switched to ${modelLabel}.${suffix}`;
}

/**
 * Official setModel ft branch: queue Model switched notify, else invalidate built*.
 */
export function notifyCoworkModelSwitched(
  session: CoworkSessionRuntimeState,
  modelLabel: string,
  options: {
    previousModel?: string | null;
    nextModel?: string | null;
    preferSessionNotifications?: boolean;
  } = {},
): "queued" | "invalidated" {
  const prefer = options.preferSessionNotifications !== false;
  if (prefer) {
    queueCoworkSessionNotification(
      session,
      coworkModelSwitchedMessage(modelLabel, {
        previousModel: options.previousModel,
        nextModel: options.nextModel ?? modelLabel,
      }),
    );
    return "queued";
  }
  invalidateCoworkBuiltPromptAndTools(session);
  return "invalidated";
}

/**
 * Official updateSession title branch (pure apply):
 *   source = titleSource ?? "user"
 *   refuse auto when existing titleSource === "user"
 *   else title = t.title; titleSource = source
 */
export function applyCoworkSessionTitleUpdate(
  session: CoworkSessionRuntimeState,
  update: { title?: string | null; titleSource?: "auto" | "user" },
): "applied" | "refused" | "noop" {
  if (update.title === undefined) return "noop";
  const source = update.titleSource ?? "user";
  if (source === "auto" && session.titleSource === "user") {
    return "refused";
  }
  // Official: i.title = t.title; i.titleSource = source (empty string kept).
  session.title = update.title ?? undefined;
  session.titleSource = source;
  return "applied";
}

/** Official strip for widget/CU hint tool_name / title / bundleId (`o.replace(/[<>]/g,"")`). */
export function stripCoworkHintAngleBrackets(value: string): string {
  return value.replace(/[<>]/g, "");
}

/**
 * Official lRA = `mcp__${SB}__${qUA}` with SB="cowork", qUA="read_widget_context".
 */
export const COWORK_READ_WIDGET_CONTEXT_TOOL =
  "mcp__cowork__read_widget_context";

/**
 * Official appendWidgetContextHint(A,t):
 *   empty widgetToolStates → t
 *   else append <widget_context_hint> with unique sanitized tool_names + lRA.
 * Does not clear widgetToolStates (session field retained until next assign).
 */
export function appendCoworkWidgetContextHint(
  session: Pick<CoworkSessionRuntimeState, "widgetToolStates">,
  message: string,
): string {
  const states = session.widgetToolStates;
  if (!(states != null && states.length)) return message;
  const names = [
    ...new Set(
      states.map((state) => stripCoworkHintAngleBrackets(state.tool_name)),
    ),
  ];
  return `${message}

<widget_context_hint>Interactive widgets in this conversation: ${names.join(", ")}. To read a widget's current state, load ${COWORK_READ_WIDGET_CONTEXT_TOOL} (via ToolSearch if deferred) and call it with the widget's tool_name.</widget_context_hint>`;
}

/**
 * Official appendCuWindowHint(A,t):
 *   empty cuMentionedWindows → t
 *   else format windows, **clear** cuMentionedWindows, append <cu_window_hints>
 *   (U+2014 em dash in "find it — do not").
 */
export function appendCoworkCuWindowHint(
  session: Pick<CoworkSessionRuntimeState, "cuMentionedWindows">,
  message: string,
): string {
  const windows = session.cuMentionedWindows;
  if (!(windows != null && windows.length)) return message;
  const list = windows
    .map(
      (window) =>
        `window "${stripCoworkHintAngleBrackets(window.title)}" (already open; pass ${stripCoworkHintAngleBrackets(window.bundleId)} to request_access)`,
    )
    .join(", ");
  session.cuMentionedWindows = undefined;
  return `${message}

<cu_window_hints>The user is pointing at: ${list}. Take a screenshot to find it \u2014 do not open_application for it.</cu_window_hints>`;
}

/**
 * Official pre-user-message hint order:
 *   appendWidgetContextHint(session, appendCuWindowHint(session, message))
 * i.e. CU first (clears mentions), then widget.
 */
export function appendCoworkPreUserMessageHints(
  session: Pick<
    CoworkSessionRuntimeState,
    "cuMentionedWindows" | "widgetToolStates"
  >,
  message: string,
): string {
  return appendCoworkWidgetContextHint(
    session,
    appendCoworkCuWindowHint(session, message),
  );
}

/**
 * Official leavingRunning CU ephemerals (product-owned subset):
 *   A.cuMentionedWindows = void 0
 *   A.widgetToolStates = void 0
 *   A.cicOnceApproved = void 0 (finishTurnCleanup / leavingRunning)
 * Residual not invented: cuHiddenDuringTurn/auto-unhide, cuHiddenPendingNote,
 * cuClipboardStash restore, teachMode exit, full Ds NotificationService.
 */
export function clearCoworkSessionEphemeralsOnLeavingRunning(
  session: Pick<
    CoworkSessionRuntimeState,
    | "_turnInterruptRequested"
    | "cicOnceApproved"
    | "cuMentionedWindows"
    | "widgetToolStates"
  >,
): void {
  session.cuMentionedWindows = undefined;
  session.widgetToolStates = undefined;
  // Official finishTurnCleanup / leavingRunning: cicOnceApproved=void 0
  session.cicOnceApproved = undefined;
  // Official transitionTo("idle"): A._turnInterruptRequested=void 0
  session._turnInterruptRequested = undefined;
}

/**
 * Official stopSession accumulate (after idle / optional close emit):
 *   i.cachedTotalTurns = (i.cachedTotalTurns ?? 0)
 *     + i.messageBuffer.filter(s => s.type === "user").length
 *   i.messageBuffer = []
 *
 * Runtime-only counter for ft("658929541") mid-session model lock.
 * Not in IXi persist schema — do not invent disk persistence.
 */
export function accumulateCoworkCachedTotalTurnsOnStop(
  session: Pick<
    CoworkSessionRuntimeState,
    "cachedTotalTurns" | "messageBuffer"
  >,
): void {
  session.cachedTotalTurns =
    (session.cachedTotalTurns ?? 0) +
    session.messageBuffer.filter((m) => m.type === "user").length;
  session.messageBuffer = [];
}

/**
 * Official non-host-loop mountFolderForSession when !vmProcessId || !vmProcessName:
 *   `You now have access to ${r}. It will be available at /sessions/{vm}/mnt/${Zn(Q)} on next resume.`
 * `{vm}` is the official literal placeholder (not session.vmProcessName).
 */
export function coworkQueuedMountNextResumeMessage(
  folderPath: string,
  mountName: string,
): string {
  return `You now have access to ${folderPath}. It will be available at /sessions/{vm}/mnt/${mountName} on next resume.`;
}

/**
 * Official ws.getSpace shape used by buildSpaceContextReminder (name required;
 * description / instructions / links optional).
 */
export type CoworkSpaceContext = {
  description?: string | null;
  instructions?: string | null;
  links?: Array<{ title?: string | null; url: string }> | null;
  name: string;
};

/**
 * Official buildSpaceContextReminder(spaceId) pure body (after ws.peek().getSpace):
 *   if !space return undefined
 *   parts: organized-into project; optional description/instructions/links
 *   wrap `<system-reminder>${parts.join(" ")}</system-reminder>`
 * Product injects space object — no invented Spaces store.
 */
export function buildCoworkSpaceContextReminder(
  space: CoworkSpaceContext | null | undefined,
): string | undefined {
  if (!space) return undefined;
  const sanitize = stripCoworkHintAngleBrackets;
  const parts = [
    `This session has been organized into the "${sanitize(space.name)}" project.`,
  ];
  if (space.description) {
    parts.push(`Project description: ${sanitize(space.description)}`);
  }
  if (space.instructions) {
    parts.push(`Project instructions: ${sanitize(space.instructions)}`);
  }
  const links = space.links ?? [];
  if (links.length > 0) {
    const list = links
      .map((link) =>
        link.title
          ? `${sanitize(link.title)} (${sanitize(link.url)})`
          : sanitize(link.url),
      )
      .join(", ");
    parts.push(`Project links: ${list}`);
  }
  return `<system-reminder>${parts.join(" ")}</system-reminder>`;
}

/**
 * Official worktree deleted fallback pendingSystemReminder (U+2014).
 */
export function coworkWorktreeDeletedSystemReminder(
  worktreePath: string,
  originCwd: string,
): string {
  return `<system-reminder>
The git worktree at ${worktreePath} was deleted. This session now operates on the origin repository at ${originCwd}. File paths from earlier in the conversation that reference the worktree no longer exist \u2014 re-read files from the origin repository as needed.
</system-reminder>`;
}

/**
 * Official worktree recycled / re-leased fallback pendingSystemReminder (U+2014).
 */
export function coworkWorktreeRecycledSystemReminder(
  oldWorktreePath: string,
  newCwd: string,
  branch: string,
): string {
  return `<system-reminder>
The git worktree at ${oldWorktreePath} was recycled. This session now operates on a fresh worktree at ${newCwd}, checked out to the same branch (${branch}). Absolute paths from earlier in the conversation that reference the old worktree no longer exist \u2014 re-read files from the new path as needed.
</system-reminder>`;
}

/**
 * Official land/fallback: assign pendingSystemReminder then save (caller saves).
 */
export function setCoworkPendingSystemReminder(
  session: Pick<CoworkSessionRuntimeState, "pendingSystemReminder">,
  reminder: string | undefined,
): void {
  session.pendingSystemReminder = reminder;
}

/**
 * Official non-host-loop queued-for-next-resume notify branch:
 *   ft ? queueSessionNotification(next-resume msg) : DANGEROUS_invalidate...
 */
export function notifyCoworkQueuedMountNextResume(
  session: CoworkSessionRuntimeState,
  folderPath: string,
  mountName: string,
  options: { preferSessionNotifications?: boolean } = {},
): "queued" | "invalidated" {
  const prefer = options.preferSessionNotifications !== false;
  if (prefer) {
    queueCoworkSessionNotification(
      session,
      coworkQueuedMountNextResumeMessage(folderPath, mountName),
    );
    return "queued";
  }
  invalidateCoworkBuiltPromptAndTools(session);
  return "invalidated";
}

/**
 * Official updateSession spaceId branch (pure apply):
 *   setBy = spaceIdSetBy==="auto" ? "auto" : "user"
 *   refuse auto write when existing spaceIdSetBy==="user"
 *   spaceId = t.spaceId || void 0; spaceIdSetBy = spaceId ? setBy : void 0
 *   !spaceId → pendingSystemReminder = void 0
 *   spaceId changed && prefer → queue Space message (name from getSpaceName)
 * returns whether spaceId field was applied (false if refused).
 */
export function applyCoworkSessionSpaceIdUpdate(
  session: CoworkSessionRuntimeState,
  update: { spaceId?: string | null; spaceIdSetBy?: "auto" | "user" },
  options: {
    preferSessionNotifications?: boolean;
    getSpaceName?: (spaceId: string) => string | null | undefined;
  } = {},
): "applied" | "refused" | "noop" {
  if (update.spaceId === undefined) return "noop";
  const setBy = update.spaceIdSetBy === "auto" ? "auto" : "user";
  if (setBy === "auto" && session.spaceIdSetBy === "user") {
    return "refused";
  }
  const previous = session.spaceId;
  const next = update.spaceId || undefined;
  session.spaceId = next;
  session.spaceIdSetBy = next ? setBy : undefined;
  if (!next) {
    session.pendingSystemReminder = undefined;
  }
  if (next !== previous) {
    const prefer = options.preferSessionNotifications !== false;
    if (prefer) {
      const name = next ? options.getSpaceName?.(next) : undefined;
      queueCoworkSessionNotification(
        session,
        coworkSessionSpaceChangedMessage(name),
      );
    } else {
      // Official only queues when ft; no invalidate on space change path.
    }
  }
  return "applied";
}

/**
 * Official queueSessionNotification(A,t):
 *   sanitize <> ; skip if identical to last; push; caller saves.
 */
export function queueCoworkSessionNotification(
  session: Pick<CoworkSessionRuntimeState, "pendingNotifications">,
  message: string,
): boolean {
  const sanitized = message.replace(/[<>]/g, "");
  const pending = session.pendingNotifications;
  if (pending.at(-1) === sanitized) return false;
  pending.push(sanitized);
  return true;
}

/**
 * Official DANGEROUS_invalidateBuiltPromptAndTools(A):
 *   builtGen++, clear builtSystemPrompt / builtTools / builtAllowedTools / builtLocalMcpServers.
 * Product only touches fields when present (optional residual until full UXe cache).
 */
export function invalidateCoworkBuiltPromptAndTools(
  session: CoworkSessionRuntimeState,
): void {
  session.builtGen = (session.builtGen ?? 0) + 1;
  session.builtSystemPrompt = undefined;
  session.builtTools = undefined;
  session.builtAllowedTools = undefined;
  session.builtLocalMcpServers = undefined;
}

/**
 * Official drainPendingNotifications(A,t):
 *   empty → t
 *   !ft → clear pending, return t
 *   else join("\n\n"), wrap system-reminder, clear pending
 */
export function drainCoworkPendingNotifications(
  session: Pick<CoworkSessionRuntimeState, "pendingNotifications" | "sessionId">,
  message: string,
  options: { preferSessionNotifications?: boolean } = {},
): string {
  if (session.pendingNotifications.length === 0) return message;
  const prefer = options.preferSessionNotifications !== false;
  if (!prefer) {
    session.pendingNotifications = [];
    return message;
  }
  const joined = session.pendingNotifications.join("\n\n");
  session.pendingNotifications = [];
  return `${message}\n\n<system-reminder>\n${joined}\n</system-reminder>`;
}

/**
 * Official mountFolderForSession host-loop notify branch:
 *   ft ? queueSessionNotification(access msg) : DANGEROUS_invalidateBuiltPromptAndTools
 */
export function notifyCoworkHostLoopFolderAccess(
  session: CoworkSessionRuntimeState,
  folderPath: string,
  networkDrive: boolean,
  options: { preferSessionNotifications?: boolean } = {},
): "queued" | "invalidated" {
  const prefer = options.preferSessionNotifications !== false;
  if (prefer) {
    queueCoworkSessionNotification(
      session,
      coworkHostLoopFolderAccessMessage(folderPath, networkDrive),
    );
    return "queued";
  }
  invalidateCoworkBuiltPromptAndTools(session);
  return "invalidated";
}
