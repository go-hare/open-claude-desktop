/**
 * Official LocalSessionManager startSideChat residual (app.asar):
 *   stop prior (emitClosed:false) → require parent cliSessionId → fJ + bD
 *     resume:cliSessionId, forkSession:true, persistSession:false, allowedTools:[],
 *     canUseTool deny "Side chat has no tools.", empty MCP, systemPrompt append Rtr
 *   emit side_chat_ready then for-await assistant → side_chat_assistant,
 *     result → side_chat_turn_end, finally side_chat_closed
 *   sendSideChatMessage → input.enqueue user
 *   stopSideChat → input.done + query.close
 *
 * Events stamp parent sessionId. No Recents child. No persist jsonl.
 */
import {
  query as sdkQuery,
  type Options,
  type Query,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import {
  buildClaudeCliSpawnEnv,
  enrichClaudeCliSpawnEnvWithEnterpriseAuth,
} from "../custom3p/custom3pCliEnv";
import { CoworkAsyncInputQueue } from "../coworkSessions/coworkAsyncInputQueue";
import type { LocalSession } from "./localSessionStore";
import { resolveCodeTranscriptPath } from "./codeTranscriptJsonl";
import { createSshSpawnClaudeCodeProcess, resolveSshRemoteCwd } from "./sshCliSpawn";
import { buildCodeSdkUserMessage, type CodeSdkUserMessage } from "./codeSdkQuerySession";

/** Residual `Rtr` — systemPrompt.append on preset claude_code. */
export const OFFICIAL_SIDE_CHAT_SYSTEM_APPEND =
  "You are running in a side chat — a lightweight fork of the main conversation. The main agent continues independently; nothing you say here lands in the main transcript. You have NO tools in this fork: answer directly from the conversation context, and say so if you'd need to read a file or run a command to be sure. The user may ask follow-ups.";

export const OFFICIAL_SIDE_CHAT_NO_TRANSCRIPT =
  "Can't fork yet — send a message in the main chat first so there's a transcript to branch from.";

export const OFFICIAL_SIDE_CHAT_NOT_RUNNING =
  "Side chat isn't running — reopen the panel to start a new one.";

const TURN_SUBTYPE_ERRORS: Record<string, string> = {
  error_during_execution: "Turn failed (error_during_execution).",
  error_max_turns: "Turn failed (error_max_turns).",
  error_max_budget_usd: "Turn failed (error_max_budget_usd).",
  error_max_structured_output_retries: "Turn failed (error_max_structured_output_retries).",
};

type SideChatHandle = {
  input: CoworkAsyncInputQueue<CodeSdkUserMessage>;
  isStopping: boolean;
  query: Query;
};

export type SideChatEmitter = {
  emit: (event: {
    data?: string;
    error?: string;
    sessionId: string;
    type:
      | "side_chat_ready"
      | "side_chat_assistant"
      | "side_chat_turn_end"
      | "side_chat_error"
      | "side_chat_closed";
  }) => void;
};

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

function contentTextFromAssistant(message: SDKMessage): string {
  if (message.type !== "assistant") return "";
  const content = (message as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const rec = block as { type?: string; text?: string };
      return rec.type === "text" && typeof rec.text === "string" ? [rec.text] : [];
    })
    .join("\n\n")
    .trim();
}

export class CodeSideChatService {
  private readonly handles = new Map<string, SideChatHandle>();
  private readonly emitter: SideChatEmitter;

  constructor(emitter: SideChatEmitter) {
    this.emitter = emitter;
  }

  /**
   * Residual startSideChat(A): stop prior without closed; fork resume; emit ready.
   */
  async start(session: LocalSession | null | undefined): Promise<void> {
    const sessionId = session?.id;
    if (!sessionId) return;
    this.stop(sessionId, { emitClosed: false });
    if (!session?.cliSessionId) {
      this.fail(sessionId, OFFICIAL_SIDE_CHAT_NO_TRANSCRIPT);
      return;
    }
    try {
      const options = await this.buildForkOptions(session);
      const input = new CoworkAsyncInputQueue<CodeSdkUserMessage>();
      const query = sdkQuery({
        prompt: input,
        options,
      });
      const handle: SideChatHandle = { input, isStopping: false, query };
      this.handles.set(sessionId, handle);
      this.emitter.emit({ sessionId, type: "side_chat_ready" });
      void this.consume(sessionId, handle);
    } catch (error) {
      this.fail(
        sessionId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Residual sendSideChatMessage(A, t). */
  send(sessionId: string, text: string): void {
    const handle = this.handles.get(sessionId);
    if (!handle) {
      this.emitter.emit({
        sessionId,
        type: "side_chat_error",
        error: OFFICIAL_SIDE_CHAT_NOT_RUNNING,
      });
      return;
    }
    handle.input.enqueue(buildCodeSdkUserMessage(text));
  }

  /** Residual stopSideChat(A, {emitClosed}). */
  stop(sessionId: string, opts: { emitClosed?: boolean } = {}): boolean {
    const handle = this.handles.get(sessionId);
    if (!handle) return false;
    handle.isStopping = true;
    this.handles.delete(sessionId);
    try {
      handle.input.done();
    } catch {
      /* residual warns; ignore */
    }
    try {
      handle.query.close();
    } catch {
      /* residual warns; ignore */
    }
    if (opts.emitClosed !== false) {
      this.emitter.emit({ sessionId, type: "side_chat_closed" });
    }
    return true;
  }

  private fail(sessionId: string, error: string) {
    this.emitter.emit({ sessionId, type: "side_chat_error", error });
    this.emitter.emit({ sessionId, type: "side_chat_closed" });
  }

  private async buildForkOptions(session: LocalSession): Promise<Options> {
    let userDataPath: string | undefined;
    let homePath: string | undefined;
    try {
      const { app } = await import("electron");
      userDataPath = app.getPath("userData");
      homePath = app.getPath("home");
    } catch {
      userDataPath = process.env.CLAUDE_USER_DATA_DIR || undefined;
      homePath = process.env.HOME || process.cwd();
    }

    const env = await enrichClaudeCliSpawnEnvWithEnterpriseAuth(
      buildClaudeCliSpawnEnv({
        processEnv: process.env,
        userDataPath,
      }),
      { userDataPath },
    );

    const cwd =
      (session.worktreePath || session.cwd || homePath || process.cwd()).trim()
      || process.cwd();

    const options: Options = {
      cwd,
      env,
      model: session.model || "default",
      persistSession: false,
      allowedTools: [],
      canUseTool: async () => ({
        behavior: "deny",
        message: "Side chat has no tools.",
        decisionClassification: "user",
      }),
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      pathToClaudeCodeExecutable: resolveCodeExecutable(),
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: OFFICIAL_SIDE_CHAT_SYSTEM_APPEND,
      },
      stderr: () => {
        /* residual SideChat stderr capture — no invent surface */
      },
    };

    const effort = session.effort;
    if (
      effort === "low"
      || effort === "medium"
      || effort === "high"
      || effort === "xhigh"
      || effort === "max"
    ) {
      options.effort = effort;
    }

    const resume = session.cliSessionId;
    if (!resume) throw new Error(OFFICIAL_SIDE_CHAT_NO_TRANSCRIPT);
    if (session.sshConfig) {
      options.resume = resume;
      options.forkSession = true;
      options.spawnClaudeCodeProcess = createSshSpawnClaudeCodeProcess({
        sshConfig: session.sshConfig,
        remoteCwd: resolveSshRemoteCwd(session),
      });
      options.pathToClaudeCodeExecutable =
        process.env.CLAUDE_SSH_REMOTE_EXECUTABLE || "claude";
    } else {
      const transcriptPath = await resolveCodeTranscriptPath(resume, session.cwd);
      const resumable =
        Boolean(transcriptPath)
        && fs.existsSync(transcriptPath!)
        && fs.statSync(transcriptPath!).size > 0;
      if (!resumable) throw new Error(OFFICIAL_SIDE_CHAT_NO_TRANSCRIPT);
      options.resume = resume;
      options.forkSession = true;
    }
    return options;
  }

  private async consume(sessionId: string, handle: SideChatHandle) {
    try {
      for await (const message of handle.query) {
        if (this.handles.get(sessionId) !== handle) return;
        if (message.type === "assistant") {
          const chunk = contentTextFromAssistant(message);
          if (chunk) {
            this.emitter.emit({
              sessionId,
              type: "side_chat_assistant",
              data: chunk,
            });
          }
        } else if (message.type === "result") {
          const result = message as {
            subtype?: string;
            is_error?: boolean;
            result?: string;
          };
          let error: string | undefined;
          if (result.subtype === "success") {
            if (result.is_error) {
              error = result.result || "Something went wrong — try again.";
            }
          } else {
            const subtype = result.subtype ?? "unknown";
            error = TURN_SUBTYPE_ERRORS[subtype] ?? `Turn failed (${subtype}).`;
          }
          this.emitter.emit({
            sessionId,
            type: "side_chat_turn_end",
            error,
          });
        }
      }
    } catch (error) {
      if (this.handles.get(sessionId) === handle && !handle.isStopping) {
        this.emitter.emit({
          sessionId,
          type: "side_chat_error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (this.handles.get(sessionId) === handle) {
        this.handles.delete(sessionId);
        this.emitter.emit({ sessionId, type: "side_chat_closed" });
      }
    }
  }
}
