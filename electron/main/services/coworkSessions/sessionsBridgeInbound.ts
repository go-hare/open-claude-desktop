/**
 * Pure inbound message extractors (app.asar handleInboundUserMessage residual).
 *
 * data-official-source: app.asar z6i handleInboundUserMessage content walk
 */

/**
 * Extract user-facing text from an inbound sessions-bridge user message.
 * Walks message.message.content | message.content arrays and string forms.
 */
export function extractInboundUserText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const rec = message as {
    message?: { content?: unknown };
    content?: unknown;
  };
  const content =
    rec.message && typeof rec.message === "object"
      ? rec.message.content
      : rec.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (typeof b.text === "string") {
      // Prefer text / input_text style blocks
      if (
        b.type === undefined ||
        b.type === "text" ||
        b.type === "input_text" ||
        b.type === "output_text"
      ) {
        parts.push(b.text);
      } else if (typeof b.type === "string") {
        // Still collect text-bearing blocks with unknown type
        parts.push(b.text);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Official j9i residual preferred: message.file_attachments[{file_uuid,file_name}].
 * Legacy residual: top-level / message.attachments arrays (shape only).
 */
export function extractInboundUserAttachments(message: unknown): unknown[] {
  if (!message || typeof message !== "object") return [];
  const rec = message as {
    file_attachments?: unknown;
    attachments?: unknown;
    message?: { attachments?: unknown; file_attachments?: unknown };
  };
  if (Array.isArray(rec.file_attachments)) return rec.file_attachments;
  if (
    rec.message &&
    typeof rec.message === "object" &&
    Array.isArray((rec.message as { file_attachments?: unknown }).file_attachments)
  ) {
    return (rec.message as { file_attachments: unknown[] }).file_attachments;
  }
  const raw =
    Array.isArray(rec.attachments)
      ? rec.attachments
      : rec.message && typeof rec.message === "object" && Array.isArray(rec.message.attachments)
        ? rec.message.attachments
        : null;
  return raw ?? [];
}
