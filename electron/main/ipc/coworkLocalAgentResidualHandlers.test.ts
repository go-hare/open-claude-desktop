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
}) {
  return {
    settings: {
      getPreferences: () => ({
        sessionsBridgeEnabled: overrides?.sessionsBridgeEnabled,
        mcpServers: {},
      }),
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

  it("returns residual-honest bridge consent and delete false", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
    // 3p: no Anthropic remote bridge — honest deny bag, not soft-true granted
    await expect(handlers.getBridgeConsent?.(event)).resolves.toEqual({
      granted: false,
      reason: "sessions_bridge_unavailable",
    });
    await expect(handlers.deleteBridgeSession?.(event)).resolves.toBe(false);
    await expect(handlers.deleteBridgeAgentMemory?.(event)).resolves.toBe(false);
    await expect(handlers.disconnectDirectMcpServer?.(event, "x")).resolves.toBe(
      false,
    );
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

  it("returns empty direct MCP statuses", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
    await expect(handlers.getDirectMcpServerStatuses?.(event)).resolves.toEqual(
      [],
    );
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

  it("triggerInteractiveAuth is residual false without invent OAuth", async () => {
    const handlers = createCoworkLocalAgentResidualHandlers(contextStub());
    await expect(handlers.triggerInteractiveAuth?.(event)).resolves.toEqual({
      ok: false,
      error: "interactive_auth_not_available",
    });
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
