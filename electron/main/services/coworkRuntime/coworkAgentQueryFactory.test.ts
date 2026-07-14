import { expect, it, vi } from "vitest";
import { buildCoworkSdkOptions, createCoworkAgentQueryFactory } from "./coworkAgentQueryFactory";
import type { CoworkQueryFactoryInput } from "../coworkSessions/coworkSessionManagerTypes";

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
