import fs from "node:fs/promises";
import path from "node:path";

export type OpenDocumentRecord = {
  id: string;
  name: string;
  path: string;
  extension: string;
  openedAt: string;
  updatedAt: string;
  size?: number;
};

const documents = new Map<string, OpenDocumentRecord>();

function idForPath(filePath: string): string {
  return Buffer.from(filePath).toString("base64url");
}

export async function recordOpenDocument(filePath: string): Promise<OpenDocumentRecord | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    const existing = documents.get(filePath);
    const now = new Date().toISOString();
    const record: OpenDocumentRecord = {
      id: existing?.id ?? idForPath(filePath),
      name: path.basename(filePath),
      path: filePath,
      extension: path.extname(filePath).slice(1).toLowerCase(),
      openedAt: existing?.openedAt ?? now,
      updatedAt: now,
      size: stat.size,
    };
    documents.set(filePath, record);
    return record;
  } catch {
    return null;
  }
}

export function listOpenDocuments(): OpenDocumentRecord[] {
  return Array.from(documents.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readOpenDocumentAsBase64(idOrPath: unknown): Promise<string | null> {
  const candidate = typeof idOrPath === "string" ? idOrPath : "";
  const record = listOpenDocuments().find((item) => item.id === candidate || item.path === candidate);
  const filePath = record?.path ?? candidate;
  if (!filePath) return null;
  try {
    await recordOpenDocument(filePath);
    return (await fs.readFile(filePath)).toString("base64");
  } catch {
    return null;
  }
}
