import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  DOT_CLAUDE_SETUP_CONFIG_ID,
  DOT_CLAUDE_SETUP_CONFIG_NAME,
  isDotClaudeSetupConfigId,
  listDotClaudeAsConfigLibrary,
  mapDotClaudeEnvToGatewayBag,
  readDotClaudeAsConfigLibrary,
  writeDotClaudeAsConfigLibrary,
  writeGatewayBagIntoDotClaudeSettings,
} from "./dotClaudeSetupBridge";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempHome(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSettings(home: string, root: unknown): string {
  const settingsPath = path.join(home, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(root, null, 2)}\n`, "utf8");
  return settingsPath;
}

it("isDotClaudeSetupConfigId accepts only the virtual projection id", () => {
  expect(isDotClaudeSetupConfigId(DOT_CLAUDE_SETUP_CONFIG_ID)).toBe(true);
  expect(isDotClaudeSetupConfigId("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(false);
  expect(isDotClaudeSetupConfigId(null)).toBe(false);
});

it("mapDotClaudeEnvToGatewayBag projects base URL, token, and models", () => {
  const bag = mapDotClaudeEnvToGatewayBag(
    {
      ANTHROPIC_BASE_URL: "http://204.44.121.220:8317/",
      ANTHROPIC_AUTH_TOKEN: "sk-test",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "grok-4.5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k2",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4",
    },
    { settingsPath: "/tmp/settings.json" },
  );
  expect(bag.inferenceProvider).toBe("gateway");
  expect(bag.inferenceGatewayBaseUrl).toBe("http://204.44.121.220:8317/");
  expect(bag.inferenceGatewayApiKey).toBe("sk-test");
  expect(bag.inferenceGatewayAuthScheme).toBe("bearer");
  expect(bag.__dotClaudeSettingsPath).toBe("/tmp/settings.json");
  expect(bag.inferenceModels).toEqual([
    { name: "grok-4.5", supports1m: false },
    { name: "kimi-k2", supports1m: false },
    { name: "glm-4", supports1m: false },
  ]);
});

it("mapDotClaudeEnvToGatewayBag falls back to API_KEY when AUTH_TOKEN missing", () => {
  const bag = mapDotClaudeEnvToGatewayBag({
    ANTHROPIC_BASE_URL: "https://api.example.com",
    ANTHROPIC_API_KEY: "key-only",
  });
  expect(bag.inferenceGatewayApiKey).toBe("key-only");
});

it("writeGatewayBagIntoDotClaudeSettings merges env and preserves unrelated fields", () => {
  const home = tempHome("dotclaude-write-");
  const settingsPath = writeSettings(home, {
    env: {
      ANTHROPIC_BASE_URL: "http://old.example/",
      ANTHROPIC_AUTH_TOKEN: "old-token",
      HTTP_PROXY: "http://127.0.0.1:12000",
    },
    theme: "light",
    permissions: { defaultMode: "auto" },
  });

  const result = writeGatewayBagIntoDotClaudeSettings(
    {
      inferenceGatewayBaseUrl: "http://204.44.121.220:8317/",
      inferenceGatewayApiKey: "sk-new",
      inferenceModels: [
        { name: "grok-4.5" },
        { name: "kimi-k2" },
        { name: "glm-4" },
      ],
    },
    settingsPath,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
    env: Record<string, string>;
    theme: string;
    permissions: { defaultMode: string };
  };
  expect(parsed.theme).toBe("light");
  expect(parsed.permissions.defaultMode).toBe("auto");
  expect(parsed.env.HTTP_PROXY).toBe("http://127.0.0.1:12000");
  expect(parsed.env.ANTHROPIC_BASE_URL).toBe("http://204.44.121.220:8317/");
  expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-new");
  expect(parsed.env.ANTHROPIC_MODEL).toBe("grok-4.5");
  expect(parsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("grok-4.5");
  expect(parsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("kimi-k2");
  expect(parsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("glm-4");
});

it("writeGatewayBagIntoDotClaudeSettings requires base URL and API key", () => {
  const home = tempHome("dotclaude-req-");
  const settingsPath = path.join(home, ".claude", "settings.json");
  expect(writeGatewayBagIntoDotClaudeSettings({}, settingsPath).ok).toBe(false);
  expect(
    writeGatewayBagIntoDotClaudeSettings(
      { inferenceGatewayBaseUrl: "http://x" },
      settingsPath,
    ).ok,
  ).toBe(false);
});

it("list/read/writeDotClaudeAsConfigLibrary project the live CLI file", () => {
  const home = tempHome("dotclaude-lib-");
  writeSettings(home, {
    env: {
      ANTHROPIC_BASE_URL: "http://204.44.121.220:8317/",
      ANTHROPIC_AUTH_TOKEN: "sk-live",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "grok-4.5",
    },
  });

  const listed = listDotClaudeAsConfigLibrary(home);
  expect(listed.appliedId).toBe(DOT_CLAUDE_SETUP_CONFIG_ID);
  expect(listed.entries).toHaveLength(1);
  expect(listed.entries[0]?.id).toBe(DOT_CLAUDE_SETUP_CONFIG_ID);
  expect(listed.entries[0]?.name).toBe(DOT_CLAUDE_SETUP_CONFIG_NAME);
  expect(listed.entries[0]?.provider).toBe("gateway");
  expect(listed.entries[0]?.note).toContain("204.44.121.220");

  const read = readDotClaudeAsConfigLibrary(home);
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  expect(read.config.inferenceGatewayBaseUrl).toBe("http://204.44.121.220:8317/");
  expect(read.config.inferenceGatewayApiKey).toBe("sk-live");
  expect(read.config.inferenceModels).toEqual([{ name: "grok-4.5", supports1m: false }]);

  const written = writeDotClaudeAsConfigLibrary(
    {
      inferenceGatewayBaseUrl: "http://new-host:9000/",
      inferenceGatewayApiKey: "sk-updated",
      inferenceModels: [{ name: "grok-4.5" }],
    },
    home,
  );
  expect(written.ok).toBe(true);

  const reread = readDotClaudeAsConfigLibrary(home);
  expect(reread.ok).toBe(true);
  if (!reread.ok) return;
  expect(reread.config.inferenceGatewayBaseUrl).toBe("http://new-host:9000/");
  expect(reread.config.inferenceGatewayApiKey).toBe("sk-updated");

  // Unrelated top-level keys stay; only env routing fields change.
  const disk = JSON.parse(
    fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"),
  ) as { env: Record<string, string> };
  expect(disk.env.ANTHROPIC_BASE_URL).toBe("http://new-host:9000/");
});

it("readDotClaudeAsConfigLibrary returns empty gateway form when file missing", () => {
  const home = tempHome("dotclaude-missing-");
  const read = readDotClaudeAsConfigLibrary(home);
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  expect(read.config.inferenceProvider).toBe("gateway");
  expect(read.config.inferenceGatewayBaseUrl).toBe("");
  expect(read.config.inferenceGatewayApiKey).toBe("");
});
