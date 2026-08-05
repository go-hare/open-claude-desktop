import { shell } from "electron";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

export type ExtensionManifest = Record<string, unknown> & {
  manifest_version: string;
  name: string;
  display_name?: string;
  version: string;
  description: string;
  author: { name: string; email?: string; url?: string };
  server: { type: "python" | "node" | "binary" | "uv"; entry_point: string; mcp_config?: Record<string, unknown> };
};

export type ExtensionSettings = {
  isEnabled: boolean;
  userConfig?: Record<string, unknown>;
  orgBlockedReason?: string;
};

export type InstalledExtension = {
  id: string;
  path: string;
  displayName: string;
  signatureInfo?: Record<string, unknown>;
  manifest: ExtensionManifest;
  settings: ExtensionSettings;
};

type ExtensionMetadata = {
  id: string;
  path: string;
  kind: "directory" | "archive";
  manifest: ExtensionManifest;
  installedAt: string;
  updatedAt: string;
};

type MetadataFile = {
  extensions: Record<string, ExtensionMetadata>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `extension-${Date.now()}`;
}

/**
 * Official BLA residual (app.asar / index.js):
 *   slug segment; if empty after sanitize → xxHash-like x{32hex}; id = `${prefix}.${author}.${name}`
 *   prefixes: local.dxt | local.mcpb | local.unpacked
 * Official kC/dG: id.startsWith("local.dxt"|"local.unpacked") [+ product local.mcpb].
 */
function officialSlugSegment(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_.]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length > 0 || input.length === 0) return cleaned;
  // Official i(): FNV-ish 128-bit when sanitize empties a non-empty source.
  const mask = (1n << 128n) - 1n;
  let hash = 0x6c62272e07bb014262b821756295c58dn;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x0000000001000000000000000000013bn) & mask;
  }
  return `x${hash.toString(16).padStart(32, "0")}`;
}

function officialLocalExtensionId(
  manifest: ExtensionManifest,
  prefix: "local.dxt" | "local.mcpb" | "local.unpacked",
): string {
  const author = officialSlugSegment(manifest.author?.name ?? "");
  const name = officialSlugSegment(manifest.name);
  return `${prefix}.${author}.${name}`;
}

function userExtensionsDir(userDataDir: string): string {
  return path.join(userDataDir, "extensions");
}

function extensionSettingsDir(userDataDir: string): string {
  return path.join(userDataDir, "extension-settings");
}

function metadataPath(userDataDir: string): string {
  return path.join(userExtensionsDir(userDataDir), "metadata.json");
}

function settingsPath(userDataDir: string, extensionId: string): string {
  return path.join(extensionSettingsDir(userDataDir), `${extensionId}.json`);
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeAuthor(value: unknown): { name: string; email?: string; url?: string } {
  if (typeof value === "string" && value.trim()) return { name: value.trim() };
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return {
      name: typeof record.name === "string" && record.name.trim() ? record.name : "Local extension",
      ...(typeof record.email === "string" ? { email: record.email } : {}),
      ...(typeof record.url === "string" ? { url: record.url } : {}),
    };
  }
  return { name: "Local extension" };
}

function normalizeServer(value: unknown): ExtensionManifest["server"] {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const type = ["python", "node", "binary", "uv"].includes(String(record.type)) ? String(record.type) as ExtensionManifest["server"]["type"] : "node";
    return {
      type,
      entry_point: typeof record.entry_point === "string" && record.entry_point ? record.entry_point : "index.js",
      ...(typeof record.mcp_config === "object" && record.mcp_config !== null ? { mcp_config: record.mcp_config as Record<string, unknown> } : {}),
    };
  }
  return { type: "node", entry_point: "index.js" };
}

function normalizeManifest(raw: unknown, fallbackName: string): ExtensionManifest {
  const record = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : slug(fallbackName);
  const manifestVersion = typeof record.manifest_version === "string" && record.manifest_version ? record.manifest_version : typeof record.dxt_version === "string" && record.dxt_version ? record.dxt_version : "0.4";
  const manifest: ExtensionManifest = {
    ...record,
    manifest_version: manifestVersion,
    name,
    ...(typeof record.display_name === "string" && record.display_name ? { display_name: record.display_name } : {}),
    version: typeof record.version === "string" && record.version ? record.version : "0.0.0",
    description: typeof record.description === "string" ? record.description : "Local desktop extension",
    author: normalizeAuthor(record.author),
    server: normalizeServer(record.server),
  };
  return manifest;
}

async function readManifestFromDirectory(dir: string): Promise<ExtensionManifest> {
  for (const name of ["manifest.json", "dxt.json", "package.json"]) {
    const candidate = path.join(dir, name);
    const raw = await readJson<Record<string, unknown>>(candidate);
    if (raw) return normalizeManifest(raw, path.basename(dir));
  }
  return normalizeManifest(null, path.basename(dir));
}

function manifestId(
  manifest: ExtensionManifest,
  options?: { fallback?: string | null; prefix?: "local.dxt" | "local.mcpb" | "local.unpacked" },
): string {
  // Prefer official local.* identity when prefix known (install path).
  if (options?.prefix) {
    // If caller already passes a full official id, keep it (identity mismatch guard residual).
    const fb = options.fallback?.trim();
    if (
      fb
      && (fb.startsWith("local.dxt")
        || fb.startsWith("local.mcpb")
        || fb.startsWith("local.unpacked"))
    ) {
      return fb;
    }
    return officialLocalExtensionId(manifest, options.prefix);
  }
  if (options?.fallback?.trim()) return slug(options.fallback);
  const author = manifest.author?.name ?? "local";
  return `${slug(author)}.${slug(manifest.name)}`;
}

async function readMetadata(userDataDir: string): Promise<MetadataFile> {
  return (await readJson<MetadataFile>(metadataPath(userDataDir))) ?? { extensions: {} };
}

async function writeMetadata(userDataDir: string, metadata: MetadataFile): Promise<void> {
  await writeJson(metadataPath(userDataDir), metadata);
}

async function readSettings(userDataDir: string, extensionId: string): Promise<ExtensionSettings> {
  const settings = await readJson<Partial<ExtensionSettings>>(settingsPath(userDataDir, extensionId));
  return {
    isEnabled: typeof settings?.isEnabled === "boolean" ? settings.isEnabled : true,
    ...(typeof settings?.userConfig === "object" && settings.userConfig !== null ? { userConfig: settings.userConfig as Record<string, unknown> } : {}),
    ...(typeof settings?.orgBlockedReason === "string" ? { orgBlockedReason: settings.orgBlockedReason } : {}),
  };
}

async function writeSettings(userDataDir: string, extensionId: string, settings: ExtensionSettings): Promise<void> {
  await writeJson(settingsPath(userDataDir, extensionId), settings);
}

function toInstalled(record: ExtensionMetadata, settings: ExtensionSettings): InstalledExtension {
  return {
    id: record.id,
    path: record.path,
    displayName: record.manifest.display_name ?? record.manifest.name,
    manifest: record.manifest,
    settings,
  };
}

async function discoverDirectoryRecords(userDataDir: string): Promise<Record<string, ExtensionMetadata>> {
  const root = userExtensionsDir(userDataDir);
  const out: Record<string, ExtensionMetadata> = {};
  if (!(await exists(root))) return out;
  for (const dirent of await fs.readdir(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(root, dirent.name);
    const manifest = await readManifestFromDirectory(dir);
    const id = manifestId(manifest, dirent.name);
    const timestamp = nowIso();
    out[id] = { id, path: dir, kind: "directory", manifest, installedAt: timestamp, updatedAt: timestamp };
  }
  return out;
}

export async function listInstalledExtensions(userDataDir: string): Promise<InstalledExtension[]> {
  const metadata = await readMetadata(userDataDir);
  const discovered = await discoverDirectoryRecords(userDataDir);
  const merged = { ...discovered, ...metadata.extensions };
  const installed: InstalledExtension[] = [];
  for (const record of Object.values(merged)) {
    if (!(await exists(record.path))) continue;
    installed.push(toInstalled(record, await readSettings(userDataDir, record.id)));
  }
  return installed.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getInstalledExtension(userDataDir: string, extensionId: string): Promise<InstalledExtension | null> {
  return (await listInstalledExtensions(userDataDir)).find((extension) => extension.id === extensionId) ?? null;
}

export async function setInstalledExtensionSettings(userDataDir: string, extensionId: string, patch: unknown): Promise<ExtensionSettings> {
  const current = await readSettings(userDataDir, extensionId);
  const input = typeof patch === "object" && patch !== null ? patch as Partial<ExtensionSettings> : {};
  const next: ExtensionSettings = {
    ...current,
    ...(typeof input.isEnabled === "boolean" ? { isEnabled: input.isEnabled } : {}),
    ...(typeof input.userConfig === "object" && input.userConfig !== null ? { userConfig: input.userConfig as Record<string, unknown> } : {}),
    ...(typeof input.orgBlockedReason === "string" ? { orgBlockedReason: input.orgBlockedReason } : {}),
  };
  await writeSettings(userDataDir, extensionId, next);
  return next;
}

export async function setInstalledExtensionEnabled(userDataDir: string, extensionId: string, enabled: boolean): Promise<ExtensionSettings> {
  return setInstalledExtensionSettings(userDataDir, extensionId, { isEnabled: enabled });
}

export async function installUnpackedExtension(userDataDir: string, sourceDir: string, requestedId?: string | null): Promise<InstalledExtension> {
  const manifest = await readManifestFromDirectory(sourceDir);
  const id = manifestId(manifest, { fallback: requestedId, prefix: "local.unpacked" });
  const target = path.join(userExtensionsDir(userDataDir), id);
  if (path.resolve(sourceDir) !== path.resolve(target)) {
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(sourceDir, target, { recursive: true });
  }
  const metadata = await readMetadata(userDataDir);
  const timestamp = nowIso();
  metadata.extensions[id] = { id, path: target, kind: "directory", manifest, installedAt: metadata.extensions[id]?.installedAt ?? timestamp, updatedAt: timestamp };
  await writeMetadata(userDataDir, metadata);
  const settings = await readSettings(userDataDir, id);
  return toInstalled(metadata.extensions[id]!, settings);
}

/**
 * Residual installDxt / mcpb archive (app.asar GeA / $oA / aU / gU):
 *   .dxt / .mcpb / .zip are zip containers — unpack to directory.
 *   Official: files["manifest.json"] required; aU parse+validate; no basename invent.
 *   Path traversal guarded; single top-level folder stripped when it wraps the package.
 */
export async function installDxtArchive(userDataDir: string, dxtPath: string, requestedId?: string | null): Promise<InstalledExtension> {
  const lower = dxtPath.toLowerCase();
  const prefix: "local.dxt" | "local.mcpb" = lower.endsWith(".mcpb") ? "local.mcpb" : "local.dxt";

  let zipBytes: Uint8Array;
  try {
    zipBytes = await fs.readFile(dxtPath);
  } catch (err) {
    throw new Error(
      err instanceof Error ? `Failed to read package: ${err.message}` : "Failed to read package",
    );
  }
  if (zipBytes.byteLength === 0) {
    throw new Error("Package archive is empty (0 bytes).");
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Invalid dxt/mcpb zip: ${err.message}`
        : "Invalid dxt/mcpb zip archive",
    );
  }

  const names = Object.keys(files).filter((n) => !n.endsWith("/"));
  if (names.length === 0) {
    throw new Error("Package archive is empty.");
  }
  const tops = new Set(
    names.map((n) => n.split("/")[0]).filter(Boolean) as string[],
  );
  let stripPrefix = "";
  if (tops.size === 1) {
    const only = [...tops][0]!;
    const hasNested = names.some((n) => n.startsWith(`${only}/`));
    if (
      hasNested &&
      names.every((n) => n === only || n.startsWith(`${only}/`)) &&
      !names.includes("manifest.json")
    ) {
      stripPrefix = `${only}/`;
    }
  }

  // Residual GeA: require files["manifest.json"] (after optional single-folder strip).
  const manifestEntryKey = stripPrefix
    ? `${stripPrefix}manifest.json`
    : "manifest.json";
  const manifestBytes = files[manifestEntryKey];
  if (!manifestBytes || manifestBytes.byteLength === 0) {
    throw new Error("No manifest.json found in extension file");
  }
  let manifestRaw: unknown;
  try {
    const text = new TextDecoder().decode(manifestBytes);
    manifestRaw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Invalid JSON in manifest.json: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!manifestRaw || typeof manifestRaw !== "object" || Array.isArray(manifestRaw)) {
    throw new Error("Invalid manifest: root must be a JSON object");
  }
  const rawRec = manifestRaw as Record<string, unknown>;
  if (typeof rawRec.name !== "string" || !rawRec.name.trim()) {
    throw new Error("Invalid manifest: name is required");
  }
  if (
    !(typeof rawRec.manifest_version === "string" && rawRec.manifest_version) &&
    !(typeof rawRec.dxt_version === "string" && rawRec.dxt_version)
  ) {
    throw new Error(
      "Invalid manifest: Either 'dxt_version' (deprecated) or 'manifest_version' must be provided",
    );
  }
  // Normalize from real package bytes only — never invent from archive basename.
  const normalized = normalizeManifest(rawRec, rawRec.name.trim());

  // Staging dir before final id path.
  const stageRoot = path.join(
    userExtensionsDir(userDataDir),
    `.stage-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  );
  await fs.mkdir(stageRoot, { recursive: true });
  try {
    let wroteAny = false;
    for (const [name, content] of Object.entries(files)) {
      if (name.endsWith("/")) continue;
      const rel =
        stripPrefix && name.startsWith(stripPrefix)
          ? name.slice(stripPrefix.length)
          : name;
      if (!rel || rel.includes("..") || path.isAbsolute(rel)) continue;
      const dest = path.join(stageRoot, rel);
      const resolved = path.resolve(dest);
      if (!resolved.startsWith(path.resolve(stageRoot) + path.sep) && resolved !== path.resolve(stageRoot)) {
        continue;
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content);
      wroteAny = true;
    }
    if (!wroteAny) {
      throw new Error("Package archive contained no extractable files");
    }
    // Confirm staged root still has manifest.json (path-traversal may have skipped it).
    if (!(await exists(path.join(stageRoot, "manifest.json")))) {
      throw new Error("No manifest.json found in extension file");
    }

    const id = manifestId(normalized, { fallback: requestedId, prefix });
    const target = path.join(userExtensionsDir(userDataDir), id);
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(stageRoot, target, { recursive: true });

    const metadata = await readMetadata(userDataDir);
    const timestamp = nowIso();
    metadata.extensions[id] = {
      id,
      path: target,
      kind: "directory",
      manifest: normalized,
      installedAt: metadata.extensions[id]?.installedAt ?? timestamp,
      updatedAt: timestamp,
    };
    await writeMetadata(userDataDir, metadata);
    const settings = await readSettings(userDataDir, id);
    return toInstalled(metadata.extensions[id]!, settings);
  } finally {
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function deleteInstalledExtension(userDataDir: string, extensionId: string): Promise<boolean> {
  const metadata = await readMetadata(userDataDir);
  const record = metadata.extensions[extensionId] ?? (await discoverDirectoryRecords(userDataDir))[extensionId];
  if (!record) return false;
  await fs.rm(record.path, { recursive: true, force: true });
  await fs.rm(settingsPath(userDataDir, extensionId), { force: true });
  delete metadata.extensions[extensionId];
  await writeMetadata(userDataDir, metadata);
  return true;
}

export async function updateInstalledExtension(userDataDir: string, extensionId: string): Promise<InstalledExtension | null> {
  const metadata = await readMetadata(userDataDir);
  const discovered = await discoverDirectoryRecords(userDataDir);
  const record = metadata.extensions[extensionId] ?? discovered[extensionId];
  if (!record || !(await exists(record.path))) return null;
  const manifest = record.kind === "directory" ? await readManifestFromDirectory(record.path) : record.manifest;
  const next: ExtensionMetadata = {
    ...record,
    manifest,
    updatedAt: nowIso(),
  };
  metadata.extensions[extensionId] = next;
  await writeMetadata(userDataDir, metadata);
  return toInstalled(next, await readSettings(userDataDir, extensionId));
}

export async function revealInstalledExtension(userDataDir: string, extensionId: string): Promise<boolean> {
  const extension = await getInstalledExtension(userDataDir, extensionId);
  if (!extension) return false;
  shell.showItemInFolder(extension.path);
  return true;
}

export async function ensureExtensionFolders(userDataDir: string): Promise<{ extensionsDir: string; settingsDir: string }> {
  const extensionsDir = userExtensionsDir(userDataDir);
  const settingsDir = extensionSettingsDir(userDataDir);
  await fs.mkdir(extensionsDir, { recursive: true });
  await fs.mkdir(settingsDir, { recursive: true });
  return { extensionsDir, settingsDir };
}

export function extensionDirectoryExistsSync(userDataDir: string): boolean {
  return fsSync.existsSync(userExtensionsDir(userDataDir));
}
