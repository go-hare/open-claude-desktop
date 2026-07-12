import { expect, it, vi } from "vitest";
import {
  createManagerHarness,
  createTestManager,
  TestCoworkQuery,
} from "./coworkSessionTestUtils";
import type { CoworkQueryFactoryInput } from "./coworkSessionManagerTypes";
import type { CoworkSdkUserMessage } from "./coworkSessionTypes";

async function nextUserMessage(
  prompt: AsyncIterable<CoworkSdkUserMessage>,
): Promise<CoworkSdkUserMessage> {
  const result = await prompt[Symbol.asyncIterator]().next();
  if (result.done) throw new Error("Expected queued user message");
  return result.value;
}

async function startOfficialSession(
  manager: ReturnType<typeof createTestManager>,
): Promise<string> {
  return manager.start({
    enabledMcpTools: ["Read"],
    images: [{ base64: "image-data", mimeType: "image/png" }],
    mcpServers: { cowork: { command: "cowork" } },
    message: "inspect",
    messageUuid: "message-1",
    model: "claude-opus",
    permissionMode: "default",
    remoteMcpServers: [{ uuid: "remote-1" }],
    systemPrompt: "Cowork system",
    userSelectedFiles: ["/tmp/a.txt"],
    userSelectedFolders: ["/tmp/project"],
  });
}

function expectOfficialFactoryInput(input: CoworkQueryFactoryInput): void {
  expect(input).toMatchObject({
    accountIdentity: { accountUuid: "account-1", organizationUuid: "org-1" },
    cwd: "/sessions/process-1",
    enabledMcpTools: ["Read"],
    hostLoopMode: true,
    mcpServers: { cowork: { command: "cowork" } },
    model: "claude-opus",
    remoteMcpServers: [{ uuid: "remote-1" }],
    systemPrompt: "Cowork system",
    userSelectedFolders: ["/tmp/project"],
  });
}

function expectOfficialUserMessage(user: CoworkSdkUserMessage): void {
  expect(user).toMatchObject({
    client_platform: "desktop_app",
    message: {
      content: [
        {
          source: {
            data: "image-data",
            media_type: "image/png",
            type: "base64",
          },
          type: "image",
        },
        { text: "inspect", type: "text" },
      ],
      role: "user",
    },
    user_selected_files: ["/tmp/a.txt"],
    uuid: "message-1",
  });
}

it("starts an account-scoped query with official inputs and emits raw SDK messages", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    // Explicit new-session policy for this harness; production uses createCoworkHostLoopModeResolver.
    resolveHostLoopMode: () => true,
  });
  const sessionId = await startOfficialSession(manager);

  expect(sessionId).toBe("local_session_1");
  expectOfficialFactoryInput(harness.factoryInputs[0]!);
  const user = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  expectOfficialUserMessage(user);

  const init = { session_id: "cli-session-1", subtype: "init", type: "system" };
  const assistant = {
    message: { content: [{ text: "done", type: "text" }], role: "assistant" },
    type: "assistant",
    uuid: "assistant-1",
  };
  harness.query.push(init);
  harness.query.push(assistant);
  harness.query.push({ is_error: false, subtype: "success", type: "result" });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)).toMatchObject({
      cliSessionId: "cli-session-1",
      isRunning: false,
    });
  });

  const messageEvents = harness.events.filter(
    (event) => event.type === "message",
  );
  expect(messageEvents).toContainEqual({
    message: assistant,
    sessionId,
    type: "message",
  });
  expect(manager.getSession(sessionId)?.bufferedMessages).toEqual(
    expect.arrayContaining([init, assistant]),
  );
});

it("publishes isRunning again on multi-turn send after a settled result", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({ message: "first", messageUuid: "message-1" });
  await vi.waitFor(() => expect(harness.factoryInputs).toHaveLength(1));
  // Drain the first user message so handleResult sees an empty input queue.
  const first = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  expect(first).toMatchObject({ uuid: "message-1" });
  harness.query.push({ is_error: false, subtype: "success", type: "result" });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(false);
  });

  await manager.sendMessage(sessionId, "second", undefined, undefined, "message-2");
  expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  expect(harness.events).toContainEqual({
    sessionId,
    type: "session_updated",
  });
  const second = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  expect(second).toMatchObject({ uuid: "message-2" });
});

it("rejects host-loop resume when org requires full VM sandbox", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
    requireCoworkFullVmSandbox: () => true,
  });
  const sessionId = await manager.start({ message: "first", messageUuid: "message-1" });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.hostLoopMode).toBe(true);
  });
  harness.query.push({ is_error: false, subtype: "success", type: "result" });
  harness.query.finish();
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(false);
  });

  await expect(
    manager.start({ message: "resume", messageUuid: "message-2", sessionId }),
  ).rejects.toThrow(/VM sandbox/);
});

it("queues messages during initialization without losing files or tool states", async () => {
  const harness = createManagerHarness();
  const query = new TestCoworkQuery();
  let releaseQuery: (query: TestCoworkQuery) => void = () => undefined;
  const queryGate = new Promise<TestCoworkQuery>((resolve) => {
    releaseQuery = resolve;
  });
  const manager = createTestManager(harness, {
    queryFactory: (input) => {
      harness.factoryInputs.push(input);
      return queryGate;
    },
  });
  await expect(manager.start({
    message: "first",
    messageUuid: "message-1",
  })).resolves.toBe("local_session_1");
  await vi.waitFor(() => expect(harness.factoryInputs).toHaveLength(1));
  await manager.sendMessage(
    "local_session_1",
    "second",
    undefined,
    ["/tmp/queued.txt"],
    "message-2",
    [{ content: [{ text: "state", type: "text" }], tool_name: "widget" }],
  );
  releaseQuery(query);
  await vi.waitFor(() => {
    expect(manager.getSession("local_session_1")?.isRunning).toBe(true);
  });

  const iterator = harness.factoryInputs[0]!.prompt[Symbol.asyncIterator]();
  await expect(iterator.next()).resolves.toMatchObject({
    value: { uuid: "message-1" },
  });
  await expect(iterator.next()).resolves.toMatchObject({
    value: {
      tool_states: [{ tool_name: "widget" }],
      user_selected_files: ["/tmp/queued.txt"],
      uuid: "message-2",
    },
  });
});

it("updates live query settings and resolves broker permissions", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    permissionBroker: { createRequestId: () => "request-1" },
  });
  await manager.start({ message: "hello" });
  await vi.waitFor(() => {
    expect(manager.getSession("local_session_1")?.isRunning).toBe(true);
  });
  await manager.setModel("local_session_1", "claude-sonnet");
  await expect(
    manager.setPermissionMode("local_session_1", "acceptEdits"),
  ).resolves.toBe(true);

  expect(harness.query.models).toEqual(["claude-sonnet"]);
  expect(harness.query.permissionModes).toEqual(["acceptEdits"]);
  const permission = harness.factoryInputs[0]!.canUseTool({
    input: { path: "/tmp/a" },
    sessionId: "ignored-by-manager",
    toolName: "Read",
  });
  expect(manager.getSession("local_session_1")?.pendingToolPermissions).toEqual(
    [expect.objectContaining({ requestId: "request-1", toolName: "Read" })],
  );
  manager.respondToToolPermission("request-1", "once", { path: "/tmp/b" });

  await expect(permission).resolves.toEqual({
    behavior: "allow",
    decisionClassification: "user_temporary",
    updatedInput: { path: "/tmp/b" },
  });
  expect(
    manager.getSession("local_session_1")?.pendingToolPermissions,
  ).toBeUndefined();
});

it("resumes a rewound conversation at the preceding assistant branch", async () => {
  const harness = createManagerHarness();
  const queries = [new TestCoworkQuery(), new TestCoworkQuery()];
  const manager = createTestManager(harness, {
    queryFactory: (input) => {
      harness.factoryInputs.push(input);
      return queries[harness.factoryInputs.length - 1]!;
    },
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "user-1",
  });
  await vi.waitFor(() => expect(harness.factoryInputs).toHaveLength(1));
  queries[0]!.push({
    session_id: "cli-session-1",
    subtype: "init",
    type: "system",
  });
  queries[0]!.push({ type: "assistant", uuid: "assistant-1" });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)).toMatchObject({
      cliSessionId: "cli-session-1",
      bufferedMessages: expect.arrayContaining([
        expect.objectContaining({ type: "assistant", uuid: "assistant-1" }),
      ]),
    });
  });
  await manager.sendMessage(
    sessionId,
    "second",
    undefined,
    undefined,
    "user-2",
  );

  await expect(manager.rewind(sessionId, "user-2")).resolves.toBe("second");
  await manager.sendMessage(
    sessionId,
    "second",
    undefined,
    undefined,
    "user-3",
  );
  await vi.waitFor(() => expect(harness.factoryInputs).toHaveLength(2));

  expect(harness.factoryInputs[1]).toMatchObject({
    forkSession: true,
    resume: "cli-session-1",
    resumeSessionAt: "assistant-1",
  });
});
