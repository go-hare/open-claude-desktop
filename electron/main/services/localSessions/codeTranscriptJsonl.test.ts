import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  clearCodeTranscriptCaches,
  isAgentToolMessage,
  mangleCodeProjectDir,
  readCodeSessionMetadata,
  readCodeTranscript,
  resolveCodeTranscriptPath,
  stripThinkingBlocks,
} from "./codeTranscriptJsonl";

const tempDirs: string[] = [];

afterEach(() => {
  clearCodeTranscriptCaches();
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
  fs.writeFileSync(filePath, lines.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  return filePath;
}

function writeAgentJsonl(
  configDir: string,
  cwd: string,
  agentId: string,
  lines: unknown[],
  options?: { sessionId?: string; legacyRoot?: boolean },
): string {
  const projectDir = path.join(configDir, "projects", mangleCodeProjectDir(cwd));
  const dir = options?.legacyRoot || !options?.sessionId
    ? projectDir
    : path.join(projectDir, options.sessionId, "subagents");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `agent-${agentId}.jsonl`);
  fs.writeFileSync(filePath, lines.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
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
  // unknown cwd still found via fallback scan of that one id
  expect(await resolveCodeTranscriptPath("sess-1", undefined, configDir)).toBe(filePath);
  expect(await resolveCodeTranscriptPath("missing", cwd, configDir)).toBeNull();
  expect(await resolveCodeTranscriptPath("../evil", cwd, configDir)).toBeNull();
  expect(await resolveCodeTranscriptPath(undefined, cwd, configDir)).toBeNull();
});

it("resolveCodeTranscriptPath: also tries worktreePath / originCwd hints (official)", async () => {
  const configDir = tempDir("code-tr-config-");
  const worktree = path.join(tempDir("code-tr-wt-"), "wt");
  fs.mkdirSync(worktree, { recursive: true });
  const filePath = writeCliJsonl(configDir, worktree, "sess-wt", [{ type: "user", cwd: worktree }]);
  expect(
    await resolveCodeTranscriptPath(
      "sess-wt",
      { cwd: "/does/not/exist", worktreePath: worktree, originCwd: "/also/missing" },
      configDir,
    ),
  ).toBe(filePath);
});

it("stripThinkingBlocks: drops thinking / redacted_thinking; null when empty", () => {
  expect(stripThinkingBlocks({ type: "user", message: { content: "hi" } })).toEqual({
    type: "user",
    message: { content: "hi" },
  });
  const kept = stripThinkingBlocks({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "secret" },
        { type: "redacted_thinking", data: "x" },
        { type: "text", text: "hello" },
      ],
    },
  });
  expect(kept).toEqual({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    },
  });
  expect(
    stripThinkingBlocks({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "only" }] },
    }),
  ).toBeNull();
});

it("isAgentToolMessage: official Utr residual", () => {
  expect(
    isAgentToolMessage({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "1", name: "Bash" }] },
    }),
  ).toBe(true);
  expect(
    isAgentToolMessage({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "1", content: "ok" }] },
    }),
  ).toBe(true);
  expect(
    isAgentToolMessage({
      type: "assistant",
      message: { content: [{ type: "text", text: "no tools" }] },
    }),
  ).toBe(false);
  expect(isAgentToolMessage({ type: "result" })).toBe(false);
});

it("readCodeTranscript: parses jsonl, keeps chat types, drops noise and bad lines", async () => {
  const configDir = tempDir("code-tr-config-");
  const cwd = "D:\\work\\py\\claude";
  writeCliJsonl(configDir, cwd, "sess-2", [
    { type: "user", cwd, timestamp: "2026-07-27T01:00:00.000Z", message: { role: "user", content: "hi" } },
    {
      type: "assistant",
      timestamp: "2026-07-27T01:00:01.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "yo" }] },
    },
    // empty-after-strip assistant is dropped (official stripThinkingBlocks → null)
    {
      type: "assistant",
      timestamp: "2026-07-27T01:00:01.500Z",
      message: { role: "assistant", content: [] },
    },
    { type: "file-history-snapshot", messageId: "x" },
    "not-json",
    { noType: true },
    { type: "result", timestamp: "2026-07-27T01:00:02.000Z" },
  ]);
  const events = await readCodeTranscript("sess-2", cwd, configDir);
  expect(events.map((e) => (e as { type: string }).type)).toEqual(["user", "assistant", "result"]);
  expect(await readCodeTranscript("missing", cwd, configDir)).toEqual([]);
});

it("readCodeTranscript: strips thinking blocks on assistant (official stripThinkingBlocks)", async () => {
  const configDir = tempDir("code-tr-config-");
  const cwd = "D:\\think";
  writeCliJsonl(configDir, cwd, "sess-think", [
    {
      type: "assistant",
      timestamp: "2026-07-27T01:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "visible" },
        ],
      },
    },
    {
      type: "assistant",
      timestamp: "2026-07-27T01:00:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "only-thinking" }],
      },
    },
  ]);
  const events = await readCodeTranscript("sess-think", cwd, configDir);
  expect(events).toHaveLength(1);
  const content = (events[0] as { message: { content: unknown[] } }).message.content;
  expect(content).toEqual([{ type: "text", text: "visible" }]);
});

it("readCodeTranscript: merges agent-*.jsonl tool rows by timestamp (official)", async () => {
  const configDir = tempDir("code-tr-config-");
  const cwd = "D:\\agents";
  writeCliJsonl(configDir, cwd, "sess-agent", [
    {
      type: "user",
      cwd,
      timestamp: "2026-07-27T01:00:00.000Z",
      message: { role: "user", content: "go" },
    },
    {
      type: "assistant",
      timestamp: "2026-07-27T01:00:00.500Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_agent_1", name: "Agent", input: { description: "explore" } }],
      },
    },
    {
      type: "user",
      timestamp: "2026-07-27T01:00:02.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_agent_1", content: "launched" }],
      },
      toolUseResult: { agentId: "sub1", status: "async_launched" },
    },
  ]);
  // Current CLI: {sessionId}/subagents/agent-*.jsonl
  writeAgentJsonl(
    configDir,
    cwd,
    "sub1",
    [
      {
        type: "assistant",
        timestamp: "2026-07-27T01:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }],
        },
      },
      {
        type: "user",
        timestamp: "2026-07-27T01:00:01.500Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
        },
      },
      // assistant text is kept (subagent pane) and stamped with parent_tool_use_id
      {
        type: "assistant",
        timestamp: "2026-07-27T01:00:01.200Z",
        message: { role: "assistant", content: [{ type: "text", text: "noise" }] },
      },
    ],
    { sessionId: "sess-agent" },
  );

  const events = await readCodeTranscript("sess-agent", cwd, configDir);
  expect(events.map((e) => (e as { type: string; timestamp?: string }).timestamp)).toEqual([
    "2026-07-27T01:00:00.000Z",
    "2026-07-27T01:00:00.500Z",
    "2026-07-27T01:00:01.000Z",
    "2026-07-27T01:00:01.200Z",
    "2026-07-27T01:00:01.500Z",
    "2026-07-27T01:00:02.000Z",
  ]);
  const agentRows = events.filter((e) => (e as { parent_tool_use_id?: string }).parent_tool_use_id === "call_agent_1");
  expect(agentRows).toHaveLength(3);
});

it("readCodeTranscript: still finds legacy project-root agent-*.jsonl", async () => {
  const configDir = tempDir("code-tr-config-");
  const cwd = "D:\\agents-legacy";
  writeCliJsonl(configDir, cwd, "sess-legacy", [
    {
      type: "user",
      cwd,
      timestamp: "2026-07-27T01:00:00.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_legacy", content: "x" }],
      },
      toolUseResult: { agentId: "leg1" },
    },
  ]);
  writeAgentJsonl(
    configDir,
    cwd,
    "leg1",
    [
      {
        type: "assistant",
        timestamp: "2026-07-27T01:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }],
        },
      },
    ],
    { legacyRoot: true },
  );
  const events = await readCodeTranscript("sess-legacy", cwd, configDir);
  expect(events.some((e) => (e as { parent_tool_use_id?: string }).parent_tool_use_id === "call_legacy")).toBe(true);
});

it("readCodeTranscript: caches by mtime/size; incremental append on same inode growth", async () => {
  const configDir = tempDir("code-tr-config-");
  const cwd = "D:\\cache";
  const filePath = writeCliJsonl(configDir, cwd, "sess-cache", [
    { type: "user", cwd, timestamp: "2026-07-27T01:00:00.000Z", message: { role: "user", content: "one" } },
  ]);
  const first = await readCodeTranscript("sess-cache", cwd, configDir);
  expect(first).toHaveLength(1);

  // Same-inode append (official incremental path): write extra line without replacing file.
  fs.appendFileSync(
    filePath,
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-07-27T01:00:01.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "two" }] },
    }) + "\n",
    "utf8",
  );
  const second = await readCodeTranscript("sess-cache", cwd, configDir);
  expect(second.map((e) => (e as { type: string }).type)).toEqual(["user", "assistant"]);

  // Unchanged mtime/size → pure cache hit
  const third = await readCodeTranscript("sess-cache", cwd, configDir);
  expect(third).toHaveLength(2);
});

it("readCodeSessionMetadata: custom-title wins, else first non-boilerplate user text (head/tail windows)", async () => {
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

it("readCodeSessionMetadata: does not require whole-file read for large jsonl", async () => {
  const configDir = tempDir("code-tr-config-");
  const cwd = "D:\\huge";
  const dir = path.join(configDir, "projects", mangleCodeProjectDir(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "huge.jsonl");
  const lines: string[] = [
    JSON.stringify({
      type: "user",
      cwd,
      timestamp: "2026-07-27T01:00:00.000Z",
      message: { role: "user", content: "start title line" },
    }),
  ];
  // Pad middle so file exceeds head window; last line carries updatedAt.
  for (let i = 0; i < 2000; i += 1) {
    lines.push(JSON.stringify({ type: "assistant", timestamp: `2026-07-27T01:${String(i % 60).padStart(2, "0")}:00.000Z`, message: { role: "assistant", content: [{ type: "text", text: "x".repeat(200) }] } }));
  }
  lines.push(JSON.stringify({ type: "result", timestamp: "2026-07-27T03:00:00.000Z" }));
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");

  const meta = await readCodeSessionMetadata(filePath, "huge");
  expect(meta?.title).toBe("start title line");
  expect(meta?.cwd).toBe(cwd);
  expect(meta?.createdAt).toBe("2026-07-27T01:00:00.000Z");
  expect(meta?.updatedAt).toBe("2026-07-27T03:00:00.000Z");
});
