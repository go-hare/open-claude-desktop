/**
 * Residual custom3p MCP OAuth loopback (app.asar index.js Mni / yni / R2e / S2e).
 * Default port 53280, host 127.0.0.1, callback path /callback.
 * Cancel token: "custom3p-oauth-cancelled-by-newer"
 *
 * data-official-source: app.asar index.js Mni
 */
import http from "node:http";

export const OAUTH_LOOPBACK_DEFAULT_PORT = 53280;
export const OAUTH_LOOPBACK_DEFAULT_HOST = "127.0.0.1";
export const OAUTH_CANCELLED_BY_NEWER = "custom3p-oauth-cancelled-by-newer";

export type OAuthCallbackResult = {
  code: string;
  state: string | null;
};

export type OAuthLoopbackServer = {
  waitForCallback: (timeoutMs: number) => Promise<OAuthCallbackResult>;
  close: () => Promise<void>;
};

/**
 * Residual Mni(port, host, validateState).
 * Rejects callbacks with Origin/Referer or wrong Host; state mismatch → 400.
 */
export async function startOAuthLoopback(
  port: number,
  host: string,
  validateState: (state: string | null) => boolean,
): Promise<OAuthLoopbackServer> {
  let resolveCallback: ((value: OAuthCallbackResult) => void) | undefined;
  let rejectCallback: ((error: Error) => void) | undefined;
  let waiting = false;
  let earlyError: Error | undefined;

  const callbackPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const errorParam = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const htmlHeaders = {
      "Content-Type": "text/html; charset=utf-8",
      Connection: "close",
    } as const;

    // Residual CSRF: no Origin/Referer; Host must match loopback.
    if (
      req.headers.origin ||
      req.headers.referer ||
      req.headers.host !== `${host}:${port}`
    ) {
      res.writeHead(400, { Connection: "close" });
      res.end();
      return;
    }

    if ((errorParam || code) && !validateState(url.searchParams.get("state"))) {
      console.warn(
        "[custom3p-mcp] loopback callback with invalid state — ignoring",
      );
      res.writeHead(400, { Connection: "close" });
      res.end("State mismatch");
      return;
    }

    if (errorParam) {
      res.writeHead(200, htmlHeaders);
      res.end(
        "<!doctype html><title>Authorization cancelled</title><p>Authorization was cancelled. You can close this tab.",
      );
      const err = new Error(
        `OAuth authorize returned error: ${errorParam} ${
          url.searchParams.get("error_description") ?? ""
        }`.trim(),
      );
      if (waiting) {
        rejectCallback?.(err);
      } else {
        earlyError = err;
      }
      return;
    }

    if (code) {
      res.writeHead(200, htmlHeaders);
      res.end(
        "<!doctype html><title>Authorized</title><p>Authorization complete. You can close this tab and return to Claude.",
      );
      resolveCallback?.({
        code,
        state: url.searchParams.get("state"),
      });
      return;
    }

    res.writeHead(404, { Connection: "close" });
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `OAuth loopback port ${port} is in use — close whatever is listening there, or another Claude instance is mid-auth`,
          ),
        );
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => resolve());
  });

  return {
    waitForCallback: (timeoutMs) => {
      if (earlyError) return Promise.reject(earlyError);
      waiting = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`OAuth callback timeout after ${timeoutMs / 1000}s`),
            ),
          timeoutMs,
        );
      });
      return Promise.race([callbackPromise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    },
    close: () =>
      new Promise((resolve) => {
        if (waiting) {
          rejectCallback?.(new Error(OAUTH_CANCELLED_BY_NEWER));
        }
        server.close(() => resolve());
      }),
  };
}

export function oauthCallbackPort(oauth: unknown): number {
  if (oauth && typeof oauth === "object") {
    const port = (oauth as { callbackPort?: unknown }).callbackPort;
    if (
      typeof port === "number" &&
      Number.isInteger(port) &&
      port >= 1024 &&
      port <= 65535
    ) {
      return port;
    }
  }
  return OAUTH_LOOPBACK_DEFAULT_PORT;
}

export function oauthCallbackHost(oauth: unknown): string {
  if (oauth && typeof oauth === "object") {
    const host = (oauth as { callbackHost?: unknown }).callbackHost;
    if (host === "127.0.0.1" || host === "localhost") return host;
  }
  return OAUTH_LOOPBACK_DEFAULT_HOST;
}

export function oauthLoopbackRedirectUrl(oauth: unknown): string {
  return `http://${oauthCallbackHost(oauth)}:${oauthCallbackPort(oauth)}/callback`;
}
