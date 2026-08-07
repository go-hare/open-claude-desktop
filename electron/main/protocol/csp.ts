export type CspOptions = {
  connectSrc?: string[];
  frameSrc?: string[];
  imgSrc?: string[];
  scriptHashes?: string[];
  /**
   * Official Ob nonessential categories (artifact-sandbox / connector-favicons)
   * are gated by disableNonessentialServices (residual Xir/zLA).
   * When true, omit those hosts from frame-src / img-src.
   */
  disableNonessentialServices?: boolean;
};

const INLINE_SCRIPT_RE = /<script(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/** Official L9t residual (index.js Ob artifact-sandbox). */
export const OFFICIAL_ARTIFACT_SANDBOX_HOST = "www.claudeusercontent.com";

/**
 * Official Ob connector-favicons residual (v9t / G9t):
 *   www.google.com/s2/favicons + *.gstatic.com/faviconV2 → img-src
 * Product CoworkFavicon builds the same Google proxy URLs.
 */
export const OFFICIAL_CONNECTOR_FAVICON_IMG_HOSTS = [
  "www.google.com",
  "*.gstatic.com",
] as const;

function directive(name: string, values: string[]): string {
  return [name, ...values].join(" ");
}

export async function sha256Base64(content: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(content, "utf8").digest("base64");
}

/** Mirrors original `drr(indexHtml)` inline script hash extraction. */
export async function extractInlineScriptHashes(html: string): Promise<string[]> {
  const hashes: string[] = [];
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    const script = match[1];
    if (script) hashes.push(await sha256Base64(script));
  }
  return hashes;
}

/**
 * Official residual CSP builder Xir (app.asar index.js):
 *   base directives + Bme defaults + Ob renderer endpoints
 *   - artifact-sandbox → frame-src https://www.claudeusercontent.com
 *   - connector-favicons → img-src https://www.google.com + https://*.gstatic.com
 *   (unless MDM disableNonessentialServices)
 *
 * Product previously omitted frame-src / favicon img-src, so:
 *   - MermaidIframe (eit) stuck on "Rendering diagram..."
 *   - CoworkFavicon Google/gstatic icons failed CSP
 */
export function buildAppContentSecurityPolicy(options: CspOptions = {}): string {
  // Residual Bme: frame-src starts empty then Ob adds hosts; always includes 'self'.
  const frameSrc = new Set<string>(["'self'", ...(options.frameSrc ?? [])]);
  // Residual Bme img-src defaults: data: blob: (+ 'self' from Xir map).
  const imgSrc = new Set<string>(["'self'", "data:", "blob:", ...(options.imgSrc ?? [])]);

  if (!options.disableNonessentialServices) {
    frameSrc.add(`https://${OFFICIAL_ARTIFACT_SANDBOX_HOST}`);
    for (const host of OFFICIAL_CONNECTOR_FAVICON_IMG_HOSTS) {
      imgSrc.add(`https://${host}`);
    }
  }

  return [
    directive("default-src", ["'self'"]),
    directive("style-src", ["'self'", "'unsafe-inline'"]),
    directive("object-src", ["'none'"]),
    directive("base-uri", ["'none'"]),
    directive("font-src", ["'self'"]),
    directive("form-action", ["'self'"]),
    directive("media-src", ["'self'"]),
    directive("worker-src", ["'self'", "blob:"]),
    directive("frame-ancestors", ["'self'"]),
    "block-all-mixed-content",
    "upgrade-insecure-requests",
    // Residual Xir order: dynamic dirs after upgrade-insecure-requests
    directive("connect-src", ["'self'", ...(options.connectSrc ?? [])]),
    directive("frame-src", [...frameSrc]),
    directive("img-src", [...imgSrc]),
    directive("script-src", ["'self'", "'wasm-unsafe-eval'", ...(options.scriptHashes ?? []).map((hash) => `'sha256-${hash}'`)]),
  ].join("; ");
}
