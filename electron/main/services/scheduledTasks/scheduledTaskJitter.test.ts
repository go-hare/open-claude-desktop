import { describe, expect, it } from "vitest";
import {
  computeNextRunAt,
  cronIntervalMinutes,
  deterministicJitterSeconds,
  getJitterSecondsForTask,
} from "./scheduledTaskJitter";

describe("Q2i residual — deterministicJitterSeconds", () => {
  it("is stable for the same task id", () => {
    expect(deterministicJitterSeconds("task-a", 600)).toBe(
      deterministicJitterSeconds("task-a", 600),
    );
  });

  it("returns 0 when maxSeconds ≤ 0", () => {
    expect(deterministicJitterSeconds("x", 0)).toBe(0);
  });

  it("stays in [0, max)", () => {
    const max = 120;
    const v = deterministicJitterSeconds("abc", max);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(max);
  });
});

describe("B2i residual — cronIntervalMinutes", () => {
  it("hourly / daily / weekly", () => {
    expect(cronIntervalMinutes("15 * * * *")).toBe(60);
    expect(cronIntervalMinutes("0 9 * * *")).toBe(1440);
    expect(cronIntervalMinutes("0 9 * * 1")).toBe(10080);
    expect(cronIntervalMinutes("0 9 * * 1-5")).toBe(1440);
  });
});

describe("getJitterSecondsForTask residual", () => {
  it("0 when disableJitter or no cron", () => {
    expect(
      getJitterSecondsForTask({ id: "t1", disableJitter: true, cronExpression: "0 9 * * *" }),
    ).toBe(0);
    expect(getJitterSecondsForTask({ id: "t1", cronExpression: undefined })).toBe(0);
  });

  it("returns deterministic seconds for cron task", () => {
    const seconds = getJitterSecondsForTask({
      id: "daily-task",
      cronExpression: "0 9 * * *",
    });
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThan(10 * 60); // max default 10 min, interval-1 = 1439 → min 10
    expect(seconds).toBe(
      getJitterSecondsForTask({ id: "daily-task", cronExpression: "0 9 * * *" }),
    );
  });
});

describe("zDA residual — computeNextRunAt", () => {
  it("prefers fireAt when pending one-shot", () => {
    expect(
      computeNextRunAt({
        enabled: true,
        fireAt: "2030-01-01T12:00:00.000Z",
        cronExpression: "0 9 * * *",
      }),
    ).toBe("2030-01-01T12:00:00.000Z");
  });

  it("skips fireAt after lastRunAt", () => {
    const next = computeNextRunAt({
      enabled: true,
      fireAt: "2020-01-01T12:00:00.000Z",
      lastRunAt: "2020-01-01T12:01:00.000Z",
      cronExpression: "0 9 * * *",
    });
    expect(next).toBeTruthy();
    expect(next).not.toBe("2020-01-01T12:00:00.000Z");
  });
});
