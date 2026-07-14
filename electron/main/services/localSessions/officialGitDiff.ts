import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Official electron-shell gitDiff caps (Dv / Ywe / M7i / qit). */
const PATCH_MAX_BUFFER = 5 * 1024 * 1024;
const UNTRACKED_PATCH_LINE_CAP = 2000;
const UNTRACKED_FULL_PATCH_COUNT = 200;
const UNTRACKED_FILE_SIZE_CAP = 1024 * 1024;

export type OfficialGitDiffFile = {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
};

/** Official H$A / a2A comparison payload. */
export type OfficialGitDiffComparison = {
  base_ref: string;
  head_ref: string;
  merge_base: string;
  files: OfficialGitDiffFile[];
  ahead_by: number;
  behind_by: number;
  total_commits: number;
};

/**
 * Official LocalSessions.getGitDiff (O7i → a2A + Vit untracked):
 * structured comparison with per-file patch, not raw `git diff` stdout.
 */
export async function getOfficialGitDiff(
  cwd: string | null,
  baseBranch: string | null | undefined,
): Promise<OfficialGitDiffComparison | null> {
  if (!cwd) return null;
  try {
    await fs.access(cwd);
  } catch {
    return null;
  }

  const root = await gitRoot(cwd);
  if (!root) return null;

  const head = (await gitText(root, ["rev-parse", "--abbrev-ref", "HEAD"])) ?? "HEAD";
  const resolvedBase = await resolveBaseRef(root, baseBranch ?? "HEAD");
  let mergeBase = resolvedBase;
  try {
    const mb = await gitText(root, ["merge-base", resolvedBase, "HEAD"]);
    if (mb) mergeBase = mb;
  } catch {
    /* keep resolvedBase */
  }

  let aheadBy = 0;
  let behindBy = 0;
  try {
    const counts = await gitText(root, ["rev-list", "--left-right", "--count", `${resolvedBase}...HEAD`]);
    if (counts) {
      const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
      behindBy = behind || 0;
      aheadBy = ahead || 0;
    }
  } catch {
    /* ignore */
  }

  const [numstat, patchText, nameStatus, untracked] = await Promise.all([
    gitText(root, ["diff", "--no-textconv", "--numstat", "-M", mergeBase], 30_000, PATCH_MAX_BUFFER),
    gitPatch(root, mergeBase),
    gitText(root, ["diff", "--name-status", "-M", mergeBase], 30_000, PATCH_MAX_BUFFER),
    listUntrackedAdded(root, true),
  ]);

  const comparison = assembleComparison({
    numstat: numstat ?? "",
    patchText: patchText ?? "",
    nameStatus: nameStatus ?? "",
    baseRef: resolvedBase,
    headRef: head,
    mergeBase,
    aheadBy,
    behindBy,
  });
  mergeUntracked(comparison.files, untracked);
  return comparison;
}

function assembleComparison(input: {
  numstat: string;
  patchText: string;
  nameStatus: string;
  baseRef: string;
  headRef: string;
  mergeBase: string;
  aheadBy: number;
  behindBy: number;
}): OfficialGitDiffComparison {
  const stats = parseNumstat(input.numstat);
  const statuses = parseNameStatus(input.nameStatus);
  const patches = splitPatches(input.patchText);
  const files: OfficialGitDiffFile[] = [];
  for (const [filename, stat] of stats) {
    const statusInfo = statuses.get(filename) ?? { status: "modified" as const };
    files.push({
      filename,
      status: statusInfo.status,
      additions: stat.additions,
      deletions: stat.deletions,
      changes: stat.additions + stat.deletions,
      patch: patches.get(filename),
      previous_filename: statusInfo.previous_filename,
    });
  }
  return {
    base_ref: input.baseRef,
    head_ref: input.headRef,
    merge_base: input.mergeBase,
    files,
    ahead_by: input.aheadBy,
    behind_by: input.behindBy,
    total_commits: input.aheadBy,
  };
}

/** Official G7i rename path parse for numstat. */
function parseRenamePath(value: string): { newPath: string; oldPath?: string } {
  const braced = value.match(/^(.*)\{(.+) => (.+?)\}(.*)$/);
  if (braced) {
    const prefix = braced[1] ?? "";
    const oldPart = braced[2] ?? "";
    const newPart = braced[3] ?? "";
    const suffix = braced[4] ?? "";
    return { newPath: `${prefix}${newPart}${suffix}`, oldPath: `${prefix}${oldPart}${suffix}` };
  }
  const plain = value.match(/^(.+) => (.+)$/);
  if (plain?.[1] && plain[2]) return { newPath: plain[2], oldPath: plain[1] };
  return { newPath: value };
}

/** Official BtA. */
function parseNumstat(text: string): Map<string, { additions: number; deletions: number; oldPath?: string }> {
  const map = new Map<string, { additions: number; deletions: number; oldPath?: string }>();
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    const [addRaw, delRaw, pathRaw] = line.split("\t");
    if (!pathRaw || addRaw === undefined || delRaw === undefined) continue;
    const { newPath, oldPath } = parseRenamePath(pathRaw);
    map.set(newPath, {
      additions: addRaw === "-" ? 0 : Number.parseInt(addRaw, 10) || 0,
      deletions: delRaw === "-" ? 0 : Number.parseInt(delRaw, 10) || 0,
      oldPath,
    });
  }
  return map;
}

/** Official L7i. */
function parseNameStatus(text: string): Map<string, { status: OfficialGitDiffFile["status"]; previous_filename?: string }> {
  const map = new Map<string, { status: OfficialGitDiffFile["status"]; previous_filename?: string }>();
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    let status: OfficialGitDiffFile["status"];
    let filename: string | undefined;
    let previous: string | undefined;
    if (code.startsWith("R")) {
      status = "renamed";
      previous = parts[1];
      filename = parts[2];
    } else if (code === "A") {
      status = "added";
      filename = parts[1];
    } else if (code === "D") {
      status = "removed";
      filename = parts[1];
    } else {
      status = "modified";
      filename = parts[1];
    }
    if (filename) map.set(filename, { status, previous_filename: previous });
  }
  return map;
}

/** Official b7i — split unified multi-file patch by `diff --git`. */
function splitPatches(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = text.split("\n");
  let current: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      if (current && buf.length > 0) map.set(current, buf.join("\n"));
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      current = match?.[1] ?? null;
      buf = [line];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current && buf.length > 0) map.set(current, buf.join("\n"));
  return map;
}

/** Official Vit — append untracked added files not already in list. */
function mergeUntracked(files: OfficialGitDiffFile[], untracked: OfficialGitDiffFile[]) {
  const seen = new Set(files.map((file) => file.filename));
  for (const file of untracked) {
    if (!seen.has(file.filename)) files.push(file);
  }
}

/** Official QtA + U7i (simplified). */
async function listUntrackedAdded(root: string, withPatch: boolean): Promise<OfficialGitDiffFile[]> {
  const listing = await gitText(root, ["ls-files", "--others", "--exclude-standard", "--full-name", ":/"], 30_000);
  if (!listing) return [];
  const paths = listing.split("\n").filter(Boolean);
  if (paths.length === 0) return [];
  const head = paths.slice(0, UNTRACKED_FULL_PATCH_COUNT);
  const rest = paths.slice(UNTRACKED_FULL_PATCH_COUNT);
  const files = (
    await Promise.all(head.map((filePath) => buildUntrackedFile(root, filePath, withPatch)))
  ).filter((file): file is OfficialGitDiffFile => file !== null);
  for (const filePath of rest) {
    files.push({
      filename: filePath,
      status: "added",
      additions: 0,
      deletions: 0,
      changes: 0,
    });
  }
  return files;
}

async function buildUntrackedFile(
  root: string,
  relative: string,
  withPatch: boolean,
): Promise<OfficialGitDiffFile | null> {
  const abs = path.join(root, relative);
  try {
    const resolved = path.resolve(abs);
    const rel = path.relative(root, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return null;
    if (stat.size > UNTRACKED_FILE_SIZE_CAP) {
      return { filename: relative, status: "added", additions: 0, deletions: 0, changes: 0 };
    }
    const buf = await fs.readFile(resolved);
    if (buf.includes(0)) {
      return { filename: relative, status: "added", additions: 0, deletions: 0, changes: 0 };
    }
    const lines = buf.toString("utf8").split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    const additions = lines.length;
    let patch: string | undefined;
    if (withPatch && additions > 0 && additions <= UNTRACKED_PATCH_LINE_CAP) {
      patch = [
        `diff --git a/${relative} b/${relative}`,
        "new file mode 100644",
        "--- /dev/null",
        `+++ b/${relative}`,
        `@@ -0,0 +1,${additions} @@`,
        ...lines.map((line) => `+${line}`),
      ].join("\n");
    }
    return {
      filename: relative,
      status: "added",
      additions,
      deletions: 0,
      changes: additions,
      patch,
    };
  } catch {
    return null;
  }
}

async function resolveBaseRef(root: string, base: string): Promise<string> {
  if (await gitOk(root, ["rev-parse", "--verify", `origin/${base}`])) return `origin/${base}`;
  if (await gitOk(root, ["rev-parse", "--verify", base])) return base;
  return "HEAD";
}

async function gitRoot(cwd: string): Promise<string | null> {
  // git stdout always ends with \n — untrimmed cwd breaks spawn on Windows (ENOENT).
  const top = await gitText(cwd, ["rev-parse", "--show-toplevel"]);
  return top;
}

async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync("git", args, { cwd, timeout: 10_000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function gitText(
  cwd: string,
  args: string[],
  timeout = 10_000,
  maxBuffer = 8 * 1024 * 1024,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      timeout,
      maxBuffer,
    });
    const text = typeof stdout === "string" ? stdout : String(stdout ?? "");
    // Single-line git refs/paths must be trimmed; multi-line outputs keep internal newlines
    // but drop the final trailing newline git always appends.
    return text.replace(/\r?\n$/, "");
  } catch {
    return null;
  }
}

/** Official s2A / Hwe patch fetch for merge_base. */
async function gitPatch(root: string, mergeBase: string): Promise<string | null> {
  const args = [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "-M",
    "--no-color",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    mergeBase,
  ];
  return gitText(root, args, 30_000, PATCH_MAX_BUFFER);
}
