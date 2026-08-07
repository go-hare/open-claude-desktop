/**
 * Product host bridge for official MermaidIframe / artifact sandbox residual.
 *
 * Official claudeusercontent sandbox (SSR + chunk 3817) hardcodes:
 *   allowedParentOrigins: [
 *     "https://claude.ai",
 *     "https://preview.claude.ai",
 *     "https://claude.site",
 *     "https://feedback.anthropic.com",
 *     "app://localhost",
 *   ]
 *
 * Sandbox communicator `class d` (same residual):
 *   requestHandshake() → broadcast({type:"__sandbox_handshake_request__"})
 *     only to allowedOrigins (postMessage targetOrigin)
 *   handleMessage: allowedOrigins.includes(event.origin) gate
 *
 * Packaged residual parent is app://localhost → handshake works.
 * Dev MAIN_VIEW (http://localhost:5176) is NOT in the list → sandbox never
 * accepts parent port transfer → ReadyForContent never fires → File pane
 * stays on residual "Rendering diagram..." / soft timeout UI.
 *
 * This is not inventing a local mermaid renderer: it only rewrites the remote
 * sandbox HTML document so the same residual communicator accepts the product
 * Vite origin under dev. Packaged app:// path already matches residual and is
 * a no-op (extras already present only when needed).
 *
 * Implementation: CDP Fetch Response interception on Document navigations to
 * claudeusercontent (iframe shares mainView WebContents). Mirrors the existing
 * frame-ancestors CSP bridge (header-only is not enough for origin allowlist).
 */

import { app, type WebContents } from "electron";

const SANDBOX_DOC_RE =
  /^https:\/\/(www\.)?claudeusercontent\.com(\/|\?|#|$)/i;

function collectDevParentOrigins(): string[] {
  const origins = new Set<string>([
    "http://localhost:5176",
    "http://127.0.0.1:5176",
    "http://localhost:4176",
    "http://127.0.0.1:4176",
  ]);
  const mainView = process.env.CLAUDE_DESKTOP_MAIN_VIEW_URL?.trim();
  if (mainView) {
    try {
      origins.add(new URL(mainView).origin);
    } catch {
      /* ignore */
    }
  }
  return [...origins];
}

/**
 * Inject product/dev origins into residual allowedParentOrigins array in HTML.
 * Handles RSC flight escaping (\"…\") and raw JSON ("…").
 * Residual list ends with app://localhost — append all missing extras once.
 *
 * IMPORTANT: do not use html.includes(origin) globally — parentOrigin=http://localhost:5176
 * already appears in the query string / RSC searchParams, which would skip injecting the
 * same origin into allowedParentOrigins (the gate that actually matters).
 */
export function injectAllowedParentOrigins(
  html: string,
  extras: string[],
): string {
  const unique = [...new Set(extras.filter(Boolean))];
  if (unique.length === 0) return html;

  // RSC / Next flight: \"app://localhost\"]  (backslash-escaped quotes)
  const withEscaped = html.replace(
    /app:\/\/localhost((?:\\{1,2})")((?:(?!\]).)*?)(\s*\])/g,
    (match, quote: string, middle: string, close: string) => {
      // Only rewrite the allowedParentOrigins array tail (list of origins after app://localhost).
      // middle may already contain previously injected origins.
      const missing = unique.filter(
        (origin) => !match.includes(`${quote}${origin}${quote}`),
      );
      if (missing.length === 0) return match;
      const inserted = missing
        .map((origin) => `,${quote}${origin}${quote}`)
        .join("");
      return `app://localhost${quote}${middle}${inserted}${close}`;
    },
  );
  if (withEscaped !== html) return withEscaped;

  // Raw JSON array entry: "app://localhost" … ]
  return html.replace(
    /"app:\/\/localhost"((?:(?!\]).)*?)(\s*\])/g,
    (match, middle: string, close: string) => {
      const missing = unique.filter((origin) => !match.includes(`"${origin}"`));
      if (missing.length === 0) return match;
      const inserted = missing.map((origin) => `,"${origin}"`).join("");
      return `"app://localhost"${middle}${inserted}${close}`;
    },
  );
}

function stripHopHeaders(
  headers: Array<{ name: string; value: string }> | undefined,
): Array<{ name: string; value: string }> {
  const blocked = new Set([
    "content-length",
    "content-encoding",
    "transfer-encoding",
  ]);
  return (headers ?? []).filter(
    (h) => !blocked.has(String(h.name).toLowerCase()),
  );
}

function attachFetchRewrite(contents: WebContents, extras: string[]): void {
  const flag = "__claudexArtifactSandboxAllowedParentOriginBridge" as const;
  const anyWc = contents as WebContents & { [flag]?: boolean };
  if (anyWc[flag] || contents.isDestroyed()) return;
  anyWc[flag] = true;

  const debuggerApi = contents.debugger;
  const onMessage = async (
    _event: Electron.Event,
    method: string,
    params: Record<string, unknown>,
  ) => {
    if (method !== "Fetch.requestPaused") return;
    const requestId = params.requestId as string;
    const request = params.request as { url?: string } | undefined;
    const resourceType = params.resourceType as string | undefined;
    const responseStatusCode = params.responseStatusCode as number | undefined;
    const responseHeaders = params.responseHeaders as
      | Array<{ name: string; value: string }>
      | undefined;
    const url = request?.url ?? "";

    const isSandboxDoc =
      resourceType === "Document" && SANDBOX_DOC_RE.test(url);

    if (!isSandboxDoc || responseStatusCode == null) {
      try {
        await debuggerApi.sendCommand("Fetch.continueRequest", { requestId });
      } catch {
        /* navigation torn down */
      }
      return;
    }

    try {
      const bodyResult = (await debuggerApi.sendCommand("Fetch.getResponseBody", {
        requestId,
      })) as { body?: string; base64Encoded?: boolean };
      const raw = bodyResult.body ?? "";
      const text = bodyResult.base64Encoded
        ? Buffer.from(raw, "base64").toString("utf8")
        : raw;
      const rewritten = injectAllowedParentOrigins(text, extras);
      if (rewritten === text) {
        await debuggerApi.sendCommand("Fetch.continueRequest", { requestId });
        return;
      }
      await debuggerApi.sendCommand("Fetch.fulfillRequest", {
        requestId,
        responseCode: responseStatusCode,
        responseHeaders: stripHopHeaders(responseHeaders),
        body: Buffer.from(rewritten, "utf8").toString("base64"),
      });
      console.info(
        "[artifact-sandbox] allowedParentOrigins injected for",
        url.slice(0, 120),
      );
    } catch (error) {
      console.warn(
        "[artifact-sandbox] allowedParentOrigins rewrite failed",
        error instanceof Error ? error.message : String(error),
      );
      try {
        await debuggerApi.sendCommand("Fetch.continueRequest", { requestId });
      } catch {
        /* ignore */
      }
    }
  };

  try {
    if (!debuggerApi.isAttached()) {
      debuggerApi.attach("1.3");
    }
    debuggerApi.on("message", onMessage);
    void debuggerApi
      .sendCommand("Fetch.enable", {
        patterns: [
          {
            urlPattern: "*://www.claudeusercontent.com/*",
            requestStage: "Response",
            resourceType: "Document",
          },
          {
            urlPattern: "*://claudeusercontent.com/*",
            requestStage: "Response",
            resourceType: "Document",
          },
        ],
      })
      .then(() => {
        console.info(
          "[artifact-sandbox] allowedParentOrigins bridge for",
          extras.join(", "),
        );
      })
      .catch((error: unknown) => {
        console.warn(
          "[artifact-sandbox] Fetch.enable failed",
          error instanceof Error ? error.message : String(error),
        );
      });
  } catch (error) {
    console.warn(
      "[artifact-sandbox] debugger attach for parentOrigin bridge failed",
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  contents.once("destroyed", () => {
    try {
      debuggerApi.removeListener("message", onMessage);
      if (debuggerApi.isAttached()) debuggerApi.detach();
    } catch {
      /* ignore */
    }
  });
}

/**
 * Install once at app boot. Hooks every WebContents (mainView loads sandbox
 * iframes in the same session/WebContents tree).
 */
export function installArtifactSandboxAllowedParentOriginBridge(): void {
  const extras = collectDevParentOrigins();
  if (extras.length === 0) return;

  const flag = "__claudexArtifactSandboxAllowedParentOriginBridgeApp" as const;
  const anyApp = app as typeof app & { [flag]?: boolean };
  if (anyApp[flag]) return;
  anyApp[flag] = true;

  app.on("web-contents-created", (_event, contents) => {
    attachFetchRewrite(contents, extras);
  });
}
