import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = path.resolve(root, "../../Claude-Deepseek.app/Contents/Resources/ion-dist");
const source = process.argv[2] ? path.resolve(process.argv[2]) : defaultSource;
const target = path.join(root, "resources/ion-dist");

await fs.access(source);
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.cp(source, target, { recursive: true, preserveTimestamps: true });
console.log(`ion-dist synced: ${source} -> ${target}`);
