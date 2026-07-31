import { spawn } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePackagedTargets } from "./packagePaths.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packaged = process.argv.includes("--packaged");
const timeoutMs = Number(process.env.CLAUDE_DESKTOP_SMOKE_TIMEOUT_MS ?? 20000);
const targets = resolvePackagedTargets({ root });
const electronBinary = path.join(root, "node_modules/.bin/electron");
const electronCli = path.join(root, "node_modules/electron/cli.js");
const userDataDir = path.join(root, packaged ? ".smoke-user-data-packaged" : ".smoke-user-data");
const resourcesRoot = packaged ? targets.resourcesRoot : path.join(root, "resources");
const claudeCodeBinaryName = process.platform === "win32" ? "claude.exe" : "claude";
const expectedClaudeCodeBinary = path.join(resourcesRoot, "claude-code-bin", claudeCodeBinaryName);

async function exists(filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolvePackagedBinary() {
  if (targets.platform === "win32") return targets.binary;
  if (fs.existsSync(targets.binary)) return targets.binary;
  if (targets.binaryFallback && fs.existsSync(targets.binaryFallback)) return targets.binaryFallback;
  return targets.binary;
}

const appBinary = resolvePackagedBinary();

if (packaged && !(await exists(appBinary))) {
  throw new Error(
    `packaged binary missing (run npm run package first): ${appBinary}`,
  );
}

await fsPromises.rm(userDataDir, { recursive: true, force: true });

// Packaged: app:// product web only — do not inject CLAUDE_DESKTOP_MAIN_VIEW_URL.
// Dev smoke: default http test route unless already set.
const childEnv = {
  ...process.env,
  CLAUDE_USER_DATA_DIR: userDataDir,
  CLAUDE_DESKTOP_SMOKE_TEST: "1",
  CLAUDE_DESKTOP_DEBUG_IPC_FALLBACK: "1",
  CLAUDE_CODE_EXECUTABLE: "",
  electron_config_cache: path.join(root, ".electron-cache"),
};
if (packaged) {
  delete childEnv.CLAUDE_DESKTOP_MAIN_VIEW_URL;
  delete childEnv.CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW;
} else {
  childEnv.CLAUDE_DESKTOP_RESOURCES_ROOT = resourcesRoot;
  childEnv.CLAUDE_DESKTOP_MAIN_VIEW_URL =
    process.env.CLAUDE_DESKTOP_MAIN_VIEW_URL ?? "http://localhost:5176";
}

const command = packaged
  ? appBinary
  : process.platform === "win32"
    ? process.execPath
    : electronBinary;
const args = packaged
  ? []
  : process.platform === "win32"
    ? [electronCli, "."]
    : ["."];
const child = spawn(command, args, {
  cwd: packaged && process.platform === "win32" ? path.dirname(appBinary) : root,
  detached: process.platform !== "win32",
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: false,
});
let marker = null;
let output = "";
let lineBuffer = "";
let settled = false;

function killChild() {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    } catch {
      // fall through
    }
  }
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
    const match = line.match(/\[claudex-smoke\] (.+)/);
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
    console.error(`[claudex-smoke-runner] timeout after ${timeoutMs}ms`);
    killChild();
  }
}, timeoutMs);

async function writeRuntimeCoverage(signal) {
  if (!marker?.ok) return;
  const docsRoot = path.join(root, "docs");
  await fsPromises.mkdir(docsRoot, { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    packaged,
    signal: signal ?? null,
    marker,
    ipcHandlers: marker.ipcHandlers ?? null,
    claudeCode: marker.claudeCode ?? null,
  };
  await fsPromises.writeFile(
    path.join(docsRoot, "electron-shell-runtime-coverage.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const ipc = marker.ipcHandlers ?? {};
  const md =
    `# Electron 壳运行时 IPC 覆盖率\n\n` +
    `生成时间：${report.generated_at}\n\n` +
    `- packaged：${packaged}\n` +
    `- real handlers：${ipc.real ?? "unknown"}\n` +
    `- fallback handlers：${ipc.fallback ?? "unknown"}\n` +
    `- total active handlers：${ipc.total ?? "unknown"}\n` +
    `- fallbackByInterface：${JSON.stringify(ipc.fallbackByInterface ?? {})}\n` +
    `- Claude Code bundled executable：${marker.claudeCode?.bundledExecutable ?? "unknown"}\n` +
    `- Claude Code uses bundled executable：${marker.claudeCode?.usesBundledExecutable ?? "unknown"}\n`;
  await fsPromises.writeFile(path.join(docsRoot, "electron-shell-runtime-coverage.md"), md);
}

child.on("close", async (code, signal) => {
  clearTimeout(timeout);
  if (marker?.ok) {
    const claudeCodeBinaryExists = await exists(expectedClaudeCodeBinary);
    const markerClaudeCode = marker.claudeCode ?? {};
    const usesBundledExecutable = markerClaudeCode.usesBundledExecutable === true;
    if (packaged && (!claudeCodeBinaryExists || !usesBundledExecutable)) {
      console.error(
        `[claudex-smoke-runner] claude code binary check failed exists=${claudeCodeBinaryExists} usesBundled=${usesBundledExecutable} expected=${expectedClaudeCodeBinary}`,
      );
      process.exit(1);
    }
    await writeRuntimeCoverage(signal);
    console.log(`[claudex-smoke-runner] ok packaged=${packaged} signal=${signal ?? "none"}`);
    process.exit(0);
  }
  console.error(`[claudex-smoke-runner] failed code=${code} signal=${signal ?? "none"}`);
  if (output) console.error(`[claudex-smoke-runner] captured ${output.length} bytes`);
  process.exit(code || 1);
});
