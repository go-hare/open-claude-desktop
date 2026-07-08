import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronVersion = JSON.parse(await fs.readFile(path.join(projectRoot, "node_modules/electron/package.json"), "utf8")).version;
const platform = process.env.CLAUDE_PACKAGE_PLATFORM || process.platform;
const arch = process.env.CLAUDE_PACKAGE_ARCH || process.arch;
const zipDir = path.join(projectRoot, ".electron-cache", "local");
const zipPath = path.join(zipDir, `electron-v${electronVersion}-${platform}-${arch}.zip`);
const electronDist = path.join(projectRoot, "node_modules", "electron", "dist");

if (!fsSync.existsSync(electronDist)) throw new Error(`missing installed Electron dist: ${electronDist}`);
await fs.mkdir(zipDir, { recursive: true });

if (fsSync.existsSync(zipPath)) {
  console.log(`electron zip exists: ${path.relative(projectRoot, zipPath)}`);
  process.exit(0);
}

if (process.platform === "win32") {
  const escapedSource = path.join(electronDist, "*").replace(/'/g, "''");
  const escapedTarget = zipPath.replace(/'/g, "''");
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Compress-Archive -Path '${escapedSource}' -DestinationPath '${escapedTarget}' -Force`,
  ], { stdio: "inherit" });
} else {
  execFileSync("zip", ["-qry", zipPath, "."], { cwd: electronDist, stdio: "inherit" });
}

console.log(`electron zip created: ${path.relative(projectRoot, zipPath)}`);
