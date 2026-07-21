import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { homedir } from "node:os";
import { expect, it, vi } from "vitest";
import { buildCoworkSdkOptions, createCoworkAgentQueryFactory } from "./coworkAgentQueryFactory";
import type { CoworkQueryFactoryInput } from "../coworkSessions/coworkSessionManagerTypes";

/** Real host dir for Mh realpath so prepare can attach _hostPath. */
function mkExistingDir(...parts: string[]): string {
  const dir = path.join(os.tmpdir(), "cowork-factory-test", ...parts, `d-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

function input(overrides: Partial<CoworkQueryFactoryInput> = {}): CoworkQueryFactoryInput {
  return {
    accountDetails: null,
    accountIdentity: { accountUuid: "account-1", organizationUuid: "org-1" },
    canUseTool: async () => ({ behavior: "allow" }),
    cwd: "/sessions/session-1",
    hostLoopMode: true,
    permissionMode: "default",
    prompt: { async *[Symbol.asyncIterator]() {} },
    sessionId: "session-1",
    userSelectedFolders: ["/Users/test/project"],
    ...overrides,
  };
}

it("builds the long-lived host-loop SDK options", () => {
  const spawnClaudeCodeProcess = vi.fn();
  const options = buildCoworkSdkOptions(input(), {
    executable: "/opt/claude",
    spawnClaudeCodeProcess,
  });

  expect(options).toMatchObject({
    cwd: "/Users/test/project",
    forwardSubagentText: true,
    includePartialMessages: true,
    pathToClaudeCodeExecutable: "/opt/claude",
    permissionMode: "default",
    spawnClaudeCodeProcess,
  });
  expect(options.tools).toContain("Read");
  expect(options.disallowedTools).toContain("Bash");
});

it("builds dual-exec SDK options with guest cwd and VM spawn (not host bash invent)", () => {
  const options = buildCoworkSdkOptions(
    input({
      hostLoopMode: false,
      vmProcessName: "vm-proc-1",
      hostClaudeConfigDir: "/tmp/sess/.claude",
      hostOutputsDir: "/tmp/sess/outputs",
      userSelectedFolders: ["/Users/test/project"],
    }),
    { executable: "/opt/claude", spawnClaudeCodeProcess: vi.fn() },
  );

  expect(options.cwd).toBe("/sessions/vm-proc-1");
  expect(options.pathToClaudeCodeExecutable).toBe("/usr/local/bin/claude");
  expect(options.additionalDirectories).toEqual([
    "/sessions/vm-proc-1/mnt/project",
  ]);
  expect(typeof options.spawnClaudeCodeProcess).toBe("function");
  // Host-loop disallowed Bash list is host-loop-only.
  expect(options.disallowedTools).toBeUndefined();
});

it("appends official auto-memory host allow rules in host-loop mode", () => {
  const withMemory = buildCoworkSdkOptions(
    input({
      autoMemoryDir: "/tmp/acct/org/spaces/s1/memory",
      hostLoopMode: true,
      hostOutputsDir: "/tmp/sess/outputs",
      hostUploadsDir: "/tmp/sess/uploads",
    }),
    { executable: "/opt/claude", spawnClaudeCodeProcess: vi.fn() },
  );
  expect(withMemory.allowedTools).toEqual(
    expect.arrayContaining([
      "mcp__workspace__bash",
      "Edit(//tmp/sess/outputs/**)",
      "Read(//tmp/sess/outputs/**)",
      "Read(//tmp/sess/uploads/**)",
      "Edit(//Users/test/project/**)",
      "Read(//Users/test/project/**)",
      "Edit(//tmp/acct/org/spaces/s1/memory/**)",
      "Write(//tmp/acct/org/spaces/s1/memory/**)",
      "Read(//tmp/acct/org/spaces/s1/memory/**)",
    ]),
  );

  const radar = buildCoworkSdkOptions(
    input({
      autoMemoryDir: "/tmp/acct/org/memory/memory",
      autoMemoryReadOnly: true,
      hostLoopMode: true,
    }),
    { executable: "/opt/claude", spawnClaudeCodeProcess: vi.fn() },
  );
  expect(radar.allowedTools).toContain("Read(//tmp/acct/org/memory/memory/**)");
  expect(radar.allowedTools).not.toContain(
    "Edit(//tmp/acct/org/memory/memory/**)",
  );

  const nonHost = buildCoworkSdkOptions(
    input({
      autoMemoryDir: "/memory",
      hostLoopMode: false,
      hostOutputsDir: "/out",
    }),
    { executable: "/opt/claude" },
  );
  expect(nonHost.allowedTools ?? []).not.toContain("Edit(//memory/**)");
  expect(nonHost.allowedTools ?? []).not.toContain("Edit(//out/**)");
});

it("appends official V1i Ohe config + plugin Read rules in host-loop mode", () => {
  const withConfig = buildCoworkSdkOptions(
    input({
      hostClaudeConfigDir: "/tmp/sess/.claude",
      hostLoopMode: true,
      hostOutputsDir: "/tmp/sess/outputs",
      hostUploadsDir: "/tmp/sess/uploads",
      readOnlyPluginPaths: ["/plugins/one"],
    }),
    { executable: "/opt/claude", spawnClaudeCodeProcess: vi.fn() },
  );
  expect(withConfig.allowedTools).toEqual(
    expect.arrayContaining([
      "Read(//tmp/sess/.claude/projects/**/tool-results/**)",
      "Read(//plugins/one/**)",
      "mcp__workspace__bash",
      "Edit(//tmp/sess/outputs/**)",
      "Read(//tmp/sess/uploads/**)",
    ]),
  );

  const withoutConfig = buildCoworkSdkOptions(
    input({ hostLoopMode: true }),
    { executable: "/opt/claude", spawnClaudeCodeProcess: vi.fn() },
  );
  expect(
    (withoutConfig.allowedTools ?? []).some((tool) =>
      tool.includes("tool-results"),
    ),
  ).toBe(false);

  const nonHost = buildCoworkSdkOptions(
    input({
      hostClaudeConfigDir: "/tmp/sess/.claude",
      hostLoopMode: false,
      readOnlyPluginPaths: ["/plugins/one"],
    }),
    { executable: "/opt/claude" },
  );
  expect(nonHost.allowedTools ?? []).not.toContain(
    "Read(//tmp/sess/.claude/projects/**/tool-results/**)",
  );
  expect(nonHost.allowedTools ?? []).not.toContain("Read(//plugins/one/**)");
});

it("falls back off VM /sessions paths so Windows can spawn Claude Code", () => {
  const options = buildCoworkSdkOptions(
    input({
      hostLoopMode: false,
      userSelectedFolders: ["/sessions/session-1"],
    }),
    { executable: "/opt/claude" },
  );

  expect(options.cwd).toBe(process.cwd());
  expect(options.additionalDirectories).toBeUndefined();
});

it("prefers real host folders over VM session paths in host-loop mode", () => {
  const options = buildCoworkSdkOptions(
    input({
      userSelectedFolders: ["/sessions/session-1", "D:/work/project"],
    }),
    { executable: "/opt/claude" },
  );

  expect(options.cwd).toBe("D:/work/project");
  expect(options.additionalDirectories).toEqual(["D:/work/project"]);
});

it("routes SDK permission requests into the Cowork broker callback", async () => {
  const canUseTool = vi.fn(async () => ({
    behavior: "allow" as const,
    updatedInput: { file_path: "/safe" },
  }));
  const options = buildCoworkSdkOptions(input({ canUseTool }), {
    executable: "/opt/claude",
  });

  await expect(
    options.canUseTool?.("Read", { file_path: "/safe" }, {
      signal: new AbortController().signal,
      toolUseID: "tool-1",
    }),
  ).resolves.toMatchObject({ behavior: "allow", updatedInput: { file_path: "/safe" } });
  expect(canUseTool).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: "session-1", toolName: "Read" }),
  );
});

it("pre-denies mcp__cowork__request_cowork_directory on protected/internal paths", async () => {
  const home = homedir();
  // Official prepare attaches _hostPath only after Mh realpath succeeds.
  const projectPath = mkExistingDir("Projects", "app");
  const canUseTool = vi.fn(async () => ({ behavior: "allow" as const }));
  const options = buildCoworkSdkOptions(
    input({
      canUseTool,
      hostOutputsDir: "/tmp/local-agent-mode-sessions/a/o/s1/outputs",
    }),
    { executable: "/opt/claude" },
  );
  const signal = new AbortController().signal;

  await expect(
    options.canUseTool?.(
      "mcp__cowork__request_cowork_directory",
      { path: path.join(home, ".ssh") },
      { signal, toolUseID: "rd-1" },
    ),
  ).resolves.toMatchObject({
    behavior: "deny",
    message: expect.stringContaining("protected host location"),
  });
  expect(canUseTool).not.toHaveBeenCalled();

  await expect(
    options.canUseTool?.(
      "mcp__cowork__request_cowork_directory",
      { path: "/tmp/local-agent-mode-sessions/a/o/s1/outputs" },
      { signal, toolUseID: "rd-2" },
    ),
  ).resolves.toMatchObject({
    behavior: "deny",
    message: expect.stringContaining("internal session storage"),
  });

  // Project path reaches broker with host-path attachment for always-allow.
  canUseTool.mockClear();
  await expect(
    options.canUseTool?.(
      "mcp__cowork__request_cowork_directory",
      { path: projectPath },
      { signal, toolUseID: "rd-3" },
    ),
  ).resolves.toMatchObject({ behavior: "allow" });
  expect(canUseTool).toHaveBeenCalledWith(
    expect.objectContaining({
      toolName: "mcp__cowork__request_cowork_directory",
      input: expect.objectContaining({
        path: projectPath,
        _hostPathForRequestDirectoryTool: projectPath,
      }),
    }),
  );
});

it("canUseTool pre-denies missing path for agent/dispatch_child sessionType", async () => {
  const canUseTool = vi.fn(async () => ({ behavior: "allow" as const }));
  const agent = buildCoworkSdkOptions(
    input({ canUseTool, sessionType: "agent" }),
    { executable: "/opt/claude" },
  );
  await expect(
    agent.canUseTool?.(
      "mcp__cowork__request_cowork_directory",
      {},
      { signal: new AbortController().signal, toolUseID: "rd-headless-1" },
    ),
  ).resolves.toMatchObject({
    behavior: "deny",
    message: expect.stringContaining("path` parameter is required"),
  });
  expect(canUseTool).not.toHaveBeenCalled();

  canUseTool.mockClear();
  const local = buildCoworkSdkOptions(input({ canUseTool }), {
    executable: "/opt/claude",
  });
  // Local omit sessionType → no path-required hard deny (picker path).
  await expect(
    local.canUseTool?.(
      "mcp__cowork__request_cowork_directory",
      {},
      { signal: new AbortController().signal, toolUseID: "rd-local-1" },
    ),
  ).resolves.toMatchObject({ behavior: "allow" });
  expect(canUseTool).toHaveBeenCalled();
});

it("canUseTool prepare skips _hostPath when admin roots P4 would deny (no hard deny)", async () => {
  // Official: P4 fail only withholds _hostPath attachment; broker still prompted.
  // Mh requires realpath success, so use real temp roots.
  const root = mkExistingDir("admin-roots");
  const inside = mkExistingDir("admin-roots", "app");
  // Ensure inside is under root for membership after realpath.
  const nested = path.join(root, "nested-app");
  fs.mkdirSync(nested, { recursive: true });
  const insideReal = fs.realpathSync(nested);
  const outside = mkExistingDir("outside-root");
  const canUseTool = vi.fn(async () => ({ behavior: "allow" as const }));
  const options = buildCoworkSdkOptions(
    input({
      allowedWorkspaceFolders: [root],
      canUseTool,
      hostOutputsDir: "/tmp/local-agent-mode-sessions/a/o/s1/outputs",
    }),
    { executable: "/opt/claude" },
  );

  await expect(
    options.canUseTool?.(
      "mcp__cowork__request_cowork_directory",
      { path: outside },
      { signal: new AbortController().signal, toolUseID: "rd-admin-1" },
    ),
  ).resolves.toMatchObject({ behavior: "allow" });
  expect(canUseTool).toHaveBeenCalledWith(
    expect.objectContaining({
      toolName: "mcp__cowork__request_cowork_directory",
      input: {
        path: outside,
      },
    }),
  );
  expect(canUseTool.mock.calls[0]?.[0]?.input).not.toHaveProperty(
    "_hostPathForRequestDirectoryTool",
  );

  canUseTool.mockClear();
  await expect(
    options.canUseTool?.(
      "mcp__cowork__request_cowork_directory",
      { path: insideReal },
      { signal: new AbortController().signal, toolUseID: "rd-admin-2" },
    ),
  ).resolves.toMatchObject({ behavior: "allow" });
  expect(canUseTool).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        path: insideReal,
        _hostPathForRequestDirectoryTool: insideReal,
      }),
    }),
  );
});

it("creates the SDK query with the AsyncIterable prompt", () => {
  const runtime = {
    close: vi.fn(),
    interrupt: vi.fn(),
    setModel: vi.fn(),
    setPermissionMode: vi.fn(),
    async *[Symbol.asyncIterator]() {},
  };
  const query = vi.fn(() => runtime as never);
  const factory = createCoworkAgentQueryFactory({
    executable: "/opt/claude",
    query,
    spawnClaudeCodeProcess: vi.fn(),
  });
  const factoryInput = input();

  expect(factory(factoryInput)).toBe(runtime);
  expect(query).toHaveBeenCalledWith(
    expect.objectContaining({ prompt: factoryInput.prompt }),
  );
});

it("aze CIC canUseTool residual short-circuits Claude_in_Chrome tools", async () => {
  const canUseTool = vi.fn(async () => ({ behavior: "allow" as const }));
  const options = buildCoworkSdkOptions(
    input({
      canUseTool,
      cicCanUseTool: {
        session: {},
      },
      hostLoopMode: false,
    }),
    { executable: "/opt/claude" },
  );
  await expect(
    options.canUseTool?.(
      "mcp__Claude_in_Chrome__tabs_context_mcp",
      { x: 1 },
      { signal: new AbortController().signal, toolUseID: "cic-1" },
    ),
  ).resolves.toMatchObject({ behavior: "allow", updatedInput: { x: 1 } });
  // Generic permission broker not called for permissionless CIC.
  expect(canUseTool).not.toHaveBeenCalled();

  // Non-CIC falls through to generic canUseTool.
  await expect(
    options.canUseTool?.(
      "Bash",
      { command: "ls" },
      { signal: new AbortController().signal, toolUseID: "bash-1" },
    ),
  ).resolves.toMatchObject({ behavior: "allow" });
  expect(canUseTool).toHaveBeenCalled();
});
