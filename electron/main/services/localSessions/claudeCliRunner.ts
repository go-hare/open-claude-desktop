import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { LocalSession, LocalSessionStore, LocalToolPermissionRequest } from "./localSessionStore";

type RunnerCallbacks = {
  onEvent: (event: Record<string, unknown>) => void;
  onSessionUpdated: (sessionId: string) => void;
};

type ActiveTurn = {
  child: ChildProcessWithoutNullStreams;
  pendingPermissions: Map<string, LocalToolPermissionRequest>;
  stderr: string[];
  sawAssistantText: boolean;
};

type ToolPermissionDecision = "always" | "deny" | "once";

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function defaultClaudeExecutable(): string {
  if (process.env.CLAUDE_CODE_EXECUTABLE) return process.env.CLAUDE_CODE_EXECUTABLE;
  if (process.platform !== "win32") return "claude";
  const candidates = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "@go-hare", "claude-code", "bin", "claude.exe") : undefined,
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe") : undefined,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".bun", "bin", "claude.exe") : undefined,
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate))) ?? "claude.cmd";
}

function spawnClaude(executable: string, args: string[], cwd: string): ChildProcessWithoutNullStreams {
  const env = { ...process.env, CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT ?? "sdk-ts" };
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

function normalizeEffort(value: string | undefined): string | undefined {
  const mapped = value === "xhigh" ? "max" : value;
  return mapped && ["low", "medium", "high", "max"].includes(mapped) ? mapped : undefined;
}

function normalizeModel(value: string | undefined): string | undefined {
  if (!value || value === "default" || value === "opus-4") return undefined;
  if (value === "sonnet-4") return "sonnet";
  return value;
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
  const args = [
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

  const model = normalizeModel(stringValue(request.model)) ?? normalizeModel(session.model);
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

function writeJsonLine(child: ChildProcessWithoutNullStreams, value: Record<string, unknown>): boolean {
  if (child.stdin.destroyed || child.stdin.writableEnded) return false;
  child.stdin.write(`${JSON.stringify(value)}\n`);
  return true;
}

export class ClaudeCliRunner {
  private readonly active = new Map<string, ActiveTurn>();

  constructor(private readonly store: LocalSessionStore, private readonly callbacks: RunnerCallbacks) {}

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
      child.stdin.write(userInputLine(text));
    } catch (error) {
      this.finishWithError(sessionId, executable, error);
      return false;
    }

    const turn: ActiveTurn = { child, pendingPermissions: new Map(), stderr: [], sawAssistantText: false };
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
    if (!turn) return false;
    turn.child.kill("SIGTERM");
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
    const turn = this.active.get(sessionId);
    if (!turn) return { ok: false, error: "no_active_turn", requestId, decision };
    if (turn.child.stdin.destroyed || turn.child.stdin.writableEnded) {
      return { ok: false, error: "permission_response_channel_unavailable", requestId, decision };
    }
    const pending = turn.pendingPermissions.get(requestId);
    if (!pending) return { ok: false, error: "permission_request_not_found", requestId, decision };
    const response = this.permissionResponsePayload(pending, decision, updatedInput);
    const ok = writeJsonLine(turn.child, {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response,
      },
    });
    if (!ok) return { ok: false, error: "permission_response_channel_unavailable", requestId, decision };
    this.resolvePendingPermission(sessionId, turn, pending);
    return { ok: true, requestId, decision };
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

    const cliSessionId = stringValue(event.session_id);
    const session = this.store.getSession(sessionId);
    if (cliSessionId && session && session.cliSessionId !== cliSessionId) this.store.setCliSessionId(sessionId, cliSessionId);

    this.store.appendTranscriptEvent(sessionId, event);
    this.callbacks.onEvent({ type: "message", sessionId, message: event });

    const turn = this.active.get(sessionId);
    const assistantText = assistantTextFromEvent(event);
    if (assistantText && (event.type !== "result" || !turn?.sawAssistantText)) {
      this.store.appendMessage(sessionId, "assistant", assistantText, event, false);
      if (turn) turn.sawAssistantText = true;
    }
    if (event.type === "result" && turn && !turn.child.stdin.destroyed && !turn.child.stdin.writableEnded) turn.child.stdin.end();
    if (event.type !== "stream_event") this.callbacks.onSessionUpdated(sessionId);
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
      decisionReason: stringValue(request.decision_reason),
      description: stringValue(request.description) ?? stringValue(request.title) ?? stringValue(request.display_name),
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

  private permissionResponsePayload(pending: LocalToolPermissionRequest, decision: ToolPermissionDecision, updatedInput?: unknown): Record<string, unknown> {
    if (decision === "deny") {
      const feedback = stringValue(asRecord(updatedInput)._feedbackMessage);
      return {
        behavior: "deny",
        message: feedback ? `User rejected ${pending.toolName}: ${feedback}` : `User rejected ${pending.toolName}`,
        interrupt: !feedback,
        decisionClassification: "user_reject",
        toolUseID: pending.toolUseId,
      };
    }
    const response: Record<string, unknown> = {
      behavior: "allow",
      updatedInput: updatedInput ?? pending.input,
      decisionClassification: decision === "always" ? "user_permanent" : "user_temporary",
      toolUseID: pending.toolUseId,
    };
    if (decision === "always") response.updatedPermissions = pending.suggestions;
    return response;
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

  private emitError(sessionId: string, message: string): void {
    const event = { type: "error", sessionId, error: message, timestamp: nowIso() };
    this.store.appendTranscriptEvent(sessionId, event);
    this.callbacks.onEvent(event);
    this.callbacks.onSessionUpdated(sessionId);
  }

  private finishWithError(sessionId: string, executable: string, error: unknown): void {
    const current = this.active.get(sessionId);
    this.active.delete(sessionId);
    this.clearPendingPermissions(sessionId, current);
    const message = error instanceof Error ? error.message : String(error);
    this.emitError(sessionId, message);
    this.store.setRunning(sessionId, false, { kind: "claude-cli", executable, lastError: message, finishedAt: nowIso() });
    this.callbacks.onSessionUpdated(sessionId);
  }
}
