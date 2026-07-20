import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createManagerHarness,
  createTestAccountContext,
  createTestManager,
  TestCoworkQuery,
} from "./coworkSessionTestUtils";
import type { CoworkQueryFactoryInput } from "./coworkSessionManagerTypes";
import type { CoworkSdkUserMessage } from "./coworkSessionTypes";
import {
  clearCoworkSessionLifecycleAnalyticsForTests,
  setCoworkSessionLifecycleAnalyticsSink,
} from "./coworkSessionLifecycleAnalytics";

const managerTemps: string[] = [];

afterEach(() => {
  clearCoworkSessionLifecycleAnalyticsForTests();
  for (const dir of managerTemps.splice(0)) {
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch {
      // ignore cleanup races
    }
  }
});

function makeProjectDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cowork-mgr-")));
  managerTemps.push(dir);
  return dir;
}

async function nextUserMessage(
  prompt: AsyncIterable<CoworkSdkUserMessage>,
): Promise<CoworkSdkUserMessage> {
  const result = await prompt[Symbol.asyncIterator]().next();
  if (result.done) throw new Error("Expected queued user message");
  return result.value;
}

async function startOfficialSession(
  manager: ReturnType<typeof createTestManager>,
  projectDir: string = makeProjectDir(),
): Promise<{ sessionId: string; projectDir: string }> {
  const sessionId = await manager.start({
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
    userSelectedFolders: [projectDir],
  });
  return { sessionId, projectDir };
}

function expectOfficialFactoryInput(
  input: CoworkQueryFactoryInput,
  projectDir: string,
): void {
  expect(input).toMatchObject({
    accountIdentity: { accountUuid: "account-1", organizationUuid: "org-1" },
    cwd: "/sessions/process-1",
    enabledMcpTools: ["Read"],
    hostLoopMode: true,
    model: "claude-opus",
    remoteMcpServers: [{ uuid: "remote-1" }],
    userSelectedFolders: [projectDir],
  });
  // Official _Ui hasMarkTaskComplete appends VUA guidance onto base system prompt.
  expect(input.systemPrompt).toContain("Cowork system");
  expect(input.systemPrompt).toContain(
    "Call the mark_task_complete tool as your final action",
  );
  // Official alwaysLoad: dXe cowork MCP overwrites any session stub; also
  // mcp-registry + skills + plugins; host-loop workspace x1i.
  const servers = input.mcpServers as Record<string, unknown> | undefined;
  expect(servers?.cowork).toBeTruthy();
  expect(servers?.["mcp-registry"]).toBeTruthy();
  expect(servers?.skills).toBeTruthy();
  expect(servers?.plugins).toBeTruthy();
  expect(servers?.workspace).toBeTruthy();
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
  const { sessionId, projectDir } = await startOfficialSession(manager);

  expect(sessionId).toBe("local_session_1");
  expectOfficialFactoryInput(harness.factoryInputs[0]!, projectDir);
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

it("applies official host-loop applyFlagSettings after addFolderToSession", async () => {
  const storage = mkdtempSync(join(tmpdir(), "cowork-mgr-storage-"));
  const folder = mkdtempSync(join(tmpdir(), "cowork-mgr-folder-"));
  managerTemps.push(storage, folder);

  const harness = createManagerHarness();
  harness.persistence.sessionStorageDir = storage;
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "inspect",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  expect(harness.query.flagSettings).toEqual([]);

  const result = await manager.addFolderToSession(sessionId, folder);
  expect(result).toMatchObject({ ok: true });
  await vi.waitFor(() => {
    expect(harness.query.flagSettings).toHaveLength(1);
  });

  const settings = harness.query.flagSettings[0]!;
  expect(settings.permissions?.additionalDirectories).toEqual(
    expect.arrayContaining([expect.any(String)]),
  );
  // Official HUA([outputs, ...Q]) — at least Edit+Read for outputs + mounted folder.
  const allow = settings.permissions?.allow ?? [];
  expect(allow.some((rule) => rule.startsWith("Edit("))).toBe(true);
  expect(allow.some((rule) => rule.startsWith("Read("))).toBe(true);
  expect(allow.some((rule) => rule.includes("outputs"))).toBe(true);
});

it("skips applyFlagSettings when session is not host-loop", async () => {
  const storage = mkdtempSync(join(tmpdir(), "cowork-mgr-storage-nohl-"));
  const folder = mkdtempSync(join(tmpdir(), "cowork-mgr-folder-nohl-"));
  managerTemps.push(storage, folder);

  const harness = createManagerHarness();
  harness.persistence.sessionStorageDir = storage;
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => false,
  });
  const sessionId = await manager.start({
    message: "inspect",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.hostLoopMode).toBe(false);
  });

  await expect(manager.addFolderToSession(sessionId, folder)).resolves.toMatchObject({
    ok: true,
  });
  expect(harness.query.flagSettings).toEqual([]);
});

it("swallows applyFlagSettings rejection (official .catch warn)", async () => {
  const storage = mkdtempSync(join(tmpdir(), "cowork-mgr-storage-catch-"));
  const folder = mkdtempSync(join(tmpdir(), "cowork-mgr-folder-catch-"));
  managerTemps.push(storage, folder);

  const harness = createManagerHarness();
  harness.persistence.sessionStorageDir = storage;
  harness.query.applyFlagSettings = async () => {
    throw new Error("control channel closed");
  };
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "inspect",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });

  await expect(manager.addFolderToSession(sessionId, folder)).resolves.toMatchObject({
    ok: true,
  });
});

it("queues official host-loop access notification and drains on next user message", async () => {
  const storage = mkdtempSync(join(tmpdir(), "cowork-mgr-storage-notify-"));
  const folder = mkdtempSync(join(tmpdir(), "cowork-mgr-folder-notify-"));
  managerTemps.push(storage, folder);

  const harness = createManagerHarness();
  harness.persistence.sessionStorageDir = storage;
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    expect(harness.factoryInputs).toHaveLength(1);
  });
  // Drain first user message so second send can be observed.
  await nextUserMessage(harness.factoryInputs[0]!.prompt);

  await expect(manager.addFolderToSession(sessionId, folder)).resolves.toMatchObject({
    ok: true,
  });

  await manager.sendMessage(sessionId, "second", undefined, undefined, "message-2");
  const second = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  const content = second.message.content;
  const text =
    typeof content === "string"
      ? content
      : String(
          (content as Array<{ text?: string }>).find((part) => part.text)?.text ??
            "",
        );
  expect(text).toContain("second");
  expect(text).toContain("<system-reminder>");
  expect(text).toContain("You now have access to");
  expect(text).toContain("Read/Bash work there directly.");
});

it("resume drops missing folders and queues official deleted-from-disk notify", async () => {
  const keep = makeProjectDir();
  const gone = join(tmpdir(), `cowork-mgr-gone-${Date.now()}-noexist`);
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });

  // First start creates session with keep folder.
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
    userSelectedFolders: [keep],
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    expect(harness.factoryInputs).toHaveLength(1);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);
  harness.query.push({ is_error: false, subtype: "success", type: "result" });
  harness.query.finish();
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(false);
  });

  // Resume with keep + gone → official resolveAndFilter resumeMode queues notify.
  await manager.start({
    message: "resume",
    messageUuid: "message-2",
    sessionId,
    userSelectedFolders: [keep, gone],
  });
  await vi.waitFor(() => expect(harness.factoryInputs).toHaveLength(2));
  const resumeUser = await nextUserMessage(harness.factoryInputs[1]!.prompt);
  const content = resumeUser.message.content;
  const text =
    typeof content === "string"
      ? content
      : String(
          (content as Array<{ text?: string }>).find((part) => part.text)?.text ??
            "",
        );
  expect(text).toContain("resume");
  expect(text).toContain("<system-reminder>");
  expect(text).toContain(
    `The folder ${gone} is no longer available (deleted from disk).`,
  );
  // Surviving folder still present on session.
  const session = manager.getSession(sessionId);
  expect(session?.userSelectedFolders).toEqual([keep]);
});

it("updateSession spaceId queues official Space enter/leave notify", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
    getSpaceName: (id) => (id === "space_work" ? "Work" : null),
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    expect(harness.factoryInputs).toHaveLength(1);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);

  await manager.updateSession(sessionId, {
    spaceId: "space_work",
    spaceIdSetBy: "user",
  });
  expect(manager.getSession(sessionId)?.spaceId).toBe("space_work");

  await manager.sendMessage(sessionId, "after space", undefined, undefined, "message-2");
  const second = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  const content = second.message.content;
  const text =
    typeof content === "string"
      ? content
      : String(
          (content as Array<{ text?: string }>).find((part) => part.text)?.text ??
            "",
        );
  expect(text).toContain("after space");
  expect(text).toContain("<system-reminder>");
  expect(text).toContain('This session is now in the "Work" Space.');

  // refuse auto overwrite of user-placed space
  await manager.updateSession(sessionId, {
    spaceId: "other",
    spaceIdSetBy: "auto",
  });
  expect(manager.getSession(sessionId)?.spaceId).toBe("space_work");
});

it("non-host-loop addFolder queues official next-resume mount notify", async () => {
  const project = makeProjectDir();
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => false,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    expect(harness.factoryInputs).toHaveLength(1);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);

  await expect(manager.addFolderToSession(sessionId, project)).resolves.toMatchObject({
    ok: true,
  });
  const base = project.split("/").filter(Boolean).at(-1) ?? project;
  await manager.sendMessage(
    sessionId,
    "after mount",
    undefined,
    undefined,
    "message-2",
  );
  const second = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  const content = second.message.content;
  const text =
    typeof content === "string"
      ? content
      : String(
          (content as Array<{ text?: string }>).find((part) => part.text)?.text ??
            "",
        );
  expect(text).toContain("after mount");
  expect(text).toContain("<system-reminder>");
  expect(text).toContain(`You now have access to ${project}.`);
  expect(text).toContain(
    `It will be available at /sessions/{vm}/mnt/${base} on next resume.`,
  );
  // host-loop access string must not be used
  expect(text).not.toContain("Read/Bash work there directly.");
});

it("updateSession title refuses auto when user already renamed", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness);
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });

  await manager.updateSession(sessionId, {
    title: "My Session",
    titleSource: "user",
  });
  expect(manager.getSession(sessionId)?.title).toBe("My Session");

  await manager.updateSession(sessionId, {
    title: "Auto generated",
    titleSource: "auto",
  });
  expect(manager.getSession(sessionId)?.title).toBe("My Session");

  await manager.updateSession(sessionId, {
    title: "Renamed again",
    titleSource: "user",
  });
  expect(manager.getSession(sessionId)?.title).toBe("Renamed again");
});

it("sendMessage toolStates + noteCuWindowMentions append official hints", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    expect(harness.factoryInputs).toHaveLength(1);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);

  manager.noteCuWindowMentions(sessionId, [
    { title: "Notes", bundleId: "com.apple.Notes" },
  ]);
  await manager.sendMessage(
    sessionId,
    "with hints",
    undefined,
    undefined,
    "message-2",
    [{ content: [], tool_name: "interactive_widget" }],
  );
  const second = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  const content = second.message.content;
  const text =
    typeof content === "string"
      ? content
      : String(
          (content as Array<{ text?: string }>).find((part) => part.text)?.text ??
            "",
        );
  expect(text).toContain("with hints");
  expect(text).toContain("<cu_window_hints>");
  expect(text).toContain('window "Notes" (already open; pass com.apple.Notes to request_access)');
  expect(text).toContain("\u2014");
  expect(text).toContain("<widget_context_hint>");
  expect(text).toContain("interactive_widget");
  expect(text).toContain("mcp__cowork__read_widget_context");
  expect(text.indexOf("<cu_window_hints>")).toBeLessThan(
    text.indexOf("<widget_context_hint>"),
  );
  // CU mentions consumed once
  await manager.sendMessage(
    sessionId,
    "again",
    undefined,
    undefined,
    "message-3",
  );
  const third = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  const again =
    typeof third.message.content === "string"
      ? third.message.content
      : "";
  expect(again).toContain("again");
  expect(again).not.toContain("<cu_window_hints>");
  // widget states remain for subsequent turns until reassigned
  expect(again).toContain("<widget_context_hint>");
});

it("setModel queues official Model switched notify into next user message", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
    model: "claude-opus-4-6",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    expect(harness.factoryInputs).toHaveLength(1);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);

  await manager.setModel(sessionId, "claude-sonnet-4-5");
  expect(harness.query.models).toEqual(["claude-sonnet-4-5"]);
  expect(manager.getSession(sessionId)?.model).toBe("claude-sonnet-4-5");

  await manager.sendMessage(
    sessionId,
    "after model",
    undefined,
    undefined,
    "message-2",
  );
  const second = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  const content = second.message.content;
  const text =
    typeof content === "string"
      ? content
      : String(
          (content as Array<{ text?: string }>).find((part) => part.text)?.text ??
            "",
        );
  expect(text).toContain("after model");
  expect(text).toContain("<system-reminder>");
  expect(text).toContain("Model switched to claude-sonnet-4-5.");
  expect(text).toContain("ToolSearch");
  expect(text).toContain("\u2014");
});

it("setModel applies synthetic overrideLabel + effort applyFlagSettings + notify label", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    enable1mContextAppend: () => true,
    getModelConfig: () => ({
      effortByModel: {
        "Max Thinking": "high",
        "claude-opus-4-6": "xhigh",
      },
      supports1mContext: ["claude-opus-4-6"],
      syntheticAllowedModels: {
        "Max Thinking": "claude-opus-4-6",
      },
    }),
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
    model: "claude-sonnet-4-5",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);

  // Live query + synthetic remap would be cross-target ignored — finish query first.
  harness.query.push({ is_error: false, subtype: "success", type: "result" });
  harness.query.finish();
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(false);
  });

  // No live query: synthetic apply
  await manager.setModel(sessionId, "Max Thinking");
  const session = manager.getSession(sessionId);
  expect(session?.model).toBe("claude-opus-4-6[1m]");
  expect(session?.overrideLabel).toBe("Max Thinking");
  expect(harness.query.models).toEqual([]); // no live query

  // Resume path drains pending notify into next user message text
  await manager.start({
    message: "after synthetic",
    messageUuid: "message-2",
    sessionId,
  });
  await vi.waitFor(() => expect(harness.factoryInputs.length).toBeGreaterThan(1));
  const second = await nextUserMessage(
    harness.factoryInputs[harness.factoryInputs.length - 1]!.prompt,
  );
  const content = second.message.content;
  const text =
    typeof content === "string"
      ? content
      : String(
          (content as Array<{ text?: string }>).find((part) => part.text)?.text ??
            "",
        );
  expect(text).toContain("Model switched to Max Thinking.");
});

it("setModel mid-session lock ignores change when gate on + buffered messages", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    lockMidSessionModel: () => true,
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
    model: "claude-sonnet-4-5",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);

  // Renderer exposes bufferedMessages from messageBuffer
  expect((manager.getSession(sessionId)?.bufferedMessages?.length ?? 0) > 0).toBe(
    true,
  );
  await manager.setModel(sessionId, "claude-opus-4-6");
  expect(manager.getSession(sessionId)?.model).toBe("claude-sonnet-4-5");
  expect(harness.query.models).toEqual([]);
});

it("stop accumulates cachedTotalTurns for mid-session lock after buffer clear", async () => {
  // Official stopSession:
  //   cachedTotalTurns += messageBuffer.filter(user).length; messageBuffer = []
  // ft("658929541") lock still fires via cachedTotalTurns with empty buffer.
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    lockMidSessionModel: () => true,
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
    model: "claude-sonnet-4-5",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);
  expect((manager.getSession(sessionId)?.bufferedMessages?.length ?? 0) > 0).toBe(
    true,
  );

  await manager.stop(sessionId);
  expect(manager.getSession(sessionId)?.isRunning).toBe(false);
  // Buffer cleared on stop (renderer bufferedMessages absent).
  expect(manager.getSession(sessionId)?.bufferedMessages).toBeUndefined();

  // Lock still holds via accumulated cachedTotalTurns (runtime-only, not IXi).
  await manager.setModel(sessionId, "claude-opus-4-6");
  expect(manager.getSession(sessionId)?.model).toBe("claude-sonnet-4-5");
  expect(harness.query.models).toEqual([]);
});

it("stop clears promptSuggestion (official stopSession head)", async () => {
  // Official: clearTimeout(_suggestionTimeout); promptSuggestion=void 0
  const harness = createManagerHarness();
  harness.persistence.restored = [
    {
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
      promptSuggestion: "try summarizing the notes",
      query: null,
      resolvedFolders: [],
      sessionId: "local_session_1",
      vmProcessName: "process-1",
    },
  ];
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  await manager.initialize();
  expect(manager.getSession("local_session_1")?.promptSuggestion).toBe(
    "try summarizing the notes",
  );

  await manager.stop("local_session_1");
  expect(manager.getSession("local_session_1")?.promptSuggestion).toBeUndefined();
});

it("start calls registerRootsProvider inject (official startSession)", async () => {
  // Official: mcpCoordinator.registerRootsProvider(A, getter) after path context.
  // Product: inject residual — default no-op; no full mcpCoordinator invent.
  const registerRootsProvider = vi.fn();
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
    registerRootsProvider,
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
    userSelectedFolders: ["/Users/apple/work-py/AppAgent"],
  });
  expect(registerRootsProvider).toHaveBeenCalledTimes(1);
  expect(registerRootsProvider).toHaveBeenCalledWith(
    sessionId,
    expect.any(Function),
  );
  const getRoots = registerRootsProvider.mock.calls[0][1] as () => Promise<
    string[]
  >;
  const roots = await getRoots();
  expect(roots).toContain("/Users/apple/work-py/AppAgent");
  // Official getter is live: stop leaves session in map → still returns folders.
  // Missing session → [] (delete path).
  await manager.stop(sessionId);
  expect(await getRoots()).toContain("/Users/apple/work-py/AppAgent");
  await manager.delete(sessionId);
  expect(await getRoots()).toEqual([]);
});

it("start continues when registerRootsProvider throws", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
    registerRootsProvider: () => {
      throw new Error("roots map missing");
    },
  });
  await expect(
    manager.start({
      message: "hello",
      messageUuid: "message-1",
    }),
  ).resolves.toMatch(/^local_/);
});

it("stop calls unregisterRootsProvider inject (official stopSession tail)", async () => {
  // Official: this.mcpCoordinator.unregisterRootsProvider(A) after stop body.
  // Product: inject residual — default no-op; no full mcpCoordinator invent.
  const unregisterRootsProvider = vi.fn();
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
    unregisterRootsProvider,
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  await manager.stop(sessionId);
  expect(unregisterRootsProvider).toHaveBeenCalledWith(sessionId);
  expect(unregisterRootsProvider).toHaveBeenCalledTimes(1);
});

it("stop continues when unregisterRootsProvider throws", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
    unregisterRootsProvider: () => {
      throw new Error("roots map missing");
    },
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  await expect(manager.stop(sessionId)).resolves.toBeUndefined();
  expect(manager.getSession(sessionId)?.isRunning).toBe(false);
});

it("stop cancels idle grace with teardown and unregisters roots", async () => {
  // Official: after suggestion clear, cancelIdleGrace({teardown:!0}) then
  // stop tail unregisterRootsProvider. Product owns cancelIdleGrace (no inject).
  const unregisterRootsProvider = vi.fn();
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    getIdleGraceMs: () => 60_000,
    resolveHostLoopMode: () => true,
    unregisterRootsProvider,
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  // Arm grace while still "running" process, then force idle + arm.
  (
    manager as unknown as {
      maybeArmIdleGraceAfterIdle: (
        id: string,
        o?: { fromRunning?: boolean },
      ) => void;
    }
  ).maybeArmIdleGraceAfterIdle(sessionId, { fromRunning: true });
  // Force lifecycle idle so arm gate sees idle; re-arm after setting state.
  const runtime = (
    manager as unknown as {
      repository: {
        get: (id: string) => {
          lifecycleState: string;
          _idleGraceTimer?: unknown;
          query: unknown;
          inputStream: unknown;
        } | undefined;
      };
    }
  ).repository.get(sessionId)!;
  runtime.lifecycleState = "idle";
  (
    manager as unknown as {
      maybeArmIdleGraceAfterIdle: (
        id: string,
        o?: { fromRunning?: boolean },
      ) => void;
    }
  ).maybeArmIdleGraceAfterIdle(sessionId, { fromRunning: true });
  expect(runtime._idleGraceTimer).toBeDefined();
  await manager.stop(sessionId);
  expect(runtime._idleGraceTimer).toBeUndefined();
  expect(unregisterRootsProvider).toHaveBeenCalledWith(sessionId);
  expect(manager.getSession(sessionId)?.isRunning).toBe(false);
});

it("stop clears armed _suggestionTimeout (official stopSession head)", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  const session = (
    manager as unknown as {
      repository: {
        get: (id: string) => {
          _suggestionTimeout?: ReturnType<typeof setTimeout>;
          promptSuggestion?: string;
        };
      };
    }
  ).repository.get(sessionId)!;
  const handle = setTimeout(() => undefined, 60_000);
  session._suggestionTimeout = handle;
  session.promptSuggestion = "pending grace";
  await manager.stop(sessionId);
  expect(session._suggestionTimeout).toBeUndefined();
  expect(session.promptSuggestion).toBeUndefined();
});

it("sendMessage clears promptSuggestion and isAgentCompleted", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  // Simulate post-result live query still open (re-enter running path).
  const session = (
    manager as unknown as {
      repository: {
        get: (id: string) => {
          _suggestionTimeout?: ReturnType<typeof setTimeout>;
          isAgentCompleted?: boolean;
          lifecycleState?: string;
          promptSuggestion?: string;
        };
      };
    }
  ).repository.get(sessionId)!;
  session.lifecycleState = "idle";
  session.promptSuggestion = "old suggestion";
  session.isAgentCompleted = true;
  const handle = setTimeout(() => undefined, 60_000);
  session._suggestionTimeout = handle;
  await manager.sendMessage(sessionId, "follow up", undefined, undefined, "message-2");
  expect(session.promptSuggestion).toBeUndefined();
  expect(session.isAgentCompleted).toBe(false);
  expect(session._suggestionTimeout).toBeUndefined();
});

it("isSessionTurnAborted tracks interrupt flag and lifecycle (official isAborted)", async () => {
  // Official CU inject: _turnInterruptRequested===true || lifecycle!=="running"
  expect(createTestManager(createManagerHarness()).isSessionTurnAborted("gone")).toBe(
    true,
  );
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  expect(manager.isSessionTurnAborted(sessionId)).toBe(false);

  await manager.interruptTurn(sessionId);
  expect(manager.isSessionTurnAborted(sessionId)).toBe(true);

  await manager.stop(sessionId);
  expect(manager.isSessionTurnAborted(sessionId)).toBe(true);
});

it("interruptTurn no-ops without query; sets flag and calls query.interrupt", async () => {
  // Official interruptTurn: no query → debug no-op; else _turnInterruptRequested
  // + query.interrupt(). Residual: no XM Code cross-stop invent.
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });

  await manager.interruptTurn(sessionId);
  expect(harness.query.interrupted).toBe(true);
  const runtime = (
    manager as unknown as {
      repository: { get: (id: string) => { _turnInterruptRequested?: boolean } };
    }
  ).repository.get(sessionId);
  expect(runtime?._turnInterruptRequested).toBe(true);

  // After stop → idle clears flag (official transitionTo idle).
  await manager.stop(sessionId);
  expect(runtime?._turnInterruptRequested).toBeUndefined();

  // No active query → no-op (does not throw).
  harness.query.interrupted = false;
  await manager.interruptTurn(sessionId);
  expect(harness.query.interrupted).toBe(false);
});

it("interruptTurn recurses children by parentSessionId", async () => {
  const childQueries = new Map<string, TestCoworkQuery>();
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    createSessionId: () => "local_parent",
    queryFactory: (input) => {
      harness.factoryInputs.push(input);
      const q = new TestCoworkQuery();
      childQueries.set(input.sessionId, q);
      // Keep harness.query as parent for legacy assertions.
      if (input.sessionId === "local_parent") harness.query = q;
      return q;
    },
    resolveHostLoopMode: () => true,
  });
  const parentId = await manager.start({
    message: "parent",
    messageUuid: "p-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(parentId)?.isRunning).toBe(true);
  });
  const childId = await manager.start({
    message: "child",
    messageUuid: "c-1",
    parentSessionId: parentId,
    sessionId: "local_child",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(childId)?.isRunning).toBe(true);
  });

  await manager.interruptTurn(parentId);

  expect(childQueries.get(parentId)?.interrupted).toBe(true);
  expect(childQueries.get(childId)?.interrupted).toBe(true);
  const getRuntime = (id: string) =>
    (
      manager as unknown as {
        repository: {
          get: (sid: string) => { _turnInterruptRequested?: boolean };
        };
      }
    ).repository.get(id);
  expect(getRuntime(parentId)?._turnInterruptRequested).toBe(true);
  expect(getRuntime(childId)?._turnInterruptRequested).toBe(true);
});

it("interruptTurn warns when query.interrupt throws (does not throw)", async () => {
  const harness = createManagerHarness();
  harness.query.interrupt = async () => {
    throw new Error("interrupt boom");
  };
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });

  await expect(manager.interruptTurn(sessionId)).resolves.toBeUndefined();
  const runtime = (
    manager as unknown as {
      repository: { get: (id: string) => { _turnInterruptRequested?: boolean } };
    }
  ).repository.get(sessionId);
  expect(runtime?._turnInterruptRequested).toBe(true);
  expect(warnSpy).toHaveBeenCalledWith(
    `[interruptTurn] Failed to interrupt session ${sessionId}:`,
    expect.any(Error),
  );
  warnSpy.mockRestore();
});

it("archive removes session uploads directory (official archiveSession)", async () => {
  // Official: after stopSession(A,true), rm join(getSessionStorageDir,"uploads")
  // recursive force; warn string on failure. Residual: no audit/je/dispatch invent.
  const storage = makeProjectDir();
  const uploads = join(storage, "uploads");
  mkdirSync(uploads, { recursive: true });
  writeFileSync(join(uploads, "file.txt"), "blob");
  expect(existsSync(join(uploads, "file.txt"))).toBe(true);

  const harness = createManagerHarness();
  harness.persistence.sessionStorageDir = storage;
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });

  await manager.archive(sessionId);
  expect(manager.getSession(sessionId)?.isArchived).toBe(true);
  expect(existsSync(uploads)).toBe(false);
  expect(harness.events).toContainEqual({ sessionId, type: "archived" });
});

it("setModel live query applies effortLevel and same-sdk-id skip setModel", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    enable1mContextAppend: () => false,
    getModelConfig: () => ({
      effortByModel: {
        "claude-sonnet-4-5": "medium",
        "claude-opus-4-6": "unset",
      },
    }),
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
    model: "claude-sonnet-4-5",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);

  await manager.setModel(sessionId, "claude-opus-4-6");
  expect(harness.query.models).toEqual(["claude-opus-4-6"]);
  expect(harness.query.flagSettings).toEqual([{ effortLevel: undefined }]);
  expect(manager.getSession(sessionId)?.model).toBe("claude-opus-4-6");
  expect(manager.getSession(sessionId)?.overrideLabel).toBeUndefined();
});

it("UI addFolderToSession remount short-circuits via mountFolderForSession", async () => {
  const project = makeProjectDir();
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => false,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
    userSelectedFolders: [project],
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    expect(harness.factoryInputs).toHaveLength(1);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);

  // Official UI addFolderToSession → mountFolderForSession; already in _c → no notify.
  await expect(manager.addFolderToSession(sessionId, project)).resolves.toMatchObject({
    ok: true,
    folderPath: project,
  });
  await manager.sendMessage(
    sessionId,
    "after ui remount",
    undefined,
    undefined,
    "message-2",
  );
  const second = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  const text =
    typeof second.message.content === "string"
      ? second.message.content
      : String(
          (second.message.content as Array<{ text?: string }>).find((p) => p.text)
            ?.text ?? "",
        );
  expect(text).toContain("after ui remount");
  expect(text).not.toContain("on next resume");
  expect(text).not.toContain("<system-reminder>");
});

it("non-host-loop remount short-circuits without second next-resume notify", async () => {
  const project = makeProjectDir();
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => false,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
    userSelectedFolders: [project],
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    expect(harness.factoryInputs).toHaveLength(1);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);

  type ToolHandler = (args: Record<string, unknown>) => Promise<{
    content: Array<{ text?: string; type: string }>;
    isError?: boolean;
  }>;
  const toolsOf = (idx: number) => {
    const coworkServer = harness.factoryInputs[idx]!.mcpServers!.cowork;
    const record = coworkServer as {
      instance?: { _registeredTools?: Record<string, { handler: ToolHandler }> };
      tools?: Array<{ name: string; handler: ToolHandler }>;
    };
    return (
      record.instance?._registeredTools ??
      Object.fromEntries(
        (record.tools ?? []).map((tool) => [tool.name, { handler: tool.handler }]),
      )
    );
  };

  // First mount of a new folder queues next-resume.
  const extra = makeProjectDir();
  const first = await toolsOf(0).request_cowork_directory!.handler({ path: extra });
  expect(first.isError).toBeFalsy();
  expect(String(first.content[0]?.text)).toContain("Folder connected:");

  await manager.sendMessage(sessionId, "after first mount", undefined, undefined, "message-2");
  const afterFirst = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  const firstText =
    typeof afterFirst.message.content === "string"
      ? afterFirst.message.content
      : String(
          (afterFirst.message.content as Array<{ text?: string }>).find((p) => p.text)
            ?.text ?? "",
        );
  expect(firstText).toContain("on next resume");
  expect(firstText).toContain(extra);

  // Second mount of same path: official _c includes r → no re-queue.
  const second = await toolsOf(0).request_cowork_directory!.handler({ path: extra });
  expect(second.isError).toBeFalsy();
  expect(String(second.content[0]?.text)).toContain("Folder connected:");

  await manager.sendMessage(sessionId, "after remount", undefined, undefined, "message-3");
  const afterSecond = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  const secondText =
    typeof afterSecond.message.content === "string"
      ? afterSecond.message.content
      : String(
          (afterSecond.message.content as Array<{ text?: string }>).find((p) => p.text)
            ?.text ?? "",
        );
  expect(secondText).toContain("after remount");
  expect(secondText).not.toContain("on next resume");
});

it("host-loop mountFolderForSession returns bashMountName from hostLoopOnFolderAdded inject", async () => {
  const project = makeProjectDir();
  const extra = makeProjectDir();
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
    userSelectedFolders: [project],
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    expect(harness.factoryInputs).toHaveLength(1);
  });

  // Official dual-exec UXe residual: inject onFolderAddedForBash after session live.
  const runtime = harness.persistence.saved.at(-1)!;
  const { createCoworkHostLoopOnFolderAddedForBash } = await import(
    "./coworkVmPathTranslation"
  );
  const { coworkUserSelectedFolderPaths } = await import(
    "./coworkSessionWorkspace"
  );
  runtime.hostLoopOnFolderAdded = createCoworkHostLoopOnFolderAddedForBash(
    () => coworkUserSelectedFolderPaths(runtime.resolvedFolders),
  );

  const coworkServer = harness.factoryInputs[0]!.mcpServers!.cowork;
  type ToolHandler = (args: Record<string, unknown>) => Promise<{
    content: Array<{ text?: string; type: string }>;
    isError?: boolean;
  }>;
  const record = coworkServer as {
    instance?: { _registeredTools?: Record<string, { handler: ToolHandler }> };
    tools?: Array<{ name: string; handler: ToolHandler }>;
  };
  const tools: Record<string, { handler: ToolHandler }> =
    record.instance?._registeredTools ??
    Object.fromEntries(
      (record.tools ?? []).map((tool) => [tool.name, { handler: tool.handler }]),
    );
  const result = await tools.request_cowork_directory!.handler({ path: extra });
  expect(result.isError).toBeFalsy();
  const text = String(result.content[0]?.text ?? "");
  const mountBase = extra.split("/").filter(Boolean).at(-1) ?? extra;
  expect(text).toContain("Folder connected:");
  expect(text).toContain(`/sessions/process-1/mnt/${mountBase}`);
  expect(text).toContain("mcp__workspace__bash ONLY");
});

it("host-loop mount without hostLoopOnFolderAdded omits bash path note", async () => {
  const project = makeProjectDir();
  const extra = makeProjectDir();
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
    userSelectedFolders: [project],
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    expect(harness.factoryInputs).toHaveLength(1);
  });
  // No hostLoopOnFolderAdded inject — official product residual without dual-exec UXe.

  const coworkServer = harness.factoryInputs[0]!.mcpServers!.cowork;
  type ToolHandler = (args: Record<string, unknown>) => Promise<{
    content: Array<{ text?: string; type: string }>;
    isError?: boolean;
  }>;
  const record = coworkServer as {
    instance?: { _registeredTools?: Record<string, { handler: ToolHandler }> };
    tools?: Array<{ name: string; handler: ToolHandler }>;
  };
  const tools: Record<string, { handler: ToolHandler }> =
    record.instance?._registeredTools ??
    Object.fromEntries(
      (record.tools ?? []).map((tool) => [tool.name, { handler: tool.handler }]),
    );
  const result = await tools.request_cowork_directory!.handler({ path: extra });
  expect(result.isError).toBeFalsy();
  const text = String(result.content[0]?.text ?? "");
  expect(text).toContain("Folder connected:");
  expect(text).toContain("can use this folder immediately");
  expect(text).not.toContain("/sessions/process-1/mnt/");
  expect(text).not.toContain("mcp__workspace__bash ONLY");
});

it("resume keeps extra mounts beyond userSelectedFolders prefix (official Ke)", async () => {
  const prefix = makeProjectDir();
  const extra = makeProjectDir();
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });

  const sessionId = await manager.start({
    message: "first",
    messageUuid: "message-1",
    userSelectedFolders: [prefix],
  });
  await vi.waitFor(() => expect(manager.getSession(sessionId)?.isRunning).toBe(true));
  await nextUserMessage(harness.factoryInputs[0]!.prompt);
  await expect(manager.addFolderToSession(sessionId, extra)).resolves.toMatchObject({
    ok: true,
  });
  harness.query.push({ is_error: false, subtype: "success", type: "result" });
  harness.query.finish();
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(false);
  });

  // Resume with only prefix USF — official Ke keeps the extra mount after De.length.
  await manager.start({
    message: "resume",
    messageUuid: "message-2",
    sessionId,
    userSelectedFolders: [prefix],
  });
  await vi.waitFor(() => expect(harness.factoryInputs).toHaveLength(2));
  const folders = manager.getSession(sessionId)?.userSelectedFolders ?? [];
  expect(folders).toEqual(expect.arrayContaining([prefix, extra]));
  expect(folders).toHaveLength(2);
});

it("replaceEnabledMcpTools skips agent/dispatch_child without mutating map", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    enabledMcpTools: { "local:demo:tool": true },
    message: "dispatch",
    messageUuid: "message-1",
    sessionType: "agent",
  });
  await vi.waitFor(() => expect(manager.getSession(sessionId)?.isRunning).toBe(true));

  const result = await manager.replaceEnabledMcpTools(sessionId, {
    tools: { "local:demo:tool": false },
  });
  expect(result).toEqual({
    enabledMcpTools: { "local:demo:tool": true },
  });
  expect(manager.getSession(sessionId)?.enabledMcpTools).toEqual({
    "local:demo:tool": true,
  });
});

it("replaceEnabledMcpTools noops on equal map and applies + clears builtLocal when prefer notifications", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    preferSessionNotifications: () => true,
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    enabledMcpTools: { "local:demo:tool": true },
    message: "mcp",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => expect(manager.getSession(sessionId)?.isRunning).toBe(true));

  // Seed builtLocal cache to prove clear path.
  const runtime = (manager as unknown as {
    repository: { get: (id: string) => { builtLocalMcpServers?: unknown; builtGen?: number } | undefined };
  }).repository.get(sessionId);
  expect(runtime).toBeTruthy();
  runtime!.builtLocalMcpServers = { demo: { command: "x" } };
  runtime!.builtGen = 2;

  const same = await manager.replaceEnabledMcpTools(sessionId, {
    tools: { "local:demo:tool": true },
  });
  expect(same).toEqual({
    enabledMcpTools: { "local:demo:tool": true },
  });
  expect(runtime!.builtLocalMcpServers).toEqual({ demo: { command: "x" } });
  expect(runtime!.builtGen).toBe(2);

  const applied = await manager.replaceEnabledMcpTools(sessionId, {
    tools: { "local:demo:tool": false, "local:demo:other": true },
  });
  expect(applied).toEqual({
    enabledMcpTools: {
      "local:demo:tool": false,
      "local:demo:other": true,
    },
  });
  expect(manager.getSession(sessionId)?.enabledMcpTools).toEqual({
    "local:demo:tool": false,
    "local:demo:other": true,
  });
  // ft prefer path: clear builtLocal only (no full invalidate → builtGen stays)
  expect(runtime!.builtLocalMcpServers).toBeUndefined();
  expect(runtime!.builtGen).toBe(2);
  expect(
    harness.events.some(
      (e) => e.type === "session_updated" && e.sessionId === sessionId,
    ),
  ).toBe(true);
});

it("replaceEnabledMcpTools full invalidate when preferSessionNotifications is off", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    preferSessionNotifications: () => false,
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    enabledMcpTools: { "local:demo:tool": true },
    message: "mcp",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => expect(manager.getSession(sessionId)?.isRunning).toBe(true));

  const runtime = (manager as unknown as {
    repository: {
      get: (id: string) => {
        builtAllowedTools?: unknown;
        builtGen?: number;
        builtLocalMcpServers?: unknown;
        builtSystemPrompt?: string;
        builtTools?: unknown;
      } | undefined;
    };
  }).repository.get(sessionId)!;
  runtime.builtGen = 1;
  runtime.builtLocalMcpServers = { a: 1 };
  runtime.builtSystemPrompt = "cached";
  runtime.builtTools = ["t"];
  runtime.builtAllowedTools = ["a"];

  await manager.replaceEnabledMcpTools(sessionId, {
    tools: { "local:demo:tool": false },
  });
  expect(runtime.builtGen).toBe(2);
  expect(runtime.builtLocalMcpServers).toBeUndefined();
  expect(runtime.builtSystemPrompt).toBeUndefined();
  expect(runtime.builtTools).toBeUndefined();
  expect(runtime.builtAllowedTools).toBeUndefined();
});

it("replaceRemoteMcpServers noops on equal jC+tools and applies + clears builtLocal", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    preferSessionNotifications: () => true,
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    enabledMcpTools: { "u-1:t1": true },
    message: "remote",
    messageUuid: "message-1",
    remoteMcpServers: [
      { name: "remote", tools: [{ name: "t1" }], uuid: "u-1" },
    ],
  });
  await vi.waitFor(() => expect(manager.getSession(sessionId)?.isRunning).toBe(true));

  const runtime = (manager as unknown as {
    repository: {
      get: (id: string) => {
        builtGen?: number;
        builtLocalMcpServers?: unknown;
        remoteMcpServersConfig?: unknown;
      } | undefined;
    };
  }).repository.get(sessionId)!;
  runtime.builtLocalMcpServers = { cached: true };
  runtime.builtGen = 3;

  const same = await manager.replaceRemoteMcpServers(sessionId, [
    {
      name: "remote",
      tools: [{ name: "t1" }],
      toolKeys: ["t1"],
      uuid: "u-1",
    },
  ]);
  expect(same).toEqual({ enabledMcpTools: { "u-1:t1": true } });
  expect(runtime.builtLocalMcpServers).toEqual({ cached: true });
  expect(runtime.builtGen).toBe(3);

  const applied = await manager.replaceRemoteMcpServers(sessionId, [
    {
      name: "remote",
      tools: [{ name: "t1" }, { name: "t2" }],
      toolKeys: ["t1", "t2"],
      uuid: "u-1",
    },
  ]);
  expect(applied).toEqual({ enabledMcpTools: { "u-1:t1": true } });
  expect(runtime.remoteMcpServersConfig).toEqual([
    {
      name: "remote",
      tools: [{ name: "t1" }, { name: "t2" }],
      uuid: "u-1",
    },
  ]);
  expect(runtime.builtLocalMcpServers).toBeUndefined();
  expect(runtime.builtGen).toBe(3);
});

it("replaceRemoteMcpServers full invalidate when preferSessionNotifications is off", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    preferSessionNotifications: () => false,
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "remote",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => expect(manager.getSession(sessionId)?.isRunning).toBe(true));

  const runtime = (manager as unknown as {
    repository: {
      get: (id: string) => {
        builtGen?: number;
        builtLocalMcpServers?: unknown;
        builtSystemPrompt?: string;
      } | undefined;
    };
  }).repository.get(sessionId)!;
  runtime.builtGen = 1;
  runtime.builtLocalMcpServers = { a: 1 };
  runtime.builtSystemPrompt = "cached";

  await manager.replaceRemoteMcpServers(sessionId, [
    { name: "remote", tools: [{ name: "t1" }], uuid: "u-9" },
  ]);
  expect(runtime.builtGen).toBe(2);
  expect(runtime.builtLocalMcpServers).toBeUndefined();
  expect(runtime.builtSystemPrompt).toBeUndefined();
});

it("setDraftSessionFolders eBe filters via getAllowedWorkspaceFolders inject", () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    getAllowedWorkspaceFolders: () => ["/allowed"],
  });
  manager.setDraftSessionFolders(["/allowed/sub", "/outside", "/allowed"]);
  expect(manager.getDraftSessionFolders()).toEqual([
    "/allowed/sub",
    "/allowed",
  ]);

  // unrestricted when inject null
  const open = createTestManager(createManagerHarness(), {
    getAllowedWorkspaceFolders: () => null,
  });
  open.setDraftSessionFolders(["/x", "/y"]);
  expect(open.getDraftSessionFolders()).toEqual(["/x", "/y"]);
});

it("openOutputsDir opens getOutputsDir via openPath inject", async () => {
  const harness = createManagerHarness();
  const storage = makeProjectDir();
  harness.persistence.sessionStorageDir = storage;
  const opened: string[] = [];
  const manager = createTestManager(harness, {
    openPath: async (target) => {
      opened.push(target);
      return "";
    },
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "outputs",
    messageUuid: "message-1",
  });
  await manager.openOutputsDir(sessionId);
  expect(opened).toEqual([join(storage, "outputs")]);
});

it("setFocusedSession emits only on change; getFocusedSession returns id", () => {
  const changed: Array<string | null> = [];
  const manager = createTestManager(createManagerHarness(), {
    onFocusedSessionChanged: (sessionId) => {
      changed.push(sessionId);
    },
  });
  expect(manager.getFocusedSession()).toBeNull();

  manager.setFocusedSession("s1");
  manager.setFocusedSession("s1"); // noop same value
  manager.setFocusedSession("s2");
  manager.setFocusedSession(null);

  expect(manager.getFocusedSession()).toBeNull();
  expect(changed).toEqual(["s1", "s2", null]);
});

it("noteCuWindowMentions is assign-only with YM gate residual", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    createSessionId: () => "local_cu_note",
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "cu-note",
    messageUuid: "cn-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    expect(harness.factoryInputs).toHaveLength(1);
  });
  await nextUserMessage(harness.factoryInputs[0]!.prompt);

  const before = harness.events.filter((e) => e.type === "session_updated").length;
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  manager.noteCuWindowMentions(sessionId, [
    { title: "Notes", bundleId: "com.apple.Notes" },
  ]);
  const after = harness.events.filter((e) => e.type === "session_updated").length;
  // Official assign-only — no saveSession / session_updated.
  expect(after).toBe(before);

  // Stored in-memory: next sendMessage still gets appendCuWindowHint.
  await manager.sendMessage(
    sessionId,
    "with hints",
    undefined,
    undefined,
    "cn-2",
  );
  const second = await nextUserMessage(harness.factoryInputs[0]!.prompt);
  const content = second.message.content;
  const text =
    typeof content === "string"
      ? content
      : String(
          (content as Array<{ text?: string }>).find((part) => part.text)?.text ??
            "",
        );
  expect(text).toContain("<cu_window_hints>");
  expect(text).toContain('window "Notes" (already open; pass com.apple.Notes to request_access)');

  manager.noteCuWindowMentions("missing-session", [
    { title: "X", bundleId: "com.x" },
  ]);
  expect(warnSpy).toHaveBeenCalledWith(
    "Cannot note CU mentions: session missing-session not found",
  );
  warnSpy.mockRestore();

  // YM() off → no-op; sendMessage must not append hints.
  const gatedHarness = createManagerHarness();
  const gated = createTestManager(gatedHarness, {
    createSessionId: () => "local_cu_note_gated",
    isComputerUseEnabled: () => false,
    resolveHostLoopMode: () => true,
  });
  const gatedId = await gated.start({
    message: "gated",
    messageUuid: "g-1",
  });
  await vi.waitFor(() => {
    expect(gated.getSession(gatedId)?.isRunning).toBe(true);
    expect(gatedHarness.factoryInputs).toHaveLength(1);
  });
  await nextUserMessage(gatedHarness.factoryInputs[0]!.prompt);
  gated.noteCuWindowMentions(gatedId, [
    { title: "Blocked", bundleId: "com.blocked" },
  ]);
  await gated.sendMessage(
    gatedId,
    "no hints",
    undefined,
    undefined,
    "g-2",
  );
  const gatedSecond = await nextUserMessage(gatedHarness.factoryInputs[0]!.prompt);
  const gatedContent = gatedSecond.message.content;
  const gatedText =
    typeof gatedContent === "string"
      ? gatedContent
      : String(
          (gatedContent as Array<{ text?: string }>).find((part) => part.text)
            ?.text ?? "",
        );
  expect(gatedText).toContain("no hints");
  expect(gatedText).not.toContain("<cu_window_hints>");
  expect(gatedText).not.toContain("com.blocked");
});

it("submitTranscriptFeedback writes feedback.json and getTranscriptFeedback reads", async () => {
  const harness = createManagerHarness();
  const storage = makeProjectDir();
  const downloads = makeProjectDir();
  harness.persistence.sessionStorageDir = storage;
  const shown: string[] = [];
  const manager = createTestManager(harness, {
    getDownloadsDir: () => downloads,
    showItemInFolder: (target) => {
      shown.push(target);
    },
  });
  const sessionId = await manager.start({
    message: "feedback",
    messageUuid: "message-1",
  });
  const feedback = {
    freeText: "note",
    steps: [{ toolUseId: "tu-1", thumb: "up" as string | null, note: null }],
    submittedAt: 123,
  };
  await expect(
    manager.submitTranscriptFeedback(sessionId, feedback),
  ).resolves.toBe(true);
  await expect(manager.getTranscriptFeedback(sessionId)).resolves.toEqual([
    feedback,
  ]);
  expect(shown.length).toBe(1);
  expect(shown[0]).toContain("cowork-feedback-");

  await expect(manager.getTranscriptFeedback("missing")).resolves.toEqual([]);
  await expect(
    manager.submitTranscriptFeedback("missing", feedback),
  ).resolves.toBe(false);
});

it("shareSession packs cli jsonl + metadata via J6e; guards missing session/cli", async () => {
  const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
  const { unzipSync } = await import("fflate");
  const harness = createManagerHarness();
  const storage = makeProjectDir();
  const downloads = makeProjectDir();
  const logs = makeProjectDir();
  harness.persistence.sessionStorageDir = storage;
  const manager = createTestManager(harness, {
    getDownloadsDir: () => downloads,
    getLogsDir: () => logs,
    getScrubHomedir: () => "/Users/alice",
    getAppPath: () => "/App/Claude.app",
    now: () => 1_700_000_000_111,
  });
  const sessionId = await manager.start({
    message: "share",
    messageUuid: "message-1",
  });

  await expect(manager.shareSession("missing")).resolves.toEqual({
    success: false,
    error: "Session not found",
  });
  await expect(manager.shareSession(sessionId)).resolves.toEqual({
    success: false,
    error: "Session has no CLI session ID",
  });

  expect(manager.getSession(sessionId)).toBeTruthy();
  // Product sets cliSessionId from SDK session_id; tests set directly on runtime.
  const runtime = (manager as unknown as {
    repository: { get: (id: string) => { cliSessionId?: string } | undefined };
  }).repository.get(sessionId);
  expect(runtime).toBeTruthy();
  runtime!.cliSessionId = "cli-share-1";

  const projects = join(storage, ".claude", "projects", "proj-a");
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(projects, "cli-share-1.jsonl"), '{"type":"user"}\n');
  writeFileSync(
    `${storage}.json`,
    JSON.stringify({ sessionId, title: "share-me" }),
  );
  writeFileSync(
    join(logs, "app.log"),
    "log-line user alice@x.com sk-ant-abcdefgh /Users/alice/p\n",
  );
  writeFileSync(join(logs, "echo.log"), "skip-me\n");

  const result = await manager.shareSession(sessionId);
  expect(result).toEqual({
    success: true,
    filePath: join(downloads, "session-export-1700000000111.zip"),
  });
  const unpacked = unzipSync(new Uint8Array(readFileSync(result.filePath!)));
  expect(Object.keys(unpacked).sort()).toEqual([
    "cli-share-1.jsonl",
    "logs/app.log",
    "metadata.json",
  ]);
  expect(new TextDecoder().decode(unpacked["cli-share-1.jsonl"])).toBe(
    '{"type":"user"}\n',
  );
  // Official S1/Qw scrub on logs only (not transcript jsonl).
  const logText = new TextDecoder().decode(unpacked["logs/app.log"]);
  expect(logText).toContain("<email>");
  expect(logText).toContain("<token>");
  expect(logText).toContain("~/p");
  expect(logText).not.toContain("sk-ant-abcdefgh");
  expect(logText).not.toContain("alice@x.com");
});

it("setPermissionMode gXi chrome snapshot/restore and propagates children", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    createSessionId: () => "local_parent",
  });
  const parentId = await manager.start({
    message: "parent",
    messageUuid: "p-1",
    permissionMode: "default",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(parentId)?.isRunning).toBe(true);
  });
  // Seed domains via updateChromePermission (start input domains are not applied —
  // official seed only uses scheduled f.domains). Then snapshot mode via setChrome.
  manager.updateChromePermission(parentId, "ask", ["parent.com"]);
  expect(manager.setChromePermissionMode(parentId, "ask")).toBe(true);
  const childId = await manager.start({
    message: "child",
    messageUuid: "c-1",
    parentSessionId: parentId,
    sessionId: "local_child",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(childId)?.isRunning).toBe(true);
  });
  manager.updateChromePermission(childId, "follow_a_plan", ["child.com"]);
  manager.setChromePermissionMode(childId, "follow_a_plan");

  await expect(
    manager.setPermissionMode(parentId, "auto", undefined, {
      chromeSkipAllPermissionChecks: true,
    }),
  ).resolves.toBe(true);

  const parent = manager.getSession(parentId);
  expect(parent?.permissionMode).toBe("auto");
  expect(parent?.chromePermissionMode).toBe("skip_all_permission_checks");
  expect(parent?.chromeAllowedDomains).toBeUndefined();
  expect(parent?.chromePermsBeforeUnsupervised).toEqual({
    mode: "ask",
    domains: ["parent.com"],
  });

  const child = manager.getSession(childId);
  expect(child?.permissionMode).toBe("auto");
  expect(child?.chromePermissionMode).toBe("skip_all_permission_checks");
  expect(child?.chromePermsBeforeUnsupervised).toEqual({
    mode: "follow_a_plan",
    domains: ["child.com"],
  });
  expect(harness.query.permissionModes).toContain("auto");

  // Leave unsupervised → restore snapshot.
  await expect(manager.setPermissionMode(parentId, "default")).resolves.toBe(
    true,
  );
  const restored = manager.getSession(parentId);
  expect(restored?.permissionMode).toBe("default");
  expect(restored?.chromePermissionMode).toBe("ask");
  expect(restored?.chromeAllowedDomains).toEqual(["parent.com"]);
  expect(restored?.chromePermsBeforeUnsupervised).toBeUndefined();

  // Child also restored via recursive setPermissionMode.
  const childRestored = manager.getSession(childId);
  expect(childRestored?.permissionMode).toBe("default");
  expect(childRestored?.chromePermissionMode).toBe("follow_a_plan");
  expect(childRestored?.chromeAllowedDomains).toEqual(["child.com"]);

  // Official setPermissionMode propagates to archived children too
  // (contrast setChromePermissionMode which skips archived).
  const archivedId = await manager.start({
    message: "archived-child",
    messageUuid: "a-1",
    parentSessionId: parentId,
    sessionId: "local_archived_child_perm",
  });
  manager.updateChromePermission(archivedId, "ask", ["arch.com"]);
  manager.setChromePermissionMode(archivedId, "ask");
  await manager.archive(archivedId);
  await expect(
    manager.setPermissionMode(parentId, "bypassPermissions", undefined, {
      chromeSkipAllPermissionChecks: true,
    }),
  ).resolves.toBe(true);
  expect(manager.getSession(archivedId)?.permissionMode).toBe(
    "bypassPermissions",
  );
  expect(manager.getSession(archivedId)?.chromePermissionMode).toBe(
    "skip_all_permission_checks",
  );
  expect(manager.getSession(archivedId)?.chromePermsBeforeUnsupervised).toEqual(
    {
      mode: "ask",
      domains: ["arch.com"],
    },
  );
});

it("setChromePermissionMode sets mode snapshot allowAll and propagates children", async () => {
  const harness = createManagerHarness();
  const allowAllCalls: boolean[] = [];
  const manager = createTestManager(harness, {
    createSessionId: () => "local_parent",
    setAllowAllBrowserActions: (allowed) => {
      allowAllCalls.push(allowed);
    },
  });

  expect(manager.setChromePermissionMode("missing", "ask")).toBe(false);

  const parentId = await manager.start({
    message: "parent",
    messageUuid: "p-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(parentId)?.isRunning).toBe(true);
  });
  manager.updateChromePermission(parentId, "ask", ["example.com"]);

  const childId = await manager.start({
    message: "child",
    messageUuid: "c-1",
    parentSessionId: parentId,
    sessionId: "local_child",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(childId)?.isRunning).toBe(true);
  });
  manager.updateChromePermission(childId, "ask", ["child.com"]);

  // Clear start-time session_updated noise before chrome mode assertions.
  harness.events.length = 0;

  expect(
    manager.setChromePermissionMode(parentId, "skip_all_permission_checks"),
  ).toBe(true);
  expect(allowAllCalls).toEqual([true]);
  const parent = manager.getSession(parentId);
  expect(parent?.chromePermissionMode).toBe("skip_all_permission_checks");
  expect(parent?.chromePermsBeforeUnsupervised).toEqual({
    mode: "skip_all_permission_checks",
    domains: ["example.com"],
  });
  expect(parent?.chromeAllowedDomains).toEqual(["example.com"]);

  const child = manager.getSession(childId);
  expect(child?.chromePermissionMode).toBe("skip_all_permission_checks");
  expect(child?.chromePermsBeforeUnsupervised).toEqual({
    mode: "skip_all_permission_checks",
    domains: ["child.com"],
  });

  // session_updated for parent + child
  const updated = harness.events.filter((e) => e.type === "session_updated");
  expect(updated.map((e) => e.sessionId).sort()).toEqual(
    [childId, parentId].sort(),
  );

  expect(manager.setChromePermissionMode(parentId, "ask")).toBe(true);
  expect(allowAllCalls).toEqual([true, false]);
  expect(manager.getSession(parentId)?.chromePermissionMode).toBe("ask");

  // Archived child is not propagated.
  const archivedId = await manager.start({
    message: "archived-child",
    messageUuid: "a-1",
    parentSessionId: parentId,
    sessionId: "local_archived_child",
  });
  await manager.archive(archivedId);
  expect(manager.setChromePermissionMode(parentId, "follow_a_plan")).toBe(true);
  expect(manager.getSession(archivedId)?.chromePermissionMode).not.toBe(
    "follow_a_plan",
  );
  expect(manager.getSession(childId)?.chromePermissionMode).toBe(
    "follow_a_plan",
  );
});

it("updateChromePermission writes session, xn skip_all only, aXi parent write-back", async () => {
  const harness = createManagerHarness();
  const allowAllCalls: boolean[] = [];
  const scheduledCalls: Array<{ id: string; mode: string; domains: string[] }> =
    [];
  const manager = createTestManager(harness, {
    createSessionId: () => "local_parent_uc",
    setAllowAllBrowserActions: (allowed) => {
      allowAllCalls.push(allowed);
    },
    updateScheduledTaskChromePermissions: (id, mode, domains) => {
      scheduledCalls.push({ id, mode, domains: [...domains] });
    },
  });

  // missing is no-op
  manager.updateChromePermission("missing", "ask", ["x.com"]);
  expect(allowAllCalls).toEqual([]);

  const parentId = await manager.start({
    message: "parent",
    messageUuid: "p-uc-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(parentId)?.isRunning).toBe(true);
  });
  // Seed parent domains via updateChromePermission (not start input).
  manager.updateChromePermission(parentId, "ask", ["parent.com"]);
  manager.setChromePermissionMode(parentId, "ask");

  const childId = await manager.start({
    message: "dispatch-child",
    messageUuid: "c-uc-1",
    parentSessionId: parentId,
    sessionId: "local_dispatch_child_uc",
    sessionType: "dispatch_child",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(childId)?.isRunning).toBe(true);
  });

  harness.events.length = 0;
  allowAllCalls.length = 0;

  // follow_a_plan does not call xn(true); parent upgraded via aXi domain union + mode max.
  manager.updateChromePermission(childId, "follow_a_plan", ["child.com"]);
  expect(allowAllCalls).toEqual([]);
  const child = manager.getSession(childId);
  expect(child?.chromePermissionMode).toBe("follow_a_plan");
  expect(child?.chromeAllowedDomains).toEqual(["child.com"]);
  const parentAfterFollow = manager.getSession(parentId);
  expect(parentAfterFollow?.chromePermissionMode).toBe("follow_a_plan");
  expect(parentAfterFollow?.chromeAllowedDomains).toEqual([
    "parent.com",
    "child.com",
  ]);

  // skip_all → xn(true) only; does not call xn(false) on non-skip.
  manager.updateChromePermission(childId, "skip_all_permission_checks", [
    "extra.com",
  ]);
  expect(allowAllCalls).toEqual([true]);
  expect(manager.getSession(parentId)?.chromePermissionMode).toBe(
    "skip_all_permission_checks",
  );
  expect(manager.getSession(parentId)?.chromeAllowedDomains).toEqual([
    "parent.com",
    "child.com",
    "extra.com",
  ]);

  // Non-dispatch_child parentSessionId does not write back.
  const siblingId = await manager.start({
    message: "plain-child",
    messageUuid: "s-uc-1",
    parentSessionId: parentId,
    sessionId: "local_plain_child_uc",
  });
  manager.setChromePermissionMode(parentId, "ask");
  manager.updateChromePermission(siblingId, "skip_all_permission_checks", [
    "no-writeback.com",
  ]);
  // parent mode stays ask (not upgraded by plain child)
  expect(manager.getSession(parentId)?.chromePermissionMode).toBe("ask");
  expect(
    manager.getSession(parentId)?.chromeAllowedDomains ?? [],
  ).not.toContain("no-writeback.com");

  // scheduledTaskId inject
  const scheduledId = await manager.start({
    message: "scheduled",
    messageUuid: "t-uc-1",
    scheduledTaskId: "task-1",
    sessionId: "local_scheduled_uc",
  });
  manager.updateChromePermission(scheduledId, "follow_a_plan", ["sched.com"]);
  expect(scheduledCalls).toEqual([
    { id: "task-1", mode: "follow_a_plan", domains: ["sched.com"] },
  ]);

  // Archived parent is not written back.
  const parent2 = await manager.start({
    message: "parent2",
    messageUuid: "p2-uc",
    sessionId: "local_parent2_uc",
  });
  manager.setChromePermissionMode(parent2, "ask");
  const archivedParentChild = await manager.start({
    message: "dc-arch",
    messageUuid: "dc-arch",
    parentSessionId: parent2,
    sessionId: "local_dc_arch_uc",
    sessionType: "dispatch_child",
  });
  await manager.archive(parent2);
  manager.updateChromePermission(archivedParentChild, "follow_a_plan", [
    "gone.com",
  ]);
  expect(manager.getSession(parent2)?.chromePermissionMode).toBe("ask");
  expect(
    manager.getSession(parent2)?.chromeAllowedDomains ?? [],
  ).not.toContain("gone.com");
});

it("start chrome seed derives K2 from account isRaven when inject omitted", async () => {
  const ravenHarness = createManagerHarness();
  // Default test account has no isRaven → official ?? true → K2 false.
  const ravenManager = createTestManager(ravenHarness, {
    createSessionId: () => "local_seed_raven",
    getAllowAllBrowserActions: () => true,
  });
  const ravenId = await ravenManager.start({
    message: "raven-seed",
    messageUuid: "raven-1",
  });
  expect(ravenManager.getSession(ravenId)?.chromePermissionMode).toBeUndefined();

  const nonRavenHarness = createManagerHarness();
  const nonRavenManager = createTestManager(nonRavenHarness, {
    accountContext: createTestAccountContext({ isRaven: false }),
    createSessionId: () => "local_seed_non_raven",
    getAllowAllBrowserActions: () => true,
  });
  const nonRavenId = await nonRavenManager.start({
    message: "non-raven-seed",
    messageUuid: "nr-1",
  });
  expect(nonRavenManager.getSession(nonRavenId)?.chromePermissionMode).toBe(
    "skip_all_permission_checks",
  );
});

it("start chrome seed applies K2+gi default and scheduled task chrome", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    allowSkipAllOutsideUnsupervised: () => true,
    createSessionId: () => "local_seed_pref",
    getAllowAllBrowserActions: () => true,
    getScheduledTaskChromePermissions: (id) =>
      id === "task-seed"
        ? { mode: "follow_a_plan", domains: ["sched.com"] }
        : undefined,
  });

  const prefId = await manager.start({
    message: "pref-seed",
    messageUuid: "pref-1",
  });
  expect(manager.getSession(prefId)?.chromePermissionMode).toBe(
    "skip_all_permission_checks",
  );

  const scheduledId = await manager.start({
    message: "sched-seed",
    messageUuid: "sched-1",
    scheduledTaskId: "task-seed",
    sessionId: "local_seed_sched",
  });
  expect(manager.getSession(scheduledId)?.chromePermissionMode).toBe(
    "follow_a_plan",
  );
  expect(manager.getSession(scheduledId)?.chromeAllowedDomains).toEqual([
    "sched.com",
  ]);

  // unsupervised start with chromeSkipAll false: snapshot base from m/scheduled
  const autoId = await manager.start({
    chromeSkipAllPermissionChecks: false,
    message: "auto-seed",
    messageUuid: "auto-1",
    permissionMode: "auto",
    sessionId: "local_seed_auto",
  });
  const auto = manager.getSession(autoId);
  expect(auto?.chromePermissionMode).toBeUndefined();
  expect(auto?.chromePermsBeforeUnsupervised).toEqual({
    mode: "skip_all_permission_checks",
    domains: undefined,
  });

  // Official unsupervised chromeSkipAll clears active domains — input.chromeAllowedDomains
  // must not re-fill via createRuntimeState residual or applyStartInput stomp.
  const leakId = await manager.start({
    chromeAllowedDomains: ["leak.com"],
    chromeSkipAllPermissionChecks: false,
    message: "auto-leak",
    messageUuid: "auto-leak-1",
    permissionMode: "auto",
    scheduledTaskId: "task-seed",
    sessionId: "local_seed_auto_leak",
  });
  const leak = manager.getSession(leakId);
  expect(leak?.chromePermissionMode).toBeUndefined();
  expect(leak?.chromeAllowedDomains).toBeUndefined();
  expect(leak?.chromePermsBeforeUnsupervised).toEqual({
    mode: "follow_a_plan",
    domains: ["sched.com"],
  });

  const skipTrueId = await manager.start({
    chromeAllowedDomains: ["should-not-survive.com"],
    chromeSkipAllPermissionChecks: true,
    message: "auto-skip-true",
    messageUuid: "auto-skip-true-1",
    permissionMode: "bypassPermissions",
    sessionId: "local_seed_auto_skip_true",
  });
  const skipTrue = manager.getSession(skipTrueId);
  expect(skipTrue?.chromePermissionMode).toBe("skip_all_permission_checks");
  expect(skipTrue?.chromeAllowedDomains).toBeUndefined();
});

it("dispatch_child start inherits oXi chrome fields + snapshot from parent", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    createSessionId: () => "local_parent_oxi",
  });
  const parentId = await manager.start({
    message: "parent-oxi",
    messageUuid: "p-oxi-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(parentId)?.isRunning).toBe(true);
  });
  manager.updateChromePermission(parentId, "follow_a_plan", ["parent.com"]);
  // Force unsupervised snapshot on parent (gXi enter).
  await expect(
    manager.setPermissionMode(parentId, "auto", undefined, {
      chromeSkipAllPermissionChecks: true,
    }),
  ).resolves.toBe(true);
  const parent = manager.getSession(parentId);
  expect(parent?.chromePermissionMode).toBe("skip_all_permission_checks");
  expect(parent?.chromeAllowedDomains).toBeUndefined();
  expect(parent?.chromePermsBeforeUnsupervised).toEqual({
    mode: "follow_a_plan",
    domains: ["parent.com"],
  });
  // Seed approvedToolNames on parent runtime (oXi copies when defined).
  // getSession → toRendererSession does not expose approvedToolNames; read runtime.
  type RuntimeChrome = {
    approvedToolNames?: string[];
  };
  const getRuntime = (id: string) =>
    (
      manager as unknown as {
        repository: { get: (sessionId: string) => RuntimeChrome | undefined };
      }
    ).repository.get(id);
  getRuntime(parentId)!.approvedToolNames = ["Bash", "Read"];

  const childId = await manager.start({
    message: "child-oxi",
    messageUuid: "c-oxi-1",
    parentSessionId: parentId,
    sessionId: "local_child_oxi",
    sessionType: "dispatch_child",
  });
  const child = manager.getSession(childId);
  expect(child?.chromePermissionMode).toBe("skip_all_permission_checks");
  expect(child?.chromeAllowedDomains).toBeUndefined();
  expect(child?.chromePermsBeforeUnsupervised).toEqual({
    mode: "follow_a_plan",
    domains: ["parent.com"],
  });
  expect(getRuntime(childId)?.approvedToolNames).toEqual(["Bash", "Read"]);

  // Non-dispatch_child with parentSessionId does not inherit oXi.
  const plainId = await manager.start({
    message: "plain-oxi",
    messageUuid: "plain-oxi-1",
    parentSessionId: parentId,
    sessionId: "local_plain_oxi",
  });
  const plain = manager.getSession(plainId);
  expect(plain?.chromePermissionMode).not.toBe("skip_all_permission_checks");
  expect(plain?.chromePermsBeforeUnsupervised).toBeUndefined();
  expect(getRuntime(plainId)?.approvedToolNames).toBeUndefined();
});

it("chromeTabGroupId CIC get/onUpdated + getSession hydrate", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    createSessionId: () => "local_tab_group",
  });
  // Missing session: get returns undefined; update is no-op.
  expect(manager.getChromeTabGroupId("missing")).toBeUndefined();
  manager.onChromeTabGroupIdUpdated("missing", 99);

  const sessionId = await manager.start({
    message: "tab-group",
    messageUuid: "tg-1",
  });
  expect(manager.getChromeTabGroupId(sessionId)).toBeUndefined();
  expect(manager.getSession(sessionId)?.chromeTabGroupId).toBeUndefined();

  // Official onChromeTabGroupIdUpdated assigns only (no immediate session_updated).
  const beforeEvents = harness.events.filter(
    (event) => event.type === "session_updated",
  ).length;
  manager.onChromeTabGroupIdUpdated(sessionId, 17);
  expect(manager.getChromeTabGroupId(sessionId)).toBe(17);
  expect(manager.getSession(sessionId)?.chromeTabGroupId).toBe(17);
  const afterEvents = harness.events.filter(
    (event) => event.type === "session_updated",
  ).length;
  expect(afterEvents).toBe(beforeEvents);

  // Overwrite + zero is valid (Vt.number, not positive-only).
  manager.onChromeTabGroupIdUpdated(sessionId, 0);
  expect(manager.getChromeTabGroupId(sessionId)).toBe(0);
  expect(manager.getSession(sessionId)?.chromeTabGroupId).toBe(0);
});

it("cuAllowedApps/cuGrantFlags get/onUpdated + oXi inherit + parent write-back", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    createSessionId: () => "local_cu_parent",
  });
  // Missing session
  expect(manager.getCuAllowedApps("missing")).toBeUndefined();
  expect(manager.getCuGrantFlags("missing")).toBeUndefined();
  manager.onCuPermissionUpdated(
    "missing",
    [{ bundleId: "x", displayName: "X", grantedAt: 1 }],
    {
      clipboardRead: true,
      clipboardWrite: false,
      systemKeyCombos: false,
    },
  );

  const parentId = await manager.start({
    message: "cu-parent",
    messageUuid: "cu-p-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(parentId)?.isRunning).toBe(true);
  });

  const apps = [
    {
      bundleId: "com.apple.Safari",
      displayName: "Safari",
      grantedAt: Date.now(),
    },
  ];
  const flags = {
    clipboardRead: true,
    clipboardWrite: false,
    systemKeyCombos: false,
  };
  const beforeEvents = harness.events.filter(
    (event) => event.type === "session_updated",
  ).length;
  // Official onCuPermissionUpdated assigns only (no save/session_updated).
  manager.onCuPermissionUpdated(parentId, apps, flags);
  const afterEvents = harness.events.filter(
    (event) => event.type === "session_updated",
  ).length;
  expect(afterEvents).toBe(beforeEvents);
  expect(manager.getCuAllowedApps(parentId)).toEqual(apps);
  expect(manager.getCuGrantFlags(parentId)).toEqual(flags);
  expect(manager.getSession(parentId)?.cuAllowedApps).toEqual(apps);
  expect(manager.getSession(parentId)?.cuGrantFlags).toEqual(flags);

  // oXi inherit onto dispatch_child
  const childId = await manager.start({
    message: "cu-child",
    messageUuid: "cu-c-1",
    parentSessionId: parentId,
    sessionId: "local_cu_child",
    sessionType: "dispatch_child",
  });
  expect(manager.getSession(childId)?.cuAllowedApps).toEqual(apps);
  expect(manager.getSession(childId)?.cuGrantFlags).toEqual(flags);

  // Child write-back merges into live parent (pwe + cXi); assign-only.
  const childApps = [
    ...apps,
    {
      bundleId: "com.apple.Notes",
      displayName: "Notes",
      grantedAt: Date.now(),
    },
  ];
  const childFlags = {
    clipboardRead: false,
    clipboardWrite: true,
    systemKeyCombos: true,
  };
  const beforeChildEvents = harness.events.filter(
    (event) => event.type === "session_updated",
  ).length;
  manager.onCuPermissionUpdated(childId, childApps, childFlags);
  const afterChildEvents = harness.events.filter(
    (event) => event.type === "session_updated",
  ).length;
  expect(afterChildEvents).toBe(beforeChildEvents);
  expect(manager.getCuAllowedApps(childId)).toEqual(childApps);
  expect(manager.getCuGrantFlags(childId)).toEqual(childFlags);
  // parent keeps Safari, adds Notes; flags OR
  const parentApps = manager.getCuAllowedApps(parentId)!;
  expect(parentApps.map((a) => a.bundleId).sort()).toEqual([
    "com.apple.Notes",
    "com.apple.Safari",
  ]);
  expect(manager.getCuGrantFlags(parentId)).toEqual({
    clipboardRead: true,
    clipboardWrite: true,
    systemKeyCombos: true,
  });

  // Archived parent: getDispatchParentForWriteBack returns undefined → no merge.
  const archParentId = await manager.start({
    message: "cu-arch-parent",
    messageUuid: "cu-ap-1",
    sessionId: "local_cu_arch_parent",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(archParentId)?.isRunning).toBe(true);
  });
  manager.onCuPermissionUpdated(
    archParentId,
    [{ bundleId: "com.keep", displayName: "Keep", grantedAt: Date.now() }],
    {
      clipboardRead: false,
      clipboardWrite: false,
      systemKeyCombos: false,
    },
  );
  await manager.archive(archParentId);
  const archChildId = await manager.start({
    message: "cu-arch-child",
    messageUuid: "cu-ac-1",
    parentSessionId: archParentId,
    sessionId: "local_cu_arch_child",
    sessionType: "dispatch_child",
  });
  // oXi still inherits from parent at start (parent may be archived but still in map).
  // Write-back on child update must NOT touch archived parent.
  const beforeArchApps = manager.getCuAllowedApps(archParentId);
  manager.onCuPermissionUpdated(
    archChildId,
    [
      {
        bundleId: "com.child.only",
        displayName: "ChildOnly",
        grantedAt: Date.now(),
      },
    ],
    {
      clipboardRead: true,
      clipboardWrite: true,
      systemKeyCombos: true,
    },
  );
  expect(manager.getCuAllowedApps(archParentId)).toEqual(beforeArchApps);
  expect(manager.getCuAllowedApps(archChildId)?.[0]?.bundleId).toBe(
    "com.child.only",
  );
});

it("getComputerUseGrants + revokeComputerUseGrant parent/sibling write-back", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    createSessionId: () => "local_revoke_parent",
  });
  expect(manager.getComputerUseGrants("missing")).toEqual([]);
  expect(manager.revokeComputerUseGrant("missing", "x")).toBe(false);

  const parentId = await manager.start({
    message: "revoke-parent",
    messageUuid: "rp-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(parentId)?.isRunning).toBe(true);
  });
  const now = Date.now();
  const apps = [
    { bundleId: "com.keep", displayName: "Keep", grantedAt: now },
    { bundleId: "com.drop", displayName: "Drop", grantedAt: now },
  ];
  manager.onCuPermissionUpdated(parentId, apps, {
    clipboardRead: false,
    clipboardWrite: false,
    systemKeyCombos: false,
  });
  expect(manager.getComputerUseGrants(parentId)).toEqual(apps);

  const childA = await manager.start({
    message: "revoke-child-a",
    messageUuid: "rca-1",
    parentSessionId: parentId,
    sessionId: "local_revoke_child_a",
    sessionType: "dispatch_child",
  });
  const childB = await manager.start({
    message: "revoke-child-b",
    messageUuid: "rcb-1",
    parentSessionId: parentId,
    sessionId: "local_revoke_child_b",
    sessionType: "dispatch_child",
  });
  // oXi inherit both apps
  expect(manager.getComputerUseGrants(childA).map((a) => a.bundleId).sort()).toEqual([
    "com.drop",
    "com.keep",
  ]);
  expect(manager.getComputerUseGrants(childB)).toHaveLength(2);

  // Official revoke saves only (no session_updated) — match disk-save path.
  const beforeEvents = harness.events.filter(
    (event) => event.type === "session_updated",
  ).length;
  expect(manager.revokeComputerUseGrant(childA, "com.drop")).toBe(true);
  const afterEvents = harness.events.filter(
    (event) => event.type === "session_updated",
  ).length;
  expect(afterEvents).toBe(beforeEvents);

  // childA, parent, and sibling childB all drop com.drop
  expect(manager.getComputerUseGrants(childA).map((a) => a.bundleId)).toEqual([
    "com.keep",
  ]);
  expect(manager.getComputerUseGrants(parentId).map((a) => a.bundleId)).toEqual([
    "com.keep",
  ]);
  expect(manager.getComputerUseGrants(childB).map((a) => a.bundleId)).toEqual([
    "com.keep",
  ]);
  // missing bundle → false
  expect(manager.revokeComputerUseGrant(childA, "com.drop")).toBe(false);
  // revoke last remaining from parent
  expect(manager.revokeComputerUseGrant(parentId, "com.keep")).toBe(true);
  expect(manager.getComputerUseGrants(parentId)).toEqual([]);
});

it("handleBrowserPermissionRequest gLi+nXi routes via broker and cLi maps", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    createSessionId: () => "local_browser_parent",
  });
  const parentId = await manager.start({
    message: "browser-parent",
    messageUuid: "bp-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(parentId)?.isRunning).toBe(true);
  });
  const childId = await manager.start({
    message: "browser-child",
    messageUuid: "bc-1",
    parentSessionId: parentId,
    sessionId: "local_browser_child",
    sessionType: "dispatch_child",
  });
  expect(manager.resolvePermissionSessionId(childId)).toBe(parentId);
  expect(manager.resolvePermissionSessionId(parentId)).toBe(parentId);

  const pending = manager.handleBrowserPermissionRequest(childId, {
    toolType: "navigate",
    url: "https://example.com/x",
    actionData: { deviceId: "d1" },
  });
  // Permission targets parent (nXi); request should appear on parent pending.
  await vi.waitFor(() => {
    const parent = manager.getSession(parentId);
    expect(parent?.pendingToolPermissions?.length).toBeGreaterThan(0);
  });
  const req = manager.getSession(parentId)!.pendingToolPermissions![0]!;
  expect(req.toolName).toBe("browser:navigate");
  expect(req.sessionId).toBe(parentId);
  expect(req.input).toMatchObject({
    deviceId: "d1",
    domain: "example.com",
  });
  expect(req.input).not.toHaveProperty("_allowAllSites");

  manager.respondToToolPermission(req.requestId, "once");
  await expect(pending).resolves.toEqual({
    allowed: true,
    always: false,
    allSites: false,
  });

  // always-allow maps cLi always=true (via updatedPermissions path) — use always decision.
  const pendingAlways = manager.handleBrowserPermissionRequest(parentId, {
    toolType: "click",
    url: "https://a.com",
  });
  await vi.waitFor(() => {
    expect(
      manager.getSession(parentId)?.pendingToolPermissions?.length,
    ).toBeGreaterThan(0);
  });
  const req2 = manager.getSession(parentId)!.pendingToolPermissions![0]!;
  manager.respondToToolPermission(req2.requestId, "always");
  await expect(pendingAlways).resolves.toEqual({
    allowed: true,
    always: true,
    allSites: false,
  });

  // deny
  const pendingDeny = manager.handleBrowserPermissionRequest(parentId, {
    toolType: "navigate",
    url: "https://b.com",
  });
  await vi.waitFor(() => {
    expect(
      manager.getSession(parentId)?.pendingToolPermissions?.length,
    ).toBeGreaterThan(0);
  });
  const req3 = manager.getSession(parentId)!.pendingToolPermissions![0]!;
  manager.respondToToolPermission(req3.requestId, "deny");
  await expect(pendingDeny).resolves.toEqual({
    allowed: false,
    always: false,
    allSites: false,
  });
});

it("stop tracks lam_session_stopped when had query (official je)", async () => {
  const sink = vi.fn();
  setCoworkSessionLifecycleAnalyticsSink(sink);
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  // Official session.cliSessionId optional on props.
  const runtime = (
    manager as unknown as {
      repository: { get: (id: string) => { cliSessionId?: string } };
    }
  ).repository.get(sessionId);
  if (runtime) runtime.cliSessionId = "cli-stop-1";
  await manager.stop(sessionId);
  expect(sink).toHaveBeenCalledWith({
    name: "lam_session_stopped",
    props: expect.objectContaining({
      session_id: sessionId,
      cli_session_id: "cli-stop-1",
      total_turns: expect.any(Number),
      session_duration_ms: expect.any(Number),
    }),
  });
  const props = sink.mock.calls[0][0].props;
  expect(props.vm_instance_id).toEqual(expect.any(String));
  expect("session_type" in props).toBe(true);
});

it("archive force-skips stopped and tracks lam_session_archived", async () => {
  const sink = vi.fn();
  setCoworkSessionLifecycleAnalyticsSink(sink);
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
  });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  await manager.archive(sessionId);
  const names = sink.mock.calls.map((c) => c[0].name);
  expect(names).not.toContain("lam_session_stopped");
  expect(names).toContain("lam_session_archived");
  const archived = sink.mock.calls.find(
    (c) => c[0].name === "lam_session_archived",
  )![0].props;
  expect(archived.session_id).toBe(sessionId);
  expect("session_type" in archived).toBe(false);
});

it("handleInboundControlRequest interrupt routes to interruptTurn (bridge residual)", async () => {
  // Official: control_request subtype interrupt → sessionManager.interruptTurn(local).
  // Product: inject getBridgeActiveSession; no full remote bridge invent.
  const harness = createManagerHarness();
  const localIdHolder = { id: "" as string };
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
    getBridgeActiveSession: (remote) =>
      remote === "remote-1" ? { localSessionId: localIdHolder.id } : null,
  });
  const sessionId = await manager.start({
    message: "hello",
    messageUuid: "message-1",
  });
  localIdHolder.id = sessionId;
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(true);
  });
  const track = vi.fn();
  const outcome = await manager.handleInboundControlRequest(
    "remote-1",
    {
      type: "control_request",
      request_id: "req-int-1",
      request: { subtype: "interrupt" },
    },
    { track },
  );
  expect(outcome).toBe("interrupted");
  expect(track).toHaveBeenCalledWith(
    expect.objectContaining({
      outcome: "interrupted",
      local_session_id: sessionId,
      request_id: "req-int-1",
    }),
  );
  // interruptTurn sets flag on live query.
  const runtime = (
    manager as unknown as {
      repository: {
        get: (id: string) => { _turnInterruptRequested?: boolean } | undefined;
      };
    }
  ).repository.get(sessionId);
  expect(runtime?._turnInterruptRequested).toBe(true);
});

it("handleInboundControlRequest no_session when bridge map miss", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
    getBridgeActiveSession: () => null,
  });
  const track = vi.fn();
  await expect(
    manager.handleInboundControlRequest(
      "remote-missing",
      {
        type: "control_request",
        request: { subtype: "interrupt" },
      },
      { track },
    ),
  ).resolves.toBe("no_session");
  expect(track).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: "no_session" }),
  );
});

it("sendMessage cancelIdleGrace teardown:false reuses warm process (idle grace residual)", async () => {
  // Official: if _idleGraceTimer → cancelIdleGrace({teardown:false}) + running.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const harness = createManagerHarness();
    const manager = createTestManager(harness, {
      getIdleGraceMs: () => 60_000,
      resolveHostLoopMode: () => true,
    });
    const sessionId = await manager.start({
      message: "hello",
      messageUuid: "message-1",
    });
    await vi.waitFor(() => {
      expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    });
    const getRuntime = () =>
      (
        manager as unknown as {
          repository: {
            get: (id: string) => {
              lifecycleState: string;
              _idleGraceTimer?: ReturnType<typeof setTimeout>;
              query: { close: () => void } | null;
              inputStream: unknown;
            } | undefined;
          };
        }
      ).repository.get(sessionId)!;
    const runtime = getRuntime();
    runtime.lifecycleState = "idle";
    (
      manager as unknown as {
        maybeArmIdleGraceAfterIdle: (
          id: string,
          o?: { fromRunning?: boolean },
        ) => void;
      }
    ).maybeArmIdleGraceAfterIdle(sessionId, { fromRunning: true });
    expect(runtime._idleGraceTimer).toBeDefined();
    const queryBefore = runtime.query;
    expect(queryBefore).not.toBeNull();
    await manager.sendMessage(sessionId, "follow-up", undefined, undefined, "m2");
    expect(runtime._idleGraceTimer).toBeUndefined();
    // teardown:false reuses process — query still the same live handle.
    expect(runtime.query).toBe(queryBefore);
    expect(runtime.lifecycleState).toBe("running");
  } finally {
    vi.useRealTimers();
  }
});

it("idle grace expiry tears down process when still idle", async () => {
  vi.useFakeTimers();
  try {
    const harness = createManagerHarness();
    const manager = createTestManager(harness, {
      getIdleGraceMs: () => 1_000,
      resolveHostLoopMode: () => true,
    });
    const sessionId = await manager.start({
      message: "hello",
      messageUuid: "message-1",
    });
    // Don't use waitFor with fake timers — advance microtasks manually.
    await Promise.resolve();
    await Promise.resolve();
    const getRuntime = () =>
      (
        manager as unknown as {
          repository: {
            get: (id: string) => {
              lifecycleState: string;
              _idleGraceTimer?: ReturnType<typeof setTimeout>;
              query: unknown;
              inputStream: unknown;
            } | undefined;
          };
        }
      ).repository.get(sessionId)!;
    // Wait for start attach with real time briefly.
    vi.useRealTimers();
    await vi.waitFor(() => {
      expect(manager.getSession(sessionId)?.isRunning).toBe(true);
    });
    vi.useFakeTimers();
    const runtime = getRuntime();
    runtime.lifecycleState = "idle";
    (
      manager as unknown as {
        maybeArmIdleGraceAfterIdle: (
          id: string,
          o?: { fromRunning?: boolean },
        ) => void;
      }
    ).maybeArmIdleGraceAfterIdle(sessionId, { fromRunning: true });
    expect(runtime._idleGraceTimer).toBeDefined();
    expect(runtime.query).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runtime._idleGraceTimer).toBeUndefined();
    expect(runtime.query).toBeNull();
    expect(runtime.inputStream).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});


it("applyMcpServersIfIdle defers while running and flushes on idle grace arm", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    getIdleGraceMs: () => 60_000,
    resolveHostLoopMode: () => true,
    createRemoteMcpServers: async () => ({
      "uuid-new": { type: "http", name: "New" },
    }),
  });
  const sessionId = await manager.start({
    message: "mcp-apply",
    messageUuid: "message-1",
    remoteMcpServers: [
      { uuid: "uuid-old", name: "Old", tools: [{ name: "t" }] },
    ],
  });
  await vi.waitFor(() => expect(manager.getSession(sessionId)?.isRunning).toBe(true));

  const runtime = (manager as unknown as {
    repository: {
      get: (id: string) => {
        query: { mcpServerSets: Array<Record<string, unknown>> } | null;
        activeMcpServers?: Record<string, unknown>;
        mcpServersDirty?: boolean;
        lifecycleState?: string;
      } | undefined;
    };
  }).repository.get(sessionId)!;
  // Seed active + force running apply path via replaceRemote.
  runtime.activeMcpServers = {
    "uuid-old": { type: "http" },
    keepLocal: { type: "sdk" },
  };

  await manager.replaceRemoteMcpServers(sessionId, [
    { uuid: "uuid-new", name: "New", tools: [{ name: "t" }] },
  ]);

  // Still running → deferred dirty, no setMcpServers yet.
  expect(runtime.mcpServersDirty).toBe(true);
  expect(runtime.activeMcpServers).toEqual({
    keepLocal: { type: "sdk" },
    "uuid-new": { type: "http", name: "New" },
  });
  const query = runtime.query as { mcpServerSets: Array<Record<string, unknown>> } | null;
  expect(query?.mcpServerSets ?? []).toHaveLength(0);

  // Transition to idle + arm grace → flush deferred setMcpServers.
  runtime.lifecycleState = "idle";
  manager.maybeArmIdleGraceAfterIdle(sessionId, {
    fromRunning: true,
    hasError: false,
  });
  await vi.waitFor(() =>
    expect((runtime.query as { mcpServerSets: unknown[] } | null)?.mcpServerSets.length).toBe(1),
  );
  expect(runtime.mcpServersDirty).toBe(false);
  expect(
    (runtime.query as { mcpServerSets: Array<Record<string, unknown>> }).mcpServerSets[0],
  ).toEqual(runtime.activeMcpServers);
});

it("setMcpServers skips dispatch_child and applies disable/enable when idle", async () => {
  // Separate harnesses — createSessionId defaults to local_session_1.
  const skipHarness = createManagerHarness();
  const skipManager = createTestManager(skipHarness, {
    resolveHostLoopMode: () => true,
  });
  const skipId = await skipManager.start({
    message: "dispatch",
    messageUuid: "message-1",
    sessionType: "dispatch_child",
  });
  await vi.waitFor(() =>
    expect(skipManager.getSession(skipId)?.isRunning).toBe(true),
  );
  const skip = await skipManager.setMcpServers(skipId, [
    {
      enabled: true,
      name: "X",
      toolKeys: ["x:tool"],
      uuid: "u-skip",
    },
  ]);
  expect(skip.enabledMcpTools).toEqual({});

  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    resolveHostLoopMode: () => true,
    createMcpServer: async (_id, server) => ({
      key: server.uuid,
      server: { type: "http", name: server.name },
    }),
  });
  const sessionId = await manager.start({
    message: "set-mcp",
    messageUuid: "message-2",
  });
  await vi.waitFor(() =>
    expect(manager.getSession(sessionId)?.isRunning).toBe(true),
  );
  const runtime = (
    manager as unknown as {
      repository: {
        get: (id: string) =>
          | {
              query: { mcpServerSets: Array<Record<string, unknown>> } | null;
              activeMcpServers?: Record<string, unknown>;
              mcpServersDirty?: boolean;
              lifecycleState: string;
              enabledMcpTools?: Record<string, boolean>;
              sessionType?: string;
            }
          | undefined;
      };
    }
  ).repository.get(sessionId)!;
  expect(runtime.sessionType).not.toBe("agent");
  expect(runtime.sessionType).not.toBe("dispatch_child");
  runtime.lifecycleState = "idle";
  runtime.activeMcpServers = { "uuid-old": { type: "http" } };

  const result = await manager.setMcpServers(sessionId, [
    {
      enabled: false,
      name: "Old",
      toolKeys: ["old:tool"],
      type: "http",
      uuid: "uuid-old",
    },
    {
      enabled: true,
      name: "New",
      toolKeys: ["new:tool"],
      type: "http",
      uuid: "uuid-new",
    },
  ]);
  expect(result.enabledMcpTools).toEqual({
    "old:tool": false,
    "new:tool": true,
  });
  expect(runtime.activeMcpServers).toEqual({
    "uuid-new": { type: "http", name: "New" },
  });
  expect(runtime.mcpServersDirty).toBe(false);
  expect(
    (
      runtime.query as { mcpServerSets: Array<Record<string, unknown>> }
    ).mcpServerSets.at(-1),
  ).toEqual({ "uuid-new": { type: "http", name: "New" } });
});


it("Ds residual: setFocusedSession closes notifications via desktopNotificationService", () => {
  const focusCloses: Array<string | null | undefined> = [];
  const shown: string[] = [];
  const manager = createTestManager(createManagerHarness(), {
    desktopNotificationService: {
      handleFocusedSessionChanged: (id) => focusCloses.push(id),
      showIdleNotification: (input) => shown.push(input.sessionId),
    },
  });
  manager.setFocusedSession("s1");
  manager.setFocusedSession("s1"); // same — no second close
  manager.setFocusedSession(null); // still invokes handle with null (service no-ops)
  expect(focusCloses).toEqual(["s1", null]);
  expect(shown).toEqual([]);
});

it("Ds residual: queryCompleted shows idle when unfocused; skips focused/scheduled", async () => {
  const shown: Array<{ sessionId: string; title?: string | null }> = [];
  const navigated: string[] = [];
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    createSessionId: () => "local_ds_idle",
    desktopNotificationService: {
      handleFocusedSessionChanged: () => undefined,
      showIdleNotification: (input) => {
        shown.push({ sessionId: input.sessionId, title: input.sessionTitle });
        input.onClick?.();
      },
    },
    navigateToLocalSession: (id) => navigated.push(id),
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "ds-idle",
    messageUuid: "ds-1",
  });
  await vi.waitFor(() => expect(harness.factoryInputs).toHaveLength(1));
  await nextUserMessage(harness.factoryInputs[0]!.prompt);
  // Unfocused → show
  manager.setFocusedSession("other");
  harness.query.push({ is_error: false, subtype: "success", type: "result" });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(false);
  });
  await vi.waitFor(() => expect(shown).toHaveLength(1));
  expect(shown[0]!.sessionId).toBe(sessionId);
  expect(navigated).toEqual([sessionId]); // onClick from showIdle

  // Focused → skip
  shown.length = 0;
  navigated.length = 0;
  await manager.sendMessage(sessionId, "again", undefined, undefined, "ds-2");
  await nextUserMessage(harness.factoryInputs[0]!.prompt);
  manager.setFocusedSession(sessionId);
  harness.query.push({ is_error: false, subtype: "success", type: "result" });
  await vi.waitFor(() => {
    expect(manager.getSession(sessionId)?.isRunning).toBe(false);
  });
  // give microtasks a chance
  await Promise.resolve();
  expect(shown).toEqual([]);

  // scheduledTaskId → skip (seed on start — getSession renderer is a snapshot)
  const scheduledHarness = createManagerHarness();
  const scheduledShown: string[] = [];
  const scheduledManager = createTestManager(scheduledHarness, {
    createSessionId: () => "local_ds_sched",
    desktopNotificationService: {
      handleFocusedSessionChanged: () => undefined,
      showIdleNotification: (input) => scheduledShown.push(input.sessionId),
    },
    resolveHostLoopMode: () => true,
  });
  const scheduledId = await scheduledManager.start({
    message: "sched",
    messageUuid: "ds-sched",
    scheduledTaskId: "task-1",
  });
  await vi.waitFor(() => expect(scheduledHarness.factoryInputs).toHaveLength(1));
  await nextUserMessage(scheduledHarness.factoryInputs[0]!.prompt);
  scheduledManager.setFocusedSession("other");
  scheduledHarness.query.push({
    is_error: false,
    subtype: "success",
    type: "result",
  });
  await vi.waitFor(() => {
    expect(scheduledManager.getSession(scheduledId)?.isRunning).toBe(false);
  });
  await Promise.resolve();
  expect(scheduledShown).toEqual([]);
});

it("Ds residual: isHiddenSession follows iv sessionType gate", async () => {
  const harness = createManagerHarness();
  const manager = createTestManager(harness, {
    createSessionId: () => "local_ds_hidden",
    resolveHostLoopMode: () => true,
  });
  const sessionId = await manager.start({
    message: "hidden",
    messageUuid: "h-1",
    sessionType: "agent",
  });
  expect(manager.isHiddenSession(sessionId)).toBe(true);
  expect(manager.isHiddenSession("missing")).toBe(false);

  // Hidden sessionType skips idle show on queryCompleted
  const hiddenHarness = createManagerHarness();
  const hiddenShown: string[] = [];
  const hiddenManager = createTestManager(hiddenHarness, {
    createSessionId: () => "local_ds_hidden_idle",
    desktopNotificationService: {
      handleFocusedSessionChanged: () => undefined,
      showIdleNotification: (input) => hiddenShown.push(input.sessionId),
    },
    resolveHostLoopMode: () => true,
  });
  const hiddenId = await hiddenManager.start({
    message: "agent-idle",
    messageUuid: "ha-1",
    sessionType: "agent",
  });
  await vi.waitFor(() => expect(hiddenHarness.factoryInputs).toHaveLength(1));
  await nextUserMessage(hiddenHarness.factoryInputs[0]!.prompt);
  hiddenManager.setFocusedSession("other");
  hiddenHarness.query.push({
    is_error: false,
    subtype: "success",
    type: "result",
  });
  await vi.waitFor(() => {
    expect(hiddenManager.getSession(hiddenId)?.isRunning).toBe(false);
  });
  await Promise.resolve();
  expect(hiddenShown).toEqual([]);
});
