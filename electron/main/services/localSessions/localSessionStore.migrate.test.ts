import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
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

function legacyFile(dir: string): string {
  const filePath = path.join(dir, "code-sessions.json");
  fs.writeFileSync(filePath, JSON.stringify({
    sessions: [
      {
        id: "s1",
        sessionId: "s1",
        title: "old session",
        kind: "code",
        createdAt: "2026-07-27T01:00:00.000Z",
        updatedAt: "2026-07-27T01:00:00.000Z",
        cliSessionId: "cli-1",
        cwd: "D:\\proj",
        model: "opus-4",
        metadata: { isPinned: true },
        messages: [
          { id: "m1", role: "user", text: "hello", createdAt: "2026-07-27T01:00:00.000Z" },
          { id: "m2", role: "assistant", text: "world", createdAt: "2026-07-27T01:00:01.000Z" },
        ],
        transcript: [{ type: "user" }, { type: "assistant" }, { type: "stream_event" }],
      },
      {
        id: "s2",
        sessionId: "s2",
        title: "empty already",
        kind: "code",
        createdAt: "2026-07-27T02:00:00.000Z",
        updatedAt: "2026-07-27T02:00:00.000Z",
        messages: [],
        transcript: [],
      },
    ],
  }), "utf8");
  return filePath;
}

it("migrateStripContent: strips legacy messages/transcript, keeps metadata, idempotent", () => {
  const dir = tempDir("code-migrate-");
  const filePath = legacyFile(dir);

  // First load: strips content.
  const store1 = new LocalSessionStore("code", filePath);
  const session1 = store1.getSession("s1")!;
  expect(session1.messages).toEqual([]);
  expect(session1.transcript).toEqual([]);
  // Metadata preserved.
  expect(session1.title).toBe("old session");
  expect(session1.cliSessionId).toBe("cli-1");
  expect(session1.model).toBe("opus-4");
  expect(session1.metadata?.isPinned).toBe(true);
  expect(session1.metadata?.contentStrippedAt).toBeTruthy();
  // On-disk file shrunk.
  const onDisk = fs.readFileSync(filePath, "utf8");
  expect(onDisk).not.toContain('"hello"');
  expect(onDisk).toContain("contentStrippedAt");

  // Second load: no re-strip, marker retained, no-op.
  const store2 = new LocalSessionStore("code", filePath);
  expect(store2.getSession("s1")?.metadata?.contentStrippedAt).toBe(session1.metadata?.contentStrippedAt);
  // Already-empty session untouched.
  expect(store2.getSession("s2")?.metadata?.contentStrippedAt).toBeUndefined();
});
