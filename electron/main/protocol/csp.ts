export type CspOptions = {
  connectSrc?: string[];
  scriptHashes?: string[];
};

const INLINE_SCRIPT_RE = /<script(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

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

export function buildAppContentSecurityPolicy(options: CspOptions = {}): string {
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
    directive("connect-src", ["'self'", ...(options.connectSrc ?? [])]),
    directive("img-src", ["'self'", "data:", "blob:"]),
    directive("script-src", ["'self'", "'wasm-unsafe-eval'", ...(options.scriptHashes ?? []).map((hash) => `'sha256-${hash}'`)]),
  ].join("; ");
}
