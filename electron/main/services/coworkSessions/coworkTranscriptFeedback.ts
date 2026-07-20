/**
 * Official TranscriptUploader (tXi / Nit / iXi / rXi) + G$A / YUt validators.
 *
 * asar:
 *   async function tXi(storageDir, sessionId, feedback) {
 *     push to feedback.json via Nit+Ty; find jsonl via rXi; return iXi(...) !== null
 *   }
 *   async function Nit(storageDir) → parse feedback.json array or []
 *   async function iXi(sessionId, feedbackJsonPath, transcriptJsonlPath?) {
 *     tar.gz → downloads/cowork-feedback-{sessionId}-{ts}.tar.gz
 *     shell.showItemInFolder; return path | null
 *   }
 *   async function rXi(storageDir) → newest .jsonl under storageDir/.claude/projects/*
 *
 * Residuals (inject, not invent product stores):
 *   - showItemInFolder / downloads dir via inject
 *   - createTarGz via inject (default uses `tar` package when available)
 *   - atomic write Ty residual → plain writeFile
 */

import { copyFile, lstat, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";

export const COWORK_TRANSCRIPT_FEEDBACK_FILE = "feedback.json";
export const COWORK_TRANSCRIPT_UPLOADER_TAG = "[TranscriptUploader]";

/** Official YUt step shape. */
export type CoworkTranscriptFeedbackStep = {
  note: string | null;
  thumb: string | null;
  toolUseId: string;
};

/** Official G$A feedback payload. */
export type CoworkTranscriptFeedback = {
  freeText: string;
  steps: CoworkTranscriptFeedbackStep[];
  submittedAt: number;
};

/** Official YUt(e). */
export function isCoworkTranscriptFeedbackStep(
  value: unknown,
): value is CoworkTranscriptFeedbackStep {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.toolUseId === "string" &&
    (item.thumb === null || typeof item.thumb === "string") &&
    (item.note === null || typeof item.note === "string")
  );
}

/** Official G$A(e). */
export function isCoworkTranscriptFeedback(
  value: unknown,
): value is CoworkTranscriptFeedback {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.freeText === "string" &&
    Array.isArray(item.steps) &&
    item.steps.every(isCoworkTranscriptFeedbackStep) &&
    typeof item.submittedAt === "number"
  );
}

/** Official Nit(storageDir): read feedback.json array or []. */
export async function readCoworkTranscriptFeedback(
  storageDir: string,
  deps: {
    readFile?: (path: string, encoding: "utf8") => Promise<string>;
  } = {},
): Promise<CoworkTranscriptFeedback[]> {
  const read = deps.readFile ?? ((p, enc) => readFile(p, enc));
  const filePath = join(storageDir, COWORK_TRANSCRIPT_FEEDBACK_FILE);
  try {
    const raw = await read(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CoworkTranscriptFeedback[]) : [];
  } catch {
    return [];
  }
}

/**
 * Official rXi(storageDir): newest .jsonl under storageDir/.claude/projects/<proj>/*.jsonl.
 * Returns absolute path or null.
 */
export async function findCoworkSessionTranscriptJsonl(
  storageDir: string,
  deps: {
    lstat?: typeof lstat;
    readdir?: typeof readdir;
  } = {},
): Promise<string | null> {
  const lstatFn = deps.lstat ?? lstat;
  const readdirFn = deps.readdir ?? readdir;
  const projectsDir = join(storageDir, ".claude", "projects");
  const projectsStat = await lstatFn(projectsDir).catch(() => null);
  if (!(projectsStat != null && projectsStat.isDirectory())) return null;

  let best: { mtime: number; path: string } | null = null;
  for (const entry of await readdirFn(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectPath = join(projectsDir, entry.name);
    for (const file of await readdirFn(projectPath, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const full = join(projectPath, file.name);
      const st = await lstatFn(full);
      if (st.isFile() && (!best || st.mtimeMs > best.mtime)) {
        best = { mtime: st.mtimeMs, path: full };
      }
    }
  }
  return best?.path ?? null;
}

export type CoworkTranscriptFeedbackBundleDeps = {
  copyFile?: typeof copyFile;
  createTarGz?: (options: {
    cwd: string;
    file: string;
    paths: string[];
  }) => Promise<void>;
  downloadsDir?: string;
  mkdir?: typeof mkdir;
  now?: () => Date;
  showItemInFolder?: (path: string) => void;
  unlink?: typeof unlink;
};

async function defaultCreateTarGz(options: {
  cwd: string;
  file: string;
  paths: string[];
}): Promise<void> {
  // Official iZe({gzip:true,file,cwd}, paths)
  await tar.c(
    {
      cwd: options.cwd,
      file: options.file,
      gzip: true,
    },
    options.paths,
  );
}

/**
 * Official iXi(sessionId, feedbackJsonPath, transcriptJsonlPath|null):
 *   tar.gz feedback.json (+ optional transcript.jsonl copy) into downloads,
 *   showItemInFolder, return path | null on failure.
 * Bundle failure → null (submit still wrote feedback.json).
 */
export async function bundleCoworkTranscriptFeedback(
  sessionId: string,
  feedbackJsonPath: string,
  transcriptJsonlPath: string | null,
  deps: CoworkTranscriptFeedbackBundleDeps = {},
): Promise<string | null> {
  const copy = deps.copyFile ?? copyFile;
  const createTar = deps.createTarGz ?? defaultCreateTarGz;
  const mkdirFn = deps.mkdir ?? mkdir;
  const unlinkFn = deps.unlink ?? unlink;
  const now = deps.now ?? (() => new Date());
  const downloadsDir = deps.downloadsDir ?? join(homedir(), "Downloads");
  try {
    const stamp = now()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    const fileName = `cowork-feedback-${sessionId}-${stamp}.tar.gz`;
    const outPath = join(downloadsDir, fileName);
    const cwd = join(feedbackJsonPath, "..");
    const paths = [COWORK_TRANSCRIPT_FEEDBACK_FILE];
    let transcriptCopy: string | null = null;
    if (transcriptJsonlPath) {
      transcriptCopy = join(cwd, "transcript.jsonl");
      await copy(transcriptJsonlPath, transcriptCopy);
      paths.push("transcript.jsonl");
    }
    try {
      await mkdirFn(downloadsDir, { recursive: true });
      await createTar({ cwd, file: outPath, paths });
    } finally {
      if (transcriptCopy) await unlinkFn(transcriptCopy).catch(() => undefined);
    }
    deps.showItemInFolder?.(outPath);
    return outPath;
  } catch (error) {
    console.warn(
      `${COWORK_TRANSCRIPT_UPLOADER_TAG} ${sessionId}: bundle save failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export type CoworkSubmitTranscriptFeedbackDeps = CoworkTranscriptFeedbackBundleDeps & {
  findTranscriptJsonl?: (storageDir: string) => Promise<string | null>;
  readFeedback?: (storageDir: string) => Promise<CoworkTranscriptFeedback[]>;
  writeFile?: (path: string, data: string) => Promise<void>;
};

/**
 * Official tXi(storageDir, sessionId, feedback):
 *   append feedback.json → find jsonl → iXi; return iXi success boolean.
 * Missing jsonl still bundles feedback-only (official warn residual).
 */
export async function submitCoworkTranscriptFeedback(
  storageDir: string,
  sessionId: string,
  feedback: CoworkTranscriptFeedback,
  deps: CoworkSubmitTranscriptFeedbackDeps = {},
): Promise<boolean> {
  const read =
    deps.readFeedback ?? ((dir) => readCoworkTranscriptFeedback(dir));
  const write = deps.writeFile ?? ((p, data) => writeFile(p, data, "utf8"));
  const findJsonl =
    deps.findTranscriptJsonl ?? ((dir) => findCoworkSessionTranscriptJsonl(dir));

  const feedbackPath = join(storageDir, COWORK_TRANSCRIPT_FEEDBACK_FILE);
  const list = await read(storageDir);
  list.push(feedback);
  await write(feedbackPath, JSON.stringify(list, null, 2));
  console.info(
    `${COWORK_TRANSCRIPT_UPLOADER_TAG} ${sessionId}: wrote feedback #${list.length} (${feedback.steps.length} steps)`,
  );

  const transcriptPath = await findJsonl(storageDir);
  if (!transcriptPath) {
    console.warn(
      `${COWORK_TRANSCRIPT_UPLOADER_TAG} no .jsonl found, bundling feedback only`,
    );
  }
  const bundled = await bundleCoworkTranscriptFeedback(
    sessionId,
    feedbackPath,
    transcriptPath,
    deps,
  );
  return bundled !== null;
}
