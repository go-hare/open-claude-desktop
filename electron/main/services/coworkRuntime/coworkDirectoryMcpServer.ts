/**
 * Official app.asar `createCoworkDirectoryMcpServer` / dXe (SB="cowork"):
 *   request_cowork_directory (Bm)
 *   allow_cowork_file_delete (LUA)
 *   present_files (bUA)
 *   mark_task_complete (VUA) — gated by hasMarkTaskComplete (official ft flag residual)
 *   artifacts / launch_code_session / skills — residual until product-wired
 *
 * Host-loop product path ships Bm + LUA + bUA + optional VUA with official
 * messages. Dual-exec VM remount rwd, scratchpad promote iJA, HTML artifacts yn
 * store, and full getVMPathContext VM mounts remain residual.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  deriveMountNames,
  mapVmPathToHostPath,
  normalizeCoworkVmMountPathSegment,
  type CoworkVmPathContext,
} from "../coworkSessions/coworkVmPathTranslation";

export const COWORK_DIRECTORY_MCP_NAME = "cowork";
export const COWORK_REQUEST_DIRECTORY_TOOL = "request_cowork_directory";
export const COWORK_ALLOW_FILE_DELETE_TOOL = "allow_cowork_file_delete";
export const COWORK_PRESENT_FILES_TOOL = "present_files";
export const COWORK_MARK_TASK_COMPLETE_TOOL = "mark_task_complete";
/** Official ql / $7 / UUA / BRA */
export const COWORK_REQUEST_DIRECTORY_MCP_TOOL = `mcp__${COWORK_DIRECTORY_MCP_NAME}__${COWORK_REQUEST_DIRECTORY_TOOL}`;
export const COWORK_ALLOW_FILE_DELETE_MCP_TOOL = `mcp__${COWORK_DIRECTORY_MCP_NAME}__${COWORK_ALLOW_FILE_DELETE_TOOL}`;
export const COWORK_PRESENT_FILES_MCP_TOOL = `mcp__${COWORK_DIRECTORY_MCP_NAME}__${COWORK_PRESENT_FILES_TOOL}`;
export const COWORK_MARK_TASK_COMPLETE_MCP_TOOL = `mcp__${COWORK_DIRECTORY_MCP_NAME}__${COWORK_MARK_TASK_COMPLETE_TOOL}`;

/** Official canUseTool pre-prompt when path hits session storage (XPA). */
export const COWORK_REQUEST_DIRECTORY_INTERNAL_PREPROMPT_MESSAGE =
  "That directory is Cowork's internal session storage. Tool-result files are already readable via the existing rules — read them directly. Other files there (transcripts, session state) are intentionally not accessible. Request a project folder on the user's machine instead.";

/**
 * Official canUseTool headless/bridge|dispatch no-path deny base message.
 * (app.asar: path required in this session … ~/Downloads.)
 */
export const COWORK_REQUEST_DIRECTORY_PATH_REQUIRED_MESSAGE =
  "The `path` parameter is required in this session. Pass the specific path (e.g. ~/Downloads).";

/** Official append when mountSkeletonHome (dA) is true. Residual until skeleton product-wired. */
export const COWORK_REQUEST_DIRECTORY_HOST_HOME_HINT =
  " You can use the .host-home index to discover the directory first.";

/**
 * Official isBridgeSession / isDispatchChild for path-required gate:
 *   a = sessionType === Mc ("agent")
 *   g = sessionType === DE ("dispatch_child")
 */
export function requiresCoworkRequestDirectoryPath(
  sessionType: string | null | undefined,
): boolean {
  return sessionType === "agent" || sessionType === "dispatch_child";
}

export function coworkRequestDirectoryPathRequiredMessage(
  options: { mountSkeletonHome?: boolean } = {},
): string {
  return (
    COWORK_REQUEST_DIRECTORY_PATH_REQUIRED_MESSAGE +
    (options.mountSkeletonHome ? COWORK_REQUEST_DIRECTORY_HOST_HOME_HINT : "")
  );
}

export const COWORK_REQUEST_DIRECTORY_DESCRIPTION =
  "Request access to a directory on the user's computer. If you know the path, pass it — the user sees the path and approves, then it's mounted. If you omit path, a native folder picker opens — but only in local sessions. In remote sessions the path is required. Use this whenever the user asks you to work with files you don't currently have access to. This is the primary way to gain file system access.";

/** Official Go(LUA, ...) description. */
export const COWORK_ALLOW_FILE_DELETE_DESCRIPTION =
  "Request permission to delete files in a directory. IMPORTANT: call this tool whenever a delete operation (such as rm) fails with 'Operation not permitted', rather than telling the user it is impossible. If approved, file deletion will be enabled.";

/** Official Go(bUA, ...) description. */
export const COWORK_PRESENT_FILES_DESCRIPTION =
  "Present files to the user with interactive cards in the chat. Use this after creating files the user should see. The files will be displayed as clickable cards with appropriate actions. Files ending in `.skill` (a zip archive of a skill directory containing SKILL.md) render with a 'Save skill' install button — to share a skill, zip the directory with a `.skill` extension before presenting. Files in the scratchpad (outside any mounted folder) are automatically copied to the outputs folder so the user can open them on their computer — the tool result tells you the new path.";

/** Official Go(VUA, ...) description. */
export const COWORK_MARK_TASK_COMPLETE_DESCRIPTION =
  "Signal that you have produced the concrete deliverable the user asked for (a file, an answer, a piece of writing, a completed action). Call once as your final action. Do NOT call for greetings, small talk, clarifying questions, or when work is blocked or partial.";

/** Official tool result text for mark_task_complete. */
export const COWORK_MARK_TASK_COMPLETE_RESULT = "Task marked complete.";

/**
 * Official _Ui system-prompt append when hasMarkTaskComplete (leading blank lines
 * match asar template push into extras array, joined later with base prompt).
 */
export const COWORK_MARK_TASK_COMPLETE_SYSTEM_PROMPT =
  "\n\nCall the mark_task_complete tool as your final action only when you have produced a concrete deliverable the user asked for — a file, a specific answer, a piece of writing, a completed action. This applies even when the deliverable is text-only and you used no other tools. Also call it when the user confirms the task is done (e.g. 'thanks', 'that works', 'that answers it') and you are just acknowledging. Do NOT call it for opening greetings, when you are asking what the user wants, when you are asking a clarifying question, or when work is blocked or partial.";

/**
 * Official: if (D) x.push(mark_task_complete guidance). Append once when enabled.
 * Does not invent full _Ui template (folders/cwd/skills residual).
 */
export function appendCoworkMarkTaskCompleteSystemPrompt(
  baseSystemPrompt: string | null | undefined,
  hasMarkTaskComplete: boolean,
): string | undefined {
  if (!hasMarkTaskComplete) {
    return baseSystemPrompt ?? undefined;
  }
  const base = baseSystemPrompt ?? "";
  if (base.includes("Call the mark_task_complete tool as your final action")) {
    return base || undefined;
  }
  const combined = `${base}${COWORK_MARK_TASK_COMPLETE_SYSTEM_PROMPT}`;
  return combined || COWORK_MARK_TASK_COMPLETE_SYSTEM_PROMPT;
}

/** Official RKi protected directory segments under home. */
export const COWORK_PROTECTED_HOME_DIR_SEGMENTS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".docker",
  ".claude",
  path.join(".config", "gcloud"),
  path.join(".config", "gh"),
  ...(process.platform === "darwin"
    ? [
        path.join("Library", "Keychains"),
        path.join("Library", "LaunchAgents"),
        path.join("Library", "LaunchDaemons"),
        path.join("Library", "Application Support"),
        path.join("Library", "Cookies"),
      ]
    : []),
  ...(process.platform === "win32"
    ? [
        path.join(
          "AppData",
          "Roaming",
          "Microsoft",
          "Windows",
          "Start Menu",
          "Programs",
          "Startup",
        ),
        path.join("AppData", "Roaming", "gcloud"),
        path.join("AppData", "Roaming", "GitHub CLI"),
        path.join("AppData", "Roaming", "gnupg"),
      ]
    : []),
] as const;

/** Official _Ki protected home files (exact / contained). */
export const COWORK_PROTECTED_HOME_FILES = [
  ".zshrc",
  ".zshenv",
  ".zprofile",
  ".zlogin",
  ".bashrc",
  ".bash_profile",
  ".bash_login",
  ".profile",
  ".netrc",
] as const;

export type CoworkDirectoryPickResult =
  | { canceled: true }
  | { canceled: false; path: string };

export type CoworkDirectoryMountResult =
  | {
      ok: true;
      displayPath: string;
      /**
       * Official host-loop bashMountName under /sessions/<vm>/mnt/<name>.
       * Set only when hostLoopOnFolderAdded inject is present and path is local
       * (networkDrive / missing inject → undefined; dXe network note uses kind).
       */
      bashMountName?: string | null;
      mode?: "host-loop" | "vm";
      /** Official l.resolved.kind !== "local" success branch note. */
      networkDrive?: boolean;
    }
  | { ok: false; error: string };

/**
 * Official e.mountFolder argument after P4 — full Mh kind (not string-only).
 * Product may also accept legacy absolutePath-only via adapter.
 */
export type CoworkDirectoryMountInput = CoworkPathKind;

export type CoworkDirectoryPathStat = {
  exists: boolean;
  isDirectory: boolean;
};

export type CoworkDirectoryMountInfo = {
  /** Official mount basename (Zn-normalized name used in fileDeleteApprovedMounts). */
  name: string;
  /** Host absolute path of the mount root. */
  hostPath: string;
  /** Official subpath (host root) for VM remount residual. */
  subpath: string;
};

export type CoworkDirectoryMcpServerOptions = {
  getSessionStorageDir?: () => string | null | undefined;
  /**
   * Official AMA home default for folder picker. Defaults to os.homedir().
   */
  getHomeDir?: () => string;
  /**
   * Official host-loop mode → success text branch / allow_delete host-loop branch.
   */
  isHostLoopMode?: boolean;
  /**
   * Official P4 dialog when path omitted.
   * When unset and path omitted → honest cancel/unavailable residual text.
   */
  pickDirectory?: () => Promise<CoworkDirectoryPickResult>;
  /**
   * Official e.mountFolder after P4 validation.
   * Receives full Mh pathKind (local | network-drive | …).
   * Defaults to reject (must be product-wired).
   */
  mountFolder?: (
    pathKind: CoworkDirectoryMountInput,
  ) => Promise<CoworkDirectoryMountResult>;
  /**
   * Optional existence/directory check. Defaults to node fs.stat via dynamic import
   * only when not injected (tests should inject).
   */
  statPath?: (absolutePath: string) => Promise<CoworkDirectoryPathStat>;
  /**
   * Official Mh/Uc fs surface (lstat/readlink/realpath). Inject in tests;
   * product defaults to node:fs/promises.
   */
  pathSafetyFs?: Partial<CoworkPathSafetyFs>;
  /**
   * Official getUserSelectedFolders — host paths for mounts (local folders).
   */
  getUserSelectedFolders?: () => string[];
  /**
   * Official getHostOutputsDir — join(sessionStorage, "outputs").
   */
  getHostOutputsDir?: () => string | null | undefined;
  /**
   * Official getOutputsSubpath — host outputs path used by tJA outputs mount.
   */
  getOutputsSubpath?: () => string | null | undefined;
  /**
   * Official getNetworkDriveFolders residual (Set of host paths excluded from tJA).
   */
  getNetworkDriveFolders?: () => Set<string> | Iterable<string>;
  /**
   * Official getVMPathContext / buildVMPathContext for present_files accessibility (gh).
   */
  getVMPathContext?: () => CoworkVmPathContext | null | undefined;
  /**
   * Official recordDetectedFile(hostPath) — activity cards for presented files.
   */
  recordDetectedFile?: (hostPath: string) => void;
  /**
   * Official notifySession for scratchpad promote messages (residual dual-exec).
   */
  notifySession?: (message: string) => void;
  /**
   * Official setFileDeleteApprovedForMount(mountName).
   */
  setFileDeleteApprovedForMount?: (mountName: string) => void;
  /**
   * Official hasMarkTaskComplete (Statsig ft residual). When true, register VUA.
   * Defaults to true for host-loop product (session.isAgentCompleted already wired).
   */
  hasMarkTaskComplete?: boolean;
  /**
   * Official onMarkTaskComplete — set session.isAgentCompleted + save + session_updated.
   */
  onMarkTaskComplete?: () => void;
  /**
   * Official Th() / vi().allowedWorkspaceFolders for P4 admin roots.
   * undefined/null → unrestricted; [] → disabled; non-empty → allowlist.
   * Settings product store residual when unset.
   */
  getAllowedWorkspaceFolders?: () => readonly string[] | null | undefined;
  sessionId: string;
  vmProcessName: string;
};

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

function textResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
  };
}

/**
 * Official eJA — expand ~ and .host-home VM aliases to host paths.
 * Does not path.normalize UNC-like inputs first: on POSIX, normalize("//server")
 * collapses to "/server" and would wash official Hs/QRA detection.
 */
export function expandCoworkDirectoryPath(
  inputPath: string,
  home: string = homedir(),
): string {
  if (isCoworkUncLikePath(inputPath)) {
    return inputPath;
  }
  const normalized = path.normalize(inputPath);
  if (normalized === "~" || normalized.startsWith(`~${path.sep}`) || normalized.startsWith("~/")) {
    return path.join(home, normalized.slice(1).replace(/^[\\/]/, ""));
  }
  const hostHome = normalized.match(
    /^\/sessions\/[^/]+\/mnt\/\.host-home(?:\/(.*))?$/,
  );
  if (hostHome) {
    const rest = hostHome[1];
    return rest ? path.join(home, rest) : home;
  }
  return normalized;
}

/**
 * Official P4 path shape before structural/XPA/AJA/tG:
 * Hs literal UNC + kKi relative/missing — on the **raw/expanded** string,
 * before path.resolve washes `//` / `\\` / relative into accidental abs paths.
 */
export function resolveCoworkDirectoryMountCandidate(
  inputPath: string,
  options: {
    home?: string;
    networkDrive?: boolean;
    platform?: NodeJS.Platform;
    providedPath?: boolean;
  } = {},
): { ok: true; path: string } | { ok: false; error: string } {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const providedPath = options.providedPath !== false;
  const raw = inputPath.trim();

  if (providedPath && options.networkDrive) {
    return {
      ok: false,
      error: coworkNetworkDriveProvidedPathDenyMessage(raw),
    };
  }
  if (providedPath) {
    if (isCoworkLiteralUncPath(raw)) {
      return { ok: false, error: COWORK_UNC_PATHS_NOT_ALLOWED };
    }
  } else if (isCoworkLiteralUncPath(raw) || isCoworkUncLikePath(raw)) {
    return { ok: false, error: COWORK_UNC_PATHS_NOT_ALLOWED };
  }

  const expanded = expandCoworkDirectoryPath(raw, home);
  if (isCoworkLiteralUncPath(expanded)) {
    return { ok: false, error: COWORK_UNC_PATHS_NOT_ALLOWED };
  }
  if (!path.isAbsolute(expanded)) {
    return {
      ok: false,
      error: coworkPathNotAccessibleMessage(expanded, platform),
    };
  }
  return { ok: true, path: path.resolve(expanded) };
}

function pathIsInsideOrEqual(candidate: string, root: string): boolean {
  const a = path.resolve(candidate);
  const b = path.resolve(root);
  if (a === b) return true;
  const prefix = b.endsWith(path.sep) ? b : b + path.sep;
  return a.startsWith(prefix);
}

/** Official P4 when Th() returns empty allowlist. */
export const COWORK_FOLDER_ACCESS_DISABLED_BY_ADMIN =
  "Folder access has been disabled by the administrator.";

/** Official P4 providedPath non-local deny (literal UNC / junction-to-unc). */
export const COWORK_UNC_PATHS_NOT_ALLOWED = "UNC paths are not allowed.";

/**
 * Official QRA — path looks like UNC (`\\` or `//`).
 * Check raw input first: on POSIX, path.normalize("//server/share") collapses
 * to "/server/share", which would hide official UNC detection.
 * Also check path.normalize / path.win32.normalize for platform fidelity.
 */
export function isCoworkUncLikePath(inputPath: string): boolean {
  if (inputPath.startsWith("\\\\") || inputPath.startsWith("//")) return true;
  const normalized = path.normalize(inputPath);
  if (normalized.startsWith("\\\\") || normalized.startsWith("//")) return true;
  if (process.platform !== "win32") {
    const win = path.win32.normalize(inputPath);
    if (win.startsWith("\\\\") || win.startsWith("//")) return true;
  }
  return false;
}

/** Official LL — WSL UNC forms allowed through Hs filter. */
export function isCoworkWslUncPath(inputPath: string): boolean {
  return /^[\\/]{2}(wsl\$|wsl\.localhost)(?=[\\/]|$)/i.test(inputPath);
}

/**
 * Official Hs — literal UNC (not WSL). P4 providedPath + picker junction/literal deny.
 */
export function isCoworkLiteralUncPath(inputPath: string): boolean {
  return isCoworkUncLikePath(inputPath) && !isCoworkWslUncPath(inputPath);
}

/**
 * Official network-drive providedPath deny (Mh kind===network-drive).
 */
export function coworkNetworkDriveProvidedPathDenyMessage(
  displayPath: string,
): string {
  return `Path "${displayPath}" is on a network drive. Ask the user to add it via the folder picker.`;
}

/** Official Mh result kinds (path-safety). */
export type CoworkPathKind =
  | { kind: "literal-unc"; display: string }
  | { kind: "junction-to-unc"; display: string }
  | { kind: "network-drive"; display: string; unc: string }
  | { kind: "local"; display: string; canonical: string };

/** Official path-safety fs surface used by Uc + Mh (injectable for tests). */
export type CoworkPathSafetyFs = {
  lstat: (
    target: string,
  ) => Promise<{ isSymbolicLink: () => boolean } | null>;
  readlink: (target: string) => Promise<string>;
  realpath: (target: string) => Promise<string>;
};

/** Official Wni — symlink hop limit in Uc. */
export const COWORK_PATH_SYMLINK_HOP_LIMIT = 40;

class CoworkUncPathDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoworkUncPathDeniedError";
  }
}

class CoworkSymlinkHopLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoworkSymlinkHopLimitError";
  }
}

/**
 * Official aE — normalize WSL UNC display forms; leave non-WSL paths alone.
 */
export function normalizeCoworkWslUncPath(inputPath: string): string {
  if (!isCoworkWslUncPath(inputPath)) return inputPath;
  return inputPath
    .replace(/\//g, "\\")
    .replace(
      /^\\\\(wsl\$|wsl\.localhost)(\\[^\\]+)?/i,
      (_full, _kind: string, distro = "") =>
        `\\\\wsl.localhost${String(distro).toLowerCase()}`,
    );
}

/**
 * Official Lc — mount path identity from Mh kind.
 * local → canonical; others → display.
 */
export function coworkPathKindMountPath(kind: CoworkPathKind): string {
  return kind.kind === "local" ? kind.canonical : kind.display;
}

/**
 * Official P4 branch on Mh kind after classify:
 * - providedPath: only local allowed; network-drive → ask picker; else UNC
 * - picker: junction-to-unc / literal-unc → UNC; network-drive allowed
 */
export function denyCoworkPathKindForMount(
  kind: CoworkPathKind,
  providedPath: boolean,
): string | null {
  if (providedPath) {
    if (kind.kind === "local") return null;
    if (kind.kind === "network-drive") {
      return coworkNetworkDriveProvidedPathDenyMessage(kind.display);
    }
    return COWORK_UNC_PATHS_NOT_ALLOWED;
  }
  if (kind.kind === "junction-to-unc" || kind.kind === "literal-unc") {
    return COWORK_UNC_PATHS_NOT_ALLOWED;
  }
  return null;
}

async function defaultCoworkPathSafetyFs(): Promise<CoworkPathSafetyFs> {
  const fs = await import("node:fs/promises");
  return {
    lstat: async (target) => {
      try {
        return await fs.lstat(target);
      } catch {
        return null;
      }
    },
    readlink: (target) => fs.readlink(target),
    realpath: (target) => fs.realpath(target),
  };
}

/**
 * Official Uc — walk path components; throw D5-equivalent on UNC / symlink-to-UNC.
 * Non-D5 failures (missing mid-path) return void; hop limit is non-D5 ($ni).
 */
export async function assertCoworkPathNoUncSymlinks(
  inputPath: string,
  options: { fs?: Partial<CoworkPathSafetyFs> } = {},
): Promise<void> {
  const fs = { ...(await defaultCoworkPathSafetyFs()), ...options.fs };
  let current = normalizeCoworkWslUncPath(inputPath);
  if (isCoworkLiteralUncPath(current)) {
    throw new CoworkUncPathDeniedError(`UNC path not allowed: ${current}`);
  }
  current = path.resolve(current);
  let hops = 0;
  const splitRe = process.platform === "win32" ? /[\\/]+/ : /\/+/;

  for (;;) {
    if (isCoworkLiteralUncPath(current)) {
      throw new CoworkUncPathDeniedError(`UNC path not allowed: ${current}`);
    }
    const { root } = path.parse(current);
    const parts = current.slice(root.length).split(splitRe).filter(Boolean);
    let cursor = root;
    let breakAt = parts.length;
    for (let i = 0; i < parts.length; i++) {
      cursor = path.join(cursor, parts[i]!);
      const info = await fs.lstat(cursor);
      if (!info) return;
      if (info.isSymbolicLink()) {
        breakAt = i;
        break;
      }
    }
    if (breakAt === parts.length) return;
    if (++hops > COWORK_PATH_SYMLINK_HOP_LIMIT) {
      throw new CoworkSymlinkHopLimitError(
        `Symlink hop limit exceeded: ${inputPath}`,
      );
    }
    const linkTarget = normalizeCoworkWslUncPath(await fs.readlink(cursor));
    if (isCoworkLiteralUncPath(linkTarget)) {
      throw new CoworkUncPathDeniedError(
        `Symlink to UNC target: ${cursor} -> ${linkTarget}`,
      );
    }
    current = path.resolve(
      path.dirname(cursor),
      linkTarget,
      ...parts.slice(breakAt + 1),
    );
  }
}

/**
 * Official Mh — classify path kind for P4 / tG:
 *   literal-unc | junction-to-unc | network-drive | local | null (kKi)
 *
 * Product detects literal UNC on the **raw** string first: official
 * `path.normalize("//server")` on POSIX collapses to `/server` and would
 * wash Hs/QRA (same hole as path.resolve before validate).
 */
export async function classifyCoworkPathKind(
  inputPath: string,
  options: { fs?: Partial<CoworkPathSafetyFs> } = {},
): Promise<CoworkPathKind | null> {
  const fs = { ...(await defaultCoworkPathSafetyFs()), ...options.fs };
  if (isCoworkLiteralUncPath(inputPath)) {
    return { kind: "literal-unc", display: inputPath };
  }
  // WSL UNC: aE normalizes display; non-UNC uses path.normalize.
  const display = isCoworkWslUncPath(inputPath)
    ? normalizeCoworkWslUncPath(inputPath)
    : path.normalize(inputPath);
  if (isCoworkLiteralUncPath(display)) {
    return { kind: "literal-unc", display };
  }
  if (!path.isAbsolute(display)) return null;
  try {
    await assertCoworkPathNoUncSymlinks(display, { fs });
  } catch (error) {
    if (error instanceof CoworkUncPathDeniedError) {
      return { kind: "junction-to-unc", display };
    }
    // Official: non-D5 (incl hop limit) → null → kKi.
    return null;
  }
  let real: string;
  try {
    real = await fs.realpath(display);
  } catch {
    return null;
  }
  if (isCoworkLiteralUncPath(real)) {
    return { kind: "network-drive", display, unc: real };
  }
  return { kind: "local", display, canonical: real };
}

/**
 * Official kKi — missing/non-absolute path message before structural checks.
 * Absolute → "doesn't exist or isn't accessible" (used when Mh returns null).
 * Relative win32 → drive-relative message; else relative message.
 */
export function coworkPathNotAccessibleMessage(
  inputPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  // Official uses tA.isAbsolute on the provided string.
  if (path.isAbsolute(inputPath)) {
    return `Path "${inputPath}" doesn't exist or isn't accessible.`;
  }
  if (platform === "win32") {
    return "Drive-relative paths are not allowed. Use an absolute path like H:\\folder.";
  }
  return "Relative paths are not allowed. Use an absolute path.";
}

/**
 * Official Th() / vi().allowedWorkspaceFolders interpretation for P4:
 *   undefined/null → unrestricted (no admin policy)
 *   [] → admin disabled folder access
 *   non-empty → allowlist roots (tG / GHA membership)
 */
export type CoworkAdminWorkspaceFoldersPolicy =
  | { kind: "unrestricted" }
  | { kind: "disabled" }
  | { kind: "allowlist"; roots: string[] };

export function classifyCoworkAdminWorkspaceFolders(
  allowed: readonly string[] | null | undefined,
): CoworkAdminWorkspaceFoldersPolicy {
  if (allowed == null) return { kind: "unrestricted" };
  if (allowed.length === 0) return { kind: "disabled" };
  return {
    kind: "allowlist",
    roots: allowed.map((root) => path.resolve(root)),
  };
}

/**
 * Sync path.resolve membership (tests / pre-GHA). Prefer async GHA for product
 * P4/tG on local kinds.
 */
export function isCoworkPathUnderAdminWorkspaceRoots(
  absolutePath: string,
  roots: readonly string[],
): boolean {
  const candidate = path.resolve(absolutePath);
  for (const root of roots) {
    if (pathIsInsideOrEqual(candidate, root)) return true;
  }
  return false;
}

/**
 * Official GHA — candidate is already realpath/canonical (Mh local.canonical).
 * Each root is realpath'd; missing roots are skipped (catch continue).
 * Membership: equal or relative(rootReal, candidate) not abs and not `..` prefix.
 */
export async function isCoworkCanonicalPathUnderAdminWorkspaceRoots(
  canonicalPath: string,
  roots: readonly string[],
  options: { realpath?: (target: string) => Promise<string> } = {},
): Promise<boolean> {
  const realpath =
    options.realpath ??
    (async (target: string) => {
      const fs = await defaultCoworkPathSafetyFs();
      return fs.realpath(target);
    });
  for (const root of roots) {
    try {
      const rootReal = await realpath(root);
      if (canonicalPath === rootReal) return true;
      const rel = path.relative(rootReal, canonicalPath);
      if (rel.length === 0) return true;
      if (!path.isAbsolute(rel) && !rel.startsWith("..")) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Official t4 — path containment without realpath.
 * Equal → allow (allowEqual default true); else relative not abs, not `..`,
 * not `..${sep}` prefix. Slightly looser than GHA on `..foo` names.
 */
export function isCoworkNormalizedPathWithinRoot(
  candidate: string,
  root: string,
  options: { allowEqual?: boolean } = {},
): boolean {
  const rel = path.relative(root, candidate);
  if (rel.length === 0) return options.allowEqual ?? true;
  return (
    !path.isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(`..${path.sep}`)
  );
}

/**
 * Official ol — candidate under any of the roots via t4.
 * tG network-drive / non-local branch uses normalize(display) + map(normalize).
 */
export function isCoworkPathWithinNormalizedRoots(
  candidate: string,
  roots: readonly string[],
  options: { allowEqual?: boolean } = {},
): boolean {
  const normalized = path.normalize(candidate);
  return roots.some((root) =>
    isCoworkNormalizedPathWithinRoot(
      normalized,
      path.normalize(root),
      options,
    ),
  );
}

/**
 * Official zrA — true when no path component is a symlink.
 * Missing mid-path / lstat failure → false (catch).
 * Used by tG network-drive: symlink components on display force deny.
 */
export async function coworkPathHasNoSymlinkComponents(
  inputPath: string,
  options: { fs?: Partial<CoworkPathSafetyFs> } = {},
): Promise<boolean> {
  try {
    const fs = { ...(await defaultCoworkPathSafetyFs()), ...options.fs };
    const { root } = path.parse(inputPath);
    let cursor = root;
    const splitRe = process.platform === "win32" ? /[\\/]+/ : /\/+/;
    const parts = inputPath.slice(root.length).split(splitRe).filter(Boolean);
    for (const part of parts) {
      cursor = path.join(cursor, part);
      const info = await fs.lstat(cursor);
      // Official JA.lstat throws on missing → catch false. null inject = deny.
      if (!info) return false;
      if (info.isSymbolicLink()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export type CoworkAdminWorkspacePathKindDecision =
  | { allowed: true }
  | { allowed: false; folderPath: string; allowedRoots: string[] };

/**
 * Official tG — admin allowlist membership after Th() non-null:
 *   local → GHA(canonical)
 *   junction-to-unc → always deny
 *   network-drive && !zrA(display) → deny
 *   else → ol(normalize(display), roots.map(normalize))  (network-drive ok path
 *          and residual literal-unc if it ever reaches tG)
 *
 * Caller handles Th() null (unrestricted) and [] (disabled) before this.
 */
export async function evaluateCoworkAdminWorkspacePathKind(
  pathKind: CoworkPathKind,
  roots: readonly string[],
  options: { pathSafetyFs?: Partial<CoworkPathSafetyFs> } = {},
): Promise<CoworkAdminWorkspacePathKindDecision> {
  const allowedRoots = [...roots];
  const folderPath = coworkPathKindMountPath(pathKind);
  if (pathKind.kind === "local") {
    const under = await isCoworkCanonicalPathUnderAdminWorkspaceRoots(
      pathKind.canonical,
      allowedRoots,
      { realpath: options.pathSafetyFs?.realpath },
    );
    return under
      ? { allowed: true }
      : { allowed: false, folderPath, allowedRoots };
  }
  if (pathKind.kind === "junction-to-unc") {
    return { allowed: false, folderPath, allowedRoots };
  }
  if (
    pathKind.kind === "network-drive" &&
    !(await coworkPathHasNoSymlinkComponents(pathKind.display, {
      fs: options.pathSafetyFs,
    }))
  ) {
    return { allowed: false, folderPath, allowedRoots };
  }
  const under = isCoworkPathWithinNormalizedRoots(
    pathKind.display,
    allowedRoots,
  );
  return under
    ? { allowed: true }
    : { allowed: false, folderPath, allowedRoots };
}

/** Official tG deny message for outside admin workspace roots. */
export function coworkAdminWorkspaceRootsDenyMessage(
  displayPath: string,
  allowedRoots: readonly string[],
): string {
  return `Directory "${displayPath}" is not within the allowed workspace roots configured by your administrator: ${allowedRoots.join(", ")}`;
}

/**
 * Official AJA — returns overlapping protected root path, or null.
 */
export function deniedCoworkMountRoot(
  absolutePath: string,
  home: string = homedir(),
): string | null {
  for (const segment of COWORK_PROTECTED_HOME_DIR_SEGMENTS) {
    const protectedPath = path.join(home, segment);
    if (
      pathIsInsideOrEqual(absolutePath, protectedPath) ||
      pathIsInsideOrEqual(protectedPath, absolutePath)
    ) {
      return protectedPath;
    }
  }
  for (const file of COWORK_PROTECTED_HOME_FILES) {
    const protectedPath = path.join(home, file);
    if (
      path.resolve(absolutePath) === path.resolve(protectedPath) ||
      pathIsInsideOrEqual(protectedPath, absolutePath)
    ) {
      return protectedPath;
    }
  }
  return null;
}

/**
 * Official XPA — true when path is under session storage (or staging residual).
 */
export function isCoworkInternalStoragePath(
  absolutePath: string,
  sessionStorageDir: string | null | undefined,
): boolean {
  if (!sessionStorageDir) return false;
  return pathIsInsideOrEqual(absolutePath, sessionStorageDir);
}

/**
 * Official TKi subset: refuse home itself and filesystem root.
 */
export function classifyCoworkMountStructuralDenial(
  absolutePath: string,
  home: string = homedir(),
): string | null {
  const resolved = path.resolve(absolutePath);
  if (resolved === path.resolve(home)) {
    return "Cannot mount the home directory itself. Choose a subdirectory.";
  }
  const root = path.parse(resolved).root;
  if (path.resolve(root) === resolved || resolved === path.sep) {
    return "Cannot mount a filesystem root. Choose a subdirectory.";
  }
  return null;
}

export type CoworkDirectoryValidateOptions = {
  /**
   * Official Th() / allowedWorkspaceFolders. undefined = unrestricted;
   * [] = admin disabled; non-empty = allowlist (tG / GHA for local).
   */
  allowedWorkspaceFolders?: readonly string[] | null;
  /**
   * When true (default), allowlist uses official async GHA realpath membership
   * for local-without-pathKind fallback. Set false only for pure structural
   * unit tests that inject resolved paths. Ignored when `pathKind` is set
   * (full tG: GHA / junction deny / zrA+ol).
   */
  adminRootsUseRealpath?: boolean;
  home?: string;
  /**
   * Official P4 branch when path was user-provided (not folder picker).
   * Enables literal UNC + optional network-drive providedPath denies.
   * Default true for host-loop product validate after expand.
   */
  providedPath?: boolean;
  /**
   * Official Mh kind===network-drive when realpath already classified.
   * Prefer classifyCoworkPathKind; flag remains for inject/tests.
   */
  networkDrive?: boolean;
  /**
   * Official Mh result for full tG allowlist membership.
   * When set, allowlist uses evaluateCoworkAdminWorkspacePathKind (GHA / zrA / ol).
   */
  pathKind?: CoworkPathKind;
  /**
   * Official GHA realpath inject (tests). Product defaults node realpath.
   */
  pathSafetyFs?: Partial<CoworkPathSafetyFs>;
  platform?: NodeJS.Platform;
  requireExistingDirectory?: boolean;
  sessionStorageDir?: string | null;
  stat?: CoworkDirectoryPathStat | null;
};

/**
 * Official P4 validation after path expansion / Mh (no dialog).
 * Includes Th empty-disable + tG admin workspace roots when configured.
 * With `pathKind`: full tG (local GHA / junction deny / network-drive zrA+ol).
 * Without: GHA (or sync when adminRootsUseRealpath:false) on absolutePath.
 */
export async function validateCoworkDirectoryMountPath(
  absolutePath: string,
  options: CoworkDirectoryValidateOptions = {},
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const adminPolicy = classifyCoworkAdminWorkspaceFolders(
    options.allowedWorkspaceFolders,
  );
  if (adminPolicy.kind === "disabled") {
    return { ok: false, error: COWORK_FOLDER_ACCESS_DISABLED_BY_ADMIN };
  }

  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  // Official providedPath defaults true for typed paths; picker residual may pass false.
  const providedPath = options.providedPath !== false;

  if (providedPath) {
    // Official: non-local kinds on providedPath → network-drive message or UNC deny.
    if (options.networkDrive) {
      return {
        ok: false,
        error: coworkNetworkDriveProvidedPathDenyMessage(absolutePath),
      };
    }
    if (isCoworkLiteralUncPath(absolutePath)) {
      return { ok: false, error: COWORK_UNC_PATHS_NOT_ALLOWED };
    }
  } else if (
    isCoworkLiteralUncPath(absolutePath) ||
    // Picker also rejects junction-to-unc; product residual without async Uc.
    isCoworkUncLikePath(absolutePath)
  ) {
    return { ok: false, error: COWORK_UNC_PATHS_NOT_ALLOWED };
  }

  if (!path.isAbsolute(absolutePath)) {
    // Official kKi — relative / drive-relative vs absolute missing.
    return {
      ok: false,
      error: coworkPathNotAccessibleMessage(absolutePath, platform),
    };
  }
  const structural = classifyCoworkMountStructuralDenial(absolutePath, home);
  if (structural) return { ok: false, error: structural };
  if (isCoworkInternalStoragePath(absolutePath, options.sessionStorageDir)) {
    return {
      ok: false,
      error: "Cannot mount Cowork's own session storage directory.",
    };
  }
  const denied = deniedCoworkMountRoot(absolutePath, home);
  if (denied) {
    return {
      ok: false,
      error: `Directory "${absolutePath}" overlaps a protected host location (${denied}) and cannot be mounted.`,
    };
  }
  if (options.requireExistingDirectory) {
    const stat = options.stat;
    if (!stat?.exists) {
      return {
        ok: false,
        error: `Path "${absolutePath}" doesn't exist or isn't accessible.`,
      };
    }
    if (!stat.isDirectory) {
      return {
        ok: false,
        error: `Path "${absolutePath}" is not a directory.`,
      };
    }
  }
  if (adminPolicy.kind === "allowlist") {
    if (options.pathKind) {
      // Official P4 → tG(i) with full Mh kind (local GHA / junction / network zrA+ol).
      const decision = await evaluateCoworkAdminWorkspacePathKind(
        options.pathKind,
        adminPolicy.roots,
        { pathSafetyFs: options.pathSafetyFs },
      );
      if (!decision.allowed) {
        return {
          ok: false,
          // Official message uses i.display, not only Lc folderPath.
          error: coworkAdminWorkspaceRootsDenyMessage(
            options.pathKind.display,
            decision.allowedRoots,
          ),
        };
      }
    } else {
      const useRealpath = options.adminRootsUseRealpath !== false;
      const under = useRealpath
        ? await isCoworkCanonicalPathUnderAdminWorkspaceRoots(
            absolutePath,
            adminPolicy.roots,
            {
              realpath: options.pathSafetyFs?.realpath,
            },
          )
        : isCoworkPathUnderAdminWorkspaceRoots(absolutePath, adminPolicy.roots);
      if (!under) {
        return {
          ok: false,
          error: coworkAdminWorkspaceRootsDenyMessage(
            absolutePath,
            adminPolicy.roots,
          ),
        };
      }
    }
  }
  return { ok: true, path: absolutePath };
}

export type CoworkRequestDirectoryPreFilterOptions = {
  /**
   * Official canUseTool re-runs P4 (incl. Th/tG) only to decide whether to
   * attach `_hostPathForRequestDirectoryTool` — not a hard deny. Same Th()
   * source as tool validate when inject is set.
   */
  allowedWorkspaceFolders?: readonly string[] | null;
  home?: string;
  /**
   * Official mountSkeletonHome (dA) — appends .host-home index hint on
   * path-required deny. Residual false until dual-exec skeleton product.
   */
  mountSkeletonHome?: boolean;
  /**
   * Official Mh/Uc fs inject for prepare (tests). Product uses real fs.
   */
  pathSafetyFs?: Partial<CoworkPathSafetyFs>;
  /**
   * Official a||g gate: sessionType agent (Mc) or dispatch_child (DE).
   * Local cowork omit → picker (no pre-deny).
   */
  sessionType?: string | null;
  sessionStorageDir?: string | null;
};

/**
 * Official LocalAgentModeSessionManager canUseTool pre-prompt for ql:
 * (bridge|dispatch && !path) deny → expand path (eJA) → XPA / AJA deny before UI.
 */
export function preFilterCoworkRequestDirectoryPermission(
  toolName: string,
  input: Record<string, unknown> | undefined,
  options: CoworkRequestDirectoryPreFilterOptions = {},
): { behavior: "deny"; message: string } | undefined {
  if (toolName !== COWORK_REQUEST_DIRECTORY_MCP_TOOL) return undefined;
  const rawPath = input?.path;
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    // Official: De===ql && (a||g) && !be.path → deny. Local omit → picker.
    if (requiresCoworkRequestDirectoryPath(options.sessionType)) {
      return {
        behavior: "deny",
        message: coworkRequestDirectoryPathRequiredMessage({
          mountSkeletonHome: options.mountSkeletonHome,
        }),
      };
    }
    return undefined;
  }
  const home = options.home ?? homedir();
  // Official canUseTool hard-denies XPA/AJA only for expandable host paths;
  // literal UNC / relative are not this preFilter's hard-deny surface (tool/Mh).
  // Still expand without path.resolve so //server is not washed into /server.
  if (isCoworkLiteralUncPath(rawPath.trim()) || isCoworkUncLikePath(rawPath.trim())) {
    return undefined;
  }
  const expanded = expandCoworkDirectoryPath(rawPath.trim(), home);
  if (!path.isAbsolute(expanded)) {
    return undefined;
  }
  const candidate = path.resolve(expanded);
  if (isCoworkInternalStoragePath(candidate, options.sessionStorageDir)) {
    return {
      behavior: "deny",
      message: COWORK_REQUEST_DIRECTORY_INTERNAL_PREPROMPT_MESSAGE,
    };
  }
  const denied = deniedCoworkMountRoot(candidate, home);
  if (denied) {
    return {
      behavior: "deny",
      message: `Directory "${candidate}" overlaps a protected host location (${denied}) and cannot be mounted. Request a project or document folder instead.`,
    };
  }
  return undefined;
}

/**
 * Official strip of re-entrant `_hostPathForRequestDirectoryTool` then optional
 * re-attach after P4-subset validation for always-allow persistence.
 * Async: official canUseTool awaits P4/Mh before attaching host path.
 */
export async function prepareCoworkRequestDirectoryPermissionInput(
  toolName: string,
  input: Record<string, unknown> | undefined,
  options: CoworkRequestDirectoryPreFilterOptions = {},
): Promise<Record<string, unknown> | undefined> {
  if (!input) return input;
  if (toolName !== COWORK_REQUEST_DIRECTORY_MCP_TOOL) return input;
  const {
    _hostPathForRequestDirectoryTool: _stripped,
    ...rest
  } = input as Record<string, unknown> & {
    _hostPathForRequestDirectoryTool?: unknown;
  };
  const rawPath = rest.path;
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    return rest;
  }
  const home = options.home ?? homedir();
  const raw = rawPath.trim();
  // Official: eJA → Mh; P4 failure does not hard-deny the permission prompt —
  // tool handler enforces. Attach _hostPath only when kind is local + P4 ok.
  const expanded = expandCoworkDirectoryPath(raw, home);
  const pathKind = await classifyCoworkPathKind(expanded, {
    fs: options.pathSafetyFs,
  });
  if (!pathKind || pathKind.kind !== "local") {
    const display =
      pathKind?.display ??
      (isCoworkUncLikePath(raw) ? raw : expanded);
    return { ...rest, path: display };
  }
  const mountPath = coworkPathKindMountPath(pathKind);
  // Official canUseTool only attaches for local + P4 ok; pathKind is local here.
  const validated = await validateCoworkDirectoryMountPath(mountPath, {
    allowedWorkspaceFolders: options.allowedWorkspaceFolders,
    home,
    pathKind,
    pathSafetyFs: options.pathSafetyFs,
    providedPath: false,
    requireExistingDirectory: false,
    sessionStorageDir: options.sessionStorageDir,
  });
  if (!validated.ok) {
    return { ...rest, path: pathKind.display };
  }
  return {
    ...rest,
    path: validated.path,
    _hostPathForRequestDirectoryTool: validated.path,
  };
}

function hostLoopSuccessMessage(options: {
  displayPath: string;
  bashMountName?: string | null;
  isHostLoopMode: boolean;
  networkDrive?: boolean;
  vmProcessName: string;
}): string {
  // Official dXe host-loop success (multi-line; tools branch on isHostLoopMode).
  const tools = options.isHostLoopMode
    ? "Read/Write/Edit/Grep/Glob"
    : "Read/Write/Edit";
  let note = "";
  if (options.networkDrive) {
    note = `Note: ${options.displayPath} is on a network drive. Shell commands (bash, ls, find, cat) run in an isolated Linux sandbox that cannot reach network shares — use ${tools} for files there instead. If shell access is needed, copy the relevant files to a local folder first (Read/Write can do this), then run bash on the copy.\n\n`;
  } else if (options.bashMountName !== undefined && options.bashMountName !== null) {
    // Official: D = bashMountName !== void 0 ? `/sessions/.../mnt/${Zn(name)}` : void 0
    // Empty string still produces a path note (official `_??""` callback).
    // Zn = normalizeCoworkVmMountPathSegment (backslash→slash, strip leading /).
    const mountSeg = normalizeCoworkVmMountPathSegment(String(options.bashMountName));
    const vmPath = `/sessions/${options.vmProcessName}/mnt/${mountSeg}`;
    note = `For mcp__workspace__bash ONLY, this folder appears at ${vmPath}. Do NOT pass that /sessions/… form to ${tools} — those run on the host, where that path does not exist.\n\n`;
  }
  return `Folder connected: ${options.displayPath}\n\nUse this exact path with ${tools}.\n\n${note}${tools} can use this folder immediately.`;
}

function vmSuccessMessage(displayPath: string, vmPath: string): string {
  // Official dXe non-host-loop success.
  return `Successfully mounted directory.\n\nHost path: ${displayPath}\nVM path: ${vmPath}\n\nYou can now access files in this directory at ${vmPath}`;
}

async function defaultStat(absolutePath: string): Promise<CoworkDirectoryPathStat> {
  try {
    const { stat } = await import("node:fs/promises");
    const info = await stat(absolutePath);
    return { exists: true, isDirectory: info.isDirectory() };
  } catch {
    return { exists: false, isDirectory: false };
  }
}

/**
 * Official OeA / isScratchpadVMPath — under /sessions/<vm>/ but not mnt/.
 * Dual-exec scratchpad promote residual; host-loop present_files skips promote.
 */
export function isCoworkScratchpadVmPath(
  filePath: string,
  vmProcessName: string,
): boolean {
  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));
  const prefix = `/sessions/${vmProcessName}/`;
  return normalized.startsWith(prefix) && !normalized.startsWith(`${prefix}mnt/`);
}

/**
 * Official tJA / getMountInfoFromVMPath — map a file path to its mount.
 * Host-loop may pass host absolute paths; dual-exec passes /sessions/.../mnt/<name>/...
 */
export function getCoworkMountInfoFromPath(
  filePath: string,
  options: {
    getNetworkDriveFolders?: () => Set<string> | Iterable<string>;
    getOutputsSubpath?: () => string | null | undefined;
    getUserSelectedFolders?: () => string[];
    vmProcessName: string;
  },
): CoworkDirectoryMountInfo | null {
  const folders = options.getUserSelectedFolders?.() ?? [];
  const network = new Set(options.getNetworkDriveFolders?.() ?? []);
  const outputsSubpath = options.getOutputsSubpath?.() ?? null;
  const normalizedInput = filePath.replace(/\\/g, "/");
  const mntPrefix = `/sessions/${options.vmProcessName}/mnt/`;

  if (normalizedInput.startsWith(mntPrefix)) {
    const rest = normalizedInput.slice(mntPrefix.length);
    const slash = rest.indexOf("/");
    const mountName = slash === -1 ? rest : rest.slice(0, slash);
    const mountMap = deriveMountNames(folders);
    for (const [hostRoot, name] of mountMap) {
      if (network.has(hostRoot)) continue;
      if (name === mountName) {
        return {
          name: mountName,
          hostPath: hostRoot,
          subpath: hostRoot,
        };
      }
    }
    if (mountName === "outputs" && outputsSubpath) {
      return {
        name: "outputs",
        hostPath: outputsSubpath,
        subpath: outputsSubpath,
      };
    }
    return null;
  }

  // Host-loop: match absolute host path against userSelectedFolders / outputs.
  const resolved = path.resolve(filePath);
  for (const [hostRoot, name] of deriveMountNames(folders)) {
    if (network.has(hostRoot)) continue;
    if (pathIsInsideOrEqual(resolved, hostRoot)) {
      return {
        name,
        hostPath: hostRoot,
        subpath: hostRoot,
      };
    }
  }
  if (outputsSubpath && pathIsInsideOrEqual(resolved, outputsSubpath)) {
    return {
      name: "outputs",
      hostPath: outputsSubpath,
      subpath: outputsSubpath,
    };
  }
  return null;
}

/**
 * Official present_files accessibility check (host-loop subset of gh + host abs).
 * Returns host-accessible path, or null when inaccessible.
 */
export function resolveCoworkPresentableHostPath(
  filePath: string,
  options: {
    getHostOutputsDir?: () => string | null | undefined;
    getUserSelectedFolders?: () => string[];
    getVMPathContext?: () => CoworkVmPathContext | null | undefined;
    vmProcessName: string;
  },
): string | null {
  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));
  if (isCoworkScratchpadVmPath(normalized, options.vmProcessName)) {
    // Official promotes via iJA — dual-exec residual; treat as inaccessible here.
    return null;
  }

  const context = options.getVMPathContext?.() ?? null;
  if (normalized.startsWith(`/sessions/${options.vmProcessName}/`)) {
    if (!context) return null;
    return mapVmPathToHostPath(normalized, context);
  }

  // Host absolute path: must sit under outputs or a connected folder.
  if (!path.isAbsolute(filePath)) return null;
  const resolved = path.resolve(filePath);
  const roots: string[] = [];
  const outputs = options.getHostOutputsDir?.();
  if (outputs) roots.push(path.resolve(outputs));
  for (const folder of options.getUserSelectedFolders?.() ?? []) {
    roots.push(path.resolve(folder));
  }
  for (const root of roots) {
    if (pathIsInsideOrEqual(resolved, root)) return resolved;
  }
  return null;
}

export function createCoworkDirectoryMcpServerConfig(
  options: CoworkDirectoryMcpServerOptions,
) {
  const getHome = options.getHomeDir ?? (() => homedir());
  const statPath = options.statPath ?? defaultStat;
  const isHostLoopMode = Boolean(options.isHostLoopMode);
  // Official: e.hasMarkTaskComplete && u.push(B). Product default true; Statsig ft residual.
  const hasMarkTaskComplete = options.hasMarkTaskComplete !== false;

  const tools = [
      tool(
        COWORK_REQUEST_DIRECTORY_TOOL,
        COWORK_REQUEST_DIRECTORY_DESCRIPTION,
        {
          path: z
            .string()
            .optional()
            .describe(
              "Host path to mount (e.g. ~/Downloads). Required in remote sessions; omit in local sessions to show the native folder picker.",
            ),
        },
        async (args) => {
          const provided =
            typeof args.path === "string" && args.path.trim().length > 0
              ? args.path.trim()
              : undefined;
          let rawCandidate: string | undefined;
          if (provided) {
            // Official: eJA then Mh — do not path.resolve first (washes // / relative).
            rawCandidate = expandCoworkDirectoryPath(provided, getHome());
          } else if (options.pickDirectory) {
            const picked = await options.pickDirectory();
            if (picked.canceled) {
              return textResult("Directory selection was cancelled by the user.");
            }
            rawCandidate = picked.path;
          } else {
            // Official remote/no-picker fallback uses the same path-required base
            // as canUseTool headless deny (no .host-home append here).
            return errorResult(COWORK_REQUEST_DIRECTORY_PATH_REQUIRED_MESSAGE);
          }

          // Official P4: Mh → kKi | Hs/network-drive | TKi/XPA/AJA/tG.
          const pathKind = await classifyCoworkPathKind(rawCandidate, {
            fs: options.pathSafetyFs,
          });
          if (!pathKind) {
            return errorResult(
              coworkPathNotAccessibleMessage(
                rawCandidate,
                process.platform,
              ),
            );
          }
          const kindDeny = denyCoworkPathKindForMount(
            pathKind,
            Boolean(provided),
          );
          if (kindDeny) return errorResult(kindDeny);

          const mountPath = coworkPathKindMountPath(pathKind);
          const displayPath = pathKind.display;
          const isNetworkDrive = pathKind.kind === "network-drive";
          const stat = provided
            ? await statPath(displayPath)
            : { exists: true, isDirectory: true };
          // Kind already enforced for providedPath; remaining P4 TKi/XPA/AJA/tG.
          // Pass pathKind so allowlist uses full official tG (GHA / zrA / ol).
          const validated = await validateCoworkDirectoryMountPath(mountPath, {
            allowedWorkspaceFolders: options.getAllowedWorkspaceFolders?.(),
            home: getHome(),
            networkDrive: false,
            pathKind,
            pathSafetyFs: options.pathSafetyFs,
            providedPath: false,
            requireExistingDirectory: Boolean(provided),
            sessionStorageDir: options.getSessionStorageDir?.() ?? null,
            stat,
          });
          if (!validated.ok) {
            // Prefer display path in user-facing missing/not-dir messages when
            // canonical differs (official uses i.display in those branches).
            if (
              provided &&
              validated.error.includes(mountPath) &&
              mountPath !== displayPath
            ) {
              return errorResult(
                validated.error.replaceAll(mountPath, displayPath),
              );
            }
            return errorResult(validated.error);
          }

          if (!options.mountFolder) {
            return errorResult("Failed to mount directory.");
          }
          // Official: e.mountFolder(l.resolved) — full Mh kind, not string-only.
          const mounted = await options.mountFolder(pathKind);
          if (!mounted.ok) {
            return errorResult(mounted.error || "Failed to mount directory.");
          }

          if (mounted.mode === "host-loop" || isHostLoopMode) {
            return textResult(
              hostLoopSuccessMessage({
                bashMountName: mounted.bashMountName,
                displayPath: mounted.displayPath ?? displayPath,
                isHostLoopMode: true,
                networkDrive: mounted.networkDrive ?? isNetworkDrive,
                vmProcessName: options.vmProcessName,
              }),
            );
          }
          const mountName =
            mounted.bashMountName ?? path.basename(mounted.displayPath);
          const vmPath = `/sessions/${options.vmProcessName}/mnt/${mountName}`;
          return textResult(vmSuccessMessage(mounted.displayPath, vmPath));
        },
      ),
      tool(
        COWORK_ALLOW_FILE_DELETE_TOOL,
        COWORK_ALLOW_FILE_DELETE_DESCRIPTION,
        {
          file_path: z
            .string()
            .describe("The VM path of the file you're trying to delete"),
        },
        async (args) => {
          const filePath =
            typeof args.file_path === "string" ? args.file_path : "";
          const mount = getCoworkMountInfoFromPath(filePath, {
            getNetworkDriveFolders: options.getNetworkDriveFolders,
            getOutputsSubpath: options.getOutputsSubpath,
            getUserSelectedFolders: options.getUserSelectedFolders,
            vmProcessName: options.vmProcessName,
          });
          if (!mount) {
            return errorResult(
              `Could not find mount for path: ${filePath}. Make sure the path is within a mounted directory.`,
            );
          }
          const success = textResult(
            `File deletion is now enabled for the "${mount.name}" folder.`,
          );
          // Official host-loop branch: setFileDeleteApprovedForMount only (no VM rwd).
          if (isHostLoopMode) {
            options.setFileDeleteApprovedForMount?.(mount.name);
            return success;
          }
          // Dual-exec remount rwd residual — still record approval so policy can read it.
          options.setFileDeleteApprovedForMount?.(mount.name);
          return success;
        },
      ),
      tool(
        COWORK_PRESENT_FILES_TOOL,
        COWORK_PRESENT_FILES_DESCRIPTION,
        {
          files: z
            .array(
              z.object({
                file_path: z.string().describe("Absolute path to the file"),
              }),
            )
            .describe("Files to present to the user"),
        },
        async (args) => {
          const files = Array.isArray(args.files) ? args.files : [];
          const entries = files.map((entry) => {
            const filePath =
              typeof entry?.file_path === "string" ? entry.file_path : "";
            return {
              file_path: filePath,
              vmPath: path.posix.normalize(filePath.replace(/\\/g, "/")),
            };
          });

          const inaccessible: string[] = [];
          for (const { file_path: filePath, vmPath } of entries) {
            if (isCoworkScratchpadVmPath(vmPath, options.vmProcessName)) {
              // Official skips scratchpad in the accessibility pre-check.
              continue;
            }
            const host = resolveCoworkPresentableHostPath(filePath, {
              getHostOutputsDir: options.getHostOutputsDir,
              getUserSelectedFolders: options.getUserSelectedFolders,
              getVMPathContext: options.getVMPathContext,
              vmProcessName: options.vmProcessName,
            });
            if (host === null) inaccessible.push(filePath);
          }
          if (inaccessible.length > 0) {
            return errorResult(
              `Cannot present ${inaccessible.length} file(s) — not accessible on the user's computer:\n` +
                inaccessible.map((p) => `  - ${p}`).join("\n"),
            );
          }

          const content: Array<{ type: "text"; text: string }> = [];
          for (const { file_path: filePath, vmPath } of entries) {
            if (isCoworkScratchpadVmPath(vmPath, options.vmProcessName)) {
              // Official iJA promote + recordDetectedFile residual (needs VM readFile).
              // Honest: present path as-is; do not invent host outputs copy.
              options.notifySession?.(
                `present_files: ${vmPath} could not be copied to the outputs folder (dual-exec promote residual). It remains in the scratchpad — the user can preview it but can't open it on their computer.`,
              );
              content.push({ type: "text", text: filePath });
              continue;
            }
            // Official non-scratchpad: content text is original file_path (m).
            // recordDetectedFile is only used on iJA promote success, not here.
            content.push({ type: "text", text: filePath });
          }
          return { content };
        },
      ),
  ];

  if (hasMarkTaskComplete) {
    tools.push(
      tool(
        COWORK_MARK_TASK_COMPLETE_TOOL,
        COWORK_MARK_TASK_COMPLETE_DESCRIPTION,
        {},
        async () => {
          // Official: e.onMarkTaskComplete(); return Task marked complete.
          options.onMarkTaskComplete?.();
          return textResult(COWORK_MARK_TASK_COMPLETE_RESULT);
        },
      ),
    );
  }

  return createSdkMcpServer({
    alwaysLoad: true,
    name: COWORK_DIRECTORY_MCP_NAME,
    tools,
  });
}

export function withCoworkDirectoryMcpServer(
  existing: Record<string, unknown> | undefined,
  options: CoworkDirectoryMcpServerOptions | null | undefined,
): Record<string, unknown> {
  if (!options) return { ...(existing ?? {}) };
  return {
    ...(existing ?? {}),
    [COWORK_DIRECTORY_MCP_NAME]: createCoworkDirectoryMcpServerConfig(options),
  };
}
