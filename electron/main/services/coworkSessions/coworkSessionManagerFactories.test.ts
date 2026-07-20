import { afterEach, expect, it, vi } from "vitest";
import {
  clearCoworkPermissionAnalyticsForTests,
  setCoworkPermissionAnalyticsSink,
  type CoworkPermissionAnalyticsEvent,
} from "./coworkPermissionAnalytics";
import { createCoworkManagerPermissionBroker } from "./coworkSessionManagerFactories";
import type { CoworkSessionManagerOptions } from "./coworkSessionManagerTypes";
import type { CoworkSessionRepository } from "./coworkSessionRepository";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

function createRepository(
  session: Partial<CoworkSessionRuntimeState> | null,
): CoworkSessionRepository {
  return {
    get: (sessionId: string) =>
      session && session.sessionId === sessionId
        ? (session as CoworkSessionRuntimeState)
        : undefined,
    saveIfInitialized: vi.fn(),
  } as unknown as CoworkSessionRepository;
}

function createOptions(
  overrides?: Partial<CoworkSessionManagerOptions>,
): CoworkSessionManagerOptions {
  return {
    accountContext: {} as CoworkSessionManagerOptions["accountContext"],
    createPersistence: () =>
      ({}) as ReturnType<CoworkSessionManagerOptions["createPersistence"]>,
    emit: () => undefined,
    queryFactory: () =>
      ({
        [Symbol.asyncIterator]: async function* () {},
        close: () => undefined,
        interrupt: async () => undefined,
        setModel: async () => undefined,
      }) as never,
    ...overrides,
  };
}

afterEach(() => {
  clearCoworkPermissionAnalyticsForTests();
  vi.useRealTimers();
});

it("wires lam_tool_permission_requested / responded / stalled with session props", async () => {
  vi.useFakeTimers();
  const events: CoworkPermissionAnalyticsEvent[] = [];
  setCoworkPermissionAnalyticsSink((event) => events.push(event));

  const session = {
    pendingUserMessageUuid: "user-msg-uuid-1",
    permissionMode: "acceptEdits",
    sessionId: "local_session_1",
  } as CoworkSessionRuntimeState;
  const repository = createRepository(session);
  const broker = createCoworkManagerPermissionBroker(
    createOptions({
      permissionBroker: {
        createRequestId: () => "req-analytics-1",
        now: () => 5_000,
      },
    }),
    repository,
  );

  const pending = broker.requestPermission({
    input: { path: "/tmp" },
    sessionId: "local_session_1",
    toolName: "Bash",
  });

  expect(events).toEqual([
    {
      name: "lam_tool_permission_requested",
      props: {
        permission_mode: "acceptEdits",
        request_id: "req-analytics-1",
        session_id: "local_session_1",
        session_type: "cowork",
        tool_name: "Bash",
        user_message_uuid: "user-msg-uuid-1",
      },
    },
  ]);

  await vi.advanceTimersByTimeAsync(300_000);
  expect(events[1]).toEqual({
    name: "lam_tool_permission_stalled",
    props: {
      permission_mode: "acceptEdits",
      request_id: "req-analytics-1",
      seconds_waiting: 300,
      session_id: "local_session_1",
      session_type: "cowork",
      tool_name: "Bash",
      user_message_uuid: "user-msg-uuid-1",
    },
  });

  // Latency = now (still 5000 in fixed clock) - requestedAt (5000) = 0 in this test clock.
  // Bump now via a second broker isn't needed — respond uses broker.now at respond time.
  broker.respondToToolPermission("req-analytics-1", "deny");
  await pending;

  expect(events[2]?.name).toBe("lam_tool_permission_responded");
  expect(events[2]?.props).toMatchObject({
    decision: "deny",
    latency_ms: 0,
    permission_mode: "acceptEdits",
    request_id: "req-analytics-1",
    session_id: "local_session_1",
    session_type: "cowork",
    tool_name: "Bash",
    user_message_uuid: "user-msg-uuid-1",
  });
});

it("preserves custom permissionBroker analytics callbacks", async () => {
  const customRequested = vi.fn();
  const customStalled = vi.fn();
  const customResponded = vi.fn();
  setCoworkPermissionAnalyticsSink(() => undefined);

  const repository = createRepository({
    pendingUserMessageUuid: null,
    permissionMode: "default",
    sessionId: "s1",
  } as CoworkSessionRuntimeState);

  const broker = createCoworkManagerPermissionBroker(
    createOptions({
      permissionBroker: {
        createRequestId: () => "req-2",
        now: () => 1,
        onRequested: customRequested,
        onResponded: customResponded,
        onStalled: customStalled,
        stalledAfterMs: 10,
      },
    }),
    repository,
  );

  vi.useFakeTimers();
  const result = broker.requestPermission({
    input: {},
    sessionId: "s1",
    toolName: "Read",
  });
  expect(customRequested).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10);
  expect(customStalled).toHaveBeenCalledOnce();
  broker.respondToToolPermission("req-2", "once");
  await result;
  expect(customResponded).toHaveBeenCalledOnce();
});

it("emits null permission_mode / user_message_uuid when session is missing", async () => {
  const events: CoworkPermissionAnalyticsEvent[] = [];
  setCoworkPermissionAnalyticsSink((event) => events.push(event));
  const broker = createCoworkManagerPermissionBroker(
    createOptions({
      permissionBroker: { createRequestId: () => "req-3" },
    }),
    createRepository(null),
  );
  const result = broker.requestPermission({
    input: {},
    sessionId: "missing",
    toolName: "Write",
  });
  broker.respondToToolPermission("req-3", "deny");
  await result;
  expect(events[0]?.props).toMatchObject({
    permission_mode: null,
    session_id: "missing",
    user_message_uuid: null,
  });
});
