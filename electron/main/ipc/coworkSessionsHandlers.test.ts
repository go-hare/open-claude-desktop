import { expect, it, vi } from "vitest";
import type { CoworkSessionManager } from "../services/coworkSessions/coworkSessionManager";
import { createCoworkSessionHandlers } from "./coworkSessionsHandlers";

const event = {
  senderFrame: { parent: null, url: "app://localhost/cowork/session-1" },
} as never;

function manager() {
  return {
    archive: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(() => []),
    getSession: vi.fn(() => null),
    getTranscript: vi.fn(async () => []),
    initialize: vi.fn(async () => undefined),
    respondToToolPermission: vi.fn(),
    rewind: vi.fn(async () => "rewound prompt"),
    sendMessage: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    setPermissionMode: vi.fn(async () => true),
    start: vi.fn(async () => "local_session-1"),
    stop: vi.fn(async () => undefined),
    updateSession: vi.fn(async () => undefined),
  } as unknown as CoworkSessionManager;
}

it("wraps the official manager start result in sessionId", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);

  await expect(
    handlers.start?.(event, { message: "hello", model: "opus" }),
  ).resolves.toEqual({ sessionId: "local_session-1" });
  expect(instance.start).toHaveBeenCalledWith(
    expect.objectContaining({ message: "hello", model: "opus" }),
  );
});

it("passes the official six sendMessage arguments without reshaping", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);
  const images = [{ base64: "aGVsbG8=", mimeType: "image/png" }];
  const files = ["/tmp/report.txt"];
  const toolStates = [{ content: [{ text: "ready", type: "text" }], tool_name: "demo" }];

  await handlers.sendMessage?.(
    event,
    "session-1",
    "hello",
    images,
    files,
    "message-1",
    toolStates,
  );

  expect(instance.sendMessage).toHaveBeenCalledWith(
    "session-1",
    "hello",
    images,
    files,
    "message-1",
    toolStates,
  );
});

it("initializes before reading raw session replay and transcript", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);

  await handlers.getSession?.(event, "session-1", { skipReplay: false });
  await handlers.getTranscript?.(event, "session-1", { limit: 100 });

  expect(instance.initialize).toHaveBeenCalledTimes(2);
  expect(instance.getSession).toHaveBeenCalledWith("session-1", {
    skipReplay: false,
  });
  expect(instance.getTranscript).toHaveBeenCalledWith("session-1", {
    limit: 100,
  });
});

it("forwards permission decisions to the exact-once broker", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);

  await handlers.respondToToolPermission?.(
    event,
    "request-1",
    "once",
    { path: "/safe" },
  );

  expect(instance.respondToToolPermission).toHaveBeenCalledWith(
    "request-1",
    "once",
    { path: "/safe" },
  );
});

it("returns the official rewind prompt result", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);

  await expect(
    handlers.rewind?.(event, "session-1", "user-message-1"),
  ).resolves.toBe("rewound prompt");
  expect(instance.rewind).toHaveBeenCalledWith("session-1", "user-message-1");
});
