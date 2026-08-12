import { describe, expect, it } from "vitest";
import {
  SCHEDULED_TASK_AUTOMATED_RUN_PROMPT,
  resolveScheduledTaskRunMessage,
  stripScheduledTaskFrontmatter,
  wrapScheduledTaskRunPrompt,
} from "./scheduledTaskPromptWrap";

describe("Uwe residual — stripScheduledTaskFrontmatter", () => {
  it("strips YAML frontmatter fence", () => {
    expect(
      stripScheduledTaskFrontmatter("---\ntitle: x\n---\n\nBody text"),
    ).toBe("Body text");
  });

  it("returns trimmed body when no frontmatter", () => {
    expect(stripScheduledTaskFrontmatter("  hello  ")).toBe("hello");
  });
});

describe("Fwe/pYt residual — wrapScheduledTaskRunPrompt", () => {
  it("wraps with Lwe and scheduled-task tags", () => {
    const out = wrapScheduledTaskRunPrompt("task-1", "/path/task.md", "Do the thing");
    expect(out.startsWith('<scheduled-task name="task-1" file="/path/task.md">')).toBe(true);
    expect(out).toContain(SCHEDULED_TASK_AUTOMATED_RUN_PROMPT);
    expect(out).toContain("Do the thing");
    expect(out.endsWith("</scheduled-task>")).toBe(true);
  });

  it("prefixes skill invoke when body starts with /skill (Pwe)", () => {
    const out = wrapScheduledTaskRunPrompt("id", "", "/my-skill rest of task");
    expect(out).toContain(
      'Invoke the skill "my-skill" using the Skill tool, then follow the remaining instructions.',
    );
    expect(out).toContain("/my-skill rest of task");
  });
});

describe("resolveScheduledTaskRunMessage", () => {
  it("prefers file content over prompt", () => {
    const out = resolveScheduledTaskRunMessage({
      taskId: "abc",
      fileContent: "from-file",
      prompt: "from-prompt",
    });
    expect(out).toContain("from-file");
    expect(out).not.toContain("from-prompt");
  });

  it("falls back to prompt when file empty", () => {
    const out = resolveScheduledTaskRunMessage({
      taskId: "abc",
      fileContent: "  ",
      prompt: "legacy prompt",
    });
    expect(out).toContain("legacy prompt");
  });

  it("returns null when empty after Uwe", () => {
    expect(
      resolveScheduledTaskRunMessage({
        taskId: "abc",
        fileContent: "---\nx: 1\n---\n\n   ",
      }),
    ).toBeNull();
  });

  it("strips frontmatter before wrap", () => {
    const out = resolveScheduledTaskRunMessage({
      taskId: "t1",
      filePath: "f.md",
      fileContent: "---\na: b\n---\n\nReal body",
    });
    expect(out).toContain("Real body");
    expect(out).not.toContain("---\na: b\n---");
  });
});
