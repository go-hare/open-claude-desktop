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
