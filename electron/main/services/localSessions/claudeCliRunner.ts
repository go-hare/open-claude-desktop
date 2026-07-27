import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { app } from "electron";
import {
  buildClaudeCliSpawnEnv,
  readAppliedCustom3pFromDesktopShellSettings,
  resolveCliModelArg,
  type Custom3pEnterpriseConfig,
} from "../custom3p/custom3pCliEnv";
import { getLocalSessionEnvironmentSync } from "./localSessionEnvironmentStore";
import type { LocalSession, LocalSessionStore, LocalToolPermissionRequest } from "./localSessionStore";

type RunnerCallbacks = {
  onEvent: (event: Record<string, unknown>) => void;
  onSessionUpdated: (sessionId: string) => void;
};

type ActiveTurn = {
  child: ChildProcessWithoutNullStreams;
  pendingControlResponses: Map<string, PendingControlResponse>;
  pendingPermissions: Map<string, LocalToolPermissionRequest>;
  stderr: string[];
  sawAssistantText: boolean;
};

type PendingControlResponse = {
  resolve: (value: unknown | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ToolPermissionDecision = "always" | "deny" | "once";
const CONTROL_REQUEST_TIMEOUT_MS = 15_000;
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

export function spawnClaude(executable: string, args: string[], cwd: string): ChildProcessWithoutNullStreams {
  const userDataPath = resolveDesktopUserDataPath();
  const env = buildClaudeCliSpawnEnv({
    processEnv: process.env,
    localSessionEnv: resolveLocalSessionEnvironment(userDataPath),
    userDataPath,
  });
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    return spawn("cmd.exe", ["/d", "/s", "/c", executable, ...args], { cwd, env, windowsHide: true });
  }
  return spawn(executable, args, { cwd, env, windowsHide: true });
}

function resolveCwd(session: LocalSession): string {
  if (session.cwd && fs.existsSync(session.cwd)) return session.cwd;
  return process.cwd();
}

function normalizePermissionMode(value: string | undefined): string | undefined {
  const mapped = value === "bypass" ? "bypassPermissions" : value;
  return mapped && ["acceptEdits", "bypassPermissions", "default", "dontAsk", "plan", "auto"].includes(mapped) ? mapped : undefined;
}

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

function buildClaudeArgs(session: LocalSession, request: Record<string, unknown>, cliSessionId: string, resume: boolean, forkSession = false): string[] {
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

  const permissionMode = normalizePermissionMode(stringValue(request.permissionMode) ?? session.permissionMode);
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
  pushJsonOption(args, "--mcp-config", request.mcpServers ?? sessionRaw.mcpServers);
  pushJsonOption(args, "--mcp-config", request.remoteMcpServers ?? sessionRaw.remoteMcpServers);
  pushListOption(args, "--allowedTools", request.enabledMcpTools ?? request.allowedTools ?? sessionRaw.enabledMcpTools);
  pushListOption(args, "--disallowedTools", request.disallowedTools ?? sessionRaw.disallowedTools);
  pushListOption(args, "--tools", request.tools ?? sessionRaw.tools);
  const settingSources = stringList(request.settingSources);
  if (settingSources.length > 0) args.push("--setting-sources", settingSources.join(","));
  if (request.useWorktree === true) {
    args.push("--worktree");
    const worktreeName = stringValue(request.worktreeName);
    if (worktreeName) args.push(worktreeName);
  }

  return args;
}

function userInputLine(prompt: string): string {
  return `${JSON.stringify({
    type: "user",
    session_id: "",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
    parent_tool_use_id: null,
  })}\n`;
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
  const effort = normalizeEffort(effortRaw) ? effortRaw! : null;
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

export class ClaudeCliRunner {
  private readonly active = new Map<string, ActiveTurn>();

  constructor(private readonly store: LocalSessionStore, private readonly callbacks: RunnerCallbacks) {}

  async getContextUsage(sessionId: string): Promise<unknown | null> {
    const activeTurn = this.active.get(sessionId);
    const session = this.store.getSession(sessionId);
    const transcript = session ? await this.store.getTranscript(session.id) : [];
    const modelHints = [latestInitEvent(transcript)?.model, session?.model];
    const storedUsage = session ? await contextUsageFromStoredSession(this.store, session) : null;
    if (activeTurn) {
      // Prefer live CLI collectContextData (full categories + Free space residual).
      const liveUsage = await this.sendControlRequest(activeTurn, { subtype: "get_context_usage" });
      return enrichContextUsage(liveUsage, modelHints) ?? storedUsage;
    }

    if (!session?.cliSessionId) return storedUsage;
    // Do not short-circuit on coarse stored usage — previously storedUsage without Free
    // space / rawMax blocked the probe, so the Ku bar filled 100% used-only.
    const liveUsage = await this.runControlRequestProbe(session, { subtype: "get_context_usage" });
    return enrichContextUsage(liveUsage, modelHints) ?? storedUsage;
  }

  /**
   * Official get_settings → applied effort — the runtime truth for the Effort
   * slider / Ultracode footer chip. Active turn via sendControlRequest; cold
   * sessions resume via runControlRequestProbe (same pattern as getContextUsage).
   * Returns the full applied bag (effort / effortLevels / ultracodeOfferable) or
   * null when the CLI cannot report — host store is the fallback at the handler.
   */
  async getAppliedEffort(sessionId: string): Promise<{
    effort: string | null;
    effortLevels: string[] | null;
    ultracodeOfferable: boolean | null;
  } | null> {
    const activeTurn = this.active.get(sessionId);
    const session = this.store.getSession(sessionId);
    let response: unknown | null = null;
    if (activeTurn) {
      response = await this.sendControlRequest(activeTurn, { subtype: "get_settings" });
    } else if (session?.cliSessionId) {
      response = await this.runControlRequestProbe(session, { subtype: "get_settings" });
    }
    if (response == null) return null;
    return parseAppliedEffortBag(response);
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

      try {
        child = spawnClaude(executable, args, process.cwd());
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
          writeJsonLine(child!, { type: "user", message: { role: "user", content: [{ type: "text", text: "." }] } });
        } catch { /* stdin closed */ }
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
          try { child?.kill("SIGTERM"); } catch { /* already exited */ }
          finishWithKick(result);
          return;
        }
        if (!requested && stringValue(event.type) === "system" && stringValue(event.subtype) === "init") {
          requested = true;
          writeJsonLine(child!, { type: "control_request", request_id: requestId, request: { subtype: "get_settings" } });
        }
      });
      child.on("error", () => finishWithKick(result));
      child.on("close", () => {
        stdout.close();
        finishWithKick(result);
      });
    }).then((response) => (response == null ? null : parseAppliedEffortBag(response)));
  }

  runTurn(sessionId: string, prompt: string, request: Record<string, unknown> = {}): boolean {
    const session = this.store.getSession(sessionId);
    const text = prompt.trim();
    if (!session || !text) return false;
    if (this.active.has(sessionId)) {
      this.emitError(sessionId, "claude_session_already_running");
      return false;
    }

    const executable = defaultClaudeExecutable();
    const forkSourceCliSessionId = stringValue(asRecord(session.metadata).forkedFromCliSessionId);
    const hadCliSession = Boolean(session.cliSessionId);
    const shouldForkFromSource = !hadCliSession && Boolean(forkSourceCliSessionId);
    const cliSessionId = session.cliSessionId ?? forkSourceCliSessionId ?? randomUUID();
    if (!session.cliSessionId && !shouldForkFromSource) this.store.setCliSessionId(sessionId, cliSessionId);
    const args = buildClaudeArgs({ ...session, cliSessionId }, request, cliSessionId, hadCliSession || shouldForkFromSource, shouldForkFromSource);

    this.store.setRunning(sessionId, true, { kind: "claude-cli", executable, startedAt: nowIso(), lastError: undefined, lastExitCode: null });
    this.callbacks.onSessionUpdated(sessionId);

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnClaude(executable, args, resolveCwd(session));
      child.stdin.write(userInputLine(promptWithSelectedFiles(text, request.userSelectedFiles)));
    } catch (error) {
      this.finishWithError(sessionId, executable, error);
      return false;
    }

    const turn: ActiveTurn = { child, pendingControlResponses: new Map(), pendingPermissions: new Map(), stderr: [], sawAssistantText: false };
    this.active.set(sessionId, turn);

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.handleStdoutLine(sessionId, line));
    child.stderr.on("data", (data: Buffer) => {
      turn.stderr.push(data.toString("utf8"));
      if (turn.stderr.join("").length > 16_000) turn.stderr = [turn.stderr.join("").slice(-16_000)];
    });
    child.on("error", (error) => this.finishWithError(sessionId, executable, error));
    child.on("close", (code, signal) => {
      stdout.close();
      const current = this.active.get(sessionId);
      this.active.delete(sessionId);
      this.clearPendingControlResponses(current);
      this.clearPendingPermissions(sessionId, current);
      const stderr = current?.stderr.join("").trim();
      if (code && code !== 0) this.emitError(sessionId, stderr || `claude exited with code ${code}`);
      this.store.setRunning(sessionId, false, { kind: "claude-cli", executable, lastExitCode: code, lastError: code ? stderr : undefined, finishedAt: nowIso() });
      this.callbacks.onEvent({ type: "completed", sessionId, code, signal });
      this.callbacks.onSessionUpdated(sessionId);
    });

    return true;
  }

  stop(sessionId: string): boolean {
    const turn = this.active.get(sessionId);
    // Always clear store running/pending even if the child already exited —
    // otherwise the composer stays in isResponding forever (stuck stop button).
    this.clearPendingPermissions(sessionId, turn);
    this.clearPendingControlResponses(turn);
    if (turn) {
      try {
        if (!turn.child.killed) {
          // Prefer tree-kill style: SIGTERM the process group when possible.
          if (typeof turn.child.pid === "number" && turn.child.pid > 0) {
            try {
              process.kill(-turn.child.pid, "SIGTERM");
            } catch {
              turn.child.kill("SIGTERM");
            }
          } else {
            turn.child.kill("SIGTERM");
          }
        }
      } catch {
        try { turn.child.kill("SIGKILL"); } catch { /* ignore */ }
      }
      // If close is slow/missed, still drop active so a new turn can start.
      // close handler is idempotent via this.active.get checks.
      if (this.active.get(sessionId) === turn) {
        this.active.delete(sessionId);
      }
    }
    this.store.setRunning(sessionId, false, { kind: "claude-cli", finishedAt: nowIso() });
    this.callbacks.onEvent({ type: "stopped", sessionId });
    this.callbacks.onSessionUpdated(sessionId);
    return true;
  }

  findSessionIdForPermission(requestId: string): string | null {
    for (const [sessionId, turn] of this.active) {
      if (turn.pendingPermissions.has(requestId)) return sessionId;
    }
    for (const session of this.store.getAll(true)) {
      if (session.pendingToolPermissions?.some((request) => request.requestId === requestId)) return session.id;
    }
    return null;
  }

  respondToToolPermission(sessionId: string, requestId: string, decision: ToolPermissionDecision, updatedInput?: unknown): Record<string, unknown> {
    // Resolve the live turn by requestId first — sessionId from the UI/store can lag or
    // disagree with the active map key, which previously surfaced as no_active_turn while
    // the CLI was still waiting on stdin for control_response.
    let resolvedSessionId = sessionId;
    let turn = this.active.get(sessionId);
    if (!turn?.pendingPermissions.has(requestId)) {
      for (const [id, activeTurn] of this.active) {
        if (activeTurn.pendingPermissions.has(requestId)) {
          turn = activeTurn;
          resolvedSessionId = id;
          break;
        }
      }
    }
    if (!turn) {
      // Stale card: process already exited. Drop store pending so the UI can clear.
      this.store.clearPendingToolPermission(sessionId, requestId);
      if (resolvedSessionId !== sessionId) this.store.clearPendingToolPermission(resolvedSessionId, requestId);
      return { ok: false, error: "no_active_turn", requestId, decision };
    }
    if (turn.child.stdin.destroyed || turn.child.stdin.writableEnded) {
      return { ok: false, error: "permission_response_channel_unavailable", requestId, decision };
    }
    const pending = turn.pendingPermissions.get(requestId);
    if (!pending) return { ok: false, error: "permission_request_not_found", requestId, decision };
    // UI may attach sessionId for routing — strip bridge-only keys before CLI payload.
    const toolInput = stripBridgePermissionFields(updatedInput);
    const response = this.permissionResponsePayload(pending, decision, toolInput);
    const ok = writeJsonLine(turn.child, {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response,
      },
    });
    if (!ok) return { ok: false, error: "permission_response_channel_unavailable", requestId, decision };
    // Official shell: ExitPlanMode once with _targetMode also updates host session.permissionMode
    // so Mode pill seeds match CLI setMode without waiting for the next status event.
    if (decision === "once" && pending.toolName === "ExitPlanMode") {
      // Mirror official Mme setMode defaulting: missing/unknown _targetMode → default.
      const target = stringValue(asRecord(toolInput)._targetMode);
      const mode = target === "acceptEdits" || target === "auto" || target === "bypassPermissions" || target === "default"
        ? target
        : "default";
      const normalized = normalizePermissionMode(mode);
      if (normalized) {
        const current = this.store.getSession(resolvedSessionId);
        if (current && current.permissionMode !== normalized) {
          this.store.update(resolvedSessionId, { permissionMode: normalized });
          this.callbacks.onSessionUpdated(resolvedSessionId);
        }
      }
    }
    this.resolvePendingPermission(resolvedSessionId, turn, pending);
    return { ok: true, requestId, decision };
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
      const model = stringValue(event.model);
      if (model && model !== "<synthetic>") patch.model = model;
      // Do not apply init.permissionMode onto host session — official Mode pill does not
      // seed from Uke(init). Status is the live Fke signal for mode transitions.
    } else if (subtype === "status") {
      const permissionMode = normalizePermissionMode(stringValue(event.permissionMode));
      if (permissionMode) patch.permissionMode = permissionMode;
    }
    if (Object.keys(patch).length === 0) return;

    const current = this.store.getSession(sessionId);
    if (!current) return;
    if (patch.permissionMode && patch.permissionMode === current.permissionMode) delete patch.permissionMode;
    if (patch.model && patch.model === current.model) delete patch.model;
    if (Object.keys(patch).length === 0) return;
    this.store.update(sessionId, patch);
  }

  /**
   * Push permission mode into an active CLI turn via control_request set_permission_mode
   * (print.ts). CLI onChangeAppState then enqueues system/status which we persist + fan out.
   * When no turn is active, host store alone is enough — next runTurn uses --permission-mode.
   */
  async setPermissionMode(sessionId: string, mode: string): Promise<boolean> {
    const permissionMode = normalizePermissionMode(mode);
    if (!permissionMode) return false;
    const turn = this.active.get(sessionId);
    if (!turn) return false;
    if (turn.child.stdin.destroyed || turn.child.stdin.writableEnded) return false;
    const response = await this.sendControlRequest(turn, {
      subtype: "set_permission_mode",
      mode: permissionMode,
    });
    return response !== null;
  }

  /**
   * Official apply_flag_settings control for effort/ultracode — same wire shape as
   * set_permission_mode. Host store is authoritative for UI + next spawn; live turn
   * gets the flag layer merge so the running CLI picks up the new wire effort
   * (and workflow orchestration for ultracode) without a respawn.
   */
  async applyFlagSettings(sessionId: string, settings: Record<string, unknown>): Promise<boolean> {
    const turn = this.active.get(sessionId);
    if (!turn) return false;
    if (turn.child.stdin.destroyed || turn.child.stdin.writableEnded) return false;
    const response = await this.sendControlRequest(turn, {
      subtype: "apply_flag_settings",
      settings,
    });
    return response !== null;
  }

  private handleStdoutLine(sessionId: string, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(trimmed);
      event = { ...asRecord(parsed), sessionId };
    } catch {
      event = { type: "text", sessionId, text: trimmed, timestamp: nowIso() };
    }

    if (this.handleControlEvent(sessionId, event)) return;
    if (this.handleControlResponse(sessionId, event)) return;

    const cliSessionId = stringValue(event.session_id);
    const session = this.store.getSession(sessionId);
    if (cliSessionId && session && session.cliSessionId !== cliSessionId) this.store.setCliSessionId(sessionId, cliSessionId);
    if (event.type === "system" && stringValue(event.subtype) === "init" && Array.isArray(event.slash_commands)) {
      this.store.setSlashCommands(sessionId, event.slash_commands.filter((command): command is string => typeof command === "string" && command.length > 0));
    }
    // Official ion Fke/Uke: system init/status carry permissionMode (and init model).
    // CLI emits system:status whenever toolPermissionContext.mode changes (EnterPlanMode,
    // ExitPlanMode, Shift+Tab, slash /plan, etc.). Persist so composer pill re-syncs.
    this.syncLiveMetaFromCliEvent(sessionId, event);

    // Memory-only live tail for the running turn — the CLI writes the same events to the
    // jsonl, which is the durable source (official createCoworkRawTranscriptLoader path).
    this.store.appendTranscriptEvent(sessionId, event);
    // Official local agent path: stream_event + durable messages are pushed as
    // {type:"message", message:event}. session_updated is metadata-only (title /
    // folders / permissions) — do NOT fire it on every assistant NDJSON line or the
    // renderer will thrash and look like "old messages refresh".
    this.callbacks.onEvent({ type: "message", sessionId, message: event });

    const turn = this.active.get(sessionId);
    const assistantText = assistantTextFromEvent(event);
    if (assistantText && (event.type !== "result" || !turn?.sawAssistantText)) {
      // Durable assistant content lives in the CLI jsonl (already streamed above via the
      // live buffer) — no userData copy. Track sawAssistantText for the result-event gate.
      if (turn) turn.sawAssistantText = true;
    }
    // Never close stdin while a can_use_tool control_request is outstanding — that
    // kills the CLI mid-approval and the UI then gets no_active_turn on Allow/Deny.
    if (
      event.type === "result"
      && turn
      && turn.pendingPermissions.size === 0
      && !turn.child.stdin.destroyed
      && !turn.child.stdin.writableEnded
    ) {
      turn.child.stdin.end();
    }
    // session_updated only for lifecycle/meta (not each assistant/user content line).
    // stream_event never; assistant/user content is already onEvent(message).
    const eventType = stringValue(event.type);
    if (
      eventType
      && eventType !== "stream_event"
      && eventType !== "assistant"
      && eventType !== "user"
    ) {
      this.callbacks.onSessionUpdated(sessionId);
    }
  }

  private sendControlRequest(turn: ActiveTurn, request: Record<string, unknown>): Promise<unknown | null> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const cleanup = () => {
        const pending = turn.pendingControlResponses.get(requestId);
        if (pending) clearTimeout(pending.timer);
        turn.pendingControlResponses.delete(requestId);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, CONTROL_REQUEST_TIMEOUT_MS);
      turn.pendingControlResponses.set(requestId, { resolve, timer });
      const ok = writeJsonLine(turn.child, { type: "control_request", request_id: requestId, request });
      if (!ok) {
        cleanup();
        resolve(null);
      }
    });
  }

  private runControlRequestProbe(session: LocalSession, request: Record<string, unknown>): Promise<unknown | null> {
    const cliSessionId = session.cliSessionId;
    if (!cliSessionId) return Promise.resolve(null);
    const executable = defaultClaudeExecutable();
    // buildClaudeArgs already includes --print for stream_event partials.
    const args = buildClaudeArgs(session, {}, cliSessionId, true);
    const cwd = resolveCwd(session);
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
        try {
          child?.kill("SIGTERM");
        } catch {
          // The probe may already have exited.
        }
        finish(result);
      }, CONTROL_REQUEST_TIMEOUT_MS);

      try {
        child = spawnClaude(executable, args, cwd);
      } catch {
        finish(null);
        return;
      }

      const stdout = readline.createInterface({ input: child.stdout });
      stdout.on("line", (line) => {
        const event = parseJsonLine(line);
        const response = controlResponsePayload(event, requestId);
        if (response !== undefined) result = response;
      });
      child.on("error", () => finish(result));
      child.on("close", () => {
        stdout.close();
        finish(result);
      });

      writeJsonLine(child, { type: "control_request", request_id: requestId, request });
      child.stdin.end();
    });
  }

  private handleControlResponse(sessionId: string, event: Record<string, unknown>): boolean {
    const turn = this.active.get(sessionId);
    if (!turn || stringValue(event.type) !== "control_response") return false;
    const response = asRecord(event.response);
    const requestId = stringValue(response.request_id) ?? stringValue(event.request_id);
    if (!requestId) return true;
    const pending = turn.pendingControlResponses.get(requestId);
    if (!pending) return true;
    turn.pendingControlResponses.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(stringValue(response.subtype) === "success" ? response.response ?? null : null);
    return true;
  }

  private handleControlEvent(sessionId: string, event: Record<string, unknown>): boolean {
    const type = stringValue(event.type);
    if (type === "keep_alive") return true;
    if (type === "control_cancel_request") {
      const requestId = stringValue(event.request_id);
      if (requestId) this.cancelPendingPermission(sessionId, requestId);
      return true;
    }
    if (type !== "control_request") return false;
    const request = asRecord(event.request);
    const requestId = stringValue(event.request_id);
    if (stringValue(request.subtype) !== "can_use_tool" || !requestId) {
      this.writeControlError(sessionId, requestId, `Unsupported control request subtype: ${stringValue(request.subtype) ?? "unknown"}`);
      return true;
    }
    this.registerPendingPermission(sessionId, requestId, request);
    return true;
  }

  private registerPendingPermission(sessionId: string, requestId: string, request: Record<string, unknown>): void {
    const turn = this.active.get(sessionId);
    if (!turn) return;
    const pending: LocalToolPermissionRequest = {
      alwaysAllowScope: stringValue(request.always_allow_scope) ?? stringValue(request.alwaysAllowScope) ?? stringValue(request.permission_scope),
      decisionReason: stringValue(request.decision_reason),
      description: stringValue(request.description) ?? stringValue(request.title) ?? stringValue(request.display_name),
      hasAlwaysAllow: booleanValue(request.has_always_allow) ?? booleanValue(request.hasAlwaysAllow),
      input: request.input,
      requestId,
      sessionId,
      suggestions: request.permission_suggestions,
      toolName: stringValue(request.tool_name) ?? "Tool",
      toolUseId: stringValue(request.tool_use_id),
    };
    turn.pendingPermissions.set(requestId, pending);
    this.store.setPendingToolPermission(sessionId, pending);
    this.callbacks.onEvent({ type: "tool_permission_request", sessionId, request: pending });
    this.callbacks.onSessionUpdated(sessionId);
  }

  /**
   * Official PermissionPromptToolResultSchema + ion-dist Mme / shell ExitPlanMode once:
   *   deny  → { behavior:"deny", message }  (_feedbackMessage → official jme prefix)
   *   allow → { behavior:"allow", updatedInput }  (keeps _targetMode)
   *   ExitPlanMode once → updatedPermissions [{type:"setMode", mode, destination:"session"}]
   *   always → allow + updatedPermissions (CLI suggestions preferred)
   */
  private permissionResponsePayload(pending: LocalToolPermissionRequest, decision: ToolPermissionDecision, updatedInput?: unknown): Record<string, unknown> {
    // Prefer original pending.input when UI sends empty/routing-only payload.
    const fromUi = asRecord(updatedInput);
    const fromPending = asRecord(pending.input);
    // Routing-only keys already stripped; treat remaining UI object as authoritative when non-empty
    // beyond host decision markers (official keeps _targetMode / _feedbackMessage on updatedInput).
    const markerOnly = Object.keys(fromUi).every((key) => key === "_feedbackMessage" || key === "_targetMode");
    const input = Object.keys(fromUi).length > 0 && !markerOnly ? fromUi : (Object.keys(fromUi).length > 0 ? { ...fromPending, ...fromUi } : fromPending);
    if (decision === "deny") {
      const feedback = stringValue(fromUi._feedbackMessage) ?? stringValue(input._feedbackMessage);
      // Official Mme jme prefix when feedback present.
      const denyPrefix = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\n";
      return {
        behavior: "deny",
        message: feedback ? `${denyPrefix}${feedback}` : "Denied by user",
        ...(pending.toolUseId ? { toolUseID: pending.toolUseId } : {}),
      };
    }
    const body: Record<string, unknown> = {
      behavior: "allow",
      // Schema requires a record; empty object → CLI falls back to original tool input.
      // Official Mme passes full updatedInput including _targetMode for ExitPlanMode.
      updatedInput: input && typeof input === "object" ? input : {},
    };
    if (pending.toolUseId) body.toolUseID = pending.toolUseId;
    if (decision === "once" && pending.toolName === "ExitPlanMode") {
      // Official Mme / shell: setMode from _targetMode (acceptEdits|auto|bypassPermissions|default).
      const target = stringValue(input._targetMode);
      const mode = target === "acceptEdits" || target === "auto" || target === "bypassPermissions" ? target : "default";
      body.updatedPermissions = [{ type: "setMode", mode, destination: "session" }];
    } else if (decision === "always") {
      if (Array.isArray(pending.suggestions) && pending.suggestions.length > 0) {
        body.updatedPermissions = pending.suggestions;
      }
      // Do not invent replaceRules when CLI sent no suggestions — malformed updates
      // are ignored, but empty is safer than a wrong rule shape.
    }
    return body;
  }

  private writeControlError(sessionId: string, requestId: string | undefined, message: string): void {
    const turn = this.active.get(sessionId);
    if (!turn || !requestId) return;
    writeJsonLine(turn.child, {
      type: "control_response",
      response: {
        subtype: "error",
        request_id: requestId,
        error: message,
      },
    });
  }

  private resolvePendingPermission(sessionId: string, turn: ActiveTurn, pending: LocalToolPermissionRequest): void {
    turn.pendingPermissions.delete(pending.requestId);
    this.store.clearPendingToolPermission(sessionId, pending.requestId);
    this.callbacks.onEvent({ type: "tool_permission_resolved", sessionId, request: pending });
    this.callbacks.onSessionUpdated(sessionId);
  }

  private cancelPendingPermission(sessionId: string, requestId: string): void {
    const turn = this.active.get(sessionId);
    const pending = turn?.pendingPermissions.get(requestId) ?? this.store.getSession(sessionId)?.pendingToolPermissions?.find((item) => item.requestId === requestId);
    if (turn && pending) turn.pendingPermissions.delete(requestId);
    this.store.clearPendingToolPermission(sessionId, requestId);
    if (pending) this.callbacks.onEvent({ type: "tool_permission_resolved", sessionId, request: pending });
    this.callbacks.onSessionUpdated(sessionId);
  }

  private clearPendingPermissions(sessionId: string, turn?: ActiveTurn): void {
    const pending = [...(turn?.pendingPermissions.values() ?? [])];
    this.store.clearPendingToolPermissions(sessionId);
    for (const request of pending) this.callbacks.onEvent({ type: "tool_permission_resolved", sessionId, request });
  }

  private clearPendingControlResponses(turn?: ActiveTurn): void {
    for (const pending of turn?.pendingControlResponses.values() ?? []) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    turn?.pendingControlResponses.clear();
  }

  private emitError(sessionId: string, message: string): void {
    const event = { type: "error", sessionId, error: message, timestamp: nowIso() };
    this.store.appendTranscriptEvent(sessionId, event);
    this.callbacks.onEvent(event);
    this.callbacks.onSessionUpdated(sessionId);
  }

  private finishWithError(sessionId: string, executable: string, error: unknown): void {
    const current = this.active.get(sessionId);
    this.active.delete(sessionId);
    this.clearPendingControlResponses(current);
    this.clearPendingPermissions(sessionId, current);
    const message = error instanceof Error ? error.message : String(error);
    this.emitError(sessionId, message);
    this.store.setRunning(sessionId, false, { kind: "claude-cli", executable, lastError: message, finishedAt: nowIso() });
    this.callbacks.onSessionUpdated(sessionId);
  }
}
