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
