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
    replaceEnabledMcpTools: vi.fn(async () => ({
      enabledMcpTools: { "local:demo:tool": true },
    })),
    replaceRemoteMcpServers: vi.fn(async () => ({
      enabledMcpTools: { "local:demo:tool": true },
    })),
    setMcpServers: vi.fn(async () => ({
      enabledMcpTools: { "local:demo:tool": true },
    })),
    setDraftSessionFolders: vi.fn(),
    openOutputsDir: vi.fn(async () => undefined),
    setFocusedSession: vi.fn(),
    submitTranscriptFeedback: vi.fn(async () => true),
    getTranscriptFeedback: vi.fn(async () => []),
    shareSession: vi.fn(async () => ({
      success: true,
      filePath: "/tmp/session-export.zip",
    })),
    setChromePermissionMode: vi.fn(() => true),
    noteCuWindowMentions: vi.fn(),
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

it("normalizes egressAllowedDomains and otelConfig on start", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);

  await handlers.start?.(event, {
    message: "hello",
    egressAllowedDomains: ["api.example.com", "", 12, "*.internal.com"],
    otelConfig: {
      endpoint: "https://otel.example.com:4318/v1/traces",
      protocol: "http/protobuf",
      headers: { a: "b" },
    },
  });

  expect(instance.start).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "hello",
      egressAllowedDomains: ["api.example.com", "*.internal.com"],
      otelConfig: {
        endpoint: "https://otel.example.com:4318/v1/traces",
        protocol: "http/protobuf",
        headers: { a: "b" },
        resourceAttributes: undefined,
      },
    }),
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

it("forwards replaceEnabledMcpTools sessionId + tools payload", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);
  const payload = { tools: { "local:demo:tool": true } };

  await expect(
    handlers.replaceEnabledMcpTools?.(event, "session-1", payload),
  ).resolves.toEqual({ enabledMcpTools: { "local:demo:tool": true } });
  expect(instance.replaceEnabledMcpTools).toHaveBeenCalledWith(
    "session-1",
    payload,
  );
});

it("forwards replaceRemoteMcpServers sessionId + servers array", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);
  const servers = [
    {
      name: "remote-demo",
      tools: [{ name: "t1" }],
      toolKeys: ["t1"],
      uuid: "uuid-1",
    },
  ];

  await expect(
    handlers.replaceRemoteMcpServers?.(event, "session-1", servers),
  ).resolves.toEqual({ enabledMcpTools: { "local:demo:tool": true } });
  expect(instance.replaceRemoteMcpServers).toHaveBeenCalledWith(
    "session-1",
    servers,
  );
});

it("forwards setMcpServers sessionId + servers array", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);
  const servers = [
    {
      enabled: true,
      name: "remote-demo",
      toolKeys: ["t1"],
      uuid: "uuid-1",
    },
  ];

  await expect(
    handlers.setMcpServers?.(event, "session-1", servers),
  ).resolves.toEqual({ enabledMcpTools: { "local:demo:tool": true } });
  expect(instance.setMcpServers).toHaveBeenCalledWith("session-1", servers);
});

it("forwards setDraftSessionFolders string array and rejects non-strings", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);

  await handlers.setDraftSessionFolders?.(event, ["/a", "/b"]);
  expect(instance.setDraftSessionFolders).toHaveBeenCalledWith(["/a", "/b"]);

  await expect(
    handlers.setDraftSessionFolders?.(event, ["/a", 12] as never),
  ).rejects.toThrow(/folders/);
});

it("forwards openOutputsDir and noteCuWindowMentions", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);

  await handlers.openOutputsDir?.(event, "session-1");
  expect(instance.openOutputsDir).toHaveBeenCalledWith("session-1");

  const apps = [
    {
      bundleId: "com.apple.Notes",
      displayName: "Notes",
      title: "Shopping",
      windowId: 1,
    },
  ];
  await handlers.noteCuWindowMentions?.(event, "session-1", apps);
  expect(instance.noteCuWindowMentions).toHaveBeenCalledWith("session-1", [
    { bundleId: "com.apple.Notes", title: "Shopping" },
  ]);
});

it("forwards setFocusedSession null|string and rejects non-string non-null", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);

  await handlers.setFocusedSession?.(event, "session-1");
  expect(instance.setFocusedSession).toHaveBeenCalledWith("session-1");

  await handlers.setFocusedSession?.(event, null);
  expect(instance.setFocusedSession).toHaveBeenCalledWith(null);

  await expect(handlers.setFocusedSession?.(event, 12 as never)).rejects.toThrow(
    /sessionId/,
  );
});

it("forwards transcript feedback and rejects G$A-invalid feedback", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);
  const feedback = {
    freeText: "x",
    steps: [{ toolUseId: "t", thumb: null, note: null }],
    submittedAt: 1,
  };

  await expect(
    handlers.submitTranscriptFeedback?.(event, "session-1", feedback),
  ).resolves.toBe(true);
  expect(instance.submitTranscriptFeedback).toHaveBeenCalledWith(
    "session-1",
    feedback,
  );

  await expect(
    handlers.submitTranscriptFeedback?.(event, "session-1", { freeText: 1 }),
  ).rejects.toThrow(/feedback/);

  await expect(
    handlers.getTranscriptFeedback?.(event, "session-1"),
  ).resolves.toEqual([]);
  expect(instance.getTranscriptFeedback).toHaveBeenCalledWith("session-1");
});

it("forwards shareSession and validates RUe result shape", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);

  await expect(handlers.shareSession?.(event, "session-1")).resolves.toEqual({
    success: true,
    filePath: "/tmp/session-export.zip",
  });
  expect(instance.shareSession).toHaveBeenCalledWith("session-1");

  await expect(handlers.shareSession?.(event, 12 as never)).rejects.toThrow(
    /sessionId/,
  );

  vi.mocked(instance.shareSession).mockResolvedValueOnce({
    success: "yes",
  } as never);
  await expect(handlers.shareSession?.(event, "session-1")).rejects.toThrow(
    /Result from method "shareSession"/,
  );
});

it("forwards setChromePermissionMode with QV mode validation", async () => {
  const instance = manager();
  const handlers = createCoworkSessionHandlers(instance);

  await expect(
    handlers.setChromePermissionMode?.(
      event,
      "session-1",
      "skip_all_permission_checks",
    ),
  ).resolves.toBe(true);
  expect(instance.setChromePermissionMode).toHaveBeenCalledWith(
    "session-1",
    "skip_all_permission_checks",
  );

  await expect(
    handlers.setChromePermissionMode?.(event, "session-1", "ask"),
  ).resolves.toBe(true);
  await expect(
    handlers.setChromePermissionMode?.(event, "session-1", "follow_a_plan"),
  ).resolves.toBe(true);

  await expect(
    handlers.setChromePermissionMode?.(event, 12 as never, "ask"),
  ).rejects.toThrow(/sessionId/);
  await expect(
    handlers.setChromePermissionMode?.(event, "session-1", "bypass" as never),
  ).rejects.toThrow(/mode/);

  vi.mocked(instance.setChromePermissionMode).mockReturnValueOnce("yes" as never);
  await expect(
    handlers.setChromePermissionMode?.(event, "session-1", "ask"),
  ).rejects.toThrow(/Result from method "setChromePermissionMode"/);
});
