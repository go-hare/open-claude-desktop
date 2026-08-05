/**
 * Residual work-secret decode (app.asar cwe / c6i).
 *
 * Official cwe(e):
 *   base64url → utf8 JSON
 *   version === 1
 *   session_ingress_token: non-empty string
 *   api_base_url: string
 *
 * Official c6i: parse sk-ant-si- JWT-ish exp claim (optional refresh scheduling).
 *
 * data-official-source: app.asar cwe / c6i
 */

export type SessionsBridgeWorkSecret = {
  version: 1;
  session_ingress_token: string;
  api_base_url: string;
  use_code_sessions?: boolean;
  claude_code_args?: {
    model?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/** Official cwe */
export function decodeSessionsBridgeWorkSecret(
  secret: string | undefined | null,
): SessionsBridgeWorkSecret {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("Invalid work secret: missing secret");
  }
  let parsed: unknown;
  try {
    const json = Buffer.from(secret, "base64url").toString("utf-8");
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `Invalid work secret: decode/parse failed (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
  if (!parsed || typeof parsed !== "object" || !("version" in parsed)) {
    throw new Error("Unsupported work secret version: unknown");
  }
  const version = (parsed as { version?: unknown }).version;
  if (version !== 1) {
    throw new Error(`Unsupported work secret version: ${String(version)}`);
  }
  const rec = parsed as Record<string, unknown>;
  if (
    typeof rec.session_ingress_token !== "string" ||
    rec.session_ingress_token.length === 0
  ) {
    throw new Error("Invalid work secret: missing or empty session_ingress_token");
  }
  if (typeof rec.api_base_url !== "string") {
    throw new Error("Invalid work secret: missing api_base_url");
  }
  return parsed as SessionsBridgeWorkSecret;
}

/** Official c6i — ingress token exp (seconds) or null. */
export function parseSessionIngressTokenExp(
  token: string | null | undefined,
): number | null {
  if (!token || typeof token !== "string") return null;
  const bare = token.startsWith("sk-ant-si-") ? token.slice(10) : token;
  const parts = bare.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return payload && typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Encode helper for tests (not used in production path). */
export function encodeSessionsBridgeWorkSecretForTests(
  secret: Omit<SessionsBridgeWorkSecret, "version"> & { version?: 1 },
): string {
  const body = { version: 1 as const, ...secret };
  return Buffer.from(JSON.stringify(body), "utf-8").toString("base64url");
}
