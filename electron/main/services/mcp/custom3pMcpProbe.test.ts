import { beforeEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn();
const listToolsMock = vi.fn();
const closeMock = vi.fn(async () => undefined);
const getServerVersionMock = vi.fn(() => ({
  name: "mock-mcp",
  version: "1.2.3",
}));

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.0.0-test",
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    connect = connectMock;
    listTools = listToolsMock;
    close = closeMock;
    getServerVersion = getServerVersionMock;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(public url: URL, public opts?: unknown) {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockHTTP {
    constructor(public url: URL, public opts?: unknown) {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => {
  class UnauthorizedError extends Error {
    constructor(message = "Unauthorized") {
      super(message);
      this.name = "UnauthorizedError";
    }
  }
  return { UnauthorizedError };
});

vi.mock("./custom3pMcpOAuthProvider", async () => {
  const actual = await vi.importActual<
    typeof import("./custom3pMcpOAuthProvider")
  >("./custom3pMcpOAuthProvider");
  return {
    ...actual,
    interactiveAuthorize: vi.fn(async () => undefined),
    custom3pMcpSessionFetch: vi.fn(async () => {
      throw new Error("fetch not stubbed");
    }),
  };
});

vi.mock("./custom3pMcpOAuthStore", () => ({
  clearOAuthTokens: vi.fn(),
}));

vi.mock("./headersHelper", () => ({
  resolveHeadersHelper: vi.fn(async () => undefined),
}));

import {
  authorizeAndProbeMcpServer,
  forgetMcpOAuth,
  isBlockedProbeHostname,
  parseProbeServerConfig,
  probeMcpServer,
  safeProbeUrl,
} from "./custom3pMcpProbe";
import { clearOAuthTokens } from "./custom3pMcpOAuthStore";
import {
  interactiveAuthorize,
  NeedsInteractiveAuthError,
  OAUTH_CANCELLED_BY_NEWER,
} from "./custom3pMcpOAuthProvider";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

describe("isBlockedProbeHostname residual Mgr", () => {
  it("blocks link-local IPv4 and metadata", () => {
    expect(isBlockedProbeHostname("169.254.1.1")).toBe(true);
    expect(isBlockedProbeHostname("169.254.169.254")).toBe(true);
  });

  it("blocks IPv6 link-local fe80–febf", () => {
    expect(isBlockedProbeHostname("fe80::1")).toBe(true);
    expect(isBlockedProbeHostname("[fe80::1]")).toBe(true);
    expect(isBlockedProbeHostname("febf::1")).toBe(true);
  });

  it("allows public hostnames and non-link-local IPs", () => {
    expect(isBlockedProbeHostname("mcp.example.com")).toBe(false);
    expect(isBlockedProbeHostname("127.0.0.1")).toBe(false);
    expect(isBlockedProbeHostname("8.8.8.8")).toBe(false);
  });
});

describe("safeProbeUrl residual sy", () => {
  it("redacts username/password", () => {
    expect(safeProbeUrl("https://user:secret@mcp.example/path")).toBe(
      "https://***:***@mcp.example/path",
    );
  });
});

describe("parseProbeServerConfig residual Cot", () => {
  it("rejects missing/invalid url", () => {
    const r = parseProbeServerConfig({ name: "x" });
    expect(r).toMatchObject({
      kind: "err",
      title: "Invalid configuration",
    });
  });

  it("rejects oauth + headers mutual exclusion", () => {
    const r = parseProbeServerConfig({
      name: "x",
      url: "https://mcp.example",
      oauth: { clientId: "c" },
      headers: { Authorization: "Bearer x" },
    });
    expect(r).toMatchObject({
      kind: "err",
      message: "oauth and headers are mutually exclusive",
    });
  });

  it("rejects blocked hostname", () => {
    const r = parseProbeServerConfig({
      name: "meta",
      url: "http://169.254.169.254/mcp",
    });
    expect(r).toMatchObject({
      kind: "err",
      title: "Blocked address",
    });
  });

  it("parses valid config with source mdm default", () => {
    const r = parseProbeServerConfig({
      name: "remote",
      url: "https://mcp.example/sse",
      transport: "sse",
    });
    expect("config" in r).toBe(true);
    if (!("config" in r)) return;
    expect(r.config).toMatchObject({
      name: "remote",
      url: "https://mcp.example/sse",
      transport: "sse",
      source: "mdm",
    });
    expect(r.safeUrl).toContain("https://mcp.example/sse");
  });
});

describe("forgetMcpOAuth residual xv", () => {
  beforeEach(() => {
    vi.mocked(clearOAuthTokens).mockClear();
  });

  it("clears tokens for serverName", () => {
    forgetMcpOAuth("oauth-server");
    expect(clearOAuthTokens).toHaveBeenCalledWith("oauth-server");
  });

  it("validates serverName is non-empty string", () => {
    expect(() => forgetMcpOAuth("")).toThrow(/serverName/);
    expect(() => forgetMcpOAuth(null as unknown as string)).toThrow(
      /serverName/,
    );
    expect(clearOAuthTokens).not.toHaveBeenCalled();
  });
});

describe("probeMcpServer residual Bot", () => {
  beforeEach(() => {
    connectMock.mockReset();
    listToolsMock.mockReset();
    closeMock.mockClear();
    getServerVersionMock.mockReset();
    getServerVersionMock.mockReturnValue({
      name: "mock-mcp",
      version: "1.2.3",
    });
  });

  it("returns Cot err without network for invalid config", async () => {
    await expect(probeMcpServer({ name: "x" })).resolves.toMatchObject({
      kind: "err",
      title: "Invalid configuration",
    });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("returns kind ok with tools after connect + listTools (Eot)", async () => {
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({
      tools: [{ name: "alpha" }, { name: "beta" }],
    });
    const result = await probeMcpServer({
      name: "remote",
      url: "https://mcp.example/mcp",
      transport: "http",
    });
    expect(result).toMatchObject({
      kind: "ok",
      serverName: "mock-mcp",
      serverVersion: "1.2.3",
      transport: "http",
      tools: ["alpha", "beta"],
    });
    if (result.kind === "ok") {
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(connectMock).toHaveBeenCalledOnce();
    expect(listToolsMock).toHaveBeenCalledOnce();
    expect(closeMock).toHaveBeenCalled();
  });

  it("maps UnauthorizedError to kind auth", async () => {
    connectMock.mockRejectedValue(new UnauthorizedError("no token"));
    await expect(
      probeMcpServer({
        name: "authy",
        url: "https://mcp.example",
      }),
    ).resolves.toEqual({ kind: "auth" });
  });

  it("maps NeedsInteractiveAuthError to kind auth", async () => {
    connectMock.mockRejectedValue(new NeedsInteractiveAuthError("authy"));
    await expect(
      probeMcpServer({
        name: "authy",
        url: "https://mcp.example",
        oauth: { clientId: "c" },
      }),
    ).resolves.toEqual({ kind: "auth" });
  });

  it("maps HTTP 401 message to kind auth", async () => {
    connectMock.mockRejectedValue(new Error("HTTP status 401 from server"));
    await expect(
      probeMcpServer({
        name: "authy",
        url: "https://mcp.example",
      }),
    ).resolves.toEqual({ kind: "auth" });
  });

  it("maps connect failure to kind err with request line (lot)", async () => {
    connectMock.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:9"));
    const result = await probeMcpServer({
      name: "down",
      url: "https://mcp.example/path",
      transport: "sse",
    });
    expect(result).toMatchObject({
      kind: "err",
      title: "Connection failed",
      message: "ECONNREFUSED 127.0.0.1:9",
      request: "SSE https://mcp.example/path  →  initialize",
    });
  });

  it("maps status 500 to Server returned 500", async () => {
    const err = Object.assign(new Error("boom"), { status: 500 });
    connectMock.mockRejectedValue(err);
    await expect(
      probeMcpServer({
        name: "bad",
        url: "https://mcp.example",
      }),
    ).resolves.toMatchObject({
      kind: "err",
      title: "Server returned 500",
      code: "500",
    });
  });
});

describe("authorizeAndProbeMcpServer residual Qot", () => {
  beforeEach(() => {
    vi.mocked(interactiveAuthorize).mockClear();
    vi.mocked(interactiveAuthorize).mockResolvedValue(undefined);
    connectMock.mockReset();
    listToolsMock.mockReset();
    closeMock.mockClear();
    getServerVersionMock.mockReturnValue({
      name: "mock-mcp",
      version: "9.9.9",
    });
  });

  it("returns err when oauth not configured (Sgr residual)", async () => {
    await expect(
      authorizeAndProbeMcpServer({
        name: "x",
        url: "https://mcp.example",
      }),
    ).resolves.toMatchObject({
      kind: "err",
      title: "OAuth not configured",
    });
    expect(interactiveAuthorize).not.toHaveBeenCalled();
  });

  it("surfaces interactiveAuthorize failure as Sign-in failed", async () => {
    vi.mocked(interactiveAuthorize).mockRejectedValueOnce(
      new Error("user closed window"),
    );
    await expect(
      authorizeAndProbeMcpServer({
        name: "oauth-server",
        url: "https://mcp.example",
        oauth: { clientId: "c" },
      }),
    ).resolves.toMatchObject({
      kind: "err",
      title: "Sign-in failed",
      message: "user closed window",
    });
  });

  it("maps OAUTH_CANCELLED_BY_NEWER to kind auth", async () => {
    vi.mocked(interactiveAuthorize).mockRejectedValueOnce(
      new Error(OAUTH_CANCELLED_BY_NEWER),
    );
    await expect(
      authorizeAndProbeMcpServer({
        name: "oauth-server",
        url: "https://mcp.example",
        oauth: { clientId: "c" },
      }),
    ).resolves.toEqual({ kind: "auth" });
  });

  it("authorize then probe returns ok (Sgr → Iot)", async () => {
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({ tools: [{ name: "tool-a" }] });
    const result = await authorizeAndProbeMcpServer({
      name: "oauth-server",
      url: "https://mcp.example",
      oauth: { clientId: "c" },
    });
    expect(interactiveAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "oauth-server",
        url: "https://mcp.example",
      }),
    );
    expect(result).toMatchObject({
      kind: "ok",
      tools: ["tool-a"],
      serverName: "mock-mcp",
    });
  });
});
