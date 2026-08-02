#!/usr/bin/env node
/**
 * Host-equivalent dual-CLI streaming matrix.
 * Focus: stream_event / partial deltas / assistant final / result timing / tool stream.
 *
 * Host residual args (claudeCliRunner):
 *   --print --output-format stream-json --verbose --input-format stream-json
 *   --permission-prompt-tool stdio --include-partial-messages
 *   --session-id --permission-mode bypassPermissions --allow-dangerously-skip-permissions
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

const CLIS = {
  official_2_1_218: path.join(os.homedir(), ".local/bin/claude"),
  desktop_2_7_24: path.join(
    REPO,
    "resources/claude-code-bin/platforms/darwin-arm64/claude",
  ),
};

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dual-cli-stream-matrix-"));
const RESULTS = [];
const TIMEOUT_MS = 120_000;

function loadDotClaudeEnv() {
  const settingsPath = path.join(os.homedir(), ".claude/settings.json");
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const env = raw?.env && typeof raw.env === "object" ? raw.env : {};
    return Object.fromEntries(
      Object.entries(env).filter(([, v]) => typeof v === "string"),
    );
  } catch {
    return {};
  }
}

function hostEnv() {
  const base = { ...process.env, ...loadDotClaudeEnv() };
  base.CLAUDE_CODE_ENTRYPOINT = "claude-desktop-3p";
  base.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = "1";
  base.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1";
  base.CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL = "true";
  delete base.CLAUDECODE;
  return base;
}

function hostArgs({ mode, sessionId, model, includePartial }) {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--input-format",
    "stream-json",
    "--permission-prompt-tool",
    "stdio",
  ];
  if (includePartial) args.push("--include-partial-messages");
  args.push("--session-id", sessionId);
  if (mode === "bypassPermissions") args.push("--allow-dangerously-skip-permissions");
  args.push("--permission-mode", mode);
  if (model) args.push("--model", model);
  return args;
}

function userLine(text, uuid = crypto.randomUUID()) {
  return (
    JSON.stringify({
      type: "user",
      uuid,
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: "",
    }) + "\n"
  );
}

function controlResponseAllow(requestId, input = {}, toolUseId) {
  const response = {
    behavior: "allow",
    updatedInput: input && typeof input === "object" ? input : {},
  };
  if (toolUseId) response.toolUseID = toolUseId;
  return (
    JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response,
      },
    }) + "\n"
  );
}

function bump(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function extractTextDelta(msg) {
  // Common residual shapes across CLI gens
  if (typeof msg.delta === "string") return msg.delta;
  if (msg.delta && typeof msg.delta === "object") {
    if (typeof msg.delta.text === "string") return msg.delta.text;
    if (typeof msg.delta.partial_json === "string") return msg.delta.partial_json;
  }
  if (typeof msg.text === "string" && msg.event === "content_block_delta") return msg.text;
  const ev = msg.event;
  if (ev && typeof ev === "object") {
    if (typeof ev.delta?.text === "string") return ev.delta.text;
    if (typeof ev.text === "string") return ev.text;
  }
  // stream_event wrapper
  if (msg.type === "stream_event" && msg.event) {
    return extractTextDelta({ ...msg.event, type: msg.event.type });
  }
  return "";
}

function eventKind(msg) {
  if (!msg || typeof msg !== "object") return "unknown";
  const t = msg.type;
  if (t === "system") return `system:${msg.subtype ?? "?"}`;
  if (t === "stream_event") {
    const et = msg.event?.type ?? msg.event?.event ?? msg.subtype ?? "?";
    return `stream_event:${et}`;
  }
  if (t === "assistant") return "assistant";
  if (t === "user") return "user";
  if (t === "result") return `result:${msg.subtype ?? "?"}`;
  if (t === "control_request") return `control_request:${msg.request?.subtype ?? "?"}`;
  if (t === "control_response") return "control_response";
  if (t === "tool_progress" || t === "tool_use_summary") return t;
  if (t === "rate_limit_event") return "rate_limit_event";
  if (t === "auth_status") return "auth_status";
  return String(t ?? "unknown");
}

/**
 * @param {{
 *   cliKey: string,
 *   cliPath: string,
 *   caseId: string,
 *   prompt: string,
 *   includePartial?: boolean,
 *   mode?: string,
 *   model?: string,
 *   multiTurn?: string[],
 *   expectWrite?: string,
 * }} opts
 */
function runCase(opts) {
  return new Promise((resolve) => {
    const sessionId = crypto.randomUUID();
    const mode = opts.mode ?? "bypassPermissions";
    const includePartial = opts.includePartial !== false;
    const args = hostArgs({
      mode,
      sessionId,
      model: opts.model,
      includePartial,
    });
    const env = hostEnv();
    const cwd = opts.cwd;
    fs.mkdirSync(cwd, { recursive: true });

    const t0 = Date.now();
    const typeCounts = {};
    const streamEventTypes = {};
    const timeline = []; // sparse milestones
    let stdoutBuf = "";
    let stderr = "";
    let initPermissionMode = null;
    let initModel = null;
    let firstEventMs = null;
    let firstStreamEventMs = null;
    let firstTextDeltaMs = null;
    let firstAssistantMs = null;
    let firstToolUseAssistantMs = null;
    let resultMs = null;
    let textDeltaCount = 0;
    let textDeltaChars = 0;
    let assistantText = "";
    let assistantMessages = 0;
    let canUseToolCount = 0;
    let sawResult = false;
    let resultSubtype = null;
    let resultIsError = null;
    let exitCode = null;
    let spawnError = null;
    let interDeltaGaps = [];
    let lastDeltaAt = null;
    const sampleStreamEvents = [];
    const sampleAssistant = [];

    const child = spawn(opts.cliPath, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 1500);
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      spawnError = String(err);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 60_000) stderr = stderr.slice(-60_000);
    });

    const mark = (name) => {
      timeline.push({ name, ms: Date.now() - t0 });
    };

    const handleLine = (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        bump(typeCounts, "non_json");
        return;
      }
      const now = Date.now();
      const ms = now - t0;
      if (firstEventMs == null) {
        firstEventMs = ms;
        mark("first_event");
      }
      const kind = eventKind(msg);
      bump(typeCounts, kind);

      if (msg.type === "system" && msg.subtype === "init") {
        initPermissionMode = msg.permissionMode ?? msg.permission_mode ?? null;
        initModel = msg.model ?? null;
        mark("init");
      }

      if (msg.type === "stream_event") {
        if (firstStreamEventMs == null) {
          firstStreamEventMs = ms;
          mark("first_stream_event");
        }
        const et = msg.event?.type ?? msg.event?.event ?? msg.subtype ?? "?";
        bump(streamEventTypes, String(et));
        if (sampleStreamEvents.length < 6) {
          sampleStreamEvents.push({
            ms,
            event_type: et,
            keys: Object.keys(msg).slice(0, 12),
            eventKeys: msg.event && typeof msg.event === "object" ? Object.keys(msg.event).slice(0, 12) : [],
          });
        }
        const delta = extractTextDelta(msg);
        if (delta) {
          textDeltaCount += 1;
          textDeltaChars += delta.length;
          if (firstTextDeltaMs == null) {
            firstTextDeltaMs = ms;
            mark("first_text_delta");
          }
          if (lastDeltaAt != null) interDeltaGaps.push(now - lastDeltaAt);
          lastDeltaAt = now;
        }
      }

      // Some CLIs emit partial assistant without stream_event wrapper
      if (msg.type === "assistant") {
        assistantMessages += 1;
        if (firstAssistantMs == null) {
          firstAssistantMs = ms;
          mark("first_assistant");
        }
        const content = msg.message?.content;
        let hasTool = false;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === "text" && typeof block.text === "string") {
              assistantText += block.text;
            }
            if (block?.type === "tool_use") hasTool = true;
          }
        }
        if (hasTool && firstToolUseAssistantMs == null) {
          firstToolUseAssistantMs = ms;
          mark("first_tool_use_assistant");
        }
        if (sampleAssistant.length < 3) {
          sampleAssistant.push({
            ms,
            parent_tool_use_id: msg.parent_tool_use_id ?? null,
            contentTypes: Array.isArray(content)
              ? content.map((b) => b?.type).filter(Boolean)
              : typeof content,
            textLen: Array.isArray(content)
              ? content.reduce((n, b) => n + (b?.type === "text" ? String(b.text ?? "").length : 0), 0)
              : 0,
          });
        }
      }

      if (msg.type === "control_request" && msg.request?.subtype === "can_use_tool") {
        canUseToolCount += 1;
        const input = msg.request.input ?? {};
        const rid = msg.request_id ?? msg.requestId;
        const toolUseId = msg.request.tool_use_id ?? msg.request.toolUseId;
        if (rid) child.stdin.write(controlResponseAllow(rid, input, toolUseId));
      }

      if (msg.type === "result") {
        sawResult = true;
        resultMs = ms;
        resultSubtype = msg.subtype ?? null;
        resultIsError = msg.is_error ?? msg.isError ?? null;
        mark("result");
        if (opts.multiTurn?.length) {
          const next = opts.multiTurn.shift();
          if (next) {
            child.stdin.write(userLine(next));
            return;
          }
        }
        try {
          child.stdin.end();
        } catch {
          /* ignore */
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString("utf8");
      let idx;
      while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        handleLine(line);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      exitCode = code;

      const gaps = interDeltaGaps.slice().sort((a, b) => a - b);
      const pct = (p) =>
        gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor((p / 100) * gaps.length))] : null;

      const writePath = opts.expectWrite
        ? path.isAbsolute(opts.expectWrite)
          ? opts.expectWrite
          : path.join(cwd, opts.expectWrite)
        : null;

      const row = {
        caseId: opts.caseId,
        cliKey: opts.cliKey,
        includePartial,
        mode,
        sessionId,
        ms: Date.now() - t0,
        exitCode,
        spawnError,
        initPermissionMode,
        initModel,
        firstEventMs,
        firstStreamEventMs,
        firstTextDeltaMs,
        firstAssistantMs,
        firstToolUseAssistantMs,
        resultMs,
        textDeltaCount,
        textDeltaChars,
        assistantMessages,
        assistantTextLen: assistantText.length,
        assistantPreview: assistantText.replace(/\s+/g, " ").slice(0, 180),
        canUseToolCount,
        sawResult,
        resultSubtype,
        resultIsError,
        typeCounts,
        streamEventTypes,
        deltaGapMs: {
          n: gaps.length,
          p50: pct(50),
          p90: pct(90),
          max: gaps.length ? gaps[gaps.length - 1] : null,
        },
        timeline,
        sampleStreamEvents,
        sampleAssistant,
        writeExists: writePath ? fs.existsSync(writePath) : null,
        stderrTail: stderr.replace(/\s+/g, " ").slice(-300),
      };
      RESULTS.push(row);
      resolve(row);
    });

    child.stdin.write(userLine(opts.prompt));
  });
}

function mean(nums) {
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

async function main() {
  const model =
    process.env.MATRIX_MODEL
    || loadDotClaudeEnv().ANTHROPIC_DEFAULT_HAIKU_MODEL
    || loadDotClaudeEnv().ANTHROPIC_DEFAULT_SONNET_MODEL
    || undefined;

  console.log(JSON.stringify({
    phase: "start",
    root: ROOT,
    model: model ?? "(cli default)",
    clis: Object.fromEntries(
      Object.entries(CLIS).map(([k, p]) => [k, { path: p, exists: fs.existsSync(p) }]),
    ),
  }, null, 2));

  for (const [cliKey, cliPath] of Object.entries(CLIS)) {
    if (!fs.existsSync(cliPath)) {
      RESULTS.push({ caseId: "missing_binary", cliKey, error: "binary missing" });
      continue;
    }

    // S1: long text only — typewriter / stream_event density
    {
      const cwd = path.join(ROOT, cliKey, "S1-long-text");
      await runCase({
        cliKey,
        cliPath,
        caseId: "S1_long_text_partial_on",
        cwd,
        model,
        includePartial: true,
        prompt:
          "Write a numbered list of exactly 12 short tips about git. "
          + "No tools. No code fences. Plain text only. Each tip one line.",
      });
    }

    // S2: same prompt WITHOUT --include-partial-messages (host always on; contrast)
    {
      const cwd = path.join(ROOT, cliKey, "S2-long-text-no-partial");
      await runCase({
        cliKey,
        cliPath,
        caseId: "S2_long_text_partial_off",
        cwd,
        model,
        includePartial: false,
        prompt:
          "Write a numbered list of exactly 12 short tips about git. "
          + "No tools. No code fences. Plain text only. Each tip one line.",
      });
    }

    // S3: tool write + text (stream around tools)
    {
      const cwd = path.join(ROOT, cliKey, "S3-tool-write");
      fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
      const rel = `docs/stream-${cliKey}.md`;
      await runCase({
        cliKey,
        cliPath,
        caseId: "S3_tool_write_stream",
        cwd,
        model,
        includePartial: true,
        expectWrite: rel,
        prompt:
          `First say one short sentence, then Write exactly "stream-ok" to ${rel}, `
          + "then say one short sentence confirming. Use Write tool. No bash.",
      });
    }

    // S4: multi-turn streaming continuity on same stdin
    {
      const cwd = path.join(ROOT, cliKey, "S4-multiturn");
      await runCase({
        cliKey,
        cliPath,
        caseId: "S4_multiturn_stream",
        cwd,
        model,
        includePartial: true,
        multiTurn: [
          "Reply with exactly three words: second turn ok. No tools.",
        ],
        prompt: "Reply with exactly three words: first turn ok. No tools.",
      });
    }

    // S5: markdown-ish longer stream (fade/alluvium input shape)
    {
      const cwd = path.join(ROOT, cliKey, "S5-markdown");
      await runCase({
        cliKey,
        cliPath,
        caseId: "S5_markdown_stream",
        cwd,
        model,
        includePartial: true,
        prompt:
          "Produce a short markdown doc with: one H2 title, a bullet list of 5 items, "
          + "and one fenced js code block with a hello function. No tools.",
      });
    }
  }

  const outPath = path.join(ROOT, "stream-matrix-results.json");
  fs.writeFileSync(outPath, JSON.stringify({ root: ROOT, results: RESULTS }, null, 2));
  const archiveDir = path.join(REPO, "scripts/out");
  fs.mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, "dual-cli-stream-matrix-latest.json");
  fs.writeFileSync(archivePath, JSON.stringify({ root: ROOT, results: RESULTS }, null, 2));

  // Comparison print
  const byCase = new Map();
  for (const r of RESULTS) {
    if (!r.caseId) continue;
    if (!byCase.has(r.caseId)) byCase.set(r.caseId, {});
    byCase.get(r.caseId)[r.cliKey] = r;
  }

  console.log("\n========== DUAL CLI STREAM MATRIX ==========\n");
  for (const [caseId, clis] of byCase) {
    console.log(`## ${caseId}`);
    for (const cliKey of Object.keys(CLIS)) {
      const r = clis[cliKey];
      if (!r) {
        console.log(`  ${cliKey}: (no result)`);
        continue;
      }
      const se = r.streamEventTypes ?? {};
      const seSummary = Object.entries(se)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      console.log(
        `  ${cliKey}:`
        + ` partial=${r.includePartial}`
        + ` init=${r.initPermissionMode}`
        + ` firstΔ=${r.firstTextDeltaMs ?? "-"}ms`
        + ` firstSE=${r.firstStreamEventMs ?? "-"}ms`
        + ` firstAsst=${r.firstAssistantMs ?? "-"}ms`
        + ` result=${r.resultMs ?? "-"}ms`
        + ` Δn=${r.textDeltaCount} Δchars=${r.textDeltaChars}`
        + ` asstMsgs=${r.assistantMessages} asstLen=${r.assistantTextLen}`
        + ` can_use=${r.canUseToolCount}`
        + ` write=${r.writeExists}`
        + ` exit=${r.exitCode}`,
      );
      console.log(
        `    gaps(p50/p90/max)=${r.deltaGapMs?.p50}/${r.deltaGapMs?.p90}/${r.deltaGapMs?.max}`
        + ` stream_events={${seSummary || "none"}}`,
      );
      // top type counts
      const topTypes = Object.entries(r.typeCounts ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      console.log(`    types={${topTypes}}`);
      if (r.assistantPreview) console.log(`    text: ${r.assistantPreview.slice(0, 120)}`);
    }
    console.log("");
  }

  // Cross-cli stream health summary
  console.log("## stream health deltas (desktop - official) on S1\n");
  const s1o = byCase.get("S1_long_text_partial_on")?.official_2_1_218;
  const s1d = byCase.get("S1_long_text_partial_on")?.desktop_2_7_24;
  if (s1o && s1d) {
    const keys = [
      "textDeltaCount",
      "textDeltaChars",
      "firstTextDeltaMs",
      "firstStreamEventMs",
      "firstAssistantMs",
      "resultMs",
      "assistantMessages",
      "assistantTextLen",
    ];
    for (const k of keys) {
      const a = s1o[k];
      const b = s1d[k];
      console.log(`  ${k}: official=${a} desktop=${b} delta=${a != null && b != null ? b - a : "n/a"}`);
    }
  }

  console.log(`\nJSON: ${outPath}`);
  console.log(`ARCHIVE: ${archivePath}`);
  console.log(`ROOT: ${ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
