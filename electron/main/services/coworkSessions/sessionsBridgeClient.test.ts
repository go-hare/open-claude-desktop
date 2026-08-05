import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  disposeSessionsBridgeClient,
  getSessionsBridgeClient,
  resetSessionsBridgeClientForTests,
  SessionsBridgeClient,
  startSessionsBridgeClient,
} from "./sessionsBridgeClient";
import { SessionsApiFatalError, type SessionsBridgeApiClient } from "./sessionsBridgeApi";
import {
  patchSessionsBridgeStatus,
  resetSessionsBridgeStatusForTests,
  getSessionsBridgeStatusState,
} from "./sessionsBridgeResidual";
import { encodeSessionsBridgeWorkSecretForTests } from "./sessionsBridgeWorkSecret";
import {
  configureSessionsBridgePss,
  resetSessionsBridgePssForTests,
} from "./sessionsBridgePss";
import { SESSIONS_BRIDGE_STALE_TURN_MS } from "./sessionsBridgeConstants";
import {
  emitWakeSchedulerDarkWake,
  listWakeSchedulerClaimIds,
  resetWakeSchedulerClaimsForTests,
} from "../settings/wakeSchedulerClaims";

function tempUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bridge-client-"));
}

function mockApi(overrides: Partial<SessionsBridgeApiClient> = {}): SessionsBridgeApiClient {
  return {
    registerEnvironment: vi.fn(async () => ({
      environment_id: "env-1",
      environment_secret: "sec-1",
    })),
    pollForWork: vi.fn(async () => null),
    deregisterEnvironment: vi.fn(async () => undefined),
    reconnectSession: vi.fn(async () => undefined),
    createSession: vi.fn(async () => "sess-1"),
    stopWork: vi.fn(async () => undefined),
    ...overrides,
  };
}

function mockTransport(connected = true) {
  let onData: ((data: string) => void) | null = null;
  let onClose: ((code?: number) => void) | null = null;
  let closed = false;
  let isConnected = false;
  return {
    connect: vi.fn(async () => {
      if (!connected) throw new Error("SSE HTTP 500");
      isConnected = true;
    }),
    write: vi.fn(async () => ({ ok: true })),
    close: vi.fn((code?: number) => {
      closed = true;
      isConnected = false;
      onClose?.(code);
    }),
    reconnectTransport: vi.fn(async () => undefined),
    isConnectedStatus: vi.fn(() => isConnected && !closed),
    setOnData: vi.fn((cb) => {
      onData = cb;
    }),
    setOnClose: vi.fn((cb) => {
      onClose = cb;
    }),
    reportDelivery: vi.fn(),
    reportState: vi.fn(),
    reportMetadata: vi.fn(),
    flush: vi.fn(async () => undefined),
    /** test helper */
    _emitData(data: string) {
      onData?.(data);
    },
  };
}

describe("SessionsBridgeClient residual (z6i)", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await disposeSessionsBridgeClient();
    resetSessionsBridgeClientForTests();
    resetSessionsBridgeStatusForTests();
    resetSessionsBridgePssForTests();
    resetWakeSchedulerClaimsForTests();
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
    roots.length = 0;
  });

  it("start registers environment, creates session, starts poll loop", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const api = mockApi();
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
    });
    await client.start();
    expect(api.registerEnvironment).toHaveBeenCalled();
    expect(api.createSession).toHaveBeenCalledWith(
      "env-1",
      "Dispatch background conversation",
      ["cowork-dispatch-local"],
    );
    expect(client.getEnvironmentId()).toBe("env-1");
    // poll loop kicked
    await new Promise((r) => setTimeout(r, 30));
    expect(api.pollForWork).toHaveBeenCalled();
    await client.dispose();
  });

  it("409 registration sets conflict status and startFailed", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const api = mockApi({
      registerEnvironment: vi.fn(async () => {
        throw new SessionsApiFatalError(
          "Registration: Conflict (409): already registered on OtherMac.",
          409,
        );
      }),
    });
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
    });
    await client.start();
    expect(client.startFailed).toBe(true);
    const st = getSessionsBridgeStatusState();
    expect(st.conflict).toBe(true);
    expect(st.conflictingMachineName).toBe("OtherMac");
    await client.dispose();
  });

  it("kickPollLoop aborts poll sleep", async () => {
    const userData = tempUserData();
    roots.push(userData);
    let pollCalls = 0;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        pollCalls += 1;
        return null;
      }),
    });
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 60_000,
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 20));
    const before = pollCalls;
    client.kickPollLoop();
    await new Promise((r) => setTimeout(r, 40));
    expect(pollCalls).toBeGreaterThan(before);
    await client.dispose();
  });

  it("singleton start/dispose", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const api = mockApi();
    const c = startSessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
    });
    expect(getSessionsBridgeClient()).toBe(c);
    await disposeSessionsBridgeClient();
    expect(getSessionsBridgeClient()).toBeNull();
  });

  it("patchSessionsBridgeStatus rejects invent keys", () => {
    patchSessionsBridgeStatus({
      conflict: true,
      // @ts-expect-error invent key must be stripped
      status: "ready",
      reason: "x",
      enabled: true,
    } as never);
    const st = getSessionsBridgeStatusState();
    expect(st.conflict).toBe(true);
    expect("status" in st).toBe(false);
    expect("reason" in st).toBe(false);
    expect("enabled" in st).toBe(false);
  });

  it("handleSessionWork decode fail → stopWork(force) and no activeSessions", async () => {
    const userData = tempUserData();
    roots.push(userData);
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-bad",
          secret: "not-valid-base64url!!!",
          data: { type: "session", id: "remote-bad" },
        };
      }),
    });
    const onSessionWork = vi.fn();
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      onSessionWork,
      createTransport: vi.fn(async () => mockTransport() as never),
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 40));
    expect(api.stopWork).toHaveBeenCalledWith("env-1", "work-bad", true);
    expect(client.getActiveSessionCount()).toBe(0);
    expect(onSessionWork).not.toHaveBeenCalled();
    await client.dispose();
  });

  it("handleSessionWork success → activeSessions + transport connect", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-1",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transport = mockTransport(true);
    const createTransport = vi.fn(async () => transport as never);
    const onSessionWork = vi.fn();
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-1",
          secret,
          data: { type: "session", id: "remote-1" },
        };
      }),
    });
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      onSessionWork,
      createTransport,
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 60));
    expect(createTransport).toHaveBeenCalled();
    expect(transport.connect).toHaveBeenCalled();
    expect(client.getActiveSessionCount()).toBe(1);
    const active = client.getActiveSession("remote-1");
    expect(active?.workId).toBe("work-1");
    expect(active?.localSessionId).toBe("local_ditto_org");
    expect(active?.workSecret.session_ingress_token).toBe("ingress-1");
    expect(onSessionWork).toHaveBeenCalled();
    expect(api.stopWork).not.toHaveBeenCalled();
    await client.dispose();
    expect(transport.close).toHaveBeenCalled();
    expect(client.getActiveSessionCount()).toBe(0);
  });

  it("handleSessionWork transport connect fail → stopWork and clear session", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-2",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-fail",
          secret,
          data: { type: "session", id: "remote-fail" },
        };
      }),
    });
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      createTransport: vi.fn(async () => mockTransport(false) as never),
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 60));
    expect(api.stopWork).toHaveBeenCalledWith("env-1", "work-fail", true);
    expect(client.getActiveSessionCount()).toBe(0);
    await client.dispose();
  });

  it("duplicate work with same token is ignored when transport active", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "same-token",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transport = mockTransport(true);
    const createTransport = vi.fn(async () => transport as never);
    let n = 0;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        n += 1;
        if (n > 2) return null;
        return {
          id: `work-${n}`,
          secret,
          data: { type: "session", id: "remote-dup" },
        };
      }),
    });
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 20,
      createTransport,
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 80));
    expect(client.getActiveSessionCount()).toBe(1);
    // first work connects once; duplicate does not invent second transport
    expect(createTransport).toHaveBeenCalledTimes(1);
    await client.dispose();
  });

  it("transport close schedules reconnectSessionTransport", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-rc",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transports: ReturnType<typeof mockTransport>[] = [];
    const createTransport = vi.fn(async () => {
      const t = mockTransport(true);
      transports.push(t);
      return t as never;
    });
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-rc",
          secret,
          data: { type: "session", id: "remote-rc" },
        };
      }),
    });
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      createTransport,
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 60));
    expect(createTransport).toHaveBeenCalledTimes(1);
    // Simulate permanent close → official reconnect
    transports[0]!.close(4092);
    await new Promise((r) => setTimeout(r, 40));
    expect(createTransport).toHaveBeenCalledTimes(2);
    const active = client.getActiveSession("remote-rc");
    expect(active?.transportReconnectAttempts).toBeGreaterThanOrEqual(1);
    await client.dispose();
  });

  it("reconnect cap triggers redispatchSession via reconnectSession API", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-cap",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    // First connect succeeds; subsequent reconnects fail so attempts climb
    let connectN = 0;
    const createTransport = vi.fn(async () => {
      connectN += 1;
      if (connectN === 1) return mockTransport(true) as never;
      return mockTransport(false) as never;
    });
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-cap",
          secret,
          data: { type: "session", id: "remote-cap" },
        };
      }),
    });
    const track = vi.fn();
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      createTransport,
      track,
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 50));
    const active = client.getActiveSession("remote-cap");
    expect(active).toBeTruthy();
    // Force attempts to max so next reconnect path redispatches
    if (active) {
      active.transportReconnectAttempts = 6;
      active.transport?.close(4092);
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(api.reconnectSession).toHaveBeenCalled();
    // Official analytics residual names
    const trackEvents = track.mock.calls.map((c) => c[0]);
    expect(trackEvents).toContain("lam_bridge_transport_reconnect_capped");
    expect(trackEvents).toContain("lam_bridge_transport_cap_redispatch");
    await client.dispose();
  });

  it("schedules ingress token refresh when exp claim present", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const header = Buffer.from(JSON.stringify({ alg: "none" }), "utf8").toString(
      "base64url",
    );
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(JSON.stringify({ exp }), "utf8").toString(
      "base64url",
    );
    const jwt = `sk-ant-si-${header}.${payload}.sig`;
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: jwt,
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-ing",
          secret,
          data: { type: "session", id: "remote-ing" },
        };
      }),
    });
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      createTransport: vi.fn(async () => mockTransport(true) as never),
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 50));
    const active = client.getActiveSession("remote-ing");
    expect(active?.ingressTokenRefreshTimer).not.toBeNull();
    await client.dispose();
    expect(client.getActiveSession("remote-ing")).toBeUndefined();
  });

  it("writeDispatchSeedMessages writes seeds + idle once after connect", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-seed",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transport = mockTransport(true);
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-seed",
          secret,
          data: { type: "session", id: "remote-seed" },
        };
      }),
    });
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      createTransport: vi.fn(async () => transport as never),
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 80));
    // Flush writeQueue
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 40));
    const active = client.getActiveSession("remote-seed");
    expect(active?.seedMessagesWritten).toBe(true);
    // at least one seed assistant + idle result
    expect(transport.write.mock.calls.length).toBeGreaterThanOrEqual(2);
    const payloads = transport.write.mock.calls.map((c) => c[0] as { type?: string });
    expect(payloads.some((p) => p.type === "assistant")).toBe(true);
    expect(payloads.some((p) => p.type === "result")).toBe(true);
    const writesBefore = transport.write.mock.calls.length;
    // Second connect path would skip — seedMessagesWritten stays true
    expect(active?.seedMessagesWritten).toBe(true);
    await client.dispose();
    expect(writesBefore).toBeGreaterThanOrEqual(2);
  });

  it("inbound user uuid replay → processed ack only", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-user",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transport = mockTransport(true);
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-user",
          secret,
          data: { type: "session", id: "remote-user" },
        };
      }),
    });
    const onRemoteSessionStart = vi.fn();
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      onRemoteSessionStart,
      createTransport: vi.fn(async () => transport as never),
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 60));
    // Clear bind-time remote_session_start emit (handleSessionWork residual)
    onRemoteSessionStart.mockClear();
    const userMsg = {
      type: "user",
      uuid: "msg-uuid-1",
      message: { content: [{ type: "text", text: "hello bridge" }] },
    };
    transport._emitData(JSON.stringify(userMsg));
    await new Promise((r) => setTimeout(r, 30));
    expect(onRemoteSessionStart).toHaveBeenCalledTimes(1);
    expect(onRemoteSessionStart.mock.calls[0]![0]).toMatchObject({
      message: "hello bridge",
      messageUuid: "msg-uuid-1",
      remoteSessionId: "remote-user",
      sessionType: "agent",
      channel: "sessions_api",
    });
    expect(transport.reportDelivery).toHaveBeenCalledWith(
      "msg-uuid-1",
      "processing",
    );
    // Replay same uuid
    onRemoteSessionStart.mockClear();
    transport._emitData(JSON.stringify(userMsg));
    await new Promise((r) => setTimeout(r, 20));
    expect(onRemoteSessionStart).not.toHaveBeenCalled();
    expect(transport.reportDelivery).toHaveBeenCalledWith(
      "msg-uuid-1",
      "processed",
    );
    await client.dispose();
  });

  it("interrupt control_request → sessionManager.interruptTurn", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-int",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transport = mockTransport(true);
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-int",
          secret,
          data: { type: "session", id: "remote-int" },
        };
      }),
    });
    const interruptTurn = vi.fn(async () => undefined);
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      createTransport: vi.fn(async () => transport as never),
      sessionManager: {
        hasSession: () => true,
        interruptTurn,
      },
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 60));
    transport._emitData(
      JSON.stringify({
        type: "control_request",
        request_id: "req-int-1",
        request: { subtype: "interrupt" },
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(interruptTurn).toHaveBeenCalledWith("local_ditto_org");
    await client.dispose();
  });

  it("control_response resolves pending permission + echoes", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-cr",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transport = mockTransport(true);
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-cr",
          secret,
          data: { type: "session", id: "remote-cr" },
        };
      }),
    });
    const resolvePendingPermission = vi.fn();
    const track = vi.fn();
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      createTransport: vi.fn(async () => transport as never),
      sessionManager: { resolvePendingPermission },
      track,
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 60));
    // Non-interrupt control_request parks permission
    transport._emitData(
      JSON.stringify({
        type: "control_request",
        request_id: "req-perm-1",
        request: { subtype: "can_use_tool", tool_name: "Bash" },
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(track).toHaveBeenCalledWith(
      "lam_bridge_permission_posted",
      expect.objectContaining({ request_id: "req-perm-1", tool_name: "Bash" }),
    );
    transport.write.mockClear();
    transport.reportState.mockClear();
    transport._emitData(
      JSON.stringify({
        type: "control_response",
        response: {
          request_id: "req-perm-1",
          response: { behavior: "allow" },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(resolvePendingPermission).toHaveBeenCalledWith(
      "req-perm-1",
      expect.objectContaining({ behavior: "allow" }),
    );
    // Echo via writeQueue
    await new Promise((r) => setTimeout(r, 20));
    const echo = transport.write.mock.calls
      .map((c) => c[0] as { type?: string; response?: { request_id?: string } })
      .find((p) => p.type === "control_response");
    expect(echo?.response?.request_id).toBe("req-perm-1");
    expect(track).toHaveBeenCalledWith(
      "lam_bridge_permission_resolved",
      expect.objectContaining({
        tool_name: "Bash",
        behavior: "allow",
      }),
    );
    // restoreRunning → idle (no pendingTurns after permission-only)
    expect(transport.reportState).toHaveBeenCalledWith(
      expect.objectContaining({ worker_status: "idle" }),
    );
    await client.dispose();
  });

  it("transport close → autoDeny drains pending permissions", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-ad",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transport = mockTransport(true);
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-ad",
          secret,
          data: { type: "session", id: "remote-ad" },
        };
      }),
    });
    const resolvePendingPermission = vi.fn();
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      createTransport: vi.fn(async () => transport as never),
      sessionManager: { resolvePendingPermission },
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 60));
    transport._emitData(
      JSON.stringify({
        type: "control_request",
        request_id: "req-deny-1",
        request: { subtype: "can_use_tool", tool_name: "Bash" },
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    // Permanent close triggers autoDeny + reconnect
    transport.close(4092);
    await new Promise((r) => setTimeout(r, 40));
    expect(resolvePendingPermission).toHaveBeenCalledWith(
      "req-deny-1",
      expect.objectContaining({
        behavior: "deny",
        reason: "transport_closed",
      }),
    );
    await client.dispose();
  });

  it("fast-path sendMessage when sessionManager.hasSession", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-fp",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transport = mockTransport(true);
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-fp",
          secret,
          data: { type: "session", id: "remote-fp" },
        };
      }),
    });
    const sendMessage = vi.fn(async () => undefined);
    const onRemoteSessionStart = vi.fn();
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      onRemoteSessionStart,
      createTransport: vi.fn(async () => transport as never),
      sessionManager: {
        hasSession: () => true,
        sendMessage,
      },
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 60));
    // Clear bind-time remote_session_start emit
    onRemoteSessionStart.mockClear();
    transport._emitData(
      JSON.stringify({
        type: "user",
        uuid: "msg-fp-1",
        message: { content: "fast path text" },
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(sendMessage).toHaveBeenCalledWith(
      "local_ditto_org",
      "fast path text",
      undefined,
      undefined,
      "msg-fp-1",
    );
    // Fast path must not emit remote_session_start for the user message
    expect(onRemoteSessionStart).not.toHaveBeenCalled();
    await client.dispose();
  });

  it("inbound user → PSS hold + reportState(running) + seedWebFetchProvenance", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-pss",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transport = mockTransport(true);
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-pss",
          secret,
          data: { type: "session", id: "remote-pss" },
        };
      }),
    });
    configureSessionsBridgePss({
      powerSaveStart: vi.fn(() => 55),
      powerSaveStop: vi.fn(),
      powerSaveIsStarted: () => true,
    });
    const seedWebFetchProvenance = vi.fn();
    const sendMessage = vi.fn(async () => undefined);
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      createTransport: vi.fn(async () => transport as never),
      sessionManager: {
        hasSession: () => true,
        sendMessage,
        seedWebFetchProvenance,
      },
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 60));
    transport.reportState.mockClear();
    transport._emitData(
      JSON.stringify({
        type: "user",
        uuid: "msg-pss-1",
        message: {
          content: "please fetch https://example.com/docs",
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 40));
    const active = client.getActiveSession("remote-pss");
    expect(active?.heldPSSAssertions).toContain(55);
    expect(active?.pendingTurns).toBeGreaterThanOrEqual(1);
    expect(active?.staleTurnTimer).not.toBeNull();
    expect(transport.reportState).toHaveBeenCalledWith(
      expect.objectContaining({ worker_status: "running" }),
    );
    expect(seedWebFetchProvenance).toHaveBeenCalledWith(
      "local_ditto_org",
      "please fetch https://example.com/docs",
    );
    expect(sendMessage).toHaveBeenCalled();
    await client.dispose();
  });

  it("stale turn re-arms when permission outstanding", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-stale",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transport = mockTransport(true);
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-stale",
          secret,
          data: { type: "session", id: "remote-stale" },
        };
      }),
    });
    configureSessionsBridgePss({
      powerSaveStart: vi.fn(() => 9),
      powerSaveStop: vi.fn(),
      powerSaveIsStarted: () => true,
    });
    const STALE_MS = 80;
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 60_000,
      staleTurnMs: STALE_MS,
      createTransport: vi.fn(async () => transport as never),
      sessionManager: {
        resolvePendingPermission: vi.fn(),
      },
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 60));
    // Park a non-external permission so hasOutstandingPermissions re-arms
    transport._emitData(
      JSON.stringify({
        type: "control_request",
        request_id: "req-stale-perm",
        request: { subtype: "can_use_tool", tool_name: "Bash" },
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    // Drive a user turn so pendingTurns > 0 + stale timer armed
    transport._emitData(
      JSON.stringify({
        type: "user",
        uuid: "msg-stale-1",
        message: { content: "stale check" },
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    const before = client.getActiveSession("remote-stale");
    expect(before?.pendingTurns).toBeGreaterThanOrEqual(1);
    expect(before?.staleTurnTimer).not.toBeNull();
    // Fire short L6i inject — should re-arm (not idle/reset) because permission pending
    await new Promise((r) => setTimeout(r, STALE_MS + 40));
    const after = client.getActiveSession("remote-stale");
    expect(after?.pendingTurns).toBeGreaterThanOrEqual(1);
    expect(after?.staleTurnTimer).not.toBeNull();
    // reportState must not have been forced to idle by stale reset
    const idleCalls = transport.reportState.mock.calls.filter(
      (c) =>
        c[0] &&
        typeof c[0] === "object" &&
        (c[0] as { worker_status?: string }).worker_status === "idle",
    );
    expect(idleCalls.length).toBe(0);
    // Sanity: production default still exported (L6i)
    expect(SESSIONS_BRIDGE_STALE_TURN_MS).toBe(5 * 60_000);
    await client.dispose();
  });

  it("inbound user with file_attachments prefixes paths on fast-path sendMessage", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const secret = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "ingress-att",
      api_base_url: "https://api.example.com",
      use_code_sessions: true,
    });
    const transport = mockTransport(true);
    let polled = false;
    const api = mockApi({
      pollForWork: vi.fn(async () => {
        if (polled) return null;
        polled = true;
        return {
          id: "work-att",
          secret,
          data: { type: "session", id: "remote-att" },
        };
      }),
    });
    // Mock download via global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(Buffer.from("file-bytes"), { status: 200 });
    }) as typeof fetch;
    try {
      const sendMessage = vi.fn(async () => undefined);
      const client = new SessionsBridgeClient({
        orgUuid: "org-att",
        accountUuid: "acct",
        apiHost: "https://api.example.com",
        getOAuthToken: async () => "tok",
        apiClient: api,
        userDataDir: userData,
        pollIntervalMs: 50,
        createTransport: vi.fn(async () => transport as never),
        sessionManager: {
          hasSession: () => true,
          sendMessage,
        },
      });
      await client.start();
      await new Promise((r) => setTimeout(r, 60));
      transport._emitData(
        JSON.stringify({
          type: "user",
          uuid: "msg-att-1",
          message: { content: "see file" },
          file_attachments: [
            { file_uuid: "deadbeef-0001", file_name: "spec.md" },
          ],
        }),
      );
      await new Promise((r) => setTimeout(r, 80));
      expect(sendMessage).toHaveBeenCalled();
      const [localId, text, _img, files] = sendMessage.mock.calls[0]!;
      expect(localId).toBe("local_ditto_org-att");
      expect(String(text)).toMatch(/^@"[^"]+spec\.md" see file$/);
      expect(Array.isArray(files)).toBe(true);
      expect((files as string[])[0]).toContain("deadbeef-spec.md");
      expect(fs.existsSync((files as string[])[0]!)).toBe(true);
      await client.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("registration tracks completed + registers bridge-poll claim; dispose unregisters", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const events: string[] = [];
    const resumeListeners: Array<() => void> = [];
    const api = mockApi();
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      track: (event) => {
        events.push(event);
      },
      powerMonitor: {
        on: (event, listener) => {
          if (event === "resume") resumeListeners.push(listener);
        },
        off: (event, listener) => {
          if (event === "resume") {
            const i = resumeListeners.indexOf(listener);
            if (i >= 0) resumeListeners.splice(i, 1);
          }
        },
        isOnBatteryPower: () => false,
      },
    });
    await client.start();
    expect(events).toContain("lam_bridge_registration_completed");
    expect(events).toContain("lam_bridge_session_created");
    expect(listWakeSchedulerClaimIds()).toContain("bridge-poll");
    await client.dispose();
    expect(listWakeSchedulerClaimIds()).not.toContain("bridge-poll");
  });

  it("409 registration tracks registration_failed", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const events: Array<{ e: string; p?: Record<string, unknown> }> = [];
    const api = mockApi({
      registerEnvironment: vi.fn(async () => {
        throw new SessionsApiFatalError(
          "Registration: Conflict (409): already registered on OtherMac.",
          409,
        );
      }),
    });
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      track: (e, p) => events.push({ e, p }),
    });
    await client.start();
    expect(events.some((x) => x.e === "lam_bridge_registration_failed")).toBe(
      true,
    );
    const failed = events.find((x) => x.e === "lam_bridge_registration_failed");
    expect(failed?.p?.status).toBe(409);
    expect(failed?.p?.permanent).toBe(true);
    await client.dispose();
  });

  it("handleSystemResumed tracks system_resumed and restarts when permanently failed", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const events: string[] = [];
    let registerCalls = 0;
    const api = mockApi({
      registerEnvironment: vi.fn(async () => {
        registerCalls += 1;
        if (registerCalls === 1) {
          throw new SessionsApiFatalError(
            "Registration: Conflict (409): already registered on OtherMac.",
            409,
          );
        }
        return {
          environment_id: "env-1",
          environment_secret: "sec-1",
        };
      }),
    });
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      track: (e) => events.push(e),
      powerMonitor: {
        on: () => undefined,
        off: () => undefined,
        isOnBatteryPower: () => false,
      },
    });
    await client.start();
    expect(client.startFailed).toBe(true);
    await client.handleSystemResumed("resume");
    expect(events).toContain("lam_bridge_system_resumed");
    await new Promise((r) => setTimeout(r, 40));
    expect(registerCalls).toBeGreaterThanOrEqual(2);
    await client.dispose();
  });

  it("darkwake emitter triggers system_resumed via bound listener", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const events: string[] = [];
    const api = mockApi();
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      track: (e) => events.push(e),
      powerMonitor: {
        on: () => undefined,
        off: () => undefined,
      },
    });
    await client.start();
    events.length = 0;
    emitWakeSchedulerDarkWake();
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toContain("lam_bridge_system_resumed");
    await client.dispose();
  });

  it("reconnect persisted session tracks reconnect_persisted_session", async () => {
    const userData = tempUserData();
    roots.push(userData);
    const events: string[] = [];
    // Seed official bridge-state.json keyed org:account with remoteSessionId
    const statePath = path.join(userData, "bridge-state.json");
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        "org:acct": {
          enabled: true,
          userConsented: true,
          environmentId: "env-prior",
          remoteSessionId: "remote-persisted",
        },
      }),
      "utf8",
    );
    const api = mockApi({
      registerEnvironment: vi.fn(async () => ({
        environment_id: "env-prior",
        environment_secret: "sec-1",
      })),
      reconnectSession: vi.fn(async () => undefined),
    });
    const client = new SessionsBridgeClient({
      orgUuid: "org",
      accountUuid: "acct",
      apiHost: "https://api.example.com",
      getOAuthToken: async () => "tok",
      apiClient: api,
      userDataDir: userData,
      pollIntervalMs: 50,
      track: (e) => events.push(e),
    });
    await client.start();
    expect(api.reconnectSession).toHaveBeenCalledWith(
      "env-prior",
      "remote-persisted",
    );
    expect(events).toContain("lam_bridge_reconnect_persisted_session");
    expect(events).not.toContain("lam_bridge_session_created");
    await client.dispose();
  });
});
