import { describe, expect, it, vi } from "vitest";
import {
  CLAUDE_PREVIEW_HTTP_TOOLS,
  CLAUDE_PREVIEW_MCP_NAME,
  CLAUDE_PREVIEW_TOOL_NAMES,
  handleClaudePreviewToolCall,
  isClaudePreviewMcpEnabled,
  type ClaudePreviewMcpHost,
} from "./claudePreviewMcpServer";

function mockHost(overrides: Partial<ClaudePreviewMcpHost> = {}): ClaudePreviewMcpHost {
  const servers = new Map<
    string,
    {
      serverId: string;
      name: string;
      port: number;
      status: "running" | "starting" | "stopped" | "error";
      startedAt: string;
      cwd: string;
    }
  >();
  return {
    launch: {
      isEnabled: () => true,
      getActiveServers: () => Array.from(servers.values()),
      getServer: (id?: string) => (id ? servers.get(id) ?? null : null),
      getLogs: () => [],
      startFromConfig: vi.fn(async (_cwd: string, name?: string) => {
        const serverId = "server_test_1";
        servers.set(serverId, {
          serverId,
          name: name ?? "dev",
          port: 3000,
          status: "running",
          startedAt: new Date().toISOString(),
          cwd: _cwd,
        });
        return { serverId };
      }),
      stopServer: vi.fn(async (serverId: string) => {
        const ok = servers.has(serverId);
        servers.delete(serverId);
        return ok;
      }),
    } as unknown as ClaudePreviewMcpHost["launch"],
    previewViews: {
      destroy: vi.fn(),
      getConsoleLogs: () => [],
      getNetworkEntries: () => [],
      capturePreviewScreenshotCompressed: vi.fn(async () => "jpegbase64"),
      takeSnapshotText: vi.fn(async () => "[1] Root"),
      inspectElement: vi.fn(async () => ({ tagName: "button" })),
      click: vi.fn(async () => true),
      fill: vi.fn(async () => true),
      evaluate: vi.fn(async () => 42),
      getResponseBody: vi.fn(async () => null),
      setPreviewViewport: vi.fn(async () => true),
      clearPreviewViewport: vi.fn(async () => true),
      setPreviewColorScheme: vi.fn(async () => true),
    } as unknown as ClaudePreviewMcpHost["previewViews"],
    isLaunchEnabled: () => true,
    ensurePreviewContext: vi.fn(),
    isSSH: () => false,
    ...overrides,
  };
}

describe("Claude Preview MCP residual (voA / HOi / KOi)", () => {
  it("server name is official voA", () => {
    expect(CLAUDE_PREVIEW_MCP_NAME).toBe("Claude Preview");
  });

  it("HOi tool surface has all 13 preview_* names", () => {
    expect(CLAUDE_PREVIEW_TOOL_NAMES).toEqual([
      "preview_start",
      "preview_stop",
      "preview_list",
      "preview_logs",
      "preview_console_logs",
      "preview_screenshot",
      "preview_snapshot",
      "preview_inspect",
      "preview_click",
      "preview_fill",
      "preview_eval",
      "preview_network",
      "preview_resize",
    ]);
    expect(CLAUDE_PREVIEW_HTTP_TOOLS.map((t) => t.name)).toEqual([
      ...CLAUDE_PREVIEW_TOOL_NAMES,
    ]);
  });

  it("isEnabled mirrors official gates (launchEnabled + ccd + !ssh)", () => {
    expect(
      isClaudePreviewMcpEnabled({
        isLaunchEnabled: true,
        sessionType: "ccd",
        isSSH: false,
      }),
    ).toBe(true);
    expect(
      isClaudePreviewMcpEnabled({
        isLaunchEnabled: false,
        sessionType: "ccd",
      }),
    ).toBe(false);
    expect(
      isClaudePreviewMcpEnabled({
        isLaunchEnabled: true,
        sessionType: "ccd",
        isSSH: true,
      }),
    ).toBe(false);
    expect(
      isClaudePreviewMcpEnabled({
        isLaunchEnabled: true,
        sessionType: "cowork",
      }),
    ).toBe(false);
  });

  it("preview_list returns JSON array", async () => {
    const host = mockHost();
    const result = await handleClaudePreviewToolCall(
      "preview_list",
      {},
      "/tmp/proj",
      host,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual([]);
  });

  it("preview_start starts from config and ensures preview context", async () => {
    const host = mockHost();
    const result = await handleClaudePreviewToolCall(
      "preview_start",
      { name: "frontend" },
      "/tmp/proj",
      host,
    );
    expect(result.isError).toBeUndefined();
    expect(host.launch.startFromConfig).toHaveBeenCalledWith(
      "/tmp/proj",
      "frontend",
    );
    expect(host.ensurePreviewContext).toHaveBeenCalled();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("server_test_1");
    expect(text).toContain("Server started successfully");
  });

  it("preview_stop stops server", async () => {
    const host = mockHost();
    await handleClaudePreviewToolCall(
      "preview_start",
      { name: "frontend" },
      "/tmp/proj",
      host,
    );
    const result = await handleClaudePreviewToolCall(
      "preview_stop",
      { serverId: "server_test_1" },
      "/tmp/proj",
      host,
    );
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toContain("stopped");
  });

  it("denies tools when launchEnabled is false", async () => {
    const host = mockHost({ isLaunchEnabled: () => false });
    const result = await handleClaudePreviewToolCall(
      "preview_list",
      {},
      "/tmp/proj",
      host,
    );
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/disabled/i);
  });

  it("preview_screenshot returns JPEG image content", async () => {
    const host = mockHost();
    await handleClaudePreviewToolCall(
      "preview_start",
      { name: "frontend" },
      "/tmp/proj",
      host,
    );
    const result = await handleClaudePreviewToolCall(
      "preview_screenshot",
      { serverId: "server_test_1" },
      "/tmp/proj",
      host,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({
      type: "image",
      mimeType: "image/jpeg",
      data: "jpegbase64",
    });
  });
});
