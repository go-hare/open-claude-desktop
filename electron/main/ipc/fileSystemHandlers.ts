import { app, dialog, nativeImage, shell } from "electron";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { recordOpenDocument } from "../services/openDocuments/openDocumentsStore";
import type { IpcHandlerContext } from "./context";
import type { InterfaceHandlers } from "./registerIpc";

const TEXT_LIMIT_BYTES = 20 * 1024 * 1024;

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asPath(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Official FileSystem path args: (sessionId, encodeURIComponent(path)) or bare host path. */
function resolveOfficialLocalPath(filePathOrSessionId: unknown, encodedFilePath?: unknown): string | null {
  if (typeof encodedFilePath === "string" && encodedFilePath.length > 0) {
    try {
      return decodeURIComponent(encodedFilePath);
    } catch {
      return encodedFilePath;
    }
  }
  return asPath(filePathOrSessionId);
}

function mimeTypeForLocalPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".apng":
      return "image/apng";
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180) || `download-${Date.now()}`;
}

function dataToBuffer(data: unknown, options: Record<string, unknown> = {}): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === "string") {
    const encoding = options.encoding === "base64" ? "base64" : "utf8";
    return Buffer.from(data, encoding);
  }
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    if (typeof record.base64 === "string") return Buffer.from(record.base64, "base64");
    if (typeof record.content === "string") return dataToBuffer(record.content, asObject(record));
    if (typeof record.data === "string") return dataToBuffer(record.data, asObject(record));
  }
  return Buffer.from(String(data ?? ""));
}

async function statEntry(filePath: string) {
  const stat = await fs.stat(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    isDirectory: stat.isDirectory(),
    isFile: stat.isFile(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

async function listFilesRecursive(root: string, limit: number, output: string[] = []): Promise<string[]> {
  if (output.length >= limit) return output;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= limit) break;
    if (entry.name.startsWith(".")) continue;
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) await listFilesRecursive(filePath, limit, output);
    else if (entry.isFile()) output.push(filePath);
  }
  return output;
}

async function listDirectoryEntries(directory: string) {
  const entries = await fs.readdir(directory);
  return Promise.all(entries.filter((entry) => !entry.startsWith(".")).map((entry) => statEntry(path.join(directory, entry))));
}

function normalizeListFilesInFolderArgs(directory: unknown, options: unknown): { directory: string | null; officialSignature: boolean; options: Record<string, unknown> } {
  const officialFolderPath = asPath(options);
  if (officialFolderPath) return { directory: officialFolderPath, officialSignature: true, options: {} };
  return { directory: asPath(directory), officialSignature: false, options: asObject(options) };
}

function resolveSystemPath(name: string): string | null {
  const aliases: Record<string, Parameters<typeof app.getPath>[0]> = {
    home: "home",
    appData: "appData",
    userData: "userData",
    sessionData: "sessionData",
    temp: "temp",
    exe: "exe",
    module: "module",
    desktop: "desktop",
    documents: "documents",
    downloads: "downloads",
    music: "music",
    pictures: "pictures",
    videos: "videos",
    logs: "logs",
    crashDumps: "crashDumps",
  };
  const key = aliases[name];
  if (!key) return null;
  try {
    return app.getPath(key);
  } catch {
    return null;
  }
}

async function writeDownload(fileName: string, data: unknown, options: Record<string, unknown> = {}): Promise<string> {
  const targetDir = asPath(options.directory) ?? app.getPath("downloads");
  await fs.mkdir(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, safeName(fileName));
  await fs.writeFile(targetPath, dataToBuffer(data, options));
  await recordOpenDocument(targetPath);
  return targetPath;
}

export function createFileSystemHandlers(context: IpcHandlerContext): InterfaceHandlers {
  const pickDirectory = async (multiSelections: boolean, options: unknown, defaultPath?: unknown) => {
    const optionObj = asObject(options);
    const result = await dialog.showOpenDialog(context.windows.mainWindow, {
      title: typeof optionObj.title === "string" ? optionObj.title : undefined,
      defaultPath: asPath(defaultPath) ?? asPath(optionObj.defaultPath) ?? undefined,
      properties: multiSelections ? ["openDirectory", "multiSelections"] : ["openDirectory"],
    });
    if (result.canceled) return multiSelections ? [] : null;
    return multiSelections ? result.filePaths : result.filePaths[0] ?? null;
  };

  return {
    browseFiles: async (_event, options) => {
      const optionObj = asObject(options);
      const result = await dialog.showOpenDialog(context.windows.mainWindow, {
        title: typeof optionObj.title === "string" ? optionObj.title : undefined,
        defaultPath: asPath(optionObj.defaultPath) ?? undefined,
        properties: optionObj.multiSelections === false ? ["openFile"] : ["openFile", "multiSelections"],
      });
      return result.canceled ? [] : result.filePaths;
    },
    browseFolder: async (_event, options, defaultPath) => pickDirectory(false, options, defaultPath),
    browseFolders: async (_event, options, defaultPath) => pickDirectory(true, options, defaultPath),
    listDirectory: async (_event, directory) => {
      const dir = asPath(directory);
      if (!dir) return [];
      const entries = await fs.readdir(dir);
      return Promise.all(entries.map((entry) => statEntry(path.join(dir, entry))));
    },
    listFilesInFolder: async (_event, directory, options) => {
      const { directory: dir, officialSignature, options: optionObj } = normalizeListFilesInFolderArgs(directory, options);
      if (!dir) return [];
      if (officialSignature || optionObj.entries === true) return listDirectoryEntries(dir);
      if (optionObj.recursive) return listFilesRecursive(dir, Number(optionObj.limit ?? 500));
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => path.join(dir, entry.name));
    },
    // Official Gzt local_session: bT.readLocalFile(sessionId, encodeURIComponent(path))
    // → { content, encoding?: "base64" }. Also accept legacy bare-path calls.
    readLocalFile: async (_event, filePathOrSessionId, encodedFilePathOrOptions, maybeOptions) => {
      const officialTwoArg = typeof encodedFilePathOrOptions === "string";
      const target = resolveOfficialLocalPath(
        filePathOrSessionId,
        officialTwoArg ? encodedFilePathOrOptions : undefined,
      );
      if (!target) return null;
      const options = asObject(officialTwoArg ? maybeOptions : encodedFilePathOrOptions);
      const stat = await fs.stat(target);
      await recordOpenDocument(target);
      if (stat.isDirectory()) {
        return {
          path: target,
          name: path.basename(target),
          isDirectory: true,
          error: "Cannot preview a directory",
        };
      }
      if (!stat.isFile()) {
        return {
          path: target,
          name: path.basename(target),
          error: "Not a regular file",
        };
      }
      if (stat.size > TEXT_LIMIT_BYTES && options.encoding !== "base64") {
        return { path: target, name: path.basename(target), size: stat.size, tooLarge: true };
      }
      const buffer = await fs.readFile(target);
      if (options.encoding === "base64") {
        return {
          content: buffer.toString("base64"),
          encoding: "base64",
          mimeType: mimeTypeForLocalPath(target),
          path: target,
          name: path.basename(target),
          size: stat.size,
        };
      }
      const content = buffer.toString("utf8");
      // Official epitaxy-file / vN Edit gate needs hash alongside content.
      return {
        content,
        contents: content,
        path: target,
        absPath: target,
        name: path.basename(target),
        size: stat.size,
        hash: crypto.createHash("sha256").update(content, "utf8").digest("hex"),
      };
    },
    writeLocalFile: async (_event, filePathOrSessionId, encodedFilePathOrData, dataOrOptions, maybeOptions) => {
      const hasOfficialPath = typeof dataOrOptions === "string" || Buffer.isBuffer(dataOrOptions) || dataOrOptions instanceof Uint8Array;
      const target = hasOfficialPath
        ? resolveOfficialLocalPath(filePathOrSessionId, encodedFilePathOrData)
        : asPath(filePathOrSessionId);
      if (!target) return null;
      const data = hasOfficialPath ? dataOrOptions : encodedFilePathOrData;
      const options = asObject(hasOfficialPath ? maybeOptions : dataOrOptions);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, dataToBuffer(data, options));
      await recordOpenDocument(target);
      return target;
    },
    writeFileDownload: async (_event, fileName, data, options) => writeDownload(asPath(fileName) ?? `download-${Date.now()}.txt`, data, asObject(options)),
    writeFileDownloadAndOpen: async (_event, fileName, data, options) => {
      const target = await writeDownload(asPath(fileName) ?? `download-${Date.now()}.txt`, data, asObject(options));
      await shell.openPath(target);
      return target;
    },
    // Official: openLocalFile(sessionId, encodeURIComponent(path), reveal?)
    openLocalFile: async (_event, filePathOrSessionId, encodedFilePath, reveal) => {
      const target = resolveOfficialLocalPath(filePathOrSessionId, encodedFilePath);
      if (!target) return { ok: false, error: "missing path" };
      await recordOpenDocument(target);
      if (reveal === true) {
        shell.showItemInFolder(target);
        return { ok: true };
      }
      const error = await shell.openPath(target);
      return { ok: error.length === 0, error: error || undefined };
    },
    showInFolder: async (_event, filePathOrSessionId, encodedFilePath) => {
      const target = resolveOfficialLocalPath(filePathOrSessionId, encodedFilePath);
      if (!target) return false;
      shell.showItemInFolder(target);
      return true;
    },
    whichApplication: async (_event, filePath) => {
      const target = asPath(filePath);
      return {
        id: "system-default",
        name: process.platform === "win32" ? "Windows default app" : process.platform === "darwin" ? "macOS default app" : "System default app",
        path: target,
        extension: target ? path.extname(target).slice(1).toLowerCase() : undefined,
      };
    },
    getSystemPath: async (_event, name) => (typeof name === "string" ? resolveSystemPath(name) : null),
    getLocalFileThumbnail: async (_event, filePath, width, height) => {
      const target = asPath(filePath);
      if (!target) return null;
      const image = await nativeImage.createThumbnailFromPath(target, { width: Number(width) || 256, height: Number(height) || 256 });
      return image.isEmpty() ? null : image.toDataURL();
    },
    savePastedFile: async (_event, fileName, data, directory) => writeDownload(asPath(fileName) ?? `paste-${Date.now()}`, data, { directory: asPath(directory) ?? app.getPath("downloads") }),
    promoteScratchpadFile: async (_event, sourcePath, targetDirectory) => {
      const source = asPath(sourcePath);
      if (!source) return null;
      const targetDir = asPath(targetDirectory) ?? app.getPath("downloads");
      await fs.mkdir(targetDir, { recursive: true });
      const target = path.join(targetDir, path.basename(source));
      await fs.copyFile(source, target);
      await recordOpenDocument(target);
      return target;
    },
    exportLocalFileToGoogleDrive: async (_event, filePathOrSessionId, encodedFilePath) => {
      const target = resolveOfficialLocalPath(filePathOrSessionId, encodedFilePath);
      if (!target) return { ok: false, error: "missing path" };
      const cloudStorage = path.join(app.getPath("home"), "Library", "CloudStorage");
      const candidates = await fs.readdir(cloudStorage).catch(() => []);
      const googleDriveRoot = candidates.find((entry) => entry.toLowerCase().startsWith("googledrive"));
      if (!googleDriveRoot) {
        shell.showItemInFolder(target);
        return { ok: true, exported: false, localPath: target };
      }
      const destinationDir = path.join(cloudStorage, googleDriveRoot);
      const destination = path.join(destinationDir, path.basename(target));
      await fs.copyFile(target, destination);
      shell.showItemInFolder(destination);
      await recordOpenDocument(destination);
      return { ok: true, exported: true, localPath: target, cloudPath: destination };
    },
  };
}
