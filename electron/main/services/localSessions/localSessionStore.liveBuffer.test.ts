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
    const session = store.start({ prompt: "hello", cwd: "D:\\proj" });
    store.setCliSessionId(session.id, "cli-1");
    writeCliJsonl("D:\\proj", "cli-1", [
      { type: "user", timestamp: "2026-07-27T01:00:00.000Z", message: { role: "user", content: "hello" } },
      { type: "assistant", timestamp: "2026-07-27T01:00:01.000Z", message: { role: "assistant", content: [{ type: "text", text: "world" }] } },
      { type: "file-history-snapshot", messageId: "noise" },
    ]);

    store.appendLiveEvent(session.id, { type: "assistant", timestamp: "2026-07-27T01:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "live tail" }] } });
    const events = (await store.getTranscript(session.id)) as { type: string; text?: string }[];
    // start()-seeded user row is uuid-less → cannot dedupe against the disk echo, so it
    // stays as the middle tail row; in production the CLI echo shares messageUuid so the
    // seeded row IS dropped. Assert content, not brittle ordering.
    expect(events.map((event) => event.type)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(events.filter((event) => event.type === "user").map((event) => event.text ?? "hello")).toEqual(["hello", "hello"]);

    // Turn ends → CLI has flushed to jsonl → live buffer dropped.
    store.setRunning(session.id, false);
    expect(store.getLiveEvents(session.id)).toHaveLength(0);
    const settled = (await store.getTranscript(session.id)) as { type: string }[];
    expect(settled.map((event) => event.type)).toEqual(["user", "assistant"]);
  });
});

it("getTranscript: session without cliSessionId falls back to legacy persisted content", async () => {
  const { store } = makeStore();
  const session = store.start({ prompt: "draft only", cwd: "D:\\proj" });
  const events = await store.getTranscript(session.id);
  expect(events.length).toBeGreaterThan(0);
});
