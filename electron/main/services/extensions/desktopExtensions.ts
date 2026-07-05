import { shell } from "electron";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

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

function manifestId(manifest: ExtensionManifest, fallback?: string | null): string {
  if (fallback && fallback.trim()) return slug(fallback);
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
  const id = manifestId(manifest, requestedId);
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

export async function installDxtArchive(userDataDir: string, dxtPath: string, requestedId?: string | null): Promise<InstalledExtension> {
  const baseName = path.basename(dxtPath).replace(/\.(dxt|zip)$/i, "");
  const manifest = normalizeManifest(null, baseName);
  const id = manifestId(manifest, requestedId ?? baseName);
  const target = path.join(userExtensionsDir(userDataDir), `${id}${path.extname(dxtPath) || ".dxt"}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(dxtPath, target);
  const metadata = await readMetadata(userDataDir);
  const timestamp = nowIso();
  metadata.extensions[id] = { id, path: target, kind: "archive", manifest, installedAt: metadata.extensions[id]?.installedAt ?? timestamp, updatedAt: timestamp };
  await writeMetadata(userDataDir, metadata);
  const settings = await readSettings(userDataDir, id);
  return toInstalled(metadata.extensions[id]!, settings);
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
