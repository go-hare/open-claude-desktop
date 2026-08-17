import { app, dialog, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  createLocalAgent,
  deleteLocalSkill,
  getLocalSkillFiles,
  listLocalAgents,
  listLocalSkills,
  revealLocalSkill,
  saveLocalSkill,
  setLocalSkillEnabled,
} from "../services/localSessions/localAgentAssets";
import {
  LocalSessionStore,
  type LocalSession,
} from "../services/localSessions/localSessionStore";
import { CoworkTrustedFolders } from "../services/coworkSessions/coworkTrustedFolders";
import { parseEffortFlagSettings } from "../services/localSessions/claudeCliRunner";
import { getOfficialCodeStats } from "../services/localSessions/codeStatsAggregation";
import { getSupportedCommands } from "../services/localSessions/supportedCommands";
import { getTranscriptFeedback, submitTranscriptFeedback } from "../services/localSessions/transcriptFeedbackStore";
import { getLocalSessionEnvironment, saveLocalSessionEnvironment } from "../services/localSessions/localSessionEnvironmentStore";
import { exportCoworkCliSessionTranscript } from "../services/coworkSessions/coworkSessionShareExport";
import { loadOriginalNodePty } from "../services/originalRuntime/originalRuntimeModules";
import type { IpcHandlerContext } from "./context";
import {
  getCodeSessionAttentionService,
  getLocalSessionRunner,
  setFocusedCodeSession,
} from "./localSessionRunner";
import { originalEventSurface } from "./originalEventSurface";
import { describeMcpServer, mcpConfigEntries, requestMcpServer } from "../services/mcp/mcpRuntime";
import { getOfficialGitDiff } from "../services/localSessions/officialGitDiff";
import {
  availableCodePermissionModes,
  clampCodePermissionMode,
} from "../services/localSessions/codePermissionModePolicy";
import { resolveDefaultPermissionMode } from "../services/localSessions/codeDefaultPermissionMode";
import { CodeAutoArchiveEngine } from "../services/localSessions/codeAutoArchiveEngine";
import { CodeAutoFixEngine } from "../services/localSessions/codeAutoFixEngine";
import { isAutofixOnPrCreateFromUserData } from "../services/settings/toolAccessMode";
import {
  createJsonWorktreeRegistry,
  WorktreePool,
} from "../services/localSessions/worktreePool";
import { resolveSshRemoteCwd } from "../services/localSessions/sshCliSpawn";
import {
  commandExistsOnAllPaths,
  installGhResidual,
  resolveCommandOnAllPaths,
  resolveGhPath,
} from "../services/localSessions/localSessionCommandPath";
import {
  buildSshArgv,
  defaultExecSsh,
  normalizeSessionSshConfig,
  shellQuote,
  type SessionSshConfig,
} from "../services/localSessions/sshTranscriptSync";
import { resolveCodeTranscriptPath } from "../services/localSessions/codeTranscriptJsonl";
import { CodeSessionSummaryService } from "../services/localSessions/codeSessionSummary";
import {
  getTranscriptSearchWorkerHost,
  type TranscriptSearchSession,
} from "../services/shell/transcriptSearchWorkerHost";
import type { InterfaceHandlers, IpcHandler } from "./registerIpc";
import { dispatchBridgeEvent, registerInterfaceHandlers } from "./registerIpc";
import {
  deleteBridgeAgentMemoryResidual,
  deleteBridgeSessionResidual,
  getBridgeConsent,
  getSessionsBridgeEnabled,
  getSessionsBridgeStatusState,
  identityFromSettingsPrefs,
} from "../services/coworkSessions/sessionsBridgeResidual";
import {
  abandonBridgeEnvironmentLive,
  kickBridgePollLive,
  resetBridgeLive,
  resetBridgeSessionLive,
  respondBridgePermissionPreflightLive,
  setSessionsBridgeEnabledLive,
} from "../services/coworkSessions/sessionsBridgeLifecycle";

const execFileAsync = promisify(execFile);
const TEXT_LIMIT_BYTES = 8 * 1024 * 1024;

// Code LocalSessions only. Cowork LocalAgentModeSessions is registered solely via
// coworkSessionsHandlers + CoworkSessionManager (see registerDesktopIpc).
const LOCAL_SESSIONS_METHODS = [
  "addDirectories","archive","cancelQueuedMessage","checkGhAvailable","checkPty","checkRemoteTrust","checkTrust","clearSession","commitAllChanges","commitWipForBranchSwitch","createAgent","createLocalPr","delete","disableAutoMerge","discardWorkingTree","enableAutoMerge","ensureBranchPushed","ensureSSHConnected","forkSession","generateLocalPrContent","getAgents","getAll","getCodeStats","getCommitDiff","getContextUsage","getDefaultEffort","getDefaultPermissionMode","getAvailablePermissionModes","getDetectedProjects","getDiffFileContent","getEffort","getEffortCatalogDefaults","getGhIssue","getGitCommits","getGitDiff","getGitDiffStats","getGitInfo","getInstalledEditors","getLocalBranches","getMergeBase","getPermissionMode","getPlanForSession","getPrChecks","getPrDetails","getPrIssueComments","getPrReviewComments","getPrReviews","getPrStateForBranch","getSSHConfigs","getSSHGitInfo","getSSHSupportedCommands","getSession","getSessionsForScheduledTask","getShellPtyBuffer","getSupportedCommands","getTeleportReadiness","getTranscript","getTrustedSSHHosts","getUncommittedChanges","getWorkingTreeStatus","importCliSession","installGh","interrupt","isVSCodeInstalled","isWorkingTreeDirty","launchUltrareview","listGhIssues","listSSHDirectory","listSessionDirectory","logCliEvent","mergePr","openInEditor","openInVSCode","pickFileAtCwd","pickSessionFile","popBackgroundTaskSuggestion","readFileAtCwd","readSessionFile","readSessionImageAsDataUrl","releaseWorktree","replaceEnabledMcpTools","replaceRemoteMcpServers","resizePty","resizeShellPty","resolveSSHSettings","respondToSSHPassword","respondToToolPermission","reviewDiff","rewind","runBashCommand","saveTrust","searchSessions","sendMessage","sendSideChatMessage","setAutoFixEnabled","setAvailableCodeModels","setEffort","setFastMode","setFocusedSession","setMcpServers","setModel","setPermissionMode","setSSHConfigs","setTrustedSSHHosts","setVisibility","shareSession","start","startPty","startShellPty","startSideChat","stashWorkingTree","stop","stopPty","stopSessionSummary","stopShellPty","stopSideChat","stopTask","submitFeedback","summarizeSession","summarizeTranscript","refreshSessionTitle","teleportToCloud","testSSHConnection","unarchive","updatePrBody","updateSession","validateSSHPath","writePty","writeSessionFile","writeShellPty",
] as const;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))] : [];
}

function textFromTranscriptItem(value: unknown): string {
  const raw = asObject(value);
  const direct = asString(raw.text) ?? asString(raw.content) ?? asString(raw.result) ?? asString(raw.error);
  if (direct) return direct;
  const message = asObject(raw.message);
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => asString(asObject(item).text) ?? asString(asObject(item).content))
    .filter((text): text is string => Boolean(text))
    .join("\n");
}

function pathFromTarget(value: unknown): string | null {
  const raw = asObject(value);
  return asString(value)
    ?? asString(raw.path)
    ?? asString(raw.filePath)
    ?? asString(raw.filename)
    ?? asString(raw.uri);
}

function ok(value: unknown = true) {
  return value;
}

/**
 * Official-aligned bridge shape: metadata only. messages/transcript NEVER cross the bridge —
 * the web fetches content via getTranscript (live jsonl read). userData附加状态 (title
 * override, pin, archive, model/effort/permissionMode, running) is included.
 */
const BRIDGE_SESSION_KEYS = [
  "id",
  "sessionId",
  "title",
  "kind",
  "sessionKind",
  "createdAt",
  "updatedAt",
  "lastActivityAt",
  "cwd",
  "folders",
  "userSelectedFolders",
  "userSelectedFiles",
  "model",
  "effort",
  // Official D.fastMode residual — local session opt-in for fast mode picker.
  "fastMode",
  "permissionMode",
  "sourceBranch",
  "useWorktree",
  "worktreeName",
  "worktreePath",
  "originCwd",
  "sshConfig",
  "sshRemoteTranscriptPath",
  "sshRemoteProjectDir",
  "sshLocalTranscriptSize",
  "visibility",
  "agent",
  "origin",
  // Official O.tags residual — ultrareview oi chrome (c119 ri).
  "tags",
  "archived",
  "stopped",
  "isRunning",
  // Official CodeStatusGlyph / u_e — ready = hasCompleted && isUnread
  "hasCompleted",
  "isUnread",
  "isPinned",
  "pinned",
  "cliSessionId",
  "scheduledTaskId",
  "slashCommands",
  "runtime",
  "pendingToolPermissions",
  "mountedProjects",
  // Official AutoArchive residual — session.prs terminal list.
  "prs",
  // Official AutoFix residual.
  "autoFixEnabled",
  "seenCommentIds",
] as const;

/**
 * Bridge session view. When bypassPermissionsModeEnabled is off, surface
 * clamped permissionMode so Mode pill matches spawn (acceptEdits residual).
 */
function toBridgeSession(
  session: unknown,
  options?: { bypassPermissionsModeEnabled?: boolean },
): unknown {
  const raw = asObject(session);
  const id = asString(raw.id) ?? asString(raw.sessionId);
  if (!id) return session;
  const updatedAt = asString(raw.updatedAt) ?? asString(raw.lastActivityAt) ?? new Date().toISOString();
  const out: Record<string, unknown> = {};
  for (const key of BRIDGE_SESSION_KEYS) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  if (typeof out.permissionMode === "string") {
    out.permissionMode = clampCodePermissionMode(
      out.permissionMode,
      options?.bypassPermissionsModeEnabled === true,
    );
  }
  return {
    ...out,
    id,
    sessionId: id,
    sessionKind: asString(raw.sessionKind) ?? (raw.kind === "code" ? "code" : "cowork"),
    lastActivityAt: asString(raw.lastActivityAt) ?? updatedAt,
    isRunning: typeof raw.isRunning === "boolean" ? raw.isRunning : raw.stopped !== true,
    userSelectedFolders: Array.isArray(raw.userSelectedFolders) ? raw.userSelectedFolders : raw.folders,
  };
}

function toBridgeSessions(
  sessions: unknown[],
  options?: { bypassPermissionsModeEnabled?: boolean },
): unknown[] {
  return sessions.map((session) => toBridgeSession(session, options));
}

async function commandExists(command: string): Promise<boolean> {
  // Official residual: resolve via allPaths (GUI PATH often omits Homebrew).
  return commandExistsOnAllPaths(command);
}

async function executableAvailable(command: string): Promise<boolean> {
  if (path.isAbsolute(command)) {
    try {
      await fs.access(command);
      return true;
    } catch {
      return false;
    }
  }
  return commandExists(command);
}

function editorCommand(value: unknown): string | null {
  const raw = asObject(value);
  const candidate = asString(value) ?? asString(raw.command) ?? asString(raw.executable) ?? asString(raw.id) ?? asString(raw.name);
  if (!candidate || candidate === "default" || candidate === "system") return null;
  const lower = candidate.toLowerCase();
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("windsurf")) return "windsurf";
  if (lower.includes("vscode") || lower.includes("visual studio code")) return "code";
  return candidate;
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

async function openEditorAtLocation(filePath: string, editor: unknown, line: unknown, column: unknown): Promise<boolean> {
  const lineNumber = positiveInteger(line);
  const columnNumber = positiveInteger(column);
  const target = lineNumber ? `${filePath}:${lineNumber}${columnNumber ? `:${columnNumber}` : ""}` : filePath;
  const candidates = [editorCommand(editor), "code"].filter((value): value is string => Boolean(value));
  for (const command of [...new Set(candidates)]) {
    if (!(await executableAvailable(command))) continue;
    try {
      await execFileAsync(command, ["-g", target], { timeout: 5000 });
      return true;
    } catch {
      // Fall back to the next known editor or Electron's default opener.
    }
  }
  return (await shell.openPath(filePath)).length === 0;
}

async function getInstalledEditors(): Promise<Record<string, unknown>> {
  const editors = [
    { id: "vscode", name: "Visual Studio Code", command: "code" },
    { id: "cursor", name: "Cursor", command: "cursor" },
    { id: "windsurf", name: "Windsurf", command: "windsurf" },
  ];
  const results = await Promise.all(editors.map(async (editor) => ({ ...editor, installed: await executableAvailable(editor.command) })));
  return {
    vscode: results.find((editor) => editor.id === "vscode")?.installed ?? false,
    cursor: results.find((editor) => editor.id === "cursor")?.installed ?? false,
    windsurf: results.find((editor) => editor.id === "windsurf")?.installed ?? false,
    editors: results.filter((editor) => editor.installed),
  };
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === "win32") return { file: process.env.COMSPEC || "powershell.exe", args: [] };
  return { file: process.env.SHELL || "/bin/zsh", args: ["-l"] };
}

function commandShell(command: string): { file: string; args: string[] } {
  if (process.platform === "win32") return { file: "powershell.exe", args: ["-NoProfile", "-Command", command] };
  return { file: process.env.SHELL || "/bin/zsh", args: ["-lc", command] };
}

async function runGit(cwd: string | null, args: string[], timeoutMs = 10000) {
  if (!cwd) return { ok: false, error: "missing cwd" };
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string; code?: unknown };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? "", code: err.code };
  }
}

async function runProcess(cwd: string | null, command: string, args: string[], timeout = 30000) {
  if (!cwd) return { stdout: "", stderr: "missing cwd", code: 1, error: "missing cwd" };
  // Official spawnGh residual: resolve bare commands (esp. gh) against allPaths.
  let resolved = command;
  if (!command.includes("/") && !command.includes("\\")) {
    const found = await resolveCommandOnAllPaths(command);
    if (!found) {
      return {
        stdout: "",
        stderr: `spawn ${command} ENOENT`,
        code: 1,
        error: `spawn ${command} ENOENT`,
        ok: false,
        success: false,
      };
    }
    resolved = found;
  }
  try {
    const { stdout, stderr } = await execFileAsync(resolved, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 });
    return { stdout, stderr, code: 0, ok: true, success: true };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string; code?: unknown };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? "",
      code: typeof err.code === "number" ? err.code : 1,
      error: err.message,
      ok: false,
      success: false,
    };
  }
}

async function runGitInRepository(cwd: string | null, args: string[]) {
  if (!cwd) return { ok: false, error: "missing cwd" };
  const repo = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!repo.ok) return { ok: true, stdout: "", stderr: "" };
  return runGit(cwd, args);
}

async function gitSuccess(cwd: string | null, args: string[]) {
  const result = await runGit(cwd, args);
  return result.ok ? { success: true } : { success: false, error: String(result.stderr || result.stdout || "git command failed") };
}

async function gitText(cwd: string | null, args: string[]): Promise<string | null> {
  const result = await runGit(cwd, args);
  return result.ok ? String(result.stdout ?? "").trim() || null : null;
}

function parseGithubRemote(remoteUrl: string | null): { owner: string; repo: string; remoteUrl: string } | null {
  if (!remoteUrl) return null;
  const match = remoteUrl.match(/github\.com[:/]([^/\s]+)\/(.+?)(?:\.git)?$/i);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, ""), remoteUrl };
}

async function githubRepo(cwd: string | null) {
  const origin = await gitText(cwd, ["remote", "get-url", "origin"]);
  if (origin) return parseGithubRemote(origin);
  const remotes = await gitText(cwd, ["remote", "-v"]);
  const firstGithub = remotes?.split(/\r?\n/).map((line) => line.split(/\s+/)[1]).find((remote) => remote?.includes("github.com")) ?? null;
  return parseGithubRemote(firstGithub);
}

function githubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

function githubApiPath(pathname: string, query?: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return `${pathname}${search.size > 0 ? `?${search.toString()}` : ""}`;
}

function githubRequest(apiPath: string): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  const token = githubToken();
  const options = {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "claudex-desktop",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  return new Promise((resolve) => {
    const request = https.get(`https://api.github.com${apiPath}`, options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data: unknown = text;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          // Keep the raw response text.
        }
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve({ ok: true, status, data });
        else resolve({ ok: false, status, data, error: asString(asObject(data).message) ?? `GitHub API failed with status ${status}` });
      });
    });
    request.on("error", (error) => resolve({ ok: false, status: 0, error: error.message }));
    request.setTimeout(15000, () => {
      request.destroy();
      resolve({ ok: false, status: 0, error: "GitHub API request timed out" });
    });
  });
}

function issueOrPrNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const raw = asObject(value);
    const candidate = Number(value) || Number(raw.number) || Number(raw.issueNumber) || Number(raw.prNumber) || Number(raw.pullNumber);
    if (Number.isInteger(candidate) && candidate > 0) return candidate;
  }
  return null;
}

async function currentBranch(cwd: string | null): Promise<string | null> {
  return gitText(cwd, ["branch", "--show-current"]);
}

/**
 * Resolve PR for a branch head. Uses state=all so closed/merged PRs are visible
 * (AutoArchiveEngine residual needs terminal states; open-only would never archive).
 * Prefer open PR when multiple heads match; else first (GitHub returns newest first).
 */
async function githubPullForBranch(cwd: string | null, branch?: string | null) {
  const repo = await githubRepo(cwd);
  const headBranch = branch ?? await currentBranch(cwd);
  if (!repo || !headBranch) return null;
  const result = await githubRequest(
    githubApiPath(`/repos/${repo.owner}/${repo.repo}/pulls`, {
      state: "all",
      head: `${repo.owner}:${headBranch}`,
      per_page: 10,
    }),
  );
  if (!result.ok || !Array.isArray(result.data) || result.data.length === 0) {
    return null;
  }
  const pulls = result.data as Array<Record<string, unknown>>;
  const open = pulls.find((pull) => String(pull.state ?? "").toLowerCase() === "open");
  return open ?? pulls[0] ?? null;
}

async function githubPull(cwd: string | null, number?: number | null, branch?: string | null) {
  const repo = await githubRepo(cwd);
  if (!repo) return { ok: false, error: "github_remote_not_found" };
  const pull = number
    ? await githubRequest(`/repos/${repo.owner}/${repo.repo}/pulls/${number}`)
    : { ok: true, status: 200, data: await githubPullForBranch(cwd, branch) };
  const pullError = "error" in pull ? pull.error : undefined;
  return pull.ok && pull.data ? { ok: true, repo, pull: pull.data } : { ok: false, repo, error: pullError ?? "pull_request_not_found" };
}

/**
 * Official generateLocalPrContent residual (GitHubPrManager):
 *   stat/log/diff against base...HEAD (not unstaged dump of entire dirty tree).
 *   Returns null when there is no base...HEAD content.
 * Product: keep a compact Summary + commits + Test plan body so createLocalPr
 * never embeds multi-thousand-line porcelain status into --body.
 */
async function generatePrContent(cwd: string | null) {
  if (!cwd) return null;
  const branch = (await currentBranch(cwd)) ?? "current branch";
  // Official base: origin/HEAD → main|master fallback (same as getGitInfo residual).
  let base = "main";
  const originHead = await runGit(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (originHead.ok) {
    const ref = String(originHead.stdout ?? "").trim();
    const match = ref.match(/refs\/remotes\/origin\/(.+)$/);
    if (match?.[1]) base = match[1];
  } else {
    for (const candidate of ["main", "master"]) {
      const probe = await runGit(cwd, ["rev-parse", "--verify", `origin/${candidate}`]);
      if (probe.ok) {
        base = candidate;
        break;
      }
    }
  }
  const range = `${base}...HEAD`;
  const stat = (await gitText(cwd, ["diff", "--no-ext-diff", "--stat", range])) ?? "";
  const commits = (await gitText(cwd, ["log", "--oneline", `${base}..HEAD`])) ?? "";
  const fullDiff = (await gitText(cwd, ["diff", "--no-ext-diff", range])) ?? "";
  // Official: no commits and no diff against base → null (caller may fall back).
  if (!stat.trim() && !commits.trim() && !fullDiff.trim()) {
    // Local-only dirty tree with no commits ahead of base: still offer a minimal bag
    // so FE can create with --fill-ish title, but never dump full porcelain.
    const dirty = (await gitText(cwd, ["status", "--short"])) ?? "";
    if (!dirty.trim()) return null;
    const title =
      branch === "main" || branch === "master"
        ? "Update project"
        : branch.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Update project";
    return {
      title,
      body: ["## Summary", "Local working tree changes.", "", "## Test plan", "- [ ] Not run."].join("\n"),
      branch,
      base,
      status: dirty.slice(0, 500),
      stat: "",
      commits: "",
    };
  }
  const title =
    branch === "main" || branch === "master"
      ? (commits.split(/\r?\n/).find((line) => line.trim())?.replace(/^[a-f0-9]+\s+/i, "").trim()
        || "Update project")
      : branch.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Update project";
  const commitLines = commits
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((line) => `- ${line}`);
  // Cap body so gh/UI never re-display multi-MB command failures as pink text.
  let summaryBlock = stat.trim() || "Describe the changes in this PR.";
  if (summaryBlock.length > 4000) summaryBlock = `${summaryBlock.slice(0, 4000)}\n…`;
  const body = [
    "## Summary",
    summaryBlock,
    "",
    "## Recent commits",
    commitLines.length ? commitLines.join("\n") : "- No commits ahead of base.",
    "",
    "## Test plan",
    "- [ ] Not run.",
  ].join("\n");
  return { title, body, branch, base, status: "", stat: summaryBlock, commits };
}

/** Official createLocalPr failure residual. */
const CREATE_PR_AUTH_ERROR =
  "Could not create pull request. Check that gh is installed and authenticated.";

type SshSettingsFile = {
  configs?: Array<Record<string, unknown>>;
  trustedHosts?: string[];
};

function sshSettingsPath(): string {
  return path.join(app.getPath("userData"), "ssh-settings.json");
}

function expandHome(value: string): string {
  return value.replace(/^~(?=$|[\\/])/, app.getPath("home"));
}

async function loadSshSettings(): Promise<SshSettingsFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(sshSettingsPath(), "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function saveSshSettings(settings: SshSettingsFile): Promise<void> {
  const filePath = sshSettingsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2));
}

/**
 * Official Hd residual + product ssh_configs.json shape.
 * Prefer normalizeSessionSshConfig (sshHost/sshPort/remoteCwd aliases) and expose
 * both host-form and official sshHost-form fields on the bridge object.
 */
function normalizeSshConfig(value: unknown): Record<string, unknown> | null {
  const normalized = normalizeSessionSshConfig(value);
  if (!normalized) return null;
  return {
    ...asObject(value),
    host: normalized.host,
    hostName: normalized.hostName ?? normalized.host,
    user: normalized.user,
    port: normalized.port,
    identityFile: normalized.identityFile,
    proxyJump: normalized.proxyJump,
    remoteCwd: normalized.remoteCwd,
    // Official residual aliases (Hd / session.sshConfig / J$A ssh_configs entry).
    sshHost: normalized.sshHost ?? normalized.host,
    sshPort: normalized.sshPort ?? normalized.port,
    sshIdentityFile: normalized.sshIdentityFile ?? normalized.identityFile,
    name: normalized.name,
    id: normalized.id,
  };
}

function sessionSshConfigFromUnknown(value: unknown): SessionSshConfig | null {
  return normalizeSessionSshConfig(value);
}

/** Extract sshConfig from start() input (top-level, nested workspace, or official sshHost). */
function extractStartSshConfig(request: Record<string, unknown>): SessionSshConfig | null {
  const direct =
    sessionSshConfigFromUnknown(request.sshConfig)
    ?? sessionSshConfigFromUnknown(request);
  if (direct && (request.sshConfig || request.sshHost || request.host)) return direct;

  const workspace = asObject(request.workspace);
  const fromWorkspace =
    sessionSshConfigFromUnknown(workspace.sshConfig)
    ?? sessionSshConfigFromUnknown(workspace);
  if (fromWorkspace && (workspace.sshConfig || workspace.sshHost || workspace.mode === "ssh" || workspace.mode === "remote")) {
    // Prefer workspace.cwd as remoteCwd when not set on the config.
    if (!fromWorkspace.remoteCwd) {
      const cwd = asString(workspace.cwd) ?? asString(workspace.remoteCwd);
      if (cwd) fromWorkspace.remoteCwd = cwd;
    }
    return fromWorkspace;
  }

  // Bare sshHost on request (official startSession shape).
  if (asString(request.sshHost)) {
    return sessionSshConfigFromUnknown({
      sshHost: request.sshHost,
      sshPort: request.sshPort,
      sshIdentityFile: request.sshIdentityFile,
      remoteCwd: request.remoteCwd ?? request.cwd,
      host: request.sshHost,
      port: request.sshPort,
      identityFile: request.sshIdentityFile,
    });
  }
  return null;
}

function parseSshConfig(text: string): Array<Record<string, unknown>> {
  const configs: Array<Record<string, unknown>> = [];
  let current: Record<string, unknown> | null = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [keyRaw, ...rest] = trimmed.split(/\s+/);
    const key = keyRaw?.toLowerCase();
    const value = rest.join(" ");
    if (!key || !value) continue;
    if (key === "host") {
      current = { host: value, patterns: value.split(/\s+/), source: "ssh-config" };
      configs.push(current);
      continue;
    }
    if (!current) continue;
    if (key === "hostname") current.hostName = value;
    else if (key === "user") current.user = value;
    else if (key === "port") current.port = Number(value) || value;
    else if (key === "identityfile") current.identityFile = expandHome(value);
    else if (key === "proxyjump") current.proxyJump = value;
  }
  return configs;
}

async function readSystemSshConfigs(): Promise<Array<Record<string, unknown>>> {
  const filePath = path.join(app.getPath("home"), ".ssh", "config");
  try {
    return parseSshConfig(await fs.readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

function parseKnownHosts(text: string): string[] {
  const hosts = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    const hostField = parts[0]?.startsWith("@") ? parts[1] : parts[0];
    if (!hostField || hostField.startsWith("|")) continue;
    for (const host of hostField.split(",")) {
      const normalized = host.replace(/^\[([^\]]+)\]:(\d+)$/, "$1");
      if (normalized) hosts.add(normalized);
    }
  }
  return Array.from(hosts).sort();
}

async function readKnownSshHosts(): Promise<string[]> {
  const filePath = path.join(app.getPath("home"), ".ssh", "known_hosts");
  try {
    return parseKnownHosts(await fs.readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

function parseSshConfigOutput(text: string): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    const [key, ...rest] = line.trim().split(/\s+/);
    const value = rest.join(" ");
    if (!key || !value) continue;
    config[key] = key === "identityfile" ? expandHome(value) : value;
  }
  return config;
}

function parseSshGitRemote(remoteUrl: string | null): Record<string, unknown> | null {
  if (!remoteUrl) return null;
  const scp = remoteUrl.match(/^([^@]+)@([^:]+):(.+?)\/(.+?)(?:\.git)?$/);
  if (scp?.[1] && scp[2] && scp[3] && scp[4]) {
    return { user: scp[1], host: scp[2], owner: scp[3], repo: scp[4].replace(/\.git$/i, ""), remoteUrl };
  }
  const ssh = remoteUrl.match(/^ssh:\/\/([^@]+)@([^/]+)\/(.+?)\/(.+?)(?:\.git)?$/);
  if (ssh?.[1] && ssh[2] && ssh[3] && ssh[4]) {
    return { user: ssh[1], host: ssh[2], owner: ssh[3], repo: ssh[4].replace(/\.git$/i, ""), remoteUrl };
  }
  return null;
}

function gitDiffArgs(base: unknown, extra: string[] = []): string[] {
  if (Array.isArray(base)) return base.map(String);
  const ref = asString(base) ?? "HEAD";
  return ref ? [ref, ...extra] : extra;
}

function cwdFromSession(store: LocalSessionStore, sessionIdOrCwd: unknown): string | null {
  const raw = asString(sessionIdOrCwd);
  if (!raw) return store.getAll(true)[0]?.cwd ?? process.cwd();
  const sessionKey = raw.includes("::") ? (raw.split("::", 1)[0] ?? raw) : raw;
  const session = store.getSession(sessionKey);
  if (session?.cwd) return session.cwd;
  if (path.isAbsolute(raw) || raw.startsWith("~") || raw.includes(path.sep)) return raw;
  return store.getAll(true).find((item) => item.cwd)?.cwd ?? process.cwd();
}

/**
 * Host-loop shell / CLI spawn cwd must exist on the host filesystem.
 * Session.cwd may be a dual-exec guest path like `/sessions/<id>/…` (not present on macOS host);
 * node-pty then exits immediately → UI "Shell exited." (Views Terminal).
 * Align with claudeCliRunner.resolveCwd: only keep existing dirs; else process.cwd().
 */
function shellPtyCwdFromSession(store: LocalSessionStore, sessionId: string): string {
  const separator = sessionId.indexOf("::");
  const baseId = separator === -1 ? sessionId : sessionId.slice(0, separator);
  const session = store.getSession(baseId);
  const candidates = [
    session?.cwd,
    ...(Array.isArray(session?.folders) ? session.folders : []),
    ...(Array.isArray(session?.userSelectedFolders) ? session.userSelectedFolders : []),
  ];
  for (const candidate of candidates) {
    const raw = asString(candidate);
    if (!raw) continue;
    try {
      if (fsSync.existsSync(raw) && fsSync.statSync(raw).isDirectory()) return raw;
    } catch {
      // try next candidate
    }
  }
  return process.cwd();
}

/** Official c119 vN / writeSessionFile use content hash for Edit enablement + conflict. */
function contentHash(contents: string) {
  return crypto.createHash("sha256").update(contents, "utf8").digest("hex");
}

async function readText(filePath: string) {
  const stat = await fs.stat(filePath);
  // Official file pane only opens files (c119 eS: dirs expand, files onPreview).
  // Never fs.readFile a directory — Node throws EISDIR and IPC surfaces a raw remote error.
  if (stat.isDirectory()) {
    return {
      path: filePath,
      absPath: filePath,
      isDirectory: true,
      error: "Cannot preview a directory",
    };
  }
  if (!stat.isFile()) {
    return {
      path: filePath,
      absPath: filePath,
      error: "Not a regular file",
    };
  }
  if (stat.size > TEXT_LIMIT_BYTES) {
    return { path: filePath, absPath: filePath, size: stat.size, tooLarge: true };
  }
  // Official epitaxy-file payload: { contents, absPath, hash } so vN F (Edit) can enable.
  const contents = await fs.readFile(filePath, "utf8");
  return {
    path: filePath,
    absPath: filePath,
    contents,
    hash: contentHash(contents),
  };
}

async function listDirectory(target: string) {
  const entries = await fs.readdir(target, { withFileTypes: true });
  return Promise.all(entries.map(async (entry) => {
    const filePath = path.join(target, entry.name);
    const stat = await fs.stat(filePath);
    return { name: entry.name, path: filePath, isFile: entry.isFile(), isDirectory: entry.isDirectory(), size: stat.size, modifiedAt: stat.mtime.toISOString() };
  }));
}

async function getWorkspaceCodeStats(cwd: string | null) {
  if (!cwd) return { files: 0, lines: 0, bytes: 0, byExtension: {} };
  const tracked = await runGit(cwd, ["ls-files"]);
  const files = tracked.ok ? String(tracked.stdout ?? "").split(/\r?\n/).filter(Boolean).slice(0, 2000) : [];
  const byExtension: Record<string, { files: number; lines: number; bytes: number }> = {};
  let lines = 0;
  let bytes = 0;
  for (const relative of files) {
    const filePath = path.resolve(cwd, relative);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const text = await fs.readFile(filePath, "utf8");
      const ext = path.extname(filePath).slice(1) || "plain";
      const lineCount = text.length === 0 ? 0 : text.split(/\r?\n/).length;
      byExtension[ext] ??= { files: 0, lines: 0, bytes: 0 };
      byExtension[ext].files += 1;
      byExtension[ext].lines += lineCount;
      byExtension[ext].bytes += stat.size;
      lines += lineCount;
      bytes += stat.size;
    } catch {
      // Ignore unreadable/binary files.
    }
  }
  return { files: files.length, lines, bytes, byExtension };
}

async function detectedProject(cwd: string) {
  const resolved = path.resolve(cwd);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }
  const rootResult = await runGit(resolved, ["rev-parse", "--show-toplevel"]);
  const root = rootResult.ok ? String(rootResult.stdout ?? "").trim() || resolved : resolved;
  const branchResult = await runGit(root, ["branch", "--show-current"]);
  const branch = branchResult.ok ? String(branchResult.stdout ?? "").trim() || undefined : undefined;
  return {
    id: root,
    name: path.basename(root),
    cwd: root,
    root,
    branch,
    hasGit: rootResult.ok,
    folders: [root],
    source: "local",
  };
}

async function getDetectedProjects(store: LocalSessionStore) {
  const candidates = [
    process.cwd(),
    ...store.getAll(true).flatMap((session) => [session.cwd, ...(session.folders ?? []), ...(session.userSelectedFolders ?? [])]),
  ].filter((item): item is string => Boolean(item));
  const projects = new Map<string, Awaited<ReturnType<typeof detectedProject>>>();
  for (const candidate of [...new Set(candidates)]) {
    const project = await detectedProject(candidate);
    if (project) projects.set(project.root, project);
  }
  return Array.from(projects.values()).filter((project): project is NonNullable<typeof project> => Boolean(project));
}

function dateKey(value: string | number | Date | undefined): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function emptyModelUsage() {
  return { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, inputTokens: 0, outputTokens: 0 };
}

type ModelUsage = ReturnType<typeof emptyModelUsage>;

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function usageFromTranscriptItem(value: unknown): ModelUsage {
  const raw = asObject(value);
  const message = asObject(raw.message);
  const usage = asObject(raw.usage ?? message.usage);
  return {
    cacheCreationInputTokens: numberValue(usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens),
    cacheReadInputTokens: numberValue(usage.cacheReadInputTokens ?? usage.cache_read_input_tokens),
    inputTokens: numberValue(usage.inputTokens ?? usage.input_tokens),
    outputTokens: numberValue(usage.outputTokens ?? usage.output_tokens),
  };
}

function addUsage(target: ModelUsage, usage: ModelUsage): void {
  target.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  target.cacheReadInputTokens += usage.cacheReadInputTokens;
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
}

function hasUsage(usage: ModelUsage): boolean {
  return usage.cacheCreationInputTokens + usage.cacheReadInputTokens + usage.inputTokens + usage.outputTokens > 0;
}

function transcriptItems(value: unknown): unknown[] {
  const raw = asObject(value);
  const message = asObject(raw.message);
  if (Array.isArray(raw.items)) return raw.items;
  if (Array.isArray(raw.content)) return raw.content;
  if (Array.isArray(message.content)) return message.content;
  return [];
}

function countToolUses(transcript: unknown[]): number {
  let count = 0;
  for (const item of transcript) {
    for (const content of transcriptItems(item)) {
      const raw = asObject(content);
      if (raw.type === "tool_use" || raw.kind === "tool_use") count += 1;
    }
  }
  return count;
}

function contextUsageFromTranscript(transcript: unknown[]) {
  const usage = emptyModelUsage();
  for (const item of transcript) addUsage(usage, usageFromTranscriptItem(item));
  const totalTokens = usage.cacheCreationInputTokens + usage.cacheReadInputTokens + usage.inputTokens + usage.outputTokens;
  return { ...usage, messages: transcript.length, toolCallCount: countToolUses(transcript), totalTokens };
}

/**
 * Official LocalSessions.getCodeStats residual (app.asar Yit / D7i):
 * scan ~/.claude/projects jsonl (+ stats-cache.json prefix), not userData code-sessions.
 * `store` kept for signature parity with older product callers.
 */
async function getSessionUsageCodeStats(_store: LocalSessionStore) {
  try {
    return await getOfficialCodeStats();
  } catch (error) {
    console.error("LocalSessions.getCodeStats failed", error);
    return null;
  }
}

function sessionFileRoot(store: LocalSessionStore, sessionId: string): string {
  const root = path.join(store.getOutputsDir(), sessionId);
  return root;
}

function resolveSessionFile(store: LocalSessionStore, sessionId: string, relativePath: string): string | null {
  const root = sessionFileRoot(store, sessionId);
  const target = path.resolve(root, relativePath || ".");
  return target.startsWith(root) ? target : null;
}

function resolveSessionOrWorkspaceFile(store: LocalSessionStore, sessionId: string, filePath: string): string | null {
  if (path.isAbsolute(filePath)) return filePath;
  const cwd = cwdFromSession(store, sessionId);
  if (cwd) return path.resolve(cwd, filePath);
  return resolveSessionFile(store, sessionId, filePath);
}

function mimeTypeForFile(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".apng": return "image/apng";
    case ".avif": return "image/avif";
    case ".gif": return "image/gif";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".svg": return "image/svg+xml";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

function configuredMcpServers(context: IpcHandlerContext): Array<[string, unknown]> {
  return mcpConfigEntries(context.settings.getMcpServersConfig());
}

function mcpServerConfig(context: IpcHandlerContext, serverName: unknown): { name: string; config: unknown } | null {
  const name = asString(serverName);
  if (!name) return null;
  const entry = configuredMcpServers(context).find(([candidate]) => candidate === name);
  return entry ? { name: entry[0], config: entry[1] } : null;
}

function planContentItem(value: unknown): { name?: string; input: Record<string, unknown> } | null {
  const raw = asObject(value);
  const type = asString(raw.type) ?? asString(raw.kind);
  if (type !== "tool_use") return null;
  return {
    name: asString(raw.name) ?? asString(raw.tool_name) ?? undefined,
    input: asObject(raw.input),
  };
}

function applyPlanEdit(content: string, input: Record<string, unknown>): string {
  const oldString = asString(input.old_string) ?? asString(input.oldString);
  const newString = asString(input.new_string) ?? asString(input.newString);
  if (oldString === null || newString === null) return content;
  if (input.replace_all === true || input.replaceAll === true) return content.split(oldString).join(newString);
  const index = content.indexOf(oldString);
  return index >= 0 ? `${content.slice(0, index)}${newString}${content.slice(index + oldString.length)}` : content;
}

/**
 * Official XN (c11959232): writeEdits ?? exitPlan — Write/Edit/MultiEdit under first
 * `/.claude/plans/` path preferred over ExitPlanMode input.plan.
 */
function planFromTranscript(transcript: unknown[]): { content?: string; path?: string } | null {
  let exitPlan: string | undefined;
  let writeEdits: string | undefined;
  let planPath: string | undefined;
  for (const entry of transcript) {
    const raw = asObject(entry);
    if (raw.type !== "assistant" || raw.parent_tool_use_id || raw.parentToolUseId) continue;
    for (const item of transcriptItems(raw)) {
      const tool = planContentItem(item);
      if (!tool) continue;
      if (tool.name === "ExitPlanMode") {
        exitPlan = asString(tool.input.plan) ?? exitPlan;
        continue;
      }
      const filePath = asString(tool.input.file_path) ?? asString(tool.input.filePath);
      if (!filePath || !filePath.replace(/\\/g, "/").includes("/.claude/plans/")) continue;
      planPath ??= filePath;
      if (tool.name === "Write") writeEdits = asString(tool.input.content) ?? writeEdits;
      else if (tool.name === "Edit" && writeEdits !== undefined) writeEdits = applyPlanEdit(writeEdits, tool.input);
      else if (tool.name === "MultiEdit" && Array.isArray(tool.input.edits) && writeEdits !== undefined) {
        for (const edit of tool.input.edits) writeEdits = applyPlanEdit(writeEdits, asObject(edit));
      }
    }
  }
  const content = writeEdits ?? exitPlan;
  return content || planPath ? { content, path: planPath } : null;
}

function createSessionHandlers(
  store: LocalSessionStore,
  context: IpcHandlerContext,
  allMethods: readonly string[],
): InterfaceHandlers {
  const ptys = new Map<string, { terminal: { pid: number; write: (data: string) => void; kill: (signal?: string) => void; resize?: (cols: number, rows: number) => void }; buffer: string }>();
  const handlers: InterfaceHandlers = {};
  const events = originalEventSurface(context);

  const dispatchBridgeSessionEvent = (event: Record<string, unknown>) => {
    events.localSessionEvent(event);
  };

  /** Live read of bypass pref for bridge clamp (Mode pill vs spawn parity). */
  const bypassBridgeOpts = () => ({
    bypassPermissionsModeEnabled:
      asObject(context.settings.getPreferences()).bypassPermissionsModeEnabled === true,
  });
  const bridgeSession = (session: unknown) => toBridgeSession(session, bypassBridgeOpts());
  const bridgeSessions = (sessions: unknown[]) =>
    toBridgeSessions(sessions, bypassBridgeOpts());

  const dispatchSessionEvent = (type: string, sessionId?: string, session?: unknown) => {
    dispatchBridgeSessionEvent({ type, sessionId, session: bridgeSession(session) });
  };

  const sessionRunner = getLocalSessionRunner(context);

  /**
   * Residual SessionSummary (app.asar LocalSessionManager):
   * emits session_summary_result / session_summary_error on LocalSessions event bus.
   */
  const sessionSummaryService = new CodeSessionSummaryService({
    emit: (event) => {
      dispatchBridgeSessionEvent({
        type: event.type,
        sessionId: event.sessionId,
        data: event.data,
        error: event.error,
      });
    },
  });

  /**
   * Official LocalSessionManager.getAllSessions residual:
   * list comes from userData session store only (metadata). Never scan/read
   * ~/.claude/projects/*.jsonl here — that is on-demand getTranscript only.
   * CLI sessions enter the list via desktop start/import (importCliSession), not bulk scan.
   */
  /**
   * Official residual: trusted dirs live in preferences `localAgentModeTrustedFolders`
   * (CoworkTrustedFolders), same bag as LocalAgentModeSessions. Never invent a
   * sidebar session titled "Trusted folders" (old LocalSessionStore bug).
   */
  const trustedFolders = new CoworkTrustedFolders(context.settings);
  // One-shot: lift legacy per-session trustedFolders + drop ghost trust sessions.
  for (const legacy of store.getTrustedFolders()) {
    trustedFolders.add(legacy);
  }
  store.purgeGhostTrustedFoldersSessions();

  /**
   * Durable store only. Ghost "Trusted folders" trust-storage rows never list.
   * CLI sessions enter via desktop start/import (importCliSession), not bulk scan.
   */
  const listStoredSessions = (): unknown[] =>
    store
      .getAll(true)
      .filter((session: LocalSession) => !LocalSessionStore.isGhostTrustedFoldersSession(session));

  const sendCodeMessage: IpcHandler = async (_event, id, text, images, permissionMode, messageUuid, options) => {
    const sessionId = asString(id);
    const request = asObject(options);
    const userSelectedFiles = stringArray(request.userSelectedFiles);
    const rawMessageUuid = asString(messageUuid);
    const messageRaw = userSelectedFiles.length > 0 || rawMessageUuid ? {
      ...(rawMessageUuid ? { messageUuid: rawMessageUuid } : {}),
      ...(userSelectedFiles.length > 0 ? { userSelectedFiles } : {}),
    } : undefined;
    const session = sessionId && typeof text === "string" ? store.sendMessage(sessionId, text, "user", messageRaw) : null;
    if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
    if (sessionId && session && typeof text === "string") {
      // Prefer explicit send mode; otherwise host session.permissionMode (web often omits).
      // Omit key when neither is set so runTurn/buildClaudeArgs uses session fallback cleanly.
      const explicitMode = asString(permissionMode);
      const sessionMode =
        typeof session.permissionMode === "string" && session.permissionMode.length > 0
          ? session.permissionMode
          : undefined;
      sessionRunner.runTurn(sessionId, text, {
        images,
        messageUuid: asString(messageUuid),
        ...(explicitMode || sessionMode ? { permissionMode: explicitMode ?? sessionMode } : {}),
        userSelectedFiles,
      });
    }
    return bridgeSession(sessionId ? store.getSession(sessionId) ?? session : session);
  };

  const startDiffReview = async (cwdOrSession: unknown, options: unknown, title: string) => {
    const request = { ...asObject(cwdOrSession), ...asObject(options) };
    const cwdTarget = asString(cwdOrSession) ?? asString(request.sessionId) ?? asString(request.cwd);
    const cwd = cwdFromSession(store, cwdTarget);
    if (!cwd) return { ok: false, error: "missing cwd" };
    const base = request.base ?? request.baseRef ?? request.ref ?? "HEAD";
    const diff = await runGitInRepository(cwd, ["diff", ...gitDiffArgs(base)]);
    if (!diff.ok) return diff;
    const diffText = String(diff.stdout ?? "").trim();
    if (!diffText) return { ok: false, error: "empty_diff", cwd };
    const clippedDiff = diffText.length > 200_000 ? `${diffText.slice(0, 200_000)}\n\n[diff truncated]` : diffText;
    const prompt = asString(request.prompt) ?? [
      "Review this local git diff. Focus on correctness, regressions, security, and missing tests.",
      "",
      "```diff",
      clippedDiff,
      "```",
    ].join("\n");
    // Residual O.tags includes "ultrareview" for oi init chrome (c119 ri).
    // Residual TM (we=gw) needs system hook_progress/hook_response with
    // <remote-review-progress> from CCR bughunter SessionStart (run_hunt.sh) —
    // NOT from a plain local review turn. Product deliberately does not invent Mx /
    // remote CCR (云端不要); this path only tags + local diff prompt so oi chrome
    // can mount. Real hook stdout is retained if/when CLI emits it (hookBookends).
    const isUltrareview = /ultrareview/i.test(title) || originLooksUltrareview(request);
    const session = store.start({
      cwd,
      prompt,
      title,
      origin: "diff-review",
      permissionMode: "default",
      tags: isUltrareview ? ["ultrareview"] : ["diff-review"],
    });
    dispatchSessionEvent("start", session.id, session);
    sessionRunner.runTurn(session.id, prompt, { cwd, origin: "diff-review" });
    return bridgeSession(session);
  };

  function originLooksUltrareview(request: Record<string, unknown>): boolean {
    const tag = request.tag ?? request.mode ?? request.kind;
    if (typeof tag === "string" && /ultrareview/i.test(tag)) return true;
    if (Array.isArray(request.tags) && request.tags.some((t) => typeof t === "string" && /ultrareview/i.test(t))) {
      return true;
    }
    return false;
  }

  const getTeleportReadinessFor = async (sessionOrCwd: unknown) => {
    const sessionId = asString(sessionOrCwd) && store.getSession(asString(sessionOrCwd)!) ? asString(sessionOrCwd) : asString(asObject(sessionOrCwd).sessionId);
    const session = sessionId ? store.getSession(sessionId) : null;
    const cwd = cwdFromSession(store, sessionId ?? sessionOrCwd);
    const checks: Array<Record<string, unknown>> = [];
    checks.push({ name: "session", ok: Boolean(session || cwd), sessionId });
    checks.push({ name: "cwd", ok: Boolean(cwd), cwd });
    const gitRoot = cwd ? await runGit(cwd, ["rev-parse", "--show-toplevel"]) : { ok: false, stderr: "missing cwd" };
    const gitRootOutput = asObject(gitRoot);
    checks.push({
      name: "git",
      ok: gitRoot.ok,
      root: gitRoot.ok ? String(gitRootOutput.stdout ?? "").trim() : undefined,
      warning: gitRoot.ok ? undefined : String(gitRootOutput.stderr ?? ""),
    });
    const ready = checks.every((check) => check.ok !== false);
    return {
      ready,
      mode: "local-handoff",
      cloudAvailable: false,
      reason: ready ? undefined : "workspace_not_ready",
      sessionId,
      cwd,
      checks,
    };
  };

  const teleportToLocalHandoff = async (sessionOrCwd: unknown, options: unknown) => {
    const readiness = await getTeleportReadinessFor(sessionOrCwd);
    if (!readiness.ready) return { success: false, readiness };
    const sourceId = readiness.sessionId;
    const source = sourceId ? store.getSession(sourceId) : null;
    const transcript = sourceId ? await store.getTranscript(sourceId) : [];
    const summary = transcript.map(textFromTranscriptItem).filter(Boolean).slice(-12).join("\n").slice(0, 8000);
    const request = asObject(options);
    const prompt = asString(request.prompt) ?? [
      "Continue this session from a local handoff. Preserve the original context and workspace.",
      source ? `Source session: ${source.title} (${source.id})` : undefined,
      readiness.cwd ? `Workspace: ${readiness.cwd}` : undefined,
      summary ? `Recent transcript:\n${summary}` : undefined,
    ].filter(Boolean).join("\n\n");
    const session = store.start({
      cwd: readiness.cwd ?? undefined,
      folders: readiness.cwd ? [readiness.cwd] : undefined,
      kind: source?.kind,
      model: source?.model,
      effort: source?.effort,
      permissionMode: source?.permissionMode,
      prompt,
      title: asString(request.title) ?? (source ? `${source.title} handoff` : "Cloud handoff"),
      origin: "teleport-local-handoff",
    } as never);
    const updated = store.update(session.id, {
      metadata: { ...(session.metadata ?? {}), sourceSessionId: sourceId, teleportMode: "local-handoff" },
    });
    dispatchSessionEvent("start", session.id, updated ?? session);
    sessionRunner.runTurn(session.id, prompt, { cwd: readiness.cwd, origin: "teleport-local-handoff" });
    return { success: true, localOnly: true, mode: "local-handoff", session: bridgeSession(updated ?? session), readiness };
  };

  const shellPtyBaseSessionId = (sessionId: string) => {
    const separator = sessionId.indexOf("::");
    return separator === -1 ? sessionId : sessionId.slice(0, separator);
  };

  const appendPtyData = (sessionId: string, data: Buffer | string) => {
    const entry = ptys.get(sessionId);
    if (!entry) return;
    const text = typeof data === "string" ? data : data.toString("utf8");
    entry.buffer += text;
    if (entry.buffer.length > TEXT_LIMIT_BYTES) entry.buffer = entry.buffer.slice(-TEXT_LIMIT_BYTES);
    dispatchBridgeSessionEvent({ type: "shell_pty_data", sessionId, data: text });
  };

  const startShell = (sessionId: string, cols?: number, rows?: number) => {
    const existing = ptys.get(sessionId);
    if (existing) {
      existing.terminal.resize?.(cols ?? 80, rows ?? 24);
      return { ok: true, buffered: existing.buffer };
    }

    const baseId = shellPtyBaseSessionId(sessionId);
    const session = store.getSession(baseId);
    const nodePty = loadOriginalNodePty();
    if (!nodePty) {
      return { ok: false, error: "node-pty runtime unavailable" };
    }

    // Official residual: local shell PTY uses node-pty on host cwd.
    // SSH sessions: host-pipe `ssh -tt` into remoteCwd (product subset — official full
    // path keeps shell local unless remote harness; we honor session.sshConfig here so
    // Terminal pane works for SSH Code sessions).
    try {
      let terminal: ReturnType<NonNullable<typeof nodePty>["spawn"]>;
      let cwdLabel: string;
      if (session?.sshConfig) {
        const remoteCwd = resolveSshRemoteCwd(session);
        const remoteLogin = `cd ${shellQuote(remoteCwd)} 2>/dev/null || cd ~; exec "$SHELL" -l`;
        const remoteCommand = `sh -c ${shellQuote(remoteLogin)}`;
        const argv = buildSshArgv(session.sshConfig, remoteCommand, {
          batchMode: false,
          forceTty: true,
          connectTimeoutSeconds: 30,
        });
        cwdLabel = `ssh://${session.sshConfig.host}:${remoteCwd}`;
        terminal = nodePty.spawn("ssh", argv, {
          name: "xterm-256color",
          cols: cols ?? 80,
          rows: rows ?? 24,
          cwd: process.cwd(),
          env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        });
      } else {
        // Must be an existing host directory. Guest dual-exec paths (/sessions/…) are not
        // host-loop PTY cwd — node-pty exits with code 1 → "Shell exited."
        const cwd = shellPtyCwdFromSession(store, sessionId);
        const shell = defaultShell();
        cwdLabel = cwd;
        terminal = nodePty.spawn(shell.file, shell.args, {
          name: "xterm-256color",
          cols: cols ?? 80,
          rows: rows ?? 24,
          cwd,
          env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        });
      }
      ptys.set(sessionId, { terminal, buffer: "" });
      terminal.onData((data) => appendPtyData(sessionId, data));
      terminal.onExit(({ exitCode, signal }) => {
        dispatchBridgeSessionEvent({ type: "shell_pty_close", sessionId, code: exitCode, signal });
        ptys.delete(sessionId);
      });
      return { ok: true, buffered: "", cwd: cwdLabel };
    } catch (error) {
      console.warn("[local-sessions] node-pty spawn failed", error);
      return { ok: false, error: error instanceof Error ? error.message : "Failed to start shell" };
    }
  };

  const checkPtyAlive = (sessionId: string): { alive: boolean; pid?: number } => {
    const entry = ptys.get(sessionId);
    if (!entry) return { alive: false };
    try {
      // Signal 0 checks process existence without killing it
      process.kill(entry.terminal.pid, 0);
      return { alive: true, pid: entry.terminal.pid };
    } catch {
      // Process no longer exists — clean up stale entry
      ptys.delete(sessionId);
      return { alive: false };
    }
  };

  const realHandlers: InterfaceHandlers = {
    getAll: async () => bridgeSessions(listStoredSessions()),
    getSession: async (_event, id) => (asString(id) ? bridgeSession(store.getSession(asString(id)!)) : null),
    getTranscript: async (_event, id) => (asString(id) ? await store.getTranscript(asString(id)!) : []),
    start: async (_event, input) => {
      const request = asObject(input);
      const sshConfig = extractStartSshConfig(request);
      // Official startSession: when sshConfig present, cwd is remote (remoteCwd).
      const remoteCwd = sshConfig
        ? (asString(request.cwd) ?? sshConfig.remoteCwd ?? asString(asObject(request.workspace).cwd) ?? undefined)
        : undefined;
      if (sshConfig && remoteCwd && !sshConfig.remoteCwd) sshConfig.remoteCwd = remoteCwd;

      // Always normalize/clear sshConfig: spreading raw request would keep invalid
      // empty-host objects and force claude-cli-ssh spawn (verifier FAIL).
      const startInput: Record<string, unknown> = {
        ...request,
        sshConfig: sshConfig ?? undefined,
      };
      if (!sshConfig) {
        delete startInput.sshConfig;
      } else {
        startInput.cwd = remoteCwd ?? sshConfig.remoteCwd ?? asString(request.cwd) ?? undefined;
        startInput.originCwd =
          asString(request.originCwd)
          ?? remoteCwd
          ?? sshConfig.remoteCwd
          ?? asString(request.cwd)
          ?? undefined;
      }
      // Official clamp: startSession permissionMode respects bypassPermissionsModeEnabled.
      const bypassOk =
        asObject(context.settings.getPreferences()).bypassPermissionsModeEnabled === true;
      if (typeof startInput.permissionMode === "string") {
        startInput.permissionMode = clampCodePermissionMode(
          startInput.permissionMode,
          bypassOk,
        );
      }
      const session = store.start(startInput as never);
      dispatchSessionEvent("start", session.id, session);
      const prompt = asString(request.prompt) ?? asString(request.message) ?? "";
      const userSelectedFiles = stringArray(request.userSelectedFiles);
      // Official: worktree lease before first turn when useWorktree is set
      // (createLocalWorktree uses chillingSlothLocation + ccBranchPrefix).
      if (session.useWorktree || session.worktreeName) {
        await store.ensureWorktreeResolved(session.id);
      }
      if (prompt || userSelectedFiles.length > 0) {
        // Re-read store so clamped permissionMode on the session is what spawn sees
        // (request may omit mode; web start still puts it on startInput when present).
        const live = store.getSession(session.id) ?? session;
        sessionRunner.runTurn(session.id, prompt, {
          ...request,
          permissionMode:
            asString(request.permissionMode)
            ?? (typeof live.permissionMode === "string" ? live.permissionMode : undefined),
          userSelectedFiles: userSelectedFiles.length > 0 ? userSelectedFiles : undefined,
        });
      }
      const scheduledTaskId = asString(request.scheduledTaskId);
      if (scheduledTaskId) {
        const task = context.scheduledTasks.recordRun(scheduledTaskId);
        const payload = { id: scheduledTaskId, status: "ran", source: "manual", sessionId: session.id, task };
        dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", "CCDScheduledTasks", "onScheduledTaskEvent", payload);
        dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", "CoworkScheduledTasks", "onScheduledTaskEvent", payload);
      }
      return bridgeSession(store.getSession(session.id) ?? session);
    },
    importCliSession: async (_event, input) => {
      const session = store.importSession(asObject(input) as never);
      dispatchSessionEvent("start", session.id, session);
      return bridgeSession(session);
    },
    updateSession: async (_event, id, input) => {
      const sessionId = asString(id);
      const session = sessionId ? store.update(sessionId, asObject(input) as never) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return bridgeSession(session);
    },
    sendMessage: sendCodeMessage,
    sendSideChatMessage: async (_event, id, text) => {
      const sessionId = asString(id);
      const session = sessionId && typeof text === "string" ? store.sendMessage(sessionId, text, "user") : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      if (sessionId && session && typeof text === "string") sessionRunner.runTurn(sessionId, text);
      return bridgeSession(session);
    },
    forkSession: async (_event, id, messageId) => {
      const sessionId = asString(id);
      const session = sessionId ? await store.fork(sessionId, asString(messageId) ?? undefined) : null;
      if (session) dispatchSessionEvent("start", session.id, session);
      return bridgeSession(session);
    },
    archive: async (_event, id) => {
      const sessionId = asString(id);
      const ok = sessionId ? store.archive(sessionId) : false;
      if (ok && sessionId) dispatchSessionEvent("archived", sessionId);
      return ok;
    },
    unarchive: async (_event, id) => {
      const sessionId = asString(id);
      const ok = sessionId ? store.unarchive(sessionId) : false;
      if (ok && sessionId) dispatchSessionEvent("unarchived", sessionId, store.getSession(sessionId));
      return ok;
    },
    delete: async (_event, id) => {
      const sessionId = asString(id);
      const ok = sessionId ? store.delete(sessionId) : false;
      if (ok && sessionId) dispatchSessionEvent("deleted", sessionId);
      return ok;
    },
    clearSession: async (_event, id) => {
      const sessionId = asString(id);
      const ok = sessionId ? store.clearSession(sessionId) : false;
      if (ok && sessionId) dispatchSessionEvent("cleared", sessionId, store.getSession(sessionId));
      return ok;
    },
    stop: async (_event, id) => {
      const sessionId = asString(id);
      if (sessionId) sessionRunner.stop(sessionId);
      const ok = sessionId ? store.stop(sessionId) : false;
      if (ok && sessionId) dispatchSessionEvent("stopped", sessionId, store.getSession(sessionId));
      return ok;
    },
    interrupt: async (_event, id) => {
      const sessionId = asString(id);
      if (!sessionId) return false;
      // Official Wr mutationFn: transport.stop prefers LocalSessions.interrupt
      // (interruptSession), not stopSession. Success keeps the process + queue.
      const result = await sessionRunner.interrupt(sessionId);
      if (result.continued) return true;
      const ok = store.stop(sessionId);
      if (ok) dispatchSessionEvent("stopped", sessionId, store.getSession(sessionId));
      return ok;
    },
    // Official densable Host Tasks Stop: control_request stop_task only — never session stop.
    // UI echoPending is web Xr residual; durable bookend is CLI dual-emit on stdout.
    stopTask: async (_event, id, taskId) => {
      const sessionId = asString(id);
      const targetTaskId = asString(taskId);
      if (!sessionId || !targetTaskId) {
        return { ok: false, status: "failed", error: "sessionId and taskId are required" };
      }
      const result = await sessionRunner.stopTask(sessionId, targetTaskId);
      // No host-stop invent; no session_stopped. CLI task_notification closes bookends.
      return {
        ok: result.status === "informed",
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
      };
    },
    /**
     * Title/cwd/message filter first; when query ≥ 2 chars also search CLI jsonl
     * body via TranscriptSearchWorkerHost (yHi residual) for sessions with paths.
     */
    searchSessions: async (_event, query) => {
      const raw = String(query ?? "");
      const titleHits = store.search(raw);
      const needle = raw.trim();
      if (needle.length < 2) return titleHits;

      const titleIds = new Set(titleHits.map((session) => session.id));
      const candidates = store.getAll(true).filter(
        (session) => !titleIds.has(session.id) && Boolean(session.cliSessionId),
      );
      if (candidates.length === 0) return titleHits;

      const searchSessions: TranscriptSearchSession[] = [];
      for (const session of candidates) {
        const transcriptPath = await resolveCodeTranscriptPath(session.cliSessionId, {
          cwd: session.cwd,
          worktreePath: session.worktreePath,
          originCwd: session.originCwd,
        });
        if (!transcriptPath) continue;
        searchSessions.push({
          sessionId: session.id,
          transcriptPath,
          lastActivityAt: session.lastActivityAt ?? session.updatedAt,
        });
      }
      if (searchSessions.length === 0) return titleHits;

      try {
        const hits = await getTranscriptSearchWorkerHost().search(needle, searchSessions, {
          limit: 50,
        });
        if (hits.length === 0) return titleHits;
        const hitIds = new Set(hits.map((hit) => hit.sessionId));
        const bodyHits = store
          .getAll(true)
          .filter((session) => hitIds.has(session.id) && !titleIds.has(session.id));
        return [...titleHits, ...bodyHits];
      } catch (error) {
        console.warn("[LocalSessions.searchSessions] transcript body search failed", error);
        return titleHits;
      }
    },
    addDirectories: async (_event, id, directories) => {
      const sessionId = asString(id);
      const session = sessionId ? store.addFolders(sessionId, directories) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return bridgeSession(session);
    },
    addFolderToSession: async (_event, id, folder) => {
      const sessionId = asString(id);
      const session = sessionId ? store.addFolders(sessionId, [folder]) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return bridgeSession(session);
    },
    addTrustedFolder: async (_event, folder) => {
      const target = asString(folder);
      if (!target) return false;
      // Preferences bag — not a synthetic Code session (see CoworkTrustedFolders).
      trustedFolders.add(target);
      return true;
    },
    removeTrustedFolder: async (_event, folder) => {
      const target = asString(folder);
      if (!target) return false;
      trustedFolders.remove(target);
      store.removeTrustedFolder(target); // legacy session field cleanup
      return true;
    },
    getTrustedFolders: async () => trustedFolders.getAll(),
    isFolderTrusted: async (_event, folder) => {
      const target = asString(folder);
      return Boolean(target && trustedFolders.isTrusted(target));
    },
    checkTrust: async (_event, folder) => {
      const target = asString(folder);
      const trusted = Boolean(target && trustedFolders.isTrusted(target));
      return { trusted, sources: trusted ? ["preferences"] : [] };
    },
    checkPty: async (_event, sessionId) => checkPtyAlive(asString(sessionId) ?? ""),
    checkRemoteTrust: async (_event, sshConfigRaw, folder) => {
      const sshConfig = sessionSshConfigFromUnknown(sshConfigRaw);
      const remoteFolder = asString(folder) ?? sshConfig?.remoteCwd ?? "~";
      if (!sshConfig) return { trusted: false, remote: true, sources: [] };
      // Official: remote trust key is `ssh:${sshHost}:${folder}`. Without a full
      // trust store, probe path existence over SSH and treat known_hosts/app
      // trustedHosts as the trust source (BatchMode success ⇒ host keys accepted).
      const settings = await loadSshSettings();
      const trustedHosts = Array.isArray(settings.trustedHosts)
        ? settings.trustedHosts.filter((host): host is string => typeof host === "string")
        : [];
      const host = sshConfig.host;
      const known = await readKnownSshHosts();
      const hostTrusted = trustedHosts.includes(host) || known.includes(host) || known.includes(sshConfig.hostName || host);
      const probe = await defaultExecSsh(
        sshConfig,
        `sh -c ${shellQuote(`test -e ${shellQuote(remoteFolder)} || test -e ~`)}`,
      );
      if (probe.exitCode !== 0) {
        return { trusted: false, remote: true, sources: [], error: probe.stderr || "ssh_probe_failed" };
      }
      return {
        trusted: hostTrusted,
        remote: true,
        sources: hostTrusted ? ["ssh-host"] : [],
        host,
        folder: remoteFolder,
      };
    },
    saveTrust: async (_event, folder) => {
      const target = asString(folder);
      if (!target) return false;
      // Official residual: preferences localAgentModeTrustedFolders — never a sidebar session.
      trustedFolders.add(target);
      return true;
    },
    getSessionsForScheduledTask: async (_event, scheduledTaskId) => {
      const id = asString(scheduledTaskId) ?? asString(asObject(scheduledTaskId).scheduledTaskId);
      return id ? bridgeSessions(store.getSessionsForScheduledTask(id)) : [];
    },
    getSupportedCommands: async (_event, request) => getSupportedCommands(store, asObject(request)),
    // Official custom-3p residual: getSessionsBridgeEnabled → true; yit status bag.
    getSessionsBridgeEnabled: async () => {
      const prefs = context.settings.getPreferences() as Record<string, unknown>;
      return getSessionsBridgeEnabled(identityFromSettingsPrefs(prefs));
    },
    sessionsBridgeStatus_$store$_getState: async () => getSessionsBridgeStatusState(),
    // Official getInitialInteractiveAuthState: null | lcA bag (app.asar).
    // Product residual: null — never invent idle/OAuth bag on LocalSessions.
    interactiveAuth_$store$_getState: async () => null,
    getContextUsage: async (_event, id) => {
      const sessionId = asString(id);
      if (!sessionId) return null;
      return await sessionRunner.getContextUsage(sessionId);
    },
    getCodeStats: async (_event, cwdOrSession) => (cwdOrSession ? getWorkspaceCodeStats(cwdFromSession(store, cwdOrSession)) : getSessionUsageCodeStats(store)),
    getDefaultEffort: async () => "medium",
    /**
     * Official get_settings → applied for the NEW-session draft (no session id yet):
     * bare CLI probe reports the per-model catalog ladder (effortLevels /
     * ultracodeOfferable) so the composer effort slider matches the selected model.
     */
    getEffortCatalogDefaults: async (_event, model) => {
      try {
        const applied = await sessionRunner.probeCatalogEffortDefaults(asString(model) ?? undefined);
        // CLI get_settings always returns effortLevels on success (model catalog or
        // CLI's own fallback ladder). Pass through as-is — do not invent a second ladder.
        if (applied) return applied;
      } catch {
        // ignore — fall through
      }
      // Probe failed: null levels. Web 5f75ff4 keeps full residual ladder openable;
      // do not invent a second ladder in main — pass null through honestly.
      return { effort: null, effortLevels: null, ultracodeOfferable: null };
    },
    getEffort: async (_event, id) => {
      const sessionId = asString(id);
      if (!sessionId) return { effort: "medium", effortLevels: null, ultracodeOfferable: null };
      // Official get_settings → applied is the runtime truth for densable ladder levels.
      // Product Ultracode is host-store wire ("ultracode"): CLI densable often reports
      // catalog-top (e.g. high) while the ultracode flag is separate. Never clobber
      // store effort === "ultracode" with a ladder level — that made switch-back footer
      // show High instead of Ultracode (session_updated wiped the wire).
      const current = store.getSession(sessionId);
      let effort: string | null = current?.effort ?? "medium";
      let effortLevels: string[] | null = null;
      let ultracodeOfferable: boolean | null = null;
      try {
        const applied = await sessionRunner.getAppliedEffort(sessionId);
        // Accept bag even when effort string is missing — levels still authoritative.
        if (applied && (applied.effort || applied.effortLevels)) {
          effortLevels = applied.effortLevels;
          ultracodeOfferable = applied.ultracodeOfferable;
          if (current?.effort === "ultracode") {
            // Host product-strengthen wire wins over densable ladder report.
            effort = "ultracode";
          } else if (applied.effort === "ultracode") {
            effort = "ultracode";
            if (current && current.effort !== "ultracode") {
              const session = store.update(sessionId, { effort: "ultracode" });
              if (session) dispatchSessionEvent("session_updated", sessionId, session);
            }
          } else if (applied.effort) {
            if (current && current.effort !== applied.effort) {
              const session = store.update(sessionId, { effort: applied.effort });
              if (session) dispatchSessionEvent("session_updated", sessionId, session);
            }
            effort = applied.effort;
          } else {
            effort = current?.effort ?? "medium";
          }
        }
      } catch {
        // ignore — fall through
      }
      // Cold existing sessions: resume get_settings often yields effort only.
      // Same bare catalog probe as getEffortCatalogDefaults / new-chat composer
      // so the Effort slider can open (still CLI-sourced; never invent ladder).
      if (!effortLevels || effortLevels.length === 0) {
        try {
          const catalog = await sessionRunner.probeCatalogEffortDefaults(current?.model);
          if (catalog?.effortLevels && catalog.effortLevels.length > 0) {
            effortLevels = catalog.effortLevels;
            if (ultracodeOfferable == null) ultracodeOfferable = catalog.ultracodeOfferable;
          }
        } catch {
          // leave null — web full residual ladder (5f75ff4) until retry
        }
      }
      return { effort, effortLevels, ultracodeOfferable };
    },
    setEffort: async (_event, id, effort) => {
      const sessionId = asString(id);
      if (!sessionId) return null;
      const current = store.getSession(sessionId);
      const parsed = parseEffortFlagSettings({ effortLevel: effort ?? null }, current?.effort);
      if (!parsed) return bridgeSession(current);
      const session = parsed.clear
        ? store.update(sessionId, { effort: undefined })
        : store.update(sessionId, { effort: String(parsed.effort) });
      if (!session) return null;
      // Active turn: official apply_flag_settings → CLI flag-layer merge (N9 launch pin
      // released by CLI itself). Best-effort — store update above is authoritative for
      // UI + next spawn. Map to official control payload semantics:
      //   ultracode  → { ultracode: true }
      //   ladder     → { ultracode: false, effortLevel: <level> } (always pair so CLI
      //                  toggling off ultracode from the same call also clears the flag)
      //   clear      → { effortLevel: null }
      const livePayload: Record<string, unknown> = parsed.clear
        ? { effortLevel: null }
        : parsed.effort === "ultracode"
          ? { ultracode: true }
          : { ultracode: false, effortLevel: parsed.effort };
      try {
        await sessionRunner.applyFlagSettings(sessionId, livePayload);
      } catch {
        // ignore — host store still updated
      }
      // Official config changes fan out on session_updated so composer triggers re-sync without reload.
      if (session) dispatchSessionEvent("session_updated", sessionId, session);
      return bridgeSession(session);
    },
    /**
     * Official default for new Code draft is always "default".
     * bypassPermissionsModeEnabled only gates whether bypass is selectable — not the default.
     */
    /**
     * Official CCD getDefaultPermissionMode(cwd):
     *   bsA(cwd) settings merge → permissions.defaultMode (grt)
     *   unset/invalid → null (UI seeds "default")
     * Product was hardcoding "default" so new-session Mode always showed 询问权限
     * even when ~/.claude/settings.json had permissions.defaultMode.
     * Not "last Mode pill" persistence — that is per-session only.
     */
    getDefaultPermissionMode: async (_event, cwd) => {
      const bypassOk =
        asObject(context.settings.getPreferences()).bypassPermissionsModeEnabled === true;
      return resolveDefaultPermissionMode(asString(cwd), {
        bypassPermissionsModeEnabled: bypassOk,
      });
    },
    /** Modes the Code composer may offer (Os residual + bypass pref gate). */
    getAvailablePermissionModes: async () => {
      const bypassOk =
        asObject(context.settings.getPreferences()).bypassPermissionsModeEnabled === true;
      return availableCodePermissionModes(bypassOk);
    },
    getPermissionMode: async (_event, id) => {
      if (!asString(id)) return "default";
      const raw = store.getSession(asString(id)!)?.permissionMode ?? "default";
      return clampCodePermissionMode(String(raw), bypassBridgeOpts().bypassPermissionsModeEnabled);
    },
    setPermissionMode: async (_event, id, mode) => {
      const sessionId = asString(id);
      if (!sessionId) return null;
      const existing = store.getSession(sessionId);
      if (!existing) return null;
      const bypassOk =
        asObject(context.settings.getPreferences()).bypassPermissionsModeEnabled === true;
      // Official clamp: bypass without pref → acceptEdits (app.asar residual).
      const nextMode = clampCodePermissionMode(String(mode ?? "default"), bypassOk);

      // Official CCD residual (app.asar LocalSessions.setPermissionMode):
      //   cli_informed = !!session.query
      //   if (query) await query.setPermissionMode(mode) — must succeed before store
      //   fail → do not paint success; product: emit permission_mode_change_failed + null
      //   no query → host-only (next spawn/runTurn carries --permission-mode)
      let cliResult: Awaited<ReturnType<typeof sessionRunner.setPermissionMode>>;
      try {
        cliResult = await sessionRunner.setPermissionMode(sessionId, nextMode);
      } catch (error) {
        cliResult = {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (cliResult.status === "failed") {
        dispatchBridgeSessionEvent({
          type: "permission_mode_change_failed",
          sessionId,
          permissionMode: nextMode,
          error: cliResult.error,
          session: bridgeSession(existing),
        });
        // Do not update store / do not emit permission_mode_changed — Mode pill stays prior.
        return null;
      }

      const session = store.update(sessionId, { permissionMode: nextMode });
      if (!session) return null;
      const bridged = bridgeSession(session);
      dispatchSessionEvent("session_updated", sessionId, session);
      // Official ion Mode pill: permission_mode_changed → be(s.permissionMode).
      dispatchBridgeSessionEvent({
        type: "permission_mode_changed",
        sessionId,
        permissionMode: nextMode,
        session: bridged,
        cli_informed: cliResult.status === "informed",
      });
      return bridged;
    },
    setModel: async (_event, id, model) => {
      const sessionId = asString(id);
      const nextModel = String(model ?? "");
      const session = sessionId ? store.update(sessionId, { model: nextModel }) : null;
      // Official Query.setModel residual — mid-session without respawn when warm.
      if (sessionId && nextModel) {
        try {
          await sessionRunner.setSdkModel(sessionId, nextModel);
        } catch {
          /* host store remains authoritative for next spawn */
        }
      }
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return bridgeSession(session);
    },
    setVisibility: async (_event, id, visibility) => bridgeSession(asString(id) ? store.update(asString(id)!, { visibility: String(visibility ?? "") }) : null),
    setFocusedSession: async (_event, id) => {
      // Official focusedSessionChanged residual — close Code idle notifications
      // and clear isUnread (ready glyph) for the focused session.
      const sessionId = asString(id);
      const wasUnread = sessionId ? store.getSession(sessionId)?.isUnread === true : false;
      // Official setSessionVisibility: previous focus becomes hidden (idle arm), new → warm.
      const previousFocused = store.getFocusedSessionId();
      setFocusedCodeSession(context, sessionId);
      const focused = store.setFocusedSession(sessionId);
      // Only emit session_updated when unread actually cleared — avoid Recents
      // reorder spam on every open of a completed+read session.
      if (sessionId && focused && wasUnread) {
        dispatchSessionEvent("session_updated", sessionId, focused);
      }
      if (previousFocused && previousFocused !== sessionId) {
        sessionRunner.setSessionTabVisible(previousFocused, false);
      }
      if (sessionId) {
        sessionRunner.setSessionTabVisible(sessionId, true);
      } else if (previousFocused) {
        sessionRunner.setSessionTabVisible(previousFocused, false);
      }
      return true;
    },
    /**
     * Official setFastMode(sessionId, enabled) residual (c11959232 ge(n, e)).
     * Persist on session so composer fast-mode picker is not soft-true.
     * Live CLI flag apply is best-effort via applyFlagSettings when supported.
     */
    setFastMode: async (_event, id, enabled) => {
      const sessionId = asString(id);
      if (!sessionId) return false;
      const on = enabled === true;
      const session = store.update(sessionId, { fastMode: on } as never);
      if (!session) return false;
      try {
        // Best-effort live flag; host store remains authoritative for UI + next spawn.
        await sessionRunner.applyFlagSettings(sessionId, { fastMode: on });
      } catch {
        /* ignore */
      }
      dispatchSessionEvent("session_updated", sessionId, session);
      return true;
    },
    setAutoFixEnabled: async (_event, id, enabled) => {
      // Official setAutoFixEnabled(sessionId, enabled) residual.
      const sessionId = asString(id);
      if (!sessionId) return false;
      const session = store.setAutoFixEnabled(sessionId, enabled === true);
      if (session) {
        dispatchSessionEvent("session_updated", sessionId, session);
        ensureCodeAutoFixEngine(context).onSessionUpdated(session);
      }
      return Boolean(session);
    },
    setMcpServers: async (_event, id, mcpServers) => {
      const sessionId = asString(id);
      const session = sessionId ? store.update(sessionId, { mcpServers } as never) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return bridgeSession(session);
    },
    replaceEnabledMcpTools: async (_event, id, enabledMcpTools) => {
      const sessionId = asString(id);
      const session = sessionId ? store.update(sessionId, { enabledMcpTools: Array.isArray(enabledMcpTools) ? enabledMcpTools : [] } as never) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return bridgeSession(session);
    },
    replaceRemoteMcpServers: async (_event, id, remoteMcpServers) => {
      const sessionId = asString(id);
      const session = sessionId ? store.update(sessionId, { remoteMcpServers } as never) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return bridgeSession(session);
    },
    /**
     * Host→renderer catalog push residual. Product source of truth is CLI/settings catalog;
     * accept list into preference for diagnostics — not a fake "models applied" claim beyond ack.
     */
    setAvailableCodeModels: async (_event, models) => {
      try {
        context.settings.setPreference("availableCodeModels", Array.isArray(models) ? models : models ?? null);
        return true;
      } catch {
        return false;
      }
    },
    setChromePermissionMode: async (_event, mode) => {
      try {
        context.settings.setPreference("chromePermissionMode", asString(mode) ?? mode ?? null);
        return true;
      } catch {
        return false;
      }
    },
    setDraftSessionFolders: async (_event, idOrFolders, maybeFolders) => {
      // Accept (sessionId, folders) or (folders) residual shapes.
      const sessionId = asString(idOrFolders);
      const folders = Array.isArray(idOrFolders)
        ? idOrFolders
        : Array.isArray(maybeFolders)
          ? maybeFolders
          : null;
      if (sessionId && folders) {
        const session = store.update(sessionId, {
          folders: folders.filter((f): f is string => typeof f === "string"),
          userSelectedFolders: folders.filter((f): f is string => typeof f === "string"),
        } as never);
        if (session) dispatchSessionEvent("session_updated", sessionId, session);
        return Boolean(session);
      }
      if (folders) {
        try {
          context.settings.setPreference("draftSessionFolders", folders);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
    /**
     * Official Sessions Bridge shell residual (custom-3p / yit / QcA).
     * set is void; consent/enabled are boolean; delete is boolean without client.
     */
    setSessionsBridgeEnabled: async (_event, enabled) => {
      if (typeof enabled !== "boolean") {
        throw new Error(
          'Argument "enabled" at position 0 to method "setSessionsBridgeEnabled" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      context.settings.setPreference("sessionsBridgeEnabled", enabled === true);
      const prefs = context.settings.getPreferences() as Record<string, unknown>;
      await setSessionsBridgeEnabledLive(identityFromSettingsPrefs(prefs), enabled);
    },
    getBridgeConsent: async () => {
      const prefs = context.settings.getPreferences() as Record<string, unknown>;
      return getBridgeConsent(identityFromSettingsPrefs(prefs));
    },
    deleteBridgeSession: async () => deleteBridgeSessionResidual(),
    deleteBridgeAgentMemory: async () => deleteBridgeAgentMemoryResidual(),
    abandonBridgeEnvironment: async (_event, deregister) => {
      await abandonBridgeEnvironmentLive(deregister);
    },
    resetBridge: async () => {
      await resetBridgeLive();
    },
    resetBridgeSession: async () => {
      await resetBridgeSessionLive();
    },
    kickBridgePoll: async () => {
      await kickBridgePollLive();
    },
    respondToToolPermission: async (_event, requestId, decision, updatedInput, explicitSessionId) => {
      const request = asString(requestId);
      const mode = asString(decision);
      const id = asString(explicitSessionId)
        ?? asString(asObject(updatedInput).sessionId)
        ?? asString(asObject(updatedInput).session_id)
        ?? (request ? sessionRunner.findSessionIdForPermission(request) : null);
      if (!id || !request || !["always", "deny", "once"].includes(mode ?? "")) {
        return { ok: false, error: "invalid_tool_permission_response", requestId: request, decision: mode };
      }
      const result = sessionRunner.respondToToolPermission(id, request, mode as "always" | "deny" | "once", updatedInput);
      // stopFlashFrame also runs inside runner; belt-and-suspenders for focus path.
      getCodeSessionAttentionService(context).stopFlashFrame();
      dispatchBridgeSessionEvent({
        type: result.ok === false ? "tool_permission_response_failed" : "tool_permission_resolved",
        sessionId: id,
        requestId: request,
        decision: mode,
        result,
      });
      return result;
    },
    // Official void residual (preflightWaiting map absent → no-op; not soft-false invent).
    respondBridgePermissionPreflight: async (_event, requestId, proceed) => {
      await respondBridgePermissionPreflightLive(requestId, proceed);
    },
    // Directory / plugin / slash reverse-RPC is LocalAgentModeSessions (Cowork) only.
    // These keys are not in LOCAL_SESSIONS_METHODS; keep residual-honest if ever registered.
    respondDirectoryServers: async () => false,
    respondPluginSearch: async () => false,
    respondSlashMenuSkills: async () => false,
    /**
     * Official submitFeedback(sessionId, description) → QOt bag
     * {feedbackId?, ccshareUrl?, unavailableReason?, error?, ...}.
     * Requires live SDK query.submitFeedback (subtype submit_feedback).
     * Product host-loop has no that control channel — never soft-true `{ok:true}`.
     */
    submitFeedback: async (_event, sessionId, description) => {
      const id = asString(sessionId);
      const desc =
        asString(description) ??
        asString(asObject(description).description) ??
        asString(asObject(description).text);
      if (!id || !store.getSession(id)) {
        return {
          error:
            "No active Claude Code session. Send a message first, then try /feedback again.",
        };
      }
      if (!desc) {
        return { error: "Feedback description is required." };
      }
      return {
        error: "Feedback submission is not available for this desktop configuration.",
        unavailableReason: "feedback_not_available",
      };
    },
    submitTranscriptFeedback: async (_event, sessionIdOrInput, input) => submitTranscriptFeedback(sessionIdOrInput, input),
    getTranscriptFeedback: async (_event, sessionId) => getTranscriptFeedback(sessionId),
    /**
     * Official LocalSessions.shareSession(sessionId) → RUe
     * `{ success, filePath? | error? }` via J6e transcript zip export.
     * Never soft-true `{ ok: true, localOnly: true }`.
     */
    shareSession: async (_event, id) => {
      const sessionId = asString(id);
      if (!sessionId) return { success: false, error: "Session not found" };
      const session = store.getSession(sessionId);
      if (!session) return { success: false, error: "Session not found" };
      const cliSessionId = asString(session.cliSessionId);
      if (!cliSessionId) {
        return { success: false, error: "Session has no CLI session ID" };
      }
      try {
        // Official SI()/getClaudeConfigDir residual for Code: CLAUDE_CONFIG_DIR || ~/.claude
        const configDir =
          process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude");
        // Product multi-session bag is not per-session metadata file; omit metadataPath.
        return await exportCoworkCliSessionTranscript(
          {
            cliSessionId,
            projectsDir: path.join(configDir, "projects"),
            logsDir: app.getPath("logs"),
          },
          {
            appPath: app.getAppPath(),
            downloadsDir: app.getPath("downloads"),
            scrubHomedir: homedir(),
          },
        );
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    /**
     * Residual summarizeSession(sessionId) — fire-and-forget fork; results via
     * session_summary_result / session_summary_error (c4bf Df/Ff). Returns boolean
     * start success for residual Df.start (not invent title/summary dump).
     */
    summarizeSession: async (_event, id) => {
      const sessionId = asString(id);
      if (!sessionId) return false;
      const session = store.getSession(sessionId);
      return sessionSummaryService.summarizeSession(session);
    },
    /**
     * Residual summarizeTranscript(sessionId, transcriptText) — non-local path dump.
     * Residual web cC passes (id, text); older product invent took only transcript array.
     */
    summarizeTranscript: async (_event, idOrTranscript, maybeTranscript) => {
      const sessionId = asString(idOrTranscript);
      if (sessionId && typeof maybeTranscript === "string") {
        return sessionSummaryService.summarizeTranscript(sessionId, maybeTranscript);
      }
      // Residual also accepts start(sessionId, text) only; bare array was product invent.
      if (typeof idOrTranscript === "string" && !maybeTranscript) {
        // treat as transcript-only with synthetic id — not residual; reject.
        return false;
      }
      return false;
    },
    /**
     * Product title SoT after turn settle (was incorrectly piggybacked on invent summarizeSession).
     * Not residual SessionSummary — only refreshTitleFromTranscript + session_updated.
     */
    refreshSessionTitle: async (_event, id) => {
      const sessionId = asString(id);
      if (!sessionId) return null;
      const refreshed =
        (await store.refreshTitleFromTranscript(sessionId)) ?? store.getSession(sessionId);
      if (refreshed) dispatchSessionEvent("session_updated", sessionId, refreshed);
      return bridgeSession(refreshed);
    },
    getPlanForSession: async (_event, id) => {
      const sessionId = asString(id) ?? asString(asObject(id).sessionId);
      return sessionId ? planFromTranscript(await store.getTranscript(sessionId)) : null;
    },
    popBackgroundTaskSuggestion: async () => {
      const session = store.getAll(true).find((item) => item.isRunning || item.runtime?.kind === "claude-cli" && item.stopped !== true);
      return session ? {
        id: `background:${session.id}`,
        sessionId: session.id,
        title: session.title,
        cwd: session.cwd,
        kind: session.kind,
        status: session.isRunning ? "running" : "recent",
        updatedAt: session.updatedAt,
      } : null;
    },
    getAgents: async () => listLocalAgents(),
    createAgent: async (_event, input) => createLocalAgent(input),
    getDirectMcpServerStatuses: async () => {
      const { getDirectMcpConnectionManager } = await import(
        "../services/mcp/directMcpConnectionManager"
      );
      const manager = getDirectMcpConnectionManager();
      try {
        await manager.connectFromConfigBag(context.settings.getMcpServersConfig());
      } catch (error) {
        console.warn(
          "[custom3p-mcp] LocalSessions connectFromConfigBag failed",
          error instanceof Error ? error.message : String(error),
        );
      }
      const live = manager.getStatuses();
      if (live.length > 0) return live;
      // Fallback residual-ish: configured descriptors when nothing connected yet.
      return configuredMcpServers(context).map(([name, config]) =>
        describeMcpServer(name, config),
      );
    },
    // Residual authorizeDirectMcpServer → _ni custom3p MCP OAuth loopback (not Anthropic login).
    authorizeDirectMcpServer: async (_event, serverName) => {
      const name = String(serverName ?? "");
      const { getDirectMcpConnectionManager } = await import(
        "../services/mcp/directMcpConnectionManager"
      );
      return getDirectMcpConnectionManager().authorizePending(name);
    },
    disconnectDirectMcpServer: async (_event, serverName) => {
      const name = asString(serverName);
      if (!name) return false;
      const { getDirectMcpConnectionManager } = await import(
        "../services/mcp/directMcpConnectionManager"
      );
      return getDirectMcpConnectionManager().disconnect(name);
    },
    getLocalSkillFiles: async (_event, skillRef) => getLocalSkillFiles(skillRef),
    listLocalSkills: async () => listLocalSkills(),
    syncSkills: async () => listLocalSkills(),
    deleteLocalSkill: async (_event, skillRef) => deleteLocalSkill(skillRef),
    saveLocalSkill: async (_event, skillInput, filesInput) => saveLocalSkill(skillInput, filesInput),
    revealLocalSkill: async (_event, skillRef) => revealLocalSkill(skillRef),
    setLocalSkillEnabled: async (_event, skillRef, enabled) => setLocalSkillEnabled(skillRef, enabled),
    // CU window mentions are LocalAgentModeSessions/Cowork residual (manager.noteCuWindowMentions).
    // Code LocalSessions path has no CU inject — residual no-op (not soft-true success).
    noteCuWindowMentions: async () => undefined,
    triggerInteractiveAuth: async () => ({ ok: false, reason: "interactive_auth_not_required" }),
    // No interactive auth session to revoke in 3p residual path.
    revokeInteractiveAuth: async () => false,
    mcpListResources: async (_event, serverName) => {
      if (asString(serverName)) {
        const server = mcpServerConfig(context, serverName);
        return server ? requestMcpServer({ serverName: server.name, config: server.config, method: "resources/list" }) : { ok: false, error: "mcp_server_not_configured", serverName };
      }
      const results = await Promise.all(configuredMcpServers(context).map(async ([name, config]) => ({
        serverName: name,
        resources: await requestMcpServer({ serverName: name, config, method: "resources/list" }),
      })));
      return results;
    },
    mcpReadResource: async (_event, serverName, uri) => {
      const server = mcpServerConfig(context, serverName);
      const resourceUri = asString(uri) ?? asString(asObject(uri).uri);
      if (!server) return { ok: false, error: "mcp_server_not_configured", serverName };
      if (!resourceUri) return { ok: false, error: "missing_mcp_resource_uri", serverName };
      return requestMcpServer({ serverName: server.name, config: server.config, method: "resources/read", params: { uri: resourceUri } });
    },
    mcpCallTool: async (_event, serverName, toolName, input) => {
      const name = asString(toolName) ?? asString(asObject(toolName).name);
      if (!name) return { ok: false, error: "missing_mcp_tool_name", serverName };
      // Official Gir internal MCP "Claude in Chrome" (LM) — not user mcp-servers.json.
      // BrowserUse (officialBridgeAdapter) routes list_connected_browsers / select_browser here.
      try {
        const {
          isClaudeInChromeMcpServerName,
          callClaudeInChromeTool,
        } = await import("../services/chrome/claudeInChromeMcp");
        if (isClaudeInChromeMcpServerName(serverName)) {
          // Live re-read each call — do not freeze prefs into singleton MCP context.
          // Kir init is async; this route may create the client first.
          return callClaudeInChromeTool(name, asObject(input), {
            isEnabled: () => {
              const prefs = context.settings?.getPreferences?.() ?? {};
              return prefs.chromeExtensionEnabled !== false;
            },
            getPersistedDeviceId: () => {
              const prefs = context.settings?.getPreferences?.() ?? {};
              const bag = asObject(prefs.chromeExtension);
              return typeof bag.pairedDeviceId === "string"
                ? bag.pairedDeviceId
                : undefined;
            },
          });
        }
      } catch (error) {
        console.warn("[Chrome Extension MCP] mcpCallTool internal route failed", error);
      }
      // Prefer live directMcpHost connection when present (residual custom3p-main client).
      try {
        const { getDirectMcpConnectionManager } = await import(
          "../services/mcp/directMcpConnectionManager"
        );
        const live = getDirectMcpConnectionManager().getConnectedClient(
          asString(serverName) ?? "",
        );
        if (live) {
          return live.client.callTool(
            { name, arguments: asObject(input) },
            undefined,
            { timeout: 300_000 },
          );
        }
      } catch (error) {
        console.warn("[custom3p-mcp] live mcpCallTool failed", error);
      }
      const server = mcpServerConfig(context, serverName);
      if (!server) return { ok: false, error: "mcp_server_not_configured", serverName };
      return requestMcpServer({ serverName: server.name, config: server.config, method: "tools/call", params: { name, arguments: asObject(input) } });
    },
    // Official nor residual: desktop/documents/downloads status bag (not soft-true granted).
    requestFolderTccAccess: async () => {
      const { requestFolderTccAccessResidual } = await import("./coworkLocalAgentResidualHandlers");
      return requestFolderTccAccessResidual();
    },
    openOutputsDir: async () => {
      await shell.openPath(store.getOutputsDir());
      return true;
    },
    // Official XC (c11959232 ZC): fe.listSessionDirectory(sessionId, absPath)
    // where absPath is cwd/worktree (or expanded branch). Not session outputs dir.
    listSessionDirectory: async (_event, id, relative = ".") => {
      const sessionId = asString(id);
      if (!sessionId) return [];
      const rawPath = String(relative ?? ".");
      let target: string | null = null;
      if (path.isAbsolute(rawPath)) {
        target = rawPath;
      } else if (rawPath === "." || rawPath === "") {
        target = cwdFromSession(store, sessionId) ?? sessionFileRoot(store, sessionId);
      } else {
        target = resolveSessionOrWorkspaceFile(store, sessionId, rawPath);
      }
      if (!target) return [];
      try {
        return await listDirectory(target);
      } catch {
        return [];
      }
    },
    readSessionFile: async (_event, id, relative) => {
      const sessionId = asString(id);
      if (!sessionId) return null;
      const target = resolveSessionOrWorkspaceFile(store, sessionId, String(relative ?? ""));
      return target ? readText(target) : null;
    },
    readSessionImageAsDataUrl: async (_event, id, relative) => {
      const sessionId = asString(id);
      if (!sessionId) return null;
      const target = resolveSessionOrWorkspaceFile(store, sessionId, String(relative ?? ""));
      if (!target) return null;
      const buffer = await fs.readFile(target);
      return `data:${mimeTypeForFile(target)};base64,${buffer.toString("base64")}`;
    },
    // Official fe.writeSessionFile(sessionId, absPath|rel, contents, expectedHash?)
    // → { status: "ok"|"conflict"|"denied", hash?, currentHash? } (c119 vN / UI enum).
    writeSessionFile: async (_event, id, relative, content, expectedHash) => {
      const sessionId = asString(id);
      if (!sessionId) return null;
      const target = resolveSessionOrWorkspaceFile(store, sessionId, String(relative ?? "file.txt"));
      if (!target) return { status: "denied" as const };
      const nextContents = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      try {
        const existing = await fs.readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error?.code === "ENOENT") return null;
          throw error;
        });
        if (existing != null && expectedHash != null && String(expectedHash).length > 0) {
          const current = contentHash(existing);
          if (current !== String(expectedHash)) {
            return { status: "conflict" as const, currentHash: current };
          }
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, nextContents);
        return { status: "ok" as const, hash: contentHash(nextContents), absPath: target };
      } catch {
        return { status: "denied" as const };
      }
    },
    pickSessionFile: async (_event, id) => {
      const sessionId = asString(id);
      const defaultPath = sessionId ? sessionFileRoot(store, sessionId) : store.getOutputsDir();
      const result = await dialog.showOpenDialog(context.windows.mainWindow, { defaultPath, properties: ["openFile"] });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    readFileAtCwd: async (_event, cwdOrSession, relative) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      if (!cwd) return null;
      return readText(path.resolve(cwd, String(relative ?? "")));
    },
    pickFileAtCwd: async (_event, cwdOrSession) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const result = await dialog.showOpenDialog(context.windows.mainWindow, { defaultPath: cwd ?? undefined, properties: ["openFile"] });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    listSSHDirectory: async (_event, sshConfigOrDir, maybeDir) => {
      // Official: listSSHDirectory(sshConfig, remotePath). Legacy product called with a local path only.
      const asConfig = sessionSshConfigFromUnknown(sshConfigOrDir);
      if (asConfig) {
        const remotePath =
          asString(maybeDir)
          ?? asString(asObject(sshConfigOrDir).remoteCwd)
          ?? asConfig.remoteCwd
          ?? "~";
        const script = [
          `dir=${shellQuote(remotePath)}`,
          'cd "$dir" 2>/dev/null || cd ~ || exit 1',
          'pwd',
          // name|type|path — one entry per line
          'for e in * .[!.]* ..?*; do',
          '  [ -e "$e" ] || continue',
          '  [ "$e" = "." ] || [ "$e" = ".." ] && continue',
          '  if [ -d "$e" ]; then t=dir; else t=file; fi',
          '  printf "%s|%s|%s\\n" "$e" "$t" "$(pwd)/$e"',
          "done",
        ].join("; ");
        const result = await defaultExecSsh(asConfig, `sh -c ${shellQuote(script)}`);
        if (result.exitCode !== 0) {
          return { error: result.stderr || "list_failed", entries: [] };
        }
        const lines = result.stdout.split(/\r?\n/).filter(Boolean);
        // First line is pwd when script prints pwd first — skip non | lines as cwd header.
        const entries: Array<{ name: string; path: string; isDirectory: boolean }> = [];
        for (const line of lines) {
          if (!line.includes("|")) continue;
          const [name, type, fullPath] = line.split("|");
          if (!name || !fullPath) continue;
          entries.push({
            name,
            path: fullPath,
            isDirectory: type === "dir" || type === "directory",
          });
        }
        return { entries, error: null };
      }
      // Fallback: local list (legacy).
      return listDirectory(path.resolve(String(sshConfigOrDir ?? app.getPath("home"))));
    },
    validateSSHPath: async (_event, sshConfigOrPath, maybePath) => {
      const asConfig = sessionSshConfigFromUnknown(sshConfigOrPath);
      if (asConfig) {
        const remotePath = asString(maybePath) ?? asString(asObject(sshConfigOrPath).remoteCwd) ?? asConfig.remoteCwd ?? "~";
        const result = await defaultExecSsh(
          asConfig,
          `sh -c ${shellQuote(`test -e ${shellQuote(remotePath)}`)}`,
        );
        return { valid: result.exitCode === 0, path: remotePath };
      }
      try {
        await fs.access(String(sshConfigOrPath));
        return { valid: true };
      } catch {
        return { valid: false };
      }
    },
    // Official checkGhAvailable(cwd): gh auth status --hostname github.com → boolean.
    checkGhAvailable: async (_event, cwdOrSession) => {
      const cwd =
        cwdFromSession(store, cwdOrSession)
        ?? (typeof cwdOrSession === "string" && cwdOrSession ? cwdOrSession : process.cwd());
      const gh = await resolveGhPath();
      if (!gh) return false;
      try {
        await execFileAsync(
          gh,
          ["auth", "status", "--hostname", "github.com"],
          { cwd: cwd || process.cwd(), timeout: 5000, maxBuffer: 1024 * 1024 },
        );
        return true;
      } catch {
        return false;
      }
    },
    // Official installGh residual: darwin brew install gh; else open docs / error bag.
    installGh: async () => {
      const result = await installGhResidual();
      if (!result.success) {
        await shell.openExternal("https://cli.github.com/").catch(() => undefined);
      }
      return result;
    },
    getGhIssue: async (_event, cwdOrSession, issue) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const repo = await githubRepo(cwd);
      const number = issueOrPrNumber(issue, cwdOrSession);
      if (!repo || !number) return null;
      const result = await githubRequest(`/repos/${repo.owner}/${repo.repo}/issues/${number}`);
      return result.ok ? result.data : result;
    },
    listGhIssues: async (_event, cwdOrSession, options) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const repo = await githubRepo(cwd);
      if (!repo) return [];
      const state = asString(asObject(options).state) ?? "open";
      const result = await githubRequest(githubApiPath(`/repos/${repo.owner}/${repo.repo}/issues`, { state, per_page: 50 }));
      return result.ok && Array.isArray(result.data) ? result.data.filter((issue) => !asObject(issue).pull_request) : [];
    },
    getPrDetails: async (_event, cwdOrSession, prNumberOrBranch) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const number = issueOrPrNumber(prNumberOrBranch);
      const branch = asString(prNumberOrBranch) && !number ? asString(prNumberOrBranch) : null;
      const result = await githubPull(cwd, number, branch);
      if (!result.ok || !result.repo) return result;
      const pull = asObject(result.pull);
      const files = pull.number ? await githubRequest(`/repos/${result.repo.owner}/${result.repo.repo}/pulls/${pull.number}/files?per_page=100`) : null;
      return { ...pull, files: files?.ok ? files.data : undefined };
    },
    getPrChecks: async (_event, cwdOrSession, prNumberOrBranch) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const number = issueOrPrNumber(prNumberOrBranch);
      const branch = asString(prNumberOrBranch) && !number ? asString(prNumberOrBranch) : null;
      const result = await githubPull(cwd, number, branch);
      if (!result.ok || !result.repo) return result;
      const head = asObject(asObject(result.pull).head);
      const sha = asString(head.sha);
      if (!sha) return { ok: false, error: "pull_head_sha_not_found" };
      const [checkRuns, status] = await Promise.all([
        githubRequest(`/repos/${result.repo.owner}/${result.repo.repo}/commits/${sha}/check-runs`),
        githubRequest(`/repos/${result.repo.owner}/${result.repo.repo}/commits/${sha}/status`),
      ]);
      return { ok: checkRuns.ok || status.ok, sha, checkRuns: checkRuns.ok ? asObject(checkRuns.data).check_runs ?? [] : [], status: status.ok ? status.data : null, errors: [checkRuns.error, status.error].filter(Boolean) };
    },
    getPrReviewComments: async (_event, cwdOrSession, prNumberOrBranch) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const number = issueOrPrNumber(prNumberOrBranch);
      const branch = asString(prNumberOrBranch) && !number ? asString(prNumberOrBranch) : null;
      const result = await githubPull(cwd, number, branch);
      if (!result.ok || !result.repo) return [];
      const pullNumber = Number(asObject(result.pull).number);
      if (!pullNumber) return [];
      const comments = await githubRequest(`/repos/${result.repo.owner}/${result.repo.repo}/pulls/${pullNumber}/comments?per_page=100`);
      return comments.ok && Array.isArray(comments.data) ? comments.data : [];
    },
    /**
     * Official getPrReviews residual — pulls/{n}/reviews (summary review notes).
     */
    getPrReviews: async (_event, cwdOrSession, prNumberOrBranch) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const number = issueOrPrNumber(prNumberOrBranch);
      const branch = asString(prNumberOrBranch) && !number ? asString(prNumberOrBranch) : null;
      const result = await githubPull(cwd, number, branch);
      if (!result.ok || !result.repo) return [];
      const pullNumber = Number(asObject(result.pull).number);
      if (!pullNumber) return [];
      const reviews = await githubRequest(
        `/repos/${result.repo.owner}/${result.repo.repo}/pulls/${pullNumber}/reviews?per_page=100`,
      );
      return reviews.ok && Array.isArray(reviews.data) ? reviews.data : [];
    },
    /**
     * Official getPrIssueComments residual — issues/{n}/comments (PR conversation).
     */
    getPrIssueComments: async (_event, cwdOrSession, prNumberOrBranch) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const number = issueOrPrNumber(prNumberOrBranch);
      const branch = asString(prNumberOrBranch) && !number ? asString(prNumberOrBranch) : null;
      const result = await githubPull(cwd, number, branch);
      if (!result.ok || !result.repo) return [];
      const pullNumber = Number(asObject(result.pull).number);
      if (!pullNumber) return [];
      const comments = await githubRequest(
        `/repos/${result.repo.owner}/${result.repo.repo}/issues/${pullNumber}/comments?per_page=100`,
      );
      return comments.ok && Array.isArray(comments.data) ? comments.data : [];
    },
    getPrStateForBranch: async (_event, cwdOrSession, branch) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const pull = await githubPullForBranch(cwd, asString(branch));
      if (!pull) return null;
      const raw = asObject(pull);
      const result = {
        number: raw.number,
        state: raw.state,
        title: raw.title,
        url: raw.html_url,
        draft: raw.draft,
        merged: raw.merged_at !== null && raw.merged_at !== undefined,
      };
      // Official session.prs residual: cache PR head on the session when id known.
      const sessionId =
        asString(cwdOrSession)
        ?? asString(asObject(cwdOrSession).id)
        ?? asString(asObject(cwdOrSession).sessionId);
      if (sessionId && store.getSession(sessionId)) {
        const ref = prRefFromGithubPull(pull);
        if (ref) {
          const existing = store.getSession(sessionId)?.prs ?? [];
          const next = [
            ...existing.filter((pr) => pr.number !== ref.number),
            ref,
          ];
          store.update(sessionId, { prs: next });
        }
      }
      return result;
    },
    createLocalPr: async (_event, cwdOrSession, title, body, options) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      if (!cwd) {
        return { ok: false, success: false, error: CREATE_PR_AUTH_ERROR, stdout: "", stderr: CREATE_PR_AUTH_ERROR, code: 1 };
      }
      // Official: if PR already exists for branch, return it instead of re-creating.
      try {
        const existingView = await runProcess(
          cwd,
          "gh",
          ["pr", "view", "--json", "number,url"],
          15000,
        );
        if (existingView.ok || existingView.code === 0) {
          const raw = String(existingView.stdout ?? "").trim();
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as { number?: number; url?: string };
              if (parsed.number && parsed.url) {
                return {
                  ok: true,
                  success: true,
                  stdout: parsed.url,
                  stderr: "",
                  code: 0,
                  number: parsed.number,
                  url: parsed.url,
                };
              }
            } catch {
              /* fall through to create */
            }
          }
        }
      } catch {
        /* fall through */
      }
      // Official createLocalPr(A): title required; body||""; optional baseBranch; draft.
      // Accept bag-first (official kOt) or multi-arg product residual via adapter.
      const optionsBag =
        options && typeof options === "object"
          ? (options as Record<string, unknown>)
          : asObject(title).title || asObject(title).body || asObject(title).draft !== undefined
            ? asObject(title)
            : {};
      const titleText =
        asString(title)
        ?? asString(optionsBag.title)
        ?? "Update project";
      let bodyText =
        asString(body)
        ?? asString(optionsBag.body)
        ?? "";
      // Never pass multi-MB bodies (dirty-tree dumps) into gh — cap residual.
      if (bodyText.length > 12_000) bodyText = `${bodyText.slice(0, 12_000)}\n…`;
      const draft =
        optionsBag.draft === true
        || (options && typeof options === "object" && (options as { draft?: unknown }).draft === true);
      const baseBranch =
        asString(optionsBag.baseBranch)
        ?? asString(optionsBag.base);
      const args = ["pr", "create", "--title", titleText, "--body", bodyText || ""];
      if (baseBranch) args.push("--base", baseBranch);
      if (draft) args.push("--draft");
      const created = await runProcess(cwd, "gh", args, 30000);
      const createdOk =
        created
        && typeof created === "object"
        && (created as { ok?: unknown; success?: unknown }).ok !== false
        && (created as { success?: unknown }).success !== false
        && (created as { code?: unknown }).code === 0;
      if (!createdOk) {
        const blob = `${created?.stderr ?? ""} ${created?.error ?? ""} ${created?.stdout ?? ""}`;
        // Official: if stderr already contains a PR URL (already exists), link it.
        const urlMatch = blob.match(/(https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+)/);
        if (urlMatch) {
          return {
            ok: true,
            success: true,
            stdout: urlMatch[1],
            stderr: "",
            code: 0,
            url: urlMatch[1],
          };
        }
        // Official residual error (auth / missing gh / network) — never dump full command+body.
        return {
          ok: false,
          success: false,
          stdout: "",
          stderr: CREATE_PR_AUTH_ERROR,
          error: CREATE_PR_AUTH_ERROR,
          code: typeof created?.code === "number" ? created.code : 1,
        };
      }
      // Official: parse /pull/(\d+) from stdout; attach number+url.
      {
        const out = String(created?.stdout ?? "").trim();
        const pullMatch = out.match(/\/pull\/(\d+)/);
        const urlMatch = out.match(/(https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+)/);
        if (urlMatch) {
          const number = pullMatch ? Number.parseInt(pullMatch[1]!, 10) : undefined;
          Object.assign(created, {
            url: urlMatch[1],
            number: Number.isFinite(number) ? number : undefined,
            success: true,
            ok: true,
          });
        }
      }
      // Best-effort: after create, refresh session.prs so AutoArchive sees the open PR.
      const sessionId =
        asString(cwdOrSession)
        ?? asString(asObject(cwdOrSession).id)
        ?? asString(asObject(cwdOrSession).sessionId);
      if (sessionId && store.getSession(sessionId)) {
        try {
          const pull = await githubPullForBranch(cwd, undefined);
          const ref = prRefFromGithubPull(pull);
          if (ref) {
            const existing = store.getSession(sessionId)?.prs ?? [];
            store.update(sessionId, {
              prs: [...existing.filter((pr) => pr.number !== ref.number), ref],
            });
          }
        } catch {
          /* ignore — create result still returned */
        }
        // Official _t ccr_autofix_on_pr_create: seed session.autoFixEnabled after PR open
        // so CodeAutoFixEngine can watch CI/review without inventing remote CCR path.
        try {
          if (isAutofixOnPrCreateFromUserData(app.getPath("userData"))) {
            store.setAutoFixEnabled(sessionId, true);
          }
        } catch {
          /* ignore — PR create result still returned */
        }
      }
      return created;
    },
    generateLocalPrContent: async (_event, cwdOrSession) => generatePrContent(cwdFromSession(store, cwdOrSession)),
    updatePrBody: async (_event, cwdOrSession, prNumber, body) => runProcess(cwdFromSession(store, cwdOrSession), "gh", ["pr", "edit", String(prNumber ?? ""), "--body", String(body ?? "")], 30000),
    mergePr: async (_event, cwdOrSession, prNumber) => runProcess(cwdFromSession(store, cwdOrSession), "gh", ["pr", "merge", String(prNumber ?? ""), "--merge"], 30000),
    getGitInfo: async (_event, cwdOrSession) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const root = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
      const branch = await runGit(cwd, ["branch", "--show-current"]);
      const remote = await runGit(cwd, ["remote", "-v"]);
      // Official baseBranch source (c11959232 Jn?.defaultBranch): origin/HEAD → main|master fallback.
      const originHead = await runGit(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
      let defaultBranch: string | null = null;
      if (originHead.ok) {
        const ref = String(originHead.stdout ?? "").trim();
        const match = ref.match(/refs\/remotes\/origin\/(.+)$/);
        if (match?.[1]) defaultBranch = match[1];
      }
      if (!defaultBranch) {
        const local = await runGit(cwd, ["branch", "--list"]);
        if (local.ok) {
          const names = String(local.stdout ?? "")
            .split(/\r?\n/)
            .map((line) => line.replace(/^\*\s*/, "").trim())
            .filter(Boolean);
          defaultBranch = names.find((name) => name === "main" || name === "master") ?? null;
        }
      }
      return {
        cwd,
        root: root.ok ? String(root.stdout ?? "").trim() : null,
        branch: branch.ok ? String(branch.stdout ?? "").trim() : null,
        remotes: remote.ok ? String(remote.stdout ?? "").trim() : "",
        defaultBranch,
      };
    },
    getWorkingTreeStatus: async (_event, cwdOrSession) => runGitInRepository(cwdFromSession(store, cwdOrSession), ["status", "--short", "--branch"]),
    getUncommittedChanges: async (_event, cwdOrSession) => runGit(cwdFromSession(store, cwdOrSession), ["status", "--porcelain=v1"]),
    isWorkingTreeDirty: async (_event, cwdOrSession) => {
      const result = await runGit(cwdFromSession(store, cwdOrSession), ["status", "--porcelain=v1"]);
      return result.ok && String(result.stdout ?? "").trim().length > 0;
    },
    // Official O7i/a2A: structured comparison { files[].patch, merge_base, … } — not raw stdout.
    getGitDiff: async (_event, cwdOrSession, base) =>
      getOfficialGitDiff(cwdFromSession(store, cwdOrSession), asString(base) ?? "HEAD"),
    getGitDiffStats: async (_event, cwdOrSession, base) => runGitInRepository(cwdFromSession(store, cwdOrSession), ["diff", "--stat", ...gitDiffArgs(base)]),
    // Official c11959232 nN: merge_base for getDiffFileContent(cwd, merge_base, path).
    getMergeBase: async (_event, cwdOrSession, base) => {
      const ref = asString(base) ?? "HEAD";
      return runGitInRepository(cwdFromSession(store, cwdOrSession), ["merge-base", "HEAD", ref]);
    },
    // Official electron-shell H7i / LocalSessions.getDiffFileContent:
    // (cwd, mergeBase, filePath, prevFilePath?) → { oldText, newText } | null
    // oldText = git show mergeBase:(prev||path); newText = working-tree file read.
    getDiffFileContent: async (_event, cwdOrSession, mergeBase, filePath, previousFilePath) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const base = asString(mergeBase);
      const targetPath = asString(filePath);
      if (!cwd || !base || base.startsWith("-") || !targetPath) return null;

      const rootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
      const root = rootResult.ok ? String(rootResult.stdout ?? "").trim() : cwd;
      if (!root) return null;

      const showPath = asString(previousFilePath) ?? targetPath;
      const maxBytes = 2 * 1024 * 1024;

      const [oldText, newText] = await Promise.all([
        (async (): Promise<string | null> => {
          try {
            const shown = await execFileAsync("git", ["show", `${base}:${showPath}`, "--"], {
              cwd: root,
              timeout: 5000,
              maxBuffer: maxBytes,
            });
            return typeof shown.stdout === "string" ? shown.stdout : String(shown.stdout ?? "");
          } catch {
            return null;
          }
        })(),
        (async (): Promise<string | null> => {
          try {
            const abs = path.resolve(root, targetPath);
            const rel = path.relative(root, abs);
            if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
            const stat = await fs.stat(abs).catch(() => null);
            if (!stat?.isFile() || stat.size > maxBytes) return null;
            return await fs.readFile(abs, "utf8");
          } catch {
            return null;
          }
        })(),
      ]);

      if (oldText === null && newText === null) return null;
      return { oldText, newText };
    },
    getCommitDiff: async (_event, cwdOrSession, commit) => runGit(cwdFromSession(store, cwdOrSession), ["show", "--stat", String(commit ?? "HEAD")]),
    getGitCommits: async (_event, cwdOrSession, limit) => runGit(cwdFromSession(store, cwdOrSession), ["log", `-${Number(limit) || 20}`, "--oneline"]),
    getLocalBranches: async (_event, cwdOrSession) => runGit(cwdFromSession(store, cwdOrSession), ["branch", "--list"]),
    getSSHConfigs: async () => {
      const settings = await loadSshSettings();
      const saved = Array.isArray(settings.configs) ? settings.configs.map(normalizeSshConfig).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
      return [...await readSystemSshConfigs(), ...saved.map((config) => ({ ...config, source: "app" }))];
    },
    setSSHConfigs: async (_event, configs) => {
      const settings = await loadSshSettings();
      settings.configs = Array.isArray(configs) ? configs.map(normalizeSshConfig).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
      await saveSshSettings(settings);
      return true;
    },
    getTrustedSSHHosts: async () => {
      const settings = await loadSshSettings();
      const saved = Array.isArray(settings.trustedHosts) ? settings.trustedHosts.filter((host): host is string => typeof host === "string" && host.length > 0) : [];
      return [...new Set([...await readKnownSshHosts(), ...saved])].sort();
    },
    setTrustedSSHHosts: async (_event, hosts) => {
      const settings = await loadSshSettings();
      settings.trustedHosts = Array.isArray(hosts) ? [...new Set(hosts.filter((host): host is string => typeof host === "string" && host.length > 0))] : [];
      await saveSshSettings(settings);
      return true;
    },
    getSSHGitInfo: async (_event, cwdOrSession) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const remoteUrl = await gitText(cwd, ["remote", "get-url", "origin"]);
      const sshInfo = parseSshGitRemote(remoteUrl);
      if (!sshInfo) return null;
      return { ...sshInfo, cwd, root: await gitText(cwd, ["rev-parse", "--show-toplevel"]), branch: await currentBranch(cwd) };
    },
    getSSHSupportedCommands: async () => ["git status", "git diff", "git log"],
    resolveSSHSettings: async (_event, host) => {
      const target = asString(host) ?? asString(asObject(host).host);
      if (!target) return {};
      const resolved = await runProcess(process.cwd(), "ssh", ["-G", target], 10000);
      if (resolved.code === 0) return { ok: true, host: target, config: parseSshConfigOutput(resolved.stdout) };
      const configs = [...await readSystemSshConfigs(), ...(await loadSshSettings()).configs ?? []];
      const match = configs.map(normalizeSshConfig).find((config) => config?.host === target || config?.hostName === target);
      return match ? { ok: true, host: target, config: match, warning: resolved.stderr || resolved.error } : { ok: false, host: target, error: resolved.stderr || resolved.error };
    },
    /**
     * Official respondToSSHPassword residual: feed password into the session SSH/pty prompt.
     * Product: write to shell pty when session has one; otherwise honest false (no soft-true).
     */
    respondToSSHPassword: async (_event, sessionIdOrPayload, passwordMaybe) => {
      const bag = asObject(sessionIdOrPayload);
      const sessionId = asString(sessionIdOrPayload) ?? asString(bag.sessionId) ?? asString(bag.id);
      const password =
        asString(passwordMaybe)
        ?? asString(bag.password)
        ?? asString(bag.response)
        ?? asString(bag.value)
        ?? "";
      if (!sessionId || !password) return false;
      const entry = ptys.get(sessionId);
      if (!entry) return false;
      try {
        entry.terminal.write(`${password}\n`);
        return true;
      } catch {
        return false;
      }
    },
    testSSHConnection: async (_event, host) => {
      const asConfig = sessionSshConfigFromUnknown(host);
      if (asConfig) {
        const result = await defaultExecSsh(asConfig, "true");
        return {
          ok: result.exitCode === 0,
          code: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          host: asConfig.host,
        };
      }
      const target = asString(host) ?? asString(asObject(host).host) ?? asString(asObject(host).sshHost);
      if (!target) return { ok: false, reason: "missing_ssh_host" };
      const resolved = await runProcess(process.cwd(), "ssh", ["-G", target], 10000);
      if (resolved.code !== 0) return { ok: false, ...resolved, host: target };
      const probe = await runProcess(
        process.cwd(),
        "ssh",
        ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", target, "true"],
        10000,
      );
      return { ok: probe.code === 0, ...probe, host: target };
    },
    ensureSSHConnected: async (_event, host) => {
      const asConfig = sessionSshConfigFromUnknown(host);
      if (asConfig) {
        const result = await defaultExecSsh(asConfig, "true");
        return {
          ok: result.exitCode === 0,
          code: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          host: asConfig.host,
        };
      }
      const target = asString(host) ?? asString(asObject(host).host) ?? asString(asObject(host).sshHost);
      if (!target) return { ok: false, reason: "missing_ssh_host" };
      return runProcess(process.cwd(), "ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", target, "true"], 10000);
    },
    /**
     * Official GitHubPrManager.ensureBranchPushed residual:
     *   dirty porcelain → auto-commit (message from generateCommitMessage or
     *   "chore: commit pending changes") → if ahead/no upstream →
     *   push --set-upstream origin <branch>.
     * Product: no 1p OAuth commit-message model → fixed residual message.
     */
    ensureBranchPushed: async (_event, cwdOrSession) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      if (!cwd) {
        return {
          success: false,
          error: "Could not check git status. Make sure the working directory is a valid git repository.",
        };
      }
      try {
        const porcelain = await runGit(cwd, ["status", "--porcelain"]);
        if (!porcelain.ok) {
          return {
            success: false,
            error: "Could not check git status. Make sure the working directory is a valid git repository.",
          };
        }
        if (String(porcelain.stdout ?? "").trim().length > 0) {
          // Official: generateCommitMessage(A) ?? "chore: commit pending changes"
          const message = "chore: commit pending changes";
          const add = await runGit(cwd, ["add", "-A"], 30_000);
          if (!add.ok) {
            return { success: false, error: "Could not stage changes for commit." };
          }
          const committed = await runGit(cwd, ["commit", "-m", message], 120_000);
          if (!committed.ok) {
            const blob = `${committed.stderr ?? ""} ${committed.stdout ?? ""}`;
            if (blob.includes("nothing to commit") || blob.includes("nothing added to commit")) {
              /* Official: continue with PR creation */
            } else {
              return {
                success: false,
                error: String(committed.stderr || committed.stdout || "Could not commit pending changes."),
              };
            }
          }
        }
      } catch {
        return {
          success: false,
          error: "Could not check git status. Make sure the working directory is a valid git repository.",
        };
      }
      try {
        const head = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
        const branch = String(head.stdout ?? "").trim();
        if (!head.ok || !branch || branch === "HEAD") {
          return { success: false, error: "Could not resolve current branch for push." };
        }
        let needsPush = true;
        try {
          const upstream = await runGit(cwd, ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`]);
          const up = String(upstream.stdout ?? "").trim();
          if (upstream.ok && up) {
            const count = await runGit(cwd, ["rev-list", "--count", `${up}..HEAD`]);
            needsPush = String(count.stdout ?? "").trim() !== "0";
          }
        } catch {
          needsPush = true;
        }
        if (needsPush) {
          const pushed = await runGit(cwd, ["push", "--set-upstream", "origin", branch], 30_000);
          if (!pushed.ok) {
            const msg = `${pushed.stderr ?? ""} ${pushed.stdout ?? ""} ${pushed.error ?? ""}`;
            const rejected = msg.includes("fetch first") || msg.includes("non-fast-forward");
            return {
              success: false,
              error: rejected
                ? "Remote branch has changes that are not present locally."
                : "Could not push branch to remote. Check your git remote configuration and network connection.",
              errorType: rejected ? "push_rejected" : undefined,
            };
          }
        }
        return { success: true, branch };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const rejected = msg.includes("fetch first") || msg.includes("non-fast-forward");
        return {
          success: false,
          error: rejected
            ? "Remote branch has changes that are not present locally."
            : "Could not push branch to remote. Check your git remote configuration and network connection.",
          errorType: rejected ? "push_rejected" : undefined,
        };
      }
    },
    commitAllChanges: async (_event, cwdOrSession, message) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const add = await runGit(cwd, ["add", "-A"], 30_000);
      if (!add.ok) return { success: false, error: "Could not stage changes for commit." };
      const committed = await runGit(cwd, ["commit", "-m", String(message ?? "WIP")], 120_000);
      if (!committed.ok) {
        const blob = `${committed.stderr ?? ""} ${committed.stdout ?? ""}`;
        // Official: nothing to commit → success continue.
        if (blob.includes("nothing to commit") || blob.includes("nothing added to commit")) {
          return { success: true };
        }
        return {
          success: false,
          error: String(committed.stderr || committed.stdout || "Could not commit changes."),
        };
      }
      return { success: true };
    },
    commitWipForBranchSwitch: async (_event, cwdOrSession, branchName) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const add = await runGit(cwd, ["add", "-A"]);
      if (!add.ok) return { success: false, error: String(add.stderr || add.stdout || "git add failed") };
      return gitSuccess(cwd, ["commit", "-m", `WIP before switching to ${String(branchName ?? "branch")}`]);
    },
    discardWorkingTree: async (_event, cwdOrSession) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const reset = await runGit(cwd, ["reset", "--hard"]);
      if (!reset.ok) return { success: false, error: String(reset.stderr || reset.stdout || "git reset failed") };
      return gitSuccess(cwd, ["clean", "-fd"]);
    },
    stashWorkingTree: async (_event, cwdOrSession, message) => gitSuccess(cwdFromSession(store, cwdOrSession), ["stash", "push", "-u", "-m", String(message ?? "WIP")]),
    reviewDiff: async (_event, cwdOrSession, options) => startDiffReview(cwdOrSession, options, "Review local diff"),
    launchUltrareview: async (_event, cwdOrSession, options) => startDiffReview(cwdOrSession, options, "Ultrareview local diff"),
    runBashCommand: async (_event, sessionId, command) => {
      const shell = commandShell(String(command ?? ""));
      return runProcess(cwdFromSession(store, sessionId), shell.file, shell.args, 60000);
    },
    startPty: async (_event, sessionId, cols, rows) => (asString(sessionId) ? startShell(asString(sessionId)!, Number(cols) || 80, Number(rows) || 24) : false),
    stopPty: async (_event, sessionId) => {
      const entry = asString(sessionId) ? ptys.get(asString(sessionId)!) : null;
      entry?.terminal.kill("SIGTERM");
      return true;
    },
    writePty: async (_event, sessionId, data) => {
      const entry = asString(sessionId) ? ptys.get(asString(sessionId)!) : null;
      entry?.terminal.write(String(data ?? ""));
      return Boolean(entry);
    },
    resizePty: async (_event, sessionId, cols, rows) => {
      const entry = asString(sessionId) ? ptys.get(asString(sessionId)!) : null;
      entry?.terminal.resize?.(Number(cols) || 80, Number(rows) || 24);
      return true;
    },
    startShellPty: async (_event, sessionId, cols, rows) => (asString(sessionId) ? startShell(asString(sessionId)!, Number(cols) || 80, Number(rows) || 24) : false),
    stopShellPty: async (_event, sessionId) => {
      const entry = asString(sessionId) ? ptys.get(asString(sessionId)!) : null;
      entry?.terminal.kill("SIGTERM");
      return true;
    },
    writeShellPty: async (_event, sessionId, data) => {
      const entry = asString(sessionId) ? ptys.get(asString(sessionId)!) : null;
      entry?.terminal.write(String(data ?? ""));
      return Boolean(entry);
    },
    resizeShellPty: async (_event, sessionId, cols, rows) => {
      const entry = asString(sessionId) ? ptys.get(asString(sessionId)!) : null;
      entry?.terminal.resize?.(Number(cols) || 80, Number(rows) || 24);
      return true;
    },
    getShellPtyBuffer: async (_event, sessionId) => (asString(sessionId) ? ptys.get(asString(sessionId)!)?.buffer ?? "" : ""),
    startSideChat: async (_event, parentOrInput, maybeInput) => {
      const parentId = asString(parentOrInput) ?? asString(asObject(parentOrInput).sessionId) ?? asString(asObject(parentOrInput).parentSessionId);
      const parent = parentId ? store.getSession(parentId) : null;
      const request = Object.keys(asObject(maybeInput)).length > 0 ? asObject(maybeInput) : asObject(parentOrInput);
      const prompt = asString(request.prompt) ?? asString(request.message) ?? "";
      const session = store.start({
        ...request,
        cwd: asString(request.cwd) ?? parent?.cwd,
        folders: Array.isArray(request.folders) ? request.folders : parent?.folders,
        kind: parent?.kind,
        // Official: sidechat inherits sshConfig / worktree from parent when present.
        sshConfig: sessionSshConfigFromUnknown(request.sshConfig) ?? parent?.sshConfig,
        originCwd: asString(request.originCwd) ?? parent?.originCwd,
        worktreePath: asString(request.worktreePath) ?? parent?.worktreePath,
        worktreeName: asString(request.worktreeName) ?? parent?.worktreeName,
        useWorktree: typeof request.useWorktree === "boolean" ? request.useWorktree : parent?.useWorktree,
        origin: "sidechat",
        prompt,
        title: asString(request.title) ?? (parent ? `${parent.title} side chat` : "Side chat"),
      } as never);
      const updated = store.update(session.id, { metadata: { ...(session.metadata ?? {}), sideChat: true, parentSessionId: parentId } });
      dispatchSessionEvent("start", session.id, updated ?? session);
      if (prompt) sessionRunner.runTurn(session.id, prompt, request);
      return bridgeSession(updated ?? session);
    },
    stopSideChat: async (_event, id) => {
      const sessionId = asString(id) ?? asString(asObject(id).sessionId);
      if (sessionId) sessionRunner.stop(sessionId);
      const stopped = sessionId ? store.stop(sessionId) : false;
      if (sessionId && stopped) dispatchSessionEvent("stopped", sessionId, store.getSession(sessionId));
      return stopped;
    },
    /**
     * Official stopSessionSummary(sessionId) → boolean (true only if a forked
     * summary query was aborted). Residual LocalSessionManager.stopSessionSummary.
     */
    stopSessionSummary: async (_event, id) => {
      const sessionId = asString(id);
      if (!sessionId) return false;
      return sessionSummaryService.stop(sessionId);
    },
    // Official LocalSessions.cancelQueuedMessage(sessionId, messageUuid) → boolean
    cancelQueuedMessage: async (_event, id, messageUuid) => {
      const sessionId = asString(id);
      const uuid = asString(messageUuid);
      if (!sessionId || !uuid) return false;
      return sessionRunner.cancelQueuedMessage(sessionId, uuid);
    },
    /**
     * Official enableAutoMerge(cwd, prNumber) → { success, error? } (c11959232).
     * Local residual: `gh pr merge <n> --auto` (not soft-true).
     */
    enableAutoMerge: async (_event, cwdOrSession, prNumber) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const n = issueOrPrNumber(prNumber, cwdOrSession);
      if (!cwd) return { success: false, error: "Could not resolve repository for auto-merge." };
      if (!n) return { success: false, error: "No PR to toggle auto-merge on." };
      const result = await runProcess(cwd, "gh", ["pr", "merge", String(n), "--auto"], 30000);
      if (result.ok || result.code === 0) return { success: true };
      const err = String(result.stderr || result.error || result.stdout || "Could not update auto-merge setting.");
      return {
        success: false,
        error: err.includes("draft")
          ? "Draft PRs can't use auto-merge."
          : err.slice(0, 400) || "Could not update auto-merge setting.",
      };
    },
    disableAutoMerge: async (_event, cwdOrSession, prNumber) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const n = issueOrPrNumber(prNumber, cwdOrSession);
      if (!cwd) return { success: false, error: "Could not resolve repository for auto-merge." };
      if (!n) return { success: false, error: "No PR to toggle auto-merge on." };
      const result = await runProcess(cwd, "gh", ["pr", "merge", String(n), "--disable-auto"], 30000);
      if (result.ok || result.code === 0) return { success: true };
      const err = String(result.stderr || result.error || result.stdout || "Could not update auto-merge setting.");
      return { success: false, error: err.slice(0, 400) || "Could not update auto-merge setting." };
    },
    releaseWorktree: async (_event, id, options) => {
      const sessionId = asString(id) ?? asString(asObject(id).sessionId);
      if (!sessionId) return false;
      const request = { ...asObject(id), ...asObject(options) };
      const session = await store.releaseWorktree(sessionId, {
        cleanupWorktree: request.cleanupWorktree !== false && request.cleanup !== false,
        force: request.force !== false,
      });
      if (session) dispatchSessionEvent("session_updated", sessionId, session);
      return bridgeSession(session);
    },
    rewind: async (_event, id, messageId) => {
      const sessionId = asString(id);
      if (sessionId) sessionRunner.stop(sessionId);
      const session = sessionId ? await store.rewind(sessionId, asString(messageId) ?? undefined) : null;
      if (sessionId && session) {
        dispatchSessionEvent("rewound", sessionId, session);
        dispatchSessionEvent("session_updated", sessionId, session);
      }
      return Boolean(session);
    },
    teleportToCloud: async (_event, id, options) => teleportToLocalHandoff(id, options),
    getTeleportReadiness: async (_event, id) => getTeleportReadinessFor(id),
    getDetectedProjects: async () => getDetectedProjects(store),
    getInstalledEditors: async () => getInstalledEditors(),
    isVSCodeInstalled: async () => commandExists("code"),
    openInVSCode: async (_event, target) => {
      const filePath = pathFromTarget(target);
      if (!filePath) return false;
      await shell.openExternal(`vscode://file/${encodeURIComponent(filePath)}`);
      return true;
    },
    openInEditor: async (_event, target, editor, line, column) => {
      const filePath = pathFromTarget(target);
      if (!filePath) return false;
      const rawTarget = asObject(target);
      return openEditorAtLocation(filePath, editor, line ?? rawTarget.line ?? rawTarget.lineNumber, column ?? rawTarget.column ?? rawTarget.columnNumber);
    },
    /**
     * Official logCliEvent(sessionId, eventName, eventData):
     * MCP notification log_event on ccd_session when present; else debug no-op.
     * Product host-loop has no ccd_session MCP inject — residual no-op, not soft-true.
     */
    logCliEvent: async (_event, sessionId, eventName, eventData) => {
      void sessionId;
      void eventName;
      void eventData;
    },
  };

  const allowedMethods = new Set<string>(allMethods);
  for (const [method, handler] of Object.entries(realHandlers)) {
    if (allowedMethods.has(method)) handlers[method] = handler;
  }
  const missingMethods = allMethods.filter((method) => !(method in handlers));
  if (missingMethods.length > 0) throw new Error(`Missing LocalSessions handler implementations: ${missingMethods.join(", ")}`);
  return handlers;
}

const autoArchiveEngines = new WeakMap<IpcHandlerContext, CodeAutoArchiveEngine>();
const autoFixEngines = new WeakMap<IpcHandlerContext, CodeAutoFixEngine>();
const worktreePools = new WeakMap<IpcHandlerContext, WorktreePool>();

/**
 * Map GitHub pull payload → official session.prs entry residual.
 */
function prRefFromGithubPull(pull: unknown, repoSlug?: string | null): {
  number?: number;
  state?: string;
  merged?: boolean;
  title?: string;
  url?: string;
  repo?: string;
  updatedAt?: string;
} | null {
  const raw = asObject(pull);
  if (!raw || Object.keys(raw).length === 0) return null;
  const number = Number(raw.number);
  const merged =
    raw.merged_at !== null && raw.merged_at !== undefined
      ? true
      : raw.merged === true;
  // Official terminal: merged preferred over closed string.
  let state = typeof raw.state === "string" ? raw.state : undefined;
  if (merged) state = "merged";
  const base = asObject(raw.base);
  const head = asObject(raw.head);
  const repoFromPull =
    asString(asObject(base.repo).full_name)
    ?? asString(asObject(head.repo).full_name)
    ?? asString(repoSlug)
    ?? undefined;
  return {
    number: Number.isFinite(number) && number > 0 ? number : undefined,
    state,
    merged: merged || undefined,
    title: asString(raw.title) ?? undefined,
    url: asString(raw.html_url) ?? asString(raw.url) ?? undefined,
    repo: repoFromPull,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Official AutoArchiveEngine residual (vlr): start on LocalSessions registration.
 * gi("ccAutoArchiveOnPrClose") gates each sweep.
 * Prefers session.prs; network refresh writes prs back onto the session.
 */
function ensureCodeAutoArchiveEngine(context: IpcHandlerContext): CodeAutoArchiveEngine {
  const existing = autoArchiveEngines.get(context);
  if (existing) return existing;
  const store = context.localSessions;
  const engine = new CodeAutoArchiveEngine({
    store,
    isEnabled: () =>
      asObject(context.settings.getPreferences()).ccAutoArchiveOnPrClose === true,
    lookupPrs: async (session) => {
      const cwd = session.worktreePath || session.cwd || session.originCwd;
      if (!cwd || session.sshConfig) return null;
      try {
        const pull = await githubPullForBranch(cwd, undefined);
        if (!pull) return [];
        const ref = prRefFromGithubPull(pull);
        return ref ? [ref] : [];
      } catch {
        return null;
      }
    },
    writePrs: (sessionId, prs) => {
      store.update(sessionId, { prs });
    },
    archiveSession: async (sessionId, options) => {
      if (options?.cleanupWorktree) {
        try {
          await store.releaseWorktree(sessionId, { cleanupWorktree: true });
        } catch {
          /* best-effort cleanup */
        }
      }
      const ok = store.archive(sessionId);
      if (ok) {
        dispatchBridgeEvent(
          context.windows.mainView.webContents,
          "claude.web",
          "LocalSessions",
          "onEvent",
          { type: "archived", sessionId },
        );
      }
      return ok;
    },
  });
  engine.start();
  autoArchiveEngines.set(context, engine);
  return engine;
}

/**
 * Official AutoFixEngine residual (Klr): start alongside AutoArchive on LocalSessions register.
 * Requires session.autoFixEnabled + prs[]; wakes via sendMessage with <ci-monitor-event>.
 */
function ensureCodeAutoFixEngine(context: IpcHandlerContext): CodeAutoFixEngine {
  const existing = autoFixEngines.get(context);
  if (existing) return existing;
  const store = context.localSessions;
  const engine = new CodeAutoFixEngine({
    store,
    getPrChecks: async (cwd, prNumber, repo) => {
      try {
        const path = repo
          ? `/repos/${repo}/pulls/${prNumber}`
          : null;
        // Prefer existing githubPull helper when no explicit repo.
        const pullResult = await githubPull(cwd, prNumber, null);
        if (!pullResult.ok || !pullResult.repo) {
          return { ok: false, error: pullResult.error ?? "pull_not_found" };
        }
        const pull = asObject(pullResult.pull);
        const head = asObject(pull.head);
        const sha = asString(head.sha);
        const ownerRepo = `${pullResult.repo.owner}/${pullResult.repo.repo}`;
        if (!sha) return { ok: false, error: "pull_head_sha_not_found", prState: asString(pull.state) };
        const [checkRuns, status] = await Promise.all([
          githubRequest(`/repos/${ownerRepo}/commits/${sha}/check-runs`),
          githubRequest(`/repos/${ownerRepo}/commits/${sha}/status`),
        ]);
        const rawChecks = checkRuns.ok
          ? (asObject(checkRuns.data).check_runs as unknown[])
          : [];
        const checks = Array.isArray(rawChecks)
          ? rawChecks.map((item) => {
              const c = asObject(item);
              const conclusion = asString(c.conclusion) ?? "";
              const name = asString(c.name) ?? asString(c.app?.name) ?? "check";
              const failed =
                conclusion === "failure"
                || conclusion === "timed_out"
                || conclusion === "cancelled";
              return {
                name,
                conclusion,
                status: asString(c.status) ?? undefined,
                bucket: failed ? "fail" : conclusion === "success" ? "pass" : "pending",
              };
            })
          : [];
        // Also fold combined status statuses.
        if (status.ok) {
          const statuses = asObject(status.data).statuses;
          if (Array.isArray(statuses)) {
            for (const item of statuses) {
              const s = asObject(item);
              const state = asString(s.state) ?? "";
              if (state === "failure" || state === "error") {
                checks.push({
                  name: asString(s.context) ?? "status",
                  conclusion: state,
                  bucket: "fail",
                });
              }
            }
          }
        }
        void path; // reserved when repo-only path expands
        return {
          ok: checkRuns.ok || status.ok,
          success: checkRuns.ok || status.ok,
          checks,
          prState: asString(pull.state) ?? undefined,
          mergeable:
            pull.mergeable === false
              ? "CONFLICTING"
              : pull.mergeable === true
                ? "MERGEABLE"
                : undefined,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    getPrReviewComments: async (cwd, prNumber, _repo) => {
      try {
        const result = await githubPull(cwd, prNumber, null);
        if (!result.ok || !result.repo) return { success: false, comments: [] };
        const comments = await githubRequest(
          `/repos/${result.repo.owner}/${result.repo.repo}/pulls/${prNumber}/comments?per_page=100`,
        );
        if (!comments.ok || !Array.isArray(comments.data)) {
          return { success: false, comments: [] };
        }
        return {
          success: true,
          comments: comments.data.map((item) => {
            const c = asObject(item);
            const user = asObject(c.user);
            return {
              id: c.id as string | number | undefined,
              dedupId: `line:${String(c.id ?? "")}`,
              author: asString(user.login) ?? undefined,
              body: asString(c.body) ?? undefined,
              path: asString(c.path) ?? undefined,
              line: typeof c.line === "number" ? c.line : undefined,
              userType: asString(user.type) ?? undefined,
              authorAssociation: asString(c.author_association) ?? undefined,
            };
          }),
        };
      } catch {
        return { success: false, comments: [] };
      }
    },
    // Official getPrReviews residual — review summaries (CHANGES_REQUESTED / COMMENT / …).
    getPrReviews: async (cwd, prNumber, _repo) => {
      try {
        const result = await githubPull(cwd, prNumber, null);
        if (!result.ok || !result.repo) return { success: false, comments: [] };
        const reviews = await githubRequest(
          `/repos/${result.repo.owner}/${result.repo.repo}/pulls/${prNumber}/reviews?per_page=100`,
        );
        if (!reviews.ok || !Array.isArray(reviews.data)) {
          return { success: false, comments: [] };
        }
        return {
          success: true,
          comments: reviews.data.map((item) => {
            const c = asObject(item);
            const user = asObject(c.user);
            return {
              id: c.id as string | number | undefined,
              dedupId: `review:${String(c.id ?? "")}`,
              author: asString(user.login) ?? undefined,
              body: asString(c.body) ?? undefined,
              state: asString(c.state) ?? undefined,
              userType: asString(user.type) ?? undefined,
              authorAssociation: asString(c.author_association) ?? undefined,
            };
          }),
        };
      } catch {
        return { success: false, comments: [] };
      }
    },
    // Official getPrIssueComments residual — PR conversation thread.
    getPrIssueComments: async (cwd, prNumber, _repo) => {
      try {
        const result = await githubPull(cwd, prNumber, null);
        if (!result.ok || !result.repo) return { success: false, comments: [] };
        const comments = await githubRequest(
          `/repos/${result.repo.owner}/${result.repo.repo}/issues/${prNumber}/comments?per_page=100`,
        );
        if (!comments.ok || !Array.isArray(comments.data)) {
          return { success: false, comments: [] };
        }
        return {
          success: true,
          comments: comments.data.map((item) => {
            const c = asObject(item);
            const user = asObject(c.user);
            return {
              id: c.id as string | number | undefined,
              dedupId: `issue:${String(c.id ?? "")}`,
              author: asString(user.login) ?? undefined,
              body: asString(c.body) ?? undefined,
              userType: asString(user.type) ?? undefined,
              authorAssociation: asString(c.author_association) ?? undefined,
            };
          }),
        };
      } catch {
        return { success: false, comments: [] };
      }
    },
    getGhLogin: async () => {
      try {
        const result = await runProcess(process.cwd(), "gh", ["api", "user", "--jq", ".login"], 10000);
        if (result.ok && typeof result.stdout === "string") {
          return result.stdout.trim() || null;
        }
      } catch {
        /* soft */
      }
      return null;
    },
    sendMessage: async (sessionId, text) => {
      // Official AutoFix wake → sessionManager.sendMessage (starts a turn).
      store.sendMessage(sessionId, text, "user");
      try {
        const runner = getLocalSessionRunner(context);
        runner.runTurn(sessionId, text);
      } catch {
        /* best-effort wake */
      }
      const session = store.getSession(sessionId);
      if (session) {
        dispatchBridgeEvent(
          context.windows.mainView.webContents,
          "claude.web",
          "LocalSessions",
          "onEvent",
          { type: "session_updated", sessionId, session: toBridgeSession(session) },
        );
      }
    },
    log: (...args) => {
      try {
        console.info(...args);
      } catch {
        /* ignore */
      }
    },
  });
  engine.start();
  autoFixEngines.set(context, engine);
  return engine;
}

/**
 * Official WorktreePool residual (Flr / pat):
 *   isEnabled = AppFeatures.chillingSlothPool (ft 1992087837)
 *   prefs = ccMaxWarmWorktrees + ccWorktreeReapAfterHours
 *   registry = userData/worktree-pool.json
 * Wired into LocalSessionStore.ensureWorktreeResolved / releaseWorktree.
 */
function ensureWorktreePool(context: IpcHandlerContext): WorktreePool {
  const existing = worktreePools.get(context);
  if (existing) return existing;
  const store = context.localSessions;
  const registryPath = path.join(app.getPath("userData"), "worktree-pool.json");
  const pool = new WorktreePool({
    registry: createJsonWorktreeRegistry(registryPath),
    isEnabled: () => {
      try {
        const features = context.settings.getSupportedFeatures();
        return features.chillingSlothPool?.status === "supported";
      } catch {
        return false;
      }
    },
    prefs: () => {
      const prefs = asObject(context.settings.getPreferences());
      const maxWarmRaw = prefs.ccMaxWarmWorktrees;
      const reapHoursRaw = prefs.ccWorktreeReapAfterHours;
      const maxWarm =
        typeof maxWarmRaw === "number" && Number.isFinite(maxWarmRaw)
          ? Math.max(0, Math.floor(maxWarmRaw))
          : 3;
      const reapHours =
        typeof reapHoursRaw === "number" && Number.isFinite(reapHoursRaw)
          ? Math.max(0, reapHoursRaw)
          : 24;
      return {
        maxWarm,
        reapAfterMs: Math.floor(reapHours * 3600 * 1000),
      };
    },
    getSessionPoolState: (sessionId) => {
      const session = store.getSession(sessionId);
      if (!session) return null;
      const lastActivityAt = Date.parse(session.lastActivityAt ?? session.updatedAt ?? "") || 0;
      return {
        isRunning: session.isRunning === true,
        isArchived: session.archived === true,
        isRemote: Boolean(session.sshConfig),
        worktreePinned: false,
        lastActivityAt,
      };
    },
    hasLoadedSessions: () => true,
    detachWorktreeFromSession: (sessionId, worktreePath) => {
      const session = store.getSession(sessionId);
      if (!session) return;
      if (worktreePath && session.worktreePath && path.resolve(session.worktreePath) !== path.resolve(worktreePath)) {
        return;
      }
      store.update(sessionId, {
        worktreePath: undefined,
        worktreeName: undefined,
        useWorktree: false,
        cwd: session.originCwd ?? session.cwd,
        originCwd: undefined,
        sourceBranch: undefined,
      });
    },
    attachWorktreeToSession: (sessionId, entry) => {
      void store.attachWorktree(sessionId, {
        worktreePath: entry.path,
        worktreeName: entry.name,
        originCwd: entry.baseRepo,
      });
    },
    log: (...args) => {
      try {
        console.info(...args);
      } catch {
        /* ignore */
      }
    },
  });
  store.setWorktreePool(pool);
  pool.start();
  worktreePools.set(context, pool);
  return pool;
}

export function registerLocalSessionsHandlers(context: IpcHandlerContext): void {
  // Ensure runner (and worktree pref readers / attention) are wired before first start.
  getLocalSessionRunner(context);
  ensureCodeAutoArchiveEngine(context);
  ensureCodeAutoFixEngine(context);
  ensureWorktreePool(context);
  registerInterfaceHandlers(
    "claude.web",
    "LocalSessions",
    createSessionHandlers(context.localSessions, context, LOCAL_SESSIONS_METHODS),
    "claude.web.LocalSessions",
  );
  registerInterfaceHandlers("claude.web", "LocalSessionEnvironment", {
    get: async () => ({ env: await getLocalSessionEnvironment(), userData: app.getPath("userData") }),
    save: async (env: unknown) => ({ env: await saveLocalSessionEnvironment(env), userData: app.getPath("userData") }),
  }, "claude.web.LocalSessionEnvironment");
}
