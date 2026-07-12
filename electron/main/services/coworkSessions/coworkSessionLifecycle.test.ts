import { expect, it, vi } from "vitest";
import {
  createManagerHarness,
  createTestManager,
} from "./coworkSessionTestUtils";

it("stops and archives without erasing buffered replay messages", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness);
  await manager.start({ message: "hello", messageUuid: "message-1" });

  await manager.stop("local_session_1");
  expect(harness.query.closed).toBe(true);
  expect(manager.getSession("local_session_1")).toMatchObject({
    bufferedMessages: [expect.objectContaining({ uuid: "message-1" })],
    isRunning: false,
  });
  expect(harness.events).toContainEqual({
    code: 0,
    sessionId: "local_session_1",
    type: "close",
  });

  await manager.archive("local_session_1");
  expect(manager.getSession("local_session_1")?.isArchived).toBe(true);
  expect(harness.events).toContainEqual({
    sessionId: "local_session_1",
    type: "archived",
  });
});

it("deletes the independent Cowork session through persistence", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness);
  await manager.start({ message: "hello" });

  await manager.delete("local_session_1");

  expect(manager.getSession("local_session_1")).toBeNull();
  expect(harness.persistence.deleted).toEqual(["local_session_1"]);
});

it("updates canonical sessions and returns raw transcript reader output", async () => {
  const harness = createManagerHarness();
  const transcript = [
    { type: "assistant", uuid: "assistant-from-disk" },
    { subtype: "success", type: "result" },
  ];
  const transcriptReader = vi.fn(async () => transcript);
  const manager = createTestManager(harness, { transcriptReader });
  await manager.start({ message: "hello" });
  await manager.updateSession("local_session_1", {
    isStarred: true,
    title: "Updated Cowork session",
  });

  expect(manager.getAll()).toEqual([
    expect.objectContaining({
      isStarred: true,
      sessionId: "local_session_1",
      title: "Updated Cowork session",
    }),
  ]);
  await expect(
    manager.getTranscript("local_session_1", { limit: 25 }),
  ).resolves.toEqual(transcript);
  expect(transcriptReader).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: "local_session_1" }),
    { limit: 25 },
  );
});
