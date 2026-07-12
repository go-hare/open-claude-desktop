import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CoworkPersistedSessionMetadata } from "./coworkSessionTypes";

export async function writeCoworkMetadataAtomically(
  filePath: string,
  metadata: CoworkPersistedSessionMetadata,
): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, JSON.stringify(metadata, null, 2), "utf8");
  await rename(temporaryPath, filePath);
}
