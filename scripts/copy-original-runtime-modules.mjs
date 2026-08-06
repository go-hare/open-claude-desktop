import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getProjectRoot, resolveOriginalResources } from "./originalAppPaths.mjs";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const projectRoot = getProjectRoot();
const originalResources = resolveOriginalResources();
const originalAsar = path.join(originalResources, "app.asar");
const originalUnpackedNodeModules = path.join(originalResources, "app.asar.unpacked", "node_modules");
const localNodeModules = path.join(projectRoot, "node_modules");
const targetNodeModules = path.join(projectRoot, "resources/original-runtime-node_modules/node_modules");

const originalRuntimeModuleRoots = [
  "ws",
  "@ant/claude-native",
  "@ant/claude-swift",
];

const localBuiltinModuleRoots = [
  "@ant/chrome-native-host",
  "@ant/claude-for-chrome-mcp",
  "@ant/claude-screen-app",
  "@ant/claude-ssh",
  "@ant/claude-swift-ant",
  "@ant/computer-use-mcp",
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

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeAsarEntry(entry) {
  return entry.replace(/\\/g, "/").replace(/^\/+/, "");
}

function toArchiveKey(entry) {
  return entry.split("/").join(path.sep);
}

function statArchiveEntry(entry) {
  const candidates = [toArchiveKey(entry), entry, entry.split("/").join("\\")];
  let lastError;
  for (const candidate of [...new Set(candidates)]) {
    try {
      return { key: candidate, stat: asar.statFile(originalAsar, candidate) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function writeArchiveFile(entry, targetRoot) {
  const { key, stat } = statArchiveEntry(entry);
  const target = path.join(targetRoot, path.relative("node_modules", entry));
  if ("files" in stat) {
    await fs.mkdir(target, { recursive: true });
    return;
  }
  if ("link" in stat) {
    // The official app.asar does not currently use symlinks for the copied runtime modules.
    // If that changes, fail closed instead of materializing a wrong runtime layout.
    throw new Error(`unsupported symlink in original runtime module: ${entry}`);
  }
  const contents = asar.extractFile(originalAsar, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}

async function copyPath(source, target) {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, dereference: false, preserveTimestamps: true, force: true });
}

async function fileSize(filePath) {
  try {
    return (await fs.stat(filePath)).size;
  } catch {
    return null;
  }
}

function isWindowsNativeRuntimeFile(filePath) {
  return [".node", ".dll", ".exe", ".pdb"].includes(path.extname(filePath).toLowerCase());
}

async function overlayCopyPath(source, target) {
  const sourceStat = await fs.stat(source);
  if (sourceStat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await overlayCopyPath(path.join(source, entry.name), path.join(target, entry.name));
    }
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.copyFile(source, target);
  } catch (error) {
    if (
      process.platform === "win32" &&
      (error?.code === "EPERM" || error?.code === "EBUSY") &&
      isWindowsNativeRuntimeFile(target) &&
      (await fileSize(source)) === (await fileSize(target))
    ) {
      console.warn(`reusing locked native runtime file: ${path.relative(projectRoot, target)}`);
      return;
    }
    throw error;
  }
}

async function overlayUnpackedModule(moduleName) {
  const source = path.join(originalUnpackedNodeModules, moduleName);
  const target = path.join(targetNodeModules, moduleName);
  if (!(await exists(source))) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, dereference: false, preserveTimestamps: true, force: true });
  return true;
}

async function copyInstalledModule(moduleName) {
  const source = path.join(localNodeModules, moduleName);
  const target = path.join(targetNodeModules, moduleName);
  if (!(await exists(path.join(source, "package.json")))) {
    throw new Error(`missing installed module for native runtime copy: ${source}; run npm ci first`);
  }
  await overlayCopyPath(source, target);
  console.log(`${path.relative(projectRoot, source)} -> ${path.relative(projectRoot, target)}`);
}

function vendorModulePath(moduleName) {
  if (moduleName.startsWith("@ant/")) return path.join(projectRoot, "vendor", "ant", moduleName.slice("@ant/".length));
  if (moduleName.startsWith("@anthropic-ai/")) return path.join(projectRoot, "vendor", "anthropic-ai", moduleName.slice("@anthropic-ai/".length));
  return path.join(projectRoot, "vendor", moduleName);
}

async function copyLocalBuiltinModule(moduleName) {
  const source = vendorModulePath(moduleName);
  const target = path.join(targetNodeModules, moduleName);
  if (!(await exists(path.join(source, "package.json")))) {
    throw new Error(`missing local builtin module for runtime copy: ${source}`);
  }
  await copyPath(source, target);
  console.log(`builtin:${moduleName} -> ${path.relative(projectRoot, target)}`);
}

async function copyOriginalModule(moduleName) {
  const prefix = `node_modules/${moduleName}`;
  const target = path.join(targetNodeModules, moduleName);
  const entries = asar.listPackage(originalAsar)
    .map(normalizeAsarEntry)
    .filter((entry) => entry === prefix || entry.startsWith(`${prefix}/`))
    .sort((left, right) => left.length - right.length || left.localeCompare(right));

  if (entries.length === 0 && !(await exists(path.join(originalUnpackedNodeModules, moduleName)))) {
    throw new Error(`missing original runtime module in app.asar/app.asar.unpacked: ${moduleName}`);
  }

  await fs.rm(target, { recursive: true, force: true });
  for (const entry of entries) await writeArchiveFile(entry, targetNodeModules);
  await overlayUnpackedModule(moduleName);
  console.log(`official:${moduleName} -> ${path.relative(projectRoot, target)}`);
}

async function writeNativeSafeLoader(moduleName, relativeBindingPath) {
  const target = path.join(targetNodeModules, moduleName, "index.js");
  const source = `"use strict";

let nativeBinding = null;
let loadError = null;

try {
  nativeBinding = require("./${relativeBindingPath.split(path.sep).join("/")}");
} catch (error) {
  loadError = error;
}

function unavailable(member) {
  const suffix = member ? " member " + String(member) : "";
  const reason = loadError ? " Runtime load failed: " + loadError.message : "";
  throw new Error("${moduleName}" + suffix + " native runtime is not usable on this platform." + reason);
}

const fallback = new Proxy(function nativeRuntimeFallback() {
  return unavailable("default call");
}, {
  apply() { return unavailable("default call"); },
  get(_target, prop) {
    if (prop === "__esModule") return false;
    if (prop === "default") return module.exports;
    if (prop === "then") return undefined;
    if (prop === Symbol.toStringTag) return "AntNativeRuntimeFallback";
    if (prop === "__loadError") return loadError;
    return function nativeRuntimeFallbackMember() { return unavailable(prop); };
  },
});

module.exports = nativeBinding || fallback;
`;
  await fs.writeFile(target, source);
  console.log(`native-safe-loader:${moduleName} -> ${path.relative(projectRoot, target)}`);
}

/**
 * Package/build offline path: when resources/original-runtime-node_modules already
 * has node-pty + official runtime roots, we do NOT require resources/original-claude.app
 * (or any live Downloads Claude.app). Package only consumes the project resources tree.
 *
 * Force full asar re-extract: CLAUDE_FORCE_ORIGINAL_RUNTIME=1 (requires app.asar).
 */
async function hasVendoredModule(moduleName) {
  return exists(path.join(targetNodeModules, moduleName, "package.json"));
}

async function vendoredRuntimeIsUsable() {
  if (!(await hasVendoredModule("node-pty"))) return false;
  for (const moduleName of originalRuntimeModuleRoots) {
    if (!(await hasVendoredModule(moduleName))) return false;
  }
  return true;
}

await fs.mkdir(targetNodeModules, { recursive: true });

const forceAsar = process.env.CLAUDE_FORCE_ORIGINAL_RUNTIME === "1";
const hasAsar = await exists(originalAsar);

if (!hasAsar) {
  if (forceAsar) {
    throw new Error(
      `CLAUDE_FORCE_ORIGINAL_RUNTIME=1 but original app.asar not found: ${originalAsar}\n` +
        `Fix: npm run sync:original-app  (or CLAUDE_ORIGINAL_RESOURCES=/path/with/app.asar)`,
    );
  }
  if (!(await vendoredRuntimeIsUsable())) {
    throw new Error(
      [
        `original app.asar not found: ${originalAsar}`,
        `and resources/original-runtime-node_modules is incomplete (need node-pty + ${originalRuntimeModuleRoots.join(", ")}).`,
        `Package does not read Downloads — use OUR vendored residual:`,
        `  npm run sync:original-app && npm run copy:original-runtime`,
        `  or set CLAUDE_ORIGINAL_RESOURCES=/path/with/app.asar`,
        `If the vendored runtime tree is already complete, re-run without deleting it.`,
      ].join("\n"),
    );
  }

  console.log(
    `[copy:original-runtime] skip asar extract — vendored tree present at ${path.relative(projectRoot, targetNodeModules)}`,
  );
  console.log(
    `[copy:original-runtime] asar missing (${originalAsar}); refreshing local builtins` +
      (process.platform === "win32" ? " + win32 node-pty" : " only"),
  );

  // Win32: always prefer locally built node-pty over any Darwin .node left in the tree.
  if (process.platform === "win32") {
    await copyInstalledModule("node-pty");
    if (await hasVendoredModule("@ant/claude-native")) {
      await writeNativeSafeLoader("@ant/claude-native", "claude-native-binding.node");
    }
  }

  for (const moduleName of localBuiltinModuleRoots) {
    await copyLocalBuiltinModule(moduleName);
  }

  const executableFilesSkip = [
    path.join(targetNodeModules, "node-pty/build/Release/spawn-helper"),
  ];
  for (const filePath of executableFilesSkip) {
    if (await exists(filePath)) await fs.chmod(filePath, 0o755);
  }

  console.log(
    `runtime modules preserved (vendored, no asar): original=${originalRuntimeModuleRoots.length + 1} builtin=${localBuiltinModuleRoots.length}`,
  );
} else {
  if (process.platform === "win32") {
    // The checked-in reference is a macOS .app. For terminal PTY on Windows we must copy the
    // locally installed native node-pty binary, otherwise loadOriginalNodePty() would try to load
    // a Darwin .node file and silently lose the real PTY runtime.
    await copyInstalledModule("node-pty");
  } else {
    await copyOriginalModule("node-pty");
  }
  for (const moduleName of originalRuntimeModuleRoots) {
    await copyOriginalModule(moduleName);
  }
  if (process.platform === "win32") {
    // The reference app bundle checked into this workspace is macOS. Keep the official native
    // binding file for evidence/package parity, but replace the eager NAPI entrypoint with a
    // safe loader so Windows smoke/import checks do not crash on Darwin binaries.
    await writeNativeSafeLoader("@ant/claude-native", "claude-native-binding.node");
  }
  for (const moduleName of localBuiltinModuleRoots) {
    await copyLocalBuiltinModule(moduleName);
  }

  const executableFiles = [
    path.join(targetNodeModules, "node-pty/build/Release/spawn-helper"),
  ];
  for (const filePath of executableFiles) {
    if (await exists(filePath)) await fs.chmod(filePath, 0o755);
  }

  console.log(
    `runtime modules copied: original=${originalRuntimeModuleRoots.length + 1} builtin=${localBuiltinModuleRoots.length}`,
  );
}
