import { describe, expect, it, vi } from "vitest";
import {
  createCcrBridgeTransport,
  createSessionsBridgeTransport,
  registerBridgeWorker,
  sessionsBridgeSessionUrl,
} from "./sessionsBridgeTransport";
import { encodeSessionsBridgeWorkSecretForTests } from "./sessionsBridgeWorkSecret";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
    body: null,
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

describe("sessionsBridgeTransport residual (N6i / I6i / M6i)", () => {
  it("sessionsBridgeSessionUrl builds N6i path", () => {
    expect(sessionsBridgeSessionUrl("https://api.example.com/", "sess/1")).toBe(
      "https://api.example.com/v1/code/sessions/sess%2F1",
    );
  });

  it("registerBridgeWorker returns worker_epoch", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ worker_epoch: 7 }));
    const epoch = await registerBridgeWorker(
      "https://api.example.com/v1/code/sessions/s1",
      () => "tok",
      fetchImpl as unknown as typeof fetch,
    );
    expect(epoch).toBe(7);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/worker/register");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
  });

  it("registerBridgeWorker rejects invalid epoch", async () => {
    // Both attempts return invalid epoch so retry path still fails honestly
    const fetchImpl = vi.fn(async () => jsonResponse({ worker_epoch: "nope" }));
    await expect(
      registerBridgeWorker(
        "https://api.example.com/v1/code/sessions/s1",
        () => "tok",
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/invalid worker_epoch/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  }, 8_000);

  it("createCcrBridgeTransport register + put worker + SSE connect", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/worker/register")) {
        return jsonResponse({ worker_epoch: 3 });
      }
      if (url.endsWith("/worker") && init?.method === "PUT") {
        return jsonResponse({});
      }
      if (url.includes("/worker/events/stream")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({}),
          body: null,
          headers: new Headers({ "content-type": "text/event-stream" }),
        } as unknown as Response;
      }
      // POST /worker/events and delivery acks
      if (url.includes("/worker/events")) {
        return jsonResponse({});
      }
      return jsonResponse({}, 500);
    });

    const secret = {
      version: 1 as const,
      session_ingress_token: "ingress",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    };
    const transport = await createCcrBridgeTransport({
      workSecret: secret,
      sessionId: "remote-1",
      apiHost: "https://api.example.com",
      getAuthToken: () => "ingress",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await transport.connect();
    expect(transport.isConnectedStatus?.()).toBe(true);
    expect(calls.some((c) => c.includes("/worker/register"))).toBe(true);
    expect(calls.some((c) => c.startsWith("PUT ") && c.includes("/worker"))).toBe(
      true,
    );
    expect(
      calls.some((c) => c.includes("/worker/events/stream")),
    ).toBe(true);

    const writeOk = await transport.write({ type: "pong" });
    expect(writeOk.ok).toBe(true);
    expect(
      calls.some(
        (c) => c.startsWith("POST ") && c.includes("/worker/events"),
      ),
    ).toBe(true);

    transport.close();
    expect(transport.isConnectedStatus?.()).toBe(false);
  });

  it("connect fails when registerWorker fails (no invent connected)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "no" }, 401));
    const transport = await createCcrBridgeTransport({
      workSecret: {
        version: 1,
        session_ingress_token: "t",
        api_base_url: "https://api.example.com",
      },
      sessionId: "s",
      apiHost: "https://api.example.com",
      getAuthToken: () => "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(transport.connect()).rejects.toThrow(/registerWorker|HTTP 401/);
    expect(transport.isConnectedStatus?.()).toBe(false);
  }, 8_000);

  it("createSessionsBridgeTransport uses h6i SDK residual when R6i feature on", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/worker/register")) {
        return jsonResponse({ worker_epoch: 1 });
      }
      if (url.endsWith("/worker") && init?.method === "PUT") {
        return jsonResponse({});
      }
      if (url.includes("/worker/events/stream")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({}),
          body: null,
          headers: new Headers({ "content-type": "text/event-stream" }),
        } as unknown as Response;
      }
      return jsonResponse({});
    });
    const transport = await createSessionsBridgeTransport({
      workSecret: {
        version: 1,
        session_ingress_token: "t",
        api_base_url: "https://api.example.com",
      },
      sessionId: "s",
      apiHost: "https://api.example.com",
      getAuthToken: () => "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isSdkAdapterFeatureEnabled: () => true,
    });
    await transport.connect();
    // Official M6i: R6i on → h6i (SDK adapter), not CCR-only honesty path
    expect(
      info.mock.calls.some((c) => String(c[0]).includes("using SDK adapter")),
    ).toBe(true);
    expect(
      info.mock.calls.some((c) => String(c[0]).includes("attaching SDK bridge")),
    ).toBe(true);
    expect(transport.isConnectedStatus?.()).toBe(true);
    // Single register residual (no double X5i + connect register)
    expect(
      fetchImpl.mock.calls.filter((c) =>
        String(c[0]).endsWith("/worker/register"),
      ),
    ).toHaveLength(1);
    transport.close();
    info.mockRestore();
  });

  it("createSessionsBridgeTransport h6i attach fail does not invent connected", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "no" }, 401));
    const transport = await createSessionsBridgeTransport({
      workSecret: {
        version: 1,
        session_ingress_token: "t",
        api_base_url: "https://api.example.com",
      },
      sessionId: "s",
      apiHost: "https://api.example.com",
      getAuthToken: () => "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isSdkAdapterFeatureEnabled: () => true,
    });
    await expect(transport.connect()).rejects.toThrow(
      /registerWorker|HTTP 401|401/,
    );
    expect(transport.isConnectedStatus?.()).toBe(false);
  }, 8_000);

  it("createSessionsBridgeTransport uses h6i inject override when R6i on + inject present", async () => {
    const inject = vi.fn(async () => {
      return {
        connect: vi.fn(async () => undefined),
        write: vi.fn(async () => ({ ok: true })),
        close: vi.fn(),
        setOnData: vi.fn(),
        setOnClose: vi.fn(),
        isConnectedStatus: () => true,
      };
    });
    const transport = await createSessionsBridgeTransport({
      workSecret: {
        version: 1,
        session_ingress_token: "t",
        api_base_url: "https://api.example.com",
      },
      sessionId: "s",
      apiHost: "https://api.example.com",
      getAuthToken: () => "t",
      isSdkAdapterFeatureEnabled: () => true,
      createSdkAdapterTransport: inject,
    });
    expect(inject).toHaveBeenCalledTimes(1);
    expect(transport.isConnectedStatus?.()).toBe(true);
  });

  it("createSessionsBridgeTransport ignores inject when R6i off", async () => {
    const inject = vi.fn(async () => {
      throw new Error("should not be called");
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/worker/register")) {
        return jsonResponse({ worker_epoch: 1 });
      }
      if (url.endsWith("/worker") && init?.method === "PUT") {
        return jsonResponse({});
      }
      if (url.includes("/worker/events/stream")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({}),
          body: null,
          headers: new Headers({ "content-type": "text/event-stream" }),
        } as unknown as Response;
      }
      return jsonResponse({});
    });
    const transport = await createSessionsBridgeTransport({
      workSecret: {
        version: 1,
        session_ingress_token: "t",
        api_base_url: "https://api.example.com",
      },
      sessionId: "s",
      apiHost: "https://api.example.com",
      getAuthToken: () => "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isSdkAdapterFeatureEnabled: () => false,
      createSdkAdapterTransport: inject,
    });
    await transport.connect();
    expect(inject).not.toHaveBeenCalled();
    expect(transport.isConnectedStatus?.()).toBe(true);
    transport.close();
  });
});
