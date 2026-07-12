import { expect, it, vi } from "vitest";
import { createRuntimeState } from "../coworkSessions/coworkSessionState";
import { createCoworkTranscriptReader } from "./coworkTranscriptReader";

it("prefers the official raw transcript so tool result metadata survives reload", async () => {
  const session = createRuntimeState(
    { message: "hello", userSelectedFolders: ["/tmp/project"] },
    "local_session-1",
    "session-1",
    1,
  );
  session.cliSessionId = "cli-session-1";
  session.hostLoopMode = true;
  session.messageBuffer = [
    { type: "assistant", uuid: "assistant-1" },
    { subtype: "success", type: "result" },
  ];
  const load = vi.fn(async () => [
    {
      message: { content: [] },
      parent_tool_use_id: null,
      session_id: "cli-session-1",
      type: "assistant" as const,
      uuid: "assistant-1",
    },
  ]);
  const loadRaw = vi.fn(async () => [
    {
      message: {
        content: [
          {
            content: "answer recorded",
            tool_use_id: "ask-1",
            type: "tool_result",
          },
        ],
      },
      toolUseResult: { answers: { Question: "OK" } },
      type: "user",
      uuid: "answer-1",
    },
  ]);

  const transcript = await createCoworkTranscriptReader(load, loadRaw)(session, {
    limit: 10,
  });

  expect(loadRaw).toHaveBeenCalledWith(session, { limit: 10 });
  expect(load).not.toHaveBeenCalled();
  expect(transcript[0]?.toolUseResult).toEqual({ answers: { Question: "OK" } });
});

it("filters canonical transcript types without reading the session message buffer", async () => {
  const session = createRuntimeState({ message: "hello" }, "local_session-1", "session-1", 1);
  session.cliSessionId = "cli-session-1";
  session.messageBuffer = [
    { type: "user", uuid: "user-1" },
    { type: "assistant", uuid: "assistant-1" },
  ];
  const load = vi.fn(async () => [
    {
      message: { content: [] },
      parent_tool_use_id: null,
      session_id: "cli-session-1",
      type: "user" as const,
      uuid: "disk-user-1",
    },
    {
      message: { content: [] },
      parent_tool_use_id: null,
      session_id: "cli-session-1",
      type: "assistant" as const,
      uuid: "disk-assistant-1",
    },
  ]);

  await expect(
    createCoworkTranscriptReader(load, async () => null)(session, {
      types: ["assistant"],
    }),
  ).resolves.toEqual([
    {
      message: { content: [] },
      parent_tool_use_id: null,
      session_id: "cli-session-1",
      type: "assistant",
      uuid: "disk-assistant-1",
    },
  ]);
});

it("returns no transcript before the SDK session id is available", async () => {
  const session = createRuntimeState({ message: "hello" }, "local_session-1", "session-1", 1);
  session.messageBuffer = [{ type: "assistant", uuid: "assistant-1" }];

  await expect(createCoworkTranscriptReader()(session)).resolves.toEqual([]);
});
