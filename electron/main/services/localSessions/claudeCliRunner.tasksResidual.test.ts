/**
 * Official LocalSessionManager residual unit tests (SDK Query path only).
 * Plants sdkSessions (no densable print ActiveTurn).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeCliRunner } from "./claudeCliRunner";
import type { CodeSdkActiveSession, CodeSdkSessionCallbacks } from "./codeSdkQuerySession";
import { LocalSessionStore } from "./localSessionStore";

const createCodeSdkActiveSession = vi.hoisted(() => vi.fn());
vi.mock("./codeSdkQuerySession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codeSdkQuerySession")>();
  return {
    ...actual,
    createCodeSdkActiveSession: (...args: unknown[]) => createCodeSdkActiveSession(...args),
  };
});

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeStore(): LocalSessionStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-runner-sdk-"));
  tempDirs.push(dir);
  return new LocalSessionStore("code", path.join(dir, "code-sessions.json"));
}

function plantSdk(
  runner: ClaudeCliRunner,
  sessionId: string,
  overrides: Partial<CodeSdkActiveSession> = {},
): CodeSdkActiveSession {
  const interrupt = vi.fn(async () => undefined);
  const stopTask = vi.fn(async () => undefined);
  const close = vi.fn();
  const sdk = {
    deferredSends: [],
    input: { enqueue: vi.fn() },
    isRunning: true,
    isStopping: false,
    loop: Promise.resolve(),
    pendingPermissions: new Map(),
    query: {
      interrupt,
      stopTask,
      close,
      setPermissionMode: vi.fn(async () => undefined),
      setModel: vi.fn(async () => undefined),
      applyFlagSettings: vi.fn(async () => true),
      getContextUsage: vi.fn(async () => null),
    },
    sawInit: true,
    sawResult: false,
    sessionId,
    ...overrides,
  } as unknown as CodeSdkActiveSession;
  (
    runner as unknown as { sdkSessions: Map<string, CodeSdkActiveSession> }
  ).sdkSessions.set(sessionId, sdk);
  return sdk;
}

describe("ClaudeCliRunner SDK residual (official LocalSessionManager)", () => {
  it("SDK message path mirrors durable CLI types into liveBuffers (assistant survives settle)", async () => {
    // Product residual: print path appendTranscriptEvent every CLI event; SDK path must
    // mirror user/assistant/system/result so getTranscript keeps the turn if jsonl is late.
    const store = makeStore();
    const session = store.start({ prompt: "2222", cwd: "D:\tmp\proj", title: "2222" });
    // warmSession requires cliSessionId (official resume warm).
    store.setCliSessionId(session.id, "cli-warm-seed");
    let capturedOnEvent: ((event: Record<string, unknown>) => void) | null = null;
    createCodeSdkActiveSession.mockImplementation(async (opts: {
      callbacks: CodeSdkSessionCallbacks;
      sessionId: string;
    }) => {
      capturedOnEvent = opts.callbacks.onEvent;
      const interrupt = vi.fn(async () => undefined);
      const stopTask = vi.fn(async () => undefined);
      const close = vi.fn();
      return {
        deferredSends: [],
        input: { enqueue: vi.fn() },
        isRunning: false,
        isStopping: false,
        loop: Promise.resolve(),
        pendingPermissions: new Map(),
        query: {
          interrupt,
          stopTask,
          close,
          setPermissionMode: vi.fn(async () => undefined),
          setModel: vi.fn(async () => undefined),
          applyFlagSettings: vi.fn(async () => true),
          getContextUsage: vi.fn(async () => null),
        },
        sawInit: false,
        sawResult: false,
        sessionId: opts.sessionId,
      } as unknown as CodeSdkActiveSession;
    });

    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    // warmSession → ensureSdkSession → createCodeSdkActiveSession (mocked)
    await expect(runner.warmSession(session.id)).resolves.toBe(true);
    expect(capturedOnEvent).toBeTypeOf("function");

    capturedOnEvent!({
      type: "message",
      sessionId: session.id,
      message: {
        type: "system",
        subtype: "init",
        session_id: "cli-live-1",
        slash_commands: ["compact"],
        model: "grok-4.5",
      },
    });
    capturedOnEvent!({
      type: "message",
      sessionId: session.id,
      message: {
        type: "assistant",
        uuid: "asst-live-1",
        message: { role: "assistant", content: [{ type: "text", text: "pong" }] },
      },
    });
    // stream_event must NOT pollute liveBuffers (partial, not jsonl-durable)
    capturedOnEvent!({
      type: "message",
      sessionId: session.id,
      message: {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } },
      },
    });

    const live = store.getLiveEvents(session.id);
    expect(live.some((e) => (e as { type?: string }).type === "assistant")).toBe(true);
    expect(live.some((e) => (e as { type?: string }).type === "stream_event")).toBe(false);
    expect(store.getSession(session.id)?.cliSessionId).toBe("cli-live-1");

    store.setRunning(session.id, false, { kind: "claude-cli" }, { preserveLiveBuffer: true });
    expect(store.getLiveEvents(session.id).some((e) => (e as { type?: string }).type === "assistant")).toBe(
      true,
    );
  });

  it("interrupt() without warm query falls back to stop()", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "interrupt fallback" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    await expect(runner.interrupt(session.id)).resolves.toEqual({ continued: false });
    expect(store.getSession(session.id)?.isRunning).toBe(false);
  });

  it("interrupt() before system/init is official no-query → stopSession", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "interrupt before init" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    const sdk = plantSdk(runner, session.id, { sawInit: false, isRunning: true });
    await expect(runner.interrupt(session.id)).resolves.toEqual({ continued: false });
    expect(sdk.query.interrupt).not.toHaveBeenCalled();
    expect(
      (runner as unknown as { sdkSessions: Map<string, unknown> }).sdkSessions.has(session.id),
    ).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(false);
  });

  it("interrupt() success markNotRunning keeps warm query (signalTurnComplete, no deferred)", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "interrupt markNotRunning" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    // Official: clearPendingPermissions is teardownQuery only — interrupt success must NOT clear.
    store.setPendingToolPermission(session.id, {
      requestId: "perm-1",
      toolName: "Bash",
      input: { command: "ls" },
      suggestions: [],
    } as never);
    const events: Array<Record<string, unknown>> = [];
    let sessionUpdated = 0;
    const runner = new ClaudeCliRunner(store, {
      onEvent: (event) => {
        events.push(event);
      },
      onSessionUpdated: () => {
        sessionUpdated += 1;
      },
    });
    const sdk = plantSdk(runner, session.id, {
      sawInit: true,
      isRunning: true,
      deferredSends: [],
    });
    await expect(runner.interrupt(session.id)).resolves.toEqual({ continued: true });
    expect(sdk.query.interrupt).toHaveBeenCalledTimes(1);
    expect(sdk.isRunning).toBe(false);
    expect(sdk.sawResult).toBe(true);
    expect(
      (runner as unknown as { sdkSessions: Map<string, unknown> }).sdkSessions.has(session.id),
    ).toBe(true);
    expect(store.getSession(session.id)?.isRunning).toBe(false);
    expect(store.getSession(session.id)?.pendingToolPermissions ?? []).toHaveLength(1);
    expect(events.some((event) => event.type === "stopped")).toBe(false);
    // Official asar: markNotRunning + session_updated only (no type:"completed" invent).
    expect(events.some((event) => event.type === "completed")).toBe(false);
    expect(sessionUpdated).toBeGreaterThan(0);
  });

  it("stop() teardown clears host pendingToolPermissions (clearPendingPermissions residual)", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "stop clears pending" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    store.setPendingToolPermission(session.id, {
      requestId: "perm-stop",
      toolName: "Bash",
      input: { command: "ls" },
      suggestions: [],
    } as never);
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    plantSdk(runner, session.id, { sawInit: true, isRunning: true, deferredSends: [] });
    expect(runner.stop(session.id)).toBe(true);
    expect(store.getSession(session.id)?.pendingToolPermissions ?? []).toEqual([]);
    expect(
      (runner as unknown as { sdkSessions: Map<string, unknown> }).sdkSessions.has(session.id),
    ).toBe(false);
  });

  it("interrupt() success drains deferredSends (signalTurnComplete residual)", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "interrupt drain" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    const enqueue = vi.fn();
    const sdk = plantSdk(runner, session.id, {
      sawInit: true,
      isRunning: true,
      deferredSends: [
        { text: "queued follow-up", request: {}, messageUuid: "q-follow" },
        { text: "queued later", request: {}, messageUuid: "q-later" },
      ],
      input: { enqueue } as never,
    });
    // runTurnViaSdkQuery will try ensure/run — plant already has sdk; intercept via spy on enqueue path
    // After drain, first follow-up is enqueued through runTurnViaSdkQuery → input.enqueue.
    await expect(runner.interrupt(session.id)).resolves.toEqual({ continued: true });
    expect(sdk.query.interrupt).toHaveBeenCalledTimes(1);
    expect(sdk.deferredSends).toEqual([]);
    // Follow-ups re-entered runTurnViaSdkQuery which sets isRunning true + enqueue.
    expect(enqueue).toHaveBeenCalled();
    expect(
      (runner as unknown as { sdkSessions: Map<string, unknown> }).sdkSessions.has(session.id),
    ).toBe(true);
  });

  it("interrupt() timeout (kkA residual) falls back to stopSession", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "interrupt timeout" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    plantSdk(runner, session.id, {
      sawInit: true,
      isRunning: true,
      query: {
        interrupt: vi.fn(() => new Promise(() => undefined)), // never resolves
        stopTask: vi.fn(async () => undefined),
        close: vi.fn(),
      } as never,
    });
    await expect(runner.interrupt(session.id)).resolves.toEqual({ continued: false });
    expect(
      (runner as unknown as { sdkSessions: Map<string, unknown> }).sdkSessions.has(session.id),
    ).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(false);
  }, 10_000);

  it("runTurn mid-stream queues deferredSends on SDK session", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "midstream" });
    const events: Array<Record<string, unknown>> = [];
    const runner = new ClaudeCliRunner(store, {
      onEvent: (event) => {
        events.push(event);
      },
      onSessionUpdated: () => undefined,
    });
    const enqueue = vi.fn();
    const sdk = plantSdk(runner, session.id, {
      isRunning: true,
      sawResult: false,
      deferredSends: [],
      input: { enqueue } as never,
    });
    const ok = await runner.runTurn(session.id, "interrupt?", { messageUuid: "uuid-queued" });
    expect(ok).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(sdk.deferredSends).toHaveLength(1);
    expect(sdk.deferredSends[0]?.text).toBe("interrupt?");
    expect(sdk.deferredSends[0]?.messageUuid).toBe("uuid-queued");
    expect(
      events.some(
        (event) =>
          event.type === "error" && String(event.error ?? "").includes("claude_session_already_running"),
      ),
    ).toBe(false);
  });

  it("runTurn defers while isRunning even if sawResult true (official isRunning-only gate)", async () => {
    // densable residual: sawResult can be true mid multi-tool / after partial end
    // while isRunning still true. Official defers on isRunning alone.
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "defer sawResult" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    const enqueue = vi.fn();
    const sdk = plantSdk(runner, session.id, {
      isRunning: true,
      sawResult: true,
      deferredSends: [],
      input: { enqueue } as never,
    });
    const ok = await runner.runTurn(session.id, "queued-follow", { messageUuid: "uuid-follow" });
    expect(ok).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(sdk.deferredSends).toHaveLength(1);
    expect(sdk.deferredSends[0]?.messageUuid).toBe("uuid-follow");
  });

  it("cancelQueuedMessage removes SDK deferredSends by uuid", () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "cancel deferred" });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    const sdk = plantSdk(runner, session.id, {
      deferredSends: [
        { text: "queued one", request: {}, messageUuid: "q1" },
        { text: "queued two", request: {}, messageUuid: "q2" },
      ],
    });
    expect(runner.cancelQueuedMessage(session.id, "q1")).toBe(true);
    expect(sdk.deferredSends.map((item) => item.messageUuid)).toEqual(["q2"]);
  });

  it("signalTurnCompleteSdk on result drains deferred then keeps query", () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "result drain" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    const enqueue = vi.fn();
    const sdk = plantSdk(runner, session.id, {
      isRunning: true,
      sawResult: false,
      deferredSends: [
        { text: "queued follow-up", request: {}, messageUuid: "q-follow" },
      ],
      input: { enqueue } as never,
    });
    (
      runner as unknown as {
        signalTurnCompleteSdk: (
          sessionId: string,
          sdk: CodeSdkActiveSession,
          session: unknown,
        ) => void;
      }
    ).signalTurnCompleteSdk(session.id, sdk, session);
    expect(sdk.deferredSends).toEqual([]);
    expect(enqueue).toHaveBeenCalled();
    expect(
      (runner as unknown as { sdkSessions: Map<string, unknown> }).sdkSessions.has(session.id),
    ).toBe(true);
  });

  it("parent assistant re-asserts isRunning after late result settle (handleAssistantMessage)", async () => {
    // Esc drain → late interrupted result markNotRunning → follow-up parent assistant
    // must set isRunning true again (official asar handleAssistantMessage).
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "assistant reassert" });
    store.setCliSessionId(session.id, "cli-reassert");
    let capturedOnEvent: ((event: Record<string, unknown>) => void) | null = null;
    createCodeSdkActiveSession.mockImplementation(async (opts: {
      callbacks: CodeSdkSessionCallbacks;
      sessionId: string;
    }) => {
      capturedOnEvent = opts.callbacks.onEvent;
      return {
        deferredSends: [],
        input: { enqueue: vi.fn() },
        isRunning: false,
        isStopping: false,
        loop: Promise.resolve(),
        pendingPermissions: new Map(),
        query: {
          interrupt: vi.fn(async () => undefined),
          stopTask: vi.fn(async () => undefined),
          close: vi.fn(),
          setPermissionMode: vi.fn(async () => undefined),
          setModel: vi.fn(async () => undefined),
          applyFlagSettings: vi.fn(async () => true),
          getContextUsage: vi.fn(async () => null),
        },
        sawInit: true,
        sawResult: true,
        sessionId: opts.sessionId,
      } as unknown as CodeSdkActiveSession;
    });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    await expect(runner.warmSession(session.id)).resolves.toBe(true);
    const sdk = (
      runner as unknown as { sdkSessions: Map<string, CodeSdkActiveSession> }
    ).sdkSessions.get(session.id)!;
    expect(sdk.isRunning).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(false);

    capturedOnEvent!({
      type: "message",
      sessionId: session.id,
      message: {
        type: "assistant",
        parent_tool_use_id: null,
        message: { role: "assistant", content: [{ type: "text", text: "follow-up" }] },
      },
    });
    expect(sdk.isRunning).toBe(true);
    expect(store.getSession(session.id)?.isRunning).toBe(true);

    // Nested assistant must not re-assert when already handled; force idle then nested.
    sdk.isRunning = false;
    store.setRunning(session.id, false, { kind: "claude-cli" });
    capturedOnEvent!({
      type: "message",
      sessionId: session.id,
      message: {
        type: "assistant",
        parent_tool_use_id: "toolu_nested",
        message: { role: "assistant", content: [] },
      },
    });
    expect(sdk.isRunning).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(false);
  });

  it("parent result message settles via shouldSignalTurnComplete (handleResultMessage)", async () => {
    // max_output_tokens skips Stop hooks; parent result still clears isRunning.
    const store = makeStore();
    const session = store.start({ prompt: "max tokens", cwd: "/tmp/proj", title: "result settle" });
    store.setCliSessionId(session.id, "cli-result-settle");
    store.setRunning(session.id, true, {
      kind: "claude-cli",
      executable: "sdk-query",
      startedAt: new Date().toISOString(),
    });
    let capturedOnEvent: ((event: Record<string, unknown>) => void) | null = null;
    createCodeSdkActiveSession.mockImplementation(async (opts: {
      callbacks: CodeSdkSessionCallbacks;
      sessionId: string;
    }) => {
      capturedOnEvent = opts.callbacks.onEvent;
      return {
        deferredSends: [],
        input: { enqueue: vi.fn() },
        isRunning: true,
        isStopping: false,
        loop: Promise.resolve(),
        pendingPermissions: new Map(),
        query: {
          interrupt: vi.fn(async () => undefined),
          stopTask: vi.fn(async () => undefined),
          close: vi.fn(),
          setPermissionMode: vi.fn(async () => undefined),
          setModel: vi.fn(async () => undefined),
          applyFlagSettings: vi.fn(async () => true),
          getContextUsage: vi.fn(async () => null),
        },
        sawInit: true,
        sawResult: false,
        sessionId: opts.sessionId,
      } as unknown as CodeSdkActiveSession;
    });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    await expect(runner.warmSession(session.id)).resolves.toBe(true);
    const sdk = (
      runner as unknown as { sdkSessions: Map<string, CodeSdkActiveSession> }
    ).sdkSessions.get(session.id)!;
    sdk.isRunning = true;
    store.setRunning(session.id, true, {
      kind: "claude-cli",
      executable: "sdk-query",
      startedAt: new Date().toISOString(),
    });

    capturedOnEvent!({
      type: "message",
      sessionId: session.id,
      message: {
        type: "result",
        subtype: "error_max_tokens",
        is_error: true,
        parent_tool_use_id: null,
      },
    });
    expect(sdk.isRunning).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(false);
  });

  it("signalTurnCompleteSdk settles host when handleSdkMessage already cleared sdk.isRunning", () => {
    // handleSdkMessage sets active.isRunning=false on result before onEvent → signal.
    // Host store must still markNotRunning or Stop/Esc sticks.
    const store = makeStore();
    const session = store.start({ prompt: "444", cwd: "/tmp/proj", title: "host settle" });
    store.setRunning(session.id, true, {
      kind: "claude-cli",
      executable: "sdk-query",
      startedAt: new Date().toISOString(),
    });
    let sessionUpdated = 0;
    const events: Array<Record<string, unknown>> = [];
    const runner = new ClaudeCliRunner(store, {
      onEvent: (event) => {
        events.push(event);
      },
      onSessionUpdated: () => {
        sessionUpdated += 1;
      },
    });
    const sdk = plantSdk(runner, session.id, {
      isRunning: false,
      sawResult: true,
      deferredSends: [],
    });
    (
      runner as unknown as {
        signalTurnCompleteSdk: (
          sessionId: string,
          sdk: CodeSdkActiveSession,
          session: unknown,
        ) => void;
      }
    ).signalTurnCompleteSdk(session.id, sdk, session);
    expect(store.getSession(session.id)?.isRunning).toBe(false);
    // Official asar: session_updated only (no type:"completed").
    expect(events.some((event) => event.type === "completed")).toBe(false);
    expect(sessionUpdated).toBeGreaterThan(0);
    expect(
      (runner as unknown as { sdkSessions: Map<string, unknown> }).sdkSessions.has(session.id),
    ).toBe(true);
  });

  it("signalTurnCompleteSdk drain then second signal markNotRunning (official asar)", () => {
    // Official: first signalTurnComplete with deferred → drain (isRunning true).
    // Second with empty deferred → markNotRunning. No blockSettle invent.
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "drain then settle" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    let sessionUpdated = 0;
    const events: Array<Record<string, unknown>> = [];
    const runner = new ClaudeCliRunner(store, {
      onEvent: (event) => {
        events.push(event);
      },
      onSessionUpdated: () => {
        sessionUpdated += 1;
      },
    });
    const enqueue = vi.fn();
    const sdk = plantSdk(runner, session.id, {
      isRunning: true,
      sawResult: false,
      deferredSends: [
        { text: "queued follow-up", request: {}, messageUuid: "q-follow" },
      ],
      input: { enqueue } as never,
    });
    const signal = (
      runner as unknown as {
        signalTurnCompleteSdk: (
          sessionId: string,
          sdk: CodeSdkActiveSession,
          session: unknown,
        ) => void;
      }
    ).signalTurnCompleteSdk.bind(runner);

    signal(session.id, sdk, session);
    expect(enqueue).toHaveBeenCalled();
    expect(sdk.isRunning).toBe(true);
    expect(sdk.deferredSends).toEqual([]);
    expect(store.getSession(session.id)?.isRunning).toBe(true);
    expect(events.some((event) => event.type === "completed")).toBe(false);

    // Official second signalTurnComplete with empty deferred → markNotRunning.
    // (Esc→drain race: Stop after drain may settle early; follow-up assistant
    // re-asserts isRunning in official handleSdkMessage — not a host invent gate.)
    signal(session.id, sdk, session);
    expect(sdk.isRunning).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(false);
    expect(events.some((event) => event.type === "completed")).toBe(false);
    expect(sessionUpdated).toBeGreaterThanOrEqual(2);
  });

  it("stop() tears down warm SDK query", () => {
    const store = makeStore();
    const session = store.start({ prompt: "go", cwd: "/tmp/proj", title: "stop residual" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    const events: Array<Record<string, unknown>> = [];
    const runner = new ClaudeCliRunner(store, {
      onEvent: (event) => {
        events.push(event);
      },
      onSessionUpdated: () => undefined,
    });
    const sdk = plantSdk(runner, session.id, { isRunning: true, sawInit: true });
    expect(runner.stop(session.id)).toBe(true);
    expect(
      (runner as unknown as { sdkSessions: Map<string, unknown> }).sdkSessions.has(session.id),
    ).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(false);
    expect(events.some((event) => event.type === "stopped")).toBe(true);
    // closeCodeSdkSession should have been invoked via query.close path when present
    expect(sdk).toBeTruthy();
  });

  it("stopTask uses Query.stopTask and does not stop session", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "go", cwd: "/tmp/proj", title: "stop task" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    const sdk = plantSdk(runner, session.id);
    await expect(runner.stopTask(session.id, "task-1")).resolves.toEqual({ status: "informed" });
    expect(sdk.query.stopTask).toHaveBeenCalledWith("task-1");
    expect(
      (runner as unknown as { sdkSessions: Map<string, unknown> }).sdkSessions.has(session.id),
    ).toBe(true);
    expect(store.getSession(session.id)?.isRunning).toBe(true);
  });

  it("pauseSession tears down warm query without FM error", () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "idle pause" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });
    const events: Array<Record<string, unknown>> = [];
    const runner = new ClaudeCliRunner(store, {
      onEvent: (event) => {
        events.push(event);
      },
      onSessionUpdated: () => undefined,
    });
    plantSdk(runner, session.id, { sawResult: true, isRunning: false });
    expect(runner.pauseSession(session.id)).toBe(true);
    expect(
      (runner as unknown as { sdkSessions: Map<string, unknown> }).sdkSessions.has(session.id),
    ).toBe(false);
    expect(events.some((event) => event.type === "paused")).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(false);
  });

  it("setPermissionMode with warm query is informed", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "perm mode" });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    const sdk = plantSdk(runner, session.id);
    await expect(runner.setPermissionMode(session.id, "acceptEdits")).resolves.toEqual({
      status: "informed",
    });
    expect(sdk.query.setPermissionMode).toHaveBeenCalled();
  });

  it("setPermissionMode without query is no_turn", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "perm no query" });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    await expect(runner.setPermissionMode(session.id, "acceptEdits")).resolves.toEqual({
      status: "no_turn",
    });
  });
});
