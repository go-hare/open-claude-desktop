#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const shouldBuild = !args.includes("--no-build");
const checkOnly = args.includes("--check");
const electronArgs = args.filter((arg) => arg !== "--no-build" && arg !== "--check");
const mainViewUrl = process.env.CLAUDE_DESKTOP_MAIN_VIEW_URL ?? "http://localhost:5176";
const electronCli = path.join(root, "node_modules/electron/cli.js");
const resourcesRoot = process.env.CLAUDE_DESKTOP_RESOURCES_ROOT ?? path.join(root, "resources");

function requireFile(filePath, label) {
  if (fs.existsSync(filePath)) return;
  throw new Error(`${label} not found: ${filePath}`);
}

function runNode(scriptArgs, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, scriptArgs, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed${signal ? ` with signal ${signal}` : ` with code ${code ?? "unknown"}`}`));
    });
  });
}

function runElectron() {
  const env = {
    ...process.env,
    CLAUDE_DESKTOP_MAIN_VIEW_URL: mainViewUrl,
    CLAUDE_DESKTOP_RESOURCES_ROOT: resourcesRoot,
  };
  const child = spawn(process.execPath, [electronCli, ...electronArgs, "."], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  return child;
}

requireFile(electronCli, "Electron CLI");
requireFile(path.join(root, "node_modules/vite/bin/vite.js"), "Vite CLI");

if (checkOnly) {
  console.log(JSON.stringify({
    ok: true,
    mainViewUrl,
    resourcesRoot,
    electronCli,
    shouldBuild,
  }, null, 2));
  process.exit(0);
}

if (shouldBuild) {
  await runNode([path.join(root, "scripts/build-dev-assets.mjs")], "desktop dev build");
}

runElectron();
