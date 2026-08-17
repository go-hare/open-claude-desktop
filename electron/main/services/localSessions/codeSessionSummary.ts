/**
 * Official LocalSessionManager SessionSummary residual (app.asar / index.js):
 *   summarizeSession(id) → stop prior → fork resume query (forkSession:true, persistSession:false,
 *     allowedTools:[], canUseTool deny) + systemPrompt append ame + prompt sme
 *   summarizeTranscript(id, text) → same without resume; prompt wraps <session_transcript>
 *   consume → for await query → session_summary_result | session_summary_error
 *   stopSessionSummary(id) → query.close() → true if aborted
 *
 * Product: same fork path via @anthropic-ai/claude-agent-sdk query (not invent 1000-char dump).
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
import type { LocalSession } from "./localSessionStore";
import { resolveCodeTranscriptPath } from "./codeTranscriptJsonl";
import { createSshSpawnClaudeCodeProcess, resolveSshRemoteCwd } from "./sshCliSpawn";

/** Residual `sme` — executive summary user prompt. */
export const OFFICIAL_SESSION_SUMMARY_PROMPT = `Produce an executive summary of this session for the person who started it. Use markdown. Structure it as:

## Purpose
One or two sentences on what the user is trying to accomplish.

## Current state
Where things are right now — what's done, what's in flight, key files touched.

## Outcome
The result so far, any blockers, and the obvious next step.

Be concise. No preamble, no "here is a summary".`;

/** Residual `ame` — systemPrompt.append on preset claude_code. */
export const OFFICIAL_SESSION_SUMMARY_SYSTEM_APPEND =
  "\n\nYou are generating a one-shot executive summary of the conversation so far. You have NO tools — answer entirely from the transcript context. Output only the summary; no preamble.";

const RESULT_SUBTYPE_ERRORS: Record<string, string> = {
  error_during_execution: "Summary failed (error_during_execution).",
  error_max_turns: "Summary failed (error_max_turns).",
  error_max_budget_usd: "Summary failed (error_max_budget_usd).",
  error_max_structured_output_retries: "Summary failed (error_max_structured_output_retries).",
};

type SummaryHandle = { query: Query };

export type SessionSummaryEmitter = {
  emit: (event: {
    sessionId: string;
    type: "session_summary_result" | "session_summary_error";
    data?: string;
    error?: string;
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

export class CodeSessionSummaryService {
  private readonly handles = new Map<string, SummaryHandle>();
  private readonly emitter: SessionSummaryEmitter;

  constructor(emitter: SessionSummaryEmitter) {
    this.emitter = emitter;
  }

  /**
   * Residual summarizeSession(A): requires cliSessionId; fork resume; prompt sme.
   * Returns true when a query was started (Df.start residual).
   */
  async summarizeSession(session: LocalSession | null | undefined): Promise<boolean> {
    const sessionId = session?.id;
    if (!sessionId) return false;
    this.stop(sessionId);
    if (!session?.cliSessionId) {
      this.emitError(sessionId, "No transcript yet — send a message first.");
      return true;
    }
    try {
      const options = await this.buildForkOptions(session, { resume: session.cliSessionId, fork: true });
      const query = sdkQuery({
        prompt: OFFICIAL_SESSION_SUMMARY_PROMPT,
        options,
      });
      const handle: SummaryHandle = { query };
      this.handles.set(sessionId, handle);
      void this.consume(sessionId, handle);
      return true;
    } catch (error) {
      this.emitError(sessionId, error instanceof Error ? error.message : String(error));
      return true;
    }
  }

  /**
   * Residual summarizeTranscript(A, t): no resume; wrap transcript + sme.
   */
  async summarizeTranscript(sessionId: string, transcript: string): Promise<boolean> {
    if (!sessionId) return false;
    this.stop(sessionId);
    const text = transcript.trim();
    if (!text) {
      this.emitError(sessionId, "No transcript yet — send a message first.");
      return true;
    }
    try {
      const options = await this.buildForkOptions(null, { resume: undefined, fork: false });
      const prompt = `<session_transcript>\n${text}\n</session_transcript>\n\n${OFFICIAL_SESSION_SUMMARY_PROMPT}`;
      const query = sdkQuery({ prompt, options });
      const handle: SummaryHandle = { query };
      this.handles.set(sessionId, handle);
      void this.consume(sessionId, handle);
      return true;
    } catch (error) {
      this.emitError(sessionId, error instanceof Error ? error.message : String(error));
      return true;
    }
  }

  /** Residual stopSessionSummary(A) → boolean. */
  stop(sessionId: string): boolean {
    const handle = this.handles.get(sessionId);
    if (!handle) return false;
    this.handles.delete(sessionId);
    try {
      handle.query.close();
    } catch {
      /* residual warns; ignore */
    }
    return true;
  }

  private emitError(sessionId: string, error: string) {
    this.emitter.emit({ sessionId, type: "session_summary_error", error });
  }

  private async buildForkOptions(
    session: LocalSession | null,
    opts: { resume?: string; fork: boolean },
  ): Promise<Options> {
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
      (session?.worktreePath || session?.cwd || homePath || process.cwd()).trim()
      || process.cwd();

    const options: Options = {
      cwd,
      env,
      model: "sonnet",
      // Residual: persistSession:!1, allowedTools:[], canUseTool deny, strictMcpConfig:!0
      persistSession: false,
      allowedTools: [],
      canUseTool: async () => ({
        behavior: "deny",
        message: "Summary fork has no tools.",
        decisionClassification: "user",
      }),
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      pathToClaudeCodeExecutable: resolveCodeExecutable(),
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: OFFICIAL_SESSION_SUMMARY_SYSTEM_APPEND,
      },
      stderr: () => {
        /* residual SessionSummary stderr capture — no invent surface */
      },
    };

    if (opts.resume) {
      // Local: only resume when jsonl exists (same as codeSdkQuerySession warm residual).
      if (session?.sshConfig) {
        options.resume = opts.resume;
        options.forkSession = opts.fork;
        options.spawnClaudeCodeProcess = createSshSpawnClaudeCodeProcess({
          sshConfig: session.sshConfig,
          remoteCwd: resolveSshRemoteCwd(session),
        });
        options.pathToClaudeCodeExecutable =
          process.env.CLAUDE_SSH_REMOTE_EXECUTABLE || "claude";
      } else {
        const transcriptPath = await resolveCodeTranscriptPath(opts.resume, session?.cwd);
        const resumable =
          Boolean(transcriptPath)
          && fs.existsSync(transcriptPath!)
          && fs.statSync(transcriptPath!).size > 0;
        if (resumable) {
          options.resume = opts.resume;
          options.forkSession = opts.fork;
        } else {
          throw new Error("No transcript yet — send a message first.");
        }
      }
    }

    return options;
  }

  private async consume(sessionId: string, handle: SummaryHandle) {
    let text = "";
    try {
      for await (const message of handle.query) {
        if (this.handles.get(sessionId) !== handle) return;
        if (message.type === "assistant") {
          const chunk = contentTextFromAssistant(message);
          if (chunk) text += (text ? "\n\n" : "") + chunk;
        } else if (message.type === "result") {
          const result = message as {
            subtype?: string;
            is_error?: boolean;
            result?: string;
          };
          if (result.subtype === "success") {
            if (result.is_error) {
              this.emitError(
                sessionId,
                result.result || "Something went wrong — try again.",
              );
            } else {
              this.emitter.emit({
                sessionId,
                type: "session_summary_result",
                data: text,
              });
            }
          } else {
            const subtype = result.subtype ?? "unknown";
            this.emitError(
              sessionId,
              RESULT_SUBTYPE_ERRORS[subtype] ?? `Summary failed (${subtype}).`,
            );
          }
        }
      }
    } catch (error) {
      if (this.handles.get(sessionId) === handle) {
        this.emitError(sessionId, error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (this.handles.get(sessionId) === handle) {
        this.handles.delete(sessionId);
      }
    }
  }
}
