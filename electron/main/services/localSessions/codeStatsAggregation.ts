/**
 * Official residual (app.asar):
 *   SI() → CLAUDE_CONFIG_DIR || ~/.claude
 *   d7i → read `stats-cache.json`
 *   h7i → list project *.jsonl + subagents/agent-*.jsonl
 *   D7i → incremental scan since lastComputedDate (or 182d window)
 *   Yit → 60s memo of D7i
 *   p7i → local-date streaks
 *   CtA → local YYYY-MM-DD
 *
 * Wire: LocalSessions.getCodeStats → Yit (no arg). Product previously counted only
 * userData code-sessions metadata (sessionCount, zero messages/tokens).
 */

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";

const LOOKBACK_DAYS = 182;
const SCAN_CONCURRENCY = 20;
const MEMO_TTL_MS = 60_000;
const SYNTHETIC_MODEL = "<synthetic>";

export type CodeStatsModelUsage = {
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  inputTokens: number;
  outputTokens: number;
};

export type CodeStatsPayload = {
  dailyActivity: Array<{
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }>;
  dailyModelTokens: Array<{ date: string; tokensByModel: Record<string, number> }>;
  modelUsage: Record<string, CodeStatsModelUsage>;
  peakActivityHour: number | null;
  streaks: { currentStreak: number; longestStreak: number };
  // Official extras (frontend may ignore).
  totalSessions?: number;
  totalMessages?: number;
  activeDays?: number;
  firstSessionDate?: string | null;
  lastSessionDate?: string | null;
};

type StatsCache = CodeStatsPayload & {
  lastComputedDate?: string;
  hourCounts?: Record<string, number>;
};

type TranscriptEntry = {
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  message?: {
    content?: unknown;
    usage?: Record<string, unknown>;
    model?: string;
  };
};

function claudeConfigDir(): string {
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env === "~" || env?.startsWith("~/") || env?.startsWith("~\\")) {
    return path.join(homedir(), env.slice(1));
  }
  return env || path.join(homedir(), ".claude");
}

/** Official CtA — local calendar date key. */
export function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function nextLocalDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return localDateKey(date);
}

function emptyUsage(): CodeStatsModelUsage {
  return {
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Official p7i residual — current streak walks local midnights backward. */
export function streaksForLocalDates(dates: Set<string>): {
  currentStreak: number;
  longestStreak: number;
} {
  if (dates.size === 0) return { currentStreak: 0, longestStreak: 0 };

  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let currentStreak = 0;
  while (dates.has(localDateKey(cursor))) {
    currentStreak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const sorted = Array.from(dates).sort();
  let longestStreak = 1;
  let run = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = new Date(`${sorted[index - 1]}T00:00:00`);
    const current = new Date(`${sorted[index]}T00:00:00`);
    const dayDelta = Math.round((current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24));
    if (dayDelta === 1) {
      run += 1;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 1;
    }
  }
  longestStreak = Math.max(longestStreak, run);
  return { currentStreak, longestStreak };
}

async function readStatsCache(): Promise<StatsCache | null> {
  const filePath = path.join(claudeConfigDir(), "stats-cache.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as StatsCache;
    return Array.isArray(parsed.dailyActivity) ? parsed : null;
  } catch {
    return null;
  }
}

/** Official h7i — all project jsonl + agent-*.jsonl under subagents/. */
async function listTranscriptFiles(): Promise<string[]> {
  const projectsRoot = path.join(claudeConfigDir(), "projects");
  let projectDirs: string[] = [];
  try {
    const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
    projectDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(projectsRoot, entry.name));
  } catch {
    return [];
  }

  const nested = await Promise.all(
    projectDirs.map(async (projectDir) => {
      try {
        const entries = await fs.readdir(projectDir, { withFileTypes: true });
        const main = entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
          .map((entry) => path.join(projectDir, entry.name));
        const sessionDirs = entries.filter((entry) => entry.isDirectory());
        const agents = await Promise.all(
          sessionDirs.map(async (sessionDir) => {
            const subagents = path.join(projectDir, sessionDir.name, "subagents");
            try {
              const files = await fs.readdir(subagents, { withFileTypes: true });
              return files
                .filter(
                  (entry) =>
                    entry.isFile() && entry.name.endsWith(".jsonl") && entry.name.startsWith("agent-"),
                )
                .map((entry) => path.join(subagents, entry.name));
            } catch {
              return [] as string[];
            }
          }),
        );
        return [...main, ...agents.flat()];
      } catch {
        return [] as string[];
      }
    }),
  );
  return nested.flat();
}

async function readJsonlEntries(filePath: string): Promise<TranscriptEntry[]> {
  const entries: TranscriptEntry[] = [];
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as TranscriptEntry);
      } catch {
        // skip corrupt lines
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return entries;
}

function isSubagentPath(filePath: string): boolean {
  return filePath.includes(`${path.sep}subagents${path.sep}`);
}

/**
 * Official D7i residual — recompute code stats from ~/.claude/projects (+ cache prefix).
 */
export async function computeCodeStatsFromProjects(): Promise<CodeStatsPayload> {
  const cache = await readStatsCache();
  const sinceKey =
    cache?.lastComputedDate != null
      ? nextLocalDateKey(cache.lastComputedDate)
      : localDateKey(new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
  const sinceMs = new Date(`${sinceKey}T00:00:00`).getTime();

  const daily = new Map<
    string,
    { date: string; messageCount: number; sessionCount: number; toolCallCount: number }
  >();
  for (const entry of cache?.dailyActivity ?? []) {
    if (entry.date < sinceKey) daily.set(entry.date, { ...entry });
  }

  const dailyModelTokens = new Map<string, Record<string, number>>();
  for (const entry of cache?.dailyModelTokens ?? []) {
    if (entry.date < sinceKey) dailyModelTokens.set(entry.date, { ...entry.tokensByModel });
  }

  const modelUsage: Record<string, CodeStatsModelUsage> = {};
  for (const [model, usage] of Object.entries(cache?.modelUsage ?? {})) {
    modelUsage[model] = {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
    };
  }

  const hourCounts = new Map<number, number>();
  for (const [hour, count] of Object.entries(cache?.hourCounts ?? {})) {
    hourCounts.set(Number(hour), count);
  }

  let totalSessions = cache?.totalSessions ?? 0;
  let totalMessages = cache?.totalMessages ?? 0;
  let firstSessionDate: string | null = cache?.firstSessionDate ?? null;
  let lastSessionDate: string | null = null;

  const allFiles = await listTranscriptFiles();
  const recentFiles: string[] = [];
  await Promise.all(
    allFiles.map(async (filePath) => {
      try {
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs >= sinceMs) recentFiles.push(filePath);
      } catch {
        // ignore missing
      }
    }),
  );

  for (let index = 0; index < recentFiles.length; index += SCAN_CONCURRENCY) {
    const batch = recentFiles.slice(index, index + SCAN_CONCURRENCY);
    const parsed = await Promise.all(
      batch.map(async (filePath) => {
        try {
          return { filePath, entries: await readJsonlEntries(filePath) };
        } catch {
          return { filePath, entries: [] as TranscriptEntry[] };
        }
      }),
    );

    for (const { filePath, entries } of parsed) {
      const messages = entries.filter((entry) => entry.type === "user" || entry.type === "assistant");
      if (messages.length === 0) continue;

      const subagent = isSubagentPath(filePath);
      const counted = subagent ? messages : messages.filter((entry) => !entry.isSidechain);
      if (counted.length === 0) continue;

      const firstTs = new Date(counted[0]?.timestamp ?? "");
      if (Number.isNaN(firstTs.getTime())) continue;
      const dayKey = localDateKey(firstTs);
      if (dayKey < sinceKey) continue;

      const day = daily.get(dayKey) ?? {
        date: dayKey,
        messageCount: 0,
        sessionCount: 0,
        toolCallCount: 0,
      };

      if (!subagent) {
        totalSessions += 1;
        totalMessages += counted.length;
        day.sessionCount += 1;
        day.messageCount += counted.length;
        const hour = firstTs.getHours();
        hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
        const stamp = counted[0]?.timestamp ?? null;
        if (stamp) {
          if (!firstSessionDate || stamp < firstSessionDate) firstSessionDate = stamp;
          if (!lastSessionDate || stamp > lastSessionDate) lastSessionDate = stamp;
        }
      }

      // Official: subagent rows only update an already-present day bucket.
      if (!subagent || daily.has(dayKey)) daily.set(dayKey, day);

      for (const entry of counted) {
        if (entry.type !== "assistant") continue;
        const content = entry.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block &&
              typeof block === "object" &&
              (block as { type?: string }).type === "tool_use"
            ) {
              const bucket = daily.get(dayKey);
              if (bucket) bucket.toolCallCount += 1;
            }
          }
        }

        const usage = entry.message?.usage;
        if (!usage) continue;
        // Official: message.model ?? "unknown"; also drop empty / synthetic.
        const rawModel = entry.message?.model;
        const model =
          typeof rawModel === "string" && rawModel.trim().length > 0 ? rawModel.trim() : "unknown";
        if (model === SYNTHETIC_MODEL) continue;

        const modelBucket = modelUsage[model] ?? (modelUsage[model] = emptyUsage());
        modelBucket.inputTokens += numberValue(usage.input_tokens ?? usage.inputTokens);
        modelBucket.outputTokens += numberValue(usage.output_tokens ?? usage.outputTokens);
        modelBucket.cacheReadInputTokens += numberValue(
          usage.cache_read_input_tokens ?? usage.cacheReadInputTokens,
        );
        modelBucket.cacheCreationInputTokens += numberValue(
          usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens,
        );

        const tokenDelta =
          numberValue(usage.input_tokens ?? usage.inputTokens) +
          numberValue(usage.output_tokens ?? usage.outputTokens);
        if (tokenDelta > 0) {
          const dayTokens = dailyModelTokens.get(dayKey) ?? {};
          dayTokens[model] = (dayTokens[model] ?? 0) + tokenDelta;
          dailyModelTokens.set(dayKey, dayTokens);
        }
      }
    }
  }

  const dailyActivity = Array.from(daily.values()).sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  const dailyModelTokenRows = Array.from(dailyModelTokens.entries())
    .map(([date, tokensByModel]) => ({ date, tokensByModel }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const activeDates = new Set(dailyActivity.map((entry) => entry.date));

  let peakActivityHour: number | null = null;
  let peakCount = 0;
  for (const [hour, count] of hourCounts) {
    if (count > peakCount) {
      peakCount = count;
      peakActivityHour = hour;
    }
  }

  return {
    totalSessions,
    totalMessages,
    activeDays: activeDates.size,
    firstSessionDate,
    lastSessionDate,
    peakActivityHour,
    streaks: streaksForLocalDates(activeDates),
    dailyActivity,
    dailyModelTokens: dailyModelTokenRows,
    modelUsage,
  };
}

let inFlight: Promise<CodeStatsPayload> | null = null;
let memo: { at: number; payload: CodeStatsPayload } | null = null;

/** Official Yit residual — 60s memo + single-flight. */
export async function getOfficialCodeStats(): Promise<CodeStatsPayload> {
  if (memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.payload;
  if (inFlight) return inFlight;
  inFlight = computeCodeStatsFromProjects()
    .then((payload) => {
      memo = { at: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test helper — clear memo between cases. */
export function clearCodeStatsMemoForTests(): void {
  memo = null;
  inFlight = null;
}
