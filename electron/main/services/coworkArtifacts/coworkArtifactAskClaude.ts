/**
 * Official CoworkArtifactBridge.askClaude residual (app.asar ior / Wnr / cz / mhe / Dhe).
 *
 * Control flow:
 *   !ft("2940196192") → cz("Artifact inference is not enabled.")
 *   !xR() shown artifact → cz("Artifact is not currently shown.")
 *   cache hit (mhe) → return cached k2i bag
 *   else Wnr:
 *     !CLI ready → { text: "Claude is still starting up…", isError: true }
 *     !OAuth → { text: "Not signed in.", isError: true }
 *     else single-turn tool-free query (CLAUDE_CODE_TAGS=artifact_sample)
 *   xR() changed mid-flight → cz("Artifact is no longer shown.")
 *   throw → cz(message | "Inference failed.")
 *
 * Product residual: same honest gates. Never invent ok text without real CLI+token.
 *
 * data-official-source: app.asar ior.askClaude / Wnr / jnr / $nr / cz / Dhe / mhe / yhe
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { isCoworkGrowthBookFeatureOn } from "../coworkHostLoop/coworkGrowthBookFeatures";
import { resolveClaudeCodeBinaryPath } from "../../ipc/shellSoftTrueResidual";
import { getCoworkApiToken } from "../coworkAccount/coworkOauthFlow";
import { resolveCoworkSessionsBridgeOauthConfig } from "../coworkAccount/coworkOauthConfigs";
import { buildClaudeCliSpawnEnv } from "../custom3p/custom3pCliEnv";

/** Official growthbook gate for artifact inference / coworkArtifacts capability. */
export const ARTIFACT_INFERENCE_FEATURE_FLAG = "2940196192";

export type AskClaudeResult = { text: string; isError?: boolean };

export type AskClaudeDeps = {
  isInferenceEnabled?: () => boolean;
  getShownArtifactId?: () => string | undefined;
  resolveBinaryPath?: () => string | null;
  getOAuthToken?: () => Promise<string | null>;
  runSample?: (
    prompt: string,
    data: unknown[] | undefined,
    binaryPath: string,
    token: string,
  ) => Promise<AskClaudeResult>;
  /** Official mhe/yhe cache — optional; default in-memory TTL residual. */
  cacheGet?: (
    artifactId: string,
    cacheKey: string,
  ) => AskClaudeResult | undefined | Promise<AskClaudeResult | undefined>;
  cacheSet?: (
    artifactId: string,
    cacheKey: string,
    value: AskClaudeResult,
  ) => void | Promise<void>;
  /** Official q1 dataCacheTtlMs residual default. */
  cacheTtlMs?: number;
  now?: () => number;
};

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

type CacheEntry = { value: AskClaudeResult; updatedAt: number };
const memoryCache = new Map<string, CacheEntry>();

function cacheKeyFor(artifactId: string, key: string): string {
  return `${artifactId}::${key}`;
}

/** Official cz residual. */
export function askClaudeCz(message: string): AskClaudeResult {
  return { text: message, isError: true };
}

/** Official Dhe residual — md5 of JSON.stringify(args). */
export function askClaudeCacheKey(prompt: string, data: unknown): string {
  return createHash("md5").update(JSON.stringify([prompt, data])).digest("hex");
}

/** Official jnr system prompt residual (trimmed product copy). */
export function artifactSampleSystemPrompt(now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `<application_details>
Claude is powering a Cowork dashboard's synthesis call. A dashboard artifact called window.cowork.askClaude() with a fixed task instruction and fresh data blocks (typically MCP tool results). Claude's job is to produce the requested synthesis — a summary, classification, extraction, or similar transformation of the provided data.

Be concise. Output only the requested content. The output renders directly inside a dashboard widget, so skip preambles like "Here's the summary:" and get straight to the answer.

This is a single-turn, tool-free call. Claude cannot ask clarifying questions or use any tools. If the instruction is ambiguous, make a reasonable interpretation and proceed.
</application_details>

<env>
Today's date: ${day}
</env>`;
}

/** Official $nr residual — wrap data blocks + prompt. */
export function buildArtifactSamplePrompt(
  prompt: string,
  data: unknown[] | undefined,
): string {
  if (!data || data.length === 0) return prompt;
  const blocks = data
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .map((item) => `<data>${item}</data>`)
    .join("\n");
  return `${blocks}\n\n${prompt}`;
}

/**
 * Official Wnr residual body (honest gates only; real sample when binary+token).
 * Inject runSample for unit tests; production uses SDK query when available.
 */
export async function runArtifactSampleWnr(
  prompt: string,
  data: unknown[] | undefined,
  deps: {
    resolveBinaryPath?: () => string | null;
    getOAuthToken?: () => Promise<string | null>;
    runSample?: (
      prompt: string,
      data: unknown[] | undefined,
      binaryPath: string,
      token: string,
    ) => Promise<AskClaudeResult>;
  } = {},
): Promise<AskClaudeResult> {
  // Prefer explicit inject even when it returns null (tests / honest missing binary).
  const binary =
    deps.resolveBinaryPath !== undefined
      ? deps.resolveBinaryPath()
      : resolveClaudeCodeBinaryPath();
  if (!binary) {
    return {
      text: "Claude is still starting up. Try again in a moment.",
      isError: true,
    };
  }

  const rawToken =
    deps.getOAuthToken !== undefined
      ? await deps.getOAuthToken()
      : await getCoworkApiToken(resolveCoworkSessionsBridgeOauthConfig());
  // Official residual: whitespace-only / empty token is not signed in.
  // Never treat truthy-but-blank inject as live OAuth for sample.
  const token =
    typeof rawToken === "string" && rawToken.trim().length > 0
      ? rawToken.trim()
      : null;
  if (!token) {
    return { text: "Not signed in.", isError: true };
  }

  // Absolute path honesty: bare names / relative paths are not ready residual.
  if (!pathIsAbsolute(binary)) {
    return {
      text: "Claude is still starting up. Try again in a moment.",
      isError: true,
    };
  }

  if (deps.runSample) {
    return deps.runSample(prompt, data, binary, token);
  }

  return defaultRunArtifactSample(prompt, data, binary, token);
}

function pathIsAbsolute(p: string): boolean {
  // Avoid importing path for a one-liner — match shell residual absolute gate.
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

async function defaultRunArtifactSample(
  prompt: string,
  data: unknown[] | undefined,
  binaryPath: string,
  token: string,
): Promise<AskClaudeResult> {
  // Lazy import so unit tests without SDK still load residual gates.
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const samplePrompt = buildArtifactSamplePrompt(prompt, data);
  // Official G4-ish env + artifact_sample tags. Use localSessionEnv overlay so
  // 3p bag still applies when present; token only when OAuth residual returned one.
  const spawnEnv = {
    ...buildClaudeCliSpawnEnv({
      localSessionEnv: {
        ANTHROPIC_AUTH_TOKEN: token,
        CLAUDE_CODE_ENTRYPOINT: "local-agent",
        CLAUDE_CODE_TAGS: "artifact_sample",
        NODE_USE_SYSTEM_CA: "1",
      },
    }),
    CLAUDE_CODE_ENTRYPOINT: "local-agent",
    CLAUDE_CODE_TAGS: "artifact_sample",
    NODE_USE_SYSTEM_CA: "1",
  };

  const stream = query({
    prompt: samplePrompt,
    options: {
      pathToClaudeCodeExecutable: binaryPath,
      executableArgs: [],
      cwd: os.tmpdir(),
      maxTurns: 1,
      systemPrompt: artifactSampleSystemPrompt(),
      allowedTools: [],
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      canUseTool: async () => ({
        behavior: "deny" as const,
        message: "askClaude() has no tools",
      }),
      env: spawnEnv,
      stderr: (chunk: string) => {
        console.warn(`[ArtifactSampler] stderr: ${chunk}`);
      },
    },
  });

  let text = "";
  let completed = false;
  try {
    for await (const msg of stream as AsyncIterable<{
      type?: string;
      subtype?: string;
      message?: { content?: Array<{ type?: string; text?: string }> };
    }>) {
      if (msg.type === "assistant") {
        for (const block of msg.message?.content ?? []) {
          if (block.type === "text" && typeof block.text === "string") {
            text += block.text;
          }
        }
      }
      if (msg.type === "result") {
        if (msg.subtype !== "success") {
          return {
            text: text || "Inference did not complete.",
            isError: true,
          };
        }
        completed = true;
        break;
      }
    }
  } catch (err) {
    return {
      text: err instanceof Error ? err.message : "Inference failed.",
      isError: true,
    };
  }

  if (!completed) {
    return {
      text: text || "Inference did not complete.",
      isError: true,
    };
  }
  return { text };
}

/**
 * Official ior.askClaude residual entry.
 * Args: (prompt, data[]) — k2i shape return.
 */
export async function askClaudeResidual(
  prompt: unknown,
  data: unknown,
  deps: AskClaudeDeps = {},
): Promise<AskClaudeResult> {
  const enabled =
    deps.isInferenceEnabled?.() ??
    isCoworkGrowthBookFeatureOn(ARTIFACT_INFERENCE_FEATURE_FLAG);
  if (!enabled) {
    return askClaudeCz("Artifact inference is not enabled.");
  }

  const shown = deps.getShownArtifactId?.();
  if (!shown) {
    return askClaudeCz("Artifact is not currently shown.");
  }

  const promptText = typeof prompt === "string" ? prompt : String(prompt ?? "");
  const dataArr = Array.isArray(data) ? data : data === undefined ? undefined : [data];
  const key = askClaudeCacheKey(promptText, dataArr ?? []);
  const ttl = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = deps.now ?? Date.now;

  if (deps.cacheGet) {
    const hit = await deps.cacheGet(shown, key);
    if (hit) return hit;
  } else {
    const entry = memoryCache.get(cacheKeyFor(shown, key));
    if (entry && now() - entry.updatedAt < ttl) {
      return entry.value;
    }
  }

  try {
    if (deps.getShownArtifactId?.() !== shown) {
      return askClaudeCz("Artifact is no longer shown.");
    }
    const result = await runArtifactSampleWnr(promptText, dataArr, {
      resolveBinaryPath: deps.resolveBinaryPath,
      getOAuthToken: deps.getOAuthToken,
      runSample: deps.runSample,
    });
    if (deps.getShownArtifactId?.() !== shown) {
      return askClaudeCz("Artifact is no longer shown.");
    }
    if (deps.cacheSet) {
      await deps.cacheSet(shown, key, result);
    } else if (ttl > 0) {
      memoryCache.set(cacheKeyFor(shown, key), {
        value: result,
        updatedAt: now(),
      });
    }
    return result;
  } catch (err) {
    return askClaudeCz(
      err instanceof Error ? err.message : "Inference failed.",
    );
  }
}

/** Test helper — clear in-memory askClaude cache. */
export function resetAskClaudeCacheForTests(): void {
  memoryCache.clear();
}

/** Binary absolute path residual used by Wnr gate (reuse shell helper). */
export function artifactSamplerBinaryReady(
  candidates?: string[],
  exists?: (p: string) => boolean,
): string | null {
  return resolveClaudeCodeBinaryPath(candidates, exists);
}

/** fs.existsSync wrapper for production resolve. */
export function defaultBinaryExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

