import { describe, expect, it } from "vitest";
import { asMcpServerMap, toCliMcpConfigWire } from "./mcpConfigWire";

describe("mcpConfigWire (CLI --mcp-config residual)", () => {
  const previewEntry = {
    type: "http",
    url: "http://127.0.0.1:9/mcp",
    headers: { Authorization: "Bearer t" },
    alwaysLoad: true,
  };

  it("wraps bare server map as { mcpServers }", () => {
    const bare = { "Claude Preview": previewEntry };
    expect(toCliMcpConfigWire(bare)).toEqual({
      mcpServers: { "Claude Preview": previewEntry },
    });
  });

  it("accepts already-wrapped mcpServers without double-nesting", () => {
    const wrapped = { mcpServers: { "Claude Preview": previewEntry } };
    expect(toCliMcpConfigWire(wrapped)).toEqual(wrapped);
    expect(asMcpServerMap(wrapped)).toEqual({ "Claude Preview": previewEntry });
  });

  it("returns null for empty / invalid input", () => {
    expect(toCliMcpConfigWire(null)).toBeNull();
    expect(toCliMcpConfigWire(undefined)).toBeNull();
    expect(toCliMcpConfigWire({})).toBeNull();
    expect(toCliMcpConfigWire([])).toBeNull();
  });

  it("merges bare maps by server name", () => {
    const base = asMcpServerMap({ a: { type: "stdio", command: "x" } });
    const preview = asMcpServerMap({ "Claude Preview": previewEntry });
    expect({ ...base, ...preview }).toEqual({
      a: { type: "stdio", command: "x" },
      "Claude Preview": previewEntry,
    });
  });
});
