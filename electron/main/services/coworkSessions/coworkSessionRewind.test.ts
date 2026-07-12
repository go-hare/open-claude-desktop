import { expect, it, vi } from "vitest";
import { rewindCoworkSession } from "./coworkSessionRewind";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

function session(
  messages: CoworkSessionRuntimeState["messageBuffer"],
): CoworkSessionRuntimeState {
  return {
    createdAt: 1,
    cwd: "/sessions/test",
    fsDetectedFiles: new Map(),
    inputStream: null,
    isAgentCompleted: true,
    isFirstTurn: false,
    lastActivityAt: 1,
    lifecycleState: "idle",
    messageBuffer: messages,
    pendingNotifications: [],
    processName: "test",
    query: null,
    resolvedFolders: [],
    sessionId: "session-1",
    vmProcessName: "test",
  };
}

it("rewinds to the preceding buffered assistant and returns the user prompt", async () => {
  const state = session([
    { message: { content: "first" }, type: "user", uuid: "user-1" },
    { type: "assistant", uuid: "assistant-1" },
    {
      message: { content: [{ text: "second", type: "text" }] },
      type: "user",
      uuid: "user-2",
    },
  ]);
  const emit = vi.fn();
  const save = vi.fn();

  await expect(
    rewindCoworkSession(
      {
        emit,
        getSession: () => state,
        getTranscript: async () => [],
        now: () => 42,
        save,
        stop: vi.fn(),
      },
      state.sessionId,
      "user-2",
    ),
  ).resolves.toBe("second");

  expect(state).toMatchObject({
    isAgentCompleted: false,
    lastActivityAt: 42,
    messageBuffer: [],
    pendingRewindTo: "assistant-1",
  });
  expect(emit).toHaveBeenCalledWith({
    sessionId: state.sessionId,
    type: "session_updated",
  });
  expect(save).toHaveBeenCalledWith(state);
});

it("uses the transcript parent chain when the target is outside the buffer", async () => {
  const state = session([]);
  const transcript = [
    { type: "assistant", uuid: "assistant-1" },
    {
      message: { content: "retry this" },
      parentUuid: "assistant-1",
      type: "user",
      uuid: "user-2",
    },
  ];

  await expect(
    rewindCoworkSession(
      {
        emit: vi.fn(),
        getSession: () => state,
        getTranscript: async () => transcript,
        now: () => 2,
        save: vi.fn(),
        stop: vi.fn(),
      },
      state.sessionId,
      "user-2",
    ),
  ).resolves.toBe("retry this");
  expect(state.pendingRewindTo).toBe("assistant-1");
});

it("marks a first-message rewind as a fresh continuation", async () => {
  const state = session([
    { message: { content: "first" }, type: "user", uuid: "user-1" },
  ]);

  await rewindCoworkSession(
    {
      emit: vi.fn(),
      getSession: () => state,
      getTranscript: async () => [],
      now: () => 2,
      save: vi.fn(),
      stop: vi.fn(),
    },
    state.sessionId,
    "user-1",
  );

  expect(state.pendingRewindTo).toBe("");
});
