/**
 * Official residual (app.asar Custom3pSetup multi-config library):
 *
 *   wrA() = join(userData, "configLibrary")
 *   bb(id) = join(wrA(), `${id}.json`)
 *   RLA()  = join(wrA(), "_meta.json")
 *   txe    = /^[a-f0-9-]{36}$/
 *
 *   cgr listConfigs → { appliedId, entries: [{id,name,provider?,note?}] }
 *   Igr readConfig(id) → bag object
 *   Egr writeConfig(id, bag) → write bb(id); if applied → re-init enterprise
 *   Cgr createConfig(name) → uuid + empty bag + meta entry
 *   ugr setAppliedConfig(id)
 *   dgr revealConfig(id) → showItemInFolder(bb(id))
 *
 * Product previously stuffed multi-config into desktop-shell-settings.json
 * `custom3pConfigs` (non-residual). That bag only ever held
 * `{ inferenceProvider: "gateway" }` while official Setup persisted full
 * gateway fields + inferenceModels under configLibrary — so health/probe
 * and model picker could not see deepseek-v4-pro etc.
 *
 * Prefer configLibrary as source of truth. Optionally migrate a legacy
 * shell bag once into configLibrary when the library is empty.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CUSTOM3P_CONFIG_LIBRARY_DIR = "configLibrary";
export const CUSTOM3P_CONFIG_LIBRARY_META = "_meta.json";

/** Official txe residual — config ids are UUIDs. */
export const CUSTOM3P_CONFIG_ID_RE = /^[a-f0-9-]{36}$/i;

export type Custom3pLibraryMetaEntry = {
  id: string;
  name: string;
};

export type Custom3pLibraryMeta = {
  appliedId: string;
  entries: Custom3pLibraryMetaEntry[];
};

export type Custom3pLibraryListEntry = Custom3pLibraryMetaEntry & {
  provider?: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Custom3pLibraryList = {
  appliedId: string;
  entries: Custom3pLibraryListEntry[];
  isManaged: boolean;
  platform: NodeJS.Platform;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isCustom3pConfigId(id: string): boolean {
  return CUSTOM3P_CONFIG_ID_RE.test(id);
}

export function custom3pConfigLibraryDir(userDataPath: string): string {
  return path.join(userDataPath, CUSTOM3P_CONFIG_LIBRARY_DIR);
}

export function custom3pConfigLibraryMetaPath(userDataPath: string): string {
  return path.join(custom3pConfigLibraryDir(userDataPath), CUSTOM3P_CONFIG_LIBRARY_META);
}

export function custom3pConfigLibraryFilePath(
  userDataPath: string,
  id: string,
): string {
  return path.join(custom3pConfigLibraryDir(userDataPath), `${id}.json`);
}

function ensureLibraryDir(userDataPath: string): void {
  fs.mkdirSync(custom3pConfigLibraryDir(userDataPath), { recursive: true });
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function readJsonFile(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function readMeta(userDataPath: string): Custom3pLibraryMeta | null {
  const raw = readJsonFile(custom3pConfigLibraryMetaPath(userDataPath));
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Record<string, unknown>;
  const appliedId = typeof bag.appliedId === "string" ? bag.appliedId : "";
  const entriesRaw = Array.isArray(bag.entries) ? bag.entries : [];
  const entries: Custom3pLibraryMetaEntry[] = [];
  for (const row of entriesRaw) {
    const r = record(row);
    const id = stringField(r.id);
    const name = stringField(r.name);
    if (!id || !name || !isCustom3pConfigId(id)) continue;
    entries.push({ id, name });
  }
  if (entries.length === 0) return null;
  const applied =
    appliedId && entries.some((e) => e.id === appliedId)
      ? appliedId
      : entries[0]!.id;
  return { appliedId: applied, entries };
}

function writeMeta(userDataPath: string, meta: Custom3pLibraryMeta): void {
  ensureLibraryDir(userDataPath);
  writeJsonAtomic(custom3pConfigLibraryMetaPath(userDataPath), {
    appliedId: meta.appliedId,
    entries: meta.entries.map((e) => ({ id: e.id, name: e.name })),
  });
}

/**
 * Official ggr residual — list entry provider/note from bag.
 */
export function custom3pLibraryEntryNoteFromConfig(
  config: unknown,
): { provider?: string; note?: string } {
  const bag = record(config);
  const provider = stringField(bag.inferenceProvider);
  if (!provider) return {};
  switch (provider) {
    case "bedrock":
      return { provider, note: stringField(bag.inferenceBedrockRegion) };
    case "vertex":
      return { provider, note: stringField(bag.inferenceVertexRegion) };
    case "gateway":
      return { provider, note: stringField(bag.inferenceGatewayBaseUrl) };
    case "foundry":
      return { provider, note: stringField(bag.inferenceFoundryResource) };
    default:
      return { provider, note: undefined };
  }
}

export function readCustom3pConfigLibraryBag(
  userDataPath: string,
  id: string,
): Record<string, unknown> {
  if (!isCustom3pConfigId(id)) return {};
  const raw = readJsonFile(custom3pConfigLibraryFilePath(userDataPath, id));
  return record(raw);
}

export function writeCustom3pConfigLibraryBag(
  userDataPath: string,
  id: string,
  config: unknown,
): void {
  if (!isCustom3pConfigId(id)) {
    throw new Error("unknown config id");
  }
  ensureLibraryDir(userDataPath);
  writeJsonAtomic(
    custom3pConfigLibraryFilePath(userDataPath, id),
    record(config),
  );
}

/**
 * Official cgr residual list shape (+ product isManaged/platform fields
 * already returned by product Custom3pSetup.listConfigs).
 */
export function listCustom3pConfigLibrary(
  userDataPath: string,
): Custom3pLibraryList {
  const meta = readMeta(userDataPath);
  if (!meta) {
    return {
      appliedId: "",
      entries: [],
      isManaged: false,
      platform: process.platform,
    };
  }
  const entries: Custom3pLibraryListEntry[] = meta.entries.map((entry) => {
    const bag = readCustom3pConfigLibraryBag(userDataPath, entry.id);
    const note = custom3pLibraryEntryNoteFromConfig(bag);
    return {
      id: entry.id,
      name: entry.name,
      ...note,
    };
  });
  return {
    appliedId: meta.appliedId,
    entries,
    isManaged: false,
    platform: process.platform,
  };
}

export function readCustom3pConfigLibrary(
  userDataPath: string,
  id: string,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  const meta = readMeta(userDataPath);
  if (!meta || !meta.entries.some((e) => e.id === id)) {
    return { ok: false, error: "config not found" };
  }
  return { ok: true, config: readCustom3pConfigLibraryBag(userDataPath, id) };
}

export function writeCustom3pConfigLibrary(
  userDataPath: string,
  id: string,
  config: unknown,
): { ok: true } | { ok: false; error: string } {
  const meta = readMeta(userDataPath);
  if (!meta || !meta.entries.some((e) => e.id === id)) {
    return { ok: false, error: "config not found" };
  }
  try {
    writeCustom3pConfigLibraryBag(userDataPath, id, config);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createCustom3pConfigLibraryEntry(
  userDataPath: string,
  name: string,
  initialConfig: unknown = {},
): Custom3pLibraryMetaEntry {
  const id = randomUUID();
  const meta = readMeta(userDataPath) ?? { appliedId: "", entries: [] };
  writeCustom3pConfigLibraryBag(userDataPath, id, initialConfig ?? {});
  const entry = { id, name: name.trim() || "Default" };
  meta.entries.push(entry);
  if (!meta.appliedId) meta.appliedId = id;
  writeMeta(userDataPath, meta);
  return entry;
}

export function duplicateCustom3pConfigLibraryEntry(
  userDataPath: string,
  id: string,
  name?: string,
): Custom3pLibraryMetaEntry | null {
  const meta = readMeta(userDataPath);
  if (!meta) return null;
  const source = meta.entries.find((e) => e.id === id);
  if (!source) return null;
  const bag = readCustom3pConfigLibraryBag(userDataPath, id);
  return createCustom3pConfigLibraryEntry(
    userDataPath,
    name?.trim() || `${source.name} copy`,
    bag,
  );
}

export function renameCustom3pConfigLibraryEntry(
  userDataPath: string,
  id: string,
  name: string,
): Custom3pLibraryMetaEntry | null {
  const meta = readMeta(userDataPath);
  if (!meta) return null;
  const nextName = name.trim();
  if (!nextName) return null;
  let found: Custom3pLibraryMetaEntry | null = null;
  meta.entries = meta.entries.map((entry) => {
    if (entry.id !== id) return entry;
    found = { id, name: nextName };
    return found;
  });
  if (!found) return null;
  writeMeta(userDataPath, meta);
  return found;
}

export function deleteCustom3pConfigLibraryEntry(
  userDataPath: string,
  id: string,
): Custom3pLibraryList {
  const meta = readMeta(userDataPath);
  if (!meta) {
    return listCustom3pConfigLibrary(userDataPath);
  }
  // Official Qgr: cannot delete the last configuration.
  if (meta.entries.length <= 1) {
    throw new Error("cannot delete the last configuration");
  }
  if (!meta.entries.some((e) => e.id === id)) {
    return listCustom3pConfigLibrary(userDataPath);
  }
  meta.entries = meta.entries.filter((e) => e.id !== id);
  if (meta.appliedId === id) {
    meta.appliedId = meta.entries[0]?.id ?? "";
  }
  writeMeta(userDataPath, meta);
  try {
    fs.rmSync(custom3pConfigLibraryFilePath(userDataPath, id), { force: true });
  } catch {
    // ignore
  }
  return listCustom3pConfigLibrary(userDataPath);
}

export function setAppliedCustom3pConfigLibraryId(
  userDataPath: string,
  id: string,
): boolean {
  const meta = readMeta(userDataPath);
  if (!meta || !meta.entries.some((e) => e.id === id)) return false;
  meta.appliedId = id;
  writeMeta(userDataPath, meta);
  return true;
}

export function getAppliedCustom3pConfigLibraryId(
  userDataPath: string,
): string | null {
  const meta = readMeta(userDataPath);
  return meta?.appliedId || null;
}

export function getAppliedCustom3pConfigLibraryBag(
  userDataPath: string,
): { id: string | null; config: Record<string, unknown> | null } {
  const meta = readMeta(userDataPath);
  if (!meta?.appliedId) return { id: null, config: null };
  const config = readCustom3pConfigLibraryBag(userDataPath, meta.appliedId);
  return {
    id: meta.appliedId,
    config: Object.keys(config).length > 0 ? config : {},
  };
}

export function revealCustom3pConfigLibraryPath(
  userDataPath: string,
  id?: string | null,
): string | null {
  const meta = readMeta(userDataPath);
  const targetId = id && isCustom3pConfigId(id) ? id : meta?.appliedId;
  if (!targetId) {
    const dir = custom3pConfigLibraryDir(userDataPath);
    ensureLibraryDir(userDataPath);
    return dir;
  }
  const filePath = custom3pConfigLibraryFilePath(userDataPath, targetId);
  if (!fs.existsSync(filePath)) {
    // Ensure empty bag exists so reveal has a target (official dgr).
    writeCustom3pConfigLibraryBag(userDataPath, targetId, {});
  }
  return filePath;
}

/**
 * One-shot migration: desktop-shell-settings custom3pConfigs → configLibrary
 * when library is empty. Keeps user's applied bag (baseUrl / models / key)
 * if they ever wrote full fields into the shell bag.
 */
export function migrateLegacyShellCustom3pConfigsToLibrary(
  userDataPath: string,
  shell: {
    appliedCustom3pConfigId?: string | null;
    custom3pConfigs?: Record<string, unknown>;
  },
): boolean {
  if (readMeta(userDataPath)) return false;
  const configs = record(shell.custom3pConfigs);
  const ids = Object.keys(configs);
  if (ids.length === 0) return false;

  const entries: Custom3pLibraryMetaEntry[] = [];
  let appliedId = "";
  for (const legacyId of ids) {
    const row = record(configs[legacyId]);
    const name =
      stringField(row.name)
      ?? stringField(row.id)
      ?? "Default";
    const config = row.config ?? {};
    const id = isCustom3pConfigId(legacyId) ? legacyId : randomUUID();
    writeCustom3pConfigLibraryBag(userDataPath, id, config);
    entries.push({ id, name });
    if (
      shell.appliedCustom3pConfigId
      && (shell.appliedCustom3pConfigId === legacyId
        || shell.appliedCustom3pConfigId === id)
    ) {
      appliedId = id;
    }
  }
  if (entries.length === 0) return false;
  if (!appliedId) appliedId = entries[0]!.id;
  writeMeta(userDataPath, { appliedId, entries });
  return true;
}
