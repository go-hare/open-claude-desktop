import type { CoworkSessionEvent } from "./coworkSessionManagerTypes";
import type {
  CoworkSdkMessage,
  CoworkSessionRuntimeState,
} from "./coworkSessionTypes";

type RewindContext = {
  emit: (event: CoworkSessionEvent) => void;
  getSession: (sessionId: string) => CoworkSessionRuntimeState | undefined;
  getTranscript: (sessionId: string) => Promise<CoworkSdkMessage[]>;
  now: () => number;
  save: (session: CoworkSessionRuntimeState) => void;
  stop: (sessionId: string) => Promise<void>;
};

function userPrompt(messages: CoworkSdkMessage[], targetUuid: string) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "user" || message.uuid !== targetUuid) continue;
    const content = record(record(message).message).content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return null;
    return content
      .filter((item) => record(item).type === "text")
      .map((item) => String(record(item).text ?? ""))
      .join("\n");
  }
  return null;
}

function precedingBufferedAssistant(
  messages: CoworkSdkMessage[],
  targetUuid: string,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type !== "user" || messages[index]?.uuid !== targetUuid)
      continue;
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      const message = messages[prior];
      if (message?.type === "assistant" && message.uuid) return message.uuid;
    }
    return undefined;
  }
  return undefined;
}

function precedingTranscriptAssistant(
  messages: CoworkSdkMessage[],
  targetUuid: string,
) {
  const byUuid = new Map(
    messages.flatMap((message) => (message.uuid ? [[message.uuid, message]] : [])),
  );
  let message = byUuid.get(targetUuid);
  const visited = new Set<string>();
  while (message?.parentUuid && !visited.has(message.parentUuid as string)) {
    visited.add(message.parentUuid as string);
    message = byUuid.get(message.parentUuid as string);
    if (message?.type === "assistant" && !message.parent_tool_use_id)
      return message.uuid;
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export async function rewindCoworkSession(
  context: RewindContext,
  sessionId: string,
  targetUuid: string,
): Promise<string | null> {
  const session = context.getSession(sessionId);
  if (!session) throw new Error(`Session "${sessionId}" not found`);
  if (session.sessionType) return null;
  const buffered = [...session.messageBuffer];
  if (session.query || session.inputStream) await context.stop(sessionId);
  let prompt = userPrompt(buffered, targetUuid);
  let assistantUuid = precedingBufferedAssistant(buffered, targetUuid);
  if (!assistantUuid) {
    const transcript = await context.getTranscript(sessionId).catch(() => []);
    assistantUuid = precedingTranscriptAssistant(transcript, targetUuid);
    prompt ??= userPrompt(transcript, targetUuid);
  }
  if (!prompt?.trim()) {
    session.error = undefined;
    session.lifecycleState = "idle";
    return null;
  }
  session.messageBuffer = [];
  session.pendingRewindTo = assistantUuid ?? "";
  session.error = undefined;
  session.isAgentCompleted = false;
  session.lastActivityAt = context.now();
  session.lifecycleState = "idle";
  context.emit({ sessionId, type: "session_updated" });
  context.save(session);
  return prompt;
}
