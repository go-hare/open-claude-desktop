import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/localSessions/localAgentAssets", () => ({
  listLocalSkills: vi.fn(async () => [
    {
      id: "app-local:demo",
      key: "demo",
      name: "Demo",
      description: "Demo skill",
      enabled: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]),
  getLocalSkillFiles: vi.fn(async () => [
    { relativePath: "SKILL.md", content: "# Demo", path: "/tmp/demo/SKILL.md" },
  ]),
  saveLocalSkill: vi.fn(async () => ({ id: "app-local:demo", name: "Demo" })),
  deleteLocalSkill: vi.fn(async () => true),
  setLocalSkillEnabled: vi.fn(async () => ({ id: "app-local:demo", enabled: false })),
  revealLocalSkill: vi.fn(async () => true),
}));

// Avoid real OAuth network probe during residual IPC unit tests.
vi.mock("../services/mcp/custom3pMcpOAuthProvider", () => {
  class NeedsInteractiveAuthError extends Error {
    serverName: string;
    constructor(serverName: string) {
      super(
        `${serverName}: OAuth needs interactive authorization (no cached tokens)`,
      );
      this.name = "NeedsInteractiveAuthError";
      this.serverName = serverName;
    }
  }
  return {
    NeedsInteractiveAuthError,
    OAUTH_CANCELLED_BY_NEWER: "custom3p-oauth-cancelled-by-newer",
    UnauthorizedError: class UnauthorizedError extends Error {
      constructor(message?: string) {
        super(message);
        this.name = "UnauthorizedError";
      }
    },
    probeOAuthCached: vi.fn(async (config: { name: string }) => {
      throw new NeedsInteractiveAuthError(config.name);
    }),
    authorizeAndGetBearerHeaders: vi.fn(async (config: { name: string }) => {
      throw new Error(
        `OAuth for MCP server "${config.name}" interactive path unavailable in unit test`,
      );
    }),
    oauthBearerHeaders: vi.fn(() => {
      throw new Error("no token");
    }),
    clearOAuthTokens: vi.fn(),
  };
});

vi.mock("../services/mcp/orgPluginMcpScan", () => ({
  managedMcpServersFromEnterprise: vi.fn(() => []),
  mergePluginMcpConfigs: <T,>(a: T[], b: T[]) => [...a, ...b],
  scanOrgPluginMcpServers: vi.fn(async () => []),
}));

import {
  createCoworkLocalAgentResidualHandlers,
  requestFolderTccAccessResidual,
} from "./coworkLocalAgentResidualHandlers";

const event = {
  senderFrame: { parent: null, url: "app://localhost/cowork/session-1" },
} as never;

function contextStub(overrides?: {
  sessionsBridgeEnabled?: boolean;
  getSession?: (id: string) => unknown;
  mcpServersConfig?: Record<string, unknown>;
}) {
  return {
    settings: {
      getPreferences: () => ({
        sessionsBridgeEnabled: overrides?.sessionsBridgeEnabled,
        mcpServers: {},
      }),
      getMcpServersConfig: () => overrides?.mcpServersConfig ?? {},
      setPreference: vi.fn(),
    },
    localAgentModeSessions: {
      initialize: vi.fn(async () => undefined),
      getSession: overrides?.getSession ?? vi.fn(() => null),
    },
  } as never;
}

describe("requestFolderTccAccessResidual", () => {
  it("returns NotSupported bag on non-darwin", async () => {
    if (process.platform === "darwin") {
      const bag = await requestFolderTccAccessResidual();
      expect(bag).toEqual(
        expect.objectContaining({
          desktop: expect.stringMatching(/Granted|Denied|NotSupported/),
          documents: expect.stringMatching(/Granted|Denied|NotSupported/),
          downloads: expect.stringMatching(/Granted|Denied|NotSupported/),
        }),
      );
      return;
    }
    await expect(requestFolderTccAccessResidual()).resolves.toEqual({
      desktop: "NotSupported",
      documents: "NotSupported",
      downloads: "NotSupported",
    });
  });
});

describe("createCoworkLocalAgentResidualHandlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns residual-honest bridge consent boolean and delete false", async () => {
    const {
      setShouldEnableSessionsBridgeForTests,
      resetSessionsBridgeStatusForTests,
    } = await import("../services/coworkSessions/sessionsBridgeResidual");
    // Force custom-3p residual: shouldEnable false → consent true (boolean, not bag).
    setShouldEnableSessionsBridgeForTests(false);
    try {
      const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
      await expect(handlers.getBridgeConsent?.(event)).resolves.toBe(true);
      await expect(handlers.deleteBridgeSession?.(event)).resolves.toBe(false);
      await expect(handlers.deleteBridgeAgentMemory?.(event)).resolves.toBe(false);
      await expect(handlers.disconnectDirectMcpServer?.(event, "x")).resolves.toBe(
        false,
      );
    } finally {
      resetSessionsBridgeStatusForTests();
      setShouldEnableSessionsBridgeForTests(null);
    }
  });

  it("does not soft-true authorizeDirectMcpServer", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
    await expect(
      handlers.authorizeDirectMcpServer?.(event, "github"),
    ).resolves.toEqual({
      ok: false,
      error: 'No pending MCP server named "github"',
    });
  });

  it("returns empty direct MCP statuses when no URL remotes configured", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
    await expect(handlers.getDirectMcpServerStatuses?.(event)).resolves.toEqual(
      [],
    );
  });

  it("parks oauth URL remotes as disconnected status without invent auth", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(
      contextStub({
        mcpServersConfig: {
          github: {
            url: "https://mcp.example/github",
            oauth: { clientId: "demo" },
          },
        },
      }),
    );
    await expect(handlers.getDirectMcpServerStatuses?.(event)).resolves.toEqual([
      {
        name: "github",
        url: "https://mcp.example/github",
        isConnected: false,
        hasAuth: true,
        tools: [],
        toolPolicy: undefined,
      },
    ]);
    // authorize without real OAuth server → residual error bag (not soft-true ok).
    const auth = await handlers.authorizeDirectMcpServer?.(event, "github");
    expect(auth).toEqual(
      expect.objectContaining({
        ok: false,
      }),
    );
    expect((auth as { ok: false }).ok).toBe(false);
  });

  it("mcpListResources returns [] when session missing", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
    await expect(
      handlers.mcpListResources?.(event, "missing-session", "server-uuid"),
    ).resolves.toEqual([]);
  });

  it("mcpReadResource returns {contents:[]} when session missing", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
    await expect(
      handlers.mcpReadResource?.(
        event,
        "missing-session",
        "server-uuid",
        "file://x",
      ),
    ).resolves.toEqual({ contents: [] });
  });

  it("triggerInteractiveAuth does not invent ok when no interactive auth needed", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
    // Empty bag → recompute finds nothing → { ok:true } means "nothing to do",
    // not invent OAuth success for a configured provider.
    await expect(handlers.triggerInteractiveAuth?.(event)).resolves.toEqual({
      ok: true,
    });
  });

  it("revokeInteractiveAuth clears enterprise interactive secrets (best-effort true)", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
    await expect(handlers.revokeInteractiveAuth?.(event)).resolves.toBe(true);
  });

  it("bridge poll/reset/preflight are residual void (official custom-3p no-ops)", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
    await expect(handlers.kickBridgePoll?.(event)).resolves.toBeUndefined();
    await expect(handlers.resetBridge?.(event)).resolves.toBeUndefined();
    await expect(handlers.resetBridgeSession?.(event)).resolves.toBeUndefined();
    await expect(handlers.abandonBridgeEnvironment?.(event)).resolves.toBeUndefined();
    await expect(
      handlers.respondBridgePermissionPreflight?.(event),
    ).resolves.toBeUndefined();
  });

  it("listLocalSkills maps to official skillId/name/description/enabled shape", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
    const skills = (await handlers.listLocalSkills?.(event)) as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(skills)).toBe(true);
    for (const skill of skills) {
      expect(typeof skill.skillId).toBe("string");
      expect(typeof skill.name).toBe("string");
      expect(typeof skill.description).toBe("string");
      expect(typeof skill.enabled).toBe("boolean");
    }
  });
});
