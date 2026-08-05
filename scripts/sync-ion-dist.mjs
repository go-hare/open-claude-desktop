import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { getProjectRoot, resolveOriginalIonDist } from "./originalAppPaths.mjs";

const root = getProjectRoot();
// Prefer OUR vendored residual app's ion-dist; Downloads only if vendor empty.
const sourceCandidates = [
  process.argv[2] ? path.resolve(process.argv[2]) : undefined,
  process.env.CLAUDE_ORIGINAL_ION_DIST,
  path.join(root, "resources/original-claude.app/Contents/Resources/ion-dist"),
  resolveOriginalIonDist(),
  "/Users/apple/Downloads/Claude code 汉化mac桌面版/Claude-Deepseek.app/Contents/Resources/ion-dist",
].filter(Boolean);
const source = sourceCandidates.find((candidate) => {
  try {
    return fsSync.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}) ?? sourceCandidates[0];
const target = path.join(root, "resources/ion-dist");

await fs.access(source);
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.cp(source, target, { recursive: true, preserveTimestamps: true });
console.log(`ion-dist synced: ${source} -> ${target}`);
