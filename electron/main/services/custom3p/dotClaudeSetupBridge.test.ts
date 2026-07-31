import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  DOT_CLAUDE_DESKTOP_SETUP_BAG_KEY,
  DOT_CLAUDE_SETUP_CONFIG_ID,
  DOT_CLAUDE_SETUP_CONFIG_NAME,
  isDotClaudeSetupConfigId,
  listDotClaudeAsConfigLibrary,
  mapDotClaudeEnvToGatewayBag,
  parseAnthropicCustomHeaders,
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

it("parseAnthropicCustomHeaders reverses SPe serialization", () => {
  expect(parseAnthropicCustomHeaders("X-Org: a|X-Tenant: b")).toEqual({
    "X-Org": "a",
    "X-Tenant": "b",
  });
  expect(parseAnthropicCustomHeaders("")).toBeUndefined();
});

it("mapDotClaudeEnvToGatewayBag projects base URL, token, headers, and models", () => {
  const bag = mapDotClaudeEnvToGatewayBag(
    {
      ANTHROPIC_BASE_URL: "http://204.44.121.220:8317/",
      ANTHROPIC_AUTH_TOKEN: "sk-test",
      ANTHROPIC_CUSTOM_HEADERS: "X-Org: acme|X-Route: east",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "grok-4.5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k2",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4",
      DISABLE_TELEMETRY: "1",
    },
    { settingsPath: "/tmp/settings.json" },
  );
  expect(bag.inferenceProvider).toBe("gateway");
  expect(bag.inferenceGatewayBaseUrl).toBe("http://204.44.121.220:8317/");
  expect(bag.inferenceGatewayApiKey).toBe("sk-test");
  expect(bag.inferenceGatewayAuthScheme).toBe("bearer");
  expect(bag.inferenceGatewayHeaders).toEqual({ "X-Org": "acme", "X-Route": "east" });
  expect(bag.disableNonessentialTelemetry).toBe(true);
  expect(bag.__dotClaudeSettingsPath).toBe("/tmp/settings.json");
  expect(bag.inferenceModels).toEqual([
    { name: "grok-4.5", supports1m: false },
    { name: "kimi-k2", supports1m: false },
    { name: "glm-4", supports1m: false },
  ]);
});

it("mapDotClaudeEnvToGatewayBag falls back to API_KEY as x-api-key when AUTH_TOKEN missing", () => {
  const bag = mapDotClaudeEnvToGatewayBag({
    ANTHROPIC_BASE_URL: "https://api.example.com",
    ANTHROPIC_API_KEY: "key-only",
  });
  expect(bag.inferenceGatewayApiKey).toBe("key-only");
  expect(bag.inferenceGatewayAuthScheme).toBe("x-api-key");
});

it("mapDotClaudeEnvToGatewayBag projects bedrock provider flags", () => {
  const bag = mapDotClaudeEnvToGatewayBag({
    CLAUDE_CODE_USE_BEDROCK: "1",
    AWS_REGION: "us-west-2",
    AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
    ANTHROPIC_BEDROCK_BASE_URL: "https://bedrock.example",
  });
  expect(bag.inferenceProvider).toBe("bedrock");
  expect(bag.inferenceBedrockRegion).toBe("us-west-2");
  expect(bag.inferenceBedrockBearerToken).toBe("bedrock-token");
  expect(bag.inferenceBedrockBaseUrl).toBe("https://bedrock.example");
});

it("mapDotClaudeEnvToGatewayBag merges product desktop-only extension bag", () => {
  const bag = mapDotClaudeEnvToGatewayBag(
    { ANTHROPIC_BASE_URL: "http://x/", ANTHROPIC_AUTH_TOKEN: "t" },
    {
      desktopBag: {
        allowedWorkspaceFolders: ["/Users/me/work"],
        coworkEgressAllowedHosts: ["*.example.com"],
        inferenceMaxTokensPerWindow: 100000,
      },
    },
  );
  expect(bag.allowedWorkspaceFolders).toEqual(["/Users/me/work"]);
  expect(bag.coworkEgressAllowedHosts).toEqual(["*.example.com"]);
  expect(bag.inferenceMaxTokensPerWindow).toBe(100000);
});

it("writeGatewayBagIntoDotClaudeSettings merges env headers/scheme and preserves unrelated fields", () => {
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
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "http://204.44.121.220:8317/",
      inferenceGatewayApiKey: "sk-new",
      inferenceGatewayAuthScheme: "bearer",
      inferenceGatewayHeaders: { "X-Org": "acme" },
      disableNonessentialTelemetry: true,
      disableAutoUpdates: true,
      inferenceModels: [
        { name: "grok-4.5" },
        { name: "kimi-k2" },
        { name: "glm-4" },
      ],
      allowedWorkspaceFolders: ["/tmp/ws"],
      coworkEgressAllowedHosts: ["*"],
    },
    settingsPath,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
    env: Record<string, string>;
    theme: string;
    permissions: { defaultMode: string };
    claudexDesktopSetup: Record<string, unknown>;
  };
  expect(parsed.theme).toBe("light");
  expect(parsed.permissions.defaultMode).toBe("auto");
  expect(parsed.env.HTTP_PROXY).toBe("http://127.0.0.1:12000");
  expect(parsed.env.ANTHROPIC_BASE_URL).toBe("http://204.44.121.220:8317/");
  expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-new");
  expect(parsed.env.ANTHROPIC_CUSTOM_HEADERS).toBe("X-Org: acme");
  expect(parsed.env.DISABLE_TELEMETRY).toBe("1");
  expect(parsed.env.DISABLE_AUTOUPDATER).toBe("1");
  expect(parsed.env.ANTHROPIC_MODEL).toBe("grok-4.5");
  expect(parsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("grok-4.5");
  expect(parsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("kimi-k2");
  expect(parsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("glm-4");
  expect(parsed[DOT_CLAUDE_DESKTOP_SETUP_BAG_KEY].allowedWorkspaceFolders).toEqual(["/tmp/ws"]);
  expect(parsed[DOT_CLAUDE_DESKTOP_SETUP_BAG_KEY].coworkEgressAllowedHosts).toEqual(["*"]);
});

it("writeGatewayBagIntoDotClaudeSettings writes x-api-key scheme to API_KEY", () => {
  const home = tempHome("dotclaude-xapikey-");
  const settingsPath = path.join(home, ".claude", "settings.json");
  const result = writeGatewayBagIntoDotClaudeSettings(
    {
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "https://api.anthropic.com",
      inferenceGatewayApiKey: "sk-ant",
      inferenceGatewayAuthScheme: "x-api-key",
    },
    settingsPath,
  );
  expect(result.ok).toBe(true);
  const env = (JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { env: Record<string, string> }).env;
  expect(env.ANTHROPIC_API_KEY).toBe("sk-ant");
  expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
});

it("writeGatewayBagIntoDotClaudeSettings requires gateway base URL and API key", () => {
  const home = tempHome("dotclaude-req-");
  const settingsPath = path.join(home, ".claude", "settings.json");
  expect(writeGatewayBagIntoDotClaudeSettings({}, settingsPath).ok).toBe(false);
  expect(
    writeGatewayBagIntoDotClaudeSettings(
      { inferenceProvider: "gateway", inferenceGatewayBaseUrl: "http://x" },
      settingsPath,
    ).ok,
  ).toBe(false);
});

it("write/read round-trips bedrock + desktop-only fields without touching configLibrary shape", () => {
  const home = tempHome("dotclaude-bedrock-");
  writeSettings(home, { env: { ANTHROPIC_BASE_URL: "http://old/", ANTHROPIC_AUTH_TOKEN: "t" } });

  const written = writeDotClaudeAsConfigLibrary(
    {
      inferenceProvider: "bedrock",
      inferenceBedrockRegion: "us-east-1",
      inferenceBedrockBearerToken: "btok",
      inferenceModels: [{ name: "claude-sonnet" }],
      managedMcpServers: { demo: { url: "https://mcp.example" } },
      isLocalDevMcpEnabled: true,
    },
    home,
  );
  expect(written.ok).toBe(true);

  const read = readDotClaudeAsConfigLibrary(home);
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  expect(read.config.inferenceProvider).toBe("bedrock");
  expect(read.config.inferenceBedrockRegion).toBe("us-east-1");
  expect(read.config.inferenceBedrockBearerToken).toBe("btok");
  expect(read.config.managedMcpServers).toEqual({ demo: { url: "https://mcp.example" } });
  expect(read.config.isLocalDevMcpEnabled).toBe(true);

  const disk = JSON.parse(
    fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"),
  ) as { env: Record<string, string>; claudexDesktopSetup: Record<string, unknown> };
  expect(disk.env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
  expect(disk.env.AWS_REGION).toBe("us-east-1");
  expect(disk.env.ANTHROPIC_BASE_URL).toBeUndefined();
  expect(disk.claudexDesktopSetup.managedMcpServers).toEqual({ demo: { url: "https://mcp.example" } });
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
      inferenceProvider: "gateway",
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

it("mapDotClaudeEnvToGatewayBag prefers modelType openai over gateway env", () => {
  const bag = mapDotClaudeEnvToGatewayBag(
    {
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_API_KEY: "sk-oai",
      ANTHROPIC_BASE_URL: "https://should-not-win.example",
      ANTHROPIC_AUTH_TOKEN: "sk-anthropic",
    },
    { modelType: "openai" },
  );
  expect(bag.inferenceProvider).toBe("openai");
  expect(bag.inferenceOpenAIBaseUrl).toBe("https://api.openai.com/v1");
  expect(bag.inferenceOpenAIApiKey).toBe("sk-oai");
  expect(bag.inferenceGatewayBaseUrl).toBeUndefined();
});

it("write/read round-trips openai modelType into ~/.claude settings.json", () => {
  const home = tempHome("dotclaude-openai-");
  writeSettings(home, {
    env: {
      ANTHROPIC_BASE_URL: "http://old-gateway/",
      ANTHROPIC_AUTH_TOKEN: "old-token",
      HTTP_PROXY: "http://127.0.0.1:12000",
    },
    theme: "dark",
  });

  const written = writeDotClaudeAsConfigLibrary(
    {
      inferenceProvider: "openai",
      inferenceOpenAIBaseUrl: "https://api.openai.com/v1",
      inferenceOpenAIApiKey: "sk-openai",
      inferenceModels: [{ name: "gpt-4.1" }],
    },
    home,
  );
  expect(written.ok).toBe(true);

  const disk = JSON.parse(
    fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"),
  ) as { modelType?: string; env: Record<string, string>; theme: string };
  expect(disk.theme).toBe("dark");
  expect(disk.modelType).toBe("openai");
  expect(disk.env.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
  expect(disk.env.OPENAI_API_KEY).toBe("sk-openai");
  expect(disk.env.CLAUDE_CODE_USE_OPENAI).toBe("1");
  expect(disk.env.ANTHROPIC_BASE_URL).toBeUndefined();
  expect(disk.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  expect(disk.env.HTTP_PROXY).toBe("http://127.0.0.1:12000");
  expect(disk.env.ANTHROPIC_MODEL).toBe("gpt-4.1");

  const read = readDotClaudeAsConfigLibrary(home);
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  expect(read.config.inferenceProvider).toBe("openai");
  expect(read.config.inferenceOpenAIBaseUrl).toBe("https://api.openai.com/v1");
  expect(read.config.inferenceOpenAIApiKey).toBe("sk-openai");

  const listed = listDotClaudeAsConfigLibrary(home);
  expect(listed.entries[0]?.provider).toBe("openai");
});

it("write/read round-trips gemini and grok modelType", () => {
  const home = tempHome("dotclaude-gemini-");
  const geminiWrite = writeDotClaudeAsConfigLibrary(
    {
      inferenceProvider: "gemini",
      inferenceGeminiApiKey: "gem-key",
      inferenceGeminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      inferenceModels: [{ name: "gemini-2.0-flash" }],
    },
    home,
  );
  expect(geminiWrite.ok).toBe(true);
  let disk = JSON.parse(
    fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"),
  ) as { modelType?: string; env: Record<string, string> };
  expect(disk.modelType).toBe("gemini");
  expect(disk.env.GEMINI_API_KEY).toBe("gem-key");
  expect(disk.env.GEMINI_BASE_URL).toBe("https://generativelanguage.googleapis.com/v1beta");
  expect(disk.env.CLAUDE_CODE_USE_GEMINI).toBe("1");

  const grokWrite = writeDotClaudeAsConfigLibrary(
    {
      inferenceProvider: "grok",
      inferenceGrokApiKey: "xai-key",
      inferenceModels: [{ name: "grok-4" }],
    },
    home,
  );
  expect(grokWrite.ok).toBe(true);
  disk = JSON.parse(
    fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"),
  ) as { modelType?: string; env: Record<string, string> };
  expect(disk.modelType).toBe("grok");
  expect(disk.env.GROK_API_KEY).toBe("xai-key");
  expect(disk.env.CLAUDE_CODE_USE_GROK).toBe("1");
  expect(disk.env.GEMINI_API_KEY).toBeUndefined();
  expect(disk.env.OPENAI_API_KEY).toBeUndefined();

  // Switching back to gateway clears modelType multi-vendor and writes anthropic modelType.
  const gatewayWrite = writeDotClaudeAsConfigLibrary(
    {
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "https://gw.example/",
      inferenceGatewayApiKey: "sk-gw",
      inferenceGatewayAuthScheme: "bearer",
    },
    home,
  );
  expect(gatewayWrite.ok).toBe(true);
  disk = JSON.parse(
    fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"),
  ) as { modelType?: string; env: Record<string, string> };
  expect(disk.modelType).toBe("anthropic");
  expect(disk.env.ANTHROPIC_BASE_URL).toBe("https://gw.example/");
  expect(disk.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-gw");
  expect(disk.env.GROK_API_KEY).toBeUndefined();
  expect(disk.env.CLAUDE_CODE_USE_GROK).toBeUndefined();
});

it("write bedrock clears modelType (env-only cloud providers)", () => {
  const home = tempHome("dotclaude-bedrock-mt-");
  writeSettings(home, { modelType: "openai", env: { OPENAI_API_KEY: "x", OPENAI_BASE_URL: "https://x" } });
  const written = writeDotClaudeAsConfigLibrary(
    {
      inferenceProvider: "bedrock",
      inferenceBedrockRegion: "us-east-1",
      inferenceBedrockBearerToken: "btok",
    },
    home,
  );
  expect(written.ok).toBe(true);
  const disk = JSON.parse(
    fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"),
  ) as { modelType?: string; env: Record<string, string> };
  expect(disk.modelType).toBeUndefined();
  expect(disk.env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
  expect(disk.env.OPENAI_API_KEY).toBeUndefined();
});
