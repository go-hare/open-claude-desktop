import { expect, it, vi } from "vitest";
import {
  COWORK_EGRESS_BLOCKED_TAG,
  COWORK_WORKSPACE_MCP_NAME,
  appendCoworkOtlpEndpointToAllowedDomains,
  classifyCoworkWorkspaceWebFetchDenial,
  coworkVmEgressPolicyToAllowedDomains,
  createCoworkWorkspaceMcpServerConfig,
  coworkWorkspaceBashDescription,
  coworkWorkspaceHostAllowed,
  coworkWorkspaceIsPrivateOrLocalHost,
  officialWorkspaceBootingMessage,
  officialWorkspaceUnavailableMessage,
  resolveCoworkWorkspaceAllowedDomains,
  withCoworkWorkspaceMcpServer,
} from "./coworkWorkspaceMcpServer";

type RegisteredTool = {
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }>;
};

function registeredTools(server: unknown): Record<string, RegisteredTool> {
  const record = server as {
    instance?: { _registeredTools?: Record<string, RegisteredTool> };
    tools?: Array<{ name: string; handler: RegisteredTool["handler"] }>;
  };
  if (record.instance?._registeredTools) {
    return record.instance._registeredTools;
  }
  const map: Record<string, RegisteredTool> = {};
  for (const tool of record.tools ?? []) {
    map[tool.name] = { handler: tool.handler };
  }
  return map;
}

it("matches official hostname allowlist rules", () => {
  expect(coworkWorkspaceHostAllowed("api.example.com", "api.example.com")).toBe(
    true,
  );
  expect(coworkWorkspaceHostAllowed("API.EXAMPLE.COM", "api.example.com")).toBe(
    true,
  );
  expect(coworkWorkspaceHostAllowed("sub.example.com", "*.example.com")).toBe(
    true,
  );
  expect(coworkWorkspaceHostAllowed("example.com", "*.example.com")).toBe(false);
  expect(coworkWorkspaceHostAllowed("evil.com", "example.com")).toBe(false);
  expect(coworkWorkspaceHostAllowed("anything.com", "*")).toBe(true);
});

it("detects local and private hosts like official wbA", () => {
  expect(coworkWorkspaceIsPrivateOrLocalHost("localhost")).toBe(true);
  expect(coworkWorkspaceIsPrivateOrLocalHost("127.0.0.1")).toBe(true);
  expect(coworkWorkspaceIsPrivateOrLocalHost("10.0.0.2")).toBe(true);
  expect(coworkWorkspaceIsPrivateOrLocalHost("192.168.1.1")).toBe(true);
  expect(coworkWorkspaceIsPrivateOrLocalHost("172.16.0.1")).toBe(true);
  expect(coworkWorkspaceIsPrivateOrLocalHost("example.com")).toBe(false);
  expect(coworkWorkspaceIsPrivateOrLocalHost("8.8.8.8")).toBe(false);
});

it("classifies official F1i web_fetch denials", () => {
  expect(
    classifyCoworkWorkspaceWebFetchDenial(new URL("ftp://x.com"), ["*"]),
  ).toContain("URL scheme");
  expect(
    classifyCoworkWorkspaceWebFetchDenial(new URL("https://127.0.0.1/"), ["*"]),
  ).toContain("local or private");
  expect(
    classifyCoworkWorkspaceWebFetchDenial(new URL("https://example.com/"), []),
  ).toContain(COWORK_EGRESS_BLOCKED_TAG);
  expect(
    classifyCoworkWorkspaceWebFetchDenial(
      new URL("https://example.com/"),
      null,
    ),
  ).toContain("web_fetch tool is disabled");
  expect(
    classifyCoworkWorkspaceWebFetchDenial(new URL("https://evil.com/"), [
      "good.com",
    ]),
  ).toContain("not on the network allowlist");
  expect(
    classifyCoworkWorkspaceWebFetchDenial(new URL("https://good.com/path"), [
      "good.com",
    ]),
  ).toBeNull();
  expect(
    classifyCoworkWorkspaceWebFetchDenial(new URL("https://a.good.com/"), [
      "*.good.com",
    ]),
  ).toBeNull();
});

it("embeds official bash description with vm process mount path", () => {
  expect(coworkWorkspaceBashDescription("vm-1")).toContain(
    "/sessions/vm-1/mnt/",
  );
  expect(coworkWorkspaceBashDescription("vm-1")).toContain(
    "request_cowork_directory",
  );
});

it("returns official bash unavailable when dual-exec VM is not wired", async () => {
  const server = createCoworkWorkspaceMcpServerConfig({
    sessionId: "s1",
    vmProcessName: "proc-1",
  });
  const bash = registeredTools(server).bash;
  expect(bash?.handler).toBeTypeOf("function");
  const result = await bash.handler({ command: "echo hi" });
  expect(result).toMatchObject({
    isError: true,
    content: [
      {
        type: "text",
        text: officialWorkspaceUnavailableMessage(),
      },
    ],
  });
});

it("returns official booting message when VM probe is booting", async () => {
  const server = createCoworkWorkspaceMcpServerConfig({
    getVmStatus: async () => "booting",
    sessionId: "s1",
    vmProcessName: "proc-1",
  });
  const result = await registeredTools(server).bash.handler({
    command: "true",
  });
  expect(result.content[0]).toMatchObject({
    text: officialWorkspaceBootingMessage(),
  });
  expect(result.isError).toBe(true);
});

it("runs injected dual-exec bash runner when VM ready", async () => {
  const runBash = vi.fn(async () => ({
    exitCode: 0,
    output: "hello from vm",
  }));
  const server = createCoworkWorkspaceMcpServerConfig({
    getVmStatus: async () => "ready",
    runBash,
    sessionId: "s1",
    vmProcessName: "proc-1",
  });
  const result = await registeredTools(server).bash.handler({
    command: "echo hello",
  });
  expect(runBash).toHaveBeenCalledWith(
    expect.objectContaining({
      command: "echo hello",
      processName: "proc-1",
    }),
  );
  expect(result).toMatchObject({
    content: [{ type: "text", text: "hello from vm" }],
  });
  expect(result.isError).toBeUndefined();
});

it("denies web_fetch when no network allowlist (official egress)", async () => {
  const server = createCoworkWorkspaceMcpServerConfig({
    sessionId: "s1",
    vmProcessName: "proc-1",
  });
  const result = await registeredTools(server).web_fetch.handler({
    url: "https://example.com",
  });
  expect(result.isError).toBe(true);
  expect(String(result.content[0]?.text)).toContain(COWORK_EGRESS_BLOCKED_TAG);
});

it("fetches when allowlist permits and injects fetchImpl", async () => {
  const fetchImpl = vi.fn(async () => {
    return new Response("body-ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  });
  const server = createCoworkWorkspaceMcpServerConfig({
    allowedDomains: ["example.com"],
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sessionId: "s1",
    vmProcessName: "proc-1",
  });
  const result = await registeredTools(server).web_fetch.handler({
    url: "https://example.com/x",
  });
  expect(fetchImpl).toHaveBeenCalled();
  expect(result.isError).toBeUndefined();
  expect(String(result.content[0]?.text)).toContain("body-ok");
  expect(String(result.content[0]?.text)).toContain("https://example.com/x");
});

it("merges workspace server only when options provided (host-loop)", () => {
  const merged = withCoworkWorkspaceMcpServer(
    { skills: { name: "skills" } },
    {
      sessionId: "s1",
      vmProcessName: "p1",
    },
  );
  expect(merged.skills).toEqual({ name: "skills" });
  expect(merged[COWORK_WORKSPACE_MCP_NAME]).toBeDefined();
  const tools = registeredTools(merged[COWORK_WORKSPACE_MCP_NAME]);
  expect(tools.bash?.handler).toBeTypeOf("function");
  expect(tools.web_fetch?.handler).toBeTypeOf("function");

  const nonHost = withCoworkWorkspaceMcpServer({ a: 1 }, null);
  expect(nonHost).toEqual({ a: 1 });
  expect(nonHost[COWORK_WORKSPACE_MCP_NAME]).toBeUndefined();
});

it("maps official cnA / wFi / resolveVmAllowedDomains pure helpers", () => {
  expect(coworkVmEgressPolicyToAllowedDomains({ kind: "unrestricted" })).toEqual(
    ["*"],
  );
  expect(
    coworkVmEgressPolicyToAllowedDomains({
      kind: "allowlist",
      domains: ["a.com", "b.com"],
    }),
  ).toEqual(["a.com", "b.com"]);
  expect(coworkVmEgressPolicyToAllowedDomains(null)).toBeUndefined();
  expect(coworkVmEgressPolicyToAllowedDomains(undefined)).toBeUndefined();

  expect(
    appendCoworkOtlpEndpointToAllowedDomains(["a.com"], {
      endpoint: "https://otel.example.com:4318/v1/traces",
    }),
  ).toEqual(["a.com", "otel.example.com"]);
  expect(
    appendCoworkOtlpEndpointToAllowedDomains(["*"], {
      endpoint: "https://otel.example.com/v1",
    }),
  ).toEqual(["*"]);
  expect(
    appendCoworkOtlpEndpointToAllowedDomains(["a.com"], { endpoint: null }),
  ).toEqual(["a.com"]);
  expect(appendCoworkOtlpEndpointToAllowedDomains(null, { endpoint: "x" })).toBe(
    null,
  );

  // Policy wins over session egress (official Ii().vmEgressPolicy() ? cnA : A).
  expect(
    resolveCoworkWorkspaceAllowedDomains({
      egressAllowedDomains: ["session.com"],
      vmEgressPolicy: { kind: "unrestricted" },
    }),
  ).toEqual(["*"]);
  expect(
    resolveCoworkWorkspaceAllowedDomains({
      egressAllowedDomains: ["session.com"],
      otelConfig: { endpoint: "http://collector.internal/v1" },
      vmEgressPolicy: { kind: "allowlist", domains: ["policy.com"] },
    }),
  ).toEqual(["policy.com", "collector.internal"]);
  // No policy inject → session egress + OTLP host.
  expect(
    resolveCoworkWorkspaceAllowedDomains({
      egressAllowedDomains: ["good.com"],
      otelConfig: { endpoint: "https://otel.good.com/path" },
    }),
  ).toEqual(["good.com", "otel.good.com"]);
  expect(
    resolveCoworkWorkspaceAllowedDomains({
      egressAllowedDomains: undefined,
    }),
  ).toBeUndefined();
});
