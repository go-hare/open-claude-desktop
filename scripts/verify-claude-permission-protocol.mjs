#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const timeoutMs = 35_000;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-claude-permission-"));
const probeFile = path.join(tempDir, "permission-probe-write.txt");
const args = [
  "--output-format",
  "stream-json",
  "--verbose",
  "--input-format",
  "stream-json",
  "--permission-prompt-tool",
  "stdio",
  "--permission-mode",
  "default",
  "--tools",
  "Write",
  "--max-budget-usd",
  "0.08",
  "--session-id",
  randomUUID(),
  "--no-session-persistence",
];

const child = spawn("claude", args, {
  cwd: process.cwd(),
  env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT ?? "sdk-ts" },
  stdio: ["pipe", "pipe", "pipe"],
});

const state = {
  closed: false,
  controlRequestSeen: false,
  controlResponseSent: false,
  deniedToolUseId: null,
  resultSeen: false,
  stderr: "",
  stdoutRemainder: "",
};

function fail(message) {
  cleanup();
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
  if (!state.closed) child.kill("SIGTERM");
  setTimeout(() => !state.closed && child.kill("SIGKILL"), 1_000).unref();
}

function cleanup() {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup only.
  }
}

function sendInput(value) {
  child.stdin.write(`${JSON.stringify(value)}\n`);
}

function closeInput() {
  if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
}

function handleMessage(message) {
  if (message.type === "control_request" && message.request?.subtype === "can_use_tool") {
    state.controlRequestSeen = true;
    state.deniedToolUseId = message.request.tool_use_id ?? null;
    sendInput({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: message.request_id,
        response: {
          behavior: "deny",
          message: "permission protocol verifier denied this write",
          interrupt: true,
          toolUseID: message.request.tool_use_id,
        },
      },
    });
    state.controlResponseSent = true;
    return;
  }

  if (message.type !== "result") return;
  state.resultSeen = true;
  closeInput();
  const denials = Array.isArray(message.permission_denials) ? message.permission_denials : [];
  const matchedDenial = denials.some((item) => item?.tool_use_id === state.deniedToolUseId || item?.tool_input?.file_path === probeFile);
  if (!state.controlRequestSeen) fail("Claude CLI did not emit a can_use_tool control_request.");
  else if (!state.controlResponseSent) fail("Verifier did not send a control_response.");
  else if (!matchedDenial) fail("Result did not include the denied tool permission.");
  else if (fs.existsSync(probeFile)) fail("Denied Write unexpectedly created the probe file.");
  else console.log("PASS Claude CLI stdio permission protocol emits request, accepts response, and blocks denied Write.");
}

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  state.stdoutRemainder += chunk;
  const lines = state.stdoutRemainder.split(/\r?\n/);
  state.stdoutRemainder = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handleMessage(message);
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  state.stderr = `${state.stderr}${chunk}`.slice(-4_000);
});

const timer = setTimeout(() => {
  fail(`Timed out after ${timeoutMs}ms. stderr=${state.stderr.trim()}`);
}, timeoutMs);

child.on("error", (error) => {
  clearTimeout(timer);
  fail(`Failed to spawn claude: ${error.message}`);
});

child.on("close", (code, signal) => {
  state.closed = true;
  clearTimeout(timer);
  cleanup();
  if (!state.resultSeen && process.exitCode !== 1) fail(`Claude exited before result: code=${code ?? "null"} signal=${signal ?? "null"} stderr=${state.stderr.trim()}`);
});

sendInput({
  type: "user",
  session_id: "",
  message: {
    role: "user",
    content: [{
      type: "text",
      text: `Use the Write tool exactly once to create ${probeFile} containing only permission-probe. Do not use any fallback tools if Write is denied.`,
    }],
  },
  parent_tool_use_id: null,
});
