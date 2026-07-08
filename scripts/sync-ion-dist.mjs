import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceCandidates = [
  process.argv[2] ? path.resolve(process.argv[2]) : undefined,
  process.env.CLAUDE_ORIGINAL_ION_DIST,
  process.env.CLAUDE_ORIGINAL_RESOURCES ? path.join(process.env.CLAUDE_ORIGINAL_RESOURCES, "ion-dist") : undefined,
  path.resolve(root, "../Claude-Deepseek.app/Contents/Resources/ion-dist"),
  path.resolve(root, "../../Claude-Deepseek.app/Contents/Resources/ion-dist"),
  "/Users/apple/Downloads/Claude code 汉化mac桌面版/Claude-Deepseek.app/Contents/Resources/ion-dist",
  String.raw`D:\BaiduNetdiskDownload\Claude code 汉化mac桌面版\Claude-Deepseek\Claude-Deepseek.app\Contents\Resources\ion-dist`,
  String.raw`D:\work\py\claude\claude-ion-react-workbench\claude-deepseek-desktop\resources\ion-dist`,
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
