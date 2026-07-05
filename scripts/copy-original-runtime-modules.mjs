import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceNodeModules = path.resolve(projectRoot, "../electron-shell-source/app-asar/node_modules");
const targetNodeModules = path.join(projectRoot, "resources/original-runtime-node_modules/node_modules");

const moduleRoots = [
  "node-pty",
  "ws",
  "@ant/claude-native",
  "@ant/claude-swift",
];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyModule(moduleName) {
  const source = path.join(sourceNodeModules, moduleName);
  const target = path.join(targetNodeModules, moduleName);
  if (!(await exists(source))) throw new Error(`missing original runtime module: ${source}`);
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, dereference: false, preserveTimestamps: true });
  console.log(`${path.relative(projectRoot, source)} -> ${path.relative(projectRoot, target)}`);
}

await fs.rm(targetNodeModules, { recursive: true, force: true });
for (const moduleName of moduleRoots) await copyModule(moduleName);

const executableFiles = [
  path.join(targetNodeModules, "node-pty/build/Release/spawn-helper"),
];
for (const filePath of executableFiles) {
  if (await exists(filePath)) await fs.chmod(filePath, 0o755);
}

console.log(`original runtime modules copied: ${moduleRoots.length}`);
