#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runNode(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
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

await runNode([path.join(root, "node_modules/vite/bin/vite.js"), "build", "--config", "vite.main.config.ts"], "build:main");
await runNode([path.join(root, "scripts/build-preload.mjs")], "build:preload");
