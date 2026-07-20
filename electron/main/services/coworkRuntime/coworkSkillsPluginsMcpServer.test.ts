import { afterEach, expect, it } from "vitest";
import {
  clearCoworkPluginSearchBridgeForTests,
  respondCoworkPluginSearch,
  setCoworkPluginSearchBridgeDispatcher,
} from "./coworkPluginSearchBridge";
import {
  clearCoworkSkillsSlashBridgeForTests,
  respondCoworkSlashMenuSkills,
  setCoworkSkillsSlashBridgeDispatcher,
} from "./coworkSkillsSlashBridge";
import { withCoworkAlwaysLoadMcpServers } from "./coworkSkillsPluginsMcpServer";

afterEach(() => {
  clearCoworkSkillsSlashBridgeForTests();
  clearCoworkPluginSearchBridgeForTests();
});

it("merges mcp-registry, skills, and plugins into mcpServers", () => {
  const merged = withCoworkAlwaysLoadMcpServers("sid-1", {
    existing: { type: "stdio", command: "echo" },
  });
  expect(merged.existing).toEqual({ type: "stdio", command: "echo" });
  expect(merged["mcp-registry"]).toBeTruthy();
  expect(merged.skills).toBeTruthy();
  expect(merged.plugins).toBeTruthy();
});

it("skills list_skills resolves reverse-RPC when tools present", async () => {
  setCoworkSkillsSlashBridgeDispatcher({
    emit: (event) => {
      const payload = JSON.parse(event.data) as { requestId: string };
      respondCoworkSlashMenuSkills(payload.requestId, [
        { name: "Hit", description: "line" },
      ]);
    },
  });
  setCoworkPluginSearchBridgeDispatcher({
    emit: (event) => {
      const payload = JSON.parse(event.data) as { requestId: string };
      respondCoworkPluginSearch(
        payload.requestId,
        JSON.stringify({ results: [] }),
      );
    },
  });
  const merged = withCoworkAlwaysLoadMcpServers("sid-x", undefined);
  const server = merged.skills as {
    tools?: Array<{
      name: string;
      handler?: (args: Record<string, unknown>) => Promise<unknown>;
    }>;
  };
  const tools = server.tools;
  if (Array.isArray(tools) && tools.length > 0) {
    const list = tools.find((t) => t.name === "list_skills");
    expect(list?.handler).toBeTypeOf("function");
    const result = await list!.handler!({ keywords: ["Hit"] });
    const text = JSON.stringify(result);
    expect(text).toContain("Hit");
    return;
  }
  expect(merged.skills).toBeDefined();
});
