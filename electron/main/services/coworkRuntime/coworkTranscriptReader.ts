import {
  getSessionMessages,
  type GetSessionMessagesOptions,
  type SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  CoworkTranscriptOptions,
  CoworkTranscriptReader,
} from "../coworkSessions/coworkSessionManagerTypes";
import type {
  CoworkSdkMessage,
  CoworkSessionRuntimeState,
} from "../coworkSessions/coworkSessionTypes";
import {
  buildCoworkVmPathContext,
  translateCoworkMessagePaths,
} from "../coworkSessions/coworkVmPathTranslation";
import { createCoworkRawTranscriptLoader } from "./coworkTranscriptJsonl";

export type CoworkSessionMessageLoader = (
  sessionId: string,
  options?: GetSessionMessagesOptions,
) => Promise<SessionMessage[]>;

export type CoworkRawTranscriptLoader = (
  session: CoworkSessionRuntimeState,
  options?: CoworkTranscriptOptions,
) => Promise<CoworkSdkMessage[] | null>;

export type CoworkTranscriptPathContextResolver = (
  session: CoworkSessionRuntimeState,
) => { autoMemoryDir?: string | null; sessionStorageDir?: string | null } | null;

function transcriptDirectory(session: CoworkSessionRuntimeState): string | undefined {
  if (!session.hostLoopMode) return session.cwd;
  return session.resolvedFolders[0]?.canonical ?? session.resolvedFolders[0]?.display;
}

function filterMessages(
  messages: CoworkSdkMessage[],
  options?: CoworkTranscriptOptions,
): CoworkSdkMessage[] {
  const filtered = options?.types?.length
    ? messages.filter((message) => options.types?.includes(message.type))
    : messages;
  return options?.limit ? filtered.slice(-options.limit) : filtered;
}

/**
 * Official transcript load: XL each message with buildVMPathContext when available.
 */
function translateTranscriptMessages(
  session: CoworkSessionRuntimeState,
  messages: CoworkSdkMessage[],
  resolvePathContext?: CoworkTranscriptPathContextResolver | null,
): CoworkSdkMessage[] {
  if (!resolvePathContext) return messages;
  const dirs = resolvePathContext(session);
  if (!dirs) return messages;
  const context = buildCoworkVmPathContext(session, dirs);
  if (!context) return messages;
  return messages.map((message) => {
    try {
      return translateCoworkMessagePaths(
        message,
        context,
        session.hostLoopMode,
      );
    } catch {
      return message;
    }
  });
}

export function createCoworkTranscriptReader(
  loadMessages: CoworkSessionMessageLoader = getSessionMessages,
  loadRawTranscript: CoworkRawTranscriptLoader = createCoworkRawTranscriptLoader(),
  resolvePathContext?: CoworkTranscriptPathContextResolver | null,
): CoworkTranscriptReader {
  return async (session, options) => {
    if (!session.cliSessionId) return [];
    const raw = await loadRawTranscript(session, options).catch(() => null);
    if (raw) {
      return filterMessages(
        translateTranscriptMessages(session, raw, resolvePathContext),
        options,
      );
    }
    const disk = await loadMessages(session.cliSessionId, {
      dir: transcriptDirectory(session),
      includeSystemMessages: true,
      limit: options?.maxScan,
    }).catch(() => []);
    return filterMessages(
      translateTranscriptMessages(
        session,
        disk as CoworkSdkMessage[],
        resolvePathContext,
      ),
      options,
    );
  };
}
