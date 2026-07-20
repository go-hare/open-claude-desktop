import { expect, it, vi } from "vitest";
import {
  applyCoworkPromptSuggestionMessage,
  armCoworkPromptSuggestionTimeout,
  clearCoworkPromptSuggestionState,
  clearCoworkPromptSuggestionTimeout,
  COWORK_PROMPT_SUGGESTION_TIMEOUT_MS,
  coworkPromptSuggestionText,
  prepareCoworkSendMessageSuggestionClear,
} from "./coworkPromptSuggestionHelpers";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

function session(
  partial: Partial<CoworkSessionRuntimeState> = {},
): CoworkSessionRuntimeState {
  return {
    createdAt: 1,
    cwd: "/sessions/process-1",
    fsDetectedFiles: new Map(),
    inputStream: null,
    isFirstTurn: false,
    lastActivityAt: 1,
    lifecycleState: "running",
    messageBuffer: [],
    pendingNotifications: [],
    processName: "process-1",
    query: null,
    resolvedFolders: [],
    sessionId: "local_session_1",
    vmProcessName: "process-1",
    ...partial,
  };
}

it("BTi-like default suggestion grace is 5e3", () => {
  expect(COWORK_PROMPT_SUGGESTION_TIMEOUT_MS).toBe(5_000);
});

it("coworkPromptSuggestionText prefers string suggestion", () => {
  expect(coworkPromptSuggestionText({ suggestion: "hi" })).toBe("hi");
  expect(coworkPromptSuggestionText({ suggestion: 1 })).toBe("");
  expect(coworkPromptSuggestionText({})).toBe("");
});

it("clearCoworkPromptSuggestionTimeout clears timer field", () => {
  const s = session();
  const handle = setTimeout(() => undefined, 60_000);
  s._suggestionTimeout = handle;
  expect(clearCoworkPromptSuggestionTimeout(s)).toBe(true);
  expect(s._suggestionTimeout).toBeUndefined();
  expect(clearCoworkPromptSuggestionTimeout(s)).toBe(false);
  clearTimeout(handle);
});

it("clearCoworkPromptSuggestionState clears timeout + promptSuggestion", () => {
  const handle = setTimeout(() => undefined, 60_000);
  const s = session({
    _suggestionTimeout: handle,
    promptSuggestion: "try this",
  });
  const out = clearCoworkPromptSuggestionState(s);
  expect(out.clearedTimeout).toBe(true);
  expect(s._suggestionTimeout).toBeUndefined();
  expect(s.promptSuggestion).toBeUndefined();
});

it("prepareCoworkSendMessageSuggestionClear also clears isAgentCompleted", () => {
  const handle = setTimeout(() => undefined, 60_000);
  const s = session({
    _suggestionTimeout: handle,
    promptSuggestion: "x",
    isAgentCompleted: true,
  });
  const out = prepareCoworkSendMessageSuggestionClear(s);
  expect(out).toEqual({ clearedTimeout: true, clearedAgentCompleted: true });
  expect(s.isAgentCompleted).toBe(false);
  expect(s.promptSuggestion).toBeUndefined();
  expect(s._suggestionTimeout).toBeUndefined();
});

it("applyCoworkPromptSuggestionMessage assigns and idles when timeout armed", () => {
  const handle = setTimeout(() => undefined, 60_000);
  const s = session({
    _suggestionTimeout: handle,
    _turnInterruptRequested: true,
    lifecycleState: "running",
  });
  const out = applyCoworkPromptSuggestionMessage(s, "summarize next");
  expect(out).toEqual({ clearedTimeout: true, transitionedToIdle: true });
  expect(s.promptSuggestion).toBe("summarize next");
  expect(s.lifecycleState).toBe("idle");
  expect(s._suggestionTimeout).toBeUndefined();
  expect(s._turnInterruptRequested).toBeUndefined();
});

it("applyCoworkPromptSuggestionMessage without timeout only assigns", () => {
  const s = session({ lifecycleState: "running" });
  const out = applyCoworkPromptSuggestionMessage(s, "only assign");
  expect(out).toEqual({ clearedTimeout: false, transitionedToIdle: false });
  expect(s.promptSuggestion).toBe("only assign");
  expect(s.lifecycleState).toBe("running");
});

it("armCoworkPromptSuggestionTimeout schedules onFire and clears field", () => {
  vi.useFakeTimers();
  const s = session({ lifecycleState: "running" });
  const onFire = vi.fn(() => {
    s.lifecycleState = "idle";
  });
  armCoworkPromptSuggestionTimeout(s, { onFire, delayMs: 5_000 });
  expect(s._suggestionTimeout).toBeDefined();
  vi.advanceTimersByTime(4_999);
  expect(onFire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onFire).toHaveBeenCalledOnce();
  expect(s._suggestionTimeout).toBeUndefined();
  expect(s.lifecycleState).toBe("idle");
  vi.useRealTimers();
});
