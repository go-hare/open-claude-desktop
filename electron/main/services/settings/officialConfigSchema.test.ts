import { describe, expect, it } from "vitest";
import {
  filterInvalidMcpServers,
  isValidOfficialMcpServer,
  parseOfficialAppConfig,
  stripLegacySidebarOperon,
} from "./officialConfigSchema";

describe("official Hne / VWt residual", () => {
  it("accepts minimal valid config", () => {
    const r = parseOfficialAppConfig({
      globalShortcut: "Alt+Space",
      preferences: { keepAwakeEnabled: true, sidebarMode: "code" },
      mcpServers: { echo: { command: "echo", args: ["hi"] } },
      deploymentMode: "3p",
    });
    expect(r.ok).toBe(true);
    expect(r.usedFallback).toBe(false);
    expect(r.data.globalShortcut).toBe("Alt+Space");
    expect(r.data.preferences?.keepAwakeEnabled).toBe(true);
    expect(r.data.mcpServers?.echo).toEqual({
      command: "echo",
      args: ["hi"],
    });
  });

  it("strips legacy sidebarMode operon (jWt)", () => {
    const raw = {
      preferences: { sidebarMode: "operon", keepAwakeEnabled: false },
    };
    stripLegacySidebarOperon(raw);
    expect(raw.preferences.sidebarMode).toBeUndefined();
    const r = parseOfficialAppConfig({
      preferences: { sidebarMode: "operon" },
    });
    expect(r.ok).toBe(true);
    expect(r.data.preferences?.sidebarMode).toBeUndefined();
  });

  it("$Wt filters invalid MCP servers and keeps valid ones", () => {
    const { filteredConfig, invalidServers } = filterInvalidMcpServers({
      mcpServers: {
        good: { command: "node", args: ["x.js"] },
        bad: { url: "http://example" },
        alsoBad: 42,
      },
    });
    expect(invalidServers.sort()).toEqual(["alsoBad", "bad"]);
    expect(
      (filteredConfig as { mcpServers: Record<string, unknown> }).mcpServers
        .good,
    ).toEqual({ command: "node", args: ["x.js"] });
  });

  it("parse recovers via mcp filter (official VWt path)", () => {
    const r = parseOfficialAppConfig({
      mcpServers: {
        ok: { command: "uvx", args: ["mcp"] },
        broken: { noCommand: true },
      },
      preferences: { wakeSchedulerEnabled: false },
    });
    expect(r.ok).toBe(true);
    expect(r.invalidMcpServers).toEqual(["broken"]);
    expect(r.data.mcpServers).toEqual({
      ok: { command: "uvx", args: ["mcp"] },
    });
  });

  it("rejects non-object root with empty fallback", () => {
    const r = parseOfficialAppConfig(["not", "object"]);
    expect(r.ok).toBe(false);
    expect(r.usedFallback).toBe(true);
    expect(r.data).toEqual({});
  });

  it("deploymentMode only 3p|1p", () => {
    const bad = parseOfficialAppConfig({ deploymentMode: "hosted" });
    // passthrough object with invalid enum fails Hne
    expect(bad.ok || bad.usedFallback).toBeTruthy();
    if (bad.ok) {
      // if zod strips somehow — must not invent hosted
      expect(bad.data.deploymentMode).not.toBe("hosted");
    }
    const good = parseOfficialAppConfig({ deploymentMode: "1p" });
    expect(good.ok).toBe(true);
    expect(good.data.deploymentMode).toBe("1p");
  });

  it("BV validator residual", () => {
    expect(isValidOfficialMcpServer({ command: "x" })).toBe(true);
    expect(isValidOfficialMcpServer({ command: "x", env: { A: "1" } })).toBe(
      true,
    );
    expect(isValidOfficialMcpServer({ url: "http://x" })).toBe(false);
    expect(isValidOfficialMcpServer(null)).toBe(false);
  });

  it("does not invent requireCoworkFullVmSandbox in enterprise", () => {
    const r = parseOfficialAppConfig({
      enterpriseConfig: { remote: { foo: 1 } },
    });
    expect(r.ok).toBe(true);
    expect(r.data.enterpriseConfig).toEqual({ remote: { foo: 1 } });
    expect(
      Object.prototype.hasOwnProperty.call(
        r.data.preferences ?? {},
        "requireCoworkFullVmSandbox",
      ),
    ).toBe(false);
  });
});
