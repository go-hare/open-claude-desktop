import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeNodeModules = path.join(projectRoot, "resources/original-runtime-node_modules/node_modules");
const localBuiltinRuntimeEntries = [
  "@ant/chrome-native-host/package.json",
  "@ant/chrome-native-host/index.js",
  "@ant/claude-for-chrome-mcp/package.json",
  "@ant/claude-for-chrome-mcp/dist/index.js",
  "@ant/claude-screen-app/package.json",
  "@ant/claude-screen-app/index.js",
  "@ant/claude-ssh/package.json",
  "@ant/claude-ssh/index.js",
  "@ant/claude-swift-ant/package.json",
  "@ant/claude-swift-ant/index.js",
  "@ant/computer-use-mcp/package.json",
  "@ant/computer-use-mcp/dist/index.js",
  "@ant/cowork-win32-service/package.json",
  "@ant/cowork-win32-service/index.js",
  "@ant/disclaimer/package.json",
  "@ant/disclaimer/index.js",
  "@ant/dxt-registry/package.json",
  "@ant/dxt-registry/index.js",
  "@ant/imagine-server/package.json",
  "@ant/imagine-server/index.js",
  "@ant/ipc-codegen/package.json",
  "@ant/ipc-codegen/index.js",
  "@ant/rfb-client/package.json",
  "@ant/rfb-client/index.js",
  "@ant/utils/package.json",
  "@ant/utils/index.js",
  "@anthropic-ai/claude-agent-sdk-future/package.json",
  "@anthropic-ai/claude-agent-sdk-future/index.js",
  "@anthropic-ai/conway-client/package.json",
  "@anthropic-ai/conway-client/index.js",
  "@anthropic-ai/electron-devtools-mcp/package.json",
  "@anthropic-ai/electron-devtools-mcp/index.js",
];

async function assertExists(relativePath) {
  const absolutePath = path.join(runtimeNodeModules, relativePath);
  await fs.access(absolutePath);
  return absolutePath;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectNativeAddons(root) {
  const output = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".node")) output.push(absolute);
    }
  }
  if (await exists(root)) await walk(root);
  return output;
}

function nodePtySmokeCommand() {
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return {
      file: powershell,
      args: ["-NoProfile", "-NonInteractive", "-Command", "Write-Output runtime-pty-ok; exit 0"],
    };
  }
  if (process.platform === "darwin") {
    return { file: "/bin/zsh", args: ["-c", "echo runtime-pty-ok"] };
  }
  return { file: "/bin/sh", args: ["-c", "echo runtime-pty-ok"] };
}

await assertExists("node-pty/package.json");
await assertExists("node-pty/lib/index.js");
const nativeAddons = await collectNativeAddons(path.join(runtimeNodeModules, "node-pty"));
if (nativeAddons.length === 0) throw new Error("node-pty native addon is missing from original runtime modules");

const spawnHelper = path.join(runtimeNodeModules, "node-pty/build/Release/spawn-helper");
if (process.platform !== "win32") {
  await fs.access(spawnHelper);
  const mode = (await fs.stat(spawnHelper)).mode & 0o777;
  if ((mode & 0o111) === 0) throw new Error(`node-pty spawn-helper is not executable: ${mode.toString(8)}`);
}

await assertExists("@ant/claude-native/claude-native-binding.node");
await assertExists("@ant/claude-swift/build/Release/swift_addon.node");
await assertExists("@ant/claude-swift/build/Release/computer_use.node");
await assertExists("ws/index.js");
for (const entry of localBuiltinRuntimeEntries) await assertExists(entry);

const builtinSmokeModules = [
  "@ant/chrome-native-host",
  "@ant/claude-screen-app",
  "@ant/claude-ssh",
  "@ant/claude-swift-ant",
  "@ant/cowork-win32-service",
  "@ant/disclaimer",
  "@ant/dxt-registry",
  "@ant/imagine-server",
  "@ant/ipc-codegen",
  "@ant/rfb-client",
  "@ant/utils",
  "@anthropic-ai/claude-agent-sdk-future",
  "@anthropic-ai/conway-client",
  "@anthropic-ai/electron-devtools-mcp",
];
for (const moduleName of builtinSmokeModules) {
  const loaded = require(path.join(runtimeNodeModules, moduleName));
  if (loaded == null) throw new Error(`builtin runtime module loaded null: ${moduleName}`);
}

const nodePty = require(path.join(runtimeNodeModules, "node-pty"));
const command = nodePtySmokeCommand();
const output = await new Promise((resolve, reject) => {
  const term = nodePty.spawn(command.file, command.args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: projectRoot,
    env: { ...process.env, TERM: "xterm-256color" },
  });
  let data = "";
  const timer = setTimeout(() => {
    try { term.kill(); } catch {}
    reject(new Error("node-pty smoke timed out"));
  }, 10000);
  term.onData((chunk) => { data += chunk; });
  term.onExit(({ exitCode }) => {
    clearTimeout(timer);
    if (exitCode !== 0) reject(new Error(`node-pty smoke exited with ${exitCode}: ${JSON.stringify(data)}`));
    else resolve(data);
  });
});

if (!String(output).includes("runtime-pty-ok")) throw new Error(`node-pty smoke output mismatch: ${JSON.stringify(output)}`);
console.log(`original runtime modules ok; builtin modules=${localBuiltinRuntimeEntries.length}; node-pty native smoke passed on ${process.platform}; native_addons=${nativeAddons.map((file) => path.relative(runtimeNodeModules, file)).join(",")}`);
// node-pty can leave native ConPTY handles alive briefly on Windows after the child
// exits. The smoke has already observed onExit + expected output, so exit
// explicitly to keep verification from hanging on those native handles.
process.exit(0);
