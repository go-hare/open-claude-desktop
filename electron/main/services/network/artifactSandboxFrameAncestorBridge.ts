/**
 * Product host bridge for official MermaidIframe / artifact sandbox residual.
 *
 * Official residual (index-BELzQL5P `eit`):
 *   iframe src = userContentRendererUrl (https://www.claudeusercontent.com)
 *   + domain + parentOrigin=window.location.origin
 *
 * Packaged official desktop loads the product SPA as app://localhost. The
 * sandbox CSP frame-ancestors allowlist includes app://localhost and claude.ai
 * hosts — so residual iframes embed cleanly.
 *
 * Dev product (CLAUDE_DESKTOP_MAIN_VIEW_URL=http://127.0.0.1:5176) embeds from
 * http://localhost:5176 which is NOT in frame-ancestors → Chromium
 * ERR_BLOCKED_BY_RESPONSE and Mermaid stays on residual error chrome.
 *
 * This is not inventing a local mermaid renderer: it only extends the remote
 * sandbox CSP so the same residual eit handshake can complete under local Vite.
 * Packaged app:// path already matches official allowlist and is a no-op.
 */

import { session } from "electron";

const SANDBOX_HOST_RE = /^https:\/\/(www\.)?claudeusercontent\.com(\/|$)/i;

/** Origins residual CSP already allows (subset; we only append product/dev). */
const OFFICIAL_FRAME_ANCESTORS_SNIPPET = "app://localhost";

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

function rewriteCspFrameAncestors(
  csp: string,
  extraAncestors: string[],
): string {
  // CSP may be multiple directives separated by `;`. Only touch frame-ancestors.
  const parts = csp.split(";").map((p) => p.trim()).filter(Boolean);
  let found = false;
  const rewritten = parts.map((directive) => {
    if (!/^frame-ancestors\b/i.test(directive)) return directive;
    found = true;
    const tokens = new Set(
      directive
        .replace(/^frame-ancestors\s+/i, "")
        .split(/\s+/)
        .filter(Boolean),
    );
    for (const origin of extraAncestors) tokens.add(origin);
    // Keep official packaged residual host explicit.
    tokens.add(OFFICIAL_FRAME_ANCESTORS_SNIPPET);
    return `frame-ancestors ${[...tokens].join(" ")}`;
  });
  if (!found) {
    rewritten.push(
      `frame-ancestors 'self' ${OFFICIAL_FRAME_ANCESTORS_SNIPPET} ${extraAncestors.join(" ")}`,
    );
  }
  return rewritten.join("; ");
}

/**
 * Install once on defaultSession (+ artifact-sandbox partition).
 * Safe to call after app.whenReady().
 */
export function installArtifactSandboxFrameAncestorBridge(): void {
  const extra = collectDevParentOrigins();
  const partitions: Array<string | undefined> = [
    undefined,
    "persist:artifact-sandbox",
  ];

  for (const partition of partitions) {
    const ses =
      partition === undefined
        ? session.defaultSession
        : session.fromPartition(partition);

    // Avoid double-register if bootstrap re-entered in tests.
    const flag = "__claudexArtifactSandboxFrameAncestorBridge" as const;
    const anySes = ses as Electron.Session & { [flag]?: boolean };
    if (anySes[flag]) continue;
    anySes[flag] = true;

    ses.webRequest.onHeadersReceived(
      { urls: ["https://www.claudeusercontent.com/*", "https://claudeusercontent.com/*"] },
      (details, callback) => {
        if (!SANDBOX_HOST_RE.test(details.url)) {
          callback({ responseHeaders: details.responseHeaders });
          return;
        }
        const headers = { ...(details.responseHeaders ?? {}) };
        // Electron lower-cases header keys inconsistently — normalize.
        const cspKey = Object.keys(headers).find(
          (k) => k.toLowerCase() === "content-security-policy",
        );
        if (cspKey) {
          const raw = headers[cspKey];
          const list = Array.isArray(raw) ? raw : raw != null ? [String(raw)] : [];
          headers[cspKey] = list.map((value) =>
            rewriteCspFrameAncestors(value, extra),
          );
        }
        // Some stacks also send X-Frame-Options (not present today); strip if so.
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === "x-frame-options") {
            delete headers[key];
          }
        }
        callback({ responseHeaders: headers });
      },
    );
  }

  console.info(
    "[artifact-sandbox] frame-ancestors bridge for",
    extra.join(", "),
  );
}
