import { describe, expect, it, vi } from "vitest";
import {
  CodeDesktopNotificationService,
  codeIdleNotificationId,
  shouldShowCodeIdleNotification,
} from "./codeDesktopNotificationService";

describe("shouldShowCodeIdleNotification", () => {
  it("skips focused / scheduled / hidden", () => {
    expect(
      shouldShowCodeIdleNotification({
        sessionId: "s1",
        focusedSessionId: "s1",
        isHiddenSession: false,
      }),
    ).toBe(false);
    expect(
      shouldShowCodeIdleNotification({
        sessionId: "s1",
        focusedSessionId: "s2",
        isHiddenSession: false,
        scheduledTaskId: "t1",
      }),
    ).toBe(false);
    expect(
      shouldShowCodeIdleNotification({
        sessionId: "s1",
        focusedSessionId: "s2",
        isHiddenSession: true,
      }),
    ).toBe(false);
    expect(
      shouldShowCodeIdleNotification({
        sessionId: "s1",
        focusedSessionId: "s2",
        isHiddenSession: false,
      }),
    ).toBe(true);
  });
});

describe("CodeDesktopNotificationService", () => {
  it("shows idle when unfocused", () => {
    const show = vi.fn();
    const close = vi.fn();
    const attention = vi.fn();
    const svc = new CodeDesktopNotificationService({
      backend: { show, close },
      getFocusedSessionId: () => "other",
      requestUserAttention: attention,
    });
    expect(
      svc.showIdleNotification({ sessionId: "s1", sessionTitle: "Demo" }),
    ).toBe(true);
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        id: codeIdleNotificationId("s1"),
        title: "Demo",
        body: "Claude is waiting for your input",
        type: "idle",
      }),
    );
    expect(attention).toHaveBeenCalled();
    svc.closeIdleNotificationForSession("s1");
    expect(close).toHaveBeenCalledWith(codeIdleNotificationId("s1"));
  });

  it("skips idle when focused", () => {
    const show = vi.fn();
    const svc = new CodeDesktopNotificationService({
      backend: { show, close: vi.fn() },
      getFocusedSessionId: () => "s1",
    });
    expect(svc.showIdleNotification({ sessionId: "s1" })).toBe(false);
    expect(show).not.toHaveBeenCalled();
  });
});
