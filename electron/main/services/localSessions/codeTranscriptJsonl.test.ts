import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  mangleCodeProjectDir,
  readCodeSessionMetadata,
  readCodeTranscript,
  resolveCodeTranscriptPath,
  scanCodeSessionFiles,
} from "./codeTranscriptJsonl";

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

function writeCliJsonl(configDir: string, cwd: string, sessionId: string, lines: unknown[]): string {
  const dir = path.join(configDir, "projects", mangleCodeProjectDir(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(filePath, lines.map((row) => JSON.stringify(row)).join("\n"), "utf8");
  return filePath;
}

it("mangleCodeProjectDir: NFC + every non-alnum becomes '-', 200-char cap", () => {
  expect(mangleCodeProjectDir("D:\\work\\py\\claude")).toBe("D--work-py-claude");
  expect(mangleCodeProjectDir("/home/u/proj")).toBe("-home-u-proj");
  expect(mangleCodeProjectDir("C:\\Users\\A B\\proj.v2")).toBe("C--Users-A-B-proj-v2");
  expect(mangleCodeProjectDir("x".repeat(300))).toHaveLength(200);
});

it("resolveCodeTranscriptPath: finds file in mangled cwd dir; rejects bad ids", async () => {
  const configDir = tempDir("code-tr-config-");
  const cwd = path.join(tempDir("code-tr-cwd-"), "proj");
  fs.mkdirSync(cwd, { recursive: true });
  const filePath = writeCliJsonl(configDir, cwd, "sess-1", [{ type: "user", cwd }]);

  expect(await resolveCodeTranscriptPath("sess-1", cwd, configDir)).toBe(filePath);
  // unknown cwd still found via fallback scan
  expect(await resolveCodeTranscriptPath("sess-1", undefined, configDir)).toBe(filePath);
  expect(await resolveCodeTranscriptPath("missing", cwd, configDir)).toBeNull();
  expect(await resolveCodeTranscriptPath("../evil", cwd, configDir)).toBeNull();
  expect(await resolveCodeTranscriptPath(undefined, cwd, configDir)).toBeNull();
});

it("readCodeTranscript: parses jsonl, keeps chat types, drops noise and bad lines", async () => {
  const configDir = tempDir("code-tr-config-");
  const cwd = "D:\\work\\py\\claude";
  writeCliJsonl(configDir, cwd, "sess-2", [
    { type: "user", cwd, timestamp: "2026-07-27T01:00:00.000Z", message: { role: "user", content: "hi" } },
    { type: "assistant", timestamp: "2026-07-27T01:00:01.000Z", message: { role: "assistant", content: [] } },
    { type: "file-history-snapshot", messageId: "x" },
    "not-json",
    { noType: true },
    { type: "result", timestamp: "2026-07-27T01:00:02.000Z" },
  ]);
  const events = await readCodeTranscript("sess-2", cwd, configDir);
  expect(events.map((e) => (e as { type: string }).type)).toEqual(["user", "assistant", "result"]);
  expect(await readCodeTranscript("missing", cwd, configDir)).toEqual([]);
});

it("scanCodeSessionFiles: lists jsonl newest-first with limit", async () => {
  const configDir = tempDir("code-tr-config-");
  writeCliJsonl(configDir, "D:\\a", "old", [{ type: "user" }]);
  writeCliJsonl(configDir, "D:\\b", "new", [{ type: "user" }]);
  // non-jsonl ignored
  fs.writeFileSync(
    path.join(configDir, "projects", mangleCodeProjectDir("D:\\a"), "notes.txt"),
    "ignore me",
  );

  const files = await scanCodeSessionFiles(configDir);
  expect(files).toHaveLength(2);
  expect(files.map((f) => f.cliSessionId).sort()).toEqual(["new", "old"]);
  expect(files.every((f) => f.filePath.endsWith(".jsonl"))).toBe(true);

  const limited = await scanCodeSessionFiles(configDir, 1);
  expect(limited).toHaveLength(1);

  // missing projects dir → empty, not throw
  expect(await scanCodeSessionFiles(path.join(configDir, "nope"))).toEqual([]);
});

it("readCodeSessionMetadata: custom-title wins, else first non-boilerplate user text", async () => {
  const configDir = tempDir("code-tr-config-");
  const titled = writeCliJsonl(configDir, "D:\\a", "titled", [
    { type: "user", cwd: "D:\\a", timestamp: "2026-07-27T01:00:00.000Z", message: { role: "user", content: "first" } },
    { type: "custom-title", customTitle: "fix-login-bug" },
    { type: "assistant", timestamp: "2026-07-27T01:00:05.000Z", message: { role: "assistant", content: [] } },
  ]);
  const meta1 = await readCodeSessionMetadata(titled, "titled");
  expect(meta1?.title).toBe("fix-login-bug");
  expect(meta1?.cwd).toBe("D:\\a");
  expect(meta1?.createdAt).toBe("2026-07-27T01:00:00.000Z");
  expect(meta1?.updatedAt).toBe("2026-07-27T01:00:05.000Z");

  const untitled = writeCliJsonl(configDir, "D:\\b", "untitled", [
    { type: "user", cwd: "D:\\b", timestamp: "2026-07-27T02:00:00.000Z", message: { role: "user", content: "<local-command-caveat>noise" } },
    {
      type: "user",
      timestamp: "2026-07-27T02:00:01.000Z",
      message: { role: "user", content: [{ type: "text", text: "拉一下代码\n第二行" }] },
    },
  ]);
  const meta2 = await readCodeSessionMetadata(untitled, "untitled");
  expect(meta2?.title).toBe("拉一下代码");

  const empty = writeCliJsonl(configDir, "D:\\c", "empty", []);
  const meta3 = await readCodeSessionMetadata(empty, "empty");
  expect(meta3?.title).toBe("CLI session");
  expect(await readCodeSessionMetadata(path.join(configDir, "missing.jsonl"), "missing")).toBeNull();
});
