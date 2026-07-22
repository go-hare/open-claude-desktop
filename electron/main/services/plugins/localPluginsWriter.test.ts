import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectCoworkReadOnlyPluginPaths,
} from "../coworkSessions/coworkReadOnlyPluginPaths";
import {
  addLocalDirectoryMarketplace,
  ensureLocalUploadMarketplace,
  installPluginByIdFromDisk,
  installPluginFromDirectory,
  installPluginFromZip,
  listAvailableLocalMarketplacePlugins,
  listInstalledPluginsFromDisk,
  listKnownMarketplaces,
  LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE,
  resolveLocalMarketplaceInput,
  resolveLocalPluginsPaths,
  resolvePluginsAccountCtx,
  uninstallPluginFromDisk,
  validatePluginJson,
  writeMinimalPluginFixture,
} from "./localPluginsWriter";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-plugins-"));
  temps.push(dir);
  return dir;
}

function pathsFor(userData: string) {
  return resolveLocalPluginsPaths(userData, {
    accountId: "acct",
    orgId: "org",
  });
}

describe("validatePluginJson", () => {
  it("accepts kebab-case name", () => {
    expect(validatePluginJson({ name: "demo-plugin" }).valid).toBe(true);
  });

  it("rejects missing / invalid names", () => {
    expect(validatePluginJson(null).valid).toBe(false);
    expect(validatePluginJson({ name: "Not_Valid" }).valid).toBe(false);
  });
});

describe("resolvePluginsAccountCtx", () => {
  it("falls back to local-desktop so installs always land on disk", () => {
    expect(resolvePluginsAccountCtx({})).toEqual({
      accountId: "local-desktop",
      orgId: "local-default",
    });
    expect(
      resolvePluginsAccountCtx({ allowFallback: false }),
    ).toBeNull();
    expect(
      resolvePluginsAccountCtx({
        identity: { accountUuid: "a", organizationUuid: "o" },
      }),
    ).toEqual({ accountId: "a", orgId: "o" });
  });
});

describe("local upload marketplace + install", () => {
  it("ensureLocalUploadMarketplace writes known_marketplaces + marketplace.json", () => {
    const userData = mkDir();
    const paths = pathsFor(userData);
    ensureLocalUploadMarketplace(paths);
    expect(
      fs.existsSync(
        path.join(
          paths.marketplacesDir,
          LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE,
          ".claude-plugin",
          "marketplace.json",
        ),
      ),
    ).toBe(true);
    const known = JSON.parse(
      fs.readFileSync(paths.knownMarketplacesFile, "utf8"),
    ) as Record<string, { source: { source: string } }>;
    expect(known[LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE]?.source.source).toBe(
      "directory",
    );
  });

  it("installPluginFromDirectory writes installed_plugins + enabledPlugins", () => {
    const userData = mkDir();
    const paths = pathsFor(userData);
    const fixtureRoot = mkDir();
    const pluginDir = writeMinimalPluginFixture(fixtureRoot, {
      name: "demo-plugin",
      version: "1.2.3",
    });
    const result = installPluginFromDirectory(paths, pluginDir);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.pluginId).toBe(
      `demo-plugin@${LOCAL_DESKTOP_APP_UPLOADS_MARKETPLACE}`,
    );
    expect(fs.existsSync(result.installPath)).toBe(true);
    expect(
      fs.existsSync(
        path.join(result.installPath, ".claude-plugin", "plugin.json"),
      ),
    ).toBe(true);

    const installed = listInstalledPluginsFromDisk(paths);
    expect(installed.map((p) => p.id)).toContain(result.pluginId);

    const settings = JSON.parse(
      fs.readFileSync(paths.settingsFile, "utf8"),
    ) as { enabledPlugins: Record<string, boolean> };
    expect(settings.enabledPlugins[result.pluginId]).toBe(true);

    // Session path collect residual must see installPath.
    const collected = collectCoworkReadOnlyPluginPaths({
      accountId: "acct",
      orgId: "org",
      userDataPath: userData,
      remotePluginPathsEnabled: false,
    });
    expect(collected).toContain(path.resolve(result.installPath));
  });

  it("refuses second install without replaceExisting", () => {
    const userData = mkDir();
    const paths = pathsFor(userData);
    const fixtureRoot = mkDir();
    const pluginDir = writeMinimalPluginFixture(fixtureRoot, {
      name: "once-plugin",
    });
    expect(installPluginFromDirectory(paths, pluginDir).success).toBe(true);
    const second = installPluginFromDirectory(paths, pluginDir);
    expect(second.success).toBe(false);
    const replaced = installPluginFromDirectory(paths, pluginDir, {
      replaceExisting: true,
    });
    expect(replaced.success).toBe(true);
  });

  it("installPluginFromZip extracts and installs", () => {
    const userData = mkDir();
    const paths = pathsFor(userData);
    const pluginJson = JSON.stringify({
      name: "zip-plugin",
      version: "0.1.0",
      description: "from zip",
    });
    const zipped = zipSync({
      ".claude-plugin/plugin.json": Buffer.from(pluginJson, "utf8"),
      "commands/hello.md": Buffer.from("# hello\n", "utf8"),
    });
    const result = installPluginFromZip(paths, Buffer.from(zipped));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.pluginName).toBe("zip-plugin");
    expect(
      fs.existsSync(
        path.join(result.installPath, "commands", "hello.md"),
      ),
    ).toBe(true);
  });

  it("uninstall removes disk tree + manifest entry", () => {
    const userData = mkDir();
    const paths = pathsFor(userData);
    const fixtureRoot = mkDir();
    const pluginDir = writeMinimalPluginFixture(fixtureRoot, {
      name: "bye-plugin",
    });
    const result = installPluginFromDirectory(paths, pluginDir);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(uninstallPluginFromDisk(paths, result.pluginId)).toBe(true);
    expect(fs.existsSync(result.installPath)).toBe(false);
    expect(listInstalledPluginsFromDisk(paths)).toEqual([]);
  });
});

describe("custom directory marketplace residual", () => {
  it("addLocalDirectoryMarketplace scans plugins and install-by-id works", () => {
    const userData = mkDir();
    const paths = pathsFor(userData);
    const marketSrc = mkDir();
    writeMinimalPluginFixture(marketSrc, {
      name: "market-tool",
      version: "2.0.0",
      description: "from custom market",
    });
    // Also write marketplace.json for realism
    fs.mkdirSync(path.join(marketSrc, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(marketSrc, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "my-local-market",
        version: "1.0.0",
        plugins: [{ name: "market-tool", version: "2.0.0", source: "./market-tool" }],
      }),
    );

    const added = addLocalDirectoryMarketplace(paths, {
      name: "my-local-market",
      directoryPath: marketSrc,
    });
    expect(added.success).toBe(true);
    if (!added.success) return;
    expect(added.marketplace.id).toBe("my-local-market");

    const listed = listKnownMarketplaces(paths);
    expect(listed.some((m) => m.id === "my-local-market")).toBe(true);

    const available = listAvailableLocalMarketplacePlugins(paths);
    expect(
      available.some((p) => p.id === "market-tool@my-local-market"),
    ).toBe(true);

    const installed = installPluginByIdFromDisk(
      paths,
      "market-tool@my-local-market",
    );
    expect(installed.success).toBe(true);
    if (!installed.success) return;
    expect(installed.pluginId).toBe("market-tool@my-local-market");
    expect(fs.existsSync(installed.installPath)).toBe(true);
  });

  it("resolveLocalMarketplaceInput accepts file:// and absolute paths only", () => {
    const dir = mkDir();
    expect(resolveLocalMarketplaceInput("lab", dir)).toEqual({
      kind: "directory",
      name: "lab",
      directoryPath: path.resolve(dir),
    });
    expect(
      resolveLocalMarketplaceInput("lab", `file://${dir}`).kind,
    ).toBe("directory");
    const remote = resolveLocalMarketplaceInput(
      "lab",
      "https://github.com/example/market.git",
    );
    expect(remote.kind).toBe("unsupported");
  });

  it("does not invent remote marketplace install", () => {
    const userData = mkDir();
    const paths = pathsFor(userData);
    const result = installPluginByIdFromDisk(paths, "missing@nowhere");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/not registered locally|not found/i);
  });
});
