/**
 * Official transcriptExport shareSession helper J6e + LeA + RUe.
 *
 * asar:
 *   async shareSession(A) {
 *     session missing → {success:false, error:"Session not found"}
 *     no cliSessionId → {success:false, error:"Session has no CLI session ID"}
 *     return J6e({cliSessionId, projectsDir: join(getClaudeConfigDir,"projects"),
 *                 metadataFilePath: getSessionFilePath ?? void 0})
 *   }
 *   async function J6e({cliSessionId, projectsDir, metadataFilePath}) {
 *     find projectsDir/* / `${cliSessionId}.jsonl` (skip symlink/non-dir)
 *     read first hit (HPA max 50MiB residual → plain read maxBytes)
 *     optional sidecar dir projectsDir/proj/cliSessionId via LeA
 *     optional metadata.json from metadataFilePath
 *     optional app logs via LeA(logs,"logs", skip echo.log/echo1.log/traces)
 *     if empty → {success:false, error:"No transcript data found for this session."}
 *     zip level 6 → Downloads/session-export-{Date.now()}.zip
 *     → {success:true, filePath}
 *   }
 *
 * Residuals (honest):
 *   - HPA VM path open → plain fs readFile with maxBytes
 *   - concurrent yU pool residual → sequential scan
 *   - S1/Qw log scrub: core $LA/szt/B7+skipKeys ported; full JHe.keyHandlers residual
 */

import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { zip } from "fflate";
import { scrubCoworkShareExportFile } from "./coworkShareExportScrub";

/** Official ZJi = 50 * 1024 * 1024 */
export const COWORK_SHARE_EXPORT_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Official zJi skip set for app logs. */
export const COWORK_SHARE_EXPORT_LOG_SKIP = new Set([
  "echo.log",
  "echo1.log",
  "traces",
]);

export type CoworkShareSessionResult =
  | { success: true; filePath: string }
  | { success: false; error: string; filePath?: never };

/** Official RUe(result). */
export function isCoworkShareSessionResult(
  value: unknown,
): value is CoworkShareSessionResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.success !== "boolean") return false;
  if (item.filePath !== undefined && typeof item.filePath !== "string") {
    return false;
  }
  if (item.error !== undefined && typeof item.error !== "string") {
    return false;
  }
  return true;
}

/**
 * Official HPA residual: read file ≤ maxBytes, else null.
 * Product uses plain fs (no VM path open).
 */
export async function readCoworkShareExportFile(
  filePath: string,
  deps: {
    maxBytes?: number;
    readFile?: (path: string) => Promise<Buffer>;
  } = {},
): Promise<Uint8Array | null> {
  const maxBytes = deps.maxBytes ?? COWORK_SHARE_EXPORT_MAX_FILE_BYTES;
  const read = deps.readFile ?? ((p) => readFile(p));
  try {
    const buf = await read(filePath);
    if (buf.byteLength > maxBytes) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Official LeA(root, zipPrefix, files, skip?, transform?):
 * recurse directories (skip symlinks), collect files into map.
 */
export async function collectCoworkShareExportTree(
  rootDir: string,
  zipPrefix: string,
  files: Record<string, Uint8Array>,
  options: {
    lstat?: typeof lstat;
    readdir?: typeof readdir;
    readFileBytes?: (path: string) => Promise<Uint8Array | null>;
    skipNames?: ReadonlySet<string>;
    transform?: (name: string, bytes: Uint8Array) => Uint8Array;
  } = {},
): Promise<void> {
  const lstatFn = options.lstat ?? lstat;
  const readdirFn = options.readdir ?? readdir;
  const readBytes =
    options.readFileBytes ?? ((p) => readCoworkShareExportFile(p));
  const skip = options.skipNames;
  const names = await readdirFn(rootDir);
  for (const name of names) {
    if (skip?.has(name)) continue;
    const full = join(rootDir, name);
    const entryKey = `${zipPrefix}/${name}`;
    try {
      const st = await lstatFn(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        await collectCoworkShareExportTree(full, entryKey, files, options);
      } else if (st.isFile()) {
        const bytes = await readBytes(full);
        if (bytes !== null) {
          files[entryKey] = options.transform
            ? options.transform(name, bytes)
            : bytes;
        }
      }
    } catch (error) {
      console.warn("[transcriptExport] Skipping unreadable entry", {
        fullPath: full,
        error,
      });
    }
  }
}

export type CoworkShareExportInput = {
  cliSessionId: string;
  /**
   * Official join(getClaudeConfigDir(session), "projects").
   */
  projectsDir: string;
  /**
   * Official getSessionFilePath(session) optional metadata.json.
   */
  metadataFilePath?: string | null;
  /**
   * Official gA.app.getPath("logs") optional — omit to skip logs.
   */
  logsDir?: string | null;
};

export type CoworkShareExportDeps = {
  access?: typeof access;
  /**
   * Official D7().appPath for S1/Qw path scrub (app.getAppPath()).
   * Empty/omit → skip appPath rewrite.
   */
  appPath?: string;
  downloadsDir?: string;
  /**
   * Official D7().homedir for S1/Qw path scrub. Default os.homedir().
   */
  scrubHomedir?: string;
  lstat?: typeof lstat;
  mkdir?: typeof mkdir;
  now?: () => number;
  readdir?: typeof readdir;
  readFile?: (path: string, encoding?: BufferEncoding) => Promise<string | Buffer>;
  readFileBytes?: (path: string) => Promise<Uint8Array | null>;
  writeFile?: (path: string, data: Buffer) => Promise<void>;
  zipAsync?: (
    files: Record<string, Uint8Array>,
    level?: number,
  ) => Promise<Uint8Array>;
};

function defaultZipAsync(
  files: Record<string, Uint8Array>,
  level = 6,
): Promise<Uint8Array> {
  // Official uFA(i,{level:6}, cb) residual → fflate.zip
  return new Promise((resolve, reject) => {
    zip(files, { level }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/**
 * Official J6e — build zip export of cli session transcript (+ metadata/logs).
 */
export async function exportCoworkCliSessionTranscript(
  input: CoworkShareExportInput,
  deps: CoworkShareExportDeps = {},
): Promise<CoworkShareSessionResult> {
  const lstatFn = deps.lstat ?? lstat;
  const readdirFn = deps.readdir ?? readdir;
  const readBytes =
    deps.readFileBytes ?? ((p) => readCoworkShareExportFile(p));
  const readText =
    deps.readFile ??
    (async (p, enc) => readFile(p, enc as BufferEncoding));
  const accessFn = deps.access ?? access;
  const mkdirFn = deps.mkdir ?? mkdir;
  const write = deps.writeFile ?? ((p, data) => writeFile(p, data));
  const zipAsync = deps.zipAsync ?? defaultZipAsync;
  const now = deps.now ?? Date.now;
  const downloadsDir = deps.downloadsDir ?? join(homedir(), "Downloads");

  try {
    const files: Record<string, Uint8Array> = {};
    try {
      const entries = await readdirFn(input.projectsDir);
      for (const name of entries) {
        const projectPath = join(input.projectsDir, name);
        const st = await lstatFn(projectPath).catch(() => null);
        if (!st || st.isSymbolicLink() || !st.isDirectory()) continue;
        const transcriptPath = join(
          projectPath,
          `${input.cliSessionId}.jsonl`,
        );
        const tStat = await lstatFn(transcriptPath).catch(() => null);
        if (!(tStat != null && tStat.isFile())) continue;
        const bytes = await readBytes(transcriptPath);
        if (bytes === null) continue;
        files[`${input.cliSessionId}.jsonl`] = bytes;
        const sidecar = join(projectPath, input.cliSessionId);
        try {
          if ((await lstatFn(sidecar)).isDirectory()) {
            await collectCoworkShareExportTree(
              sidecar,
              input.cliSessionId,
              files,
              {
                lstat: lstatFn,
                readdir: readdirFn,
                readFileBytes: readBytes,
              },
            );
          }
        } catch {
          // official empty catch
        }
        break; // official: first match only
      }
    } catch {
      console.warn("[transcriptExport] projects directory not found", {
        projectsDir: input.projectsDir,
      });
    }

    if (input.metadataFilePath) {
      try {
        const meta = await readText(input.metadataFilePath, "utf-8");
        if (typeof meta === "string") {
          files["metadata.json"] = new TextEncoder().encode(meta);
        }
      } catch {
        console.warn(
          "[transcriptExport] Failed to read session metadata omitting",
          { metadataFilePath: input.metadataFilePath },
        );
      }
    }

    if (Object.keys(files).length === 0) {
      return {
        success: false,
        error: "No transcript data found for this session.",
      };
    }

    if (input.logsDir) {
      try {
        // Official LeA(..., zJi, (name, bytes) => S1(name, bytes, Qw))
        await collectCoworkShareExportTree(
          input.logsDir,
          "logs",
          files,
          {
            lstat: lstatFn,
            readdir: readdirFn,
            readFileBytes: readBytes,
            skipNames: COWORK_SHARE_EXPORT_LOG_SKIP,
            transform: (name, bytes) =>
              scrubCoworkShareExportFile(name, bytes, {
                appPath: deps.appPath,
                homedir: deps.scrubHomedir,
                onError: (error, fileName) => {
                  console.warn(
                    "bundle scrub failed for %s; including raw: %o",
                    fileName,
                    error,
                  );
                },
              }),
          },
        );
      } catch (error) {
        console.warn("[transcriptExport] Failed to include app logs omitting", {
          error,
        });
      }
    }

    const zipped = await zipAsync(files, 6);
    const outName = `session-export-${now()}.zip`;
    const outPath = join(downloadsDir, outName);
    try {
      await accessFn(downloadsDir);
    } catch {
      await mkdirFn(downloadsDir, { recursive: true });
    }
    await write(outPath, Buffer.from(zipped));
    console.info(
      `[transcriptExport] Session ${input.cliSessionId} exported to ${outPath} (${zipped.length} bytes, ${Object.keys(files).length} files)`,
    );
    return { success: true, filePath: outPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[transcriptExport] Failed: ${message}`, { error });
    return { success: false, error: message };
  }
}
