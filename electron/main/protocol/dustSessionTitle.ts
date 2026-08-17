/**
 * Product 3p bridge for residual dust `generate_session_title` /
 * `generate_title_and_branch` (BELz eme).
 *
 * Official 1p posts to Anthropic dust and gets a short LLM title. Product 3p
 * has no cloud dust — previously returned `{ title: "" }`, so Recents stayed on
 * "General coding session" forever and residual So typewriter never ran
 * (skipInitialReveal only animates on text change).
 *
 * Fail-soft local compact of first_session_message (not inventing cloud LLM).
 * Empty / pure-digit / placeholder labels → empty title (caller keeps placeholder).
 */

const UPLOADED_FILES_RE = /<uploaded_files>[\s\S]*?<\/uploaded_files>\s*/g;
const PLACEHOLDER_TITLES = new Set([
  "untitled",
  "untitled session",
  "coding session",
  "general coding session",
  "new session",
]);

/** Sidebar-friendly cap (official dust titles are short phrases). */
export const DUST_SESSION_TITLE_MAX = 48;

/** Residual body slice for first_session_message (chapter path uses 250). */
export const DUST_FIRST_MESSAGE_MAX = 250;

export function normalizeDustFirstSessionMessage(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(UPLOADED_FILES_RE, "").trim().slice(0, DUST_FIRST_MESSAGE_MAX);
}

/**
 * Compact first user message into a list title.
 * Returns "" when no usable title (fail soft — keep placeholder).
 */
export function localDustSessionTitleFromMessage(raw: unknown): string {
  const message = normalizeDustFirstSessionMessage(raw);
  if (!message) return "";

  // Prefer first line / first sentence fragment.
  const firstLine = message.split(/\r?\n/)[0]?.trim() ?? "";
  const sentence = firstLine.split(/(?<=[.!?])\s+/)[0]?.trim() ?? firstLine;
  const collapsed = sentence.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (/^\d+$/.test(collapsed)) return "";
  if (PLACEHOLDER_TITLES.has(collapsed.toLowerCase())) return "";

  if (collapsed.length <= DUST_SESSION_TITLE_MAX) return collapsed;

  const slice = collapsed.slice(0, DUST_SESSION_TITLE_MAX);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace >= 16 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/** kebab-ish branch slug from title (generate_title_and_branch residual shape). */
export function localDustBranchNameFromTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "session";
}
