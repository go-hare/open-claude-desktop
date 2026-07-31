/**
 * Local residual of official app.asar X2i / yn (CoworkArtifacts store):
 *   - AKe root: Documents/Claude/Artifacts/{id}
 *   - dZ index.html + optional versions/{ts}.html
 *   - PM slug, create/update/list (no Anthropic share / import invent)
 *   - HTML meta script id="cowork-artifact-meta" (twA / uZ residual)
 *
 * Manifest bag is product FeatureStateStore "artifacts" (not full Jni path invent
 * under account RB when identity missing) — disk remains source of truth for list.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  listOfficialArtifactsOnDisk,
  normalizeCoworkArtifactRecord,
  resolveOfficialArtifactsRoot,
} from "../../windows/coworkArtifactViewManager";
import { FeatureStateStore } from "../featureState/featureStateStore";

export const COWORK_ARTIFACT_INDEX = "index.html";
export const COWORK_ARTIFACT_META_SCRIPT_ID = "cowork-artifact-meta";
export const COWORK_ARTIFACT_VERSIONS_DIR = "versions";
/** Official W2i residual — max retained version snapshots. */
export const COWORK_ARTIFACT_MAX_VERSIONS = 100;
/** Official Z2i residual — max HTML size bytes. */
export const COWORK_ARTIFACT_MAX_HTML_BYTES = 1_000_000;

const META_STRIP_RE = new RegExp(
  `\\s*<script type="application/json" id="${COWORK_ARTIFACT_META_SCRIPT_ID}">[\\s\\S]*?<\\/script>\\s*`,
  "gi",
);

export type CoworkArtifactCreateOptions = {
  createdBySessionId?: string;
  description?: string;
  mcpTools?: string[];
  mcpServerNames?: string[];
};

export type CoworkArtifactUpdateOptions = {
  description?: string;
  mcpTools?: string[];
  mcpServerNames?: string[];
  updatedBySessionId?: string;
  /**
   * Official yn.update({viaRestore}) residual — skip version snapshot when restoring.
   */
  viaRestore?: boolean;
};

export type CoworkArtifactDeleteOptions = {
  /** Official yn.delete({removeFiles}) — rm Documents/Claude/Artifacts/{id} when true. */
  removeFiles?: boolean;
};

export type CoworkArtifactLocalStoreDeps = {
  getDocumentsPath?: () => string;
  /** Optional FeatureState bag sync (product residual). */
  featureState?: FeatureStateStore;
  mkdir?: typeof fs.mkdir;
  writeFile?: typeof fs.writeFile;
  readFile?: typeof fs.readFile;
  access?: typeof fs.access;
  rm?: typeof fs.rm;
  copyFile?: typeof fs.copyFile;
  readdir?: typeof fs.readdir;
  stat?: typeof fs.stat;
};

function depsOrDefault(deps: CoworkArtifactLocalStoreDeps = {}) {
  return {
    getDocumentsPath: deps.getDocumentsPath,
    featureState: deps.featureState,
    mkdir: deps.mkdir ?? fs.mkdir,
    writeFile: deps.writeFile ?? fs.writeFile,
    readFile: deps.readFile ?? fs.readFile,
    access: deps.access ?? fs.access,
    rm: deps.rm ?? fs.rm,
    copyFile: deps.copyFile ?? fs.copyFile,
    readdir: deps.readdir ?? fs.readdir,
    stat: deps.stat ?? fs.stat,
  };
}

/** Official PM residual: kebab slug with at least one alphanumeric. */
export function slugifyCoworkArtifactId(raw: string): string {
  const id = String(raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (!id || !/[a-z0-9]/.test(id)) {
    throw new Error("Invalid task name: must contain at least one alphanumeric character");
  }
  return id;
}

export function titleFromCoworkArtifactSlug(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Official P2i residual — strip meta script blocks. */
export function stripCoworkArtifactMeta(html: string): string {
  return String(html ?? "").replace(META_STRIP_RE, "");
}

/** Official H2i + twA residual — inject meta after doctype when present. */
export function embedCoworkArtifactMeta(
  html: string,
  meta: Record<string, unknown>,
): string {
  const stripped = stripCoworkArtifactMeta(html);
  const json = JSON.stringify(meta, null, 2).replace(/<\//g, "<\\/");
  const block = `<script type="application/json" id="${COWORK_ARTIFACT_META_SCRIPT_ID}">\n${json}\n</script>\n`;
  const doctype = stripped.match(/^\s*<!DOCTYPE[^>]*>\s*/i);
  if (doctype) {
    return doctype[0] + block + stripped.slice(doctype[0].length);
  }
  return block + stripped;
}

export function parseCoworkArtifactMeta(html: string): Record<string, unknown> | null {
  const re = new RegExp(
    `^(\\s*<!DOCTYPE[^>]*>)?\\s*<script type="application/json" id="${COWORK_ARTIFACT_META_SCRIPT_ID}">([\\s\\S]*?)<\\/script>\\s*`,
    "is",
  );
  const match = String(html ?? "").match(re);
  if (!match?.[2]) return null;
  try {
    const parsed = JSON.parse(match[2]) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function getCoworkArtifactDir(
  id: string,
  getDocumentsPath?: () => string,
): string {
  return path.join(resolveOfficialArtifactsRoot(getDocumentsPath), id);
}

export function getCoworkArtifactIndexHtmlPath(
  id: string,
  getDocumentsPath?: () => string,
): string {
  return path.join(getCoworkArtifactDir(id, getDocumentsPath), COWORK_ARTIFACT_INDEX);
}

export async function isCoworkArtifactSlugTaken(
  id: string,
  deps: CoworkArtifactLocalStoreDeps = {},
): Promise<boolean> {
  const d = depsOrDefault(deps);
  const dir = getCoworkArtifactDir(id, d.getDocumentsPath);
  try {
    await d.access(dir);
    return true;
  } catch {
    /* fall through */
  }
  if (d.featureState) {
    const bag = d.featureState.loadMap<Record<string, unknown>>("artifacts");
    if (bag.has(id)) return true;
  }
  return false;
}

function persistBagRow(
  row: Record<string, unknown>,
  featureState: FeatureStateStore | undefined,
): void {
  if (!featureState) return;
  const bag = featureState.loadMap<Record<string, unknown>>("artifacts");
  bag.set(String(row.id), row);
  featureState.saveMap("artifacts", bag);
}

/**
 * Official yn.create residual (local host-loop): mkdir AKe/{id}, write index.html + meta, bag row.
 */
export async function createCoworkArtifactLocal(
  rawId: string,
  html: string,
  options: CoworkArtifactCreateOptions = {},
  deps: CoworkArtifactLocalStoreDeps = {},
): Promise<Record<string, unknown>> {
  const d = depsOrDefault(deps);
  const id = slugifyCoworkArtifactId(rawId);
  if (await isCoworkArtifactSlugTaken(id, d)) {
    throw new Error(`Artifact "${id}" already exists`);
  }
  const body = String(html ?? "");
  if (Buffer.byteLength(body, "utf8") > COWORK_ARTIFACT_MAX_HTML_BYTES) {
    throw new Error("Artifact HTML exceeds size limit");
  }
  const name = titleFromCoworkArtifactSlug(id);
  const meta: Record<string, unknown> = {
    name,
    schemaVersion: 1,
    ...(options.description ? { description: options.description } : {}),
    ...(options.mcpTools ? { mcpTools: options.mcpTools } : {}),
    ...(options.mcpServerNames ? { mcpServerNames: options.mcpServerNames } : {}),
  };
  const dir = getCoworkArtifactDir(id, d.getDocumentsPath);
  const indexHtmlPath = path.join(dir, COWORK_ARTIFACT_INDEX);
  await d.mkdir(dir, { recursive: true });
  try {
    await d.writeFile(indexHtmlPath, embedCoworkArtifactMeta(body, meta), "utf8");
  } catch (error) {
    await d.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  const createdAt = Date.now();
  const row = normalizeCoworkArtifactRecord({
    id,
    name,
    createdAt,
    isStarred: true,
    starred: true,
    indexHtmlPath,
    schemaVersion: 1,
    ...(options.description ? { description: options.description } : {}),
    ...(options.createdBySessionId
      ? {
          createdBySessionId: options.createdBySessionId,
          lastModifiedBySessionId: options.createdBySessionId,
        }
      : {}),
    ...(options.mcpTools ? { mcpTools: options.mcpTools } : {}),
  });
  if (!row) throw new Error("Failed to normalize artifact record");
  persistBagRow(row, d.featureState);
  return row;
}

/**
 * Official yn.update residual (local): version snapshot + rewrite index.html.
 */
export async function updateCoworkArtifactLocal(
  rawId: string,
  html: string,
  options: CoworkArtifactUpdateOptions = {},
  deps: CoworkArtifactLocalStoreDeps = {},
): Promise<Record<string, unknown>> {
  const d = depsOrDefault(deps);
  const id = slugifyCoworkArtifactId(rawId);
  const dir = getCoworkArtifactDir(id, d.getDocumentsPath);
  const indexHtmlPath = path.join(dir, COWORK_ARTIFACT_INDEX);
  try {
    await d.access(indexHtmlPath);
  } catch {
    throw new Error(`Artifact "${id}" not found`);
  }
  const body = String(html ?? "");
  if (Buffer.byteLength(body, "utf8") > COWORK_ARTIFACT_MAX_HTML_BYTES) {
    throw new Error("Artifact HTML exceeds size limit");
  }

  let existingMeta: Record<string, unknown> = { name: titleFromCoworkArtifactSlug(id), schemaVersion: 1 };
  try {
    const prev = await d.readFile(indexHtmlPath, "utf8");
    existingMeta = parseCoworkArtifactMeta(prev) ?? existingMeta;
  } catch {
    /* keep defaults */
  }
  if (options.mcpTools !== undefined) existingMeta.mcpTools = options.mcpTools;
  if (options.mcpServerNames !== undefined) existingMeta.mcpServerNames = options.mcpServerNames;
  if (options.description !== undefined) existingMeta.description = options.description;

  // Version snapshot residual (best-effort). Official viaRestore skips snapshot.
  const bag = d.featureState?.loadMap<Record<string, unknown>>("artifacts");
  const existingRow = bag?.get(id) ?? { id, name: existingMeta.name, createdAt: Date.now() };
  const versions = Array.isArray(existingRow.versions)
    ? [...(existingRow.versions as number[])]
    : [];
  if (!options.viaRestore) {
    const versionStamp =
      typeof existingRow.updatedAt === "number"
        ? existingRow.updatedAt
        : typeof existingRow.createdAt === "number"
          ? existingRow.createdAt
          : Date.now();
    const versionsDir = path.join(dir, COWORK_ARTIFACT_VERSIONS_DIR);
    try {
      await d.mkdir(versionsDir, { recursive: true });
      await d.copyFile(indexHtmlPath, path.join(versionsDir, `${versionStamp}.html`));
      versions.push(versionStamp);
      while (versions.length > COWORK_ARTIFACT_MAX_VERSIONS) {
        const drop = versions.shift();
        if (drop !== undefined) {
          await d.rm(path.join(versionsDir, `${drop}.html`), { force: true }).catch(() => undefined);
        }
      }
    } catch {
      /* version residual best-effort */
    }
  }

  await d.writeFile(indexHtmlPath, embedCoworkArtifactMeta(body, existingMeta), "utf8");
  const updatedAt = Date.now();
  const row = normalizeCoworkArtifactRecord({
    ...existingRow,
    id,
    name:
      typeof existingMeta.name === "string" && existingMeta.name
        ? existingMeta.name
        : titleFromCoworkArtifactSlug(id),
    updatedAt,
    indexHtmlPath,
    versions,
    schemaVersion: 1,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.updatedBySessionId
      ? { lastModifiedBySessionId: options.updatedBySessionId }
      : {}),
    ...(options.mcpTools !== undefined ? { mcpTools: options.mcpTools } : {}),
  });
  if (!row) throw new Error("Failed to normalize artifact record");
  persistBagRow(row, d.featureState);
  return row;
}

/** Official getVersionPath residual: Artifacts/{id}/versions/{n}.html */
export function getCoworkArtifactVersionPath(
  id: string,
  version: number,
  getDocumentsPath?: () => string,
): string {
  return path.join(
    getCoworkArtifactDir(id, getDocumentsPath),
    COWORK_ARTIFACT_VERSIONS_DIR,
    `${Math.trunc(version)}.html`,
  );
}

/**
 * Official yn.delete residual:
 * missing bag row → false;
 * drop bag; optional rm disk dir when removeFiles;
 * emit is caller's job (featureHandlers / onArtifactsChanged).
 */
export async function deleteCoworkArtifactLocal(
  rawId: string,
  options: CoworkArtifactDeleteOptions = {},
  deps: CoworkArtifactLocalStoreDeps = {},
): Promise<boolean> {
  const d = depsOrDefault(deps);
  const id = String(rawId ?? "").trim();
  if (!id) return false;

  let hadBag = false;
  if (d.featureState) {
    const bag = d.featureState.loadMap<Record<string, unknown>>("artifacts");
    hadBag = bag.has(id);
    if (hadBag) {
      bag.delete(id);
      d.featureState.saveMap("artifacts", bag);
    }
  }

  const dir = getCoworkArtifactDir(id, d.getDocumentsPath);
  let onDisk = false;
  try {
    await d.access(dir);
    onDisk = true;
  } catch {
    /* missing */
  }

  // Official requires bag row. Product residual: also allow disk-only delete when
  // removeFiles (getAll merges disk → bag; library Delete must clear orphans).
  if (!hadBag && !onDisk) return false;
  if (!hadBag && !options.removeFiles) return false;

  if (options.removeFiles && onDisk) {
    await d.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return true;
}

/**
 * Official yn.restoreVersion residual:
 * versions list must include stamp; read versions/{n}.html → update(viaRestore).
 */
export async function restoreCoworkArtifactVersionLocal(
  rawId: string,
  version: number,
  deps: CoworkArtifactLocalStoreDeps = {},
): Promise<boolean> {
  const d = depsOrDefault(deps);
  let id: string;
  try {
    id = slugifyCoworkArtifactId(rawId);
  } catch {
    return false;
  }
  if (!Number.isFinite(version)) return false;
  const stamp = Math.trunc(version);

  const bag = d.featureState?.loadMap<Record<string, unknown>>("artifacts");
  const row = bag?.get(id);
  const versions = Array.isArray(row?.versions) ? (row!.versions as unknown[]) : null;
  // When bag has versions list, require membership (official). When bag cold,
  // still allow restore if version file exists on disk (product residual).
  if (versions && !versions.some((v) => Number(v) === stamp)) {
    return false;
  }

  const versionPath = getCoworkArtifactVersionPath(id, stamp, d.getDocumentsPath);
  try {
    await d.access(versionPath);
  } catch {
    return false;
  }

  try {
    const html = await d.readFile(versionPath, "utf8");
    await updateCoworkArtifactLocal(id, html, { viaRestore: true }, deps);
    return true;
  } catch (error) {
    console.error("[CoworkArtifacts] restoreVersion failed", { id, version: stamp, error });
    return false;
  }
}

export async function listCoworkArtifactsLocal(
  deps: CoworkArtifactLocalStoreDeps = {},
): Promise<Array<Record<string, unknown>>> {
  const d = depsOrDefault(deps);
  return listOfficialArtifactsOnDisk(d.getDocumentsPath, {
    readdir: d.readdir as never,
    access: d.access as never,
    stat: d.stat as never,
  });
}

/** Official y_ residual: mcp__server__tool form. */
export function isCoworkMcpToolName(value: string): boolean {
  return /^mcp__[A-Za-z0-9._-]+__[A-Za-z0-9._-]+$/.test(value);
}

export async function readCoworkArtifactHtmlFromPath(
  htmlPath: string,
  deps: CoworkArtifactLocalStoreDeps = {},
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  const d = depsOrDefault(deps);
  const file = String(htmlPath ?? "").trim();
  if (!file || !path.isAbsolute(file)) {
    return { ok: false, error: "html_path must be an absolute path to a file you already wrote." };
  }
  try {
    const html = await d.readFile(file, "utf8");
    if (Buffer.byteLength(html, "utf8") > COWORK_ARTIFACT_MAX_HTML_BYTES) {
      return { ok: false, error: "Artifact HTML exceeds size limit" };
    }
    return { ok: true, html };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to read ${file}: ${message}` };
  }
}
