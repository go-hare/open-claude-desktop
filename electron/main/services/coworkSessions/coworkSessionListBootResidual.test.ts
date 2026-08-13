import { expect, it, vi } from "vitest";
import type { CoworkAccountIdentity } from "../coworkAccount/coworkAccountContext";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";
import {
  createManagerHarness,
  createTestManager,
  MutableCoworkAccountContext,
} from "./coworkSessionTestUtils";

function restoredSession(
  sessionId = "local_session_1",
): CoworkSessionRuntimeState {
  return {
    createdAt: 1,
    cwd: "/sessions/process-1",
    fsDetectedFiles: new Map(),
    inputStream: null,
    isFirstTurn: false,
    lastActivityAt: 1,
    lifecycleState: "idle",
    messageBuffer: [],
    pendingNotifications: [],
    processName: "process-1",
    query: null,
    resolvedFolders: [],
    sessionId,
    userSelectedFolders: [],
    vmProcessName: "process-1",
  };
}

it("does not throw or emit initialized when account identity is unavailable", async () => {
  const harness = createManagerHarness();
  const account = new MutableCoworkAccountContext();
  const manager = createTestManager(harness, { accountContext: account });

  await expect(manager.initialize()).resolves.toBeUndefined();
  expect(manager.getAll()).toEqual([]);
  expect(harness.events.some((event) => event.type === "initialized")).toBe(
    false,
  );
});

it("emits official initialized and loads persisted sessions once identity is ready", async () => {
  const harness = createManagerHarness();
  harness.persistence.restored = [restoredSession()];
  const account = new MutableCoworkAccountContext();
  account.identity = {
    accountUuid: "account-1",
    organizationUuid: "org-1",
  };
  const manager = createTestManager(harness, { accountContext: account });

  await manager.initialize();
  expect(harness.events).toContainEqual({ sessionId: "", type: "initialized" });
  expect(manager.getAll().map((session) => session.sessionId)).toEqual([
    "local_session_1",
  ]);

  harness.events.length = 0;
  await manager.initialize();
  expect(harness.events.some((event) => event.type === "initialized")).toBe(
    false,
  );
});

it("reloads after logout then login (official setupAccountChangeListener)", async () => {
  const harness = createManagerHarness();
  harness.persistence.restored = [restoredSession()];
  const account = new MutableCoworkAccountContext();
  const identity: CoworkAccountIdentity = {
    accountUuid: "account-1",
    organizationUuid: "org-1",
  };
  account.identity = identity;
  const manager = createTestManager(harness, { accountContext: account });
  await manager.initialize();
  expect(manager.getAll()).toHaveLength(1);

  harness.events.length = 0;
  account.setAccountDetails({
    accountUuid: "account-1",
    isLoggedOut: true,
  });
  expect(manager.getAll()).toHaveLength(1);
  expect(harness.events.some((event) => event.type === "initialized")).toBe(
    false,
  );

  harness.persistence.restored = [
    restoredSession(),
    restoredSession("local_session_2"),
  ];
  account.setAccountDetails({
    accountUuid: "account-1",
    isLoggedOut: false,
  });
  await vi.waitFor(() => {
    expect(harness.events).toContainEqual({
      sessionId: "",
      type: "initialized",
    });
  });
  expect(manager.getAll().map((session) => session.sessionId)).toEqual([
    "local_session_1",
    "local_session_2",
  ]);
});
