import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { mangleCodeProjectDir } from "./codeTranscriptJsonl";
import { LocalSessionStore } from "./localSessionStore";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeStore(): { store: LocalSessionStore; filePath: string } {
  const filePath = path.join(tempDir("code-live-store-"), "code-sessions.json");
  return { store: new LocalSessionStore("code", filePath), filePath };
}

function writeCliJsonl(cwd: string, sessionId: string, lines: unknown[]): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR!;
  const dir = path.join(configDir, "projects", mangleCodeProjectDir(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(filePath, lines.map((row) => JSON.stringify(row)).join("\n"), "utf8");
  return filePath;
}

function withConfigDir(configDir: string, run: () => Promise<void>): Promise<void> {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configDir;
  return run().finally(() => {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  });
}

it("liveBuffers: append/get/clear are memory-only and never hit the persisted file", async () => {
  const { store, filePath } = makeStore();
  const session = store.start({ prompt: "hello", cwd: "D:\\proj" });

  // start() seeds the live tail with the first user prompt.
  expect(store.getLiveEvents(session.id)).toHaveLength(1);
  store.appendLiveEvent(session.id, { type: "stream_event", event: { delta: "a" } });
  store.appendLiveEvent(session.id, { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } });
  expect(store.getLiveEvents(session.id)).toHaveLength(3);
  expect(fs.readFileSync(filePath, "utf8")).not.toContain("stream_event");

  store.clearLiveBuffer(session.id);
  expect(store.getLiveEvents(session.id)).toHaveLength(0);
});

it("getTranscript: reads jsonl from disk and appends the live tail while running", async () => {
  const configDir = tempDir("code-live-config-");
  await withConfigDir(configDir, async () => {
    const { store } = makeStore();
    // Shared messageUuid: production start/send stamps the same outer uuid into CLI jsonl.
    const shared = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const session = store.start({ prompt: "hello", cwd: "D:\\proj", messageUuid: shared });
    store.setCliSessionId(session.id, "cli-1");
    writeCliJsonl("D:\\proj", "cli-1", [
      {
        type: "user",
        uuid: shared,
        timestamp: "2026-07-27T01:00:00.000Z",
        message: { role: "user", content: "hello" },
      },
      {
        type: "assistant",
        uuid: "asst-1",
        timestamp: "2026-07-27T01:00:01.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "world" }] },
      },
      { type: "file-history-snapshot", messageId: "noise" },
    ]);

    store.appendLiveEvent(session.id, {
      type: "assistant",
      uuid: "asst-live",
      timestamp: "2026-07-27T01:00:02.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "live tail" }] },
    });
    const events = (await store.getTranscript(session.id)) as { type: string; uuid?: string }[];
    // Outer-uuid dedupe drops the live seed; live assistant appends.
    expect(events.filter((event) => event.type === "user")).toHaveLength(1);
    expect(events.find((event) => event.type === "user")?.uuid).toBe(shared);
    expect(events.map((event) => event.type)).toEqual(["user", "assistant", "assistant"]);

    // Turn ends → CLI has flushed to jsonl → live buffer dropped.
    store.setRunning(session.id, false);
    expect(store.getLiveEvents(session.id)).toHaveLength(0);
    const settled = (await store.getTranscript(session.id)) as { type: string }[];
    expect(settled.map((event) => event.type)).toEqual(["user", "assistant"]);
  });
});

it("taskBookends: system task_* survive clearLiveBuffer / turn end for Tasks reload", async () => {
  const configDir = tempDir("code-task-bookends-");
  await withConfigDir(configDir, async () => {
    const { store, filePath } = makeStore();
    const session = store.start({ prompt: "run agent", cwd: "D:\\proj", messageUuid: "user-1" });
    store.setCliSessionId(session.id, "cli-book");
    writeCliJsonl("D:\\proj", "cli-book", [
      {
        type: "user",
        uuid: "user-1",
        timestamp: "2026-08-01T11:00:00.000Z",
        message: { role: "user", content: "run agent" },
      },
      {
        type: "assistant",
        uuid: "asst-1",
        timestamp: "2026-08-01T11:00:01.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      },
    ]);

    store.appendTranscriptEvent(session.id, {
      type: "system",
      subtype: "task_started",
      task_id: "tid-agent",
      task_type: "local_agent",
      description: "Worker",
      uuid: "book-start",
      timestamp: "2026-08-01T11:00:02.000Z",
    });
    store.appendTranscriptEvent(session.id, {
      type: "system",
      subtype: "task_notification",
      task_id: "tid-agent",
      status: "completed",
      summary: "done",
      uuid: "book-end",
      timestamp: "2026-08-01T11:00:10.000Z",
    });

    // Turn end drops live buffer; bookends must still appear via host sidecar.
    store.setRunning(session.id, false);
    expect(store.getLiveEvents(session.id)).toHaveLength(0);
    const settled = (await store.getTranscript(session.id)) as Array<{
      type?: string;
      subtype?: string;
      task_id?: string;
      status?: string;
    }>;
    const bookends = settled.filter((event) => event.type === "system" && (event.subtype === "task_started" || event.subtype === "task_notification"));
    expect(bookends).toHaveLength(2);
    expect(bookends.map((event) => event.subtype)).toEqual(["task_started", "task_notification"]);
    expect(bookends[1]?.status).toBe("completed");

    // Persisted to userData sessions file (small sidecar, not full transcript).
    const disk = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      sessions: Array<{ id: string; taskBookends?: unknown[] }>;
    };
    const row = disk.sessions.find((item) => item.id === session.id);
    expect(Array.isArray(row?.taskBookends)).toBe(true);
    expect(row?.taskBookends).toHaveLength(2);
  });
});

it("taskBookends: process-exit host-exit residual collapses with later CLI task_notification", async () => {
  const configDir = tempDir("code-task-host-exit-");
  await withConfigDir(configDir, async () => {
    const { store, filePath } = makeStore();
    const session = store.start({ prompt: "run agent", cwd: "D:\\proj", messageUuid: "user-stop" });
    store.setCliSessionId(session.id, "cli-stop");
    writeCliJsonl("D:\\proj", "cli-stop", [
      {
        type: "user",
        uuid: "user-stop",
        timestamp: "2026-08-01T12:00:00.000Z",
        message: { role: "user", content: "run agent" },
      },
    ]);

    store.appendTranscriptEvent(session.id, {
      type: "system",
      subtype: "task_started",
      task_id: "tid-stop",
      task_type: "local_agent",
      description: "Worker",
      uuid: "book-start-stop",
      timestamp: "2026-08-01T12:00:01.000Z",
    });
    // Process-exit residual only (host-exit-*). Stop button does not invent host-stop.
    store.appendTranscriptEvent(session.id, {
      type: "system",
      subtype: "task_notification",
      task_id: "tid-stop",
      status: "stopped",
      summary: "Process exited",
      uuid: "host-exit-tid-stop",
      timestamp: "2026-08-01T12:00:05.000Z",
    });
    // CLI dual-emit (or late drain) richer bookend — same task_id key collapses.
    store.appendTranscriptEvent(session.id, {
      type: "system",
      subtype: "task_notification",
      task_id: "tid-stop",
      status: "stopped",
      summary: "Agent stopped by user",
      uuid: "cli-stop-bookend",
      timestamp: "2026-08-01T12:00:05.200Z",
    });

    store.setRunning(session.id, false);
    const settled = (await store.getTranscript(session.id)) as Array<{
      type?: string;
      subtype?: string;
      task_id?: string;
      status?: string;
      summary?: string;
      uuid?: string;
    }>;
    const notifications = settled.filter(
      (event) => event.type === "system" && event.subtype === "task_notification" && event.task_id === "tid-stop",
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.uuid).toBe("cli-stop-bookend");
    expect(notifications[0]?.summary).toBe("Agent stopped by user");

    const disk = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      sessions: Array<{ id: string; taskBookends?: Array<{ uuid?: string; subtype?: string }> }>;
    };
    const row = disk.sessions.find((item) => item.id === session.id);
    const notifBookends = (row?.taskBookends ?? []).filter((item) => item.subtype === "task_notification");
    expect(notifBookends).toHaveLength(1);
    expect(notifBookends[0]?.uuid).toBe("cli-stop-bookend");
  });
});

it("hookBookends: system hook_progress/response survive clearLiveBuffer for residual gw/TM", async () => {
  const configDir = tempDir("code-hook-bookends-");
  await withConfigDir(configDir, async () => {
    const { store, filePath } = makeStore();
    const session = store.start({ prompt: "review", cwd: "D:\\proj", messageUuid: "user-hook" });
    store.setCliSessionId(session.id, "cli-hook");
    writeCliJsonl("D:\\proj", "cli-hook", [
      {
        type: "user",
        uuid: "user-hook",
        timestamp: "2026-08-01T13:00:00.000Z",
        message: { role: "user", content: "review" },
      },
    ]);

    const progressStdout =
      '<remote-review-progress>{"stage":"verifying","bugs_found":2,"bugs_verified":0,"bugs_refuted":0}</remote-review-progress>'
      + '<review-bug>{"id":"b1","name":"Null deref","file":"a.ts","line":10,"status":"verifying"}</review-bug>';
    store.appendTranscriptEvent(session.id, {
      type: "system",
      subtype: "hook_progress",
      hook_id: "hook-tm-1",
      stdout: progressStdout,
      uuid: "hook-p1",
      timestamp: "2026-08-01T13:00:02.000Z",
    });
    // Later progress for same hook_id collapses (latest-wins).
    store.appendTranscriptEvent(session.id, {
      type: "system",
      subtype: "hook_progress",
      hook_id: "hook-tm-1",
      stdout:
        '<remote-review-progress>{"stage":"synthesizing","bugs_found":2,"bugs_verified":1,"bugs_refuted":0}</remote-review-progress>',
      uuid: "hook-p2",
      timestamp: "2026-08-01T13:00:05.000Z",
    });
    store.appendTranscriptEvent(session.id, {
      type: "system",
      subtype: "hook_response",
      hook_id: "hook-tm-1",
      stdout: progressStdout,
      outcome: "success",
      uuid: "hook-r1",
      timestamp: "2026-08-01T13:00:10.000Z",
    });

    store.setRunning(session.id, false);
    expect(store.getLiveEvents(session.id)).toHaveLength(0);
    const settled = (await store.getTranscript(session.id)) as Array<{
      type?: string;
      subtype?: string;
      hook_id?: string;
      uuid?: string;
      outcome?: string;
    }>;
    const hooks = settled.filter(
      (event) => event.type === "system" && (event.subtype === "hook_progress" || event.subtype === "hook_response"),
    );
    expect(hooks).toHaveLength(2);
    expect(hooks.map((event) => event.subtype)).toEqual(["hook_progress", "hook_response"]);
    expect(hooks[0]?.uuid).toBe("hook-p2");
    expect(hooks[1]?.outcome).toBe("success");

    const disk = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      sessions: Array<{ id: string; hookBookends?: unknown[] }>;
    };
    const row = disk.sessions.find((item) => item.id === session.id);
    expect(Array.isArray(row?.hookBookends)).toBe(true);
    expect(row?.hookBookends).toHaveLength(2);
  });
});

it("getTranscript: intentional same-text re-send keeps second live user (new uuid)", async () => {
  const configDir = tempDir("code-live-resend-");
  await withConfigDir(configDir, async () => {
    const { store } = makeStore();
    const session = store.start({ prompt: "hello", cwd: "D:\\proj", messageUuid: "aaaa-1111" });
    store.setCliSessionId(session.id, "cli-rs");
    writeCliJsonl("D:\\proj", "cli-rs", [
      {
        type: "user",
        uuid: "aaaa-1111",
        timestamp: "2026-07-27T01:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
      },
      {
        type: "assistant",
        uuid: "bbbb-2222",
        timestamp: "2026-07-27T01:00:01.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      },
    ]);
    store.clearLiveBuffer(session.id);
    store.appendLiveEvent(session.id, {
      type: "user",
      uuid: "cccc-3333",
      isLocalOptimistic: true,
      timestamp: "2026-07-27T01:00:10.000Z",
      text: "hello",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    });
    const events = (await store.getTranscript(session.id)) as { type: string; uuid?: string }[];
    const users = events.filter((event) => event.type === "user");
    expect(users.map((user) => user.uuid)).toEqual(["aaaa-1111", "cccc-3333"]);
  });
});

it("getTranscript: shared outer uuid drops live seed against disk echo", async () => {
  const configDir = tempDir("code-live-uuid-");
  await withConfigDir(configDir, async () => {
    const { store } = makeStore();
    const shared = "11111111-2222-3333-4444-555555555555";
    const session = store.start({ prompt: "ping", cwd: "D:\\proj", messageUuid: shared });
    store.setCliSessionId(session.id, "cli-shared");
    writeCliJsonl("D:\\proj", "cli-shared", [
      {
        type: "user",
        uuid: shared,
        timestamp: "2026-07-27T01:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "ping" }] },
      },
      {
        type: "assistant",
        uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        timestamp: "2026-07-27T01:00:01.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "pong" }] },
      },
    ]);
    const events = (await store.getTranscript(session.id)) as { type: string; uuid?: string }[];
    // Seed + disk share outer uuid → live seed dropped; single durable user remains.
    const users = events.filter((event) => event.type === "user");
    expect(users).toHaveLength(1);
    expect(users[0]?.uuid).toBe(shared);
  });
});

it("getTranscript: session without cliSessionId falls back to legacy persisted content", async () => {
  const { store } = makeStore();
  const session = store.start({ prompt: "draft only", cwd: "D:\\proj" });
  const events = await store.getTranscript(session.id);
  expect(events.length).toBeGreaterThan(0);
});

it("u_e unread residual: setRunning(false) marks hasCompleted+isUnread when not focused", () => {
  const { store } = makeStore();
  const session = store.start({ prompt: "hello", cwd: "/tmp/proj" });
  store.setRunning(session.id, true, { kind: "claude-cli" });
  const settled = store.setRunning(session.id, false, { kind: "claude-cli" });
  expect(settled?.hasCompleted).toBe(true);
  expect(settled?.isUnread).toBe(true);
  // Focus clears unread (ready glyph off) but keeps hasCompleted.
  const focused = store.setFocusedSession(session.id);
  expect(focused?.isUnread).toBe(false);
  expect(focused?.hasCompleted).toBe(true);
});

it("u_e unread residual: focused session settle does not mark isUnread", () => {
  const { store } = makeStore();
  const session = store.start({ prompt: "hello", cwd: "/tmp/proj" });
  store.setFocusedSession(session.id);
  store.setRunning(session.id, true, { kind: "claude-cli" });
  const settled = store.setRunning(session.id, false, { kind: "claude-cli" });
  expect(settled?.hasCompleted).toBe(true);
  expect(settled?.isUnread).toBe(false);
});

it("u_e unread residual: refocus completed+read session is idempotent (no updatedAt climb)", () => {
  const { store } = makeStore();
  const session = store.start({ prompt: "hello", cwd: "/tmp/proj" });
  store.setRunning(session.id, true, { kind: "claude-cli" });
  store.setRunning(session.id, false, { kind: "claude-cli" });
  const first = store.setFocusedSession(session.id);
  expect(first?.isUnread).toBe(false);
  expect(first?.hasCompleted).toBe(true);
  const afterClear = store.getSession(session.id);
  const tAfterClear = afterClear?.updatedAt;
  // Second focus must not rewrite activity time (Recents order / session_updated spam).
  const second = store.setFocusedSession(session.id);
  expect(second?.isUnread).toBe(false);
  expect(second?.hasCompleted).toBe(true);
  expect(second?.updatedAt).toBe(tAfterClear);
  const third = store.setFocusedSession(session.id);
  expect(third?.updatedAt).toBe(tAfterClear);
});
