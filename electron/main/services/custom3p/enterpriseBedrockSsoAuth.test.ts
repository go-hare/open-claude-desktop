import { afterEach, describe, expect, it } from "vitest";
import {
  bedrockRoleCredentialsToEnv,
  clearBedrockSso,
  needsBedrockSsoInteractiveAuth,
  readBedrockSsoStored,
  storeBedrockSso,
} from "./enterpriseBedrockSsoAuth";
import { resetEnterpriseSecretsForTests } from "./enterpriseSecureStore";

const localOnly = (bag: Record<string, unknown>) => ({
  getManagedConfig: () => ({}),
  getLocalConfig: () => bag,
});

describe("enterpriseBedrockSsoAuth (GV residual)", () => {
  afterEach(() => {
    resetEnterpriseSecretsForTests();
    clearBedrockSso();
  });

  it("needsBedrockSsoInteractiveAuth when SSO keys set and no stored token", () => {
    process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT = "1";
    const deps = localOnly({
      inferenceProvider: "bedrock",
      inferenceBedrockSsoStartUrl: "https://d-xxx.awsapps.com/start",
      inferenceBedrockSsoRegion: "us-east-1",
      inferenceBedrockSsoAccountId: "123456789012",
      inferenceBedrockSsoRoleName: "ClaudeRole",
    });
    expect(needsBedrockSsoInteractiveAuth(deps)).toBe(true);
    storeBedrockSso({
      startUrl: "https://d-xxx.awsapps.com/start",
      ssoRegion: "us-east-1",
      clientId: "c",
      clientSecret: "s",
      clientExpiresAt: Date.now() + 86_400_000,
      accessToken: "at",
      accessTokenExpiresAt: Date.now() + 3600_000,
    });
    expect(needsBedrockSsoInteractiveAuth(deps)).toBe(false);
    expect(readBedrockSsoStored()?.accessToken).toBe("at");
    delete process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT;
  });

  it("bedrockRoleCredentialsToEnv clears bearer and sets AWS keys", () => {
    expect(
      bedrockRoleCredentialsToEnv({
        accessKeyId: "AKIA",
        secretAccessKey: "sec",
        sessionToken: "sess",
      }),
    ).toEqual({
      AWS_ACCESS_KEY_ID: "AKIA",
      AWS_SECRET_ACCESS_KEY: "sec",
      AWS_SESSION_TOKEN: "sess",
      AWS_BEARER_TOKEN_BEDROCK: "",
    });
  });
});
