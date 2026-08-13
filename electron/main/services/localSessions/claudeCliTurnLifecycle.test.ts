import { describe, expect, it } from "vitest";
import {
  applyStoppableTaskBookendEvent,
  canContinueActiveTurnOnStdin,
  canDetachDrainedActiveTurn,
  isTerminalTaskStatus,
  removeDeferredSendByUuid,
  resolveTurnPermissionMode,
  shouldDeferMidStreamSend,
  shouldEmitProcessExitError,
  shouldEndStdinAfterResult,
} from "./claudeCliTurnLifecycle";

describe("resolveTurnPermissionMode", () => {
  it("prefers non-empty request mode", () => {
    expect(resolveTurnPermissionMode("acceptEdits", "bypassPermissions")).toBe("acceptEdits");
  });

  it("falls back to session when request is omitted/empty", () => {
    expect(resolveTurnPermissionMode(undefined, "bypassPermissions")).toBe("bypassPermissions");
    expect(resolveTurnPermissionMode(null, "auto")).toBe("auto");
    expect(resolveTurnPermissionMode("", "plan")).toBe("plan");
  });

  it("maps bypass alias and defaults", () => {
    expect(resolveTurnPermissionMode("bypass", undefined)).toBe("bypassPermissions");
    expect(resolveTurnPermissionMode(undefined, undefined)).toBe("default");
  });
});

describe("shouldEndStdinAfterResult", () => {
  it("ends when no pending can_use_tool and no stoppable bookends", () => {
    expect(
      shouldEndStdinAfterResult({
        pendingPermissionCount: 0,
      }),
    ).toBe(true);
  });

  it("keeps open for pending can_use_tool (hasBidirectionalNeeds)", () => {
    expect(
      shouldEndStdinAfterResult({
        pendingPermissionCount: 1,
      }),
    ).toBe(false);
  });

  it("keeps open while densable stoppable task bookends remain (Tasks Stop residual)", () => {
    expect(
      shouldEndStdinAfterResult({
        pendingPermissionCount: 0,
        openStoppableTaskCount: 2,
      }),
    ).toBe(false);
  });

  it("Agent tool_use leftovers must NOT block endInput (no invent openBackground gate)", () => {
    // Official Query / dual-emit contract: only bookend task_ids gate stdin.
    expect(
      shouldEndStdinAfterResult({
        pendingPermissionCount: 0,
        openStoppableTaskCount: 0,
      }),
    ).toBe(true);
  });

  it("does not end when stdin already closed", () => {
    expect(
      shouldEndStdinAfterResult({
        pendingPermissionCount: 0,
        stdinWritableEnded: true,
      }),
    ).toBe(false);
  });
});

describe("canContinueActiveTurnOnStdin", () => {
  it("allows follow-up after parent result while stdin still open", () => {
    expect(
      canContinueActiveTurnOnStdin({
        sawResult: true,
        stdinDestroyed: false,
        stdinWritableEnded: false,
      }),
    ).toBe(true);
  });

  it("refuses mid-stream (before parent result)", () => {
    expect(
      canContinueActiveTurnOnStdin({
        sawResult: false,
        stdinDestroyed: false,
        stdinWritableEnded: false,
      }),
    ).toBe(false);
  });

  it("refuses when stdin already ended", () => {
    expect(
      canContinueActiveTurnOnStdin({
        sawResult: true,
        stdinWritableEnded: true,
      }),
    ).toBe(false);
  });
});

describe("canDetachDrainedActiveTurn", () => {
  it("detaches after result + endInput with no open bookends", () => {
    expect(
      canDetachDrainedActiveTurn({
        sawResult: true,
        openStoppableTaskCount: 0,
        stdinWritableEnded: true,
      }),
    ).toBe(true);
  });

  it("keeps active while stoppable bookends remain", () => {
    expect(
      canDetachDrainedActiveTurn({
        sawResult: true,
        openStoppableTaskCount: 1,
        stdinWritableEnded: false,
      }),
    ).toBe(false);
  });

  it("does not detach before parent result", () => {
    expect(
      canDetachDrainedActiveTurn({
        sawResult: false,
        openStoppableTaskCount: 0,
        stdinWritableEnded: true,
      }),
    ).toBe(false);
  });
});

describe("shouldDeferMidStreamSend", () => {
  it("defers mid-stream when active and neither continue nor detach", () => {
    expect(
      shouldDeferMidStreamSend({
        hasActiveTurn: true,
        canContinueOnStdin: false,
        canDetachDrained: false,
      }),
    ).toBe(true);
  });

  it("does not defer when continue-on-stdin is available", () => {
    expect(
      shouldDeferMidStreamSend({
        hasActiveTurn: true,
        canContinueOnStdin: true,
        canDetachDrained: false,
      }),
    ).toBe(false);
  });

  it("does not defer when detach-drained is available", () => {
    expect(
      shouldDeferMidStreamSend({
        hasActiveTurn: true,
        canContinueOnStdin: false,
        canDetachDrained: true,
      }),
    ).toBe(false);
  });

  it("does not defer without an active turn", () => {
    expect(
      shouldDeferMidStreamSend({
        hasActiveTurn: false,
        canContinueOnStdin: false,
        canDetachDrained: false,
      }),
    ).toBe(false);
  });
});

describe("removeDeferredSendByUuid", () => {
  it("splices matching uuid and leaves others", () => {
    const { removed, next } = removeDeferredSendByUuid(
      [
        { messageUuid: "a", text: "1" },
        { messageUuid: "b", text: "2" },
      ],
      "a",
    );
    expect(removed).toBe(true);
    expect(next).toEqual([{ messageUuid: "b", text: "2" }]);
  });

  it("returns unchanged when uuid missing", () => {
    const deferred = [{ messageUuid: "a" }];
    const { removed, next } = removeDeferredSendByUuid(deferred, "z");
    expect(removed).toBe(false);
    expect(next).toBe(deferred);
  });
});

describe("shouldEmitProcessExitError", () => {
  it("suppresses non-zero exit after intentional user stop (Esc SIGTERM 143)", () => {
    expect(shouldEmitProcessExitError({ exitCode: 143, userStopped: true })).toBe(false);
    expect(shouldEmitProcessExitError({ exitCode: 1, userStopped: true })).toBe(false);
    expect(shouldEmitProcessExitError({ exitCode: 0, userStopped: true })).toBe(false);
  });

  it("emits only for real non-zero crashes when not user-stopped", () => {
    expect(shouldEmitProcessExitError({ exitCode: 143, userStopped: false })).toBe(true);
    expect(shouldEmitProcessExitError({ exitCode: 1, userStopped: false })).toBe(true);
    expect(shouldEmitProcessExitError({ exitCode: 0, userStopped: false })).toBe(false);
    expect(shouldEmitProcessExitError({ exitCode: null, userStopped: false })).toBe(false);
  });
});

describe("applyStoppableTaskBookendEvent", () => {
  it("tracks only system task_id bookends (not Agent tool_use)", () => {
    const stoppable = new Set<string>();
    expect(
      applyStoppableTaskBookendEvent(stoppable, {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Agent", id: "call-1" }] },
      }),
    ).toBe(false);
    expect(stoppable.size).toBe(0);

    expect(
      applyStoppableTaskBookendEvent(stoppable, {
        type: "system",
        subtype: "task_started",
        task_id: "tid-bash",
        tool_use_id: "call-bash",
      }),
    ).toBe(true);
    expect([...stoppable]).toEqual(["tid-bash"]);

    expect(
      applyStoppableTaskBookendEvent(stoppable, {
        type: "system",
        subtype: "task_notification",
        task_id: "tid-bash",
        status: "stopped",
      }),
    ).toBe(true);
    expect(stoppable.size).toBe(0);
  });

  it("keeps endInput closed while bookend open, opens after terminal notification", () => {
    const stoppable = new Set<string>();
    applyStoppableTaskBookendEvent(stoppable, {
      type: "system",
      subtype: "task_started",
      task_id: "t-open",
    });
    expect(
      shouldEndStdinAfterResult({
        pendingPermissionCount: 0,
        openStoppableTaskCount: stoppable.size,
      }),
    ).toBe(false);
    applyStoppableTaskBookendEvent(stoppable, {
      type: "system",
      subtype: "task_notification",
      task_id: "t-open",
      status: "completed",
    });
    expect(
      shouldEndStdinAfterResult({
        pendingPermissionCount: 0,
        openStoppableTaskCount: stoppable.size,
      }),
    ).toBe(true);
  });

  it("ignores TaskOutput / user residual — bookend-only gate", () => {
    const stoppable = new Set<string>();
    applyStoppableTaskBookendEvent(stoppable, {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "call-taskoutput",
            content:
              "<task_id>agent1</task_id><status>completed</status><output>done</output>",
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

  it("replays hung AppAgent d799 jsonl: leftover Agent tool_use must not block endInput", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const path =
      "/Users/apple/.claude/projects/-Users-apple-work-py-AppAgent/d7996938-7ffb-4b5d-aa9b-d66e25af17fe.jsonl";
    if (!existsSync(path)) return;
    const stoppable = new Set<string>();
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        applyStoppableTaskBookendEvent(stoppable, event);
      } catch {
        /* skip */
      }
    }
    // Bookend-only gate: 0 system task_* in d799 → stoppable empty → endInput ok.
    expect(
      shouldEndStdinAfterResult({
        pendingPermissionCount: 0,
        openStoppableTaskCount: stoppable.size,
      }),
    ).toBe(true);
  });
});

describe("isTerminalTaskStatus", () => {
  it("recognizes residual terminal statuses", () => {
    expect(isTerminalTaskStatus("completed")).toBe(true);
    expect(isTerminalTaskStatus("stopped")).toBe(true);
    expect(isTerminalTaskStatus("running")).toBe(false);
  });
});
