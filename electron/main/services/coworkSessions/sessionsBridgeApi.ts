/**
 * Residual sessions-api client (app.asar C6i / Dm / hR).
 *
 * Endpoints:
 *   POST   /v1/environments/bridge
 *   GET    /v1/environments/{id}/work/poll?ack=true
 *   DELETE /v1/environments/bridge/{id}
 *   POST   /v1/environments/{id}/bridge/reconnect
 *   POST   /v1/sessions
 *
 * Headers residual: Bearer access token, anthropic-version, anthropic-beta=environments-2025-11-01,
 * x-environment-runner-version, Anthropic-Worker-ID; optional X-Trusted-Device-Token.
 *
 * data-official-source: app.asar index.js C6i / Dm / hR / pkA
 */

import { app, net } from "electron";
import { randomUUID } from "node:crypto";

const LOG = "[sessions-api]";

/** Official pkA */
export const SESSIONS_BRIDGE_ENVIRONMENTS_BETA = "environments-2025-11-01";
/** Official createSession beta */
export const SESSIONS_BRIDGE_CREATE_SESSION_BETA = "ccr-byoc-2025-07-29";

export class SessionsApiFatalError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SessionsApiFatalError";
    this.status = status;
  }
}

export type SessionsBridgeApiClient = {
  registerEnvironment: (args: {
    machineName: string;
    directory?: string;
    metadata?: Record<string, unknown>;
    environmentId?: string;
  }) => Promise<{ environment_id: string; environment_secret: string }>;
  pollForWork: (
    environmentId: string,
    environmentSecret: string,
    signal?: AbortSignal,
    ack?: boolean,
  ) => Promise<SessionsBridgeWorkItem | null>;
  deregisterEnvironment: (environmentId: string) => Promise<void>;
  reconnectSession: (environmentId: string, sessionId: string) => Promise<void>;
  createSession: (
    environmentId: string,
    title: string,
    tags?: string[],
  ) => Promise<string>;
  stopWork: (
    environmentId: string,
    workId: string,
    force?: boolean,
  ) => Promise<void>;
};

export type SessionsBridgeWorkItem = {
  id: string;
  secret?: string;
  data?: {
    type?: string;
    id?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type CreateSessionsBridgeApiOptions = {
  baseUrl: string;
  getAccessToken: () => Promise<string>;
  getTrustedDeviceToken?: () => string | null | undefined;
  workerId?: string;
  orgUuid: string;
  /** Inject fetch for tests. Default net.fetch. */
  fetchImpl?: typeof fetch;
  appVersion?: string;
};

function errorMessageFromBody(data: unknown): string | undefined {
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    if (typeof rec.message === "string") return rec.message;
    if (
      rec.error &&
      typeof rec.error === "object" &&
      typeof (rec.error as { message?: unknown }).message === "string"
    ) {
      return (rec.error as { message: string }).message;
    }
  }
  return undefined;
}

/** Official hR */
export function assertSessionsApiOk(
  status: number,
  data: unknown,
  label: string,
  requestId?: string | null,
): void {
  if (status === 200) return;
  const detail = errorMessageFromBody(data);
  const rid = requestId ? ` [request-id: ${requestId}]` : "";
  switch (status) {
    case 401:
      throw new SessionsApiFatalError(
        `${label}: Authentication failed (401)${detail ? `: ${detail}` : ""}${rid}`,
        401,
      );
    case 403:
      throw new SessionsApiFatalError(
        `${label}: Access denied (403)${detail ? `: ${detail}` : ""}${rid}`,
        403,
      );
    case 404:
      throw new SessionsApiFatalError(
        `${detail ?? `${label}: Not found (404)`}${rid}`,
        404,
      );
    case 409:
      throw new SessionsApiFatalError(
        `${label}: Conflict (409)${detail ? `: ${detail}` : ""}${rid}`,
        409,
      );
    case 429:
      throw new Error(
        `${label}: Rate limited (429). Polling too frequently.${rid}`,
      );
    default:
      throw new Error(
        `${label}: Failed with status ${status}${detail ? `: ${detail}` : ""}${rid}`,
      );
  }
}

function requireId(value: string | undefined, label: string): string {
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`${label} is required`);
  }
  return value;
}

export function createSessionsBridgeApiClient(
  options: CreateSessionsBridgeApiOptions,
): SessionsBridgeApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const workerId = options.workerId ?? randomUUID();
  const appVersion =
    options.appVersion ??
    (typeof app?.getVersion === "function" ? app.getVersion() : "0.0.0");
  const fetchImpl =
    options.fetchImpl ??
    ((url: string, init?: RequestInit) =>
      net.fetch(url, { ...init, credentials: "omit" }) as Promise<Response>);

  function authHeaders(token: string): Record<string, string> {
    const trusted = options.getTrustedDeviceToken?.();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": SESSIONS_BRIDGE_ENVIRONMENTS_BETA,
      "x-environment-runner-version": appVersion,
      "Anthropic-Worker-ID": workerId,
      ...(trusted ? { "X-Trusted-Device-Token": trusted } : {}),
    };
  }

  async function withTokenRetry<T>(
    label: string,
    run: (token: string) => Promise<{ status: number; data: unknown; requestId: string | null }>,
  ): Promise<{ status: number; data: unknown; requestId: string | null }> {
    const token1 = await options.getAccessToken();
    const first = await run(token1);
    if (first.status !== 401) return first;
    console.info(`${LOG} ${label}: 401 received, retrying with fresh token`);
    const token2 = await options.getAccessToken();
    const second = await run(token2);
    return second.status !== 401 ? second : first;
  }

  async function request(
    url: string,
    init: RequestInit & { timeout?: number },
  ): Promise<{ status: number; data: unknown; requestId: string | null }> {
    const timeout = init.timeout ?? 15_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const signals: AbortSignal[] = [controller.signal];
    if (init.signal) signals.push(init.signal);
    const signal =
      signals.length === 1
        ? signals[0]
        : AbortSignal.any(signals);
    try {
      const res = await fetchImpl(url, {
        ...init,
        signal,
        credentials: "omit",
      });
      let data: unknown = null;
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
      }
      return {
        status: res.status,
        data,
        requestId: res.headers.get("request-id"),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async registerEnvironment(args) {
      console.info(
        `${LOG} POST /v1/environments/bridge${
          args.environmentId ? ` (reconnect=${args.environmentId})` : ""
        }`,
      );
      const body = {
        machine_name: args.machineName,
        ...(args.directory ? { directory: args.directory } : {}),
        ...(args.metadata ? { metadata: args.metadata } : {}),
        ...(args.environmentId ? { environment_id: args.environmentId } : {}),
      };
      const res = await withTokenRetry("Registration", (token) =>
        request(`${baseUrl}/v1/environments/bridge`, {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify(body),
          timeout: 15_000,
        }),
      );
      assertSessionsApiOk(res.status, res.data, "Registration", res.requestId);
      const data = res.data as {
        environment_id?: string;
        environment_secret?: string;
      } | null;
      if (
        !data ||
        typeof data.environment_id !== "string" ||
        typeof data.environment_secret !== "string"
      ) {
        throw new SessionsApiFatalError(
          "Registration: response missing environment_id/secret",
          res.status,
        );
      }
      console.info(`${LOG} Registered environment: ${data.environment_id}`);
      return {
        environment_id: data.environment_id,
        environment_secret: data.environment_secret,
      };
    },

    async pollForWork(environmentId, environmentSecret, signal, ack = true) {
      requireId(environmentId, "environmentId");
      const url = new URL(
        `${baseUrl}/v1/environments/${environmentId}/work/poll`,
      );
      if (ack) url.searchParams.set("ack", "true");
      const res = await request(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${environmentSecret}`,
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": SESSIONS_BRIDGE_ENVIRONMENTS_BETA,
          "x-environment-runner-version": appVersion,
          "Anthropic-Worker-ID": workerId,
        },
        timeout: 15_000,
        signal,
      });
      assertSessionsApiOk(res.status, res.data, "Poll", res.requestId);
      if (!res.data) return null;
      const work = res.data as SessionsBridgeWorkItem;
      if (work && typeof work === "object") {
        console.info(
          `${LOG} Poll received work: id=${work.id} type=${work.data?.type ?? "?"}${
            work.data?.id ? ` sessionId=${work.data.id}` : ""
          }`,
        );
        return work;
      }
      return null;
    },

    async stopWork(environmentId, workId, force = false) {
      requireId(environmentId, "environmentId");
      requireId(workId, "workId");
      console.info(`${LOG} Stopping work ${workId} force=${force}`);
      const res = await withTokenRetry("StopWork", (token) =>
        request(
          `${baseUrl}/v1/environments/${environmentId}/work/${workId}/stop`,
          {
            method: "POST",
            headers: authHeaders(token),
            body: JSON.stringify({ force: force === true }),
            timeout: 10_000,
          },
        ),
      );
      assertSessionsApiOk(res.status, res.data, "StopWork", res.requestId);
    },

    async deregisterEnvironment(environmentId) {
      requireId(environmentId, "environmentId");
      console.info(`${LOG} Deregistering environment ${environmentId}`);
      const res = await withTokenRetry("Deregister", (token) =>
        request(`${baseUrl}/v1/environments/bridge/${environmentId}`, {
          method: "DELETE",
          headers: authHeaders(token),
          timeout: 10_000,
        }),
      );
      assertSessionsApiOk(res.status, res.data, "Deregister", res.requestId);
      console.info(`${LOG} Environment ${environmentId} deregistered`);
    },

    async reconnectSession(environmentId, sessionId) {
      requireId(environmentId, "environmentId");
      requireId(sessionId, "sessionId");
      console.info(
        `${LOG} Reconnecting session ${sessionId} to environment ${environmentId}`,
      );
      const res = await withTokenRetry("ReconnectSession", (token) =>
        request(
          `${baseUrl}/v1/environments/${environmentId}/bridge/reconnect`,
          {
            method: "POST",
            headers: authHeaders(token),
            body: JSON.stringify({ session_id: sessionId }),
            timeout: 10_000,
          },
        ),
      );
      assertSessionsApiOk(
        res.status,
        res.data,
        "ReconnectSession",
        res.requestId,
      );
    },

    async createSession(environmentId, title, tags) {
      requireId(environmentId, "environmentId");
      console.info(
        `${LOG} POST /v1/sessions (environment_id=${environmentId})`,
      );
      const res = await withTokenRetry("CreateSession", (token) =>
        request(`${baseUrl}/v1/sessions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "anthropic-beta": SESSIONS_BRIDGE_CREATE_SESSION_BETA,
            "anthropic-client-feature": "ccr",
            "x-organization-uuid": options.orgUuid,
            "x-environment-runner-version": appVersion,
          },
          body: JSON.stringify({
            title,
            events: [],
            environment_id: environmentId,
            session_context: { sources: [] },
            tags: tags ?? [],
          }),
          timeout: 15_000,
        }),
      );
      assertSessionsApiOk(res.status, res.data, "CreateSession", res.requestId);
      const id = (res.data as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || !id) {
        throw new SessionsApiFatalError(
          "CreateSession: response missing session id",
          res.status,
        );
      }
      console.info(`${LOG} Session created: ${id}`);
      return id;
    },
  };
}
