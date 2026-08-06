import { afterEach, describe, expect, it } from "vitest";
import { resetCoworkEnterpriseConfigForTests } from "../coworkHostLoop/coworkEnterpriseConfig";
import { clearBedrockSso } from "./enterpriseBedrockSsoAuth";
import {
  getInteractiveAuthState,
  publishInteractiveAuthRecompute,
  recomputeInteractiveAuthState,
  resetEnterpriseInteractiveAuthForTests,
  setInteractiveAuthPublisher,
  triggerEnterpriseBootstrapAuth,
  triggerEnterpriseInteractiveAuth,
} from "./enterpriseInteractiveAuth";
import { resetEnterpriseSecretsForTests } from "./enterpriseSecureStore";
import { clearVertexAuthorizedUser } from "./enterpriseVertexAuth";

const localOnly = (bag: Record<string, unknown>) => ({
  getManagedConfig: () => ({}),
  getLocalConfig: () => bag,
});

describe("enterpriseInteractiveAuth residual", () => {
  afterEach(() => {
    // Parallel suite files share process-level secret/ADC stores — isolate.
    resetEnterpriseInteractiveAuthForTests();
    resetEnterpriseSecretsForTests();
    clearVertexAuthorizedUser();
    clearBedrockSso();
    resetCoworkEnterpriseConfigForTests();
  });

  it("recompute is null when bag has no interactive providers", () => {
    expect(recomputeInteractiveAuthState(localOnly({}))).toBeNull();
    expect(
      recomputeInteractiveAuthState(
        localOnly({ inferenceProvider: "gateway", inferenceGatewayApiKey: "k" }),
      ),
    ).toBeNull();
  });

  it("recompute needs vertex when OAuth pair set and no ADC", () => {
    const state = recomputeInteractiveAuthState(
      localOnly({
        inferenceProvider: "vertex",
        inferenceVertexOAuthClientId: "cid",
        inferenceVertexOAuthClientSecret: "sec",
      }),
    );
    expect(state).toMatchObject({
      needsAuth: true,
      kind: "vertex",
      pendingUserCode: null,
    });
  });

  it("recompute needs bedrock SSO when four SSO fields set and no stored token", () => {
    const state = recomputeInteractiveAuthState(
      localOnly({
        inferenceProvider: "bedrock",
        inferenceBedrockSsoStartUrl: "https://sso.example/start",
        inferenceBedrockSsoRegion: "us-east-1",
        inferenceBedrockSsoAccountId: "123456789012",
        inferenceBedrockSsoRoleName: "ClaudeRole",
      }),
    );
    expect(state).toMatchObject({
      needsAuth: true,
      kind: "bedrockSso",
    });
  });

  it("triggerInteractiveAuth ok:true when nothing interactive required (not invent OAuth)", async () => {
    const empty = await triggerEnterpriseInteractiveAuth(localOnly({}));
    expect(empty).toEqual({ ok: true });
  });

  it("triggerEnterpriseBootstrapAuth fails honestly when unconfigured", async () => {
    const result = await triggerEnterpriseBootstrapAuth(localOnly({}));
    expect(result.ok).toBe(false);
    expect(result.kind === "unconfigured" || Boolean(result.error)).toBe(true);
  });

  it("publishInteractiveAuthRecompute updates store + publisher", () => {
    const seen: unknown[] = [];
    setInteractiveAuthPublisher((s) => seen.push(s));
    const state = publishInteractiveAuthRecompute(
      localOnly({
        inferenceProvider: "vertex",
        inferenceVertexOAuthClientId: "cid",
        inferenceVertexOAuthClientSecret: "sec",
      }),
    );
    expect(state?.kind).toBe("vertex");
    expect(getInteractiveAuthState()?.kind).toBe("vertex");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "vertex", needsAuth: true });
  });
});
