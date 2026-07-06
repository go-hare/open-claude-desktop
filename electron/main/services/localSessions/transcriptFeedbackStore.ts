import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

type FeedbackRecord = Record<string, unknown> & {
  id: string;
  createdAt: string;
  sessionId?: string;
};

function feedbackFile(): string {
  return path.join(app.getPath("userData"), "transcript-feedback.json");
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function readFeedback(): Promise<FeedbackRecord[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(feedbackFile(), "utf8"));
    return Array.isArray(parsed.feedback) ? parsed.feedback : [];
  } catch {
    return [];
  }
}

async function writeFeedback(feedback: FeedbackRecord[]): Promise<void> {
  const filePath = feedbackFile();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ feedback }, null, 2));
}

export async function submitTranscriptFeedback(sessionIdOrInput: unknown, input?: unknown): Promise<FeedbackRecord> {
  const now = new Date().toISOString();
  const sessionId = asString(sessionIdOrInput) ?? asString(asObject(sessionIdOrInput).sessionId);
  const raw = Object.keys(asObject(input)).length > 0 ? asObject(input) : asObject(sessionIdOrInput);
  const record: FeedbackRecord = {
    ...raw,
    id: asString(raw.id) ?? `feedback_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    sessionId: sessionId ?? asString(raw.sessionId),
    createdAt: now,
  };
  const feedback = await readFeedback();
  feedback.unshift(record);
  await writeFeedback(feedback.slice(0, 1000));
  return record;
}

export async function getTranscriptFeedback(sessionId?: unknown): Promise<FeedbackRecord[]> {
  const id = asString(sessionId) ?? asString(asObject(sessionId).sessionId);
  const feedback = await readFeedback();
  return id ? feedback.filter((item) => item.sessionId === id) : feedback;
}
