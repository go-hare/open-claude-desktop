/**
 * Transcript JSONL search UtilityProcess host.
 * data-official-source: app.asar index.js mHi / yHi (cowork-search)
 *
 * Worker: .vite/build/transcript-search-worker/transcriptSearchWorker.js
 * Wired from LocalSessions / LocalAgentModeSessions searchSessions when query ≥ 2
 * and title/id miss: resolve jsonl paths then body-search here.
 */
import { app, utilityProcess, MessageChannelMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

export type TranscriptSearchSession = {
  sessionId: string;
  transcriptPath: string;
  lastActivityAt?: number | string;
};

export type TranscriptSearchHit = {
  sessionId: string;
  snippet: string;
  lastActivityAt?: number | string;
};

type Pending = {
  resolve: (hits: TranscriptSearchHit[]) => void;
  reject: (error: Error) => void;
};

function resolveWorkerPath(): string {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar")
    : app.getAppPath();
  return path.join(root, ".vite/build/transcript-search-worker/transcriptSearchWorker.js");
}

export class TranscriptSearchWorkerHost {
  private child: Electron.UtilityProcess | null = null;
  private port: Electron.MessagePortMain | null = null;
  private spawnPromise: Promise<void> | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, Pending>();

  async search(
    query: string,
    sessions: TranscriptSearchSession[],
    options: { limit: number; messageTypes?: string[] } = { limit: 50 },
  ): Promise<TranscriptSearchHit[]> {
    if (query.length < 2 || sessions.length === 0) return [];
    await this.ensureWorker();
    const port = this.port;
    if (!port) return [];

    const requestId = this.nextRequestId++;
    const messageTypes = options.messageTypes ?? ["user", "assistant"];
    return new Promise<TranscriptSearchHit[]>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      port.postMessage({
        type: "search",
        requestId,
        query,
        limit: options.limit,
        messageTypes,
        sessions,
      });
    }).finally(() => {
      this.pending.delete(requestId);
    });
  }

  private async ensureWorker(): Promise<void> {
    if (this.child && this.port) return;
    if (this.spawnPromise) return this.spawnPromise;
    this.spawnPromise = this.spawn().finally(() => {
      this.spawnPromise = null;
    });
    return this.spawnPromise;
  }

  private async spawn(): Promise<void> {
    const workerPath = resolveWorkerPath();
    try {
      await fs.access(workerPath);
    } catch {
      console.warn(`[cowork-search] worker not found at ${workerPath}; falling through to empty results`);
      return;
    }

    const child = utilityProcess.fork(workerPath, [], {
      serviceName: "Claude Desktop Transcript Search",
    });
    const { port1, port2 } = new MessageChannelMain();

    port1.on("message", (event) => {
      const data = event.data as {
        type?: string;
        requestId?: number;
        hits?: TranscriptSearchHit[];
        message?: string;
      };
      if (data.type === "result" && typeof data.requestId === "number") {
        const pending = this.pending.get(data.requestId);
        pending?.resolve(Array.isArray(data.hits) ? data.hits : []);
      } else if (data.type === "error" && typeof data.requestId === "number") {
        const pending = this.pending.get(data.requestId);
        pending?.reject(new Error(data.message || "transcript search error"));
      }
    });
    port1.start();

    await new Promise<void>((resolve, reject) => {
      const onExit = (code: number) => {
        reject(new Error(`transcript search worker exited during spawn: ${code}`));
      };
      child.once("exit", onExit);
      child.once("spawn", () => {
        child.off("exit", onExit);
        child.postMessage({ type: "init" }, [port2]);
        resolve();
      });
    });

    this.child = child;
    this.port = port1;
    child.once("exit", () => {
      this.child = null;
      this.port = null;
      for (const [, pending] of this.pending) {
        pending.reject(new Error("transcript search worker exited"));
      }
      this.pending.clear();
    });
  }
}

let sharedHost: TranscriptSearchWorkerHost | null = null;

export function getTranscriptSearchWorkerHost(): TranscriptSearchWorkerHost {
  if (!sharedHost) sharedHost = new TranscriptSearchWorkerHost();
  return sharedHost;
}
