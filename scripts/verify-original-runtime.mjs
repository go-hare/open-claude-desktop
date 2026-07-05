import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeNodeModules = path.join(projectRoot, "resources/original-runtime-node_modules/node_modules");

async function assertExists(relativePath) {
  const absolutePath = path.join(runtimeNodeModules, relativePath);
  await fs.access(absolutePath);
  return absolutePath;
}

await assertExists("node-pty/lib/index.js");
await assertExists("node-pty/build/Release/pty.node");
const spawnHelper = await assertExists("node-pty/build/Release/spawn-helper");
const mode = (await fs.stat(spawnHelper)).mode & 0o777;
if ((mode & 0o111) === 0) throw new Error(`node-pty spawn-helper is not executable: ${mode.toString(8)}`);
await assertExists("@ant/claude-native/claude-native-binding.node");
await assertExists("@ant/claude-swift/build/Release/swift_addon.node");
await assertExists("@ant/claude-swift/build/Release/computer_use.node");
await assertExists("ws/index.js");

const nodePty = require(path.join(runtimeNodeModules, "node-pty"));
const output = await new Promise((resolve, reject) => {
  const term = nodePty.spawn("/bin/zsh", ["-c", "echo runtime-pty-ok"], {
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
  }, 5000);
  term.onData((chunk) => { data += chunk; });
  term.onExit(({ exitCode }) => {
    clearTimeout(timer);
    if (exitCode !== 0) reject(new Error(`node-pty smoke exited with ${exitCode}: ${JSON.stringify(data)}`));
    else resolve(data);
  });
});

if (!String(output).includes("runtime-pty-ok")) throw new Error(`node-pty smoke output mismatch: ${JSON.stringify(output)}`);
console.log("original runtime modules ok");
