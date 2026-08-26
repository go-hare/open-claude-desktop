import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { app } from "electron";
import {
  buildClaudeCliSpawnEnv,
  enrichClaudeCliSpawnEnvWithEnterpriseAuth,
  readAppliedCustom3pFromDesktopShellSettings,
  resolveCliModelArg,
  type Custom3pEnterpriseConfig,
} from "../custom3p/custom3pCliEnv";
import { resolveDeploymentModeFromUserData } from "../custom3p/deploymentMode";
import { resolveEnterpriseDisallowedTools } from "../coworkHostLoop/coworkEnterpriseConfig";
import {
  accumulateEnterpriseTokenUsage,
  assertEnterpriseTokenCapAllowsTurn,
} from "../coworkHostLoop/coworkTokenCap";
import { getLocalSessionEnvironmentSync } from "./localSessionEnvironmentStore";
import type { LocalSession, LocalSessionStore, LocalToolPermissionRequest } from "./localSessionStore";
import { resolveSshRemoteCwd, spawnClaudeOverSsh } from "./sshCliSpawn";
import { getClaudePreviewCliMcpConfigCache, setClaudePreviewSessionCwd } from "../launch/claudePreviewHostRegistry";
import { asMcpServerMap, toCliMcpConfigWire } from "./mcpConfigWire";
import {
  resolveTurnPermissionMode,
  shouldReassertRunningFromAssistantMessage,
  shouldSignalTurnCompleteFromCliMessage,
} from "./claudeCliTurnLifecycle";
import {
  buildCodeSdkUserMessage,
  closeCodeSdkSession,
  createCodeSdkActiveSession,
  officialSessionDestinationSuggestions,
  parseClaudeProcessExitCode,
  resolveCodeSdkPermission,
  type CodeSdkActiveSession,
} from "./codeSdkQuerySession";

type RunnerCallbacks = {
  onEvent: (event: Record<string, unknown>) => void;
  onSessionUpdated: (sessionId: string) => void;
  /**
   * Official NotificationService.requestUserAttention residual — fire when a
   * tool_permission_request is presented and the app is not focused.
   * dockBounceEnabled is checked inside the attention service.
   */
  onPermissionAttention?: () => void;
  /** Official stopFlashFrame residual — cancel bounce / flashFrame(false). */
  onPermissionAttentionStop?: () => void;
  /**
   * Official gi("bypassPermissionsModeEnabled") — clamp spawn --permission-mode.
   * Missing reader → treat as false (do not invent bypass enabled).
   */
  isBypassPermissionsModeEnabled?: () => boolean;
  /**
   * Official vu.shouldAutoApprovePermission residual (ScheduledTaskStore).
   */
  shouldAutoApproveScheduledPermission?: (
    scheduledTaskId: string,
    toolName: string,
    suggestions: unknown,
  ) => boolean;
  /**
   * Official addApprovedPermissions residual after always on scheduled runs.
   */
  addScheduledTaskApprovedPermissions?: (
    scheduledTaskId: string,
    suggestions: unknown,
  ) => void;
};

type ToolPermissionDecision = "always" | "deny" | "once";
const CONTROL_REQUEST_TIMEOUT_MS = 15_000;
/**
 * Official LocalSessionManager `kkA=1500` residual — interruptSession races
 * query.interrupt() against this timeout; general control_request stays 15s.
 */
const OFFICIAL_INTERRUPT_TIMEOUT_MS = 1_500;
/** CLI residual `MODEL_CONTEXT_WINDOW_DEFAULT` (claude-code-bin context.ts). */
const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000;
/** Official / CLI model tags like `claude-sonnet-4-5[1m]` or `[200k]`. */
const contextWindowPattern = /\[(\d+(?:\.\d+)?)\s*([km])\]/i;
const FREE_SPACE_CATEGORY = "Free space";
const AUTOCOMPACT_CATEGORY = "Autocompact buffer";
const COMPACT_BUFFER_CATEGORY = "Compact buffer";

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function stringList(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [value];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      const record = asRecord(item);
      return stringValue(record.name) ?? stringValue(record.toolName) ?? stringValue(record.id);
    })
    .filter((item): item is string => Boolean(item));
}

function jsonValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (!value || (typeof value !== "object" && !Array.isArray(value))) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function pushStringOption(args: string[], flag: string, value: unknown): void {
  const text = stringValue(value);
  if (text) args.push(flag, text);
}

function pushListOption(args: string[], flag: string, value: unknown): void {
  const values = stringList(value);
  if (values.length > 0) args.push(flag, ...values);
}

function pushJsonOption(args: string[], flag: string, value: unknown): void {
  const text = jsonValue(value);
  if (text) args.push(flag, text);
}

function pushCliMcpConfig(args: string[], value: unknown): void {
  const wire = toCliMcpConfigWire(value);
  if (wire) pushJsonOption(args, "--mcp-config", wire);
}

function claudeBinaryName(): string {
  return process.platform === "win32" ? "claude.exe" : "claude";
}

/** Same key layout as scripts/copy-claude-code-binary.mjs platforms/<key>/. */
function hostPlatformKey(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return `darwin-${arch}`;
  if (process.platform === "win32") return `win32-${arch}`;
  if (process.platform === "linux") return `linux-${arch}`;
  return `${process.platform}-${arch}`;
}

/**
 * Prefer platforms/<host>/claude (binary + vendor co-located). Top-level copy
 * is secondary — without sibling vendor Glob/Grep ENOENT on bunfs vendor path.
 */
function claudeBinCandidatesUnder(root: string): string[] {
  const binaryName = claudeBinaryName();
  return [
    path.join(root, "platforms", hostPlatformKey(), binaryName),
    path.join(root, binaryName),
  ];
}

export function bundledClaudeExecutableCandidates(): string[] {
  const roots = [
    process.env.CLAUDE_DESKTOP_RESOURCES_ROOT
      ? path.join(process.env.CLAUDE_DESKTOP_RESOURCES_ROOT, "claude-code-bin")
      : undefined,
    process.resourcesPath ? path.join(process.resourcesPath, "claude-code-bin") : undefined,
    path.resolve(process.cwd(), "resources", "claude-code-bin"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const candidates = roots.flatMap((root) => claudeBinCandidatesUnder(root));
  return [...new Set(candidates)];
}

export function bundledClaudeExecutable(): string | undefined {
  return bundledClaudeExecutableCandidates().find((candidate) => fs.existsSync(candidate));
}

export function defaultClaudeExecutable(): string {
  if (process.env.CLAUDE_CODE_EXECUTABLE) return process.env.CLAUDE_CODE_EXECUTABLE;
  const bundled = bundledClaudeExecutable();
  if (bundled) return bundled;
  if (process.platform !== "win32") return "claude";
  const candidates = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "@go-hare", "claude-code", "bin", "claude.exe") : undefined,
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe") : undefined,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".bun", "bin", "claude.exe") : undefined,
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate))) ?? "claude.cmd";
}

/**
 * Official HFi residual (product host local-session spawn):
 * process.env + userData local-session-environment + applied custom3p from
 * userData/desktop-shell-settings.json (G4 + sessionEnvVars) — not ~/.claude as primary 3p source.
 */
function resolveDesktopUserDataPath(): string | undefined {
  try {
    return app.getPath("userData");
  } catch {
    return process.env.CLAUDE_USER_DATA_DIR || undefined;
  }
}

function resolveLocalSessionEnvironment(userDataPath: string | undefined): Record<string, string> {
  try {
    // Never pass undefined into path.join (would create "undefined/local-session-environment.json").
    return userDataPath
      ? getLocalSessionEnvironmentSync(userDataPath)
      : getLocalSessionEnvironmentSync();
  } catch {
    return {};
  }
}

/** Sync residual only (Vertex ADC file / OTLP / bag). Prefer resolveClaudeSpawnEnvAsync before spawn. */
export function resolveClaudeSpawnEnv(): Record<string, string | undefined> {
  const userDataPath = resolveDesktopUserDataPath();
  return buildClaudeCliSpawnEnv({
    processEnv: process.env,
    localSessionEnv: resolveLocalSessionEnvironment(userDataPath),
    userDataPath,
  });
}

/**
 * Official writeSessionSecrets residual — sync bag + async Bedrock SSO / credential helper TTL.
 */
export async function resolveClaudeSpawnEnvAsync(): Promise<
  Record<string, string | undefined>
> {
  const userDataPath = resolveDesktopUserDataPath();
  const base = buildClaudeCliSpawnEnv({
    processEnv: process.env,
    localSessionEnv: resolveLocalSessionEnvironment(userDataPath),
    userDataPath,
  });
  return enrichClaudeCliSpawnEnvWithEnterpriseAuth(base, { userDataPath });
}

export async function spawnClaude(
  executable: string,
  args: string[],
  cwd: string,
): Promise<ChildProcessWithoutNullStreams> {
  const env = await resolveClaudeSpawnEnvAsync();
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    return spawn("cmd.exe", ["/d", "/s", "/c", executable, ...args], {
      cwd,
      env,
      windowsHide: true,
    });
  }
  return spawn(executable, args, { cwd, env, windowsHide: true });
}

/**
 * Official WZ(sshConfig) → eAr kind ssh + configureSSHSpawn residual (product host-pipe):
 * when session.sshConfig is set, spawn remote `claude` over ssh instead of local binary.
 */
export async function spawnClaudeForSession(
  session: LocalSession,
  executable: string,
  args: string[],
  cwd: string,
): Promise<ChildProcessWithoutNullStreams> {
  if (session.sshConfig) {
    const remoteCwd = resolveSshRemoteCwd(session);
    return spawnClaudeOverSsh({
      sshConfig: session.sshConfig,
      remoteCwd,
      args,
      hostEnv: await resolveClaudeSpawnEnvAsync(),
      localCwd: process.cwd(),
    });
  }
  return spawnClaude(executable, args, cwd);
}

function resolveCwd(session: LocalSession): string {
  // SSH sessions use remote paths — do not require host existence.
  if (session.sshConfig) {
    return session.cwd || session.sshConfig.remoteCwd || process.cwd();
  }
  if (session.cwd && fs.existsSync(session.cwd)) return session.cwd;
  return process.cwd();
}

function normalizePermissionMode(value: string | undefined): string | undefined {
  const mapped = value === "bypass" ? "bypassPermissions" : value;
  return mapped && ["acceptEdits", "bypassPermissions", "default", "dontAsk", "plan", "auto"].includes(mapped) ? mapped : undefined;
}

/**
 * Result of informing the live CLI (or noting there is no active turn).
 * Official CCD: store updates only after query.setPermissionMode succeeds when
 * session.query is present; no query → host-only (cli_informed:false).
 */
export type SetPermissionModeCliResult =
  | { status: "no_turn" }
  | { status: "informed" }
  | { status: "failed"; error: string };

/**
 * Official CLI 2.7.14 --effort: low|medium|high|xhigh|max|ultracode.
 * Do not collapse xhigh→max or drop ultracode (host fidelity for Effort slider).
 */
function normalizeEffort(value: string | undefined): string | undefined {
  return value && ["low", "medium", "high", "xhigh", "max", "ultracode"].includes(value) ? value : undefined;
}

/** Ladder levels only — "ultracode" is a session flag + top-effort alias, not a 6th level. */
const EFFORT_LADDER = ["low", "medium", "high", "xhigh", "max"] as const;

/**
 * Official apply_flag_settings mapping:
 *   - effortLevel "ultracode"  → ultracode:true, wire = catalog top (host: max, shell xhigh)
 *   - ultracode:true (+level?) → same top-effort wire
 *   - ultracode:false + level  → that level, flag cleared
 *   - effortLevel null         → clear session effort (host default takes over)
 * Host store keeps a single `effort` column; ultracode == wire "ultracode".
 */
export function parseEffortFlagSettings(
  settings: Record<string, unknown>,
  currentEffort: string | undefined,
): { effort?: string; clear?: boolean } | null {
  const hasKey = (key: string) => Object.prototype.hasOwnProperty.call(settings, key);
  const ultracodeValue = booleanValue(asRecord(settings).ultracode as boolean | undefined);
  const rawLevel = settings.effortLevel;
  const rawStr = typeof rawLevel === "string" ? rawLevel.trim().toLowerCase() : "";
  if (rawLevel === null && !hasKey("ultracode")) return { clear: true };
  if (rawStr === "ultracode" || ultracodeValue === true) return { effort: "ultracode" };
  if (rawStr && (EFFORT_LADDER as readonly string[]).includes(rawStr)) return { effort: rawStr };
  if (ultracodeValue === false) {
    if (currentEffort === "ultracode") return { effort: rawStr && (EFFORT_LADDER as readonly string[]).includes(rawStr) ? rawStr : "medium" };
    if (rawStr) return { effort: rawStr };
    return null;
  }
  if (rawLevel === null) return { clear: true };
  if (rawStr) return null; // unknown level → ignore (CLI would soft-warn)
  return null;
}

/**
 * Map UI / session model → CLI --model.
 * With applied configLibrary bag, drop shell-leaked ids (grok/kimi) and map shortnames to bag.
 */
function normalizeModel(
  value: string | undefined,
  enterprise?: Custom3pEnterpriseConfig | null,
): string | undefined {
  return resolveCliModelArg(value, enterprise ?? null);
}

function resolveAppliedEnterpriseForSpawn(): Custom3pEnterpriseConfig | null {
  try {
    const userDataPath = resolveDesktopUserDataPath();
    if (!userDataPath) return null;
    // dotClaude: spawn routing is ~/.claude, not configLibrary. Using bag
    // inferenceModels here would allow --model deepseek-v4-pro against a
    // multi-provider gateway that only knows grok/kimi → API 502 unknown provider.
    const snapshot = resolveDeploymentModeFromUserData(userDataPath);
    if (
      snapshot.resolution.mode === "dotClaude"
      || snapshot.resolution.persistedDeploymentMode === "dotClaude"
    ) {
      const models =
        snapshot.dotClaudeConfig?.models
        ?? (snapshot.dotClaudeConfig?.model ? [snapshot.dotClaudeConfig.model] : []);
      if (models.length === 0) return null;
      return {
        inferenceProvider: "gateway",
        inferenceModels: models.map((name) => ({ name })),
      };
    }
    return readAppliedCustom3pFromDesktopShellSettings(userDataPath).enterprise;
  } catch {
    return null;
  }
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((item) => {
      const record = asRecord(item);
      const kind = stringValue(record.type) ?? stringValue(record.kind);
      if (kind === "text" || kind === "error") {
        return stringValue(record.text) ?? stringValue(record.content);
      }
      return undefined;
    })
    .filter((text): text is string => Boolean(text));
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function assistantTextFromEvent(event: Record<string, unknown>): string | undefined {
  const type = stringValue(event.type);
  const message = asRecord(event.message);
  if (type === "assistant") {
    return stringValue(event.text) ?? stringValue(message.text) ?? stringValue(message.content) ?? contentText(message.content);
  }
  if (type === "result") return stringValue(event.result) ?? stringValue(event.response);
  return undefined;
}

function buildClaudeArgs(
  session: LocalSession,
  request: Record<string, unknown>,
  cliSessionId: string,
  resume: boolean,
  forkSession = false,
  options: { bypassPermissionsModeEnabled?: boolean } = {},
): string[] {
  const sessionRaw = asRecord(session);
  // Official CLI (claude-code main.tsx): --include-partial-messages requires --print
  // and --output-format=stream-json. Without --print, QueryEngine never yields
  // stream_event deltas → UI only sees final assistant blobs (no typewriter).
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--input-format",
    "stream-json",
    "--permission-prompt-tool",
    "stdio",
    "--include-partial-messages",
  ];
  args.push(resume ? "--resume" : "--session-id", cliSessionId);
  if (forkSession) args.push("--fork-session");
  pushStringOption(args, "--name", request.title ?? session.title);

  const enterprise = resolveAppliedEnterpriseForSpawn();
  const model =
    normalizeModel(stringValue(request.model), enterprise)
    ?? normalizeModel(session.model, enterprise);
  if (model) args.push("--model", model);

  // Official clamp (app.asar): bypassPermissions && !gi("bypassPermissionsModeEnabled") → acceptEdits.
  // Host session.permissionMode is authoritative when web omits mode on send/start.
  // Do not let empty request.permissionMode invent "default" over store bypass.
  let permissionMode = normalizePermissionMode(
    resolveTurnPermissionMode(request.permissionMode, session.permissionMode),
  );
  if (permissionMode === "bypassPermissions" && options.bypassPermissionsModeEnabled !== true) {
    permissionMode = "acceptEdits";
  }
  if (permissionMode) {
    if (permissionMode === "bypassPermissions") args.push("--allow-dangerously-skip-permissions");
    args.push("--permission-mode", permissionMode);
  }

  const effort = normalizeEffort(stringValue(request.effort) ?? session.effort);
  if (effort) args.push("--effort", effort);

  const folders = uniqueStrings([...(session.folders ?? []), ...(session.userSelectedFolders ?? []), ...(Array.isArray(request.additionalDirectories) ? request.additionalDirectories : [])]);
  for (const folder of folders.filter((folder) => folder !== session.cwd)) args.push("--add-dir", folder);
  pushStringOption(args, "--system-prompt", request.systemPrompt ?? sessionRaw.systemPrompt);
  pushStringOption(args, "--append-system-prompt", request.systemPromptAppend ?? request.appendSystemPrompt ?? sessionRaw.systemPromptAppend);
  pushStringOption(args, "--agent", request.agent ?? sessionRaw.agent);
  pushJsonOption(args, "--agents", request.agents ?? sessionRaw.agents);
  // Official InternalMcp Claude Preview (voA) for ccd: inject when Launch enabled.
  // CLI cannot load SDK instances → host HTTP bridge config (serializable bare map).
  // Wire format for --mcp-config must wrap as { mcpServers } (parseMcpConfig residual).
  // SSH residual: official isEnabled requires !isSSH — skip for ssh sessions.
  const previewCliMcp =
    session.sshConfig
      ? null
      : getClaudePreviewCliMcpConfigCache();
  const baseMcp =
    request.mcpServers
    ?? sessionRaw.mcpServers
    ?? undefined;
  const mergedMcpServers = {
    ...asMcpServerMap(baseMcp),
    ...asMcpServerMap(previewCliMcp),
  };
  pushCliMcpConfig(args, mergedMcpServers);
  pushCliMcpConfig(args, request.remoteMcpServers ?? sessionRaw.remoteMcpServers);
  pushListOption(args, "--allowedTools", request.enabledMcpTools ?? request.allowedTools ?? sessionRaw.enabledMcpTools);
  // Official d0A(Ti()) residual — merge enterprise disabledBuiltinTools into CLI disallowedTools.
  {
    const fromRequest = stringList(
      request.disallowedTools ?? sessionRaw.disallowedTools,
    );
    const fromEnterprise = resolveEnterpriseDisallowedTools();
    const merged = [...new Set([...fromRequest, ...fromEnterprise])];
    pushListOption(args, "--disallowedTools", merged.length > 0 ? merged : undefined);
  }
  pushListOption(args, "--tools", request.tools ?? sessionRaw.tools);
  const settingSources = stringList(request.settingSources);
  if (settingSources.length > 0) args.push("--setting-sources", settingSources.join(","));
  // Official host createWorktree already leased path into session.cwd — do not also
  // pass bare --worktree (would double-create). Only pass when host has not attached.
  const useWorktree = request.useWorktree === true || session.useWorktree === true;
  if (useWorktree && !session.worktreePath) {
    args.push("--worktree");
    const worktreeName = stringValue(request.worktreeName) ?? session.worktreeName;
    if (worktreeName) args.push(worktreeName);
  }

  return args;
}

/**
 * Official stream-json user line. When `messageUuid` is set (desktop start/send),
 * stamp it as outer `uuid` so the CLI jsonl echo shares identity with the live-tail
 * seed → getTranscript uuid-dedupe drops the seed (no double user bubble).
 */
/**
 * Build CLI stream-json user line. Optional images → Anthropic content blocks
 * (type image / source base64) so preview-annotation / paste images reach the model.
 */
function userInputLine(
  prompt: string,
  messageUuid?: string,
  images?: unknown,
): string {
  const content: Array<Record<string, unknown>> = [];
  const imageList = Array.isArray(images) ? images : [];
  for (const raw of imageList) {
    const record = asRecord(raw);
    const base64 =
      stringValue(record.base64)
      ?? stringValue(record.data)
      ?? stringValue(record.media);
    if (!base64) continue;
    // Strip data-URL prefix if a caller passed a full dataUrl.
    const comma = base64.indexOf(",");
    const data =
      base64.startsWith("data:") && comma >= 0 ? base64.slice(comma + 1) : base64;
    const mediaType =
      stringValue(record.mimeType)
      ?? stringValue(record.media_type)
      ?? stringValue(record.mediaType)
      ?? "image/png";
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data,
      },
    });
  }
  if (prompt.trim().length > 0) {
    content.push({ type: "text", text: prompt });
  } else if (content.length === 0) {
    content.push({ type: "text", text: prompt });
  }
  const payload: Record<string, unknown> = {
    type: "user",
    session_id: "",
    message: {
      role: "user",
      content,
    },
    parent_tool_use_id: null,
  };
  if (messageUuid && messageUuid.length > 0) {
    payload.uuid = messageUuid;
    // Some CLI residual paths also honor messageUuid on the envelope.
    payload.messageUuid = messageUuid;
  }
  return `${JSON.stringify(payload)}\n`;
}

function promptWithSelectedFiles(prompt: string, userSelectedFiles: unknown): string {
  const files = stringList(userSelectedFiles);
  if (files.length === 0) return prompt;
  if (/<uploaded_files>[\s\S]*?<\/uploaded_files>/.test(prompt)) return prompt;
  const uploadedFiles = files.map((file) => `<file><file_path>${file}</file_path></file>`).join("\n");
  return `<uploaded_files>\n${uploadedFiles}\n</uploaded_files>\n\n${prompt}`;
}

function writeJsonLine(child: ChildProcessWithoutNullStreams, value: Record<string, unknown>): boolean {
  if (child.stdin.destroyed || child.stdin.writableEnded) return false;
  child.stdin.write(`${JSON.stringify(value)}\n`);
  return true;
}

/**
 * Remove UI routing fields so they are not forwarded as tool updatedInput.
 * Official Mme (index-BELzQL5P) keeps `_targetMode` / `_feedbackMessage` on the payload:
 * - ExitPlanMode once → updatedPermissions setMode from `_targetMode`
 * - deny → message from `_feedbackMessage`
 */
function stripBridgePermissionFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { sessionId: _sessionId, session_id: _session_id, ...rest } = value as Record<string, unknown>;
  return rest;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function controlResponsePayload(event: Record<string, unknown> | null, requestId: string): unknown | undefined {
  if (!event || stringValue(event.type) !== "control_response") return undefined;
  const response = asRecord(event.response);
  const responseRequestId = stringValue(response.request_id) ?? stringValue(event.request_id);
  if (responseRequestId !== requestId) return undefined;
  return stringValue(response.subtype) === "success" ? response.response ?? null : null;
}

/** Official get_settings.applied → normalized effort bag (effort / effortLevels / ultracodeOfferable). */
function parseAppliedEffortBag(response: unknown): {
  effort: string | null;
  effortLevels: string[] | null;
  ultracodeOfferable: boolean | null;
} {
  const applied = asRecord(asRecord(response).applied);
  const effortRaw = stringValue(applied.effort);
  // densable ladder may report catalog-top (high) while ultracode is a separate flag.
  // Host wire is a single effort column: ultracode:true → effort "ultracode".
  const ultracodeFlag = applied.ultracode === true;
  const effortFromLevel = normalizeEffort(effortRaw) ? effortRaw! : null;
  const effort =
    ultracodeFlag || effortFromLevel === "ultracode"
      ? "ultracode"
      : effortFromLevel;
  const effortLevels = Array.isArray(applied.effortLevels)
    ? (applied.effortLevels as unknown[]).filter((v): v is string => typeof v === "string" && normalizeEffort(v) !== undefined)
    : null;
  const ultracodeOfferable = typeof applied.ultracodeOfferable === "boolean" ? applied.ultracodeOfferable : null;
  return { effort, effortLevels: effortLevels && effortLevels.length > 0 ? effortLevels : null, ultracodeOfferable };
}

function usageFromEvent(event: unknown) {
  const raw = asRecord(event);
  const message = asRecord(raw.message);
  const usage = asRecord(message.usage ?? raw.usage);
  const cacheCreationInputTokens = numberValue(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens);
  const cacheReadInputTokens = numberValue(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens);
  const inputTokens = numberValue(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = numberValue(usage.output_tokens ?? usage.outputTokens);
  const totalTokens = cacheCreationInputTokens + cacheReadInputTokens + inputTokens;
  if (totalTokens <= 0 && outputTokens <= 0) return null;
  return { cacheCreationInputTokens, cacheReadInputTokens, inputTokens, outputTokens, totalTokens };
}

function contextWindowTokensFromText(value: unknown): number | null {
  const text = stringValue(value);
  if (!text) return null;
  const match = contextWindowPattern.exec(text);
  if (!match?.[1]) return null;
  const amount = Number.parseFloat(match[1]);
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : 1_000;
  return Number.isFinite(amount) ? Math.round(amount * multiplier) : null;
}

/**
 * CLI residual getContextWindowForModel: `[1m]`/`[Nk]` tags first, else default 200k.
 * 3p models like `deepseek-v4-pro` have no tag — still need a max so Ku can paint Free space.
 */
function resolveContextWindowTokens(...values: unknown[]): number | null {
  for (const value of values) {
    const tagged = contextWindowTokensFromText(value);
    if (tagged && tagged > 0) return tagged;
  }
  for (const value of values) {
    if (stringValue(value)) return MODEL_CONTEXT_WINDOW_DEFAULT;
  }
  return null;
}

function positiveNumber(value: unknown): number | null {
  const n = typeof value === "number" && Number.isFinite(value) ? value : null;
  return n !== null && n > 0 ? n : null;
}

function categoryName(row: unknown): string {
  return stringValue(asRecord(row).name) ?? "";
}

function categoryTokens(row: unknown): number {
  return numberValue(asRecord(row).tokens);
}

function isDeferredContextCategory(name: string): boolean {
  return /\(deferred\)$/i.test(name);
}

function isReservedContextCategory(name: string): boolean {
  return name === AUTOCOMPACT_CATEGORY || name === COMPACT_BUFFER_CATEGORY;
}

/**
 * CLI analyzeContextUsage residual: freeTokens = max(0, contextWindow - actualUsage - reservedTokens)
 * and always push `{ name: "Free space", tokens: freeTokens }`. Host stored fallback and partial
 * live payloads must match so Ku segment widths use used+free (not used-only 100%).
 */
function ensureFreeSpaceCategory(
  categories: Array<Record<string, unknown>>,
  rawMaxTokens: number,
  fallbackUsedTokens = 0,
): Array<Record<string, unknown>> {
  const withoutFree = categories.filter((row) => categoryName(row) !== FREE_SPACE_CATEGORY);
  let actualUsage = 0;
  let reservedTokens = 0;
  for (const row of withoutFree) {
    const name = categoryName(row);
    const tokens = categoryTokens(row);
    if (isDeferredContextCategory(name)) continue;
    if (isReservedContextCategory(name)) {
      reservedTokens += tokens;
      continue;
    }
    actualUsage += tokens;
  }
  if (actualUsage <= 0 && fallbackUsedTokens > 0) actualUsage = fallbackUsedTokens;
  const freeTokens = Math.max(0, rawMaxTokens - actualUsage - reservedTokens);
  return [...withoutFree, { name: FREE_SPACE_CATEGORY, tokens: freeTokens }];
}

function enrichContextUsage(value: unknown, modelHints: unknown[] = []): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const raw = { ...asRecord(value) };
  const totalTokens =
    positiveNumber(raw.totalTokens)
    ?? positiveNumber(raw.total_tokens)
    ?? 0;
  let rawMaxTokens =
    positiveNumber(raw.rawMaxTokens)
    ?? positiveNumber(raw.raw_max_tokens)
    ?? positiveNumber(raw.maxTokens)
    ?? positiveNumber(raw.max_tokens)
    ?? resolveContextWindowTokens(raw.model, ...modelHints);

  const sourceCategories = Array.isArray(raw.categories) ? raw.categories : [];
  let categories = sourceCategories.map((row) => {
    const record = asRecord(row);
    return {
      ...record,
      name: categoryName(row) || "Input",
      tokens: categoryTokens(row),
    };
  }).filter((row) => row.tokens > 0 || row.name === FREE_SPACE_CATEGORY);

  if (!rawMaxTokens) {
    // Still return usage so UI can show used count; Free space needs a max.
    return {
      ...raw,
      categories: categories.filter((row) => row.name !== FREE_SPACE_CATEGORY && row.tokens > 0),
      percentage: positiveNumber(raw.percentage) ?? undefined,
      rawMaxTokens: null,
      totalTokens,
    };
  }

  categories = ensureFreeSpaceCategory(categories, rawMaxTokens, totalTokens);
  const percentage =
    positiveNumber(raw.percentage)
    ?? Math.round(Math.max(0, Math.min(1, totalTokens / rawMaxTokens)) * 100);

  return {
    ...raw,
    categories,
    percentage,
    rawMaxTokens,
    totalTokens,
  };
}

function latestInitEvent(transcript: unknown[]) {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const event = asRecord(transcript[index]);
    if (event.type === "system" && event.subtype === "init") return event;
  }
  return null;
}

/**
 * Stored-usage fallback for the Ku/context bar. Official-aligned: reads the CLI jsonl via
 * store.getTranscript (disk) and layers the in-memory live tail for a running turn.
 */
async function contextUsageFromStoredSession(store: LocalSessionStore, session: LocalSession): Promise<Record<string, unknown> | null> {
  const transcript = await store.getTranscript(session.id);
  let latestUsage: ReturnType<typeof usageFromEvent> = null;
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    latestUsage = usageFromEvent(transcript[index]);
    if (latestUsage) break;
  }
  if (!latestUsage) return null;

  const init = latestInitEvent(transcript);
  const rawMaxTokens = resolveContextWindowTokens(init?.model, session.model);
  const categories = [
    { name: "Input", tokens: latestUsage.inputTokens },
    { name: "Prompt cache read", tokens: latestUsage.cacheReadInputTokens },
    { name: "Prompt cache write", tokens: latestUsage.cacheCreationInputTokens },
  ].filter((row) => row.tokens > 0);

  return enrichContextUsage({
    agents: [],
    cacheCreationInputTokens: latestUsage.cacheCreationInputTokens,
    cacheReadInputTokens: latestUsage.cacheReadInputTokens,
    categories,
    inputTokens: latestUsage.inputTokens,
    mcpTools: [],
    memoryFiles: [],
    model: stringValue(init?.model) ?? session.model,
    outputTokens: latestUsage.outputTokens,
    rawMaxTokens,
    toolCallCount: 0,
    totalTokens: latestUsage.totalTokens,
  }, [init?.model, session.model]);
}

/** Official jer residual: Session IdleManager default idleTimeoutMs = 900*1000 (15 min). */
const OFFICIAL_SESSION_IDLE_TIMEOUT_MS = 900_000;

type SessionIdleState = {
  idleTimeoutId?: ReturnType<typeof setTimeout>;
  isTabVisible: boolean;
  hasPendingResult: boolean;
  lastResultTime: number | null;
  warmInFlight?: Promise<boolean>;
};

export class ClaudeCliRunner {
  /**
   * Official LocalSessionManager query residual (app.asar bD + fJ):
   * SDK Query + AsyncIterable input — product path only (no densable print path).
   */
  private readonly sdkSessions = new Map<string, CodeSdkActiveSession>();
  /**
   * Official LocalSessionManager startResumeInFlight residual: concurrent
   * send/warm share one create so follow-ups land on the same Query.
   */
  private readonly sdkEnsureInFlight = new Map<string, Promise<CodeSdkActiveSession | null>>();
  /**
   * Official acquireStartMutex residual: serialize sendMessage isRunning /
   * deferredSends so mid-turn send #2 cannot enqueue on a Query whose
   * isRunning is still false (Esc would then find empty deferred).
   */
  private readonly startMutexTail = new Map<string, Promise<void>>();
  /**
   * Official Session IdleManager residual (VDe / jer=900s):
   * after turn complete, if tab not visible → start idle timeout → pauseSession
   * (teardown query, keep host session). Focus/message clears timeout; focus warms.
   */
  private readonly idleBySession = new Map<string, SessionIdleState>();
  /**
   * Official cli_resume_not_found recovery: after clearStaleResumeHandle, retry the
   * same user send once on a fresh Query (no resume). Cleared on sawInit / success.
   */
  private readonly pendingResumeRetry = new Map<
    string,
    { messageUuid?: string; request: Record<string, unknown>; text: string }
  >();

  constructor(private readonly store: LocalSessionStore, private readonly callbacks: RunnerCallbacks) {}

  async getContextUsage(sessionId: string): Promise<unknown | null> {
    const session = this.store.getSession(sessionId);
    const transcript = session ? await this.store.getTranscript(session.id) : [];
    const modelHints = [latestInitEvent(transcript)?.model, session?.model];
    const storedUsage = session ? await contextUsageFromStoredSession(this.store, session) : null;
    // Official: Query.getContextUsage only when query already warm.
    // Do NOT invent await warmSession here — setSessionVisibility warms on
    // hidden→visible; forcing warm on every getContextUsage/getEffort blocked
    // Code session switch for multi-seconds (CLI resume spawn).
    const sdk = this.sdkSessions.get(sessionId);
    if (sdk) {
      try {
        const liveUsage = await sdk.query.getContextUsage();
        return enrichContextUsage(liveUsage as unknown, modelHints) ?? storedUsage;
      } catch {
        return storedUsage;
      }
    }
    return storedUsage;
  }

  /**
   * Official get_settings → applied effort — the runtime truth for the Effort
   * slider / Ultracode footer chip. Warm Query via getSettings; cold sessions
   * fall back to host store + catalog probe.
   * Returns the full applied bag (effort / effortLevels / ultracodeOfferable) or
   * null when the CLI cannot report — host store is the fallback at the handler.
   */
  async getAppliedEffort(sessionId: string): Promise<{
    effort: string | null;
    effortLevels: string[] | null;
    ultracodeOfferable: boolean | null;
  } | null> {
    const session = this.store.getSession(sessionId);
    // Official: get_settings only on an already-warm Query. Visibility warm is
    // separate (IdleManager onVisibilityChange). Awaiting warm here made every
    // composer mount / session switch spawn --resume and freeze UI.
    const sdk = this.sdkSessions.get(sessionId);
    if (sdk) {
      try {
        const queryWithSettings = sdk.query as CodeSdkActiveSession["query"] & {
          getSettings?: () => Promise<unknown>;
        };
        if (typeof queryWithSettings.getSettings === "function") {
          const response = await queryWithSettings.getSettings();
          const parsed = parseAppliedEffortBag(response);
          // Fill ladder from catalog probe only when get_settings omits effortLevels.
          if (!parsed.effortLevels || parsed.ultracodeOfferable == null) {
            const catalog = await this.probeCatalogEffortDefaults(session?.model).catch(() => null);
            return {
              effort: parsed.effort
                ?? (normalizeEffort(session?.effort) ? session!.effort! : catalog?.effort ?? null),
              effortLevels: parsed.effortLevels ?? catalog?.effortLevels ?? null,
              ultracodeOfferable: parsed.ultracodeOfferable ?? catalog?.ultracodeOfferable ?? null,
            };
          }
          return parsed;
        }
      } catch {
        /* fall through to store + catalog */
      }
    }
    // Cold: host store + catalog probe only (no spawn).
    const catalog = await this.probeCatalogEffortDefaults(session?.model).catch(() => null);
    const effort = normalizeEffort(session?.effort) ? session!.effort! : catalog?.effort ?? null;
    return {
      effort,
      effortLevels: catalog?.effortLevels ?? null,
      ultracodeOfferable: catalog?.ultracodeOfferable ?? null,
    };
  }

  /**
   * New-session draft (no cliSessionId yet): spawn a bare probe so the CLI reports
   * the per-model catalog ladder (applied.effortLevels / ultracodeOfferable) for the
   * composer effort slider. Uses the same env + model resolution as a real spawn,
   * without --resume (nothing to resume). Short-circuits to null when the CLI
   * cannot report — the composer then falls back to the hardcoded 5-stop ladder.
   */
  async probeCatalogEffortDefaults(model?: string): Promise<{
    effort: string | null;
    effortLevels: string[] | null;
    ultracodeOfferable: boolean | null;
  } | null> {
    const executable = defaultClaudeExecutable();
    const enterprise = resolveAppliedEnterpriseForSpawn();
    const normalizedModel = normalizeModel(model, enterprise);
    const args = [
      "--print",
      "--output-format", "stream-json",
      "--verbose",
      "--input-format", "stream-json",
    ];
    if (normalizedModel) args.push("--model", normalizedModel);
    const requestId = randomUUID();

    return new Promise((resolve) => {
      let settled = false;
      let result: unknown | null = null;
      let child: ChildProcessWithoutNullStreams | null = null;
      const finish = (value: unknown | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        try { child?.kill("SIGTERM"); } catch { /* already exited */ }
        finish(result);
      }, CONTROL_REQUEST_TIMEOUT_MS);

      void (async () => {
        try {
          child = await spawnClaude(executable, args, process.cwd());
        } catch {
          finish(null);
          return;
        }

        const stdout = readline.createInterface({ input: child.stdout });
        let requested = false;
        // Bare CLI with --input-format stream-json never emits `system init` until it
        // receives at least one user message — so kick a trivial user turn on a short
        // timer (matches official control-channel activation), then wait for init
        // before issuing get_settings.
        const kickTimer = setTimeout(() => {
          try {
            writeJsonLine(child!, {
              type: "user",
              message: { role: "user", content: [{ type: "text", text: "." }] },
            });
          } catch {
            /* stdin closed */
          }
        }, 800);
        const finishWithKick = (value: unknown | null) => {
          clearTimeout(kickTimer);
          finish(value);
        };
        stdout.on("line", (line) => {
          const event = parseJsonLine(line);
          const response = controlResponsePayload(event, requestId);
          if (response !== undefined) {
            result = response;
            try {
              child?.kill("SIGTERM");
            } catch {
              /* already exited */
            }
            finishWithKick(result);
            return;
          }
          if (
            !requested &&
            stringValue(event.type) === "system" &&
            stringValue(event.subtype) === "init"
          ) {
            requested = true;
            writeJsonLine(child!, {
              type: "control_request",
              request_id: requestId,
              request: { subtype: "get_settings" },
            });
          }
        });
        child.on("error", () => finishWithKick(result));
        child.on("close", () => {
          stdout.close();
          finishWithKick(result);
        });
      })();
    }).then((response) =>
      response == null ? null : parseAppliedEffortBag(response),
    );
  }

  async runTurn(
    sessionId: string,
    prompt: string,
    request: Record<string, unknown> = {},
  ): Promise<boolean> {
    const session = this.store.getSession(sessionId);
    const text = prompt.trim();
    if (!session || !text) return false;
    // Official QeA residual — refuse Code turn when enterprise token soft-cap exceeded.
    try {
      assertEnterpriseTokenCapAllowsTurn();
    } catch (error) {
      this.emitError(
        sessionId,
        error instanceof Error ? error.message : "custom3p_token_cap_exceeded",
      );
      return false;
    }

    const requestUuid = stringValue(request.messageUuid) ?? stringValue(request.uuid);
    const seededUuid = (() => {
      if (requestUuid) return requestUuid;
      for (const event of this.store.getLiveEvents(sessionId)) {
        const record = asRecord(event);
        if (stringValue(record.type) !== "user") continue;
        const eventText =
          stringValue(record.text)
          ?? contentText(asRecord(record.message).content)
          ?? stringValue(asRecord(record.message).content);
        if ((eventText ?? "").trim() !== text) continue;
        return stringValue(record.uuid) ?? stringValue(record.messageUuid) ?? stringValue(record.id);
      }
      return undefined;
    })();

    // Official idleManager.onMessageSent: clear pause timer; warm multi-turn stays up.
    this.onIdleMessageSent(sessionId);

    // Official CCD sendMessage: SDK Query only (bD + fJ). No densable print path.
    return this.runTurnViaSdkQuery(sessionId, session, text, request, seededUuid);
  }


  /**
   * Official LocalSessionManager.cancelQueuedMessage residual (app.asar):
   *   no active query → false
   *   deferredSends splice by uuid → true
   *   inputStream.remove(uuid) → true
   *   else query.cancelAsyncMessage(uuid)
   *   on success: splice messageBuffer by uuid
   *
   * SDK deferredSends first; then live-tail optimistic rows.
   */
  cancelQueuedMessage(sessionId: string, messageUuid: string): boolean {
    const uuid = typeof messageUuid === "string" ? messageUuid.trim() : "";
    if (!sessionId || !uuid) return false;
    const sdk = this.sdkSessions.get(sessionId);
    if (sdk) {
      // Official: deferredSends splice by uuid first.
      const idx = sdk.deferredSends.findIndex((item) => item.messageUuid === uuid);
      if (idx >= 0) {
        sdk.deferredSends.splice(idx, 1);
        const liveRemoved = this.store.removeLiveEventByUuid(sessionId, uuid);
        if (liveRemoved) this.callbacks.onSessionUpdated(sessionId);
        return true;
      }
    }
    const removed = this.store.removeLiveEventByUuid(sessionId, uuid);
    if (removed) this.callbacks.onSessionUpdated(sessionId);
    return removed;
  }

  /**
   * Official LocalSessionManager.interruptSession residual (app.asar):
   *   no query → stopSession
   *   race(query.interrupt, kkA=1500) → timeout/fail → stopSession
   *   success → signalTurnComplete (drainDeferredSends if any else markNotRunning+idle)
   */
  async interrupt(sessionId: string): Promise<{ continued: boolean }> {
    const sdk = this.sdkSessions.get(sessionId);
    // Official interruptSession: `if(!(t!=null&&t.query))` → stopSession.
    // Query exists as soon as bD()/sdkQuery() returns — do NOT extra-stop on !sawInit.
    if (!sdk?.query) {
      this.stop(sessionId);
      return { continued: false };
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      // Official: Promise.race([query.interrupt().then(()=>!1), setTimeout(kkA→true)])
      const timedOut = await Promise.race([
        sdk.query.interrupt().then(() => false as const),
        new Promise<true>((resolve) => {
          timeoutId = setTimeout(() => resolve(true), OFFICIAL_INTERRUPT_TIMEOUT_MS);
          timeoutId.unref?.();
        }),
      ]);
      if (timedOut) {
        this.stop(sessionId);
        return { continued: false };
      }
      // Official interruptSession success: signalTurnComplete only.
      // clearPendingPermissions is teardownQuery residual (stopSession), not interrupt.
      // KwA in asar is health="healthy", not permission teardown.
      this.signalTurnCompleteSdk(
        sessionId,
        sdk,
        this.store.getSession(sessionId),
      );
      // Official: interrupt success keeps warm Query (drain or markNotRunning).
      // continued=true → IPC must not store.stop / emit stopped. isRunning may be
      // true (deferred drained) or false (idle); process stays for next enqueue.
      return { continued: true };
    } catch {
      this.stop(sessionId);
      return { continued: false };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Official LocalSessionManager.signalTurnComplete residual (app.asar) — literal:
   *   if (drainDeferredSends(A)) { emit session_updated; return }
   *   markNotRunning(A); idleManager.onTurnComplete; emit queryCompleted; session_updated
   *
   * Call sites (official LocalSessionManager / asar):
   *   - interruptSession success → signalTurnComplete
   *   - createBaseHooks Stop → signalTurnComplete
   *   - handleResultMessage(parent type:"result") → drainDeferredSends else markNotRunning
   *     (product: shouldSignalTurnCompleteFromCliMessage → this method)
   *
   * Esc+queue: late result may markNotRunning under a drained follow-up; official
   * handleAssistantMessage re-asserts isRunning on the next parent assistant
   * (shouldReassertRunningFromAssistantMessage) — do not invent skipNextResultSettle.
   *
   * No product invents: no blockSettleAfterDrain, no type:"completed" event.
   * Official web H = Qke(pendingTurn && !endTurnSeen). Drain keeps isRunning true so
   * follow-up continues; web queuedMessages alone must not invent H / isRunning.
   */
  private signalTurnCompleteSdk(
    sessionId: string,
    sdk: CodeSdkActiveSession,
    session: LocalSession | undefined,
  ): void {
    // Official drainDeferredSends(A):
    //   if (!inputStream || !deferredSends?.length) return false
    //   t = deferredSends; deferredSends = void 0
    //   for (n of t) inputStream.enqueue(n)
    //   isRunning = true; return true
    if (sdk.deferredSends.length > 0) {
      const queued = sdk.deferredSends.splice(0);
      const live = this.store.getSession(sessionId) ?? session;
      if (!live) {
        sdk.isRunning = false;
        sdk.sawResult = true;
        this.store.setRunning(sessionId, false, { kind: "claude-cli" });
        this.callbacks.onSessionUpdated(sessionId);
        return;
      }
      sdk.isRunning = true;
      sdk.sawResult = false;
      this.store.setRunning(sessionId, true, {
        kind: "claude-cli",
        executable: "sdk-query",
        startedAt: nowIso(),
        lastError: undefined,
        lastExitCode: null,
      });
      // Official: enqueue only (user already emitted at send-time).
      for (const next of queued) {
        const userMessage = buildCodeSdkUserMessage(
          promptWithSelectedFiles(next.text, next.request.userSelectedFiles),
          next.messageUuid,
          next.request.images,
        );
        sdk.input.enqueue(userMessage);
      }
      this.callbacks.onSessionUpdated(sessionId);
      return;
    }
    // Official markNotRunning — keep warm Query; only clear isRunning.
    // No type:"completed" invent (asar: queryCompleted + session_updated only).
    sdk.sawResult = true;
    sdk.isRunning = false;
    this.store.setRunning(sessionId, false, { kind: "claude-cli" });
    this.onIdleTurnComplete(sessionId);
    this.callbacks.onSessionUpdated(sessionId);
  }

  stop(sessionId: string): boolean {
    // Official stopSession → teardownQuery:
    //   clearPendingPermissions(sessionId); query.close()
    // closeCodeSdkSession clears SDK waiters; host store cards clear here.
    const sdk = this.sdkSessions.get(sessionId);
    if (sdk) {
      closeCodeSdkSession(sdk);
      this.sdkSessions.delete(sessionId);
      this.clearIdleTimeout(sessionId);
    }
    this.startMutexTail.delete(sessionId);
    this.store.clearPendingToolPermissions(sessionId);
    // Always clear host running so composer stopOnce settles.
    this.store.setRunning(sessionId, false, { kind: "claude-cli", finishedAt: nowIso() });
    this.callbacks.onEvent({ type: "stopped", sessionId });
    this.callbacks.onSessionUpdated(sessionId);
    return true;
  }

  /**
   * Official Host Tasks Stop (ion Xr + Query.stopTask residual).
   * Must NOT call session stop().
   */
  async stopTask(
    sessionId: string,
    taskId: string,
  ): Promise<{ status: "informed" | "no_turn" | "failed"; error?: string }> {
    const id = typeof taskId === "string" ? taskId.trim() : "";
    if (!sessionId || !id) {
      return { status: "failed", error: "sessionId and taskId are required" };
    }
    const sdk = this.sdkSessions.get(sessionId);
    if (!sdk) return { status: "no_turn" };
    try {
      await sdk.query.stopTask(id);
      return { status: "informed" };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : "stopTask failed",
      };
    }
  }

  findSessionIdForPermission(requestId: string): string | null {
    for (const [sessionId, sdk] of this.sdkSessions) {
      if (sdk.pendingPermissions.has(requestId)) return sessionId;
    }
    for (const session of this.store.getAll(true)) {
      if (session.pendingToolPermissions?.some((request) => request.requestId === requestId)) {
        return session.id;
      }
    }
    return null;
  }

  respondToToolPermission(
    sessionId: string,
    requestId: string,
    decision: ToolPermissionDecision,
    updatedInput?: unknown,
  ): Record<string, unknown> {
    // Official canUseTool residual (SDK Query path only).
    for (const [id, sdk] of this.sdkSessions) {
      if (sdk.pendingPermissions.has(requestId) || id === sessionId) {
        const waiter = sdk.pendingPermissions.get(requestId);
        const ok = resolveCodeSdkPermission(sdk, requestId, decision, updatedInput);
        if (ok) {
          if (decision === "always" && waiter?.pending.toolName) {
            this.store.appendSessionPermissionAllowRule(id, waiter.pending.toolName);
            const reason =
              waiter.pending.decisionReason
              ?? stringValue(asRecord(updatedInput).decisionReason)
              ?? stringValue(asRecord(updatedInput).decision_reason);
            if (reason) {
              this.store.addAlwaysAllowedReason(id, waiter.pending.toolName, reason);
            }
            const applied = officialSessionDestinationSuggestions(waiter.pending.suggestions);
            if (applied.directories.length > 0) {
              this.store.appendSessionPermissionDirectories(id, applied.directories);
            }
            for (const rule of applied.rules) {
              this.store.appendSessionPermissionAllowRule(
                id,
                rule.toolName,
                rule.ruleContent,
              );
            }
            if (applied.setMode) {
              const mode = normalizePermissionMode(applied.setMode);
              if (mode) {
                void this.setPermissionMode(id, mode);
              }
            }
            const sess = this.store.getSession(id);
            if (
              sess?.scheduledTaskId
              && !waiter.pending.toolName.startsWith("browser:")
              && !waiter.pending.toolName.startsWith("computer:")
            ) {
              this.callbacks.addScheduledTaskApprovedPermissions?.(
                sess.scheduledTaskId,
                waiter.pending.suggestions,
              );
            }
          }
          if (decision === "once" && waiter?.pending.toolName === "ExitPlanMode") {
            const toolInput = stripBridgePermissionFields(updatedInput);
            const target = stringValue(asRecord(toolInput)._targetMode);
            const mode =
              target === "acceptEdits"
              || target === "auto"
              || target === "bypassPermissions"
              || target === "default"
                ? target
                : "default";
            const normalized = normalizePermissionMode(mode);
            if (normalized) {
              const current = this.store.getSession(id);
              if (current && current.permissionMode !== normalized) {
                this.store.update(id, { permissionMode: normalized });
              }
            }
          }
          this.store.clearPendingToolPermission(id, requestId);
          this.callbacks.onPermissionAttentionStop?.();
          this.callbacks.onEvent({
            type: "tool_permission_resolved",
            sessionId: id,
            request: { requestId, sessionId: id },
          });
          this.callbacks.onSessionUpdated(id);
          return { ok: true, requestId, decision };
        }
      }
    }
    this.store.clearPendingToolPermission(sessionId, requestId);
    return { ok: false, error: "no_active_turn", requestId, decision };
  }

  /**
   * Official ion-dist Fke(e): extract live meta from stream events.
   * - system init → model (+ permissionMode for bookkeeping only on cold seed)
   * - system status → permissionMode (EnterPlanMode / ExitPlanMode / Shift+Tab / set_permission_mode)
   *
   * Host Mode pill seeds from session.permissionMode (`be(n.permissionMode)`).
   * Only system/status may overwrite host permissionMode — system/init default must not
   * snap user bypass/acceptEdits after menu selection or prior live status.
   */
  private syncLiveMetaFromCliEvent(sessionId: string, event: Record<string, unknown>): void {
    if (stringValue(event.type) !== "system") return;
    const subtype = stringValue(event.subtype);
    if (subtype !== "init" && subtype !== "status") return;

    const patch: Partial<LocalSession> = {};
    if (subtype === "init") {
      // densable may resolve bag id to an internal alias (grok-4.5 → grok-4.5-build).
      // Host session.model is the user/bag selection for footer + next spawn — only
      // gap-fill empty/default. Do not clobber a real host model with densable init.
      // (permissionMode: same — never apply init onto host Mode pill.)
      const model = stringValue(event.model);
      if (model && model !== "<synthetic>") patch.model = model;
    } else if (subtype === "status") {
      const permissionMode = normalizePermissionMode(stringValue(event.permissionMode));
      if (permissionMode) patch.permissionMode = permissionMode;
    }
    if (Object.keys(patch).length === 0) return;

    const current = this.store.getSession(sessionId);
    if (!current) return;
    if (patch.permissionMode && patch.permissionMode === current.permissionMode) delete patch.permissionMode;
    if (patch.model) {
      if (patch.model === current.model) {
        delete patch.model;
      } else if (current.model && current.model !== "default" && current.model !== "<synthetic>") {
        // Keep bag/user selection over densable resolved id during turn.
        delete patch.model;
      }
    }
    if (Object.keys(patch).length === 0) return;
    this.store.update(sessionId, patch);
  }

  /**
   * Official CCD residual (app.asar LocalSessions.setPermissionMode):
   *   const cli_informed = !!session.query;
   *   if (session.query) await query.setPermissionMode(mode); // must succeed before store
   *   else host-only (next spawn/runTurn carries --permission-mode)
   *
   * Local Code: SDK Query.setPermissionMode 1:1. SSH print: control_request.
   */
  async setPermissionMode(sessionId: string, mode: string): Promise<SetPermissionModeCliResult> {
    const permissionMode = normalizePermissionMode(mode);
    if (!permissionMode) {
      return { status: "failed", error: "invalid permission mode" };
    }
    // Official Query.setPermissionMode residual.
    const sdk = this.sdkSessions.get(sessionId);
    if (sdk) {
      try {
        await sdk.query.setPermissionMode(
          permissionMode as Parameters<CodeSdkActiveSession["query"]["setPermissionMode"]>[0],
        );
        return { status: "informed" };
      } catch (error) {
        return {
          status: "failed",
          error: error instanceof Error ? error.message : "setPermissionMode failed",
        };
      }
    }
    // Official cli_informed:false — no active query; host store + next runTurn is enough.
    return { status: "no_turn" };
  }

  /**
   * Official Query.setModel residual (app.asar / agent-sdk).
   * Mid-session model change without respawn when query is warm.
   */
  async setSdkModel(sessionId: string, model: string | undefined): Promise<boolean> {
    const sdk = this.sdkSessions.get(sessionId);
    if (!sdk) return false;
    try {
      await sdk.query.setModel(model);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Official apply_flag_settings / Query.applyFlagSettings residual for effort/ultracode.
   * Host store is authoritative for UI + next spawn; live query gets flag layer merge.
   */
  async applyFlagSettings(sessionId: string, settings: Record<string, unknown>): Promise<boolean> {
    const sdk = this.sdkSessions.get(sessionId);
    if (sdk) {
      try {
        await sdk.query.applyFlagSettings(settings as Parameters<CodeSdkActiveSession["query"]["applyFlagSettings"]>[0]);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Official LocalSessionManager.warmSession residual (app.asar):
   * On focus / open of an existing session with cliSessionId, spawn resume query
   * **without** a user message and keep inputStream warm so the first follow-up
   * is enqueue-only (not cold --resume at send time).
   *
   * Official IdleManager: focus/visible → warm; idle 900s hidden → pauseSession.
   */
  async warmSession(sessionId: string): Promise<boolean> {
    this.ensureIdleState(sessionId).isTabVisible = true;
    this.clearIdleTimeout(sessionId);
    if (this.sdkSessions.has(sessionId)) return true;
    const idle = this.ensureIdleState(sessionId);
    if (idle.warmInFlight) return idle.warmInFlight;

    const session = this.store.getSession(sessionId);
    if (!session?.cliSessionId) return false;
    if (session.stopped === true) return false;
    // Official warmSession: bD Query resume (local + SSH host-pipe via spawnClaudeCodeProcess).
    idle.warmInFlight = this.ensureSdkSession(sessionId, session, {}).finally(() => {
      const state = this.idleBySession.get(sessionId);
      if (state) state.warmInFlight = undefined;
    }).then((sdk) => {
      if (sdk) this.callbacks.onEvent({ type: "warmed", sessionId });
      return Boolean(sdk);
    });
    return idle.warmInFlight;
  }

  /**
   * Official LocalSessionManager.acquireStartMutex residual.
   * Chain senders so send #2 waits until send #1 has set isRunning / deferred.
   */
  private async acquireStartMutex(sessionId: string): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.startMutexTail.get(sessionId) ?? Promise.resolve();
    this.startMutexTail.set(
      sessionId,
      prev.then(() => held, () => held),
    );
    try {
      await prev;
    } catch {
      // Previous send failure must not block the next send.
    }
    return release;
  }

  /**
   * Official sendMessage residual via SDK Query (bD + fJ):
   * warm query exists → enqueue user message; mid-turn → deferredSends.
   */
  private async runTurnViaSdkQuery(
    sessionId: string,
    session: LocalSession,
    text: string,
    request: Record<string, unknown>,
    seededUuid: string | undefined,
  ): Promise<boolean> {
    const release = await this.acquireStartMutex(sessionId);
    try {
      return await this.enqueueOrDeferSdkTurn(sessionId, session, text, request, seededUuid);
    } finally {
      release();
    }
  }

  private async enqueueOrDeferSdkTurn(
    sessionId: string,
    session: LocalSession,
    text: string,
    request: Record<string, unknown>,
    seededUuid: string | undefined,
  ): Promise<boolean> {
    let sdk: CodeSdkActiveSession | undefined = this.sdkSessions.get(sessionId);
    if (!sdk) {
      const created = await this.ensureSdkSession(sessionId, session, request);
      if (!created) {
        this.emitError(sessionId, "Failed to start Claude Code query");
        return false;
      }
      sdk = created;
    }

    const userMessage = buildCodeSdkUserMessage(
      promptWithSelectedFiles(text, request.userSelectedFiles),
      seededUuid,
      request.images,
    );
    // Official sendMessage residual (asar): always emit user, then if isRunning
    // deferredSends.push and return (do not enqueue yet). Drain only enqueues.
    this.store.appendTranscriptEvent(sessionId, {
      type: "user",
      uuid: userMessage.uuid,
      message: userMessage.message,
      sessionId,
      timestamp: nowIso(),
    });
    this.callbacks.onEvent({
      type: "message",
      sessionId,
      message: {
        type: "user",
        uuid: userMessage.uuid,
        message: userMessage.message,
        sessionId,
      },
    });
    // Official asar sendMessage: const c = r.isRunning; if (c) deferredSends.push; return
    // Do NOT gate on !sawResult — that invent skipped defer while tools still run
    // after an assistant end_turn/result flag, so Esc found empty deferred and
    // markNotRunning'd (Send while queue should pop and continue).
    if (sdk.isRunning) {
      sdk.deferredSends.push({
        text,
        request: { ...request },
        messageUuid: userMessage.uuid ?? seededUuid,
      });
      return true;
    }

    // Official cli_resume_not_found: remember this send so error path can retry once
    // after clearStaleResumeHandle (same user message, fresh Query without resume).
    this.pendingResumeRetry.set(sessionId, {
      text,
      request: { ...request },
      messageUuid: seededUuid,
    });

    sdk.isRunning = true;
    sdk.sawResult = false;
    this.store.setRunning(sessionId, true, {
      kind: "claude-cli",
      executable: "sdk-query",
      startedAt: nowIso(),
      lastError: undefined,
      lastExitCode: null,
    });
    this.callbacks.onSessionUpdated(sessionId);
    sdk.input.enqueue(userMessage);
    return true;
  }

  private async ensureSdkSession(
    sessionId: string,
    session: LocalSession,
    request: Record<string, unknown>,
  ): Promise<CodeSdkActiveSession | null> {
    const existing = this.sdkSessions.get(sessionId);
    if (existing) return existing;
    const inFlight = this.sdkEnsureInFlight.get(sessionId);
    if (inFlight) return inFlight;
    const created = this.createSdkSessionUncached(sessionId, session, request);
    this.sdkEnsureInFlight.set(sessionId, created);
    try {
      return await created;
    } finally {
      if (this.sdkEnsureInFlight.get(sessionId) === created) {
        this.sdkEnsureInFlight.delete(sessionId);
      }
    }
  }

  private async createSdkSessionUncached(
    sessionId: string,
    session: LocalSession,
    request: Record<string, unknown>,
  ): Promise<CodeSdkActiveSession | null> {
    const existing = this.sdkSessions.get(sessionId);
    if (existing) return existing;
    // Official warmSession: local-only transcript existence check before resume.
    // SSH skips local jsonl pre-check (remote transcript; cli_resume_not_found
    // recovery still clears via error path).
    if (session.cliSessionId && !session.sshConfig) {
      try {
        const { resolveCodeTranscriptPath } = await import("./codeTranscriptJsonl");
        const fs = await import("node:fs");
        const path = await resolveCodeTranscriptPath(session.cliSessionId, session.cwd);
        const ok = Boolean(path) && fs.existsSync(path!) && fs.statSync(path!).size > 0;
        if (!ok) {
          this.store.clearStaleResumeHandle(sessionId);
          session = this.store.getSession(sessionId) ?? session;
        }
      } catch {
        this.store.clearStaleResumeHandle(sessionId);
        session = this.store.getSession(sessionId) ?? session;
      }
    }
    // Official emitInitializationStatus residual (configureSSHSpawn host-pipe subset):
    // step progress → complete before Query is ready. Full RemoteServerController
    // ensureReady steps are NOT invented here.
    if (session.sshConfig) {
      this.callbacks.onEvent({
        type: "initialization_status",
        sessionId,
        initializationStatus: {
          step: "ssh_spawn",
          message: "Starting remote Claude over SSH…",
          isComplete: false,
        },
      });
    }

    try {
      const sdk = await createCodeSdkActiveSession({
        callbacks: {
          onEvent: (event) => {
            const eventType = stringValue(asRecord(event).type);
            // Official handleQueryError / handleResultMessage: cli_resume_not_found → clearStaleResumeHandle.
            if (eventType === "error") {
              const category = stringValue(asRecord(event).errorCategory);
              const errText = stringValue(asRecord(event).error) ?? "";
              if (
                category === "cli_resume_not_found"
                || /No conversation found with session ID/i.test(errText)
              ) {
                this.store.clearStaleResumeHandle(sessionId);
                const dead = this.sdkSessions.get(sessionId);
                if (dead) {
                  closeCodeSdkSession(dead);
                  this.sdkSessions.delete(sessionId);
                }
                // Same-send retry once as fresh conversation (official clear + user resend,
                // product: automatic so "Try again" is not required for ghost resume ids).
                const pending = this.pendingResumeRetry.get(sessionId);
                this.pendingResumeRetry.delete(sessionId);
                const fresh = this.store.getSession(sessionId);
                if (pending && fresh) {
                  void this.runTurnViaSdkQuery(
                    sessionId,
                    fresh,
                    pending.text,
                    pending.request,
                    pending.messageUuid,
                  );
                }
              }
              // Official configureSSHSpawn disconnect residual (host-pipe subset):
              // network drop mid-query → emit ssh_disconnected + teardown query.
              // Full RemoteServerController auto-reconnect is NOT product residual.
              if (
                (category === "network_error" || /SSH connection dropped/i.test(errText))
                && this.store.getSession(sessionId)?.sshConfig
              ) {
                const dead = this.sdkSessions.get(sessionId);
                if (dead) {
                  closeCodeSdkSession(dead);
                  this.sdkSessions.delete(sessionId);
                }
                this.store.setRunning(sessionId, false, {
                  kind: "claude-cli-ssh",
                  finishedAt: nowIso(),
                  lastError: errText || "SSH connection dropped",
                });
                this.callbacks.onEvent({ type: "ssh_disconnected", sessionId });
                this.callbacks.onSessionUpdated(sessionId);
              }
            }
            if (eventType === "message") {
              const msgEarly = asRecord(asRecord(event).message);
              if (stringValue(msgEarly.type) === "system" && stringValue(msgEarly.subtype) === "init") {
                this.pendingResumeRetry.delete(sessionId);
              }
            }
            // Official canUseTool → host pending queue (web Mode/permission cards hydrate).
            if (eventType === "tool_permission_request") {
              const request = asRecord(event.request);
              const requestId = stringValue(request.requestId);
              if (requestId) {
                this.store.setPendingToolPermission(sessionId, {
                  description: stringValue(request.description),
                  input: request.input,
                  requestId,
                  sessionId,
                  toolName: stringValue(request.toolName) ?? "Tool",
                  toolUseId: stringValue(request.toolUseId),
                  alwaysAllowScope: stringValue(request.alwaysAllowScope),
                  decisionReason: stringValue(request.decisionReason),
                  hasAlwaysAllow: typeof request.hasAlwaysAllow === "boolean"
                    ? request.hasAlwaysAllow
                    : undefined,
                  suggestions: request.suggestions,
                });
              }
            }
            // Mirror CLI session_id / slash_commands from system init onto host store.
            if (eventType === "message") {
              const msg = asRecord(asRecord(event).message);
              // Official Fke: system init/status → host model / permissionMode mirror.
              // status may overwrite Mode pill; init never snaps permissionMode.
              this.syncLiveMetaFromCliEvent(sessionId, msg);
              // Product live-tail residual (print path appendTranscriptEvent every CLI
              // event): keep durable message types in memory so getTranscript still has
              // assistant after settle/refresh if CLI jsonl is delayed or suppressed.
              // stream_event is partial (includePartialMessages) — not jsonl-durable; skip.
              // Optimistic user seed already uses the same outer uuid → store dedupes.
              const msgType = stringValue(msg.type);
              if (
                msgType === "user"
                || msgType === "assistant"
                || msgType === "system"
                || msgType === "result"
              ) {
                this.store.appendTranscriptEvent(sessionId, msg);
              }
              if (stringValue(msg.type) === "system" && stringValue(msg.subtype) === "init") {
                const cliId = stringValue(msg.session_id);
                if (cliId) this.store.setCliSessionId(sessionId, cliId);
                if (Array.isArray(msg.slash_commands)) {
                  this.store.setSlashCommands(
                    sessionId,
                    msg.slash_commands.filter((c): c is string => typeof c === "string" && c.length > 0),
                  );
                }
                const initModel = stringValue(msg.model);
                if (initModel) {
                  const current = this.store.getSession(sessionId);
                  if (current && !current.model) {
                    this.store.update(sessionId, { model: initModel });
                  }
                }
              }
            }
            // Deliver the CLI row to the web bridge **before** signalTurnComplete /
            // markNotRunning. Settling first races officialStreamSettleAfterReveal
            // and can clear Va/typewriter before the final assistant merge lands —
            // UI then shows only a later error_during_execution red card (no text).
            this.callbacks.onEvent(event);
            // Official handleQueryError: emit error → teardownQuery → emit close code:1.
            // Only the query-iterator catch sets queryExited; result is_error must not
            // teardown the warm Query. Skip if resume/ssh already deleted the sdk.
            if (eventType === "error" && asRecord(event).queryExited === true) {
              this.teardownSdkQueryAfterError(
                sessionId,
                stringValue(asRecord(event).error) ?? "",
              );
            }
            // Official asar call sites → signalTurnComplete / markNotRunning:
            //   interruptSession · createBaseHooks Stop · handleResultMessage(parent result)
            // Product: shouldSignalTurnCompleteFromCliMessage (result + stop_hook_summary).
            // Do NOT settle on assistant end_turn — official p is web paint only.
            // Esc+queue: late result may markNotRunning under drained follow-up; official
            // handleAssistantMessage re-asserts isRunning on next parent assistant.
            if (eventType === "message") {
              const settleMsg = asRecord(asRecord(event).message);
              const active = this.sdkSessions.get(sessionId);
              if (active && shouldReassertRunningFromAssistantMessage(settleMsg, active.isRunning)) {
                active.isRunning = true;
                active.sawResult = false;
                this.store.setRunning(sessionId, true, {
                  kind: "claude-cli",
                  executable: "sdk-query",
                  startedAt: nowIso(),
                  lastError: undefined,
                  lastExitCode: null,
                });
                this.callbacks.onSessionUpdated(sessionId);
              } else if (active && shouldSignalTurnCompleteFromCliMessage(settleMsg)) {
                this.signalTurnCompleteSdk(sessionId, active, session);
              }
            }
          },
          onSessionUpdated: this.callbacks.onSessionUpdated,
          onPermissionAttention: this.callbacks.onPermissionAttention,
          isBypassPermissionsModeEnabled: this.callbacks.isBypassPermissionsModeEnabled,
          getLiveSession: () => this.store.getSession(sessionId),
          shouldAutoApproveScheduledPermission:
            this.callbacks.shouldAutoApproveScheduledPermission,
          // Official createBaseHooks Stop → signalTurnComplete residual.
          // Idempotent with result-path markNotRunning/drain (same host state).
          onSignalTurnComplete: (id) => {
            const active = this.sdkSessions.get(id);
            if (!active) return;
            this.signalTurnCompleteSdk(id, active, session);
          },
        },
        request,
        session,
        sessionId,
        warmOnly: true,
      });
      this.sdkSessions.set(sessionId, sdk);
      if (session.sshConfig) {
        this.callbacks.onEvent({
          type: "initialization_status",
          sessionId,
          initializationStatus: {
            step: "complete",
            message: "",
            isComplete: true,
          },
        });
      }
      return sdk;
    } catch (error) {
      if (session.sshConfig) {
        this.callbacks.onEvent({
          type: "initialization_status",
          sessionId,
          initializationStatus: {
            step: "error",
            message: error instanceof Error ? error.message : "sdk_query_start_failed",
            isComplete: true,
          },
        });
      }
      this.emitError(
        sessionId,
        error instanceof Error ? error.message : "sdk_query_start_failed",
      );
      return null;
    }
  }

  /**
   * Official IdleManager.onVisibilityChange residual (app.asar):
   *   t && !r  → clear idle; if !hasActiveQuery && !isWarmingUp → onWarmUp
   *   !t && r  → start idle timeout when hasPendingResult
   * Only warms on **hidden→visible** transition — not every setFocused(true)
   * while already visible, and not from getEffort/getContextUsage.
   */
  setSessionTabVisible(sessionId: string, visible: boolean): void {
    if (!sessionId) return;
    const state = this.ensureIdleState(sessionId);
    const wasVisible = state.isTabVisible;
    state.isTabVisible = visible;
    const hasQuery = this.sdkSessions.has(sessionId);
    if (visible && !wasVisible) {
      this.clearIdleTimeout(sessionId);
      if (!hasQuery && !state.warmInFlight) {
        // Defer spawn until after paint so switch UI is not blocked on --resume.
        setTimeout(() => {
          void this.warmSession(sessionId).catch(() => undefined);
        }, 0);
      }
      return;
    }
    if (visible) {
      this.clearIdleTimeout(sessionId);
      return;
    }
    // Became hidden after a settled turn → arm official 900s pause timer.
    if (wasVisible && state.hasPendingResult && hasQuery) {
      this.startIdleTimeout(sessionId);
    }
  }


  /** Official IdleManager.onMessageSent residual. */
  private onIdleMessageSent(sessionId: string): void {
    const state = this.ensureIdleState(sessionId);
    this.clearIdleTimeout(sessionId);
    state.hasPendingResult = false;
    state.lastResultTime = null;
  }

  /** Official IdleManager.onTurnComplete residual. */
  private onIdleTurnComplete(sessionId: string): void {
    const state = this.ensureIdleState(sessionId);
    state.hasPendingResult = true;
    state.lastResultTime = Date.now();
    if (!state.isTabVisible) this.startIdleTimeout(sessionId);
  }

  private ensureIdleState(sessionId: string): SessionIdleState {
    let state = this.idleBySession.get(sessionId);
    if (!state) {
      state = {
        isTabVisible: true,
        hasPendingResult: false,
        lastResultTime: null,
      };
      this.idleBySession.set(sessionId, state);
    }
    return state;
  }

  private clearIdleTimeout(sessionId: string): void {
    const state = this.idleBySession.get(sessionId);
    if (!state?.idleTimeoutId) return;
    clearTimeout(state.idleTimeoutId);
    state.idleTimeoutId = undefined;
  }

  private startIdleTimeout(sessionId: string): void {
    const state = this.ensureIdleState(sessionId);
    this.clearIdleTimeout(sessionId);
    const hasQuery = this.sdkSessions.has(sessionId);
    if (!hasQuery) return;
    // Official: only arm when there is still a warm query.
    state.idleTimeoutId = setTimeout(() => {
      state.idleTimeoutId = undefined;
      if (state.isTabVisible) return;
      if (!this.sdkSessions.has(sessionId)) return;
      // Mid-turn: never pause while isRunning.
      if (this.store.getSession(sessionId)?.isRunning === true) return;
      void this.pauseSession(sessionId);
    }, OFFICIAL_SESSION_IDLE_TIMEOUT_MS);
    if (typeof state.idleTimeoutId === "object" && "unref" in state.idleTimeoutId) {
      state.idleTimeoutId.unref?.();
    }
  }

  /**
   * Official IdleManager pause residual: teardown warm query, keep host session.
   * Official skip gates (app.asar pauseSession): isRunning, unexpired cron,
   * active workflows, remoteControlEnabled.
   */
  pauseSession(sessionId: string): boolean {
    this.clearIdleTimeout(sessionId);
    const sdk = this.sdkSessions.get(sessionId);
    if (!sdk) return false;
    const session = this.store.getSession(sessionId);
    if (session?.isRunning === true || sdk.isRunning) {
      return false;
    }
    const cronTtlMs = 4320 * 60 * 1e3;
    const cron = session?.activeCronJobs;
    if (cron && typeof cron === "object") {
      const now = Date.now();
      for (const [jobId, job] of Object.entries(cron)) {
        const createdAt =
          job && typeof job === "object" && typeof job.createdAt === "number"
            ? job.createdAt
            : 0;
        if (now - createdAt > cronTtlMs) {
          delete cron[jobId];
        }
      }
      if (Object.keys(cron).length > 0) {
        return false;
      }
    }
    const workflows = session?.activeWorkflows;
    if (workflows && typeof workflows === "object" && Object.keys(workflows).length > 0) {
      return false;
    }
    if (session?.remoteControlEnabled) {
      return false;
    }
    closeCodeSdkSession(sdk);
    this.sdkSessions.delete(sessionId);
    this.startMutexTail.delete(sessionId);
    this.store.setRunning(sessionId, false, {
      kind: "claude-cli",
      finishedAt: nowIso(),
    });
    this.callbacks.onEvent({ type: "paused", sessionId });
    this.callbacks.onSessionUpdated(sessionId);
    return true;
  }





  /**
   * Official handleQueryError teardownQuery + close residual.
   * Crash path emits close (not stopped). Interrupt/stopSession still emits stopped.
   */
  private teardownSdkQueryAfterError(sessionId: string, errText: string): void {
    const sdk = this.sdkSessions.get(sessionId);
    if (!sdk) return;
    closeCodeSdkSession(sdk);
    this.sdkSessions.delete(sessionId);
    this.startMutexTail.delete(sessionId);
    this.clearIdleTimeout(sessionId);
    this.store.clearPendingToolPermissions(sessionId);
    const ssh = Boolean(this.store.getSession(sessionId)?.sshConfig);
    this.store.setRunning(sessionId, false, {
      kind: ssh ? "claude-cli-ssh" : "claude-cli",
      finishedAt: nowIso(),
      lastError: errText || undefined,
      lastExitCode: parseClaudeProcessExitCode(errText),
    });
    this.callbacks.onEvent({ type: "close", sessionId, code: 1 });
    this.callbacks.onSessionUpdated(sessionId);
  }

  private emitError(sessionId: string, message: string): void {
    const event = { type: "error", sessionId, error: message, timestamp: nowIso() };
    this.store.appendTranscriptEvent(sessionId, event);
    this.callbacks.onEvent(event);
    this.callbacks.onSessionUpdated(sessionId);
  }

}
