import { afterEach, expect, it, vi } from "vitest";
import { CoworkPermissionBroker } from "./coworkPermissionBroker";
import type { CoworkPermissionEvent } from "./coworkSessionTypes";

function requestIds(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `request-${index}`;
}

afterEach(() => {
  vi.useRealTimers();
});

it("resolves an allow-once decision and emits resolution exactly once", async () => {
  const events: CoworkPermissionEvent[] = [];
  const broker = new CoworkPermissionBroker({
    createRequestId: requestIds("request-1"),
    emit: (event) => events.push(event),
  });
  const result = broker.requestPermission({
    input: { path: "/tmp" },
    sessionId: "session-1",
    suggestions: [{ type: "addRules" }],
    toolName: "Read",
  });

  broker.respondToToolPermission("request-1", "once", { path: "/safe" });
  broker.respondToToolPermission("request-1", "deny");

  await expect(result).resolves.toEqual({
    behavior: "allow",
    decisionClassification: "user_temporary",
    updatedInput: { path: "/safe" },
  });
  expect(events.map((event) => event.type)).toEqual([
    "tool_permission_request",
    "tool_permission_resolved",
  ]);
  expect(broker.size).toBe(0);
});

it("persists always-allow suggestions but not directory-request rules", async () => {
  const persistAlwaysAllow = vi.fn();
  const broker = new CoworkPermissionBroker({
    createRequestId: requestIds("request-1", "request-2"),
    emit: () => undefined,
    persistAlwaysAllow,
  });
  const suggestions = [{ type: "addRules", rules: ["Read(*)"] }];
  const read = broker.requestPermission({
    input: {},
    sessionId: "session-1",
    suggestions,
    toolName: "Read",
  });
  broker.respondToToolPermission("request-1", "always");

  const directory = broker.requestPermission({
    input: { path: "/tmp" },
    sessionId: "session-1",
    suggestions,
    toolName: "mcp__cowork__request_cowork_directory",
  });
  broker.respondToToolPermission("request-2", "always");

  await expect(read).resolves.toMatchObject({
    updatedPermissions: suggestions,
  });
  await expect(directory).resolves.not.toHaveProperty("updatedPermissions");
  expect(persistAlwaysAllow).toHaveBeenCalledTimes(2);
});

it("supersedes an identical browser permission for the same owner", async () => {
  const events: CoworkPermissionEvent[] = [];
  const broker = new CoworkPermissionBroker({
    createRequestId: requestIds("request-1", "request-2"),
    emit: (event) => events.push(event),
  });
  const request = {
    input: { url: "https://example.com" },
    ownerSessionId: "owner-1",
    sessionId: "child-1",
    toolName: "browser:navigate",
  };
  const first = broker.requestPermission(request);
  const second = broker.requestPermission({ ...request, sessionId: "child-2" });

  await expect(first).resolves.toEqual({
    behavior: "deny",
    message: "Superseded by new permission request",
  });
  expect(broker.size).toBe(1);
  expect(
    events.filter((event) => event.type === "tool_permission_resolved"),
  ).toHaveLength(1);

  broker.respondToToolPermission("request-2", "deny");
  await expect(second).resolves.toMatchObject({
    behavior: "deny",
    interrupt: false,
  });
});

it("aborts once and ignores a later user response", async () => {
  const events: CoworkPermissionEvent[] = [];
  const controller = new AbortController();
  const broker = new CoworkPermissionBroker({
    createRequestId: requestIds("request-1"),
    emit: (event) => events.push(event),
  });
  const result = broker.requestPermission({
    input: {},
    sessionId: "session-1",
    signal: controller.signal,
    toolName: "Write",
  });

  controller.abort();
  broker.respondToToolPermission("request-1", "once");

  await expect(result).resolves.toEqual({
    behavior: "deny",
    message: "Request aborted",
  });
  expect(
    events.filter((event) => event.type === "tool_permission_resolved"),
  ).toHaveLength(1);
});

it("reports a request stalled after 300 seconds and clears the timer on finish", async () => {
  vi.useFakeTimers();
  const onStalled = vi.fn();
  const broker = new CoworkPermissionBroker({
    createRequestId: requestIds("request-1", "request-2"),
    emit: () => undefined,
    onStalled,
  });
  const stalled = broker.requestPermission({
    input: {},
    sessionId: "session-1",
    toolName: "Read",
  });

  await vi.advanceTimersByTimeAsync(299_999);
  expect(onStalled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(onStalled).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: "request-1" }),
  );
  broker.respondToToolPermission("request-1", "deny");
  await stalled;

  const finished = broker.requestPermission({
    input: {},
    sessionId: "session-1",
    toolName: "Write",
  });
  broker.respondToToolPermission("request-2", "deny");
  await finished;
  await vi.advanceTimersByTimeAsync(300_000);
  expect(onStalled).toHaveBeenCalledTimes(1);
});

it("fires onRequested after emit and onResponded with latency on user decision", async () => {
  const onRequested = vi.fn();
  const onResponded = vi.fn();
  let now = 1_000;
  const broker = new CoworkPermissionBroker({
    createRequestId: requestIds("request-1"),
    emit: () => undefined,
    now: () => now,
    onRequested,
    onResponded,
  });
  const result = broker.requestPermission({
    input: { path: "/tmp" },
    sessionId: "session-1",
    toolName: "Read",
  });
  expect(onRequested).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: "request-1", toolName: "Read" }),
  );
  now = 1_450;
  broker.respondToToolPermission("request-1", "once");
  await result;
  expect(onResponded).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: "request-1" }),
    "once",
    450,
  );
});

it("does not fire onResponded for non-user resolvePendingPermission", async () => {
  const onResponded = vi.fn();
  const broker = new CoworkPermissionBroker({
    createRequestId: requestIds("request-1"),
    emit: () => undefined,
    onResponded,
  });
  const result = broker.requestPermission({
    input: {},
    sessionId: "session-1",
    toolName: "Read",
  });
  broker.resolvePendingPermission("request-1", {
    behavior: "deny",
    message: "Turn ended",
  });
  await result;
  expect(onResponded).not.toHaveBeenCalled();
});

it("denies internal requests by session or owner but leaves external requests pending", async () => {
  const broker = new CoworkPermissionBroker({
    createRequestId: requestIds("request-1", "request-2"),
    emit: () => undefined,
  });
  const internal = broker.requestPermission({
    input: {},
    ownerSessionId: "owner-1",
    sessionId: "child-1",
    toolName: "Write",
  });
  const external = broker.requestPermission({
    input: {},
    isExternal: true,
    ownerSessionId: "owner-1",
    sessionId: "child-2",
    toolName: "Write",
  });

  broker.denyPendingPermissionsForSession("owner-1", "Turn ended");
  await expect(internal).resolves.toEqual({
    behavior: "deny",
    message: "Turn ended",
  });
  expect(broker.size).toBe(1);

  broker.respondToToolPermission("request-2", "deny");
  await expect(external).resolves.toMatchObject({ behavior: "deny" });
});
