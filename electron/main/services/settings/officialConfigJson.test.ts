import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OFFICIAL_APP_CONFIG_FILENAME,
  parseOfficialConfigFileContent,
  readOfficialAppConfigFile,
  readOfficialPreferencesSegment,
  resolveOfficialAppConfigPath,
  writeOfficialAppConfigFile,
  writeOfficialGlobalShortcutSegment,
  writeOfficialPreferencesSegment,
} from "./officialConfigJson";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "official-cfg-"));
  temps.push(dir);
  return dir;
}

describe("official claude_desktop_config.json residual", () => {
  it("resolves Fb path under userData", () => {
    expect(resolveOfficialAppConfigPath("/tmp/ud")).toBe(
      path.join("/tmp/ud", OFFICIAL_APP_CONFIG_FILENAME),
    );
    expect(OFFICIAL_APP_CONFIG_FILENAME).toBe("claude_desktop_config.json");
  });

  it("writes preferences without clobbering mcpServers", () => {
    const dir = mkDir();
    const file = resolveOfficialAppConfigPath(dir);
    fs.writeFileSync(
      file,
      JSON.stringify({ mcpServers: { a: { command: "x" } }, other: 1 }),
    );
    writeOfficialPreferencesSegment(file, { keepAwakeEnabled: true });
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      preferences: { keepAwakeEnabled: boolean };
      mcpServers: unknown;
      other: number;
    };
    expect(raw.preferences.keepAwakeEnabled).toBe(true);
    expect(raw.mcpServers).toEqual({ a: { command: "x" } });
    expect(raw.other).toBe(1);
  });

  it("reads preferences segment; null when missing", () => {
    const dir = mkDir();
    const file = resolveOfficialAppConfigPath(dir);
    expect(readOfficialPreferencesSegment(file)).toBeNull();
    writeOfficialPreferencesSegment(file, { sidebarMode: "code" });
    expect(readOfficialPreferencesSegment(file)).toEqual({
      sidebarMode: "code",
    });
  });

  it("globalShortcut dual-write residual", () => {
    const dir = mkDir();
    const file = resolveOfficialAppConfigPath(dir);
    writeOfficialGlobalShortcutSegment(file, "Alt+Space");
    expect(JSON.parse(fs.readFileSync(file, "utf8")).globalShortcut).toBe(
      "Alt+Space",
    );
    writeOfficialGlobalShortcutSegment(file, null);
    expect(
      Object.prototype.hasOwnProperty.call(
        JSON.parse(fs.readFileSync(file, "utf8")),
        "globalShortcut",
      ),
    ).toBe(false);
  });

  it("Hne validate on read filters bad mcp; keeps good", () => {
    const dir = mkDir();
    const file = resolveOfficialAppConfigPath(dir);
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          good: { command: "echo" },
          bad: { notAServer: true },
        },
        preferences: { sidebarMode: "task" },
      }),
    );
    const invalid: string[] = [];
    const cfg = readOfficialAppConfigFile(file, {
      onInvalidMcpServers: (names) => {
        invalid.push(...names);
      },
    });
    expect(invalid).toEqual(["bad"]);
    expect(cfg.mcpServers).toEqual({ good: { command: "echo" } });
    expect(cfg.preferences?.sidebarMode).toBe("task");
  });

  it("parseOfficialConfigFileContent empty on invalid root", () => {
    const r = parseOfficialConfigFileContent("nope");
    expect(r.ok).toBe(false);
    expect(r.data).toEqual({});
  });

  it("writeOfficialAppConfigFile does not clobber on mixed Hne+MCP failure", () => {
    const dir = mkDir();
    const file = resolveOfficialAppConfigPath(dir);
    const original = {
      claudeAiUrl: "https://claude.ai",
      mcpServers: { keep: { command: "echo" } },
      preferences: { sidebarMode: "code" },
    };
    fs.writeFileSync(file, JSON.stringify(original, null, 2));

    // Invalid deploymentMode + only-bad MCP → total Hne failure after filter.
    const result = writeOfficialAppConfigFile(file, {
      deploymentMode: "hosted",
      mcpServers: { bad: { notAServer: true } },
    });
    expect(result.ok).toBe(false);
    expect(result.invalidMcpServers).toEqual(["bad"]);
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as typeof original;
    expect(onDisk).toEqual(original);
  });

  it("writeOfficialAppConfigFile writes after MCP filter success", () => {
    const dir = mkDir();
    const file = resolveOfficialAppConfigPath(dir);
    const result = writeOfficialAppConfigFile(file, {
      deploymentMode: "3p",
      mcpServers: {
        good: { command: "echo" },
        bad: { noCommand: true },
      },
      preferences: { keepAwakeEnabled: false },
    });
    expect(result.ok).toBe(true);
    expect(result.invalidMcpServers).toEqual(["bad"]);
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as {
      mcpServers: Record<string, unknown>;
      deploymentMode: string;
    };
    expect(onDisk.deploymentMode).toBe("3p");
    expect(onDisk.mcpServers).toEqual({ good: { command: "echo" } });
  });
});
