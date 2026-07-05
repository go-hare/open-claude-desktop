const TRUSTED_ORIGINS = new Set([
  "https://claude.ai",
  "https://preview.claude.ai",
  "https://claude.com",
  "https://preview.claude.com",
  "app://localhost",
]);

function originOf(url: URL): string {
  return url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin;
}

export function isTrustedTopFrameLocation(locationHref = window.location.href): boolean {
  try {
    const url = new URL(locationHref);
    return TRUSTED_ORIGINS.has(originOf(url)) || url.hostname === "localhost" || originOf(url).endsWith(".ant.dev");
  } catch {
    return false;
  }
}
