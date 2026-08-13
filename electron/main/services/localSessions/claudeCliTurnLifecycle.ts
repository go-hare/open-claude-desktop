/**
 * Pure helpers for Code CLI turn lifecycle (permission spawn + stdin after result).
 *
 * Official Query residual (app.asar ProcessTransport):
 * - After parent `result` + no outstanding can_use_tool → `transport.endInput()`.
 * - Query does **not** gate on Agent tool_use / residual ids.
 *
 * densable Host Tasks Stop residual (print architecture):
 * - Control plane === same child stdin. CLI process often stays alive in
 *   `waiting_for_agents` after parent `result` (bash/monitor/agents), but Host
 *   must keep stdin writable so `control_request stop_task` can reach CLI.
 * - Gate `endInput` on **system task_started bookend task_id** only
 *   (`openStoppableTaskCount`) — never Agent tool_use call ids (those can leak
 *   after TaskOutput residual and would pin stdin forever).
 * - UI isRunning must clear on parent `result` (main spinner); process may still
 *   be open for bookends — that is not “main turn still streaming”.
 *
 * dual-emit CLI (2.7.23+) always closes bookends via system task_notification.
 * Do **not** re-introduce openBackgroundTasks / TaskOutput invent gates.
 * Do **not** invent host-stop transcript bookends on stop_task success —
 * densable Xr echoPending (web) + CLI dual-emit own the stopped UI/durable path.
 * Process-exit host-exit-* residual is separate (child died mid-bookend).
 *
 * Spawn: host session.permissionMode when the web omits mode on send.
 */

export type TerminalTaskStatus = "completed" | "failed" | "stopped" | "killed" | "error";

const TERMINAL_TASK_STATUSES = new Set<string>([
  "completed",
  "failed",
  "stopped",
  "killed",
  "error",
]);

export function isTerminalTaskStatus(status: unknown): boolean {
  return typeof status === "string" && TERMINAL_TASK_STATUSES.has(status);
}

/**
 * Host store is authoritative for spawn when the bridge omits permissionMode.
 * Empty / null / undefined request values must not invent "default" over session.
 */
export function resolveTurnPermissionMode(
  requestPermissionMode: unknown,
  sessionPermissionMode: unknown,
): string {
  const fromRequest =
    typeof requestPermissionMode === "string" && requestPermissionMode.length > 0
      ? requestPermissionMode
      : undefined;
  const fromSession =
    typeof sessionPermissionMode === "string" && sessionPermissionMode.length > 0
      ? sessionPermissionMode
      : undefined;
  const raw = fromRequest ?? fromSession ?? "default";
  if (raw === "bypass") return "bypassPermissions";
  return raw;
}

/**
 * After first parent `result`, end stdin unless:
 * - a can_use_tool control_request is still outstanding, or
 * - densable Tasks Stop residual: a system task_started bookend is still open
 *   (`openStoppableTaskCount`).
 *
 * Bookend task_id set only — never Agent tool_use call-id leftovers.
 */
export function shouldEndStdinAfterResult(input: {
  pendingPermissionCount: number;
  /** Count of system task_started bookend task_ids still open (stoppable). */
  openStoppableTaskCount?: number;
  stdinDestroyed?: boolean;
  stdinWritableEnded?: boolean;
}): boolean {
  if (input.stdinDestroyed || input.stdinWritableEnded) return false;
  if (input.pendingPermissionCount > 0) return false;
  if ((input.openStoppableTaskCount ?? 0) > 0) return false;
  return true;
}

/**
 * densable multi-turn residual: after parent `result`, CLI may keep the same
 * print process + stdin open (`waiting_for_agents` / open bookends). The next
 * user line must write to **that** stdin — not spawn a second child.
 *
 * Only when parent result was already seen and stdin is still writable.
 * Mid-stream (`!sawResult`) must refuse (still the same turn).
 */
export function canContinueActiveTurnOnStdin(input: {
  sawResult: boolean;
  stdinDestroyed?: boolean;
  stdinWritableEnded?: boolean;
}): boolean {
  if (!input.sawResult) return false;
  if (input.stdinDestroyed || input.stdinWritableEnded) return false;
  return true;
}

/**
 * After parent `result` + endInput (no open bookends), stdin is closed but the
 * child may still be draining until process exit. Host must not pin `active`
 * forever or the next send fails with `claude_session_already_running`.
 * Detach so a new spawn can start; close handler is idempotent when active gone.
 */
export function canDetachDrainedActiveTurn(input: {
  sawResult: boolean;
  openStoppableTaskCount?: number;
  stdinDestroyed?: boolean;
  stdinWritableEnded?: boolean;
}): boolean {
  if (!input.sawResult) return false;
  if ((input.openStoppableTaskCount ?? 0) > 0) return false;
  return input.stdinDestroyed === true || input.stdinWritableEnded === true;
}

/**
 * Official LocalSessionManager.sendMessage residual (app.asar):
 *   const c = r.isRunning;
 *   ...
 *   if (c) { (r.deferredSends ??= []).push(B); return; }
 * Mid-stream second send must **queue**, never error `claude_session_already_running`.
 * densable: refuse only when there is no active turn to attach the queue to.
 */
export function shouldDeferMidStreamSend(input: {
  hasActiveTurn: boolean;
  canContinueOnStdin: boolean;
  canDetachDrained: boolean;
}): boolean {
  if (!input.hasActiveTurn) return false;
  // Follow-up after parent result goes to continue / detach+spawn — not deferred.
  if (input.canContinueOnStdin || input.canDetachDrained) return false;
  return true;
}

/** Official deferredSends splice-by-uuid for cancelQueuedMessage. */
export function removeDeferredSendByUuid<T extends { messageUuid?: string }>(
  deferred: T[],
  messageUuid: string,
): { removed: boolean; next: T[] } {
  const uuid = typeof messageUuid === "string" ? messageUuid.trim() : "";
  if (!uuid || deferred.length === 0) return { removed: false, next: deferred };
  const index = deferred.findIndex((item) => item.messageUuid === uuid);
  if (index < 0) return { removed: false, next: deferred };
  const next = deferred.slice(0, index).concat(deferred.slice(index + 1));
  return { removed: true, next };
}

/**
 * densable user-stop residual vs official LocalSessionManager.interrupt / stopSession:
 * Official soft interrupt (or stopSession) settles with close code 0 and never surfaces
 * FM "Something went wrong" for a user Esc. densable print CLI stop() SIGTERM-kills the
 * process group → exit **143** (128+15). That non-zero code must **not** emitError /
 * lastError when the close is from intentional user stop — only real crashes do.
 */
export function shouldEmitProcessExitError(input: {
  exitCode: number | null | undefined;
  userStopped: boolean;
}): boolean {
  if (input.userStopped) return false;
  return input.exitCode != null && input.exitCode !== 0;
}

/**
 * densable Tasks Stop residual: track only system `task_id` bookends.
 * task_started opens; terminal task_notification closes. Ignores tool_use aliases
 * and residual Agent/Workflow tool_use ids so endInput cannot pin forever.
 */
export function applyStoppableTaskBookendEvent(
  openStoppableTasks: Set<string>,
  event: Record<string, unknown>,
): boolean {
  if (stringValue(event.type) !== "system") return false;
  const subtype = stringValue(event.subtype);
  const taskId = stringValue(event.task_id) ?? stringValue(event.taskId);
  if (!taskId) return false;
  if (subtype === "task_started") {
    if (openStoppableTasks.has(taskId)) return false;
    openStoppableTasks.add(taskId);
    return true;
  }
  if (
    subtype === "task_notification"
    || subtype === "task_complete"
    || subtype === "task_completed"
  ) {
    const status = event.status ?? event.task_status ?? event.taskStatus;
    if (status == null || isTerminalTaskStatus(status)) {
      return openStoppableTasks.delete(taskId);
    }
  }
  return false;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
