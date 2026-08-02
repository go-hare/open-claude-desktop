/**
 * Offline residual verification for 2026-08-01 subagent empty-stream +
 * main-session spinner stuck after Workflow completed.
 * Uses durable AppAgent session jsonl on this machine.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  applyStoppableTaskBookendEvent,
  shouldEndStdinAfterResult,
} from "./claudeCliTurnLifecycle";
import {
  readCodeTranscript,
  clearCodeTranscriptCaches,
} from "./codeTranscriptJsonl";

const ENG = "call-56b522e6-b95d-4da5-88d7-40ca91203da1-22";
const FUN = "call-56b522e6-b95d-4da5-88d7-40ca91203da1-21";
const ENG_AGENT = "af38349f6a4fa2b76";
const MAIN =
  "/Users/apple/.claude/projects/-Users-apple-work-py-AppAgent/f7121ce8-65dd-43d1-8188-4b03c51c246e.jsonl";

describe("residual verify: subagent parent stamp + stdin clear", () => {
  it("stamps parent_tool_use_id on agent rows (OfficialSubagentPane filter source)", async () => {
    if (!fs.existsSync(MAIN)) {
      console.warn("skip: AppAgent session jsonl missing");
      return;
    }
    clearCodeTranscriptCaches();
    const events = await readCodeTranscript("f7121ce8-65dd-43d1-8188-4b03c51c246e", {
      cwd: "/Users/apple/work-py/AppAgent",
    });
    const eng = events.filter(
      (e) => (e as { parent_tool_use_id?: string }).parent_tool_use_id === ENG,
    );
    const fun = events.filter(
      (e) => (e as { parent_tool_use_id?: string }).parent_tool_use_id === FUN,
    );
    const qop = events.filter((e) => (e as { type?: string }).type === "queue-operation");
    const engHasText = eng.some((e) => {
      const content = (e as { message?: { content?: unknown } }).message?.content;
      return (
        Array.isArray(content)
        && content.some(
          (b) =>
            typeof b === "object"
            && b !== null
            && (b as { type?: string }).type === "text"
            && String((b as { text?: string }).text ?? "").length > 20,
        )
      );
    });
    const engHasTool = eng.some((e) => {
      const content = (e as { message?: { content?: unknown } }).message?.content;
      return (
        Array.isArray(content)
        && content.some(
          (b) =>
            typeof b === "object"
            && b !== null
            && (b as { type?: string }).type === "tool_use",
        )
      );
    });
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          total: events.length,
          eng: eng.length,
          fun: fun.length,
          qop: qop.length,
          engHasText,
          engHasTool,
        },
        null,
        2,
      ),
    );
    expect(events.length).toBeGreaterThan(50);
    expect(eng.length).toBeGreaterThan(5);
    expect(fun.length).toBeGreaterThan(5);
    expect(qop.length).toBeGreaterThan(0);
    expect(engHasText || engHasTool).toBe(true);
  });


  it("bookend-only endInput: Agent tool_use leftovers never block (no invent openBackground)", () => {
    // Official Query / dual-emit: only system task_started bookends gate stdin.
    expect(
      shouldEndStdinAfterResult({
        pendingPermissionCount: 0,
        openStoppableTaskCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldEndStdinAfterResult({
        pendingPermissionCount: 1,
        openStoppableTaskCount: 0,
      }),
    ).toBe(false);
  });

  it("d799-style: no system bookends → endInput after result (TaskOutput does not invent gate)", () => {
    const stoppable = new Set<string>();
    // TaskOutput / Agent tool_use events must not open stoppable set.
    applyStoppableTaskBookendEvent(stoppable, {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Agent", id: ENG },
          { type: "tool_use", name: "Agent", id: FUN },
        ],
      },
    });
    applyStoppableTaskBookendEvent(stoppable, {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            content: `<task_id>${ENG_AGENT}</task_id><status>completed</status>`,
          },
        ],
      },
    });
    expect(stoppable.size).toBe(0);
    expect(
      shouldEndStdinAfterResult({
        pendingPermissionCount: 0,
        openStoppableTaskCount: stoppable.size,
      }),
    ).toBe(true);
  });
});
