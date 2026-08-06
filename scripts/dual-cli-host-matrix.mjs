#!/usr/bin/env node
/**
 * Host-equivalent dual-CLI matrix: Anthropic local 2.1.218 vs desktop-bundled 2.7.28.
 *
 * Mirrors open-claude-desktop claudeCliRunner.buildArgs residual:
 *   --print --output-format stream-json --verbose --input-format stream-json
 *   --permission-prompt-tool stdio --include-partial-messages
 *   --session-id <uuid>
 *   --permission-mode <mode>  (+ --allow-dangerously-skip-permissions when bypass)
 *   bypassPermissionsModeEnabled=true (product clamp OFF for this matrix)
 *
 * Env residual (dotClaude-ish host): CLAUDE_CODE_ENTRYPOINT=claude-desktop-3p + ~/.claude settings env.
 * Does NOT print secrets.
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

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dual-cli-host-matrix-"));
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
  // Host residual flags (do not invent provider URLs beyond ~/.claude)
  base.CLAUDE_CODE_ENTRYPOINT = "claude-desktop-3p";
  base.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = "1";
  base.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1";
  base.CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL = "true";
  // Avoid nested CLAUDECODE confusion
  delete base.CLAUDECODE;
  return base;
}

function hostArgs(mode, sessionId, model) {
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
    "--session-id",
    sessionId,
  ];
  // Host: when bypassPermissionsModeEnabled === true, keep bypass
  if (mode === "bypassPermissions") {
    args.push("--allow-dangerously-skip-permissions");
  }
  args.push("--permission-mode", mode);
  if (model) args.push("--model", model);
  return args;
}

function userLine(text, uuid = crypto.randomUUID()) {
  return (
    JSON.stringify({
      type: "user",
      uuid,
      message: {
        role: "user",
        content: text,
      },
      parent_tool_use_id: null,
      session_id: "",
    }) + "\n"
  );
}

/** Host residual: claudeCliRunner.permissionResponsePayload + respondToToolPermission */
function controlResponseAllow(requestId, input = {}, toolUseId) {
  const response = {
    behavior: "allow",
    // Schema requires a record; empty object → CLI falls back to original tool input.
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

function controlResponseDeny(requestId, toolUseId) {
  const response = {
    behavior: "deny",
    message: "Denied by user",
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

/**
 * @param {{
 *   cliKey: string,
 *   cliPath: string,
 *   caseId: string,
 *   mode: string,
 *   cwd: string,
 *   prompt: string,
 *   permissionPolicy: 'allow'|'deny'|'count-only',
 *   model?: string,
 *   multiTurn?: string[],
 * }} opts
 */
function runCase(opts) {
  return new Promise((resolve) => {
    const sessionId = crypto.randomUUID();
    const args = hostArgs(opts.mode, sessionId, opts.model);
    const env = hostEnv();
    const started = Date.now();
    const events = [];
    const canUseTools = [];
    let stdoutBuf = "";
    let stderr = "";
    let initPermissionMode = null;
    let resultSubtype = null;
    let resultIsError = null;
    let assistantText = "";
    let sawResult = false;
    let exitCode = null;
    let spawnError = null;

    const child = spawn(opts.cliPath, args, {
      cwd: opts.cwd,
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
      }, 2000);
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      spawnError = String(err);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 80_000) stderr = stderr.slice(-80_000);
    });

    const handleLine = (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        events.push({ type: "non_json", line: line.slice(0, 200) });
        return;
      }
      const t = msg.type;
      if (t === "system" && msg.subtype === "init") {
        initPermissionMode = msg.permissionMode ?? msg.permission_mode ?? null;
        events.push({
          type: "init",
          permissionMode: initPermissionMode,
          model: msg.model,
          tools: Array.isArray(msg.tools) ? msg.tools.length : undefined,
        });
        return;
      }
      if (t === "control_request" && msg.request?.subtype === "can_use_tool") {
        const tool = msg.request.tool_name ?? msg.request.toolName;
        const input = msg.request.input ?? msg.request.tool_input ?? {};
        const toolUseId = msg.request.tool_use_id ?? msg.request.toolUseId;
        const rid = msg.request_id ?? msg.requestId;
        const entry = {
          request_id: rid,
          tool,
          tool_use_id: toolUseId,
          file_path: input.file_path ?? input.path ?? input.filePath,
          command: input.command,
          decision_reason: msg.request.decision_reason ?? msg.request.decisionReason,
        };
        canUseTools.push(entry);
        events.push({ type: "can_use_tool", ...entry });
        if (opts.permissionPolicy === "allow" && rid) {
          // Echo original tool input like host (stripBridge then prefer pending.input).
          child.stdin.write(controlResponseAllow(rid, input, toolUseId));
        } else if (opts.permissionPolicy === "deny" && rid) {
          child.stdin.write(controlResponseDeny(rid, toolUseId));
        }
        return;
      }
      if (t === "assistant") {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === "text" && typeof block.text === "string") {
              assistantText += block.text;
            }
          }
        }
        return;
      }
      if (t === "result") {
        sawResult = true;
        resultSubtype = msg.subtype ?? null;
        resultIsError = msg.is_error ?? msg.isError ?? null;
        events.push({
          type: "result",
          subtype: resultSubtype,
          is_error: resultIsError,
          duration_ms: msg.duration_ms,
        });
        // multi-turn: after first result, feed next user lines
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
      const filesExpected = opts.expectFiles ?? [];
      const fileStatus = filesExpected.map((rel) => {
        const abs = path.isAbsolute(rel) ? rel : path.join(opts.cwd, rel);
        return {
          path: rel,
          exists: fs.existsSync(abs),
          size: fs.existsSync(abs) ? fs.statSync(abs).size : 0,
        };
      });
      const row = {
        caseId: opts.caseId,
        cliKey: opts.cliKey,
        mode: opts.mode,
        permissionPolicy: opts.permissionPolicy,
        sessionId,
        ms: Date.now() - started,
        exitCode,
        spawnError,
        initPermissionMode,
        can_use_tool_count: canUseTools.length,
        can_use_tools: canUseTools.map((c) => ({
          tool: c.tool,
          file_path: c.file_path,
          command: c.command ? String(c.command).slice(0, 80) : undefined,
        })),
        sawResult,
        resultSubtype,
        resultIsError,
        assistantPreview: assistantText.replace(/\s+/g, " ").slice(0, 160),
        files: fileStatus,
        stderrTail: stderr.replace(/\s+/g, " ").slice(-400),
      };
      RESULTS.push(row);
      resolve(row);
    });

    // kick first user turn
    child.stdin.write(userLine(opts.prompt));
  });
}

function ensureDirs(cwd) {
  fs.mkdirSync(path.join(cwd, ".claude/workflow-runs/matrix"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "docs/matrix"), { recursive: true });
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
      RESULTS.push({ caseId: "missing_binary", cliKey, error: "binary missing", path: cliPath });
      continue;
    }

    // --- Case A: bypass + dual Write (.claude + docs) ---
    {
      const cwd = path.join(ROOT, cliKey, "A-bypass-dual-write");
      fs.mkdirSync(cwd, { recursive: true });
      ensureDirs(cwd);
      const tag = `${cliKey}-A`;
      const pClaude = `.claude/workflow-runs/matrix/${tag}.md`;
      const pDocs = `docs/matrix/${tag}.md`;
      await runCase({
        cliKey,
        cliPath,
        caseId: "A_bypass_dual_write",
        mode: "bypassPermissions",
        cwd,
        model,
        permissionPolicy: "allow",
        expectFiles: [pClaude, pDocs],
        prompt:
          `In this repo cwd only. Use the Write tool twice (no bash):
1) Write exactly "ok-claude" to path: ${pClaude}
2) Write exactly "ok-docs" to path: ${pDocs}
Do not ask questions. Do not use Task/Agent. Finish after both writes.`,
      });
    }

    // --- Case B: acceptEdits + dual Write ---
    {
      const cwd = path.join(ROOT, cliKey, "B-acceptEdits-dual-write");
      fs.mkdirSync(cwd, { recursive: true });
      ensureDirs(cwd);
      const tag = `${cliKey}-B`;
      const pClaude = `.claude/workflow-runs/matrix/${tag}.md`;
      const pDocs = `docs/matrix/${tag}.md`;
      await runCase({
        cliKey,
        cliPath,
        caseId: "B_acceptEdits_dual_write",
        mode: "acceptEdits",
        cwd,
        model,
        permissionPolicy: "allow",
        expectFiles: [pClaude, pDocs],
        prompt:
          `In this repo cwd only. Use the Write tool twice (no bash):
1) Write exactly "ok-claude" to path: ${pClaude}
2) Write exactly "ok-docs" to path: ${pDocs}
Do not ask questions. Finish after both writes.`,
      });
    }

    // --- Case C: default mode + Write docs only (baseline prompt count) ---
    {
      const cwd = path.join(ROOT, cliKey, "C-default-docs");
      fs.mkdirSync(cwd, { recursive: true });
      ensureDirs(cwd);
      const tag = `${cliKey}-C`;
      const pDocs = `docs/matrix/${tag}.md`;
      await runCase({
        cliKey,
        cliPath,
        caseId: "C_default_docs_write",
        mode: "default",
        cwd,
        model,
        permissionPolicy: "allow",
        expectFiles: [pDocs],
        prompt:
          `Use Write once: write exactly "ok-default" to ${pDocs}. No bash. No questions.`,
      });
    }

    // --- Case D: bypass + Agent/Task subagent write under .claude ---
    {
      const cwd = path.join(ROOT, cliKey, "D-bypass-subagent-claude");
      fs.mkdirSync(cwd, { recursive: true });
      ensureDirs(cwd);
      const tag = `${cliKey}-D`;
      const pClaude = `.claude/workflow-runs/matrix/${tag}-sub.md`;
      await runCase({
        cliKey,
        cliPath,
        caseId: "D_bypass_subagent_claude_write",
        mode: "bypassPermissions",
        cwd,
        model,
        permissionPolicy: "allow",
        expectFiles: [pClaude],
        prompt:
          `You MUST use the Task or Agent tool (subagent) to write file ${pClaude} with content "ok-sub".
Parent must not Write directly. After subagent finishes, stop.`,
      });
    }

    // --- Case E: bypass multi-turn continue (two writes across turns) ---
    {
      const cwd = path.join(ROOT, cliKey, "E-bypass-multiturn");
      fs.mkdirSync(cwd, { recursive: true });
      ensureDirs(cwd);
      const tag = `${cliKey}-E`;
      const p1 = `docs/matrix/${tag}-t1.md`;
      const p2 = `docs/matrix/${tag}-t2.md`;
      await runCase({
        cliKey,
        cliPath,
        caseId: "E_bypass_multiturn",
        mode: "bypassPermissions",
        cwd,
        model,
        permissionPolicy: "allow",
        expectFiles: [p1, p2],
        multiTurn: [
          `Now Write exactly "ok-t2" to ${p2}. No questions.`,
        ],
        prompt: `Write exactly "ok-t1" to ${p1}. Then stop this turn (wait for next user). No questions.`,
      });
    }
  }

  const outPath = path.join(ROOT, "matrix-results.json");
  fs.writeFileSync(outPath, JSON.stringify({ root: ROOT, results: RESULTS }, null, 2));

  // Compact comparison table
  const byCase = new Map();
  for (const r of RESULTS) {
    if (!r.caseId) continue;
    if (!byCase.has(r.caseId)) byCase.set(r.caseId, {});
    byCase.get(r.caseId)[r.cliKey] = r;
  }

  console.log("\n========== DUAL CLI HOST MATRIX ==========\n");
  for (const [caseId, clis] of byCase) {
    console.log(`## ${caseId}`);
    for (const cliKey of Object.keys(CLIS)) {
      const r = clis[cliKey];
      if (!r) {
        console.log(`  ${cliKey}: (no result)`);
        continue;
      }
      const files = (r.files ?? []).map((f) => `${f.exists ? "Y" : "N"}:${path.basename(f.path)}`).join(" ");
      const tools = (r.can_use_tools ?? [])
        .map((t) => `${t.tool}:${t.file_path ? path.basename(String(t.file_path)) : t.command ?? "?"}`)
        .join(", ");
      console.log(
        `  ${cliKey}: init=${r.initPermissionMode} can_use_tool=${r.can_use_tool_count}`
        + ` result=${r.sawResult}/${r.resultSubtype ?? "-"} err=${r.resultIsError}`
        + ` exit=${r.exitCode} ms=${r.ms}`
        + ` files=[${files}]`
        + (tools ? ` tools=[${tools}]` : ""),
      );
      if (r.spawnError) console.log(`    spawnError: ${r.spawnError}`);
      if (r.stderrTail && /error|Error|invalid/i.test(r.stderrTail)) {
        console.log(`    stderr: ${r.stderrTail.slice(0, 200)}`);
      }
    }
    console.log("");
  }

  console.log(`JSON: ${outPath}`);
  console.log(`ROOT: ${ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
