import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  hasEnterpriseCredentials,
  mergePluginMcpConfigs,
  normalizePluginOAuth,
  parseEnterpriseMcpServers,
  parseHttpSseMcpConfig,
  resolveOrgPluginsRoot,
  scanOrgPluginMcpServers,
  scanPluginDirForMcp,
} from "./orgPluginMcpScan";

describe("orgPluginMcpScan residual", () => {
  it("By() returns null when enterprise inactive", () => {
    expect(resolveOrgPluginsRoot("darwin", false)).toBeNull();
    expect(resolveOrgPluginsRoot("darwin", true)).toBe(
      "/Library/Application Support/Claude/org-plugins",
    );
    expect(resolveOrgPluginsRoot("win32", true)).toContain("org-plugins");
    expect(resolveOrgPluginsRoot("linux", true)).toBeNull();
  });

  it("hasEnterpriseCredentials is R1/cHe on raw bag", () => {
    expect(hasEnterpriseCredentials(null)).toBe(false);
    expect(hasEnterpriseCredentials({})).toBe(false);
    expect(hasEnterpriseCredentials({ requireCoworkFullVmSandbox: true })).toBe(
      false,
    );
    expect(
      hasEnterpriseCredentials({ inferenceProvider: "gateway" }),
    ).toBe(true);
    expect(
      hasEnterpriseCredentials({
        bootstrapUrl: "https://bootstrap.example",
      }),
    ).toBe(true);
    expect(
      hasEnterpriseCredentials({
        bootstrapUrl: "https://bootstrap.example",
        bootstrapEnabled: false,
      }),
    ).toBe(false);
  });

  it("parseEnterpriseMcpServers reads array/map and JLA-excludes oauth+headers", () => {
    const list = parseEnterpriseMcpServers([
      { name: "a", url: "https://a.example" },
      {
        name: "b",
        url: "https://b.example",
        oauth: { clientId: "x" },
        headers: { a: "1" },
      },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      name: "a",
      url: "https://a.example",
      source: "mdm",
    });
    expect(list[1]).toMatchObject({
      name: "b",
      oauth: { clientId: "x" },
      source: "mdm",
    });
    expect(list[1]).not.toHaveProperty("headers");
    expect(list[1]).not.toHaveProperty("headersHelper");

    const mapList = parseEnterpriseMcpServers({
      c: { url: "https://c.example", headersHelper: "/bin/h" },
    });
    expect(mapList).toEqual([
      expect.objectContaining({
        name: "c",
        headersHelper: "/bin/h",
        source: "mdm",
      }),
    ]);
  });

  it("parses http/sse only and mutual-excludes oauth+headers", () => {
    expect(
      parseHttpSseMcpConfig("a", {
        type: "http",
        url: "https://mcp.example/a",
      }),
    ).toMatchObject({
      name: "a",
      url: "https://mcp.example/a",
      source: "org-plugin",
    });
    expect(
      parseHttpSseMcpConfig("b", {
        type: "stdio",
        command: "npx",
      }),
    ).toBeNull();
    expect(
      parseHttpSseMcpConfig("c", {
        type: "http",
        url: "https://mcp.example",
        oauth: { clientId: "x" },
        headers: { a: "1" },
      }),
    ).toBeNull();
  });

  it("nai normalizes oauth bag", () => {
    expect(normalizePluginOAuth(true)).toBe(true);
    expect(normalizePluginOAuth({ clientId: "id", scope: "s" })).toEqual({
      clientId: "id",
      scope: "s",
    });
    expect(
      normalizePluginOAuth({ clientId: "id", tenantId: "t", scope: "s" }),
    ).toEqual({ clientId: "id", tenantId: "t", scope: "s" });
    // tenantId without scope dropped
    expect(normalizePluginOAuth({ clientId: "id", tenantId: "t" })).toEqual({
      clientId: "id",
    });
  });

  it("mergePluginMcpConfigs drops collisions", () => {
    const merged = mergePluginMcpConfigs(
      [{ name: "a", url: "https://a" }],
      [
        { name: "a", url: "https://plugin-a" },
        { name: "b", url: "https://b" },
      ],
    );
    expect(merged.map((m) => m.name)).toEqual(["a", "b"]);
    expect(merged[0]?.url).toBe("https://a");
  });

  it("scans plugin dir .mcp.json for http remotes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oce-plugin-"));
    await fs.writeFile(
      path.join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          remote: { type: "sse", url: "https://mcp.example/sse" },
          local: { command: "npx", args: ["-y", "x"] },
        },
      }),
      "utf8",
    );
    const found = await scanPluginDirForMcp(dir, "demo");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      name: "remote",
      url: "https://mcp.example/sse",
      transport: "sse",
      source: "org-plugin",
    });
  });

  it("scans .claude-plugin/plugin.json relative nested mcp path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oce-plugin-nested-"));
    const nested = path.join(dir, "mcp");
    await fs.mkdir(nested, { recursive: true });
    await fs.mkdir(path.join(dir, ".claude-plugin"), { recursive: true });
    await fs.writeFile(
      path.join(nested, ".mcp.json"),
      JSON.stringify({
        nested: { type: "http", url: "https://mcp.example/nested" },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: "demo",
        mcpServers: {
          nestedPath: "mcp",
        },
      }),
      "utf8",
    );
    const found = await scanPluginDirForMcp(dir, "demo");
    expect(found).toEqual([
      expect.objectContaining({
        name: "nested",
        url: "https://mcp.example/nested",
        source: "org-plugin",
      }),
    ]);
  });

  it("oce respects enabledPlugins name@org-provisioned", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "oce-root-"));
    const plugin = path.join(root, "acme");
    await fs.mkdir(plugin);
    await fs.writeFile(
      path.join(plugin, ".mcp.json"),
      JSON.stringify({
        demo: { type: "http", url: "https://mcp.example/demo" },
      }),
      "utf8",
    );
    const disabled = await scanOrgPluginMcpServers({
      enterpriseActive: true,
      orgPluginsRoot: root,
      enabledPlugins: {},
    });
    expect(disabled).toEqual([]);

    const enabled = await scanOrgPluginMcpServers({
      enterpriseActive: true,
      orgPluginsRoot: root,
      enabledPlugins: { "acme@org-provisioned": true },
    });
    expect(enabled).toEqual([
      expect.objectContaining({
        name: "demo",
        url: "https://mcp.example/demo",
        source: "org-plugin",
      }),
    ]);
  });
});
