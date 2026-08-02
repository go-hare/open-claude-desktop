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

  it("runTurn continues on same stdin after parent result (no already_running)", () => {
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
      openStoppableTasks: new Set(["still-open"]),
      pendingControlResponses: new Map(),
      pendingPermissions: new Map(),
      sawResult: true,
      stderr: [],
      sawAssistantText: true,
      activeUserUuid: "uuid-first",
    });

    const ok = runner.runTurn(session.id, "second turn please", {
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

  it("runTurn mid-stream still refuses second spawn with already_running", () => {
    const store = makeStore();
    const session = store.start({ prompt: "first", cwd: "/tmp/proj", title: "midstream" });
    store.sendMessage(session.id, "interrupt?", "user");

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
      openStoppableTasks: new Set(),
      pendingControlResponses: new Map(),
      pendingPermissions: new Map(),
      sawResult: false,
      stderr: [],
      sawAssistantText: false,
    });

    const ok = runner.runTurn(session.id, "interrupt?", {});
    expect(ok).toBe(false);
    expect(writes).toHaveLength(0);
    expect(
      events.some(
        (event) =>
          event.type === "error" && String(event.error ?? "").includes("claude_session_already_running"),
      ),
    ).toBe(true);
  });
});
