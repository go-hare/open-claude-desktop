/**
 * Official sessions-bridge attachment residual (j9i / $9i / W9i / Z9i / X7).
 *
 * asar:
 *   j9i(message) → file_attachments: { file_uuid, file_name, is_image? }[]
 *   X7() → userData/pending-uploads
 *   W9i → GET {apiHost}/api/organizations/{org}/files/{uuid}/contents → pending-uploads/{uuid8}-{safeName}
 *   Z9i → Promise.all map W9i, filter defined
 *   handleInboundUserMessage: B = await Z9i(o, org); text = @"paths " + n; sendMessage(..., B)
 *
 * Product residual: real download when token+host available; soft-fail per file (no invent paths).
 *
 * data-official-source: app.asar gwe / j9i / $9i / W9i / Z9i / X7
 */

import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

const LOG = "[sessions-bridge:attach]";

export type BridgeFileAttachment = {
  file_uuid: string;
  file_name: string;
  is_image?: boolean;
};

export type MaterializeBridgeAttachmentsDeps = {
  /** Official or() api host residual. */
  apiHost: string;
  orgUuid: string;
  getAccessToken: () => Promise<string>;
  /** Official X7 residual; default userData/pending-uploads. */
  pendingUploadsDir?: string;
  /** Inject for tests. */
  downloadToFile?: (url: string, dest: string, token: string) => Promise<void>;
  ensureDir?: (dir: string) => Promise<void>;
};

/** Official X7 residual. */
export function getBridgePendingUploadsDir(userDataDir?: string): string {
  const root =
    userDataDir ||
    (typeof app?.getPath === "function" ? app.getPath("userData") : process.cwd());
  return path.join(root, "pending-uploads");
}

/** Official $9i residual — basename + safe chars. */
export function safeBridgeAttachmentFileName(fileName: string): string {
  const base = path.basename(fileName || "");
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "attachment";
}

/**
 * Official j9i residual — parse file_attachments from inbound user message.
 * Invalid entries dropped (safeParse residual without zod dependency).
 */
export function parseBridgeFileAttachments(
  message: unknown,
): BridgeFileAttachment[] {
  if (!message || typeof message !== "object") return [];
  const rec = message as { file_attachments?: unknown };
  if (!("file_attachments" in rec) || !Array.isArray(rec.file_attachments)) {
    return [];
  }
  const out: BridgeFileAttachment[] = [];
  for (const item of rec.file_attachments) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      file_uuid?: unknown;
      file_name?: unknown;
      is_image?: unknown;
    };
    if (typeof row.file_uuid !== "string" || !row.file_uuid) continue;
    if (typeof row.file_name !== "string" || !row.file_name) continue;
    out.push({
      file_uuid: row.file_uuid,
      file_name: row.file_name,
      is_image: row.is_image === true,
    });
  }
  return out;
}

/** Official W9i residual — one attachment → local path or undefined. */
export async function materializeBridgeAttachment(
  attachment: BridgeFileAttachment,
  deps: MaterializeBridgeAttachmentsDeps,
): Promise<string | undefined> {
  const dir =
    deps.pendingUploadsDir ?? getBridgePendingUploadsDir();
  const safeName = safeBridgeAttachmentFileName(attachment.file_name);
  const uuid8 = attachment.file_uuid
    .slice(0, 8)
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  const dest = path.join(dir, `${uuid8}-${safeName}`);
  const host = deps.apiHost.replace(/\/+$/, "");
  const url = `${host}/api/organizations/${encodeURIComponent(
    deps.orgUuid,
  )}/files/${encodeURIComponent(attachment.file_uuid)}/contents`;

  try {
    const ensure =
      deps.ensureDir ?? ((d: string) => fs.mkdir(d, { recursive: true }).then(() => undefined));
    await ensure(dir);
    const token = await deps.getAccessToken();
    if (!token) {
      console.info(`${LOG} ${attachment.file_uuid} failed: no access token`);
      return undefined;
    }
    if (deps.downloadToFile) {
      await deps.downloadToFile(url, dest, token);
    } else {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-version": "2023-06-01",
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(dest, buf);
    }
    console.info(`${LOG} resolved ${attachment.file_uuid} → ${dest}`);
    return dest;
  } catch (err) {
    console.info(
      `${LOG} ${attachment.file_uuid} failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }
}

/**
 * Official Z9i residual — materialize all attachments; drop failures.
 * Empty input → [] (no invent).
 */
export async function materializeBridgeAttachments(
  attachments: BridgeFileAttachment[],
  deps: MaterializeBridgeAttachmentsDeps,
): Promise<string[]> {
  if (!attachments.length) return [];
  const results = await Promise.all(
    attachments.map((a) => materializeBridgeAttachment(a, deps)),
  );
  return results.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/** Official text prefix residual: `@"/path" @"/path2" ` + text */
export function prefixBridgeMessageWithAttachmentPaths(
  text: string,
  localPaths: string[],
): string {
  if (!localPaths.length) return text;
  const prefix = localPaths.map((f) => `@"${f}"`).join(" ") + " ";
  return prefix + text;
}
