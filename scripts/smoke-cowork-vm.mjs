#!/usr/bin/env node
/**
 * Live Electron dual-exec VM smoke (native layer).
 *
 * Spawns Electron with scripts/smoke-cowork-vm-main.cjs as temporary main.
 * Prefers .smoke-cowork-vm-electron (ad-hoc signed with com.apple.security.virtualization
 * + smol-bin in Contents/Resources). Stock node_modules Electron → entitlement_missing.
 * Packaged Claude-Deepseek.app has entitlement but loads product asar (cannot use as smoke main).
 *
 * Does NOT invent host bash. Requires:
 *   - resources/smol-bin.<arch>.img
 *   - userData/vm_bundles/claudevm.bundle/rootfs.img (not locked by another VirtualMachine)
 *   - original-runtime @ant/claude-swift
 *
 * Env:
 *   CLAUDE_VM_USERDATA  — default Claude-Deepseek Application Support
 *   CLAUDE_VM_SMOKE_TIMEOUT_MS — wall timeout (default 120000)
 *   CLAUDE_VM_SMOKE_SKIP_BASH=1 — only start/probe/stop, no guest bash
 *   CLAUDE_VM_SMOKE_SKIP_CLAUDE=1 — skip guest /usr/local/bin/claude --version probe
 *   CLAUDE_VM_SMOKE_KEEP_RUNNING=1 — skip stopVM (debug)
 *   CLAUDE_VM_SMOKE_ELECTRON — override Electron binary path
 *   CLAUDE_VM_SMOKE_FORCE_STOCK_ELECTRON=1 — use node_modules Electron (expect entitlement miss)
 *   CLAUDE_VM_SMOKE_SKIP_PREPARE=1 — do not auto-run prepare-smoke-electron.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronCli = path.join(root, "node_modules/electron/cli.js");
const mainEntry = path.join(root, "scripts/smoke-cowork-vm-main.cjs");
const prepareScript = path.join(root, "scripts/prepare-smoke-electron.mjs");
const timeoutMs = Number(process.env.CLAUDE_VM_SMOKE_TIMEOUT_MS ?? 120_000);
const smokeSignedElectron = path.join(
  root,
  ".smoke-cowork-vm-electron/Electron.app/Contents/MacOS/Electron",
);
const smokeSmol = path.join(
  root,
  ".smoke-cowork-vm-electron/Electron.app/Contents/Resources",
  `smol-bin.${process.arch === "arm64" ? "arm64" : "x64"}.img`,
);
const forceStock = process.env.CLAUDE_VM_SMOKE_FORCE_STOCK_ELECTRON === "1";
const skipPrepare = process.env.CLAUDE_VM_SMOKE_SKIP_PREPARE === "1";

/**
 * Prefer a binary that carries com.apple.security.virtualization and has smol-bin
 * under process.resourcesPath. Auto-prepares the smoke Electron tree on darwin.
 */
function ensureSmokeElectron() {
  if (forceStock || process.platform !== "darwin" || skipPrepare) return;
  if (process.env.CLAUDE_VM_SMOKE_ELECTRON) return;
  if (fs.existsSync(smokeSignedElectron) && fs.existsSync(smokeSmol)) return;
  console.log("[smoke-cowork-vm] preparing smoke Electron (+virtualization, smol-bin)...");
  const prep = spawnSync(process.execPath, [prepareScript], {
    cwd: root,
    encoding: "utf8",
  });
  if (prep.stdout) process.stdout.write(prep.stdout);
  if (prep.stderr) process.stderr.write(prep.stderr);
  if (prep.status !== 0) {
    console.error("[smoke-cowork-vm] prepare-smoke-electron failed");
    process.exit(prep.status ?? 1);
  }
}

function resolveElectronLaunch() {
  if (process.env.CLAUDE_VM_SMOKE_ELECTRON) {
    const bin = process.env.CLAUDE_VM_SMOKE_ELECTRON;
    return { command: bin, argsPrefix: [], label: `override:${bin}` };
  }
  if (
    !forceStock
    && process.platform === "darwin"
    && fs.existsSync(smokeSignedElectron)
  ) {
    return {
      command: smokeSignedElectron,
      argsPrefix: [],
      label: "smoke-signed:Electron.app (+virtualization)",
    };
  }
  if (!fs.existsSync(electronCli)) {
    return null;
  }
  return {
    command: process.execPath,
    argsPrefix: [electronCli],
    label: "stock:node_modules/electron (no virtualization entitlement)",
  };
}

ensureSmokeElectron();
const launch = resolveElectronLaunch();
if (!launch) {
  console.error("No Electron binary found for VM smoke");
  process.exit(1);
}
if (!fs.existsSync(mainEntry)) {
  console.error("Smoke main missing:", mainEntry);
  process.exit(1);
}
console.log("[smoke-cowork-vm] electron:", launch.label);

// Ensure readiness first (FS only).
const readiness = spawn(
  process.execPath,
  [path.join(root, "scripts/check-cowork-vm-readiness.mjs")],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let readyOut = "";
readiness.stdout.on("data", (c) => {
  readyOut += c;
});
readiness.stderr.on("data", (c) => {
  readyOut += c;
});
const readyCode = await new Promise((resolve) => readiness.on("exit", resolve));
if (readyCode !== 0) {
  console.error("Readiness failed:\n", readyOut);
  process.exit(2);
}
console.log("[smoke-cowork-vm] readiness OK");

const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "",
  // Prevent product main from loading; we replace package main via ELECTRON entry.
  CLAUDE_VM_SMOKE: "1",
  CLAUDE_DESKTOP_RESOURCES_ROOT: path.join(root, "resources"),
  electron_config_cache: path.join(root, ".electron-cache"),
};

// Electron treats first arg after electron as app path. Use a tiny package dir.
const appDir = path.join(root, ".smoke-cowork-vm-app");
fs.mkdirSync(appDir, { recursive: true });
fs.writeFileSync(
  path.join(appDir, "package.json"),
  JSON.stringify(
    {
      name: "smoke-cowork-vm",
      main: path.relative(appDir, mainEntry),
    },
    null,
    2,
  ),
);

// Copy/symlink path: package.json main must resolve relative to appDir.
// Use absolute main via a stub:
fs.writeFileSync(
  path.join(appDir, "index.cjs"),
  `require(${JSON.stringify(mainEntry)});\n`,
);
fs.writeFileSync(
  path.join(appDir, "package.json"),
  JSON.stringify({ name: "smoke-cowork-vm", main: "index.cjs" }, null, 2),
);

const child = spawn(launch.command, [...launch.argsPrefix, appDir], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
const onChunk = (chunk) => {
  const text = chunk.toString();
  output += text;
  process.stdout.write(text);
};
child.stdout.on("data", onChunk);
child.stderr.on("data", onChunk);

const timer = setTimeout(() => {
  console.error(`[smoke-cowork-vm] timeout after ${timeoutMs}ms`);
  try {
    process.kill(child.pid, "SIGKILL");
  } catch {
    /* ignore */
  }
}, timeoutMs);

const code = await new Promise((resolve) => {
  child.on("exit", (c) => resolve(c ?? 1));
});
clearTimeout(timer);

const marker = output.match(/\[smoke-cowork-vm-result\]\s+(\{[\s\S]*\})/);
if (marker) {
  try {
    const result = JSON.parse(marker[1]);
    console.log("\n[smoke-cowork-vm] parsed result:", JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 3);
  } catch {
    /* fallthrough */
  }
}

console.error("[smoke-cowork-vm] no result marker; exit", code);
process.exit(code === 0 ? 0 : code ?? 1);
