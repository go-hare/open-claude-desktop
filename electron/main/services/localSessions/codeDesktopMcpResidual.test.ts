import { describe, expect, it } from "vitest";
import {
  loadOfficialAlMcpServers,
  mergeCodeQueryMcpServers,
} from "./codeDesktopMcpResidual";

describe("codeDesktopMcpResidual (official al + managed merge)", () => {
  it("al() keeps e6e extensions when InA is false (official still merges e6e first)", () => {
    expect(
      loadOfficialAlMcpServers({
        isLocalDevMcpEnabled: false,
        getExtensionMcpServers: () => ({
          Echo: { command: "node", args: ["/ext/index.js"] },
        }),
        getDesktopMcpServers: () => ({
          teambition: { type: "http", url: "https://example" },
        }),
      }),
    ).toEqual({
      Echo: { command: "node", args: ["/ext/index.js"] },
    });
  });

  it("al() returns desktop bag when InA is true", () => {
    const bag = { local: { command: "npx", args: ["-y", "demo"] } };
    expect(
      loadOfficialAlMcpServers({
        isLocalDevMcpEnabled: true,
        getExtensionMcpServers: () => ({}),
        getDesktopMcpServers: () => bag,
      }),
    ).toEqual(bag);
  });

  it("al() lets desktop bag overlay same-name e6e extension", () => {
    expect(
      loadOfficialAlMcpServers({
        isLocalDevMcpEnabled: true,
        getExtensionMcpServers: () => ({
          local: { command: "from-dxt" },
        }),
        getDesktopMcpServers: () => ({
          local: { command: "from-bag" },
        }),
      }),
    ).toEqual({ local: { command: "from-bag" } });
  });

  it("merges desktop + managed + session + preview without inventing empty", () => {
    const merged = mergeCodeQueryMcpServers({
      sessionMcp: { session: { type: "http", url: "http://s" } },
      previewMcp: { "Claude Preview": { type: "http", url: "http://p" } },
      deps: {
        isLocalDevMcpEnabled: true,
        getExtensionMcpServers: () => ({}),
        getDesktopMcpServers: () => ({
          desktop: { command: "uvx", args: ["mcp"] },
        }),
        getManagedMcpServers: () => [
          { name: "teambition", url: "https://open.teambition.com/api/mcp" },
        ],
      },
    });
    expect(merged.desktop).toEqual({ command: "uvx", args: ["mcp"] });
    expect(merged.teambition).toEqual({
      type: "http",
      url: "https://open.teambition.com/api/mcp",
    });
    expect(merged.session).toEqual({ type: "http", url: "http://s" });
    expect(merged["Claude Preview"]).toEqual({ type: "http", url: "http://p" });
  });

  it("Cowork merge skips e6e when includeExtensionMcp is false", () => {
    expect(
      mergeCodeQueryMcpServers({
        deps: {
          includeExtensionMcp: false,
          isLocalDevMcpEnabled: false,
          getExtensionMcpServers: () => ({ Echo: { command: "node" } }),
          getManagedMcpServers: () => [],
        },
      }),
    ).toEqual({});
  });

  it("session overlay wins over desktop same name", () => {
    const merged = mergeCodeQueryMcpServers({
      requestMcp: { teambition: { type: "http", url: "http://session" } },
      deps: {
        isLocalDevMcpEnabled: true,
        getExtensionMcpServers: () => ({}),
        getDesktopMcpServers: () => ({
          teambition: { type: "http", url: "http://desktop" },
        }),
        getManagedMcpServers: () => [
          { name: "teambition", url: "https://managed" },
        ],
      },
    });
    expect(merged.teambition).toEqual({ type: "http", url: "http://session" });
  });
});
