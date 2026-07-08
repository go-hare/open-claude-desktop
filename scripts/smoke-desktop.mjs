import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packaged = process.argv.includes("--packaged");
const timeoutMs = Number(process.env.CLAUDE_DESKTOP_SMOKE_TIMEOUT_MS ?? 20000);
const packagedMacAppRoot = path.join(root, "out/Claude-Deepseek-darwin-arm64/Claude-Deepseek.app");
const packagedWinRoot = path.join(root, `out/Claude-Deepseek-win32-${process.arch}`);
const packagedAppRoot = process.platform === "win32" ? packagedWinRoot : packagedMacAppRoot;
const appBinary = process.platform === "win32"
  ? path.join(packagedWinRoot, "Claude-Deepseek.exe")
  : path.join(packagedMacAppRoot, "Contents/MacOS/Claude");
const electronBinary = path.join(root, "node_modules/.bin/electron");
const electronCli = path.join(root, "node_modules/electron/cli.js");
const userDataDir = path.join(root, packaged ? ".smoke-user-data-packaged" : ".smoke-user-data");
const resourcesRoot = packaged
  ? process.platform === "win32" ? path.join(packagedWinRoot, "resources") : path.join(packagedMacAppRoot, "Contents/Resources")
  : path.join(root, "resources");
const claudeCodeBinaryName = process.platform === "win32" ? "claude.exe" : "claude";
const expectedClaudeCodeBinary = path.join(resourcesRoot, "claude-code-bin", claudeCodeBinaryName);

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

await fs.rm(userDataDir, { recursive: true, force: true });

const command = packaged ? appBinary : process.platform === "win32" ? process.execPath : electronBinary;
const args = packaged ? [] : process.platform === "win32" ? [electronCli, "."] : ["."];
const child = spawn(command, args, {
  cwd: root,
  detached: true,
  env: {
    ...process.env,
    CLAUDE_USER_DATA_DIR: userDataDir,
    CLAUDE_DESKTOP_SMOKE_TEST: "1",
    CLAUDE_DESKTOP_DEBUG_IPC_FALLBACK: "1",
    CLAUDE_DESKTOP_RESOURCES_ROOT: resourcesRoot,
    CLAUDE_CODE_EXECUTABLE: "",
    electron_config_cache: path.join(root, ".electron-cache"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let marker = null;
let output = "";
let lineBuffer = "";
let settled = false;

function killChild() {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore cleanup races
    }
  }
}

function consume(chunk, stream) {
  const text = chunk.toString();
  output += text;
  stream.write(text);
  lineBuffer += text;
  let newlineIndex;
  while ((newlineIndex = lineBuffer.indexOf("\n")) >= 0) {
    const line = lineBuffer.slice(0, newlineIndex);
    lineBuffer = lineBuffer.slice(newlineIndex + 1);
    const match = line.match(/\[claude-deepseek-smoke\] (.+)/);
    if (!match) continue;
    try {
      marker = JSON.parse(match[1]);
    } catch {
      marker = { ok: false, parseError: true };
    }
    if (!settled) {
      settled = true;
      setTimeout(killChild, 100);
    }
  }
}

child.stdout.on("data", (chunk) => consume(chunk, process.stdout));
child.stderr.on("data", (chunk) => consume(chunk, process.stderr));

const timeout = setTimeout(() => {
  if (!settled) {
    settled = true;
    console.error(`[claude-deepseek-smoke-runner] timeout after ${timeoutMs}ms`);
    killChild();
  }
}, timeoutMs);

async function writeRuntimeCoverage(signal) {
  if (!marker?.ok) return;
  const docsRoot = path.join(root, "docs");
  await fs.mkdir(docsRoot, { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    packaged,
    signal: signal ?? null,
    marker,
    ipcHandlers: marker.ipcHandlers ?? null,
    claudeCode: marker.claudeCode ?? null,
  };
  await fs.writeFile(path.join(docsRoot, "electron-shell-runtime-coverage.json"), `${JSON.stringify(report, null, 2)}\n`);
  const ipc = marker.ipcHandlers ?? {};
  const md = `# Electron 壳运行时 IPC 覆盖率\n\n` +
    `生成时间：${report.generated_at}\n\n` +
    `- packaged：${packaged}\n` +
    `- real handlers：${ipc.real ?? "unknown"}\n` +
    `- fallback handlers：${ipc.fallback ?? "unknown"}\n` +
    `- total active handlers：${ipc.total ?? "unknown"}\n` +
    `- fallbackByInterface：${JSON.stringify(ipc.fallbackByInterface ?? {})}\n` +
    `- Claude Code bundled executable：${marker.claudeCode?.bundledExecutable ?? "unknown"}\n` +
    `- Claude Code uses bundled executable：${marker.claudeCode?.usesBundledExecutable ?? "unknown"}\n`;
  await fs.writeFile(path.join(docsRoot, "electron-shell-runtime-coverage.md"), md);
}

child.on("close", async (code, signal) => {
  clearTimeout(timeout);
  if (marker?.ok) {
    const claudeCodeBinaryExists = await exists(expectedClaudeCodeBinary);
    const markerClaudeCode = marker.claudeCode ?? {};
    const usesBundledExecutable = markerClaudeCode.usesBundledExecutable === true;
    if (packaged && (!claudeCodeBinaryExists || !usesBundledExecutable)) {
      console.error(`[claude-deepseek-smoke-runner] claude code binary check failed exists=${claudeCodeBinaryExists} usesBundled=${usesBundledExecutable} expected=${expectedClaudeCodeBinary}`);
      process.exit(1);
    }
    await writeRuntimeCoverage(signal);
    console.log(`[claude-deepseek-smoke-runner] ok packaged=${packaged} signal=${signal ?? "none"}`);
    process.exit(0);
  }
  console.error(`[claude-deepseek-smoke-runner] failed code=${code} signal=${signal ?? "none"}`);
  if (output) console.error(`[claude-deepseek-smoke-runner] captured ${output.length} bytes`);
  process.exit(code || 1);
});
