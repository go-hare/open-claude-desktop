/**
 * Official Code session transport residual (app.asar LocalSessionManager):
 *   bD({ prompt: fJ AsyncIterable, options }) → SDK Query (ProcessTransport)
 *   sendMessage → inputStream.enqueue (warm multi-turn)
 *   signalTurnComplete → markNotRunning (keep query)
 *   interruptSession → query.interrupt()
 *   warmSession → resume query with empty stream waiting for enqueue
 *
 * densable product previously used print --print spawn per turn. That is NOT
 * official CCD. This module is the 1:1 Query path (same SDK as Cowork host-loop).
 */
import { randomUUID } from "node:crypto";
import {
  query as sdkQuery,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import {
  buildClaudeCliSpawnEnv,
  enrichClaudeCliSpawnEnvWithEnterpriseAuth,
} from "../custom3p/custom3pCliEnv";
import { resolveEnterpriseDisallowedTools } from "../coworkHostLoop/coworkEnterpriseConfig";
import { isCoworkGrowthBookFeatureOn } from "../coworkHostLoop/coworkGrowthBookFeatures";
import { CoworkAsyncInputQueue } from "../coworkSessions/coworkAsyncInputQueue";
import { getClaudePreviewCliMcpConfigCache, setClaudePreviewSessionCwd } from "../launch/claudePreviewHostRegistry";
import type { LocalSession, LocalToolPermissionRequest } from "./localSessionStore";
import { resolveCodeTranscriptPath } from "./codeTranscriptJsonl";
import { asMcpServerMap } from "./mcpConfigWire";
import { createSshSpawnClaudeCodeProcess, resolveSshRemoteCwd } from "./sshCliSpawn";
import { buildCodeManagedSettingsResidual } from "./codeSdkManagedSettingsResidual";
import { refreshCodeSdkOAuthTokenResidual } from "./codeSdkOauthResidual";
import {
  OFFICIAL_PRETOOLUSE_MATCHER_MZE_ZE,
  OFFICIAL_PRETOOLUSE_MATCHER_RZE,
  OFFICIAL_STRIP_SUGGESTIONS_TOOLS,
  OFFICIAL_WORKTREE_WRITE_TOOL_MATCHER,
  officialAlwaysAllowedReasonHit,
  officialAutoAllowTool,
  officialIsInteractiveMcpTool,
  officialIsPreviewStartTool,
  officialMcpToolEnabledGuard,
  officialPreviewStartPermission,
  officialRemoteDispatchPermissionDeny,
  officialReplaySessionPermissions,
  officialSessionDestinationSuggestions,
  officialSessionPermissionAllowShortCircuit,
  officialUnsupervisedInteractiveGuard,
  officialWorktreeWriteGuard,
  type SessionPermissionUpdate,
} from "./codeSdkHooksResidual";

/**
 * Official createBaseHooks worktree-write-guard GrowthBook flag (app.asar pt("2393677837")).
 * When off, PreToolUse dtr/ptr is a no-op (same as official).
 */
export const OFFICIAL_WORKTREE_WRITE_GUARD_FLAG_ID = "2393677837";

/** Official warm options flag residuals (app.asar LocalSessionManager). */
export const OFFICIAL_ASK_USER_QUESTION_HTML_FLAG_ID = "1412563253";
export const OFFICIAL_PROMPT_SUGGESTIONS_FLAG_ID = "162211072";
export const OFFICIAL_REPLAY_USER_MESSAGES_FLAG_ID = "2392971184";
/** Official W7i.adjustSdkOptions: when off, SSH drops plugins/mcpServers. */
export const OFFICIAL_SSH_KEEP_PLUGINS_MCP_FLAG_ID = "1496676413";

export type CodeSdkUserMessage = SDKUserMessage & { uuid: string };

export type CodeSdkSessionCallbacks = {
  onEvent: (event: Record<string, unknown>) => void;
  onSessionUpdated: (sessionId: string) => void;
  onPermissionAttention?: () => void;
  isBypassPermissionsModeEnabled?: () => boolean;
  /**
   * Official createBaseHooks Stop → signalTurnComplete residual.
   * Invoked from hooks.Stop when the Query emits Stop (turn complete).
   * Runner already mirrors result→markNotRunning; this is the official hook path.
   */
  onSignalTurnComplete?: (sessionId: string) => void;
  /**
   * Official handleToolPermission reads live session.sessionPermissionUpdates /
   * alwaysAllowedReasons mid-query (not the create-time snapshot).
   */
  getLiveSession?: () => LocalSession | null;
  /**
   * Official vu.shouldAutoApprovePermission residual for scheduledTaskId sessions.
   * Returns true only when task has stored approvedPermissions covering suggestions.
   */
  shouldAutoApproveScheduledPermission?: (
    scheduledTaskId: string,
    toolName: string,
    suggestions: unknown,
  ) => boolean;
};

export type CodeSdkActiveSession = {
  deferredSends: Array<{
    messageUuid?: string;
    request: Record<string, unknown>;
    text: string;
  }>;
  input: CoworkAsyncInputQueue<CodeSdkUserMessage>;
  isRunning: boolean;
  isStopping: boolean;
  loop: Promise<void>;
  pendingPermissions: Map<string, PendingPermissionWaiter>;
  query: Query;
  sawInit: boolean;
  sawResult: boolean;
  sessionId: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function permissionMode(value: string | undefined): PermissionMode | undefined {
  const raw = value === "bypass" ? "bypassPermissions" : value;
  if (
    raw
    && ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"].includes(raw)
  ) {
    return raw as PermissionMode;
  }
  return undefined;
}

function resolveCwd(session: LocalSession): string {
  if (session.cwd) return session.cwd;
  return process.cwd();
}

function nowIso(): string {
  return new Date().toISOString();
}

function hostPlatformKey(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `win32-${arch}`;
  if (process.platform === "darwin") return `darwin-${arch}`;
  return `linux-${arch}`;
}

function resolveCodeExecutable(): string {
  if (process.env.CLAUDE_CODE_EXECUTABLE) return process.env.CLAUDE_CODE_EXECUTABLE;
  const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
  const roots = [
    process.env.CLAUDE_DESKTOP_RESOURCES_ROOT
      ? path.join(process.env.CLAUDE_DESKTOP_RESOURCES_ROOT, "claude-code-bin")
      : undefined,
    process.resourcesPath ? path.join(process.resourcesPath, "claude-code-bin") : undefined,
    path.resolve(process.cwd(), "resources", "claude-code-bin"),
  ].filter((value): value is string => Boolean(value));
  for (const root of roots) {
    for (const candidate of [
      path.join(root, "platforms", hostPlatformKey(), binaryName),
      path.join(root, binaryName),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return process.platform === "win32" ? "claude.exe" : "claude";
}

type PendingPermissionWaiter = {
  pending: LocalToolPermissionRequest;
  resolve: (result: PermissionResult) => void;
  /** Official handleToolPermission abort listener residual. */
  abortListener?: () => void;
  signal?: AbortSignal;
  /** Official stallTimer residual (300s telemetry only — not auto-deny). */
  stallTimer?: ReturnType<typeof setTimeout>;
};

/** Official nme-ish tool label for deny message residual. */
function toolLabelForDeny(toolName: string): string {
  if (toolName.startsWith("mcp__")) {
    const bare = toolName.slice(toolName.lastIndexOf("__") + 2);
    return bare || toolName;
  }
  return toolName;
}

/**
 * Official deny message residual:
 *   feedback → prefix + feedback
 *   else `User rejected ${tool}` (+ optional path-ish snippet — product keeps tool only)
 */
export function officialPermissionDenyMessage(
  toolName: string,
  updatedInput?: unknown,
): { message: string; interrupt: boolean } {
  const feedback = stringValue(asRecord(updatedInput)._feedbackMessage);
  if (feedback) {
    // Official ytr prefix residual: product keeps feedback text without inventing unknown prefix.
    return { message: feedback, interrupt: false };
  }
  return {
    message: `User rejected ${toolLabelForDeny(toolName)}`,
    interrupt: true,
  };
}

/** Official fJ user message shape for streamInput / enqueue. */
export function buildCodeSdkUserMessage(
  text: string,
  messageUuid?: string,
  images?: unknown,
): CodeSdkUserMessage {
  const uuid = messageUuid && messageUuid.length > 0 ? messageUuid : randomUUID();
  const content: Array<Record<string, unknown>> = [];
  const imageList = Array.isArray(images) ? images : [];
  for (const raw of imageList) {
    const record = asRecord(raw);
    const base64 = stringValue(record.base64) ?? stringValue(record.data);
    const mediaType =
      stringValue(record.media_type)
      ?? stringValue(record.mediaType)
      ?? stringValue(record.mimeType)
      ?? "image/png";
    if (!base64) continue;
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: base64 },
    });
  }
  content.push({ type: "text", text });
  return {
    type: "user",
    uuid: uuid as CodeSdkUserMessage["uuid"],
    parent_tool_use_id: null,
    timestamp: nowIso(),
    message: {
      role: "user",
      content: content as unknown as SDKUserMessage["message"]["content"],
    },
  };
}

async function buildCodeSdkOptions(
  session: LocalSession,
  request: Record<string, unknown>,
  callbacks: CodeSdkSessionCallbacks,
  canUseTool: CanUseTool,
): Promise<Options> {
  let userDataPath: string | undefined;
  try {
    const { app } = await import("electron");
    userDataPath = app.getPath("userData");
  } catch {
    userDataPath = process.env.CLAUDE_USER_DATA_DIR || undefined;
  }

  const env = await enrichClaudeCliSpawnEnvWithEnterpriseAuth(
    buildClaudeCliSpawnEnv({
      processEnv: process.env,
      userDataPath,
    }),
    { userDataPath },
  );

  const model =
    stringValue(request.model)
    ?? (session.model && session.model !== "default" ? session.model : undefined);
  let mode = permissionMode(
    stringValue(request.permissionMode) ?? session.permissionMode,
  );
  if (mode === "bypassPermissions" && callbacks.isBypassPermissionsModeEnabled?.() !== true) {
    mode = "acceptEdits";
  }

  const cwd = resolveCwd(session);
  // Official KOi sessionCwd residual for Claude Preview MCP tools.
  setClaudePreviewSessionCwd(cwd);

  // Official warmSession options residual (app.asar):
  //   permissionMode, allowDangerouslySkipPermissions:!0, settingSources, includePartialMessages,
  //   canUseTool, hooks, mcpServers (setupMcpAndPlugins), disallowedTools (d0A(Ti())), …
  // Product: same core fields + MCP/preview merge + enterprise disallowed. Full hook matchers
  // (worktree-write-guard PreToolUse) stay residual-tracked; not invented here without helpers.
  const options: Options = {
    cwd,
    env,
    includePartialMessages: true,
    // Official warm: always allowDangerouslySkipPermissions:true on SDK options bag
    // (permissionMode still clamps bypass without desktop gi flag).
    allowDangerouslySkipPermissions: true,
    pathToClaudeCodeExecutable: resolveCodeExecutable(),
    permissionMode: mode ?? "default",
    canUseTool,
    settingSources: ["user", "project", "local"],
    stderr: (data: string) => {
      if (data && data.trim()) {
        // Best-effort diagnostics — official createStderrCapture binds to session tail.
        // Do not surface as FM unless query loop fails.
      }
    },
  };
  if (model) options.model = model;

  // Official managedSettings: AMA() residual — policy layer from enterprise Ti()/ci().
  // Omit when empty (no invent).
  const managed = buildCodeManagedSettingsResidual(
    userDataPath ? { getUserDataPath: () => userDataPath! } : {},
  );
  if (managed) options.managedSettings = managed;

  // Official getOAuthToken:()=>this.refreshOAuthTokenForSdk residual.
  // Returns cached live token only; null if none (never forge Anthropic login).
  // Option may be untyped in some SDK d.ts — cast keep residual wiring.
  (options as Options & {
    getOAuthToken?: () => Promise<string | null>;
  }).getOAuthToken = () => refreshCodeSdkOAuthTokenResidual();
  // Official warm/start resume residual:
  //   SSH: always pass resume:cliSessionId (remote transcript; no local jsonl pre-check).
  //   Local: only resume when ~/.claude jsonl exists — host-minted UUIDs (print-era
  //   setCliSessionId before first init) have no transcript → "No conversation found
  //   with session ID" (cli_resume_not_found). clearStale is done by ensureSdkSession.
  if (session.cliSessionId) {
    if (session.sshConfig) {
      options.resume = session.cliSessionId;
    } else {
      const transcriptPath = await resolveCodeTranscriptPath(session.cliSessionId, session.cwd);
      const resumable =
        Boolean(transcriptPath)
        && fs.existsSync(transcriptPath!)
        && fs.statSync(transcriptPath!).size > 0;
      if (resumable) {
        options.resume = session.cliSessionId;
      }
    }
  }
  const effort = stringValue(request.effort) ?? session.effort;
  if (
    effort === "low"
    || effort === "medium"
    || effort === "high"
    || effort === "xhigh"
    || effort === "max"
  ) {
    options.effort = effort;
  }
  const folders = [
    ...(session.folders ?? []),
    ...(session.userSelectedFolders ?? []),
  ].filter((folder) => folder && folder !== session.cwd);
  if (folders.length > 0) {
    options.additionalDirectories = [...new Set(folders)];
  }

  const sessionRaw = session as LocalSession & Record<string, unknown>;
  const agent = stringValue(request.agent) ?? stringValue(sessionRaw.agent);
  if (agent) options.agent = agent;

  // Official InternalMcp Claude Preview (voA) — local only (SSH never gets host preview MCP).
  // Official W7i.adjustSdkOptions residual for SSH:
  //   pt("1496676413") || (delete A.plugins, delete A.mcpServers)
  const sshStripPluginsMcp =
    Boolean(session.sshConfig)
    && !isCoworkGrowthBookFeatureOn(OFFICIAL_SSH_KEEP_PLUGINS_MCP_FLAG_ID);
  if (sshStripPluginsMcp) {
    delete (options as { plugins?: unknown }).plugins;
    delete options.mcpServers;
  } else {
    const previewCliMcp = session.sshConfig ? null : getClaudePreviewCliMcpConfigCache();
    const mergedMcp = {
      ...asMcpServerMap(request.mcpServers ?? sessionRaw.mcpServers),
      ...asMcpServerMap(previewCliMcp),
      ...asMcpServerMap(request.remoteMcpServers ?? sessionRaw.remoteMcpServers),
    };
    if (Object.keys(mergedMcp).length > 0) {
      options.mcpServers = mergedMcp as Options["mcpServers"];
    }
  }

  // Official configureSSHSpawn residual: spawnClaudeCodeProcess over SSH host-pipe.
  if (session.sshConfig) {
    options.spawnClaudeCodeProcess = createSshSpawnClaudeCodeProcess({
      sshConfig: session.sshConfig,
      remoteCwd: resolveSshRemoteCwd(session),
    });
    // Remote binary name (official pathToClaudeCodeExecutable = o.cliPath ?? "claude").
    options.pathToClaudeCodeExecutable =
      process.env.CLAUDE_SSH_REMOTE_EXECUTABLE || "claude";
  }

  // Official warm options residual (flag-gated only — never invent on):
  //   toolConfig.askUserQuestion.previewFormat: pt("1412563253") ? "html" : void 0
  //   promptSuggestions: pt("162211072") ? true : void 0
  //   extraArgs: pt("2392971184") && { "replay-user-messages": null }
  if (isCoworkGrowthBookFeatureOn(OFFICIAL_ASK_USER_QUESTION_HTML_FLAG_ID)) {
    options.toolConfig = {
      ...(options.toolConfig ?? {}),
      askUserQuestion: { previewFormat: "html" },
    };
  }
  if (isCoworkGrowthBookFeatureOn(OFFICIAL_PROMPT_SUGGESTIONS_FLAG_ID)) {
    options.promptSuggestions = true;
  }
  if (isCoworkGrowthBookFeatureOn(OFFICIAL_REPLAY_USER_MESSAGES_FLAG_ID)) {
    options.extraArgs = {
      ...(options.extraArgs ?? {}),
      "replay-user-messages": null,
    };
  }

  // Official systemPrompt residual: custom string or preset claude_code + append.
  const systemPrompt =
    stringValue(request.systemPrompt)
    ?? stringValue(sessionRaw.systemPrompt);
  const systemPromptAppend =
    stringValue(request.systemPromptAppend)
    ?? stringValue(sessionRaw.systemPromptAppend);
  if (systemPrompt) {
    options.systemPrompt = systemPromptAppend
      ? `${systemPrompt}${systemPromptAppend}`
      : systemPrompt;
  } else if (systemPromptAppend) {
    options.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      append: systemPromptAppend,
    };
  }

  const allowedTools = [
    ...(Array.isArray(request.enabledMcpTools) ? request.enabledMcpTools : []),
    ...(Array.isArray(request.allowedTools) ? request.allowedTools : []),
    ...(Array.isArray(sessionRaw.enabledMcpTools) ? (sessionRaw.enabledMcpTools as unknown[]) : []),
  ].filter((item): item is string => typeof item === "string" && item.length > 0);
  if (allowedTools.length > 0) {
    options.allowedTools = [...new Set(allowedTools)];
  }

  // Official d0A(Ti()) residual — enterprise disabledBuiltinTools → disallowedTools.
  const fromRequest = [
    ...(Array.isArray(request.disallowedTools) ? request.disallowedTools : []),
    ...(Array.isArray(sessionRaw.disallowedTools) ? (sessionRaw.disallowedTools as unknown[]) : []),
  ].filter((item): item is string => typeof item === "string" && item.length > 0);
  const fromEnterprise = resolveEnterpriseDisallowedTools(
    userDataPath ? { getUserDataPath: () => userDataPath! } : {},
  );
  const disallowed = [...new Set([...fromRequest, ...fromEnterprise])];
  if (disallowed.length > 0) {
    options.disallowedTools = disallowed;
  }

  // Official createBaseHooks residual:
  //   PreToolUse: dtr worktree-write-guard (pt("2393677837")), Rze + Mze|_ze fkA, mcp__.* Sit
  //   Stop: signalTurnComplete
  options.hooks = {
    PreToolUse: [
      {
        matcher: OFFICIAL_WORKTREE_WRITE_TOOL_MATCHER,
        hooks: [
          async (input) => {
            if (asRecord(input).hook_event_name !== "PreToolUse") return {};
            // Official: if (!pt("2393677837")) return {};
            // Unknown flags are off (ft residual) — only block when flag is on.
            if (!isCoworkGrowthBookFeatureOn(OFFICIAL_WORKTREE_WRITE_GUARD_FLAG_ID)) {
              return {};
            }
            const toolInput = asRecord(asRecord(input).tool_input);
            const guard = officialWorktreeWriteGuard(
              {
                worktreePath: session.worktreePath ?? null,
                baseRepo: session.originCwd ?? null,
              },
              toolInput,
            );
            if (guard.decision === "block") {
              return { decision: "block", reason: guard.reason };
            }
            return {};
          },
        ],
      },
      {
        // Official matcher:Rze
        matcher: OFFICIAL_PRETOOLUSE_MATCHER_RZE,
        hooks: [
          async (input) => {
            if (asRecord(input).hook_event_name !== "PreToolUse") return {};
            const interactive = officialUnsupervisedInteractiveGuard(session.permissionMode);
            if (interactive.decision === "block") {
              return { decision: "block", reason: interactive.reason };
            }
            return {};
          },
        ],
      },
      {
        // Official matcher:`${Mze}|${_ze}`
        matcher: OFFICIAL_PRETOOLUSE_MATCHER_MZE_ZE,
        hooks: [
          async (input) => {
            if (asRecord(input).hook_event_name !== "PreToolUse") return {};
            const interactive = officialUnsupervisedInteractiveGuard(session.permissionMode);
            if (interactive.decision === "block") {
              return { decision: "block", reason: interactive.reason };
            }
            return {};
          },
        ],
      },
      {
        matcher: "mcp__.*",
        hooks: [
          async (input) => {
            if (asRecord(input).hook_event_name !== "PreToolUse") return {};
            const toolName = stringValue(asRecord(input).tool_name) ?? "";
            // Residual safety net for interactive tools under alternate server slugs.
            if (officialIsInteractiveMcpTool(toolName)) {
              const interactive = officialUnsupervisedInteractiveGuard(session.permissionMode);
              if (interactive.decision === "block") {
                return { decision: "block", reason: interactive.reason };
              }
            }
            const mcp = officialMcpToolEnabledGuard(toolName, sessionRaw.enabledMcpTools);
            if (mcp.decision === "block") {
              return { decision: "block", reason: mcp.reason };
            }
            return {};
          },
        ],
      },
    ],
    // Official Stop:[{hooks:[async t=>{… this.signalTurnComplete(i) …}]}]
    // sessionId is closed over from createCodeSdkActiveSession via callbacks; use
    // host session.id (LocalSession.id === runner sessionId).
    Stop: [
      {
        hooks: [
          async (input) => {
            if (asRecord(input).hook_event_name !== "Stop") return {};
            callbacks.onSignalTurnComplete?.(session.id);
            return {};
          },
        ],
      },
    ],
  };

  // Official replaySessionPermissions(t, g) after MCP setup, before bD.
  const permissionUpdates = sessionRaw.sessionPermissionUpdates as SessionPermissionUpdate[] | undefined;
  if (permissionUpdates && permissionUpdates.length > 0) {
    const bag: { allowedTools?: string[]; additionalDirectories?: string[] } = {
      allowedTools: options.allowedTools ? [...options.allowedTools] : undefined,
      additionalDirectories: options.additionalDirectories
        ? [...options.additionalDirectories]
        : undefined,
    };
    officialReplaySessionPermissions(permissionUpdates, bag);
    if (bag.allowedTools) options.allowedTools = bag.allowedTools;
    if (bag.additionalDirectories) options.additionalDirectories = bag.additionalDirectories;
  }

  return options;
}

/**
 * Official bD warm/start: Query over AsyncIterable prompt (fJ queue).
 * Caller owns enqueue + for-await loop via createCodeSdkActiveSession.
 */
export async function createCodeSdkActiveSession(input: {
  callbacks: CodeSdkSessionCallbacks;
  request?: Record<string, unknown>;
  session: LocalSession;
  sessionId: string;
  /** When true, first user message is already enqueued by caller after create. */
  warmOnly?: boolean;
}): Promise<CodeSdkActiveSession> {
  const { callbacks, session, sessionId } = input;
  const request = input.request ?? {};
  const pendingPermissions = new Map<string, PendingPermissionWaiter>();

  /**
   * Official createCanUseTool residual:
   *   xXi(tool) → allow
   *   HXi(preview_start) → handlePreviewStartPermission / zHA (reuse/deny/ask)
   *   else handleToolPermission → UI card
   */
  const canUseTool: CanUseTool = async (toolName, toolInput, _options) => {
    // Live store: sessionPermissionUpdates / alwaysAllowedReasons may grow mid-query.
    const liveSession = callbacks.getLiveSession?.() ?? session;
    const liveRaw = liveSession as LocalSession & Record<string, unknown>;

    if (officialAutoAllowTool(toolName)) {
      return { behavior: "allow", updatedInput: toolInput as Record<string, unknown> };
    }

    // Official handleToolPermission short-circuit residual (before UI):
    // session allow rule (toolName, no ruleContent) + not plan mode.
    if (
      officialSessionPermissionAllowShortCircuit(
        liveSession.sessionPermissionUpdates as SessionPermissionUpdate[] | undefined,
        toolName,
        liveSession.permissionMode,
      )
    ) {
      return {
        behavior: "allow",
        updatedInput: toolInput as Record<string, unknown>,
        decisionClassification: "user_permanent",
      };
    }
    // Official alwaysAllowedReasons cache: `${tool}:${decisionReason}`.
    const decisionReason =
      stringValue(asRecord(_options).decisionReason)
      ?? stringValue(asRecord(_options).decision_reason);
    if (
      officialAlwaysAllowedReasonHit(
        liveSession.alwaysAllowedReasons,
        toolName,
        decisionReason,
        liveSession.permissionMode,
      )
    ) {
      return {
        behavior: "allow",
        updatedInput: toolInput as Record<string, unknown>,
        decisionClassification: "user_permanent",
      };
    }

    // Suggestions for scheduled auto-approve + UI (xtr strip happens later for interactive).
    const rawSuggestions =
      asRecord(_options).suggestions
      ?? asRecord(_options).permission_suggestions;

    // Official scheduledTaskId + vu.shouldAutoApprovePermission residual.
    if (
      liveSession.scheduledTaskId
      && callbacks.shouldAutoApproveScheduledPermission?.(
        liveSession.scheduledTaskId,
        toolName,
        rawSuggestions,
      )
    ) {
      return {
        behavior: "allow",
        updatedInput: toolInput as Record<string, unknown>,
        updatedPermissions: Array.isArray(rawSuggestions)
          ? (rawSuggestions as NonNullable<
              Extract<PermissionResult, { behavior: "allow" }>["updatedPermissions"]
            >)
          : undefined,
        decisionClassification: "user_permanent",
      };
    }

    // Official dispatchParentOrigin==="remote" auto-deny residual.
    const remoteDeny = officialRemoteDispatchPermissionDeny(
      toolName,
      liveSession.dispatchParentOrigin,
    );
    if (remoteDeny) {
      return {
        behavior: "deny",
        message: remoteDeny.message,
        decisionClassification: "user_reject",
      };
    }

    // Official Sit residual also enforced in hooks; double-check before UI.
    const mcp = officialMcpToolEnabledGuard(
      toolName,
      liveRaw.enabledMcpTools,
    );
    if (mcp.decision === "block") {
      return { behavior: "deny", message: mcp.reason };
    }
    if (officialIsInteractiveMcpTool(toolName)) {
      const interactive = officialUnsupervisedInteractiveGuard(liveSession.permissionMode);
      if (interactive.decision === "block") {
        return { behavior: "deny", message: interactive.reason };
      }
    }
    // Worktree write guard also in hooks; canUseTool path for tools that skip hooks.
    // Same pt("2393677837") gate as createBaseHooks.
    if (
      isCoworkGrowthBookFeatureOn(OFFICIAL_WORKTREE_WRITE_GUARD_FLAG_ID)
      && OFFICIAL_WORKTREE_WRITE_TOOL_MATCHER.split("|").includes(toolName)
    ) {
      const guard = officialWorktreeWriteGuard(
        {
          worktreePath: liveSession.worktreePath ?? null,
          baseRepo: liveSession.originCwd ?? null,
        },
        asRecord(toolInput),
      );
      if (guard.decision === "block") {
        return { behavior: "deny", message: guard.reason };
      }
    }

    let permissionInput: Record<string, unknown> = asRecord(toolInput);
    // Official HXi → handlePreviewStartPermission → zHA.
    if (officialIsPreviewStartTool(toolName)) {
      const preview = await officialPreviewStartPermission(
        permissionInput,
        resolveCwd(liveSession),
      );
      if (preview.action === "deny") {
        return { behavior: "deny", message: preview.message };
      }
      if (preview.action === "reuse") {
        return { behavior: "allow", updatedInput: preview.resolvedInput };
      }
      // action === "start" → fall through to UI with Ize-resolved input.
      permissionInput = preview.resolvedInput;
    }

    const requestId = randomUUID();
    const toolUseId =
      stringValue(asRecord(_options).toolUseID)
      ?? stringValue(asRecord(_options).tool_use_id);
    // Official: if (r && xtr.has(t)) r = void 0 — strip suggestions for interactive MCP.
    let suggestions: unknown = rawSuggestions;
    if (OFFICIAL_STRIP_SUGGESTIONS_TOOLS.has(toolName)) {
      suggestions = undefined;
    }
    const description =
      stringValue(asRecord(_options).description)
      ?? stringValue(permissionInput.description)
      ?? toolName;
    const pending: LocalToolPermissionRequest = {
      description,
      input: permissionInput,
      requestId,
      sessionId,
      toolName,
      toolUseId,
      decisionReason,
      suggestions,
    };
    // Official signal abort residual on can_use_tool options.
    const signal =
      (asRecord(_options).signal as AbortSignal | undefined)
      ?? undefined;

    // Official handleToolPermission supersede residual (LAM / cowork path in asar):
    // browser: / computer: / webfetch: — same session + same toolName + same JSON input
    // → dismiss prior pending with "Superseded by new permission request".
    // CCD Code path body lacks this block in minified extract, but product Code can
    // still surface computer-use / webfetch permission tools; port residual safely.
    if (
      toolName.startsWith("browser:")
      || toolName.startsWith("computer:")
      || toolName.startsWith("webfetch:")
    ) {
      const inputKey = JSON.stringify(permissionInput);
      for (const [priorId, waiter] of pendingPermissions.entries()) {
        if (waiter.pending.sessionId !== sessionId) continue;
        if (waiter.pending.toolName !== toolName) continue;
        if (JSON.stringify(waiter.pending.input ?? {}) !== inputKey) continue;
        if (waiter.stallTimer) clearTimeout(waiter.stallTimer);
        if (waiter.signal && waiter.abortListener) {
          try {
            waiter.signal.removeEventListener("abort", waiter.abortListener);
          } catch {
            /* ignore */
          }
        }
        pendingPermissions.delete(priorId);
        callbacks.onEvent({
          type: "tool_permission_resolved",
          sessionId,
          request: {
            requestId: priorId,
            sessionId,
            toolName: waiter.pending.toolName,
            input: waiter.pending.input,
          },
        });
        try {
          waiter.resolve({
            behavior: "deny",
            message: "Superseded by new permission request",
            decisionClassification: "user_reject",
          });
        } catch {
          /* ignore */
        }
      }
    }

    // Surface to web OfficialToolPermissionApprovals (same event as print path).
    callbacks.onEvent({
      type: "tool_permission_request",
      sessionId,
      request: pending,
    });
    callbacks.onPermissionAttention?.();
    callbacks.onSessionUpdated(sessionId);

    return await new Promise<PermissionResult>((resolve) => {
      if (signal?.aborted) {
        resolve({
          behavior: "deny",
          message: "Request aborted",
          decisionClassification: "user_reject",
        });
        return;
      }
      const abortListener = () => {
        const waiter = pendingPermissions.get(requestId);
        if (!waiter) return;
        if (waiter.stallTimer) clearTimeout(waiter.stallTimer);
        pendingPermissions.delete(requestId);
        callbacks.onEvent({
          type: "tool_permission_resolved",
          sessionId,
          request: { requestId, sessionId, toolName, input: permissionInput },
        });
        waiter.resolve({
          behavior: "deny",
          message: "Request aborted",
          decisionClassification: "user_reject",
        });
      };
      if (signal) {
        signal.addEventListener("abort", abortListener, { once: true });
      }
      // Official stallTimer 300s telemetry residual — product: no analytics sink; still
      // tracks timer so closeCodeSdkSession can clear it (no invent auto-deny).
      const stallTimer = setTimeout(() => {
        /* residual: lam_tool_permission_stalled @ 300s — no product analytics */
      }, 300_000);
      stallTimer.unref?.();
      pendingPermissions.set(requestId, {
        pending,
        resolve,
        abortListener,
        signal,
        stallTimer,
      });
    });
  };

  const sdkOptions = await buildCodeSdkOptions(session, request, callbacks, canUseTool);
  const inputQueue = new CoworkAsyncInputQueue<CodeSdkUserMessage>();
  const q = sdkQuery({
    prompt: inputQueue,
    options: sdkOptions,
  });

  const active: CodeSdkActiveSession = {
    deferredSends: [],
    input: inputQueue,
    isRunning: false,
    isStopping: false,
    loop: Promise.resolve(),
    pendingPermissions,
    query: q,
    sawInit: false,
    sawResult: false,
    sessionId,
  };

active.loop = (async () => {
    try {
      for await (const message of q) {
        handleSdkMessage(active, message as SDKMessage, callbacks);
      }
    } catch (error) {
      if (!active.isStopping) {
        const text = error instanceof Error ? error.message : String(error);
        const category = classifyCodeSdkError(text);
        callbacks.onEvent({
          type: "error",
          sessionId,
          error: text,
          errorCategory: category,
          timestamp: nowIso(),
        });
      }
    } finally {
      active.isRunning = false;
      callbacks.onSessionUpdated(sessionId);
    }
  })();

  return active;
}

/**
 * Official qwA / handleQueryError residual categories used by CCD recovery.
 * `cli_resume_not_found` ← "No conversation found with session ID"
 */
export function classifyCodeSdkError(message: string): string | undefined {
  const text = message.toLowerCase();
  if (text.includes("no conversation found with session id")) return "cli_resume_not_found";
  if (text.includes("no message found with message.uuid")) return "cli_rewind_target_not_found";
  if (text.includes("prompt is too long")) return "api_prompt_too_long";
  // Official qwA residual network categories used for SSH disconnect path.
  if (
    text.includes("connectionrefused")
    || text.includes("econnrefused")
    || text.includes("econnreset")
    || text.includes("socket hang up")
    || text.includes("ssh connection dropped")
    || text.includes("broken pipe")
  ) {
    return "network_error";
  }
  if (text.includes("401") || text.includes("unauthorized") || text.includes("authenticat")) {
    return "auth_error";
  }
  return undefined;
}

function handleSdkMessage(
  active: CodeSdkActiveSession,
  message: SDKMessage,
  callbacks: CodeSdkSessionCallbacks,
): void {
  const sessionId = active.sessionId;
  const record = { ...asRecord(message), sessionId } as Record<string, unknown>;
  const type = stringValue(record.type);

  if (type === "system" && stringValue(record.subtype) === "init") {
    active.sawInit = true;
  }
  if (type === "result") {
    active.sawResult = true;
    // Official asar: isRunning is NOT cleared on the result row itself.
    // signalTurnComplete (Stop / result path) either drainDeferredSends
    // (isRunning stays true) or markNotRunning. Clearing isRunning here
    // invents a race: mid-turn sendMessage sees !isRunning and enqueues
    // instead of deferredSends — Esc then finds empty deferred and
    // markNotRunning's (Send while queue should continue).
    // Official handleResultMessage: is_error + "No conversation found…" → session_not_found
    const isError = record.is_error === true;
    const resultText =
      stringValue(record.result)
      ?? (Array.isArray(record.errors) ? record.errors.map(String).join("; ") : undefined)
      ?? stringValue(record.error);
    if (isError && resultText) {
      const category = classifyCodeSdkError(resultText);
      if (category) {
        callbacks.onEvent({
          type: "error",
          sessionId,
          error: resultText,
          errorCategory: category,
          timestamp: nowIso(),
        });
      }
    }
  }

  // Official stream-json always stamps parent_tool_use_id (null = main Va).
  // Some SDK/3p rows omit the field; web Pke gate is `if (null !== parent) return`
  // so undefined skips typewriter entirely. Normalize missing → null on the bridge.
  if (
    type === "stream_event"
    && !Object.prototype.hasOwnProperty.call(record, "parent_tool_use_id")
    && !Object.prototype.hasOwnProperty.call(record, "parentToolUseId")
  ) {
    record.parent_tool_use_id = null;
  }

  // Same bridge shape as print NDJSON path: { type:"message", message:event }
  callbacks.onEvent({ type: "message", sessionId, message: record });

  if (
    type
    && type !== "stream_event"
    && type !== "assistant"
    && type !== "user"
    && type !== "result"
  ) {
    callbacks.onSessionUpdated(sessionId);
  }
  if (type === "result") {
    callbacks.onSessionUpdated(sessionId);
  }
}

/** Attach permission decision for canUseTool waiter (official respondToToolPermission shape). */
export function resolveCodeSdkPermission(
  active: CodeSdkActiveSession,
  requestId: string,
  decision: "always" | "deny" | "once",
  updatedInput?: unknown,
): boolean {
  const waiter = active.pendingPermissions.get(requestId);
  if (!waiter) return false;
  if (waiter.stallTimer) clearTimeout(waiter.stallTimer);
  if (waiter.signal && waiter.abortListener) {
    try {
      waiter.signal.removeEventListener("abort", waiter.abortListener);
    } catch {
      /* ignore */
    }
  }
  active.pendingPermissions.delete(requestId);

  const input =
    (updatedInput as Record<string, unknown> | undefined)
    ?? (waiter.pending.input as Record<string, unknown> | undefined)
    ?? {};

  let result: PermissionResult;
  if (decision === "deny") {
    const deny = officialPermissionDenyMessage(waiter.pending.toolName, updatedInput);
    result = {
      behavior: "deny",
      message: deny.message,
      interrupt: deny.interrupt,
      decisionClassification: "user_reject",
    };
  } else if (decision === "once") {
    // Official ExitPlanMode once → updatedPermissions setMode residual handled by runner.
    result = {
      behavior: "allow",
      updatedInput: input,
      decisionClassification: "user_temporary",
    };
  } else {
    // always — pass suggestions through as updatedPermissions (official residual).
    const suggestions = waiter.pending.suggestions;
    result = {
      behavior: "allow",
      updatedInput: input,
      ...(Array.isArray(suggestions)
        ? { updatedPermissions: suggestions as NonNullable<Extract<PermissionResult, { behavior: "allow" }>["updatedPermissions"]> }
        : {}),
      decisionClassification: "user_permanent",
    };
  }
  waiter.resolve(result);
  return true;
}

/**
 * Official clearPendingPermissions residual on teardown:
 * resolve outstanding waiters as aborted + clear stall timers.
 */
export function clearCodeSdkPendingPermissions(
  active: CodeSdkActiveSession,
  onResolved?: (requestId: string, toolName: string, input: unknown) => void,
): void {
  for (const [requestId, waiter] of active.pendingPermissions) {
    if (waiter.stallTimer) clearTimeout(waiter.stallTimer);
    if (waiter.signal && waiter.abortListener) {
      try {
        waiter.signal.removeEventListener("abort", waiter.abortListener);
      } catch {
        /* ignore */
      }
    }
    onResolved?.(requestId, waiter.pending.toolName, waiter.pending.input);
    try {
      waiter.resolve({
        behavior: "deny",
        message: "Request aborted",
        decisionClassification: "user_reject",
      });
    } catch {
      /* ignore */
    }
  }
  active.pendingPermissions.clear();
}

export function closeCodeSdkSession(active: CodeSdkActiveSession): void {
  active.isStopping = true;
  active.deferredSends = [];
  clearCodeSdkPendingPermissions(active);
  try {
    active.input.done();
  } catch {
    /* ignore */
  }
  try {
    active.query.close();
  } catch {
    /* ignore */
  }
}

/** Re-export for runner always+suggestions apply path. */
export { officialSessionDestinationSuggestions };
