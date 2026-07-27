import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildClaudeCliSpawnEnv,
  buildDesktopCustom3pCliEnv,
  custom3pEnterpriseConfigFromUnknown,
  DESKTOP_SHELL_SETTINGS_FILE,
  readAppliedCustom3pFromDesktopShellSettings,
  resolveCliModelArg,
  serializeAnthropicCustomHeaders,
} from "./custom3pCliEnv";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "custom3p-cli-env-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("custom3pCliEnv residual", () => {
  it("maps gateway bearer credentials like official K6t sessionEnvVars", () => {
    const enterprise = custom3pEnterpriseConfigFromUnknown({
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "https://llm-gateway.example.com",
      inferenceGatewayApiKey: "sk-test",
      inferenceGatewayAuthScheme: "bearer",
      inferenceGatewayHeaders: { "X-Org": "acme" },
    });
    expect(enterprise).not.toBeNull();
    const env = buildDesktopCustom3pCliEnv(enterprise);
    expect(env).toMatchObject({
      CLAUDE_CODE_ENTRYPOINT: "claude-desktop-3p",
      ANTHROPIC_BASE_URL: "https://llm-gateway.example.com",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "sk-test",
      ANTHROPIC_CUSTOM_HEADERS: "X-Org: acme",
      CLAUDE_CODE_OAUTH_TOKEN: "",
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
      DISABLE_AUTOUPDATER: "1",
      DISABLE_GROWTHBOOK: "1",
    });
  });

  it("maps gateway x-api-key into ANTHROPIC_API_KEY", () => {
    const env = buildDesktopCustom3pCliEnv({
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "https://api.example.com",
      inferenceGatewayApiKey: "key-1",
      inferenceGatewayAuthScheme: "x-api-key",
    });
    expect(env).toMatchObject({
      ANTHROPIC_API_KEY: "key-1",
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_BASE_URL: "https://api.example.com",
    });
  });

  it("does not invent ANTHROPIC_BASE_URL when gateway bag has no baseUrl", () => {
    const env = buildDesktopCustom3pCliEnv({
      inferenceProvider: "gateway",
    });
    expect(env?.CLAUDE_CODE_ENTRYPOINT).toBe("claude-desktop-3p");
    expect(env).not.toHaveProperty("ANTHROPIC_BASE_URL");
  });

  it("pins ANTHROPIC_DEFAULT_*_MODEL to bag inferenceModels so shell kimi env cannot win", () => {
    const spawnEnv = buildClaudeCliSpawnEnv({
      processEnv: {
        PATH: "/usr/bin",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-k3",
        ANTHROPIC_MODEL: "kimi-k3",
      },
      appliedEnterpriseConfig: {
        inferenceProvider: "gateway",
        inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
        inferenceGatewayApiKey: "sk-test",
        inferenceModels: [{ name: "deepseek-v4-pro", supports1m: true }],
      },
    });
    expect(spawnEnv.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(spawnEnv.ANTHROPIC_MODEL).toBe("deepseek-v4-pro");
    expect(spawnEnv.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("deepseek-v4-pro");
    expect(spawnEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("deepseek-v4-pro");
    expect(spawnEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("deepseek-v4-pro");
  });

  it("resolveCliModelArg drops shell-leaked grok and maps shortnames to bag primary", () => {
    const bag = {
      inferenceProvider: "gateway",
      inferenceModels: [{ name: "deepseek-v4-pro", supports1m: true }],
    };
    expect(resolveCliModelArg("grok-4.5", bag)).toBeUndefined();
    expect(resolveCliModelArg("kimi-k3", bag)).toBeUndefined();
    expect(resolveCliModelArg("default", bag)).toBeUndefined();
    expect(resolveCliModelArg("sonnet", bag)).toBe("deepseek-v4-pro");
    expect(resolveCliModelArg("opus", bag)).toBe("deepseek-v4-pro");
    expect(resolveCliModelArg("deepseek-v4-pro", bag)).toBe("deepseek-v4-pro");
    expect(resolveCliModelArg("deepseek-v4-pro[1m]", bag)).toBe("deepseek-v4-pro[1m]");
  });

  it("clears process-inherited ANTHROPIC_BASE_URL when applied 3p has no baseUrl", () => {
    const spawnEnv = buildClaudeCliSpawnEnv({
      processEnv: {
        PATH: "/usr/bin",
        ANTHROPIC_BASE_URL: "https://process-only.example",
        ANTHROPIC_API_KEY: "process-key",
      },
      appliedEnterpriseConfig: {
        inferenceProvider: "gateway",
      },
    });
    expect(spawnEnv.CLAUDE_CODE_ENTRYPOINT).toBe("claude-desktop-3p");
    expect(spawnEnv.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(spawnEnv.ANTHROPIC_API_KEY).toBe("");
  });

  it("maps vertex / bedrock / foundry provider flags", () => {
    expect(
      buildDesktopCustom3pCliEnv({
        inferenceProvider: "vertex",
        inferenceVertexProjectId: "proj",
        inferenceVertexRegion: "us-east5",
      }),
    ).toMatchObject({
      CLAUDE_CODE_USE_VERTEX: "1",
      ANTHROPIC_VERTEX_PROJECT_ID: "proj",
      CLOUD_ML_REGION: "us-east5",
    });

    expect(
      buildDesktopCustom3pCliEnv({
        inferenceProvider: "bedrock",
        inferenceBedrockRegion: "us-east-1",
        inferenceBedrockBearerToken: "token",
      }),
    ).toMatchObject({
      CLAUDE_CODE_USE_BEDROCK: "1",
      AWS_REGION: "us-east-1",
      AWS_BEARER_TOKEN_BEDROCK: "token",
    });

    expect(
      buildDesktopCustom3pCliEnv({
        inferenceProvider: "foundry",
        inferenceFoundryResource: "my-resource",
        inferenceFoundryApiKey: "fk",
      }),
    ).toMatchObject({
      CLAUDE_CODE_USE_FOUNDRY: "1",
      ANTHROPIC_FOUNDRY_RESOURCE: "my-resource",
      ANTHROPIC_FOUNDRY_API_KEY: "fk",
    });
  });

  it("serializes custom headers with official SPe shape", () => {
    expect(serializeAnthropicCustomHeaders({ A: "1", B: "2" })).toBe("A: 1|B: 2");
    expect(serializeAnthropicCustomHeaders(undefined)).toBe("");
  });

  it("reads applied bag from desktop-shell-settings.json", () => {
    const userData = temporaryDirectory();
    fs.writeFileSync(
      path.join(userData, DESKTOP_SHELL_SETTINGS_FILE),
      JSON.stringify({
        appliedCustom3pConfigId: "cfg-1",
        custom3pConfigs: {
          "cfg-1": {
            id: "cfg-1",
            name: "Gateway",
            config: {
              inferenceProvider: "gateway",
              inferenceGatewayBaseUrl: "https://gw.local",
              inferenceGatewayApiKey: "k",
            },
          },
        },
      }),
      "utf8",
    );

    const snapshot = readAppliedCustom3pFromDesktopShellSettings(userData);
    // Legacy non-uuid id migrates into configLibrary with a new uuid.
    expect(snapshot.appliedId).toBeTruthy();
    expect(snapshot.enterprise?.inferenceGatewayBaseUrl).toBe("https://gw.local");
    expect(fs.existsSync(path.join(userData, "configLibrary", "_meta.json"))).toBe(true);

    const spawnEnv = buildClaudeCliSpawnEnv({
      processEnv: {
        PATH: "/usr/bin",
        ANTHROPIC_API_KEY: "from-process",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
        CLAUDE_CODE_USE_BEDROCK: "1",
        CLAUDECODE: "1",
      },
      localSessionEnv: { FOO: "bar" },
      userDataPath: userData,
    });

    expect(spawnEnv.FOO).toBe("bar");
    expect(spawnEnv.CLAUDE_CODE_ENTRYPOINT).toBe("claude-desktop-3p");
    expect(spawnEnv.ANTHROPIC_BASE_URL).toBe("https://gw.local");
    // bearer default → token, not API key
    expect(spawnEnv.ANTHROPIC_AUTH_TOKEN).toBe("k");
    expect(spawnEnv.ANTHROPIC_API_KEY).toBe("");
    expect(spawnEnv.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(spawnEnv.CLAUDECODE).toBeUndefined();
  });

  it("reads applied bag from official configLibrary residual", () => {
    const userData = temporaryDirectory();
    const appliedId = "19551b40-a9be-4ee5-b343-0ebd21e24152";
    const libraryDir = path.join(userData, "configLibrary");
    fs.mkdirSync(libraryDir, { recursive: true });
    fs.writeFileSync(
      path.join(libraryDir, "_meta.json"),
      JSON.stringify({
        appliedId,
        entries: [{ id: appliedId, name: "Default" }],
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(libraryDir, `${appliedId}.json`),
      JSON.stringify({
        inferenceProvider: "gateway",
        inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic1",
        inferenceGatewayApiKey: "sk-lib",
        inferenceModels: [{ name: "deepseek-v4-pro", supports1m: true }],
      }),
      "utf8",
    );

    const snapshot = readAppliedCustom3pFromDesktopShellSettings(userData);
    expect(snapshot.appliedId).toBe(appliedId);
    expect(snapshot.enterprise?.inferenceGatewayBaseUrl).toBe(
      "https://api.deepseek.com/anthropic1",
    );
    expect(snapshot.enterprise?.inferenceModels?.[0]?.name).toBe("deepseek-v4-pro");

    const spawnEnv = buildClaudeCliSpawnEnv({
      processEnv: { PATH: "/usr/bin" },
      userDataPath: userData,
    });
    expect(spawnEnv.CLAUDE_CODE_ENTRYPOINT).toBe("claude-desktop-3p");
    expect(spawnEnv.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic1");
    expect(spawnEnv.ANTHROPIC_AUTH_TOKEN).toBe("sk-lib");
  });

  it("falls back to sdk-ts entrypoint when no applied 3p provider", () => {
    const userData = temporaryDirectory();
    fs.writeFileSync(
      path.join(userData, DESKTOP_SHELL_SETTINGS_FILE),
      JSON.stringify({ appliedCustom3pConfigId: null, custom3pConfigs: {} }),
      "utf8",
    );
    const spawnEnv = buildClaudeCliSpawnEnv({
      processEnv: { PATH: "/usr/bin" },
      userDataPath: userData,
    });
    expect(spawnEnv.CLAUDE_CODE_ENTRYPOINT).toBe("sdk-ts");
  });

  it("lets injected appliedEnterpriseConfig override disk", () => {
    const spawnEnv = buildClaudeCliSpawnEnv({
      processEnv: { PATH: "/bin" },
      appliedEnterpriseConfig: {
        inferenceProvider: "gateway",
        inferenceGatewayBaseUrl: "https://injected.example",
        inferenceGatewayApiKey: "x",
        inferenceGatewayAuthScheme: "x-api-key",
      },
    });
    expect(spawnEnv.ANTHROPIC_BASE_URL).toBe("https://injected.example");
    expect(spawnEnv.ANTHROPIC_API_KEY).toBe("x");
  });

  it("dotClaude mode: forwards ~/.claude env fresh from disk, bag never wins", () => {
    const userData = temporaryDirectory();
    // An applied configLibrary bag exists but must NOT win in dotClaude mode.
    const appliedId = "19551b40-a9be-4ee5-b343-0ebd21e24152";
    fs.mkdirSync(path.join(userData, "configLibrary"), { recursive: true });
    fs.writeFileSync(
      path.join(userData, "configLibrary", "_meta.json"),
      JSON.stringify({ appliedId, entries: [{ id: appliedId, name: "Default" }] }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(userData, "configLibrary", `${appliedId}.json`),
      JSON.stringify({
        inferenceProvider: "gateway",
        inferenceGatewayBaseUrl: "https://bag-should-not-win.example",
        inferenceGatewayApiKey: "sk-bag",
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(userData, DESKTOP_SHELL_SETTINGS_FILE),
      JSON.stringify({ preferences: { deploymentMode: "dotClaude" } }),
      "utf8",
    );

    const spawnEnv = buildClaudeCliSpawnEnv({
      // GUI process: no ANTHROPIC_* in process.env — routing must come from the
      // ~/.claude env bag (DI-injected here as the live disk read would be).
      processEnv: { PATH: "/usr/bin" },
      userDataPath: userData,
      dotClaudeSettingsEnv: {
        ANTHROPIC_BASE_URL: "https://user-cli-config.example",
        ANTHROPIC_AUTH_TOKEN: "sk-user-cli",
        ANTHROPIC_MODEL: "grok-4.5",
      },
    });

    expect(spawnEnv.CLAUDE_CODE_ENTRYPOINT).toBe("claude-desktop-3p");
    expect(spawnEnv.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe("1");
    // Routing / model / token are the CLI user's, forwarded fresh from ~/.claude.
    expect(spawnEnv.ANTHROPIC_BASE_URL).toBe("https://user-cli-config.example");
    expect(spawnEnv.ANTHROPIC_AUTH_TOKEN).toBe("sk-user-cli");
    expect(spawnEnv.ANTHROPIC_MODEL).toBe("grok-4.5");
  });

  it("dotClaude stale (no usable ~/.claude config): forwards nothing, no fake routing", () => {
    const spawnEnv = buildClaudeCliSpawnEnv({
      processEnv: { PATH: "/usr/bin" },
      persistedDeploymentMode: "dotClaude",
      dotClaudeSettingsEnv: null,
    });
    expect(spawnEnv.CLAUDE_CODE_ENTRYPOINT).toBe("claude-desktop-3p");
    expect(spawnEnv.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(spawnEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
});
