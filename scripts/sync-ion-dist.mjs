import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceCandidates = [
  path.resolve(root, "../Claude-Deepseek.app/Contents/Resources/ion-dist"),
  path.resolve(root, "../../Claude-Deepseek.app/Contents/Resources/ion-dist"),
  "/Users/apple/Downloads/Claude code 汉化mac桌面版/Claude-Deepseek.app/Contents/Resources/ion-dist",
];
let defaultSource = sourceCandidates[0];
for (const candidate of sourceCandidates) {
  try {
    if ((await fs.stat(candidate)).isDirectory()) {
      defaultSource = candidate;
      break;
    }
  } catch {
    // Try the next known location.
  }
}
const source = process.argv[2] ? path.resolve(process.argv[2]) : defaultSource;
const target = path.join(root, "resources/ion-dist");

await fs.access(source);
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.cp(source, target, { recursive: true, preserveTimestamps: true });
console.log(`ion-dist synced: ${source} -> ${target}`);
