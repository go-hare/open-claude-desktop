import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("./custom3pMcpOAuthProvider", async () => {
  const actual = await vi.importActual<
    typeof import("./custom3pMcpOAuthProvider")
  >("./custom3pMcpOAuthProvider");
  class NeedsInteractiveAuthError extends Error {
    serverName: string;
    constructor(serverName: string) {
      super(`${serverName}: OAuth needs interactive authorization (no cached tokens)`);
      this.name = "NeedsInteractiveAuthError";
      this.serverName = serverName;
    }
  }
  return {
    ...actual,
    NeedsInteractiveAuthError,
    clearOAuthTokens: vi.fn(),
    probeOAuthCached: vi.fn(async (config: { name: string }) => {
      throw new NeedsInteractiveAuthError(config.name);
    }),
    authorizeAndGetBearerHeaders: vi.fn(async () => {
      throw new Error("authorize not stubbed");
    }),
    oauthBearerHeaders: vi.fn(() => {
      throw new Error("no token");
    }),
  };
});

vi.mock("./headersHelper", () => ({
  resolveHeadersHelper: vi.fn(async () => undefined),
}));

vi.mock("./orgPluginMcpScan", () => ({
  managedMcpServersFromEnterprise: vi.fn(() => []),
  mergePluginMcpConfigs: <T,>(a: T[], b: T[]) => [...a, ...b],
  scanOrgPluginMcpServers: vi.fn(async () => []),
}));

import {
  normalizeDirectMcpDescriptors,
  DirectMcpConnectionManager,
  resetDirectMcpConnectionManagerForTests,
  descriptorIdentity,
  applyOAuthAuthExclusion,
} from "./directMcpConnectionManager";
import { clearOAuthTokens } from "./custom3pMcpOAuthProvider";

describe("normalizeDirectMcpDescriptors", () => {
  it("keeps only http(s) url remotes", () => {
    const list = normalizeDirectMcpDescriptors({
      remote: { url: "https://mcp.example/sse", transport: "sse" },
      stdio: { command: "npx", args: ["-y", "foo"] },
      bad: { url: "file:///tmp/x" },
      named: { name: "Custom", url: "http://127.0.0.1:9/mcp" },
    });
    expect(list.map((d) => d.name).sort()).toEqual(["Custom", "remote"]);
    expect(list.find((d) => d.name === "remote")?.transport).toBe("sse");
  });

  it("reads nested config bag and headersHelper", () => {
    const list = normalizeDirectMcpDescriptors({
      nested: {
        config: {
          url: "https://a.example",
          headers: { a: "1" },
          headersHelper: "/usr/bin/h",
        },
      },
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.headers).toEqual({ a: "1" });
    expect(list[0]?.headersHelper).toBe("/usr/bin/h");
  });

  it("JLA: drops headers/headersHelper when oauth present", () => {
    const list = normalizeDirectMcpDescriptors({
      both: {
        url: "https://mcp.example",
        oauth: { clientId: "c" },
        headers: { Authorization: "Bearer x" },
        headersHelper: "/usr/bin/h",
      },
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.oauth).toEqual({ clientId: "c" });
    expect(list[0]?.headers).toBeUndefined();
    expect(list[0]?.headersHelper).toBeUndefined();
  });
});

describe("descriptorIdentity residual u_", () => {
  it("is stable for same oauth bag", () => {
    const a = {
      name: "g",
      url: "https://x",
      oauth: { clientId: "c" },
    };
    expect(descriptorIdentity(a)).toBe(descriptorIdentity({ ...a }));
  });

  it("changes when transport or headers change", () => {
    const base = {
      name: "g",
      url: "https://x",
      transport: "sse",
      oauth: { clientId: "c" },
      headers: { a: "1" },
    };
    expect(descriptorIdentity(base)).not.toBe(
      descriptorIdentity({ ...base, transport: "http" }),
    );
    expect(descriptorIdentity(base)).not.toBe(
      descriptorIdentity({ ...base, headers: { a: "2" } }),
    );
    // residual u_ does not hash name
    expect(descriptorIdentity(base)).toBe(
      descriptorIdentity({ ...base, name: "other" }),
    );
  });

  it("applyOAuthAuthExclusion keeps oauth only", () => {
    const out = applyOAuthAuthExclusion({
      name: "x",
      url: "https://x",
      oauth: true,
      headers: { a: "1" },
      headersHelper: "/bin/h",
      headersHelperTtlSec: 30,
    });
    expect(out.oauth).toBe(true);
    expect(out.headers).toBeUndefined();
    expect(out.headersHelper).toBeUndefined();
    expect(out.headersHelperTtlSec).toBeUndefined();
  });
});

describe("DirectMcpConnectionManager statuses", () => {
  beforeEach(() => {
    resetDirectMcpConnectionManagerForTests();
    vi.mocked(clearOAuthTokens).mockClear();
  });

  it("parks oauth descriptors as pending without connecting", async () => {
    const manager = new DirectMcpConnectionManager();
    const result = await manager.connectServers([
      {
        name: "oauth-server",
        url: "https://mcp.example",
        oauth: { clientId: "x" },
      },
    ]);
    expect(result).toEqual({ connected: 0, pending: 1, failed: 0 });
    expect(manager.getStatuses()).toEqual([
      {
        name: "oauth-server",
        url: "https://mcp.example",
        isConnected: false,
        hasAuth: true,
        tools: [],
        toolPolicy: undefined,
      },
    ]);
    expect(manager.pendingOAuthConfig("oauth-server")?.name).toBe(
      "oauth-server",
    );
  });

  it("authorizePending returns no-pending error when missing", async () => {
    const manager = new DirectMcpConnectionManager();
    await expect(manager.authorizePending("missing")).resolves.toEqual({
      ok: false,
      error: 'No pending MCP server named "missing"',
    });
  });

  it("disconnect unknown returns false", async () => {
    const manager = new DirectMcpConnectionManager();
    await expect(manager.disconnect("missing")).resolves.toBe(false);
  });

  it("remove pending oauth clears tokens (xv residual)", async () => {
    const manager = new DirectMcpConnectionManager();
    await manager.connectServers([
      {
        name: "oauth-server",
        url: "https://mcp.example",
        oauth: { clientId: "x" },
      },
    ]);
    await manager.remove("oauth-server");
    expect(clearOAuthTokens).toHaveBeenCalledWith("oauth-server");
    expect(manager.getStatuses()).toEqual([]);
  });

  it("notifies status listener on park", async () => {
    const manager = new DirectMcpConnectionManager();
    const listener = vi.fn();
    manager.setStatusListener(listener);
    await manager.connectServers([
      {
        name: "oauth-server",
        url: "https://mcp.example",
        oauth: { clientId: "x" },
      },
    ]);
    expect(listener).toHaveBeenCalled();
    const last = listener.mock.calls.at(-1)?.[0] as Array<{ name: string }>;
    expect(last.some((s) => s.name === "oauth-server")).toBe(true);
  });

  it("connectFromConfigBag prunes remotes removed from bag", async () => {
    const manager = new DirectMcpConnectionManager();
    await manager.connectServers([
      {
        name: "oauth-server",
        url: "https://mcp.example",
        oauth: { clientId: "x" },
      },
    ]);
    expect(manager.knownServerNames()).toContain("oauth-server");
    // Empty bag + no managed/plugin (mocked) → prune all.
    const result = await manager.connectFromConfigBag({});
    expect(result).toEqual({ connected: 0, pending: 0, failed: 0 });
    expect(manager.knownServerNames()).toEqual([]);
    expect(manager.getStatuses()).toEqual([]);
    expect(clearOAuthTokens).toHaveBeenCalledWith("oauth-server");
  });
});
