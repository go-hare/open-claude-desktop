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

// Dev residual helpers sometimes symlink product Resources into Electron.app
// (fonts/Assets.car/…). Zip would store the symlink as a file path, then
// packager fails when extraResource copies a real directory over it.
const electronAppResources = path.join(electronDist, "Electron.app/Contents/Resources");
const residualPolluters = [
  "fonts",
  "Assets.car",
  "claude-screen.png",
  "claude-screen-dark.png",
  "electron.icns",
];
if (fsSync.existsSync(electronAppResources)) {
  for (const name of residualPolluters) {
    const target = path.join(electronAppResources, name);
    try {
      const st = fsSync.lstatSync(target);
      if (st.isSymbolicLink() || st.isFile()) {
        await fs.rm(target, { force: true });
        console.log(`stripped residual polluter from electron dist: ${name}`);
      }
    } catch {
      /* absent */
    }
  }
}

if (fsSync.existsSync(zipPath)) {
  // Drop zip if it still embeds a non-directory Resources/fonts entry (stale pollution).
  try {
    const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
    if (/Electron\.app\/Contents\/Resources\/fonts\s*$/m.test(listing.split("\n").find((l) => l.includes("Resources/fonts")) ?? "")
      || listing.includes("Electron.app/Contents/Resources/fonts") && !listing.includes("Electron.app/Contents/Resources/fonts/")) {
      // Only rebuild when fonts appears as a lone file entry (no trailing children).
      const fontsLines = listing.split("\n").filter((l) => l.includes("Electron.app/Contents/Resources/fonts"));
      const hasDirChildren = fontsLines.some((l) => /Resources\/fonts\//.test(l));
      const hasBareFonts = fontsLines.some((l) => /Resources\/fonts\s*$/.test(l.trimEnd()) || /Resources\/fonts$/.test(l));
      if (hasBareFonts && !hasDirChildren) {
        await fs.rm(zipPath, { force: true });
        console.log(`removed polluted electron zip: ${path.relative(projectRoot, zipPath)}`);
      }
    }
  } catch {
    /* keep existing zip if unzip inspect fails */
  }
}

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
