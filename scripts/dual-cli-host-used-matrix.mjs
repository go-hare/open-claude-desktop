#!/usr/bin/env node
/**
 * Full dual-CLI matrix for **host-used** surfaces only (claudeCliRunner residual).
 * official 2.1.218 vs desktop-bundled 2.7.24.
 *
 * Surfaces covered:
 *  P*  permission modes init + write docs (and .claude where relevant)
 *  F*  spawn flags: effort, name, add-dir, append-system-prompt, session-id
 *  C*  control plane: get_settings, get_context_usage, set_permission_mode, apply_flag_settings
 *  T*  tools: Read, Bash, Edit (host-common)
 *  U*  user line: messageUuid stamp, multi-turn continue after result
 *  R*  resume + fork-session
 *  K*  Tasks bookends: Task/Agent → system task_* → stop_task control
 *  M*  --mcp-config wire residual
 *  I*  image content block on user line
 *  S*  stream_event presence (partial on) — smoke only
 *
 * Does NOT print secrets. Archives JSON under scripts/out/.
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

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dual-cli-host-used-"));
const RESULTS = [];
const TIMEOUT_MS = 100_000;

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

/**
 * Host buildArgs residual subset.
 * @param {{
 *   mode?: string,
 *   sessionId: string,
 *   model?: string,
 *   resume?: boolean,
 *   forkSession?: boolean,
 *   effort?: string,
 *   name?: string,
 *   addDirs?: string[],
 *   systemPrompt?: string,
 *   appendSystemPrompt?: string,
 *   mcpConfig?: object,
 *   allowedTools?: string[],
 *   disallowedTools?: string[],
 *   tools?: string[],
 *   settingSources?: string,
 *   includePartial?: boolean,
 * }} o
 */
function hostArgs(o) {
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
  if (o.includePartial !== false) args.push("--include-partial-messages");
  if (o.resume) args.push("--resume", o.sessionId);
  else args.push("--session-id", o.sessionId);
  if (o.forkSession) args.push("--fork-session");
  if (o.name) args.push("--name", o.name);
  if (o.model) args.push("--model", o.model);
  const mode = o.mode ?? "bypassPermissions";
  if (mode === "bypassPermissions") args.push("--allow-dangerously-skip-permissions");
  args.push("--permission-mode", mode);
  if (o.effort) args.push("--effort", o.effort);
  for (const d of o.addDirs ?? []) args.push("--add-dir", d);
  if (o.systemPrompt) args.push("--system-prompt", o.systemPrompt);
  if (o.appendSystemPrompt) args.push("--append-system-prompt", o.appendSystemPrompt);
  if (o.mcpConfig) args.push("--mcp-config", JSON.stringify(o.mcpConfig));
  if (o.allowedTools?.length) args.push("--allowedTools", ...o.allowedTools);
  if (o.disallowedTools?.length) args.push("--disallowedTools", ...o.disallowedTools);
  if (o.tools?.length) args.push("--tools", ...o.tools);
  if (o.settingSources) args.push("--setting-sources", o.settingSources);
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

/** Host residual for image paste / preview-annotation */
function userLineWithImage(text, pngBase64, uuid = crypto.randomUUID()) {
  return (
    JSON.stringify({
      type: "user",
      uuid,
      message: {
        role: "user",
        content: [
          { type: "text", text },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: pngBase64,
            },
          },
        ],
      },
      parent_tool_use_id: null,
      session_id: "",
    }) + "\n"
  );
}

function controlRequest(requestId, request) {
  return (
    JSON.stringify({
      type: "control_request",
      request_id: requestId,
      request,
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

function eventKind(msg) {
  if (!msg || typeof msg !== "object") return "unknown";
  const t = msg.type;
  if (t === "system") return `system:${msg.subtype ?? "?"}`;
  if (t === "stream_event") return `stream_event:${msg.event?.type ?? "?"}`;
  if (t === "control_request") return `control_request:${msg.request?.subtype ?? "?"}`;
  if (t === "control_response") return `control_response:${msg.response?.subtype ?? "?"}`;
  if (t === "result") return `result:${msg.subtype ?? "?"}`;
  return String(t ?? "unknown");
}

/**
 * Generic runner.
 * @param {{
 *   cliKey: string,
 *   cliPath: string,
 *   caseId: string,
 *   cwd: string,
 *   args: string[],
 *   sessionId: string,
 *   firstUser?: string | null,
 *   firstUserRaw?: string | null,
 *   multiTurn?: string[],
 *   afterInitControls?: Array<Record<string, unknown>>,
 *   afterResultControls?: Array<Record<string, unknown>>,
 *   afterResultKeepOpenMs?: number,
 *   permissionPolicy?: 'allow'|'deny',
 *   expectFiles?: string[],
 *   expectReadOk?: boolean,
 *   endAfterResult?: boolean,
 * }} opts
 */
function runCase(opts) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const typeCounts = {};
    const canUseTools = [];
    const controlResponses = [];
    const systemSubtypes = [];
    const taskEvents = [];
    const statusModes = [];
    let stdoutBuf = "";
    let stderr = "";
    let init = null;
    let firstStreamEventMs = null;
    let textDeltaCount = 0;
    let assistantText = "";
    let sawResult = false;
    let resultCount = 0;
    let resultSubtype = null;
    let resultIsError = null;
    let exitCode = null;
    let spawnError = null;
    let pendingControls = new Map();
    let afterResultFired = false;
    let keepOpenTimer = null;

    const env = hostEnv();
    const child = spawn(opts.cliPath, opts.args, {
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
      }, 1500);
    }, TIMEOUT_MS);

    const sendControl = (request) => {
      const requestId = crypto.randomUUID();
      pendingControls.set(requestId, { request, at: Date.now() });
      try {
        child.stdin.write(controlRequest(requestId, request));
      } catch {
        /* ignore */
      }
      return requestId;
    };

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
        bump(typeCounts, "non_json");
        return;
      }
      const kind = eventKind(msg);
      bump(typeCounts, kind);
      const ms = Date.now() - t0;

      if (msg.type === "system") {
        systemSubtypes.push(msg.subtype ?? "?");
        if (msg.subtype === "init") {
          init = {
            permissionMode: msg.permissionMode ?? msg.permission_mode ?? null,
            model: msg.model ?? null,
            tools: Array.isArray(msg.tools) ? msg.tools.length : null,
            cwd: msg.cwd ?? null,
            session_id: msg.session_id ?? msg.sessionId ?? null,
          };
          // fire after-init controls once
          if (opts.afterInitControls?.length) {
            for (const req of opts.afterInitControls) sendControl(req);
          }
        }
        if (msg.subtype === "status") {
          const mode = msg.permissionMode ?? msg.permission_mode ?? msg.mode;
          if (mode) statusModes.push(mode);
        }
        if (
          msg.subtype === "task_started"
          || msg.subtype === "task_progress"
          || msg.subtype === "task_notification"
        ) {
          taskEvents.push({
            subtype: msg.subtype,
            task_id: msg.task_id ?? msg.taskId,
            status: msg.status,
            ms,
          });
        }
      }

      if (msg.type === "stream_event") {
        if (firstStreamEventMs == null) firstStreamEventMs = ms;
        const et = msg.event?.type;
        if (et === "content_block_delta" && msg.event?.delta?.text) textDeltaCount += 1;
      }

      if (msg.type === "assistant") {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b?.type === "text" && typeof b.text === "string") assistantText += b.text;
          }
        }
      }

      if (msg.type === "control_request" && msg.request?.subtype === "can_use_tool") {
        const input = msg.request.input ?? {};
        const rid = msg.request_id ?? msg.requestId;
        const toolUseId = msg.request.tool_use_id ?? msg.request.toolUseId;
        canUseTools.push({
          tool: msg.request.tool_name ?? msg.request.toolName,
          file_path: input.file_path ?? input.path,
          command: input.command ? String(input.command).slice(0, 100) : undefined,
          decision_reason: msg.request.decision_reason,
        });
        if (opts.permissionPolicy !== "deny" && rid) {
          child.stdin.write(controlResponseAllow(rid, input, toolUseId));
        }
      }

      if (msg.type === "control_response") {
        const rid = msg.response?.request_id ?? msg.request_id;
        const pending = rid ? pendingControls.get(rid) : null;
        if (pending) pendingControls.delete(rid);
        controlResponses.push({
          request: pending?.request ?? null,
          subtype: msg.response?.subtype,
          response: msg.response?.response ?? null,
          error: msg.response?.error ?? msg.response?.message ?? null,
          ms,
        });
      }

      if (msg.type === "result") {
        resultCount += 1;
        sawResult = true;
        resultSubtype = msg.subtype ?? null;
        resultIsError = msg.is_error ?? msg.isError ?? null;

        if (opts.multiTurn?.length) {
          const next = opts.multiTurn.shift();
          if (next) {
            child.stdin.write(userLine(next));
            return;
          }
        }

        if (!afterResultFired && opts.afterResultControls?.length) {
          afterResultFired = true;
          for (const req of opts.afterResultControls) sendControl(req);
          if (opts.afterResultKeepOpenMs) {
            keepOpenTimer = setTimeout(() => {
              try {
                child.stdin.end();
              } catch {
                /* ignore */
              }
            }, opts.afterResultKeepOpenMs);
            return;
          }
        }

        if (opts.endAfterResult !== false && !opts.afterResultKeepOpenMs) {
          try {
            child.stdin.end();
          } catch {
            /* ignore */
          }
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
      if (keepOpenTimer) clearTimeout(keepOpenTimer);
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      exitCode = code;

      const files = (opts.expectFiles ?? []).map((rel) => {
        const abs = path.isAbsolute(rel) ? rel : path.join(opts.cwd, rel);
        return { path: rel, exists: fs.existsSync(abs), size: fs.existsSync(abs) ? fs.statSync(abs).size : 0 };
      });

      const row = {
        caseId: opts.caseId,
        cliKey: opts.cliKey,
        sessionId: opts.sessionId,
        ms: Date.now() - t0,
        exitCode,
        spawnError,
        init,
        statusModes,
        can_use_tool_count: canUseTools.length,
        can_use_tools: canUseTools,
        controlResponses: controlResponses.map((c) => ({
          subtype: c.request?.subtype,
          ok: c.subtype === "success",
          responseKeys:
            c.response && typeof c.response === "object"
              ? Object.keys(c.response).slice(0, 20)
              : typeof c.response,
          responsePreview:
            c.response == null
              ? null
              : JSON.stringify(c.response).replace(/\s+/g, " ").slice(0, 240),
          error: c.error,
        })),
        systemSubtypes: [...new Set(systemSubtypes)],
        taskEvents,
        firstStreamEventMs,
        textDeltaCount,
        assistantPreview: assistantText.replace(/\s+/g, " ").slice(0, 160),
        sawResult,
        resultCount,
        resultSubtype,
        resultIsError,
        files,
        typeCounts,
        stderrTail: stderr.replace(/\s+/g, " ").slice(-280),
      };
      RESULTS.push(row);
      resolve(row);
    });

    // kick
    if (opts.firstUserRaw) {
      child.stdin.write(opts.firstUserRaw);
    } else if (opts.firstUser != null) {
      child.stdin.write(userLine(opts.firstUser));
    } else {
      // minimal kick for control-only probes
      child.stdin.write(userLine("."));
    }
  });
}

function modelFromEnv() {
  const e = loadDotClaudeEnv();
  return (
    process.env.MATRIX_MODEL
    || e.ANTHROPIC_DEFAULT_HAIKU_MODEL
    || e.ANTHROPIC_DEFAULT_SONNET_MODEL
    || undefined
  );
}

// 1x1 transparent PNG
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function runForCli(cliKey, cliPath, model) {
  const base = path.join(ROOT, cliKey);
  fs.mkdirSync(base, { recursive: true });

  // ---------- P: permission modes ----------
  for (const mode of ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"]) {
    const cwd = path.join(base, `P-${mode}`);
    fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
    const sid = crypto.randomUUID();
    const file = `docs/p-${mode}.md`;
    await runCase({
      cliKey,
      cliPath,
      caseId: `P_mode_${mode}`,
      cwd,
      sessionId: sid,
      args: hostArgs({ mode, sessionId: sid, model }),
      permissionPolicy: "allow",
      expectFiles: mode === "plan" ? [] : [file],
      firstUser:
        mode === "plan"
          ? "Do not write files. Reply with one short sentence that you are in plan mode. No tools."
          : `Write exactly "ok-${mode}" to ${file} using Write tool. No questions. Then stop.`,
    });
  }

  // bypass .claude safety (host-used residual)
  {
    const cwd = path.join(base, "P-bypass-claude-dot");
    fs.mkdirSync(path.join(cwd, ".claude/workflow-runs"), { recursive: true });
    const sid = crypto.randomUUID();
    const file = `.claude/workflow-runs/host-used.md`;
    await runCase({
      cliKey,
      cliPath,
      caseId: "P_bypass_write_dot_claude",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      permissionPolicy: "allow",
      expectFiles: [file],
      firstUser: `Write exactly "ok-dot-claude" to ${file} with Write. No bash. No questions.`,
    });
  }

  // ---------- F: spawn flags ----------
  {
    const cwd = path.join(base, "F-effort-name");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "F_effort_medium_name",
      cwd,
      sessionId: sid,
      args: hostArgs({
        mode: "bypassPermissions",
        sessionId: sid,
        model,
        effort: "medium",
        name: "host-matrix-session",
      }),
      firstUser: "Reply with exactly: effort-name-ok. No tools.",
    });
  }

  {
    const cwd = path.join(base, "F-add-dir");
    const extra = path.join(base, "F-add-dir-extra");
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(extra, { recursive: true });
    fs.writeFileSync(path.join(extra, "secret-marker.txt"), "marker-from-add-dir");
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "F_add_dir_read",
      cwd,
      sessionId: sid,
      args: hostArgs({
        mode: "bypassPermissions",
        sessionId: sid,
        model,
        addDirs: [extra],
      }),
      firstUser:
        `Use the Read tool on absolute path ${path.join(extra, "secret-marker.txt")} and reply with only the file contents. No Write.`,
    });
  }

  {
    const cwd = path.join(base, "F-append-system");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "F_append_system_prompt",
      cwd,
      sessionId: sid,
      args: hostArgs({
        mode: "bypassPermissions",
        sessionId: sid,
        model,
        appendSystemPrompt:
          "You must always start every reply with the exact token ZX_APPEND_OK then a space.",
      }),
      firstUser: "Say hi in three words. No tools.",
    });
  }

  // ---------- C: control plane ----------
  {
    const cwd = path.join(base, "C-get-settings");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "C_get_settings",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      firstUser: "Reply with: settings-probe. No tools.",
      afterInitControls: [{ subtype: "get_settings" }],
    });
  }

  {
    const cwd = path.join(base, "C-get-context");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "C_get_context_usage",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      firstUser: "Reply with: context-probe. No tools.",
      afterInitControls: [{ subtype: "get_context_usage" }],
    });
  }

  {
    const cwd = path.join(base, "C-set-mode");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "C_set_permission_mode",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "default", sessionId: sid, model }),
      firstUser: "Reply with: mode-probe-1. No tools.",
      afterInitControls: [
        { subtype: "set_permission_mode", mode: "acceptEdits" },
      ],
      multiTurn: ["Reply with: mode-probe-2. No tools."],
    });
  }

  {
    const cwd = path.join(base, "C-apply-flag");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "C_apply_flag_settings",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      firstUser: "Reply with: flag-probe. No tools.",
      afterInitControls: [
        {
          subtype: "apply_flag_settings",
          settings: { effort: "low" },
        },
      ],
    });
  }

  // ---------- T: tools ----------
  {
    const cwd = path.join(base, "T-read");
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, "readme-host.txt"), "read-me-ok");
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "T_read_tool",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      firstUser:
        "Use Read on ./readme-host.txt and reply with only the file contents. No Write.",
    });
  }

  {
    const cwd = path.join(base, "T-bash");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "T_bash_echo",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      permissionPolicy: "allow",
      firstUser:
        'Use Bash to run: echo bash-host-ok. Then reply with the command output only.',
    });
  }

  {
    const cwd = path.join(base, "T-edit");
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, "edit-me.txt"), "before");
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "T_edit_tool",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      permissionPolicy: "allow",
      expectFiles: ["edit-me.txt"],
      firstUser:
        'Use Edit on ./edit-me.txt to replace "before" with "after-edit-ok". Then stop.',
    });
  }

  // ---------- U: user line / multiturn ----------
  {
    const cwd = path.join(base, "U-uuid");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    const uuid = "11111111-2222-4333-8444-555555555555";
    await runCase({
      cliKey,
      cliPath,
      caseId: "U_message_uuid_stamp",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      firstUserRaw: userLine("Reply with: uuid-stamp-ok. No tools.", uuid),
    });
  }

  {
    const cwd = path.join(base, "U-multiturn");
    fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "U_multiturn_continue",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      expectFiles: ["docs/u-t1.md", "docs/u-t2.md"],
      multiTurn: ['Write exactly "t2" to docs/u-t2.md with Write. Stop.'],
      firstUser: 'Write exactly "t1" to docs/u-t1.md with Write. Then stop this turn.',
    });
  }

  // ---------- R: resume / fork ----------
  {
    const cwd = path.join(base, "R-resume");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    // turn 1 create session
    await runCase({
      cliKey,
      cliPath,
      caseId: "R_session_seed",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      firstUser: "Remember the codeword ORANGE-KITE. Reply with: seeded. No tools.",
    });
    // turn 2 resume
    await runCase({
      cliKey,
      cliPath,
      caseId: "R_resume",
      cwd,
      sessionId: sid,
      args: hostArgs({
        mode: "bypassPermissions",
        sessionId: sid,
        model,
        resume: true,
      }),
      firstUser:
        "What codeword did I ask you to remember? Reply with only the codeword. No tools.",
    });
    // turn 3 fork
    const forkSid = sid; // resume source
    await runCase({
      cliKey,
      cliPath,
      caseId: "R_fork_session",
      cwd,
      sessionId: forkSid,
      args: hostArgs({
        mode: "bypassPermissions",
        sessionId: forkSid,
        model,
        resume: true,
        forkSession: true,
      }),
      firstUser: "Reply with only: forked-ok. No tools.",
    });
  }

  // ---------- K: Task bookends + stop_task ----------
  {
    const cwd = path.join(base, "K-tasks");
    fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "K_task_bookend_stop",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      permissionPolicy: "allow",
      afterResultKeepOpenMs: 8000,
      afterResultControls: [], // filled dynamically via task_started handler? we inject stop after we see task
      firstUser:
        "Use the Task or Agent tool to run a subagent that sleeps/waits a bit then writes docs/k-sub.md with content ok-task. "
        + "Do not write the file yourself in the parent. After launching, you may briefly acknowledge.",
      // We'll stop_task from a custom path: watch taskEvents in runner — simpler: send stop after first result if we saw task_started mid-stream
    });
    // Post-process: if last result has task events, already done. For stop_task we need live channel.
    // Re-run a dedicated stop harness below.
  }

  {
    const cwd = path.join(base, "K-stop-task-live");
    fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
    const sid = crypto.randomUUID();
    // Custom inline harness for stop_task once task_started seen
    await new Promise((resolve) => {
      const t0 = Date.now();
      const args = hostArgs({ mode: "bypassPermissions", sessionId: sid, model });
      const child = spawn(cliPath, args, { cwd, env: hostEnv(), stdio: ["pipe", "pipe", "pipe"] });
      let buf = "";
      let taskId = null;
      let stopSent = false;
      let stopResp = null;
      let initMode = null;
      let sawResult = false;
      const taskEvents = [];
      const typeCounts = {};
      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }, TIMEOUT_MS);
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          bump(typeCounts, eventKind(msg));
          if (msg.type === "system" && msg.subtype === "init") {
            initMode = msg.permissionMode ?? msg.permission_mode;
          }
          if (
            msg.type === "system"
            && (msg.subtype === "task_started"
              || msg.subtype === "task_progress"
              || msg.subtype === "task_notification")
          ) {
            taskEvents.push({
              subtype: msg.subtype,
              task_id: msg.task_id ?? msg.taskId,
              status: msg.status,
            });
            if (msg.subtype === "task_started" && !stopSent) {
              taskId = msg.task_id ?? msg.taskId;
              if (taskId) {
                stopSent = true;
                const rid = crypto.randomUUID();
                child.stdin.write(
                  controlRequest(rid, { subtype: "stop_task", task_id: taskId }),
                );
              }
            }
          }
          if (msg.type === "control_response") {
            stopResp = {
              subtype: msg.response?.subtype,
              response: msg.response?.response,
              error: msg.response?.error,
            };
          }
          if (msg.type === "control_request" && msg.request?.subtype === "can_use_tool") {
            const input = msg.request.input ?? {};
            const rid = msg.request_id;
            child.stdin.write(
              controlResponseAllow(rid, input, msg.request.tool_use_id),
            );
          }
          if (msg.type === "result") {
            sawResult = true;
            // keep open a bit for task_notification after stop
            setTimeout(() => {
              try {
                child.stdin.end();
              } catch {
                /* ignore */
              }
            }, 5000);
          }
        }
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        RESULTS.push({
          caseId: "K_stop_task_control",
          cliKey,
          sessionId: sid,
          ms: Date.now() - t0,
          exitCode: code,
          init: { permissionMode: initMode },
          can_use_tool_count: 0,
          can_use_tools: [],
          controlResponses: stopResp
            ? [
                {
                  subtype: "stop_task",
                  ok: stopResp.subtype === "success",
                  responseKeys:
                    stopResp.response && typeof stopResp.response === "object"
                      ? Object.keys(stopResp.response)
                      : typeof stopResp.response,
                  responsePreview: JSON.stringify(stopResp.response ?? null).slice(0, 200),
                  error: stopResp.error ?? null,
                },
              ]
            : [],
          taskEvents,
          stopSent,
          taskId,
          sawResult,
          resultCount: sawResult ? 1 : 0,
          typeCounts,
          files: [],
          assistantPreview: "",
          systemSubtypes: [],
          statusModes: [],
          firstStreamEventMs: null,
          textDeltaCount: 0,
          resultSubtype: null,
          resultIsError: null,
          stderrTail: "",
        });
        resolve();
      });
      child.stdin.write(
        userLine(
          "Use Task/Agent to start a long-running subagent that waits ~30s then writes docs/k-stop.md. "
            + "Parent should not finish the file itself.",
        ),
      );
    });
  }

  // ---------- M: mcp-config wire ----------
  {
    const cwd = path.join(base, "M-mcp");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    // Host residual: --mcp-config must wrap { mcpServers: {...} }
    // Use a stdio server that exits immediately is ok for init acceptance
    const mcpConfig = {
      mcpServers: {
        "matrix-echo": {
          command: "node",
          args: [
            "-e",
            // minimal MCP-ish process that stays alive a bit then exits; CLI may still list it
            "setInterval(()=>{}, 1000); setTimeout(()=>process.exit(0), 15000)",
          ],
        },
      },
    };
    await runCase({
      cliKey,
      cliPath,
      caseId: "M_mcp_config_wire",
      cwd,
      sessionId: sid,
      args: hostArgs({
        mode: "bypassPermissions",
        sessionId: sid,
        model,
        mcpConfig,
      }),
      firstUser: "Reply with: mcp-wire-ok. Do not call MCP tools.",
    });
  }

  // ---------- I: image content block ----------
  {
    const cwd = path.join(base, "I-image");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "I_image_user_block",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model }),
      firstUserRaw: userLineWithImage(
        "You received a tiny PNG. Reply with exactly: image-ok. No tools.",
        TINY_PNG,
      ),
    });
  }

  // ---------- S: stream smoke ----------
  {
    const cwd = path.join(base, "S-stream");
    fs.mkdirSync(cwd, { recursive: true });
    const sid = crypto.randomUUID();
    await runCase({
      cliKey,
      cliPath,
      caseId: "S_stream_partial_on",
      cwd,
      sessionId: sid,
      args: hostArgs({ mode: "bypassPermissions", sessionId: sid, model, includePartial: true }),
      firstUser:
        "Write a numbered list of 8 short cooking tips. No tools. Plain text.",
    });
  }
}

function printMatrix() {
  const byCase = new Map();
  for (const r of RESULTS) {
    if (!r.caseId) continue;
    if (!byCase.has(r.caseId)) byCase.set(r.caseId, {});
    byCase.get(r.caseId)[r.cliKey] = r;
  }

  console.log("\n========== HOST-USED DUAL CLI MATRIX ==========\n");
  for (const [caseId, clis] of byCase) {
    console.log(`## ${caseId}`);
    for (const cliKey of Object.keys(CLIS)) {
      const r = clis[cliKey];
      if (!r) {
        console.log(`  ${cliKey}: (missing)`);
        continue;
      }
      const files = (r.files ?? [])
        .map((f) => `${f.exists ? "Y" : "N"}:${path.basename(f.path)}`)
        .join(" ");
      const ctrl = (r.controlResponses ?? [])
        .map((c) => `${c.subtype}:${c.ok ? "ok" : "fail"}`)
        .join(",");
      const tasks = (r.taskEvents ?? [])
        .map((t) => `${t.subtype}${t.status ? `(${t.status})` : ""}`)
        .join(",");
      console.log(
        `  ${cliKey}: init=${r.init?.permissionMode ?? "-"}`
        + ` can_use=${r.can_use_tool_count ?? 0}`
        + ` result=${r.sawResult}/${r.resultSubtype ?? "-"}`
        + ` Δn=${r.textDeltaCount ?? 0}`
        + ` se@${r.firstStreamEventMs ?? "-"}`
        + ` exit=${r.exitCode}`
        + ` ms=${r.ms}`
        + (files ? ` files=[${files}]` : "")
        + (ctrl ? ` ctrl=[${ctrl}]` : "")
        + (tasks ? ` tasks=[${tasks}]` : "")
        + (r.statusModes?.length ? ` statusModes=${JSON.stringify(r.statusModes)}` : "")
        + (r.stopSent != null ? ` stopSent=${r.stopSent}` : ""),
      );
      if (r.assistantPreview) {
        console.log(`    text: ${r.assistantPreview.slice(0, 100)}`);
      }
      if (r.controlResponses?.length) {
        for (const c of r.controlResponses) {
          console.log(
            `    ctrl ${c.subtype}: ok=${c.ok} keys=${JSON.stringify(c.responseKeys)} preview=${c.responsePreview ?? c.error ?? ""}`,
          );
        }
      }
      if (r.can_use_tools?.length) {
        console.log(
          `    tools: ${r.can_use_tools.map((t) => `${t.tool}:${t.file_path ? path.basename(String(t.file_path)) : t.command ?? "?"}`).join(", ")}`,
        );
      }
      if (r.spawnError) console.log(`    spawnError: ${r.spawnError}`);
    }
    console.log("");
  }

  // Diff summary: cases where can_use or file success or control ok diverge
  console.log("## divergence summary (desktop vs official)\n");
  for (const [caseId, clis] of byCase) {
    const a = clis.official_2_1_218;
    const b = clis.desktop_2_7_24;
    if (!a || !b) continue;
    const diffs = [];
    if ((a.init?.permissionMode ?? null) !== (b.init?.permissionMode ?? null)) {
      diffs.push(`initMode ${a.init?.permissionMode}≠${b.init?.permissionMode}`);
    }
    if ((a.can_use_tool_count ?? 0) !== (b.can_use_tool_count ?? 0)) {
      diffs.push(`can_use ${a.can_use_tool_count}≠${b.can_use_tool_count}`);
    }
    const af = JSON.stringify((a.files ?? []).map((f) => f.exists));
    const bf = JSON.stringify((b.files ?? []).map((f) => f.exists));
    if (af !== bf) diffs.push(`files ${af}≠${bf}`);
    const ac = JSON.stringify((a.controlResponses ?? []).map((c) => [c.subtype, c.ok]));
    const bc = JSON.stringify((b.controlResponses ?? []).map((c) => [c.subtype, c.ok]));
    if (ac !== bc) diffs.push(`ctrl ${ac}≠${bc}`);
    const at = (a.taskEvents ?? []).map((t) => t.subtype).join(",");
    const bt = (b.taskEvents ?? []).map((t) => t.subtype).join(",");
    if (at !== bt) diffs.push(`tasks ${at || "-"}≠${bt || "-"}`);
    const aStream = a.textDeltaCount > 0;
    const bStream = b.textDeltaCount > 0;
    if (aStream !== bStream) diffs.push(`stream ${aStream}≠${bStream}`);
    if (diffs.length) console.log(`  ${caseId}: ${diffs.join(" | ")}`);
  }
}

async function main() {
  const model = modelFromEnv();
  console.log(
    JSON.stringify(
      {
        phase: "start",
        root: ROOT,
        model: model ?? "(cli default)",
        clis: Object.fromEntries(
          Object.entries(CLIS).map(([k, p]) => [k, { path: p, exists: fs.existsSync(p) }]),
        ),
      },
      null,
      2,
    ),
  );

  for (const [cliKey, cliPath] of Object.entries(CLIS)) {
    if (!fs.existsSync(cliPath)) {
      RESULTS.push({ caseId: "missing_binary", cliKey, error: "missing" });
      continue;
    }
    console.error(`\n--- running ${cliKey} ---`);
    await runForCli(cliKey, cliPath, model);
  }

  const outPath = path.join(ROOT, "host-used-matrix-results.json");
  fs.writeFileSync(outPath, JSON.stringify({ root: ROOT, results: RESULTS }, null, 2));
  const archiveDir = path.join(REPO, "scripts/out");
  fs.mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, "dual-cli-host-used-matrix-latest.json");
  fs.writeFileSync(archivePath, JSON.stringify({ root: ROOT, results: RESULTS }, null, 2));

  printMatrix();
  console.log(`\nJSON: ${outPath}`);
  console.log(`ARCHIVE: ${archivePath}`);
  console.log(`ROOT: ${ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
