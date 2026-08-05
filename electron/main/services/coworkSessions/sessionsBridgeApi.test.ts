import { describe, expect, it, vi } from "vitest";
import {
  assertSessionsApiOk,
  createSessionsBridgeApiClient,
  SessionsApiFatalError,
  SESSIONS_BRIDGE_ENVIRONMENTS_BETA,
} from "./sessionsBridgeApi";

describe("sessionsBridgeApi residual (C6i/hR)", () => {
  it("assertSessionsApiOk throws SessionsApiFatalError for 401/403/404/409", () => {
    expect(() => assertSessionsApiOk(401, null, "Registration")).toThrow(
      SessionsApiFatalError,
    );
    expect(() => assertSessionsApiOk(403, { message: "no" }, "Registration")).toThrow(
      /403/,
    );
    expect(() => assertSessionsApiOk(409, { message: "conflict" }, "Registration")).toThrow(
      /409/,
    );
    expect(() => assertSessionsApiOk(404, null, "Poll")).toThrow(/Not found|404/);
  });

  it("assertSessionsApiOk 429 is non-fatal Error", () => {
    expect(() => assertSessionsApiOk(429, null, "Poll")).toThrow(/Rate limited/);
    try {
      assertSessionsApiOk(429, null, "Poll");
    } catch (err) {
      expect(err).not.toBeInstanceOf(SessionsApiFatalError);
    }
  });

  it("registerEnvironment posts bridge body and returns id/secret", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      headers: {
        get: (k: string) =>
          k === "content-type"
            ? "application/json"
            : k === "request-id"
              ? "rid-1"
              : null,
      },
      json: async () => ({
        environment_id: "env-1",
        environment_secret: "sec-1",
      }),
      text: async () => "",
    }));
    const client = createSessionsBridgeApiClient({
      baseUrl: "https://api.example.com/",
      getAccessToken: async () => "tok",
      orgUuid: "org",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      appVersion: "1.2.3",
      workerId: "worker-1",
    });
    const reg = await client.registerEnvironment({
      machineName: "mac",
      directory: "/cowork",
      metadata: { worker_type: "cowork" },
    });
    expect(reg).toEqual({
      environment_id: "env-1",
      environment_secret: "sec-1",
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/environments/bridge");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["anthropic-beta"]).toBe(SESSIONS_BRIDGE_ENVIRONMENTS_BETA);
    expect(JSON.parse(String(init.body))).toMatchObject({
      machine_name: "mac",
      directory: "/cowork",
    });
  });

  it("pollForWork uses environment secret bearer", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      headers: {
        get: (k: string) => (k === "content-type" ? "application/json" : null),
      },
      json: async () => null,
      text: async () => "",
    }));
    const client = createSessionsBridgeApiClient({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => "tok",
      orgUuid: "org",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      appVersion: "0.0.0",
      workerId: "w",
    });
    const work = await client.pollForWork("env1", "env-secret");
    expect(work).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/environments/env1/work/poll");
    expect(url).toContain("ack=true");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer env-secret",
    );
  });

  it("createSession returns id with ccr beta", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      headers: {
        get: (k: string) => (k === "content-type" ? "application/json" : null),
      },
      json: async () => ({ id: "sess-9" }),
      text: async () => "",
    }));
    const client = createSessionsBridgeApiClient({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => "tok",
      orgUuid: "org-u",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      appVersion: "0.0.0",
      workerId: "w",
    });
    const id = await client.createSession("env1", "Dispatch background conversation", [
      "cowork-dispatch-local",
    ]);
    expect(id).toBe("sess-9");
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["anthropic-beta"]).toBe(
      "ccr-byoc-2025-07-29",
    );
    expect((init.headers as Record<string, string>)["x-organization-uuid"]).toBe(
      "org-u",
    );
  });

  it("stopWork posts force body to work stop path", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      headers: {
        get: (k: string) => (k === "content-type" ? "application/json" : null),
      },
      json: async () => ({}),
      text: async () => "",
    }));
    const client = createSessionsBridgeApiClient({
      baseUrl: "https://api.example.com",
      getAccessToken: async () => "tok",
      orgUuid: "org",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      appVersion: "0.0.0",
      workerId: "w",
    });
    await client.stopWork("env1", "work9", true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.example.com/v1/environments/env1/work/work9/stop",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ force: true });
  });
});
