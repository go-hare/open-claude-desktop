import { app, dialog, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import https from "node:https";
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
import type { LocalSessionStore } from "../services/localSessions/localSessionStore";
import { getTranscriptFeedback, submitTranscriptFeedback } from "../services/localSessions/transcriptFeedbackStore";
import { loadOriginalNodePty } from "../services/originalRuntime/originalRuntimeModules";
import type { IpcHandlerContext } from "./context";
import { getSessionRunner } from "./localSessionRunner";
import { describeMcpServer, mcpConfigEntries, requestMcpServer } from "../services/mcp/mcpRuntime";
import type { InterfaceHandlers } from "./registerIpc";
import { dispatchBridgeEvent, registerInterfaceHandlers } from "./registerIpc";

const execFileAsync = promisify(execFile);
const TEXT_LIMIT_BYTES = 8 * 1024 * 1024;

const LOCAL_SESSIONS_METHODS = [
  "addDirectories","archive","cancelQueuedMessage","checkGhAvailable","checkRemoteTrust","checkTrust","clearSession","commitAllChanges","commitWipForBranchSwitch","createAgent","createLocalPr","delete","disableAutoMerge","discardWorkingTree","enableAutoMerge","ensureBranchPushed","ensureSSHConnected","forkSession","generateLocalPrContent","getAgents","getAll","getCodeStats","getCommitDiff","getContextUsage","getDefaultEffort","getDefaultPermissionMode","getDetectedProjects","getDiffFileContent","getEffort","getGhIssue","getGitCommits","getGitDiff","getGitDiffStats","getGitInfo","getInstalledEditors","getLocalBranches","getPermissionMode","getPlanForSession","getPrChecks","getPrDetails","getPrReviewComments","getPrStateForBranch","getSSHConfigs","getSSHGitInfo","getSSHSupportedCommands","getSession","getSessionsForScheduledTask","getShellPtyBuffer","getSupportedCommands","getTeleportReadiness","getTranscript","getTrustedSSHHosts","getUncommittedChanges","getWorkingTreeStatus","importCliSession","installGh","interrupt","isVSCodeInstalled","isWorkingTreeDirty","launchUltrareview","listGhIssues","listSSHDirectory","listSessionDirectory","logCliEvent","mergePr","openInEditor","openInVSCode","pickFileAtCwd","pickSessionFile","popBackgroundTaskSuggestion","readFileAtCwd","readSessionFile","readSessionImageAsDataUrl","releaseWorktree","replaceEnabledMcpTools","replaceRemoteMcpServers","resizePty","resizeShellPty","resolveSSHSettings","respondToSSHPassword","respondToToolPermission","reviewDiff","rewind","runBashCommand","saveTrust","searchSessions","sendMessage","sendSideChatMessage","setAutoFixEnabled","setAvailableCodeModels","setEffort","setFastMode","setFocusedSession","setMcpServers","setModel","setPermissionMode","setSSHConfigs","setTrustedSSHHosts","setVisibility","shareSession","start","startPty","startShellPty","startSideChat","stashWorkingTree","stop","stopPty","stopSessionSummary","stopShellPty","stopSideChat","stopTask","submitFeedback","summarizeSession","summarizeTranscript","teleportToCloud","testSSHConnection","unarchive","updatePrBody","updateSession","validateSSHPath","writePty","writeSessionFile","writeShellPty",
] as const;

const LOCAL_AGENT_METHODS = [
  "abandonBridgeEnvironment","addFolderToSession","addTrustedFolder","archive","authorizeDirectMcpServer","delete","deleteBridgeAgentMemory","deleteBridgeSession","deleteLocalSkill","disconnectDirectMcpServer","getAll","getBridgeConsent","getDirectMcpServerStatuses","getLocalSkillFiles","getSession","getSessionsBridgeEnabled","getSessionsForScheduledTask","getSupportedCommands","getTranscript","getTranscriptFeedback","getTrustedFolders","interactiveAuth_$store$_getState","isFolderTrusted","kickBridgePoll","listLocalSkills","mcpCallTool","mcpListResources","mcpReadResource","noteCuWindowMentions","openOutputsDir","removeTrustedFolder","replaceEnabledMcpTools","replaceRemoteMcpServers","requestFolderTccAccess","resetBridge","resetBridgeSession","respondBridgePermissionPreflight","respondDirectoryServers","respondPluginSearch","respondSlashMenuSkills","respondToToolPermission","revealLocalSkill","revokeInteractiveAuth","rewind","saveLocalSkill","searchSessions","sendMessage","sessionsBridgeStatus_$store$_getState","setChromePermissionMode","setDraftSessionFolders","setFocusedSession","setLocalSkillEnabled","setMcpServers","setModel","setPermissionMode","setSessionsBridgeEnabled","shareSession","start","stop","submitTranscriptFeedback","syncSkills","triggerInteractiveAuth","updateSession",
] as const;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
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

function toBridgeSession(session: unknown): unknown {
  const raw = asObject(session);
  const id = asString(raw.id) ?? asString(raw.sessionId);
  if (!id) return session;
  const updatedAt = asString(raw.updatedAt) ?? asString(raw.lastActivityAt) ?? new Date().toISOString();
  return {
    ...raw,
    id,
    sessionId: id,
    sessionKind: asString(raw.sessionKind) ?? (raw.kind === "code" ? "code" : "cowork"),
    lastActivityAt: asString(raw.lastActivityAt) ?? updatedAt,
    isRunning: typeof raw.isRunning === "boolean" ? raw.isRunning : raw.stopped !== true,
    userSelectedFolders: Array.isArray(raw.userSelectedFolders) ? raw.userSelectedFolders : raw.folders,
  };
}

function toBridgeSessions(sessions: unknown[]): unknown[] {
  return sessions.map(toBridgeSession);
}

async function commandExists(command: string): Promise<boolean> {
  try {
    if (process.platform === "win32") await execFileAsync("where.exe", [command], { timeout: 3000 });
    else await execFileAsync("/usr/bin/env", ["which", command], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
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

async function runGit(cwd: string | null, args: string[]) {
  if (!cwd) return { ok: false, error: "missing cwd" };
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd, timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string; code?: unknown };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? "", code: err.code };
  }
}

async function runProcess(cwd: string | null, command: string, args: string[], timeout = 30000) {
  if (!cwd) return { stdout: "", stderr: "missing cwd", code: 1, error: "missing cwd" };
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string; code?: unknown };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? "", code: typeof err.code === "number" ? err.code : 1, error: err.message };
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
      "User-Agent": "claude-deepseek-desktop",
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

async function githubPullForBranch(cwd: string | null, branch?: string | null) {
  const repo = await githubRepo(cwd);
  const headBranch = branch ?? await currentBranch(cwd);
  if (!repo || !headBranch) return null;
  const result = await githubRequest(githubApiPath(`/repos/${repo.owner}/${repo.repo}/pulls`, { state: "open", head: `${repo.owner}:${headBranch}`, per_page: 1 }));
  return result.ok && Array.isArray(result.data) ? result.data[0] ?? null : null;
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

async function generatePrContent(cwd: string | null) {
  const branch = await currentBranch(cwd) ?? "current branch";
  const status = await gitText(cwd, ["status", "--short"]) ?? "";
  const stat = await gitText(cwd, ["diff", "--stat", "HEAD"]) ?? await gitText(cwd, ["diff", "--stat"]) ?? "";
  const commits = await gitText(cwd, ["log", "--oneline", "-10"]) ?? "";
  const title = branch.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Update project";
  const body = [
    "## Summary",
    stat ? stat : "Describe the changes in this PR.",
    "",
    "## Recent commits",
    commits ? commits.split(/\r?\n/).map((line) => `- ${line}`).join("\n") : "- No local commits found.",
    "",
    "## Working tree",
    status ? `\`\`\`\n${status}\n\`\`\`` : "Clean working tree.",
    "",
    "## Test plan",
    "- Not run.",
  ].join("\n");
  return { title, body, branch, status, stat, commits };
}

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

function normalizeSshConfig(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string" && value.length > 0) return { host: value };
  const raw = asObject(value);
  const host = asString(raw.host) ?? asString(raw.name) ?? asString(raw.hostName);
  if (!host) return null;
  return {
    ...raw,
    host,
    hostName: asString(raw.hostName) ?? asString(raw.hostname) ?? host,
    user: asString(raw.user),
    port: raw.port,
    identityFile: asString(raw.identityFile) ?? asString(raw.identityfile),
  };
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

async function readText(filePath: string) {
  const stat = await fs.stat(filePath);
  if (stat.size > TEXT_LIMIT_BYTES) return { path: filePath, size: stat.size, tooLarge: true };
  return fs.readFile(filePath, "utf8");
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

function streaksForDates(dates: Set<string>) {
  if (dates.size === 0) return { currentStreak: 0, longestStreak: 0 };
  const sorted = Array.from(dates).sort();
  let longestStreak = 1;
  let currentRun = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    const previousDate = sorted[index - 1];
    const currentDate = sorted[index];
    if (!previousDate || !currentDate) continue;
    const previous = new Date(previousDate);
    previous.setUTCDate(previous.getUTCDate() + 1);
    if (dateKey(previous) === currentDate) {
      currentRun += 1;
      longestStreak = Math.max(longestStreak, currentRun);
    } else {
      currentRun = 1;
    }
  }

  let currentStreak = 0;
  const cursor = new Date();
  for (;;) {
    const key = dateKey(cursor);
    if (!dates.has(key)) break;
    currentStreak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return { currentStreak, longestStreak };
}

function getSessionUsageCodeStats(store: LocalSessionStore) {
  const sessions = store.getAll(true).filter((session) => session.kind === "code");
  const daily = new Map<string, { messageCount: number; sessionCount: number; toolCallCount: number }>();
  const dailyModelTokens = new Map<string, Record<string, number>>();
  const modelUsage: Record<string, ReturnType<typeof emptyModelUsage>> = {};
  const hourly = new Map<number, number>();

  for (const session of sessions) {
    const sessionDate = dateKey(session.createdAt);
    const day = daily.get(sessionDate) ?? { messageCount: 0, sessionCount: 0, toolCallCount: 0 };
    day.sessionCount += 1;
    const transcriptUsage = contextUsageFromTranscript(store.getTranscript(session.id));
    day.toolCallCount += transcriptUsage.toolCallCount;
    daily.set(sessionDate, day);

    const model = session.model || "opus-4";
    modelUsage[model] ??= emptyModelUsage();
    if (hasUsage(transcriptUsage)) {
      addUsage(modelUsage[model], transcriptUsage);
      const tokensByModel = dailyModelTokens.get(sessionDate) ?? {};
      tokensByModel[model] = (tokensByModel[model] ?? 0) + transcriptUsage.totalTokens;
      dailyModelTokens.set(sessionDate, tokensByModel);
    }

    for (const message of session.messages ?? []) {
      const messageDate = dateKey(message.createdAt);
      const entry = daily.get(messageDate) ?? { messageCount: 0, sessionCount: 0, toolCallCount: 0 };
      entry.messageCount += 1;
      daily.set(messageDate, entry);

      const hour = new Date(message.createdAt).getHours();
      if (!Number.isNaN(hour)) hourly.set(hour, (hourly.get(hour) ?? 0) + 1);

      if (hasUsage(transcriptUsage)) continue;
      const tokens = estimateTokens(message.text);
      const tokensByModel = dailyModelTokens.get(messageDate) ?? {};
      tokensByModel[model] = (tokensByModel[model] ?? 0) + tokens;
      dailyModelTokens.set(messageDate, tokensByModel);
      if (message.role === "assistant") modelUsage[model].outputTokens += tokens;
      else modelUsage[model].inputTokens += tokens;
    }
  }

  const activeDates = new Set(Array.from(daily.entries()).filter(([, value]) => value.sessionCount > 0 || value.messageCount > 0).map(([date]) => date));
  const peak = Array.from(hourly.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  return {
    dailyActivity: Array.from(daily.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({ date, ...value })),
    dailyModelTokens: Array.from(dailyModelTokens.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([date, tokensByModel]) => ({ date, tokensByModel })),
    modelUsage,
    peakActivityHour: peak,
    streaks: streaksForDates(activeDates),
  };
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

function planFromTranscript(transcript: unknown[]): { content?: string; path?: string } | null {
  let content: string | undefined;
  let planPath: string | undefined;
  for (const entry of transcript) {
    const raw = asObject(entry);
    if (raw.type !== "assistant" || raw.parent_tool_use_id || raw.parentToolUseId) continue;
    for (const item of transcriptItems(raw)) {
      const tool = planContentItem(item);
      if (!tool) continue;
      if (tool.name === "ExitPlanMode") {
        content = asString(tool.input.plan) ?? content;
        continue;
      }
      const filePath = asString(tool.input.file_path) ?? asString(tool.input.filePath);
      if (!filePath || !filePath.replace(/\\/g, "/").includes("/.claude/plans/")) continue;
      planPath ??= filePath;
      if (tool.name === "Write") content = asString(tool.input.content) ?? content;
      else if (tool.name === "Edit" && content !== undefined) content = applyPlanEdit(content, tool.input);
      else if (tool.name === "MultiEdit" && Array.isArray(tool.input.edits) && content !== undefined) {
        for (const edit of tool.input.edits) content = applyPlanEdit(content, asObject(edit));
      }
    }
  }
  return content || planPath ? { content, path: planPath } : null;
}

function createSessionHandlers(store: LocalSessionStore, context: IpcHandlerContext, allMethods: readonly string[], bridgeInterface: "LocalSessions" | "LocalAgentModeSessions"): InterfaceHandlers {
  const ptys = new Map<string, { terminal: { write: (data: string) => void; kill: (signal?: string) => void; resize?: (cols: number, rows: number) => void }; buffer: string }>();
  const handlers: InterfaceHandlers = {};

  const dispatchSessionEvent = (type: string, sessionId?: string, session?: unknown) => {
    dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", bridgeInterface, "onEvent", { type, sessionId, session: toBridgeSession(session) });
  };

  const sessionRunner = getSessionRunner(context, bridgeInterface);

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
    const session = store.start({ cwd, prompt, title, origin: "diff-review", permissionMode: "default" });
    dispatchSessionEvent("start", session.id, session);
    sessionRunner.runTurn(session.id, prompt, { cwd, origin: "diff-review" });
    return toBridgeSession(session);
  };

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
    const transcript = sourceId ? store.getTranscript(sourceId) : [];
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
    return { success: true, localOnly: true, mode: "local-handoff", session: toBridgeSession(updated ?? session), readiness };
  };

  const appendPtyData = (sessionId: string, data: Buffer) => {
    const entry = ptys.get(sessionId);
    if (!entry) return;
    entry.buffer += data.toString("utf8");
    if (entry.buffer.length > TEXT_LIMIT_BYTES) entry.buffer = entry.buffer.slice(-TEXT_LIMIT_BYTES);
    dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", bridgeInterface, "onEvent", { type: "shell_pty_data", sessionId, data: data.toString("utf8") });
  };

  const startShell = (sessionId: string, cols?: number, rows?: number) => {
    const cwd = cwdFromSession(store, sessionId) ?? process.cwd();
    ptys.get(sessionId)?.terminal.kill("SIGTERM");
    const shell = defaultShell();
    const nodePty = loadOriginalNodePty();
    if (nodePty) {
      try {
        const terminal = nodePty.spawn(shell.file, shell.args, {
          name: "xterm-256color",
          cols: cols ?? 80,
          rows: rows ?? 24,
          cwd,
          env: { ...process.env, TERM: "xterm-256color" },
        });
        ptys.set(sessionId, { terminal, buffer: "" });
        terminal.onData((data) => appendPtyData(sessionId, Buffer.from(data)));
        terminal.onExit(({ exitCode, signal }) => {
          dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", bridgeInterface, "onEvent", { type: "shell_pty_close", sessionId, code: exitCode, signal });
          ptys.delete(sessionId);
        });
        return true;
      } catch (error) {
        console.warn("[local-sessions] node-pty spawn failed; falling back to child_process shell", error);
      }
    }
    const child = spawn(shell.file, shell.args, { cwd, env: { ...process.env, COLUMNS: String(cols ?? 80), LINES: String(rows ?? 24) } });
    const terminal = {
      write: (data: string) => { child.stdin.write(data); },
      kill: (signal?: string) => { child.kill((signal as NodeJS.Signals | undefined) ?? "SIGTERM"); },
    };
    ptys.set(sessionId, { terminal, buffer: "" });
    child.stdout.on("data", (data: Buffer) => appendPtyData(sessionId, data));
    child.stderr.on("data", (data: Buffer) => appendPtyData(sessionId, data));
    child.on("exit", (code, signal) => {
      dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", bridgeInterface, "onEvent", { type: "shell_pty_close", sessionId, code, signal });
      ptys.delete(sessionId);
    });
    return true;
  };

  const realHandlers: InterfaceHandlers = {
    getAll: async () => toBridgeSessions(store.getAll()),
    getSession: async (_event, id) => (asString(id) ? toBridgeSession(store.getSession(asString(id)!)) : null),
    getTranscript: async (_event, id) => (asString(id) ? store.getTranscript(asString(id)!) : []),
    start: async (_event, input) => {
      const request = asObject(input);
      const session = store.start(request as never);
      dispatchSessionEvent("start", session.id, session);
      const prompt = asString(request.prompt) ?? asString(request.message);
      if (prompt) sessionRunner.runTurn(session.id, prompt, request);
      const scheduledTaskId = asString(request.scheduledTaskId);
      if (scheduledTaskId) {
        const task = context.scheduledTasks.recordRun(scheduledTaskId);
        const payload = { id: scheduledTaskId, status: "ran", source: "manual", sessionId: session.id, task };
        dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", "CCDScheduledTasks", "onScheduledTaskEvent", payload);
        dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", "CoworkScheduledTasks", "onScheduledTaskEvent", payload);
      }
      return toBridgeSession(store.getSession(session.id) ?? session);
    },
    importCliSession: async (_event, input) => {
      const session = store.importSession(asObject(input) as never);
      dispatchSessionEvent("start", session.id, session);
      return toBridgeSession(session);
    },
    updateSession: async (_event, id, input) => {
      const sessionId = asString(id);
      const session = sessionId ? store.update(sessionId, asObject(input) as never) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return toBridgeSession(session);
    },
    sendMessage: async (_event, id, text) => {
      const sessionId = asString(id);
      const session = sessionId && typeof text === "string" ? store.sendMessage(sessionId, text) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      if (sessionId && session && typeof text === "string") sessionRunner.runTurn(sessionId, text);
      return toBridgeSession(sessionId ? store.getSession(sessionId) ?? session : session);
    },
    sendSideChatMessage: async (_event, id, text) => {
      const sessionId = asString(id);
      const session = sessionId && typeof text === "string" ? store.sendMessage(sessionId, text, "user") : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      if (sessionId && session && typeof text === "string") sessionRunner.runTurn(sessionId, text);
      return toBridgeSession(session);
    },
    forkSession: async (_event, id, messageId) => {
      const sessionId = asString(id);
      const session = sessionId ? store.fork(sessionId, asString(messageId) ?? undefined) : null;
      if (session) dispatchSessionEvent("start", session.id, session);
      return toBridgeSession(session);
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
      if (sessionId) sessionRunner.stop(sessionId);
      const ok = sessionId ? store.stop(sessionId) : false;
      if (ok && sessionId) dispatchSessionEvent("stopped", sessionId, store.getSession(sessionId));
      return ok;
    },
    stopTask: async (_event, id) => {
      const sessionId = asString(id);
      if (sessionId) sessionRunner.stop(sessionId);
      const ok = sessionId ? store.stop(sessionId) : false;
      if (ok && sessionId) dispatchSessionEvent("stopped", sessionId, store.getSession(sessionId));
      return ok;
    },
    searchSessions: async (_event, query) => store.search(String(query ?? "")),
    addDirectories: async (_event, id, directories) => {
      const sessionId = asString(id);
      const session = sessionId ? store.addFolders(sessionId, directories) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return toBridgeSession(session);
    },
    addFolderToSession: async (_event, id, folder) => {
      const sessionId = asString(id);
      const session = sessionId ? store.addFolders(sessionId, [folder]) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return toBridgeSession(session);
    },
    addTrustedFolder: async (_event, folder) => {
      const target = asString(folder);
      if (!target) return false;
      store.addTrustedFolder(target);
      return true;
    },
    removeTrustedFolder: async (_event, folder) => {
      const target = asString(folder);
      if (!target) return false;
      store.removeTrustedFolder(target);
      return true;
    },
    getTrustedFolders: async () => store.getTrustedFolders(),
    isFolderTrusted: async (_event, folder) => Boolean(asString(folder) && store.getTrustedFolders().includes(asString(folder)!)),
    checkTrust: async (_event, folder) => ({ trusted: Boolean(asString(folder) && store.getTrustedFolders().includes(asString(folder)!)) }),
    checkRemoteTrust: async () => ({ trusted: false, remote: true }),
    saveTrust: async (_event, folder) => {
      const target = asString(folder);
      if (!target) return false;
      store.addTrustedFolder(target);
      return true;
    },
    getSessionsForScheduledTask: async (_event, scheduledTaskId) => {
      const id = asString(scheduledTaskId) ?? asString(asObject(scheduledTaskId).scheduledTaskId);
      return id ? toBridgeSessions(store.getSessionsForScheduledTask(id)) : [];
    },
    getSupportedCommands: async () => [
      "start",
      "sendMessage",
      "stop",
      "readFileAtCwd",
      "writeSessionFile",
      "getGitInfo",
      "getGitDiff",
      "getGitDiffStats",
      "getDiffFileContent",
      "startShellPty",
      "stopShellPty",
      "writeShellPty",
      "resizeShellPty",
      "getShellPtyBuffer",
    ],
    getSessionsBridgeEnabled: async () => true,
    sessionsBridgeStatus_$store$_getState: async () => ({ enabled: true, status: "ready" }),
    interactiveAuth_$store$_getState: async () => ({ status: "idle" }),
    getContextUsage: async (_event, id) => contextUsageFromTranscript(asString(id) ? store.getTranscript(asString(id)!) : []),
    getCodeStats: async (_event, cwdOrSession) => (cwdOrSession ? getWorkspaceCodeStats(cwdFromSession(store, cwdOrSession)) : getSessionUsageCodeStats(store)),
    getDefaultEffort: async () => "medium",
    getEffort: async (_event, id) => (asString(id) ? store.getSession(asString(id)!)?.effort ?? "medium" : "medium"),
    setEffort: async (_event, id, effort) => toBridgeSession(asString(id) ? store.update(asString(id)!, { effort: String(effort ?? "medium") }) : null),
    getDefaultPermissionMode: async () => "default",
    getPermissionMode: async (_event, id) => (asString(id) ? store.getSession(asString(id)!)?.permissionMode ?? "default" : "default"),
    setPermissionMode: async (_event, id, mode) => toBridgeSession(asString(id) ? store.update(asString(id)!, { permissionMode: String(mode ?? "default") }) : null),
    setModel: async (_event, id, model) => toBridgeSession(asString(id) ? store.update(asString(id)!, { model: String(model ?? "") }) : null),
    setVisibility: async (_event, id, visibility) => toBridgeSession(asString(id) ? store.update(asString(id)!, { visibility: String(visibility ?? "") }) : null),
    setFocusedSession: async () => true,
    setFastMode: async () => true,
    setAutoFixEnabled: async () => true,
    setMcpServers: async (_event, id, mcpServers) => {
      const sessionId = asString(id);
      const session = sessionId ? store.update(sessionId, { mcpServers } as never) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return toBridgeSession(session);
    },
    replaceEnabledMcpTools: async (_event, id, enabledMcpTools) => {
      const sessionId = asString(id);
      const session = sessionId ? store.update(sessionId, { enabledMcpTools: Array.isArray(enabledMcpTools) ? enabledMcpTools : [] } as never) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return toBridgeSession(session);
    },
    replaceRemoteMcpServers: async (_event, id, remoteMcpServers) => {
      const sessionId = asString(id);
      const session = sessionId ? store.update(sessionId, { remoteMcpServers } as never) : null;
      if (sessionId && session) dispatchSessionEvent("session_updated", sessionId, session);
      return toBridgeSession(session);
    },
    setAvailableCodeModels: async () => true,
    setChromePermissionMode: async () => true,
    setDraftSessionFolders: async () => true,
    setSessionsBridgeEnabled: async () => true,
    getBridgeConsent: async () => ({ granted: true }),
    deleteBridgeSession: async () => true,
    deleteBridgeAgentMemory: async () => true,
    abandonBridgeEnvironment: async () => true,
    resetBridge: async () => true,
    resetBridgeSession: async () => true,
    kickBridgePoll: async () => true,
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
      dispatchBridgeEvent(context.windows.mainView.webContents, "claude.web", bridgeInterface, "onEvent", {
        type: result.ok === false ? "tool_permission_response_failed" : "tool_permission_resolved",
        sessionId: id,
        requestId: request,
        decision: mode,
        result,
      });
      return result;
    },
    respondBridgePermissionPreflight: async () => true,
    respondDirectoryServers: async () => true,
    respondPluginSearch: async () => true,
    respondSlashMenuSkills: async () => true,
    submitFeedback: async () => ({ ok: true }),
    submitTranscriptFeedback: async (_event, sessionIdOrInput, input) => submitTranscriptFeedback(sessionIdOrInput, input),
    getTranscriptFeedback: async (_event, sessionId) => getTranscriptFeedback(sessionId),
    shareSession: async (_event, id) => ({ ok: true, id, localOnly: true }),
    summarizeSession: async (_event, id) => {
      const transcript = asString(id) ? store.getTranscript(asString(id)!) : [];
      return transcript.map(textFromTranscriptItem).join("\n").slice(0, 1000);
    },
    summarizeTranscript: async (_event, transcript) => Array.isArray(transcript) ? transcript.map(textFromTranscriptItem).join("\n").slice(0, 1000) : "",
    getPlanForSession: async (_event, id) => {
      const sessionId = asString(id) ?? asString(asObject(id).sessionId);
      return sessionId ? planFromTranscript(store.getTranscript(sessionId)) : null;
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
    getDirectMcpServerStatuses: async () => configuredMcpServers(context).map(([name, config]) => describeMcpServer(name, config)),
    authorizeDirectMcpServer: async (_event, serverName) => ({ ok: true, serverName, authorized: true }),
    disconnectDirectMcpServer: async () => true,
    getLocalSkillFiles: async (_event, skillRef) => getLocalSkillFiles(skillRef),
    listLocalSkills: async () => listLocalSkills(),
    syncSkills: async () => listLocalSkills(),
    deleteLocalSkill: async (_event, skillRef) => deleteLocalSkill(skillRef),
    saveLocalSkill: async (_event, skillInput, filesInput) => saveLocalSkill(skillInput, filesInput),
    revealLocalSkill: async (_event, skillRef) => revealLocalSkill(skillRef),
    setLocalSkillEnabled: async (_event, skillRef, enabled) => setLocalSkillEnabled(skillRef, enabled),
    noteCuWindowMentions: async () => true,
    triggerInteractiveAuth: async () => ({ ok: false, reason: "interactive_auth_not_required" }),
    revokeInteractiveAuth: async () => true,
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
      const server = mcpServerConfig(context, serverName);
      const name = asString(toolName) ?? asString(asObject(toolName).name);
      if (!server) return { ok: false, error: "mcp_server_not_configured", serverName };
      if (!name) return { ok: false, error: "missing_mcp_tool_name", serverName };
      return requestMcpServer({ serverName: server.name, config: server.config, method: "tools/call", params: { name, arguments: asObject(input) } });
    },
    requestFolderTccAccess: async () => ({ granted: true }),
    openOutputsDir: async () => {
      await shell.openPath(store.getOutputsDir());
      return true;
    },
    listSessionDirectory: async (_event, id, relative = ".") => {
      const sessionId = asString(id);
      if (!sessionId) return [];
      const target = resolveSessionFile(store, sessionId, String(relative ?? "."));
      if (!target) return [];
      await fs.mkdir(target, { recursive: true });
      return listDirectory(target);
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
    writeSessionFile: async (_event, id, relative, content) => {
      const sessionId = asString(id);
      if (!sessionId) return null;
      const target = resolveSessionFile(store, sessionId, String(relative ?? "file.txt"));
      if (!target) return null;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, typeof content === "string" ? content : JSON.stringify(content, null, 2));
      return target;
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
    listSSHDirectory: async (_event, directory) => listDirectory(path.resolve(String(directory ?? app.getPath("home")))),
    validateSSHPath: async (_event, filePath) => {
      try { await fs.access(String(filePath)); return { valid: true }; } catch { return { valid: false }; }
    },
    checkGhAvailable: async () => ({ available: await commandExists("gh") }),
    installGh: async () => {
      await shell.openExternal("https://cli.github.com/");
      return true;
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
    getPrStateForBranch: async (_event, cwdOrSession, branch) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const pull = await githubPullForBranch(cwd, asString(branch));
      if (!pull) return null;
      const raw = asObject(pull);
      return { number: raw.number, state: raw.state, title: raw.title, url: raw.html_url, draft: raw.draft, merged: raw.merged_at !== null && raw.merged_at !== undefined };
    },
    createLocalPr: async (_event, cwdOrSession, title, body) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const args = ["pr", "create"];
      if (asString(title)) args.push("--title", asString(title)!);
      if (asString(body)) args.push("--body", asString(body)!);
      if (!asString(title) && !asString(body)) args.push("--fill");
      return runProcess(cwd, "gh", args, 30000);
    },
    generateLocalPrContent: async (_event, cwdOrSession) => generatePrContent(cwdFromSession(store, cwdOrSession)),
    updatePrBody: async (_event, cwdOrSession, prNumber, body) => runProcess(cwdFromSession(store, cwdOrSession), "gh", ["pr", "edit", String(prNumber ?? ""), "--body", String(body ?? "")], 30000),
    mergePr: async (_event, cwdOrSession, prNumber) => runProcess(cwdFromSession(store, cwdOrSession), "gh", ["pr", "merge", String(prNumber ?? ""), "--merge"], 30000),
    getGitInfo: async (_event, cwdOrSession) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const root = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
      const branch = await runGit(cwd, ["branch", "--show-current"]);
      const remote = await runGit(cwd, ["remote", "-v"]);
      return { cwd, root: root.ok ? String(root.stdout ?? "").trim() : null, branch: branch.ok ? String(branch.stdout ?? "").trim() : null, remotes: remote.ok ? String(remote.stdout ?? "").trim() : "" };
    },
    getWorkingTreeStatus: async (_event, cwdOrSession) => runGitInRepository(cwdFromSession(store, cwdOrSession), ["status", "--short", "--branch"]),
    getUncommittedChanges: async (_event, cwdOrSession) => runGit(cwdFromSession(store, cwdOrSession), ["status", "--porcelain=v1"]),
    isWorkingTreeDirty: async (_event, cwdOrSession) => {
      const result = await runGit(cwdFromSession(store, cwdOrSession), ["status", "--porcelain=v1"]);
      return result.ok && String(result.stdout ?? "").trim().length > 0;
    },
    getGitDiff: async (_event, cwdOrSession, base) => runGitInRepository(cwdFromSession(store, cwdOrSession), ["diff", ...gitDiffArgs(base)]),
    getGitDiffStats: async (_event, cwdOrSession, base) => runGitInRepository(cwdFromSession(store, cwdOrSession), ["diff", "--stat", ...gitDiffArgs(base)]),
    getDiffFileContent: async (_event, cwdOrSession, refOrFilePath, filePath, previousFilePath) => {
      const ref = asString(filePath) ? String(refOrFilePath || "HEAD") : "HEAD";
      const target = asString(filePath) ? String(previousFilePath || filePath) : String(refOrFilePath ?? "");
      return runGit(cwdFromSession(store, cwdOrSession), ["show", `${ref}:${target}`]);
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
    respondToSSHPassword: async () => true,
    testSSHConnection: async (_event, host) => {
      const target = asString(host) ?? asString(asObject(host).host);
      if (!target) return { ok: false, reason: "missing_ssh_host" };
      return runProcess(process.cwd(), "ssh", ["-G", target], 10000);
    },
    ensureSSHConnected: async (_event, host) => {
      const target = asString(host) ?? asString(asObject(host).host);
      if (!target) return { ok: false, reason: "missing_ssh_host" };
      return runProcess(process.cwd(), "ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", target, "true"], 10000);
    },
    ensureBranchPushed: async (_event, cwdOrSession) => gitSuccess(cwdFromSession(store, cwdOrSession), ["push", "-u", "origin", "HEAD"]),
    commitAllChanges: async (_event, cwdOrSession, message) => {
      const cwd = cwdFromSession(store, cwdOrSession);
      const add = await runGit(cwd, ["add", "-A"]);
      if (!add.ok) return { success: false, error: String(add.stderr || add.stdout || "git add failed") };
      return gitSuccess(cwd, ["commit", "-m", String(message ?? "WIP")]);
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
        origin: "sidechat",
        prompt,
        title: asString(request.title) ?? (parent ? `${parent.title} side chat` : "Side chat"),
      } as never);
      const updated = store.update(session.id, { metadata: { ...(session.metadata ?? {}), sideChat: true, parentSessionId: parentId } });
      dispatchSessionEvent("start", session.id, updated ?? session);
      if (prompt) sessionRunner.runTurn(session.id, prompt, request);
      return toBridgeSession(updated ?? session);
    },
    stopSideChat: async (_event, id) => {
      const sessionId = asString(id) ?? asString(asObject(id).sessionId);
      if (sessionId) sessionRunner.stop(sessionId);
      const stopped = sessionId ? store.stop(sessionId) : false;
      if (sessionId && stopped) dispatchSessionEvent("stopped", sessionId, store.getSession(sessionId));
      return stopped;
    },
    stopSessionSummary: async () => true,
    cancelQueuedMessage: async () => true,
    enableAutoMerge: async () => true,
    disableAutoMerge: async () => true,
    releaseWorktree: async () => true,
    rewind: async (_event, id, messageId) => {
      const sessionId = asString(id);
      if (sessionId) sessionRunner.stop(sessionId);
      const session = sessionId ? store.rewind(sessionId, asString(messageId) ?? undefined) : null;
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
    logCliEvent: async () => true,
  };

  const allowedMethods = new Set<string>(allMethods);
  for (const [method, handler] of Object.entries(realHandlers)) {
    if (allowedMethods.has(method)) handlers[method] = handler;
  }
  const missingMethods = allMethods.filter((method) => !(method in handlers));
  if (missingMethods.length > 0) throw new Error(`Missing LocalSessions handler implementations: ${missingMethods.join(", ")}`);
  return handlers;
}

export function registerLocalSessionsHandlers(context: IpcHandlerContext): void {
  registerInterfaceHandlers("claude.web", "LocalSessions", createSessionHandlers(context.localSessions, context, LOCAL_SESSIONS_METHODS, "LocalSessions"), "claude.web.LocalSessions");
  registerInterfaceHandlers("claude.web", "LocalAgentModeSessions", createSessionHandlers(context.localAgentModeSessions, context, LOCAL_AGENT_METHODS, "LocalAgentModeSessions"), "claude.web.LocalAgentModeSessions");
  registerInterfaceHandlers("claude.web", "LocalSessionEnvironment", {
    get: async () => ({ env: {}, userData: app.getPath("userData") }),
    save: async () => true,
  }, "claude.web.LocalSessionEnvironment");
}
