/**
 * Host Tasks residual unit tests (stop host-exit + multi-turn stdin continue).
 * Uses a planted ActiveTurn (no real CLI spawn).
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCliRunner } from "./claudeCliRunner";
import { LocalSessionStore } from "./localSessionStore";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeStore(): LocalSessionStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-runner-tasks-"));
  tempDirs.push(dir);
  return new LocalSessionStore("code", path.join(dir, "code-sessions.json"));
}

function fakeChild(stdinOpen = true) {
  const stdin = new EventEmitter() as EventEmitter & {
    destroyed: boolean;
    writableEnded: boolean;
    write: (chunk: string) => boolean;
    end: () => void;
  };
  const writes: string[] = [];
  stdin.destroyed = false;
  stdin.writableEnded = !stdinOpen;
  stdin.write = (chunk: string) => {
    writes.push(chunk);
    return true;
  };
  stdin.end = () => {
    stdin.writableEnded = true;
  };
  const child = new EventEmitter() as EventEmitter & {
    stdin: typeof stdin;
    stdout: EventEmitter;
    stderr: EventEmitter;
    killed: boolean;
    pid: number;
    kill: (signal?: string) => boolean;
  };
  child.stdin = stdin;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.pid = 4242;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return { child, writes };
}

describe("ClaudeCliRunner Tasks residual", () => {
  it("stop() emits host-exit bookends for open task_started before active.delete", () => {
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

    const { child } = fakeChild(true);
    const openStoppableTasks = new Set(["task-open-1", "task-open-2"]);
    // Plant active turn as production would after task_started bookends.
    (runner as unknown as { active: Map<string, unknown> }).active.set(session.id, {
      child,
      deferredSends: [],
      openStoppableTasks,
      pendingControlResponses: new Map(),
      pendingPermissions: new Map(),
      sawResult: true,
      stderr: [],
      sawAssistantText: true,
    });

    expect(runner.stop(session.id)).toBe(true);
    expect((runner as unknown as { active: Map<string, unknown> }).active.has(session.id)).toBe(false);

    const hostExit = events.filter(
      (event) =>
        event.type === "message"
        && typeof event.message === "object"
        && event.message !== null
        && (event.message as { subtype?: string }).subtype === "task_notification"
        && String((event.message as { uuid?: string }).uuid ?? "").startsWith("host-exit-"),
    );
    expect(hostExit).toHaveLength(2);
    const statuses = hostExit.map((event) => (event.message as { status?: string; task_id?: string }));
    expect(statuses.map((item) => item.task_id).sort()).toEqual(["task-open-1", "task-open-2"]);
    expect(statuses.every((item) => item.status === "stopped")).toBe(true);
    // No host-stop invent
    expect(
      events.some(
        (event) =>
          typeof event.message === "object"
          && event.message !== null
          && String((event.message as { uuid?: string }).uuid ?? "").startsWith("host-stop-"),
      ),
    ).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(false);
    // set was cleared so close path would not double-emit
    expect(openStoppableTasks.size).toBe(0);
  });

  it("runTurn continues on same stdin after parent result (no already_running)", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "continue residual" });
    // Seed second user live-tail as sendMessage would
    store.sendMessage(session.id, "second turn please", "user", { messageUuid: "uuid-second" });

    const events: Array<Record<string, unknown>> = [];
    const runner = new ClaudeCliRunner(store, {
      onEvent: (event) => {
        events.push(event);
      },
      onSessionUpdated: () => undefined,
    });

    const { child, writes } = fakeChild(true);
    (runner as unknown as { active: Map<string, unknown> }).active.set(session.id, {
      child,
      deferredSends: [],
      openStoppableTasks: new Set(["still-open"]),
      pendingControlResponses: new Map(),
      pendingPermissions: new Map(),
      sawResult: true,
      stderr: [],
      sawAssistantText: true,
      activeUserUuid: "uuid-first",
    });

    const ok = await runner.runTurn(session.id, "second turn please", {
      messageUuid: "uuid-second",
    });
    expect(ok).toBe(true);
    expect(writes.some((line) => line.includes("second turn please"))).toBe(true);
    expect(writes.some((line) => line.includes("uuid-second"))).toBe(true);
    expect(store.getSession(session.id)?.isRunning).toBe(true);
    // Still same active child
    const active = (runner as unknown as { active: Map<string, { sawResult: boolean; child: unknown }> }).active.get(
      session.id,
    );
    expect(active?.child).toBe(child);
    expect(active?.sawResult).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "error" && String(event.error ?? "").includes("claude_session_already_running"),
      ),
    ).toBe(false);
  });

  it("runTurn mid-stream queues deferredSends (official isRunning path, no already_running)", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "midstream" });
    store.sendMessage(session.id, "interrupt?", "user", { messageUuid: "uuid-queued" });

    const events: Array<Record<string, unknown>> = [];
    const runner = new ClaudeCliRunner(store, {
      onEvent: (event) => {
        events.push(event);
      },
      onSessionUpdated: () => undefined,
    });

    const { child, writes } = fakeChild(true);
    (runner as unknown as { active: Map<string, unknown> }).active.set(session.id, {
      child,
      deferredSends: [],
      openStoppableTasks: new Set(),
      pendingControlResponses: new Map(),
      pendingPermissions: new Map(),
      sawResult: false,
      stderr: [],
      sawAssistantText: false,
    });

    const ok = await runner.runTurn(session.id, "interrupt?", { messageUuid: "uuid-queued" });
    expect(ok).toBe(true);
    // Official deferredSends: do not write stdin mid-stream.
    expect(writes).toHaveLength(0);
    const active = (
      runner as unknown as {
        active: Map<string, { deferredSends: Array<{ text: string; messageUuid?: string }> }>;
      }
    ).active.get(session.id);
    expect(active?.deferredSends).toHaveLength(1);
    expect(active?.deferredSends[0]?.text).toBe("interrupt?");
    expect(active?.deferredSends[0]?.messageUuid).toBe("uuid-queued");
    expect(
      events.some(
        (event) =>
          event.type === "error" && String(event.error ?? "").includes("claude_session_already_running"),
      ),
    ).toBe(false);
  });

  it("cancelQueuedMessage removes deferredSends by uuid", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "cancel deferred" });
    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    const { child } = fakeChild(true);
    (runner as unknown as { active: Map<string, unknown> }).active.set(session.id, {
      child,
      deferredSends: [
        { text: "queued one", request: {}, messageUuid: "q1" },
        { text: "queued two", request: {}, messageUuid: "q2" },
      ],
      openStoppableTasks: new Set(),
      pendingControlResponses: new Map(),
      pendingPermissions: new Map(),
      sawResult: false,
      stderr: [],
      sawAssistantText: false,
      activeUserUuid: "active-uuid",
    });

    expect(runner.cancelQueuedMessage(session.id, "q1")).toBe(true);
    const active = (
      runner as unknown as {
        active: Map<string, { deferredSends: Array<{ messageUuid?: string }> }>;
      }
    ).active.get(session.id);
    expect(active?.deferredSends.map((item) => item.messageUuid)).toEqual(["q2"]);
    // Active stdin uuid still too-late.
    expect(runner.cancelQueuedMessage(session.id, "active-uuid")).toBe(false);
  });

  it("parent result drains all deferredSends onto same stdin (signalTurnComplete residual)", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "drain deferred" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });

    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    const { child, writes } = fakeChild(true);
    (runner as unknown as { active: Map<string, unknown> }).active.set(session.id, {
      child,
      deferredSends: [
        { text: "queued follow-up", request: { messageUuid: "q-follow" }, messageUuid: "q-follow" },
        { text: "queued later", request: {}, messageUuid: "q-later" },
      ],
      openStoppableTasks: new Set(),
      pendingControlResponses: new Map(),
      pendingPermissions: new Map(),
      sawResult: false,
      stderr: [],
      sawAssistantText: true,
      activeUserUuid: "uuid-first",
    });

    // Invoke private stream handler residual via bracket access.
    (
      runner as unknown as {
        handleStdoutLine: (sessionId: string, line: string) => void;
      }
    ).handleStdoutLine(
      session.id,
      JSON.stringify({ type: "result", subtype: "success", usage: { input_tokens: 1, output_tokens: 1 } }),
    );

    expect(writes.some((line) => line.includes("queued follow-up"))).toBe(true);
    expect(writes.some((line) => line.includes("q-follow"))).toBe(true);
    expect(writes.some((line) => line.includes("queued later"))).toBe(true);
    const active = (
      runner as unknown as {
        active: Map<
          string,
          {
            sawResult: boolean;
            activeUserUuid?: string;
            deferredSends: Array<{ messageUuid?: string }>;
          }
        >;
      }
    ).active.get(session.id);
    // Official drainDeferredSends: enqueue all deferred; stay running.
    expect(active?.deferredSends).toEqual([]);
    expect(active?.sawResult).toBe(false);
    expect(active?.activeUserUuid).toBe("q-later");
    expect(store.getSession(session.id)?.isRunning).toBe(true);
  });

  it("interrupt() keeps deferredSends and does not SIGTERM (official interruptSession)", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "interrupt continue" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });

    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    const { child, writes } = fakeChild(true);
    (runner as unknown as { active: Map<string, unknown> }).active.set(session.id, {
      child,
      deferredSends: [
        { text: "queued follow-up", request: {}, messageUuid: "q-follow" },
      ],
      openStoppableTasks: new Set(),
      pendingControlResponses: new Map(),
      pendingPermissions: new Map(),
      sawResult: false,
      stderr: [],
      sawAssistantText: true,
    });

    const pending = runner.interrupt(session.id);
    const requestLine = writes.find((line) => line.includes('"subtype":"interrupt"'));
    expect(requestLine).toBeTruthy();
    const requestId = (JSON.parse(requestLine!) as { request_id?: string }).request_id;
    expect(requestId).toBeTruthy();
    (
      runner as unknown as {
        handleStdoutLine: (sessionId: string, line: string) => void;
      }
    ).handleStdoutLine(
      session.id,
      JSON.stringify({
        type: "control_response",
        response: { request_id: requestId, subtype: "success", response: {} },
      }),
    );

    await expect(pending).resolves.toEqual({ continued: true });
    const active = (
      runner as unknown as {
        active: Map<string, { deferredSends: Array<{ messageUuid?: string }>; child: { killed: boolean } }>;
      }
    ).active.get(session.id);
    expect(active?.deferredSends.map((item) => item.messageUuid)).toEqual(["q-follow"]);
    expect(active?.child.killed).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(true);
  });

  it("interrupt() without a live turn falls back to stop()", async () => {
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

  it("interrupt result then drains all deferredSends (signalTurnComplete residual)", async () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "interrupt drain" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });

    const runner = new ClaudeCliRunner(store, {
      onEvent: () => undefined,
      onSessionUpdated: () => undefined,
    });
    const { child, writes } = fakeChild(true);
    (runner as unknown as { active: Map<string, unknown> }).active.set(session.id, {
      child,
      deferredSends: [
        { text: "queued follow-up", request: { messageUuid: "q-follow" }, messageUuid: "q-follow" },
        { text: "queued later", request: {}, messageUuid: "q-later" },
      ],
      openStoppableTasks: new Set(),
      pendingControlResponses: new Map(),
      pendingPermissions: new Map(),
      sawResult: false,
      stderr: [],
      sawAssistantText: true,
    });

    const pending = runner.interrupt(session.id);
    const requestLine = writes.find((line) => line.includes('"subtype":"interrupt"'));
    const requestId = (JSON.parse(requestLine!) as { request_id?: string }).request_id;
    (
      runner as unknown as {
        handleStdoutLine: (sessionId: string, line: string) => void;
      }
    ).handleStdoutLine(
      session.id,
      JSON.stringify({
        type: "control_response",
        response: { request_id: requestId, subtype: "success", response: {} },
      }),
    );
    await expect(pending).resolves.toEqual({ continued: true });

    (
      runner as unknown as {
        handleStdoutLine: (sessionId: string, line: string) => void;
      }
    ).handleStdoutLine(
      session.id,
      JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true }),
    );

    expect(writes.some((line) => line.includes("queued follow-up"))).toBe(true);
    expect(writes.some((line) => line.includes("queued later"))).toBe(true);
    const active = (
      runner as unknown as {
        active: Map<string, { deferredSends: Array<{ messageUuid?: string }>; sawResult: boolean }>;
      }
    ).active.get(session.id);
    expect(active?.deferredSends).toEqual([]);
    expect(active?.sawResult).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(true);
  });

  it("stop() then close code 143 does not emitError (user Esc residual)", () => {
    const store = makeStore();
    const session = store.start({ prompt: "go", cwd: "/tmp/proj", title: "esc 143" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });

    const events: Array<Record<string, unknown>> = [];
    const runner = new ClaudeCliRunner(store, {
      onEvent: (event) => {
        events.push(event);
      },
      onSessionUpdated: () => undefined,
    });

    const { child } = fakeChild(true);
    (runner as unknown as { active: Map<string, unknown> }).active.set(session.id, {
      child,
      deferredSends: [
        { text: "queued after multi-send", request: {}, messageUuid: "q-esc" },
      ],
      openStoppableTasks: new Set(),
      pendingControlResponses: new Map(),
      pendingPermissions: new Map(),
      sawResult: false,
      stderr: [],
      sawAssistantText: true,
    });

    expect(runner.stop(session.id)).toBe(true);
    expect((runner as unknown as { active: Map<string, unknown> }).active.has(session.id)).toBe(false);
    expect(events.some((event) => event.type === "stopped")).toBe(true);

    // Planted turns never registered spawn close; invoke settle like orphan close after SIGTERM.
    (
      runner as unknown as {
        settleChildClose: (
          sessionId: string,
          child: object,
          code: number | null,
          signal: string | null,
          spawnKind: string,
          spawnLabel: string,
        ) => void;
      }
    ).settleChildClose(session.id, child, 143, "SIGTERM", "claude-cli", "claude");

    expect(
      events.some(
        (event) =>
          event.type === "error"
          && String(event.error ?? "").includes("exited with code 143"),
      ),
    ).toBe(false);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(store.getSession(session.id)?.isRunning).toBe(false);
    const lastError = (store.getSession(session.id) as { lastError?: string } | undefined)?.lastError;
    expect(lastError == null || !String(lastError).includes("exited with code 143")).toBe(true);
  });

  it("orphan non-zero close still emitError when not user-stopped", () => {
    const store = makeStore();
    const session = store.start({ prompt: "go", cwd: "/tmp/proj", title: "real crash" });
    store.setRunning(session.id, true, { kind: "claude-cli", startedAt: new Date().toISOString() });

    const events: Array<Record<string, unknown>> = [];
    const runner = new ClaudeCliRunner(store, {
      onEvent: (event) => {
        events.push(event);
      },
      onSessionUpdated: () => undefined,
    });

    const { child } = fakeChild(true);
    (runner as unknown as { active: Map<string, unknown> }).active.set(session.id, {
      child,
      deferredSends: [],
      openStoppableTasks: new Set(),
      pendingControlResponses: new Map(),
      pendingPermissions: new Map(),
      sawResult: false,
      stderr: [],
      sawAssistantText: true,
    });

    // Detach without stop (endInput drain residual) — real crash should still error.
    (runner as unknown as { active: Map<string, unknown> }).active.delete(session.id);
    (
      runner as unknown as {
        settleChildClose: (
          sessionId: string,
          child: object,
          code: number | null,
          signal: string | null,
          spawnKind: string,
          spawnLabel: string,
        ) => void;
      }
    ).settleChildClose(session.id, child, 1, null, "claude-cli", "claude");

    expect(
      events.some(
        (event) =>
          event.type === "error"
          && String(event.error ?? "").includes("exited with code 1"),
      ),
    ).toBe(true);
  });
});
