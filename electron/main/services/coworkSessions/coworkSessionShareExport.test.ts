import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { unzipSync } from "fflate";
import {
  collectCoworkShareExportTree,
  exportCoworkCliSessionTranscript,
  isCoworkShareSessionResult,
  readCoworkShareExportFile,
} from "./coworkSessionShareExport";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch {
      // ignore
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cowork-share-"));
  temps.push(dir);
  return dir;
}

it("RUe isCoworkShareSessionResult", () => {
  expect(isCoworkShareSessionResult({ success: true, filePath: "/a.zip" })).toBe(
    true,
  );
  expect(isCoworkShareSessionResult({ success: false, error: "x" })).toBe(true);
  expect(isCoworkShareSessionResult({ success: true })).toBe(true);
  expect(isCoworkShareSessionResult({ success: "yes" })).toBe(false);
  expect(isCoworkShareSessionResult(null)).toBe(false);
});

it("HPA residual readCoworkShareExportFile respects maxBytes", async () => {
  const dir = tempDir();
  const file = join(dir, "big.bin");
  writeFileSync(file, Buffer.alloc(10, 1));
  expect(await readCoworkShareExportFile(file, { maxBytes: 5 })).toBeNull();
  expect((await readCoworkShareExportFile(file, { maxBytes: 10 }))?.length).toBe(
    10,
  );
  expect(await readCoworkShareExportFile(join(dir, "missing"))).toBeNull();
});

it("LeA collectCoworkShareExportTree skips skipNames and symlinks residual", async () => {
  const root = tempDir();
  writeFileSync(join(root, "keep.txt"), "k");
  writeFileSync(join(root, "echo.log"), "skip");
  mkdirSync(join(root, "sub"), { recursive: true });
  writeFileSync(join(root, "sub", "nested.txt"), "n");
  const files: Record<string, Uint8Array> = {};
  await collectCoworkShareExportTree(root, "logs", files, {
    skipNames: new Set(["echo.log"]),
  });
  expect(Object.keys(files).sort()).toEqual([
    "logs/keep.txt",
    "logs/sub/nested.txt",
  ]);
});

it("J6e export packs first matching cliSessionId jsonl + metadata", async () => {
  const projects = tempDir();
  const downloads = tempDir();
  const proj = join(projects, "proj-encoded");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "cli-123.jsonl"), '{"type":"user"}\n');
  // second project should be ignored after first hit
  const proj2 = join(projects, "proj-other");
  mkdirSync(proj2, { recursive: true });
  writeFileSync(join(proj2, "cli-123.jsonl"), "ignored\n");

  const meta = join(tempDir(), "session.json");
  writeFileSync(meta, JSON.stringify({ sessionId: "local_1" }));

  const result = await exportCoworkCliSessionTranscript(
    {
      cliSessionId: "cli-123",
      projectsDir: projects,
      metadataFilePath: meta,
    },
    {
      downloadsDir: downloads,
      now: () => 1_700_000_000_000,
    },
  );
  expect(result).toEqual({
    success: true,
    filePath: join(downloads, "session-export-1700000000000.zip"),
  });
  const zipBytes = new Uint8Array(readFileSync(result.filePath!));
  const unpacked = unzipSync(zipBytes);
  expect(Object.keys(unpacked).sort()).toEqual([
    "cli-123.jsonl",
    "metadata.json",
  ]);
  expect(new TextDecoder().decode(unpacked["cli-123.jsonl"])).toBe(
    '{"type":"user"}\n',
  );
});

it("J6e empty projects → No transcript data found", async () => {
  const projects = tempDir();
  const downloads = tempDir();
  const result = await exportCoworkCliSessionTranscript(
    { cliSessionId: "missing", projectsDir: projects },
    { downloadsDir: downloads },
  );
  expect(result).toEqual({
    success: false,
    error: "No transcript data found for this session.",
  });
});

it("J6e S1 scrubs logs (email/token/path) and skips echo.log", async () => {
  const projects = tempDir();
  const downloads = tempDir();
  const logs = tempDir();
  const proj = join(projects, "p1");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "cli-s.jsonl"), "line\n");
  writeFileSync(
    join(logs, "app.log"),
    "user alice@example.com auth sk-ant-abcdefgh path /Users/alice/secret\n",
  );
  writeFileSync(join(logs, "echo.log"), "should-skip sk-ant-abcdefgh\n");

  const result = await exportCoworkCliSessionTranscript(
    {
      cliSessionId: "cli-s",
      projectsDir: projects,
      logsDir: logs,
    },
    {
      downloadsDir: downloads,
      now: () => 99,
      scrubHomedir: "/Users/alice",
      appPath: "/App/Claude.app",
    },
  );
  expect(result.success).toBe(true);
  const unpacked = unzipSync(new Uint8Array(readFileSync(result.filePath!)));
  expect(Object.keys(unpacked).sort()).toEqual([
    "cli-s.jsonl",
    "logs/app.log",
  ]);
  const logText = new TextDecoder().decode(unpacked["logs/app.log"]);
  expect(logText).toContain("<email>");
  expect(logText).toContain("<token>");
  expect(logText).toContain("~/secret");
  expect(logText).not.toContain("alice@example.com");
  expect(logText).not.toContain("sk-ant-abcdefgh");
  expect(logText).not.toContain("/Users/alice/secret");
});
