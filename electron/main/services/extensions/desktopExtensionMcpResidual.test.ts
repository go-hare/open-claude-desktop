import { describe, expect, it } from "vitest";
import {
  buildExtensionMcpConfig,
  extensionMissingRequiredUserConfig,
  loadOfficialE6eMcpServers,
  substituteExtensionMcpConfig,
} from "./desktopExtensionMcpResidual";
import type { InstalledExtension } from "./desktopExtensions";

function ext(overrides: Partial<InstalledExtension> = {}): InstalledExtension {
  return {
    id: "local.dxt.demo.echo",
    path: "/tmp/extensions/echo",
    displayName: "Echo",
    manifest: {
      manifest_version: "0.2",
      name: "echo",
      display_name: "Echo",
      version: "1.0.0",
      description: "echo",
      author: { name: "demo" },
      server: {
        type: "node",
        entry_point: "index.js",
        mcp_config: {
          command: "node",
          args: ["${__dirname}/index.js"],
        },
      },
    },
    settings: { isEnabled: true },
    ...overrides,
  };
}

describe("desktopExtensionMcpResidual (official e6e / bqt / YSA)", () => {
  it("YSA substitutes ${__dirname} and expands user_config arrays in args", () => {
    expect(
      substituteExtensionMcpConfig(
        { command: "node", args: ["${__dirname}/srv.js", "${user_config.roots}"] },
        { __dirname: "/ext", "user_config.roots": ["a", "b"] },
      ),
    ).toEqual({ command: "node", args: ["/ext/srv.js", "a", "b"] });
  });

  it("zOe skips when required user_config is empty", () => {
    const manifest = ext().manifest;
    (manifest as Record<string, unknown>).user_config = {
      token: { type: "string", title: "Token", required: true },
    };
    expect(extensionMissingRequiredUserConfig(manifest, {})).toBe(true);
    expect(extensionMissingRequiredUserConfig(manifest, { token: "x" })).toBe(false);
  });

  it("e6e is empty when extensions are disabled", () => {
    expect(
      loadOfficialE6eMcpServers({
        extensionsEnabled: false,
        getInstalledExtensions: () => [ext()],
      }),
    ).toEqual({});
  });

  it("e6e keys by display_name and skips disabled / org-blocked", () => {
    const bag = loadOfficialE6eMcpServers({
      extensionsEnabled: true,
      homedir: "/home/u",
      getInstalledExtensions: () => [
        ext(),
        ext({
          id: "local.dxt.demo.off",
          displayName: "Off",
          manifest: { ...ext().manifest, name: "off", display_name: "Off" },
          settings: { isEnabled: false },
        }),
        ext({
          id: "local.dxt.demo.blocked",
          displayName: "Blocked",
          manifest: { ...ext().manifest, name: "blocked", display_name: "Blocked" },
          settings: { isEnabled: true, orgBlockedReason: "policy" },
        }),
      ],
    });
    expect(Object.keys(bag)).toEqual(["Echo"]);
    expect(bag.Echo).toMatchObject({
      command: "node",
      args: ["/tmp/extensions/echo/index.js"],
      extensionId: "local.dxt.demo.echo",
    });
  });

  it("duplicate display_name uses extension id as bag key (official rYi)", () => {
    const first = ext();
    const second = ext({
      id: "local.dxt.other.echo",
      path: "/tmp/extensions/echo-2",
    });
    const bag = loadOfficialE6eMcpServers({
      extensionsEnabled: true,
      getInstalledExtensions: () => [first, second],
    });
    expect(Object.keys(bag).sort()).toEqual(["Echo", "local.dxt.other.echo"]);
  });

  it("bqt applies win32 platform_overrides", () => {
    const extension = ext({
      manifest: {
        ...ext().manifest,
        server: {
          type: "node",
          entry_point: "index.js",
          mcp_config: {
            command: "node",
            args: ["srv.js"],
            platform_overrides: {
              win32: { command: "node.exe" },
            },
          },
        },
      },
    });
    const config = buildExtensionMcpConfig(extension, { platform: "win32" });
    expect(config?.command).toBe("node.exe");
  });
});

