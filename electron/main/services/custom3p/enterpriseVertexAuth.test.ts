import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildVertexOAuthSpawnEnv,
  clearVertexAuthorizedUser,
  materializeVertexAdcFile,
  needsVertexInteractiveAuth,
  readVertexAuthorizedUser,
  storeVertexAuthorizedUser,
} from "./enterpriseVertexAuth";
import { resetEnterpriseSecretsForTests } from "./enterpriseSecureStore";

const localOnly = (bag: Record<string, unknown>) => ({
  getManagedConfig: () => ({}),
  getLocalConfig: () => bag,
});

describe("enterpriseVertexAuth (h1e residual)", () => {
  afterEach(() => {
    resetEnterpriseSecretsForTests();
    clearVertexAuthorizedUser();
  });

  it("needsVertexInteractiveAuth when OAuth client set and no ADC", () => {
    process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT = "1";
    const deps = localOnly({
      inferenceProvider: "vertex",
      inferenceVertexOAuthClientId: "cid",
      inferenceVertexOAuthClientSecret: "sec",
    });
    // needsEnterpriseVertexAuth also requires provider=vertex + oauth pair
    expect(needsVertexInteractiveAuth(deps)).toBe(true);
    storeVertexAuthorizedUser({
      type: "authorized_user",
      client_id: "cid",
      client_secret: "sec",
      refresh_token: "rt",
      token_uri: "https://oauth2.googleapis.com/token",
    });
    expect(needsVertexInteractiveAuth(deps)).toBe(false);
    delete process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT;
  });

  it("materializeVertexAdcFile writes authorized_user JSON for spawn", () => {
    process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT = "1";
    storeVertexAuthorizedUser({
      type: "authorized_user",
      client_id: "cid",
      client_secret: "sec",
      refresh_token: "rt",
      token_uri: "https://oauth2.googleapis.com/token",
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-adc-"));
    const file = materializeVertexAdcFile(dir);
    expect(file).toBeTruthy();
    const parsed = JSON.parse(fs.readFileSync(file!, "utf8"));
    expect(parsed).toMatchObject({
      type: "authorized_user",
      client_id: "cid",
      refresh_token: "rt",
    });
    expect(readVertexAuthorizedUser()?.client_id).toBe("cid");
    delete process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT;
  });

  it("buildVertexOAuthSpawnEnv injects GOOGLE_APPLICATION_CREDENTIALS", () => {
    process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT = "1";
    storeVertexAuthorizedUser({
      type: "authorized_user",
      client_id: "cid",
      client_secret: "sec",
      refresh_token: "rt",
      token_uri: "https://oauth2.googleapis.com/token",
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-env-"));
    const env = buildVertexOAuthSpawnEnv({
      ...localOnly({
        inferenceProvider: "vertex",
        inferenceVertexOAuthClientId: "cid",
        inferenceVertexOAuthClientSecret: "sec",
      }),
      userDataPath: dir,
    });
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toContain("vertex-adc.json");
    delete process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT;
  });
});
