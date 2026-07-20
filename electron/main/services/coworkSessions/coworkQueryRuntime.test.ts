import { expect, it, vi } from "vitest";
import { CoworkQueryRuntime } from "./coworkQueryRuntime";
import type { CoworkSessionEvent } from "./coworkSessionManagerTypes";
import { TestCoworkQuery } from "./coworkSessionTestUtils";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

function runningSession(): CoworkSessionRuntimeState {
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
  };
}

it("forwards stream events raw, buffers canonical messages, and exposes failures", async () => {
  const events: CoworkSessionEvent[] = [];
  const query = new TestCoworkQuery();
  const session = runningSession();
  session.query = query;
  const onQueryCompleted = vi.fn();
  const runtime = new CoworkQueryRuntime({
    emit: (event) => events.push(event),
    isCurrent: () => true,
    now: () => 200,
    onClosed: () => undefined,
    onQueryCompleted,
    query,
    save: () => undefined,
    session,
  });
  const running = runtime.run();
  const streamEvent = { event: { delta: "partial" }, type: "stream_event" };
  query.push(streamEvent);
  query.push({ error: "rate_limit", type: "assistant", uuid: "assistant-1" });
  query.push({ is_error: true, result: "rate limited", type: "result" });
  query.finish();
  await running;

  expect(events).toContainEqual({
    message: streamEvent,
    sessionId: session.sessionId,
    type: "message",
  });
  expect(session.messageBuffer).not.toContain(streamEvent);
  expect(session.messageBuffer.map((message) => message.type)).toEqual([
    "assistant",
    "result",
  ]);
  expect(session).toMatchObject({
    error: "rate limited",
    lifecycleState: "idle",
  });
  expect(onQueryCompleted).toHaveBeenCalledWith(session.sessionId);
});

it("reports a running stream that ends without a result", async () => {
  const events: CoworkSessionEvent[] = [];
  const query = new TestCoworkQuery();
  const session = runningSession();
  session.query = query;
  const runtime = new CoworkQueryRuntime({
    emit: (event) => events.push(event),
    isCurrent: () => true,
    now: () => 200,
    onClosed: () => undefined,
    query,
    save: () => undefined,
    session,
  });

  query.finish();
  await runtime.run();

  expect(session.lifecycleState).toBe("idle");
  expect(events).toContainEqual({
    error: "The session ended unexpectedly. Please try again.",
    sessionId: session.sessionId,
    type: "error",
  });
});

it("failed result with _turnInterruptRequested closes query without error emit", async () => {
  // Official: is_error result + interrupt → close query, idle, queryCompleted;
  // no Turn failed error path. Residual: no trackCycleOutcome/je invent.
  const events: CoworkSessionEvent[] = [];
  const query = new TestCoworkQuery();
  const session = runningSession();
  session.query = query;
  session._turnInterruptRequested = true;
  const onQueryCompleted = vi.fn();
  const runtime = new CoworkQueryRuntime({
    emit: (event) => events.push(event),
    isCurrent: () => true,
    now: () => 200,
    onClosed: () => undefined,
    onQueryCompleted,
    query,
    save: () => undefined,
    session,
  });
  const running = runtime.run();
  query.push({ is_error: true, result: "aborted", type: "result" });
  query.finish();
  await running;

  expect(session.lifecycleState).toBe("idle");
  expect(session.error).toBeUndefined();
  expect(session._turnInterruptRequested).toBeUndefined();
  expect(session.query).toBeNull();
  expect(query.closed).toBe(true);
  expect(onQueryCompleted).toHaveBeenCalledWith(session.sessionId);
  expect(events.some((e) => e.type === "error")).toBe(false);
});

it("suppresses intermediate assistant.error when interrupted (official APIError)", async () => {
  const events: CoworkSessionEvent[] = [];
  const query = new TestCoworkQuery();
  const session = runningSession();
  session.query = query;
  session._turnInterruptRequested = true;
  const runtime = new CoworkQueryRuntime({
    emit: (event) => events.push(event),
    isCurrent: () => true,
    now: () => 200,
    onClosed: () => undefined,
    query,
    save: () => undefined,
    session,
  });
  const running = runtime.run();
  query.push({ error: "aborted", type: "assistant", uuid: "a-1" });
  query.finish();
  await running;

  // Message still buffered/emitted; no error event from suppress path.
  expect(session.messageBuffer.map((m) => m.type)).toContain("assistant");
  expect(events.some((e) => e.type === "error")).toBe(false);
});

it("prompt_suggestion assigns, emits, does not buffer, idles when timeout armed", async () => {
  // Official: type==="prompt_suggestion" → promptSuggestion + emit + clear timeout→idle.
  const events: CoworkSessionEvent[] = [];
  const query = new TestCoworkQuery();
  const session = runningSession();
  session.query = query;
  session._suggestionTimeout = setTimeout(() => undefined, 60_000);
  const runtime = new CoworkQueryRuntime({
    emit: (event) => events.push(event),
    isCurrent: () => true,
    now: () => 200,
    onClosed: () => undefined,
    query,
    save: () => undefined,
    session,
  });
  const running = runtime.run();
  query.push({ suggestion: "try summarizing", type: "prompt_suggestion" });
  query.finish();
  await running;

  expect(session.promptSuggestion).toBe("try summarizing");
  expect(session.lifecycleState).toBe("idle");
  expect(session._suggestionTimeout).toBeUndefined();
  expect(session.messageBuffer.map((m) => m.type)).not.toContain(
    "prompt_suggestion",
  );
  expect(events).toContainEqual({
    data: "try summarizing",
    sessionId: session.sessionId,
    type: "prompt_suggestion",
  });
  expect(
    events.some(
      (e) => e.type === "session_updated" && e.sessionId === session.sessionId,
    ),
  ).toBe(true);
});

it("success result arms suggestion grace when inject on (default off idles)", async () => {
  const events: CoworkSessionEvent[] = [];
  const query = new TestCoworkQuery();
  const session = runningSession();
  session.query = query;
  const onQueryCompleted = vi.fn();
  const runtime = new CoworkQueryRuntime({
    emit: (event) => events.push(event),
    enablePromptSuggestionGrace: () => true,
    isCurrent: () => true,
    now: () => 200,
    onClosed: () => undefined,
    onQueryCompleted,
    query,
    save: () => undefined,
    session,
  });
  const running = runtime.run();
  query.push({ subtype: "success", type: "result" });
  // Keep stream open briefly so arm path does not hit stream-end clear first.
  await Promise.resolve();
  expect(session._suggestionTimeout).toBeDefined();
  expect(session.lifecycleState).toBe("running");
  expect(onQueryCompleted).toHaveBeenCalledWith(session.sessionId);
  // Deliver suggestion while grace armed.
  query.push({ suggestion: "next steps", type: "prompt_suggestion" });
  query.finish();
  await running;
  expect(session.promptSuggestion).toBe("next steps");
  expect(session.lifecycleState).toBe("idle");
  expect(session._suggestionTimeout).toBeUndefined();
});

it("success result without grace inject idles immediately (default)", async () => {
  const query = new TestCoworkQuery();
  const session = runningSession();
  session.query = query;
  const runtime = new CoworkQueryRuntime({
    emit: () => undefined,
    isCurrent: () => true,
    now: () => 200,
    onClosed: () => undefined,
    query,
    save: () => undefined,
    session,
  });
  const running = runtime.run();
  query.push({ subtype: "success", type: "result" });
  query.finish();
  await running;
  expect(session.lifecycleState).toBe("idle");
  expect(session._suggestionTimeout).toBeUndefined();
});
