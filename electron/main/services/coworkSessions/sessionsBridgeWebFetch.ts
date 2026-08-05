/**
 * Official _1i residual — extract URLs from user text for seedWebFetchProvenance.
 *
 * Official (app.asar):
 *   y1i = /https?:\/\/[^\s<>"'`]+/g
 *   S1i = /www\.[^\s<>"'`]+/g
 *   R1i = /(?<!\S)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(?:\/[^\s<>"'`]*)?/g
 *   owA strip trailing punct + unmatched closers
 *   tM normalize: http(s) only, strip hash, strip trailing slash on non-root path
 *
 * Product residual: same extractors; no invent network fetch.
 *
 * data-official-source: app.asar _1i / tM / owA / seedWebFetchProvenance
 */

/** Official y1i */
const ABSOLUTE_URL_RE = /https?:\/\/[^\s<>"'`]+/g;
/** Official S1i */
const WWW_URL_RE = /www\.[^\s<>"'`]+/g;
/**
 * Official R1i — bare domain at token start (not mid-word).
 * Note: JS lookbehind (?<!\S) requires modern V8 (Electron OK).
 */
const BARE_DOMAIN_RE =
  /(?<!\S)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(?:\/[^\s<>"'`]*)?/g;

/** Official N1i */
const TRAILING_PUNCT = new Set([...".,;:!?'\""]);
/** Official k1i */
const CLOSER_OPENER: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

/**
 * Official owA residual — strip trailing punctuation and unmatched closers.
 * Does not invent scheme; only trims raw match text.
 */
export function stripUrlMatchTrailing(raw: string): string {
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1]!;
    if (TRAILING_PUNCT.has(ch)) {
      end--;
      continue;
    }
    const opener = CLOSER_OPENER[ch];
    if (opener) {
      let opens = 0;
      let closes = 0;
      for (let i = 0; i < end; i++) {
        if (raw[i] === opener) opens++;
        else if (raw[i] === ch) closes++;
      }
      if (closes > opens) {
        end--;
        continue;
      }
    }
    break;
  }
  return raw.slice(0, end);
}

/**
 * Official tM residual — normalize to http(s) href or null.
 * Strips hash; drops trailing slash on non-root pathname.
 */
export function normalizeProvenanceUrl(raw: string): string | null {
  const cleaned = stripUrlMatchTrailing(raw.trim());
  if (!cleaned) return null;
  try {
    const withScheme = /^https?:\/\//i.test(cleaned)
      ? cleaned
      : `https://${cleaned}`;
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    // Reject clearly non-web schemes that got forced through https:// (ftp.example.com is ok as host)
    // Email-like local@host is not a bare domain match under R1i; absolute mailto: never matches y1i.
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return null;
  }
}

/** Official _1i residual — ordered unique URLs from free text (duplicates kept as first-seen). */
export function extractUrlsForWebFetchProvenance(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const n = normalizeProvenanceUrl(raw);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };
  for (const m of text.matchAll(ABSOLUTE_URL_RE)) push(m[0]!);
  for (const m of text.matchAll(WWW_URL_RE)) push(`https://${m[0]!}`);
  for (const m of text.matchAll(BARE_DOMAIN_RE)) push(`https://${m[0]!}`);
  return out;
}
