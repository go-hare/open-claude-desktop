import { describe, expect, it } from "vitest";
import { localDateKey, streaksForLocalDates } from "./codeStatsAggregation";

describe("codeStatsAggregation residual helpers", () => {
  it("localDateKey uses local calendar (not UTC ISO)", () => {
    const date = new Date(2026, 6, 30, 23, 0, 0);
    expect(localDateKey(date)).toBe("2026-07-30");
  });

  it("streaksForLocalDates counts consecutive local days and current streak from today", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const twoAgo = new Date(today);
    twoAgo.setDate(today.getDate() - 2);
    const gap = new Date(today);
    gap.setDate(today.getDate() - 5);

    const dates = new Set([
      localDateKey(today),
      localDateKey(yesterday),
      localDateKey(twoAgo),
      localDateKey(gap),
    ]);
    const streaks = streaksForLocalDates(dates);
    expect(streaks.currentStreak).toBe(3);
    expect(streaks.longestStreak).toBeGreaterThanOrEqual(3);
  });

  it("empty dates yield zero streaks", () => {
    expect(streaksForLocalDates(new Set())).toEqual({ currentStreak: 0, longestStreak: 0 });
  });
});
