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
 * When host `signalTurnComplete` / markNotRunning must fire for a CLI stream message.
 *
 * Official primary: stream-json `type:"result"` (and createBaseHooks Stop).
 * Product residual (observed 3p/gateway turns): CLI may emit final assistant with
 * `message.stop_reason === "end_turn"` and write `system/stop_hook_summary` to jsonl
 * **without** a stream-json `result` row — host then sticks isRunning=true (Stop/Esc
 * pill never clears). Mirror those durable turn-end signals so LocalSessionManager
 * settles the same way as result/Stop.
 *
 * Do **not** settle on assistant without end_turn (partial / tool_use mid-turn).
 * Do **not** invent userData message storage — only host running flags.
 */
export function shouldSignalTurnCompleteFromCliMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== "object") return false;
  const record = msg as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "result") return true;
  if (type === "system" && record.subtype === "stop_hook_summary") return true;
  if (type === "assistant") {
    const message =
      record.message && typeof record.message === "object"
        ? (record.message as Record<string, unknown>)
        : null;
    const stopReason =
      message && typeof message.stop_reason === "string" ? message.stop_reason : null;
    // Final assistant of the turn (not tool_use / max_tokens mid-stream).
    if (stopReason === "end_turn") return true;
  }
  return false;
}

/**
 * Official LocalSessionManager multi-turn residual (app.asar):
 * After parent `result`, CCD **does not** endInput / kill the Query process.
 * `signalTurnComplete` → `markNotRunning` only; query + inputStream stay warm so
 * the next `sendMessage` is `inputStream.enqueue` (not cold `--resume`).
 *
 * densable print maps that to: keep stdin open after result (permission-prompt-tool
 * stdio + stream-json is bidirectional — same as Query.hasBidirectionalNeeds).
 * Only stopSession / interrupt-fallback / idle pause ends the process.
 *
 * Pending can_use_tool / open task bookends also keep stdin open (stop_task path).
 * Bookend task_id set only — never Agent tool_use call-id leftovers.
 *
 * Returns true only when stdin is already closed (nothing left to end) or host
 * explicitly wants teardown — normal post-result path returns **false** (warm).
 */
export function shouldEndStdinAfterResult(input: {
  pendingPermissionCount: number;
  /** Count of system task_started bookend task_ids still open (stoppable). */
  openStoppableTaskCount?: number;
  stdinDestroyed?: boolean;
  stdinWritableEnded?: boolean;
  /**
   * Official warm multi-turn: never end stdin after a settled result.
   * When true (default for CCD align), always keep process for next enqueue.
   */
  keepWarmAfterResult?: boolean;
}): boolean {
  if (input.stdinDestroyed || input.stdinWritableEnded) return false;
  // Official: keep query warm after result (sendMessage → enqueue, not re-spawn).
  if (input.keepWarmAfterResult !== false) return false;
  if (input.pendingPermissionCount > 0) return false;
  if ((input.openStoppableTaskCount ?? 0) > 0) return false;
  return true;
}

/**
 * Official sendMessage warm path: query + inputStream exist and not mid-turn
 * (`!isRunning` / densable `sawResult`) → write next user line on the same stdin.
 *
 * densable: after parent `result` (or warmSession ready), stdin still open →
 * continueActiveTurn, not cold `--resume` spawn.
 *
 * Mid-stream (`!sawResult`) must refuse (still the same turn → deferredSends).
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
 * Only when stdin was already ended (stop / crash / legacy endInput) and the
 * child is draining: detach so a fresh spawn can start. Warm multi-turn never
 * ends stdin after result, so this stays false while the process is alive.
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
 * After result (warm): canContinueOnStdin → enqueue path, not deferred.
 */
export function shouldDeferMidStreamSend(input: {
  hasActiveTurn: boolean;
  canContinueOnStdin: boolean;
  canDetachDrained: boolean;
}): boolean {
  if (!input.hasActiveTurn) return false;
  // Follow-up after parent result → continue on warm stdin (or detach+spawn if dead).
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
 * Official residual (app.asar LocalSessionManager + Query + ProcessTransport):
 * - interruptSession no query → emit close code 0 + stopSession (not FM).
 * - interruptSession success → signalTurnComplete → markNotRunning / drain only.
 * - query iterator **clean complete** after result → teardownQuery only (no type:"error").
 * - type:"error" + close code 1 only on handleQueryError / idle timeout / auth teardown.
 * - ProcessTransport getProcessExitError: non-zero → Error; Query.readMessages: after
 *   successful result (`lastErrorResultText=void 0`) process exit is cleanup, not
 *   "Claude Code returned an error result".
 * - User stop: isStopping → "query interrupted (intentional stop)" — no FM.
 *
 * densable print maps user stop → SIGTERM 143 / Windows taskkill; post-result drain
 * often exits code 1. Those must not emitError when userStopped or sawResult.
 */
export function shouldEmitProcessExitError(input: {
  exitCode: number | null | undefined;
  userStopped: boolean;
  /** Parent stream-json `result` already delivered for this child. */
  sawResult?: boolean;
}): boolean {
  if (input.userStopped) return false;
  if (input.sawResult) return false;
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
