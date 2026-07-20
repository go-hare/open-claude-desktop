/**
 * Official prompt_suggestion + _suggestionTimeout pure helpers
 * (app.asar LocalAgentModeSessionManager query loop / stopSession / sendMessage).
 *
 * Anchors:
 *   - stream: type==="prompt_suggestion" → assign suggestion, save, emit,
 *     clear timeout + transitionTo idle when waiting for suggestion
 *   - stopSession head: clearTimeout(_suggestionTimeout); promptSuggestion=void 0
 *   - sendMessage head: clear timeout + promptSuggestion=void 0 (+ isAgentCompleted=false)
 *   - success result: sessionType!==DE && ft("1942781881") → arm 5s then idle
 * Residual: real Statsig ft("1942781881") product gate (inject only); DE dispatch type
 * product mapping when arm inject enabled; full idleGrace process reuse not invented.
 */

import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

/** Official setTimeout(..., 5e3) after success when suggestion grace gate on. */
export const COWORK_PROMPT_SUGGESTION_TIMEOUT_MS = 5_000;

export type CoworkPromptSuggestionSession = Pick<
  CoworkSessionRuntimeState,
  | "_suggestionTimeout"
  | "isAgentCompleted"
  | "lifecycleState"
  | "promptSuggestion"
  | "_turnInterruptRequested"
>;

/**
 * Official: clearTimeout + void 0 field. Returns whether a timer was cleared.
 */
export function clearCoworkPromptSuggestionTimeout(
  session: Pick<CoworkPromptSuggestionSession, "_suggestionTimeout">,
): boolean {
  if (!session._suggestionTimeout) return false;
  clearTimeout(session._suggestionTimeout);
  session._suggestionTimeout = undefined;
  return true;
}

/**
 * Official stopSession / sendMessage head:
 *   clearTimeout(_suggestionTimeout); promptSuggestion=void 0
 * Returns whether a timer was cleared (for optional session_updated).
 */
export function clearCoworkPromptSuggestionState(
  session: Pick<
    CoworkPromptSuggestionSession,
    "_suggestionTimeout" | "promptSuggestion"
  >,
): { clearedTimeout: boolean } {
  const clearedTimeout = clearCoworkPromptSuggestionTimeout(session);
  session.promptSuggestion = undefined;
  return { clearedTimeout };
}

/**
 * Official sendMessage head also:
 *   isAgentCompleted=false (after snapshot for session_updated)
 * Returns flags for optional emit.
 */
export function prepareCoworkSendMessageSuggestionClear(
  session: Pick<
    CoworkPromptSuggestionSession,
    "_suggestionTimeout" | "promptSuggestion" | "isAgentCompleted"
  >,
): { clearedTimeout: boolean; clearedAgentCompleted: boolean } {
  const clearedTimeout = clearCoworkPromptSuggestionTimeout(session);
  session.promptSuggestion = undefined;
  const clearedAgentCompleted = session.isAgentCompleted === true;
  session.isAgentCompleted = false;
  return { clearedTimeout, clearedAgentCompleted };
}

/**
 * Official prompt_suggestion stream handler:
 *   promptSuggestion = suggestion
 *   if _suggestionTimeout: clear + transition idle
 * Does not buffer the stream object into messageBuffer (caller continues).
 */
export function applyCoworkPromptSuggestionMessage(
  session: CoworkPromptSuggestionSession,
  suggestion: string,
): { clearedTimeout: boolean; transitionedToIdle: boolean } {
  session.promptSuggestion = suggestion;
  if (!session._suggestionTimeout) {
    return { clearedTimeout: false, transitionedToIdle: false };
  }
  clearCoworkPromptSuggestionTimeout(session);
  session.lifecycleState = "idle";
  // Official transitionTo("idle") also clears _turnInterruptRequested.
  session._turnInterruptRequested = undefined;
  return { clearedTimeout: true, transitionedToIdle: true };
}

/**
 * Official success-result arm (when gate on and no pending input):
 *   clear existing; setTimeout 5s → void field + transitionTo idle
 * Product: caller supplies schedule + onFire; this only decides + wires field.
 *
 * Returns true when armed (caller should NOT idle immediately).
 */
export function armCoworkPromptSuggestionTimeout(
  session: Pick<
    CoworkPromptSuggestionSession,
    "_suggestionTimeout" | "lifecycleState" | "_turnInterruptRequested"
  >,
  options: {
    delayMs?: number;
    onFire: () => void;
    schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  },
): boolean {
  const delayMs = options.delayMs ?? COWORK_PROMPT_SUGGESTION_TIMEOUT_MS;
  const schedule = options.schedule ?? setTimeout;
  clearCoworkPromptSuggestionTimeout(session);
  session._suggestionTimeout = schedule(() => {
    session._suggestionTimeout = undefined;
    options.onFire();
  }, delayMs);
  return true;
}

/**
 * Official: extract string suggestion from stream message.
 * Missing/non-string → empty string (still assign + emit like product save).
 */
export function coworkPromptSuggestionText(message: {
  suggestion?: unknown;
  [key: string]: unknown;
}): string {
  return typeof message.suggestion === "string" ? message.suggestion : "";
}
