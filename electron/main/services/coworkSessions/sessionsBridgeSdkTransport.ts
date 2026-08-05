/**
 * Official h6i residual — SDK adapter transport (app.asar h6i / eit / $pe subset).
 *
 * asar M6i:
 *   if (ft(R6i="583857784")) return h6i(e);
 *   else CCR path
 *
 * asar h6i(e):
 *   attach via eit({ sessionId, ingressToken, apiBaseUrl, onInboundMessage,
 *                    onPermissionResponse, onClose })
 *   write: control_request → sendControlRequest; control_response → sendControlResponse;
 *          else handle.write
 *   reconnectTransport / reportState / reportMetadata / reportDelivery / flush
 *
 * Product residual: eit-shaped attach over CCR v2 worker register + SSE + events
 * (same wire protocol as $pe subset). Does not invent connected when attach fails.
 *
 * data-official-source: app.asar h6i / eit / $pe / X5i / jpe / R6i
 */

import {
  createCcrBridgeTransport,
  type BridgeSessionTransport,
  type CreateBridgeTransportArgs,
} from "./sessionsBridgeTransport";

const LOG = "[transport:sdk]";

export type AttachBridgeSessionArgs = {
  sessionId: string;
  ingressToken: string;
  apiBaseUrl: string;
  getAuthToken?: () => string;
  fetchImpl?: typeof fetch;
  onInboundMessage?: (msg: unknown) => void;
  onPermissionResponse?: (msg: unknown) => void;
  onClose?: (code?: number) => void;
};

export type BridgeSessionHandle = {
  sessionId: string;
  isConnected(): boolean;
  write(message: unknown): void | Promise<void>;
  sendControlRequest(message: unknown): void | Promise<void>;
  sendControlResponse(message: unknown): void | Promise<void>;
  sendResult?(): void | Promise<void>;
  reconnectTransport?(opts: {
    ingressToken: string;
    apiBaseUrl?: string;
    epoch?: number;
  }): Promise<void>;
  reportState?(state: unknown): void;
  reportMetadata?(meta: unknown): void;
  reportDelivery?(eventId: string, status: string): void;
  flush?(): Promise<void>;
  close(): void;
};

/**
 * Official eit residual (attachBridgeSession).
 * Product: registerWorker + CCR transport surface under eit handle shape.
 */
export async function attachBridgeSession(
  args: AttachBridgeSessionArgs,
): Promise<BridgeSessionHandle> {
  let ingressToken = args.ingressToken;
  const getAuth = args.getAuthToken ?? (() => ingressToken);
  const apiBase = args.apiBaseUrl.replace(/\/+$/, "");
  // Official X5i registerWorker residual is folded into CCR connect()
  // (createCcrBridgeTransport.connect → registerBridgeWorker + PUT + SSE).
  // Do not pre-register here — double epoch would thrash / 409.

  let closed = false;
  const inner = await createCcrBridgeTransport({
    workSecret: {
      session_ingress_token: ingressToken,
      api_base_url: apiBase,
    },
    sessionId: args.sessionId,
    apiHost: apiBase,
    getAuthToken: getAuth,
    fetchImpl: args.fetchImpl,
  });

  inner.setOnData((raw) => {
    if (closed) return;
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      /* raw frame */
    }
    const msg = parsed as { type?: string; [k: string]: unknown };
    if (msg?.type === "control_response") {
      args.onPermissionResponse?.(parsed);
      return;
    }
    args.onInboundMessage?.(parsed);
  });
  inner.setOnClose((code) => {
    if (closed) return;
    closed = true;
    console.info(
      `[bridge:session] Transport closed session=${args.sessionId} code=${code}`,
    );
    args.onClose?.(code);
  });

  await inner.connect();
  console.info(
    `[bridge:session] Transport connected session=${args.sessionId}`,
  );

  const handle: BridgeSessionHandle = {
    sessionId: args.sessionId,
    isConnected() {
      return !closed && inner.isConnectedStatus?.() === true;
    },
    write(message) {
      if (closed) return;
      void inner.write(message);
    },
    sendControlRequest(message) {
      if (closed) return;
      void inner.write({
        ...(typeof message === "object" && message ? message : {}),
        session_id: args.sessionId,
      });
    },
    sendControlResponse(message) {
      if (closed) return;
      void inner.write({
        ...(typeof message === "object" && message ? message : {}),
        session_id: args.sessionId,
      });
    },
    async reconnectTransport(opts) {
      if (closed) return;
      ingressToken = opts.ingressToken;
      if (inner.reconnectTransport) {
        await inner.reconnectTransport({
          ingressToken: opts.ingressToken,
          apiBaseUrl: opts.apiBaseUrl ?? apiBase,
        });
      }
    },
    reportState(state) {
      if (closed) return;
      inner.reportState?.(state);
    },
    reportMetadata(meta) {
      if (closed) return;
      inner.reportMetadata?.(meta);
    },
    reportDelivery(eventId, status) {
      if (closed) return;
      inner.reportDelivery?.(eventId, status);
    },
    flush() {
      return inner.flush?.() ?? Promise.resolve();
    },
    close() {
      if (closed) return;
      closed = true;
      inner.close();
    },
  };
  return handle;
}

/**
 * Official h6i residual factory — SDK adapter transport wrapping eit attach.
 */
export function createSdkBridgeTransport(
  args: CreateBridgeTransportArgs,
): BridgeSessionTransport {
  const apiBase = args.workSecret.api_base_url || args.apiHost;
  let handle: BridgeSessionHandle | null = null;
  let onData: ((data: string) => void) | null = null;
  let onClose: ((code?: number) => void) | null = null;
  let closed = false;
  let ready = false;

  const transport: BridgeSessionTransport = {
    async connect() {
      console.info(
        `${LOG} attaching SDK bridge session ${args.sessionId} (apiBaseUrl=${apiBase})`,
      );
      let attached: BridgeSessionHandle;
      try {
        attached = await attachBridgeSession({
          sessionId: args.sessionId,
          ingressToken: args.getAuthToken(),
          apiBaseUrl: apiBase,
          getAuthToken: args.getAuthToken,
          fetchImpl: args.fetchImpl,
          onInboundMessage: (msg) => {
            onData?.(JSON.stringify(msg));
          },
          onPermissionResponse: (msg) => {
            onData?.(JSON.stringify(msg));
          },
          onClose: (code) => {
            if (!closed) {
              closed = true;
              if (ready) onClose?.(code);
            }
          },
        });
      } catch (err) {
        closed = true;
        const g = err instanceof Error ? err.message : String(err);
        if (/\b401\b/.test(g) || /authentication/i.test(g)) {
          throw new Error(`registerWorker: HTTP 401 (SDK) ${g}`);
        }
        throw err;
      }
      if (closed) {
        attached.close();
        throw new Error("transport closed during attachBridgeSession");
      }
      handle = attached;
      ready = true;
      console.info(
        `${LOG} attached; handle ready for writes (sessionId=${args.sessionId})`,
      );
    },

    async write(message) {
      if (!ready) throw new Error("write() before transport initialized");
      if (closed || !handle) return { ok: false };
      const a = message as { type?: string };
      if (a?.type === "control_request") {
        handle.sendControlRequest(message);
      } else if (a?.type === "control_response") {
        handle.sendControlResponse(message);
      } else {
        handle.write(message);
      }
      return { ok: true };
    },

    close() {
      closed = true;
      handle?.close();
      handle = null;
    },

    async reconnectTransport(opts) {
      if (!handle || closed) return;
      await handle.reconnectTransport?.({
        ingressToken: opts.ingressToken,
        apiBaseUrl: opts.apiBaseUrl,
      });
    },

    isConnectedStatus() {
      return handle !== null && !closed;
    },

    setOnData(cb) {
      onData = cb;
    },

    setOnClose(cb) {
      onClose = cb;
    },

    reportState(state) {
      handle?.reportState?.(state);
    },

    reportMetadata(meta) {
      if (closed) return;
      handle?.reportMetadata?.(meta);
    },

    reportDelivery(eventId, status) {
      if (closed) return;
      handle?.reportDelivery?.(eventId, status);
    },

    flush() {
      return handle?.flush?.() ?? Promise.resolve();
    },
  };

  return transport;
}
