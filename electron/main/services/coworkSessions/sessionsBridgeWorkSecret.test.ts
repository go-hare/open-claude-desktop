import { describe, expect, it } from "vitest";
import {
  decodeSessionsBridgeWorkSecret,
  encodeSessionsBridgeWorkSecretForTests,
  parseSessionIngressTokenExp,
} from "./sessionsBridgeWorkSecret";

describe("sessionsBridgeWorkSecret residual (cwe / c6i)", () => {
  it("decodes version=1 base64url work secret", () => {
    const encoded = encodeSessionsBridgeWorkSecretForTests({
      session_ingress_token: "sk-ant-si-token",
      api_base_url: "https://api.anthropic.com",
      use_code_sessions: true,
    });
    const secret = decodeSessionsBridgeWorkSecret(encoded);
    expect(secret.version).toBe(1);
    expect(secret.session_ingress_token).toBe("sk-ant-si-token");
    expect(secret.api_base_url).toBe("https://api.anthropic.com");
    expect(secret.use_code_sessions).toBe(true);
  });

  it("rejects missing / empty secret", () => {
    expect(() => decodeSessionsBridgeWorkSecret(null)).toThrow(/missing secret/);
    expect(() => decodeSessionsBridgeWorkSecret("")).toThrow(/missing secret/);
  });

  it("rejects unsupported version", () => {
    const bad = Buffer.from(
      JSON.stringify({
        version: 2,
        session_ingress_token: "t",
        api_base_url: "https://x",
      }),
      "utf-8",
    ).toString("base64url");
    expect(() => decodeSessionsBridgeWorkSecret(bad)).toThrow(/version: 2/);
  });

  it("rejects missing session_ingress_token", () => {
    const bad = Buffer.from(
      JSON.stringify({ version: 1, api_base_url: "https://x" }),
      "utf-8",
    ).toString("base64url");
    expect(() => decodeSessionsBridgeWorkSecret(bad)).toThrow(
      /session_ingress_token/,
    );
  });

  it("rejects missing api_base_url", () => {
    const bad = Buffer.from(
      JSON.stringify({ version: 1, session_ingress_token: "t" }),
      "utf-8",
    ).toString("base64url");
    expect(() => decodeSessionsBridgeWorkSecret(bad)).toThrow(/api_base_url/);
  });

  it("parseSessionIngressTokenExp reads JWT exp", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" }), "utf8").toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({ exp: 1_700_000_000 }),
      "utf8",
    ).toString("base64url");
    const token = `sk-ant-si-${header}.${payload}.sig`;
    expect(parseSessionIngressTokenExp(token)).toBe(1_700_000_000);
    expect(parseSessionIngressTokenExp(null)).toBeNull();
    expect(parseSessionIngressTokenExp("not-a-jwt")).toBeNull();
  });
});
