/**
 * UtilityProcess worker: JSONL transcript text search.
 * data-official-source: app.asar .vite/build/transcript-search-worker/transcriptSearchWorker.js
 *
 * Messages (MessagePort):
 *   → { type: "search", requestId, query, messageTypes, sessions, limit }
 *   ← { type: "result", requestId, hits } | { type: "error", requestId, message }
 */
import fs from "node:fs";
import readline from "node:readline";

const SNIPPET_RADIUS = 80;

type SessionRef = {
  sessionId: string;
  transcriptPath: string;
  lastActivityAt?: number | string;
};

type SearchRequest = {
  type: "search";
  requestId: string;
  query: string;
  messageTypes: string[];
  sessions: SessionRef[];
  limit: number;
};

type SearchHit = {
  sessionId: string;
  snippet: string;
  lastActivityAt?: number | string;
};

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    let out = "";
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        out += `${(block as { text: string }).text} `;
      }
    }
    return out;
  }
  return "";
}

function makeSnippet(text: string, idx: number, qLen: number): string {
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + qLen + SNIPPET_RADIUS);
  const slice = text.slice(start, end).trim();
  return (start > 0 ? "…" : "") + slice + (end < text.length ? "…" : "");
}

async function scanFile(
  session: SessionRef,
  needle: string,
  messageTypes: Set<string>,
): Promise<SearchHit | null> {
  let snippet: string | null = null;
  const stream = fs.createReadStream(session.transcriptPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      let parsed: {
        type?: string;
        message?: { content?: unknown };
      };
      try {
        parsed = JSON.parse(line) as typeof parsed;
      } catch {
        continue;
      }
      if (!parsed.type || !messageTypes.has(parsed.type)) continue;
      const text = extractText(parsed.message?.content);
      if (!text) continue;
      const normalized = text.replace(/\s+/g, " ");
      const idx = normalized.toLowerCase().indexOf(needle);
      if (idx === -1) continue;
      snippet = makeSnippet(normalized, idx, needle.length);
      break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  if (snippet === null) return null;
  return {
    sessionId: session.sessionId,
    snippet,
    lastActivityAt: session.lastActivityAt,
  };
}

/**
 * Electron UtilityProcess MessagePort (MessagePortMain at runtime).
 * Structural type avoids DOM MessagePort vs MessagePortMain tsc clash.
 */
type UtilityMessagePort = {
  start: () => void;
  close: () => void;
  postMessage: (message: unknown) => void;
  on: (event: "message" | "close", listener: (...args: any[]) => void) => void;
};

async function handleSearch(
  port: UtilityMessagePort,
  req: SearchRequest,
): Promise<void> {
  const needle = req.query.replace(/\s+/g, " ").trim().toLowerCase();
  const messageTypes = new Set(req.messageTypes);
  const hits: SearchHit[] = [];
  for (const session of req.sessions) {
    try {
      const hit = await scanFile(session, needle, messageTypes);
      if (hit) hits.push(hit);
    } catch {
      /* skip unreadable session residual */
    }
    if (hits.length >= req.limit) break;
  }
  port.postMessage({ type: "result", requestId: req.requestId, hits });
}

type ParentPortLike = {
  once: (
    event: "message",
    listener: (e: {
      data?: { type?: string };
      ports?: UtilityMessagePort[];
    }) => void,
  ) => void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) {
  throw new Error("transcriptSearchWorker must run as Electron UtilityProcess");
}

parentPort.once("message", (e) => {
  const port = e.ports?.[0] as unknown as UtilityMessagePort | undefined;
  if (e.data?.type !== "init" || !port) {
    process.exit(1);
  }
  port.on("message", (event: { data?: SearchRequest }) => {
    const data = event.data as SearchRequest | undefined;
    if (data?.type === "search") {
      handleSearch(port, data).catch((error) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        port.postMessage({
          type: "error",
          requestId: data.requestId,
          message,
        });
      });
    }
  });
  port.start();
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
