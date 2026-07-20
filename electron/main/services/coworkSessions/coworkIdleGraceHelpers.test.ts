import { afterEach, expect, it, vi } from "vitest";
import {
  armCoworkIdleGraceTimer,
  clearCoworkIdleGraceTimer,
  hasCoworkIdleGraceTimer,
  resolveCoworkIdleGraceArm,
  shouldTeardownOnCoworkIdleGraceFire,
} from "./coworkIdleGraceHelpers";

afterEach(() => {
  vi.useRealTimers();
});

it("resolveCoworkIdleGraceArm matches official gate order", () => {
  expect(
    resolveCoworkIdleGraceArm({
      graceMs: 0,
      fromRunning: true,
      hasError: false,
      hasQuery: true,
      hasInputStream: true,
    }),
  ).toEqual({ arm: false, reason: "ms_zero" });
  expect(
    resolveCoworkIdleGraceArm({
      graceMs: 1000,
      fromRunning: false,
      hasError: false,
      hasQuery: true,
      hasInputStream: true,
    }),
  ).toEqual({ arm: false, reason: "not_from_running" });
  expect(
    resolveCoworkIdleGraceArm({
      graceMs: 1000,
      fromRunning: true,
      hasError: true,
      hasQuery: true,
      hasInputStream: true,
    }),
  ).toEqual({ arm: false, reason: "has_error" });
  expect(
    resolveCoworkIdleGraceArm({
      graceMs: 1000,
      fromRunning: true,
      hasError: false,
      hasQuery: false,
      hasInputStream: true,
    }),
  ).toEqual({ arm: false, reason: "no_process" });
  expect(
    resolveCoworkIdleGraceArm({
      graceMs: 1000,
      fromRunning: true,
      hasError: false,
      hasQuery: true,
      hasInputStream: true,
      sessionType: "dispatch_child",
    }),
  ).toEqual({ arm: false, reason: "skip_session_type" });
  expect(
    resolveCoworkIdleGraceArm({
      graceMs: 1000,
      fromRunning: true,
      hasError: false,
      hasQuery: true,
      hasInputStream: true,
      sessionType: "radar",
    }),
  ).toEqual({ arm: false, reason: "skip_session_type" });
  expect(
    resolveCoworkIdleGraceArm({
      graceMs: 2500,
      fromRunning: true,
      hasError: false,
      hasQuery: true,
      hasInputStream: true,
      sessionType: "cowork",
    }),
  ).toEqual({ arm: true, graceMs: 2500 });
});

it("arm/clear idle grace timer and fire only when still idle", () => {
  vi.useFakeTimers();
  const session: {
    _idleGraceTimer?: ReturnType<typeof setTimeout>;
    _idleGraceStartedAt?: number;
    sessionId: string;
    lifecycleState: string;
  } = { sessionId: "s1", lifecycleState: "idle" };
  const onFire = vi.fn(() => {
    if (shouldTeardownOnCoworkIdleGraceFire(session.lifecycleState)) {
      session.lifecycleState = "torn_down";
    }
  });
  armCoworkIdleGraceTimer(session, { graceMs: 1000, onFire, now: () => 100 });
  expect(hasCoworkIdleGraceTimer(session)).toBe(true);
  expect(session._idleGraceStartedAt).toBe(100);
  vi.advanceTimersByTime(999);
  expect(onFire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onFire).toHaveBeenCalledTimes(1);
  expect(session.lifecycleState).toBe("torn_down");
  expect(session._idleGraceTimer).toBeUndefined();
});

it("clearCoworkIdleGraceTimer cancels pending fire", () => {
  vi.useFakeTimers();
  const session: {
    _idleGraceTimer?: ReturnType<typeof setTimeout>;
    _idleGraceStartedAt?: number;
    sessionId: string;
  } = { sessionId: "s2" };
  const onFire = vi.fn();
  armCoworkIdleGraceTimer(session, {
    graceMs: 500,
    onFire,
    now: () => 50,
  });
  const cleared = clearCoworkIdleGraceTimer(session, () => 150);
  expect(cleared.hadTimer).toBe(true);
  expect(cleared.graceElapsedMs).toBe(100);
  expect(hasCoworkIdleGraceTimer(session)).toBe(false);
  vi.advanceTimersByTime(1000);
  expect(onFire).not.toHaveBeenCalled();
});

it("timer fire skips teardown when lifecycle left idle", () => {
  vi.useFakeTimers();
  const session: {
    _idleGraceTimer?: ReturnType<typeof setTimeout>;
    _idleGraceStartedAt?: number;
    sessionId: string;
    lifecycleState: string;
  } = { sessionId: "s3", lifecycleState: "idle" };
  const teardown = vi.fn();
  armCoworkIdleGraceTimer(session, {
    graceMs: 100,
    onFire: () => {
      if (shouldTeardownOnCoworkIdleGraceFire(session.lifecycleState)) {
        teardown();
      }
    },
  });
  session.lifecycleState = "running";
  vi.advanceTimersByTime(100);
  expect(teardown).not.toHaveBeenCalled();
});
