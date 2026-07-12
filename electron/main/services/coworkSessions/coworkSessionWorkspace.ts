import { realpath } from "node:fs/promises";
import path from "node:path";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

export type CoworkAddFolderResult =
  | { folderPath: string; ok: true }
  | { error: string; ok: false };

export async function addCoworkSessionFolder(
  session: CoworkSessionRuntimeState,
  folderPath: string,
): Promise<CoworkAddFolderResult> {
  if (!path.isAbsolute(folderPath)) {
    return { error: "Folder path must be absolute", ok: false };
  }
  const canonical = await realpath(folderPath).catch(() => null);
  if (!canonical) return { error: "Folder could not be resolved", ok: false };
  const existing = session.resolvedFolders.some(
    (folder) => (folder.canonical ?? folder.display) === canonical,
  );
  if (!existing) {
    session.resolvedFolders.push({
      canonical,
      display: canonical,
      kind: "local",
    });
  }
  return { folderPath: canonical, ok: true };
}
