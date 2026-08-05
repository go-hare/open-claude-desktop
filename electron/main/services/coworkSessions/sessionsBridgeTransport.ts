/**
 * Residual CCR v2 bridge transport shell (app.asar M6i / I6i / N6i / S6i / d6i / h6i).
 *
 * Official M6i:
 *   if (ft(R6i="583857784")) → h6i(e) SDK adapter
 *   else CCR:
 *     sessionUrl = `${api}/v1/code/sessions/${id}`
 *     registerWorker POST sessionUrl/worker/register → worker_epoch
 *     SSE sessionUrl/worker/events/stream
 *     CCR client PUT /worker + POST /worker/events + delivery acks
 *
 * Product residual: real registerWorker + SSE open + event write/delivery posts.
 * h6i residual body lives in sessionsBridgeSdkTransport (eit attach shape).
 * Does not invent connected success when register/SSE/attach fails.
 *
 * data-official-source: app.asar M6i / I6i / N6i / S6i / d6i / h6i / eit
 */

import { net } from "electron";

const LOG = "[transport:bridge]";
const SSE_LOG = "[transport:sse]";
const CCR_LOG = "[transport:ccr]";

export type BridgeSessionTransport = {
  connect(): Promise<void>;
  write(message: unknown): Promise<{ ok: boolean }>;
  close(): void;
  reconnectTransport?(opts: {
    ingressToken: string;
    apiBaseUrl?: string;
  }): Promise<void>;
  isConnectedStatus?(): boolean;
  setOnData(cb: ((data: string) => void) | null): void;
  setOnClose(cb: ((code?: number) => void) | null): void;
  reportState?(state: unknown): void;
  reportMetadata?(meta: unknown): void;
  reportDelivery?(eventId: string, status: string): void;
  flush?(): Promise<void>;
};

export type CreateBridgeTransportArgs = {
  workSecret: {
    session_ingress_token: string;
    api_base_url?: string;
    [key: string]: unknown;
  };
  sessionId: string;
  apiHost: string;
  getAuthToken: () => string;
  /** Inject fetch for tests. */
  fetchImpl?: typeof fetch;
};

/** Official N6i */
export function sessionsBridgeSessionUrl(
  apiBase: string,
  sessionId: string,
): string {
  return `${apiBase.replace(/\/+$/, "")}/v1/code/sessions/${encodeURIComponent(sessionId)}`;
}

/** Official I6i residual — registerWorker with 1 retry. */
export async function registerBridgeWorker(
  sessionUrl: string,
  getAuthToken: () => string,
  fetchImpl: typeof fetch = defaultFetch,
): Promise<number> {
  const url = `${sessionUrl.replace(/\/+$/, "")}/worker/register`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `registerWorker: HTTP ${res.status} ${text.slice(0, 200)}`,
        );
      }
      const body = (await res.json()) as { worker_epoch?: unknown };
      const raw = body?.worker_epoch;
      const epoch = typeof raw === "string" ? Number(raw) : raw;
      if (
        typeof epoch !== "number" ||
        !Number.isFinite(epoch) ||
        !Number.isSafeInteger(epoch)
      ) {
        throw new Error(
          `registerWorker: invalid worker_epoch in response: ${JSON.stringify(body)}`,
        );
      }
      return epoch;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        console.warn(
          `registerWorker attempt ${attempt} failed: ${
            err instanceof Error ? err.message : String(err)
          }, retrying in 2s`,
        );
        await new Promise((r) => setTimeout(r, 2_000));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`registerWorker: ${String(lastErr)}`);
}

function defaultFetch(url: string, init?: RequestInit): Promise<Response> {
  return net.fetch(url, { ...init, credentials: "omit" }) as Promise<Response>;
}

/**
 * Official M6i residual factory (CCR path; not SDK adapter invent).
 */
export async function createCcrBridgeTransport(
  args: CreateBridgeTransportArgs,
): Promise<BridgeSessionTransport> {
  const fetchImpl = args.fetchImpl ?? defaultFetch;
  const apiBase = args.workSecret.api_base_url || args.apiHost;
  const sessionUrl = sessionsBridgeSessionUrl(apiBase, args.sessionId);
  console.info(
    `${LOG} CCR transport for session ${args.sessionId} (sessionUrl=${sessionUrl})`,
  );

  let getAuthToken = args.getAuthToken;
  let workerEpoch = 0;
  let closed = false;
  let connected = false;
  let onData: ((data: string) => void) | null = null;
  let onClose: ((code?: number) => void) | null = null;
  let abortController: AbortController | null = null;
  let streamTask: Promise<void> | null = null;

  async function ccrRequest(
    method: string,
    path: string,
    body: unknown,
    label: string,
  ): Promise<boolean> {
    if (closed) return false;
    const url = `${sessionUrl.replace(/\/+$/, "")}${path}`;
    try {
      const res = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        console.info(
          `${LOG} epoch superseded (409) — closing for poll-loop recovery`,
        );
        transport.close(4090);
        throw new Error("epoch superseded");
      }
      if (!res.ok) {
        console.warn(
          `${CCR_LOG} ${label} failed status=${res.status}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      if (err instanceof Error && err.message === "epoch superseded") throw err;
      console.warn(
        `${CCR_LOG} ${label} error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  const transport: BridgeSessionTransport = {
    async connect() {
      if (closed) throw new Error("transport closed");
      workerEpoch = await registerBridgeWorker(
        sessionUrl,
        getAuthToken,
        fetchImpl,
      );
      console.info(
        `${LOG} registered worker sessionId=${args.sessionId} epoch=${workerEpoch}`,
      );
      const ok = await ccrRequest(
        "PUT",
        "/worker",
        { worker_status: "idle", worker_epoch: workerEpoch },
        "PUT worker (init)",
      );
      if (!ok) throw new Error("CCRClient: initial PUT /worker failed");

      // SSE stream residual (S6i subset)
      const streamUrl = new URL(
        `${sessionUrl.replace(/\/+$/, "")}/worker/events/stream`,
      );
      abortController = new AbortController();
      console.info(`${SSE_LOG} Opening stream session=${args.sessionId}`);
      const res = await fetchImpl(streamUrl.href, {
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
          Accept: "text/event-stream",
          "anthropic-version": "2023-06-01",
        },
        signal: abortController.signal,
      });
      if (!res.ok) {
        const permanent = [401, 403, 404].includes(res.status);
        console.error(
          `${SSE_LOG} HTTP ${res.status}${permanent ? " (permanent)" : ""}`,
        );
        if (permanent) {
          closed = true;
          onClose?.();
          throw new Error(`SSE permanent HTTP ${res.status}`);
        }
        throw new Error(`SSE HTTP ${res.status}`);
      }
      connected = true;
      console.info(`${SSE_LOG} Connected`);
      console.info(`${CCR_LOG} initialized, epoch=${workerEpoch}`);

      const body = res.body;
      if (body) {
        streamTask = (async () => {
          try {
            const reader = (
              body as ReadableStream<Uint8Array> & {
                getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
              }
            ).getReader?.();
            if (!reader) {
              // Electron net.fetch body may be async iterable / text fallback
              const text = await res.text();
              if (text) onData?.(text);
              return;
            }
            const decoder = new TextDecoder();
            let buffer = "";
            while (!closed) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let idx: number;
              while ((idx = buffer.indexOf("\n\n")) !== -1) {
                const frame = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                if (!frame.trim() || frame.startsWith(":")) continue;
                let dataLine = "";
                for (const line of frame.split("\n")) {
                  if (line.startsWith("data:")) {
                    dataLine += (dataLine ? "\n" : "") + line.slice(5).trimStart();
                  }
                }
                if (dataLine) {
                  try {
                    const parsed = JSON.parse(dataLine) as {
                      event_id?: string;
                      [k: string]: unknown;
                    };
                    if (typeof parsed.event_id === "string") {
                      void transport.reportDelivery?.(
                        parsed.event_id,
                        "received",
                      );
                    }
                  } catch {
                    /* raw frame */
                  }
                  onData?.(dataLine);
                }
              }
            }
          } catch (err) {
            if (!closed && !abortController?.signal.aborted) {
              console.error(
                `${SSE_LOG} stream error: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }
          } finally {
            if (!closed) {
              connected = false;
              onClose?.(4092);
            }
          }
        })();
      }
    },

    async write(message: unknown) {
      if (closed) return { ok: false };
      const ok = await ccrRequest(
        "POST",
        "/worker/events",
        { worker_epoch: workerEpoch, events: [message] },
        "client events",
      );
      return { ok };
    },

    close(code?: number) {
      if (closed) return;
      closed = true;
      connected = false;
      abortController?.abort();
      abortController = null;
      onClose?.(code);
    },

    async reconnectTransport(opts) {
      // Official: refresh ingress token then re-open stream.
      // Product residual: update token getter + abort SSE; client reconnectSessionTransport
      // re-runs registerWorker/PUT/SSE (avoids double connect paths). No invent connected.
      const token = opts.ingressToken;
      getAuthToken = () => token;
      if (closed) return;
      connected = false;
      abortController?.abort();
      console.info(
        `${LOG} reconnectTransport token refreshed; stream aborted for client reconnect session=${args.sessionId}`,
      );
    },

    isConnectedStatus() {
      return connected && !closed;
    },

    setOnData(cb) {
      onData = cb;
    },

    setOnClose(cb) {
      onClose = cb;
    },

    reportState(state) {
      if (closed) return;
      void ccrRequest(
        "PUT",
        "/worker",
        {
          worker_epoch: workerEpoch,
          ...(typeof state === "object" && state ? state : { worker_status: state }),
        },
        "PUT worker",
      );
    },

    reportMetadata(meta) {
      if (closed) return;
      void ccrRequest(
        "PUT",
        "/worker",
        { worker_epoch: workerEpoch, metadata: meta },
        "PUT worker metadata",
      );
    },

    reportDelivery(eventId, status) {
      if (closed) return;
      void ccrRequest(
        "POST",
        `/worker/events/${encodeURIComponent(eventId)}/delivery`,
        { status, worker_epoch: workerEpoch },
        `Delivery ${eventId}`,
      );
    },

    async flush() {
      await streamTask?.catch(() => undefined);
    },
  };

  // Bind close with optional code for epoch path
  const baseClose = transport.close.bind(transport);
  transport.close = (code?: number) => baseClose(code);

  return transport;
}

/**
 * Official M6i entry residual.
 * asar: if (ft(R6i="583857784")) return h6i(e); else CCR.
 *
 * Product:
 *   1. isSdkAdapterFeatureEnabled() true → createSdkBridgeTransport (h6i residual)
 *   2. optional createSdkAdapterTransport override for tests
 *   3. feature off / probe missing → CCR
 */
export type CreateSessionsBridgeTransportOptions = CreateBridgeTransportArgs & {
  /** Official R6i feature probe residual (GrowthBook ft("583857784")). */
  isSdkAdapterFeatureEnabled?: () => boolean;
  /**
   * Test / host override for h6i factory. Default product path uses
   * createSdkBridgeTransport residual (not inject-only).
   */
  createSdkAdapterTransport?: (
    args: CreateBridgeTransportArgs,
  ) => Promise<BridgeSessionTransport> | BridgeSessionTransport;
};

export async function createSessionsBridgeTransport(
  args: CreateSessionsBridgeTransportOptions,
): Promise<BridgeSessionTransport> {
  let sdkFeatureOn = false;
  try {
    sdkFeatureOn = args.isSdkAdapterFeatureEnabled?.() === true;
  } catch {
    sdkFeatureOn = false;
  }

  if (sdkFeatureOn) {
    console.info(
      `${LOG} gate on — using SDK adapter for session ${args.sessionId}`,
    );
    if (args.createSdkAdapterTransport) {
      return args.createSdkAdapterTransport(args);
    }
    // Lazy dynamic import — avoid cycle with sessionsBridgeSdkTransport →
    // createCcrBridgeTransport (static import would circular-init).
    const { createSdkBridgeTransport } = await import(
      "./sessionsBridgeSdkTransport"
    );
    return createSdkBridgeTransport(args);
  }
  return createCcrBridgeTransport(args);
}
