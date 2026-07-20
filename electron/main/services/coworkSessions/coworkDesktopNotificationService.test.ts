import { describe, expect, it, vi } from "vitest";
import {
  CoworkDesktopNotificationService,
  coworkAskUserQuestionNotificationBody,
  coworkAskUserQuestionNotificationId,
  coworkIdleNotificationId,
  coworkIdleNotificationTitle,
  coworkScheduledNotificationId,
  resolveCoworkFocusedSessionNotificationCloses,
  shouldShowCoworkIdleNotification,
} from "./coworkDesktopNotificationService";

describe("id + copy helpers (official fir strings)", () => {
  it("ids match asar templates", () => {
    expect(coworkIdleNotificationId("s1")).toBe("idle-s1");
    expect(coworkAskUserQuestionNotificationId("r1")).toBe("ask-question-r1");
    expect(coworkScheduledNotificationId("s1")).toBe("scheduled-s1");
  });

  it("title and ask body match asar", () => {
    expect(coworkIdleNotificationTitle(null)).toBe("Local Session");
    expect(coworkIdleNotificationTitle("My task")).toBe("My task");
    expect(coworkAskUserQuestionNotificationBody(null)).toBe(
      "Claude is asking you a question",
    );
    expect(coworkAskUserQuestionNotificationBody("short")).toBe("short");
    const long = "x".repeat(120);
    expect(coworkAskUserQuestionNotificationBody(long)).toBe(
      `${"x".repeat(100)}...`,
    );
  });
});

describe("shouldShowCoworkIdleNotification", () => {
  it("matches official queryCompleted gates", () => {
    expect(
      shouldShowCoworkIdleNotification({
        focusedSessionId: "other",
        isHiddenSession: false,
        sessionId: "s1",
      }),
    ).toBe(true);
    expect(
      shouldShowCoworkIdleNotification({
        focusedSessionId: "s1",
        isHiddenSession: false,
        sessionId: "s1",
      }),
    ).toBe(false);
    expect(
      shouldShowCoworkIdleNotification({
        focusedSessionId: "other",
        isHiddenSession: true,
        sessionId: "s1",
      }),
    ).toBe(false);
    expect(
      shouldShowCoworkIdleNotification({
        focusedSessionId: "other",
        isHiddenSession: false,
        scheduledTaskId: "task-1",
        sessionId: "s1",
      }),
    ).toBe(false);
  });
});

describe("resolveCoworkFocusedSessionNotificationCloses", () => {
  it("null/empty → null; truthy → close trio", () => {
    expect(resolveCoworkFocusedSessionNotificationCloses(null)).toBeNull();
    expect(resolveCoworkFocusedSessionNotificationCloses("")).toBeNull();
    expect(resolveCoworkFocusedSessionNotificationCloses("s1")).toEqual({
      closeAskUserQuestion: true,
      closeIdle: true,
      closeScheduledId: "scheduled-s1",
      sessionId: "s1",
    });
  });
});

describe("CoworkDesktopNotificationService", () => {
  it("show/close idle tracks maps and invokes backend", () => {
    const shown: string[] = [];
    const closed: string[] = [];
    const svc = new CoworkDesktopNotificationService({
      backend: {
        close: (id) => closed.push(id),
        show: (input) => shown.push(input.id),
      },
    });
    const onClick = vi.fn();
    svc.showIdleNotification({
      onClick,
      sessionId: "s1",
      sessionTitle: "T",
    });
    expect(shown).toEqual(["idle-s1"]);
    expect(svc.hasIdleNotificationForSession("s1")).toBe(true);
    expect(svc.invokeClickCallback("idle-s1")).toBe(true);
    expect(onClick).toHaveBeenCalledOnce();

    svc.closeIdleNotificationForSession("s1");
    expect(closed).toEqual(["idle-s1"]);
    expect(svc.hasIdleNotificationForSession("s1")).toBe(false);
  });

  it("ask-user tracks by session and close-all on focus", () => {
    const closed: string[] = [];
    const svc = new CoworkDesktopNotificationService({
      backend: {
        close: (id) => closed.push(id),
        show: () => undefined,
      },
    });
    svc.showAskUserQuestionNotification({
      requestId: "r1",
      sessionId: "s1",
      questionText: "Q?",
    });
    svc.showAskUserQuestionNotification({
      requestId: "r2",
      sessionId: "s1",
    });
    expect(svc.getAskUserQuestionRequestIds("s1").sort()).toEqual([
      "r1",
      "r2",
    ]);
    svc.handleFocusedSessionChanged("s1");
    expect(closed).toEqual(
      expect.arrayContaining(["ask-question-r1", "ask-question-r2", "scheduled-s1"]),
    );
    expect(svc.getAskUserQuestionRequestIds("s1")).toEqual([]);
  });

  it("skips show when not initialized", () => {
    const show = vi.fn();
    const svc = new CoworkDesktopNotificationService({
      backend: { close: () => undefined, show },
      isInitialized: false,
    });
    svc.showIdleNotification({ sessionId: "s1" });
    expect(show).not.toHaveBeenCalled();
  });

  it("showNotification generic + closeNotification", () => {
    const closed: string[] = [];
    const shown: Array<{ id: string; title: string }> = [];
    const svc = new CoworkDesktopNotificationService({
      backend: {
        close: (id) => closed.push(id),
        show: (input) => shown.push({ id: input.id, title: input.title }),
      },
    });
    svc.showNotification("Title", "Body", "scheduled-s1");
    expect(shown).toEqual([{ id: "scheduled-s1", title: "Title" }]);
    svc.closeNotification("scheduled-s1");
    expect(closed).toEqual(["scheduled-s1"]);
  });
});
