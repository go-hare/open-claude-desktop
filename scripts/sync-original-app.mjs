/**
 * Vendor the official residual .app into the product tree so package / audit /
 * runtime-copy scripts do not depend on Downloads or env vars.
 *
 * Default source (CLAUDE.md residual path):
 *   /Users/apple/Downloads/Claude code 汉化mac桌面版/Claude-Deepseek.app
 *
 * Target:
 *   resources/original-claude.app
 *
 * Usage:
 *   npm run sync:original-app
 *   npm run sync:original-app -- /path/to/Claude-Deepseek.app
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { originalAppSyncCandidates, VENDORED_ORIGINAL_APP } from "./originalAppPaths.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetApp = VENDORED_ORIGINAL_APP;

// Sync may read Downloads / CLAUDE_ORIGINAL_APP to refresh OUR vendor tree.
// Package/align only read resources/original-claude.app after this.
const sourceCandidates = [
  process.argv[2] ? path.resolve(process.argv[2]) : undefined,
  ...originalAppSyncCandidates(),
].filter(Boolean);

const sourceApp =
  sourceCandidates.find((candidate) => {
    try {
      return (
        fsSync.existsSync(candidate) &&
        fsSync.existsSync(path.join(candidate, "Contents/Resources/app.asar"))
      );
    } catch {
      return false;
    }
  }) ?? sourceCandidates[0];

if (!sourceApp || !fsSync.existsSync(sourceApp)) {
  throw new Error(
    `official residual .app not found. Pass path or set CLAUDE_ORIGINAL_APP.\nTried:\n${sourceCandidates.join("\n")}`,
  );
}
if (!fsSync.existsSync(path.join(sourceApp, "Contents/Resources/app.asar"))) {
  throw new Error(`original app.asar missing under: ${sourceApp}`);
}

// Avoid copying the target into itself if source already is the vendored path.
const sourceResolved = fsSync.realpathSync(sourceApp);
const targetParent = path.dirname(targetApp);
await fs.mkdir(targetParent, { recursive: true });

if (sourceResolved === path.resolve(targetApp) || sourceResolved === targetApp) {
  console.log(`original-claude.app already at target: ${targetApp}`);
  process.exit(0);
}

const tempTarget = `${targetApp}.tmp-${process.pid}`;
await fs.rm(tempTarget, { recursive: true, force: true });

// ditto preserves macOS bundle layout, relative symlinks, and xattrs.
execFileSync("/usr/bin/ditto", [sourceApp, tempTarget], { stdio: "inherit" });
await fs.rm(targetApp, { recursive: true, force: true });
await fs.rename(tempTarget, targetApp);

const asar = path.join(targetApp, "Contents/Resources/app.asar");
if (!fsSync.existsSync(asar)) {
  throw new Error(`sync failed: app.asar missing after ditto at ${asar}`);
}

console.log(`original residual app synced:\n  ${sourceApp}\n  -> ${targetApp}`);
