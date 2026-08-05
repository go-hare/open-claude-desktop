/**
 * Official RbA residual — authorization-code + PKCE loopback OAuth for enterprise 3p.
 *
 *   random verifier + S256 challenge, listen 127.0.0.1:0/callback,
 *   open system browser, exchange code at tokenUrl.
 *
 * data-official-source: app.asar async function RbA
 */
import crypto from "node:crypto";
import http from "node:http";
import { shell } from "electron";

export type EnterprisePkceAuthInput = {
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
  /** Official googleOfflineAccess residual (Vertex). */
  googleOfflineAccess?: boolean;
  displayName?: string;
  redirectPort?: number;
  timeoutMs?: number;
};

export type EnterprisePkceTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  raw: Record<string, unknown>;
};

function assertHttpUrl(raw: string, label: string): URL {
  const u = new URL(raw);
  const ok =
    u.protocol === "https:" ||
    (u.protocol === "http:" && u.hostname === "127.0.0.1");
  if (!ok) {
    throw new Error(`${label} must use https (or http on 127.0.0.1)`);
  }
  return u;
}

function waitForCode(
  server: http.Server,
  expectedState: string,
  expectedHost: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("OAuth loopback timed out waiting for browser callback"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      server.removeAllListeners("request");
    };

    server.on("request", (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://${expectedHost}`);
        if (req.headers.origin || req.headers.referer) {
          res.writeHead(400, { Connection: "close" });
          res.end();
          return;
        }
        if (req.headers.host !== expectedHost) {
          res.writeHead(400, { Connection: "close" });
          res.end();
          return;
        }
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const err = url.searchParams.get("error");
        if (state !== expectedState) {
          res.writeHead(400, { Connection: "close" });
          res.end("State mismatch");
          return;
        }
        if (err) {
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            Connection: "close",
          });
          res.end(
            "<!doctype html><title>Authorization cancelled</title><p>Authorization was cancelled. You can close this tab.",
          );
          cleanup();
          reject(
            new Error(
              `OAuth authorize returned error: ${err} ${
                url.searchParams.get("error_description") ?? ""
              }`.trim(),
            ),
          );
          return;
        }
        if (!code) {
          res.writeHead(404, { Connection: "close" });
          res.end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          Connection: "close",
        });
        res.end(
          "<!doctype html><title>Authorized</title><p>Authorization complete. You can close this tab and return to Claude.",
        );
        cleanup();
        resolve(code);
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

/**
 * Official RbA residual — interactive PKCE sign-in.
 */
export async function runEnterprisePkceAuth(
  input: EnterprisePkceAuthInput,
): Promise<EnterprisePkceTokens> {
  const authUrl = assertHttpUrl(input.authorizationUrl, "authorizationUrl");
  assertHttpUrl(input.tokenUrl, "tokenUrl");

  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("base64url");

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.redirectPort ?? 0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("OAuth loopback failed to bind");
  }
  const port = address.port;
  const host = `127.0.0.1:${port}`;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const timeoutMs = input.timeoutMs ?? 5 * 60_000;

  try {
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", input.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    if (input.scopes?.length) {
      authUrl.searchParams.set("scope", input.scopes.join(" "));
    }
    if (input.googleOfflineAccess) {
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
    }

    const codePromise = waitForCode(server, state, host, timeoutMs);
    await shell.openExternal(authUrl.toString());
    const code = await codePromise;

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: input.clientId,
      code_verifier: verifier,
    });
    if (input.clientSecret) body.set("client_secret", input.clientSecret);

    const response = await fetch(input.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Token exchange failed (HTTP ${response.status})`);
    }
    const json = (await response.json()) as Record<string, unknown>;
    const accessToken =
      typeof json.access_token === "string" ? json.access_token : "";
    if (!accessToken) {
      throw new Error("Token response missing access_token");
    }
    return {
      accessToken,
      refreshToken:
        typeof json.refresh_token === "string" ? json.refresh_token : undefined,
      expiresAt:
        typeof json.expires_in === "number"
          ? Date.now() + json.expires_in * 1000
          : undefined,
      raw: json,
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
