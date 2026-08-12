/**
 * Official scheduled-task jitter residual (host app.asar / open-claude-desktop index.js):
 * - wr("3300773012","dispatchJitterMaxMinutes",10) default max minutes
 * - getJitterSecondsForTask: 0 if disableJitter / no cron / max≤0; else Q2i(id, min(max, interval-1)*60)
 * - Q2i(id, maxSeconds): sha256(id).readUInt32BE(0) % maxSeconds
 * - B2i(cron): minutes between consecutive matches (product approximates common 5-field shapes)
 * - zDA(task, jitterMs): nextRunAt = fireAt if one-shot pending, else next cron + jitterMs
 *
 * Do not invent remote jEe or GrowthBook client — default max minutes = 10 residual default.
 */
import { createHash } from "node:crypto";

/** Official GrowthBook default for dispatchJitterMaxMinutes. */
export const DISPATCH_JITTER_MAX_MINUTES_DEFAULT = 10;

/** Official Q2i(taskId, maxSeconds). */
export function deterministicJitterSeconds(taskId: string, maxSeconds: number): number {
  if (maxSeconds <= 0) return 0;
  return createHash("sha256").update(taskId).digest().readUInt32BE(0) % maxSeconds;
}

/**
 * Official B2i-style interval minutes for common product cron shapes.
 * Residual scans consecutive matches; we return the known period for 5-field cron
 * the product create modal / store generate (hourly/daily/weekdays/weekly).
 */
export function cronIntervalMinutes(cronExpression: string): number | null {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth !== "*" || month !== "*") return null;
  if (hour === "*" && dayOfWeek === "*") return 60; // hourly
  if (dayOfWeek === "*") return 24 * 60; // daily
  if (dayOfWeek === "1-5") return 24 * 60; // weekdays (min gap ~1 day)
  if (/^\d$/.test(dayOfWeek)) return 7 * 24 * 60; // weekly
  return null;
}

export type JitterTaskFields = {
  id: string;
  disableJitter?: boolean;
  cronExpression?: string;
  fireAt?: string;
  lastRunAt?: string;
  enabled?: boolean;
};

/**
 * Official getJitterSecondsForTask residual (default max minutes = 10).
 */
export function getJitterSecondsForTask(
  task: JitterTaskFields | null | undefined,
  maxMinutes: number = DISPATCH_JITTER_MAX_MINUTES_DEFAULT,
): number {
  if (!task || maxMinutes <= 0) return 0;
  if (task.disableJitter || !task.cronExpression) return 0;
  const interval = cronIntervalMinutes(task.cronExpression);
  const n = interval !== null ? Math.min(maxMinutes, interval - 1) : maxMinutes;
  if (n <= 0) return 0;
  return deterministicJitterSeconds(task.id, n * 60);
}

/**
 * Product next-cron helper (same scan style as store.nextRunAt).
 * Exported for zDA + tests.
 */
export function nextCronOccurrence(cronExpression: string, after = new Date()): Date | undefined {
  const [minuteRaw, hourRaw, , , dayRaw] = cronExpression.split(" ");
  const minute = Number(minuteRaw);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return undefined;
  const cursor = new Date(after);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let attempts = 0; attempts < 366 * 24 * 60; attempts += 1) {
    const hourMatches = hourRaw === "*" || cursor.getHours() === Number(hourRaw);
    const minuteMatches = cursor.getMinutes() === minute;
    const dayMatches =
      !dayRaw
      || dayRaw === "*"
      || (dayRaw === "1-5"
        ? cursor.getDay() >= 1 && cursor.getDay() <= 5
        : cursor.getDay() === Number(dayRaw));
    if (hourMatches && minuteMatches && dayMatches) return new Date(cursor);
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return undefined;
}

/**
 * Official zDA(task, jitterMs) — nextRunAt ISO when enabled.
 */
export function computeNextRunAt(
  task: Pick<JitterTaskFields, "enabled" | "fireAt" | "lastRunAt" | "cronExpression">,
  jitterMs = 0,
  after = new Date(),
): string | undefined {
  if (task.enabled === false) return undefined;
  if (task.fireAt && !task.lastRunAt) {
    const fireMs = Date.parse(task.fireAt);
    return Number.isFinite(fireMs) ? new Date(fireMs).toISOString() : task.fireAt;
  }
  if (task.cronExpression) {
    const next = nextCronOccurrence(task.cronExpression, after);
    if (!next) return undefined;
    return new Date(next.getTime() + jitterMs).toISOString();
  }
  return undefined;
}
