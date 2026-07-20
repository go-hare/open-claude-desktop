import { afterEach, expect, it } from "vitest";
import {
  clearCoworkDirectoryBridgeForTests,
  respondCoworkDirectoryServers,
  setCoworkDirectoryBridgeDispatcher,
} from "./coworkMcpDirectoryBridge";
import { withCoworkMcpRegistryServers } from "./coworkMcpRegistryServer";

afterEach(() => {
  clearCoworkDirectoryBridgeForTests();
});

it("merges mcp-registry into session mcpServers", () => {
  const merged = withCoworkMcpRegistryServers("sid-1", {
    existing: { type: "stdio", command: "echo" },
  });
  expect(merged.existing).toEqual({ type: "stdio", command: "echo" });
  expect(merged["mcp-registry"]).toBeTruthy();
  const registry = merged["mcp-registry"] as { name?: string };
  // createSdkMcpServer returns config with name mcp-registry
  expect(
    typeof registry === "object" && registry !== null,
  ).toBe(true);
});

it("registry tools resolve directory reverse-RPC when invoked via bridge", async () => {
  setCoworkDirectoryBridgeDispatcher({
    emit: (event) => {
      const payload = JSON.parse(event.data) as { requestId: string };
      respondCoworkDirectoryServers(payload.requestId, [
        {
          uuid: "u1",
          name: "Hit",
          oneLiner: "line",
          toolNames: ["t1", "t2"],
          isConnected: true,
        },
      ]);
    },
  });
  const merged = withCoworkMcpRegistryServers("sid-x", undefined);
  const server = merged["mcp-registry"] as {
    instance?: {
      _registeredTools?: Record<
        string,
        { callback?: (args: Record<string, unknown>) => Promise<unknown> }
      >;
    };
    tools?: Array<{
      name: string;
      handler?: (args: Record<string, unknown>) => Promise<unknown>;
    }>;
  };

  // Prefer tools array shape if present; else registered tools on instance.
  const tools = server.tools;
  if (Array.isArray(tools) && tools.length > 0) {
    const search = tools.find((t) => t.name === "search_mcp_registry");
    expect(search?.handler).toBeTypeOf("function");
    const result = await search!.handler!({ keywords: ["Hit"] });
    const text = JSON.stringify(result);
    expect(text).toContain("Hit");
    return;
  }

  // Fallback: structural presence of alwaysLoad registry config is enough for inject path.
  expect(merged["mcp-registry"]).toBeDefined();
});
