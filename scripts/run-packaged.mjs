/**
 * Launch packaged Claudex for manual testing.
 *
 * darwin:  out/Claudex-darwin-<arch>/Claudex.app  (Contents/MacOS/Claude after align)
 * win32:   out/Claudex-win32-<arch>/Claudex.exe
 *
 * Default: open the app via OS launcher (mac `open`, win start/spawn).
 * CLAUDE_PACKAGE_ISOLATED=1 / --isolated → spawn binary with isolated userData so it
 * does not fight npm run dev (same productName single-instance / Claudex userData).
 *
 * Never sets CLAUDE_DESKTOP_MAIN_VIEW_URL — packaged must load app:// product web.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readIonBuildId, resolvePackagedTargets } from "./packagePaths.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.CLAUDE_PACKAGE_ISOLATED === "1" || process.argv.includes("--isolated");
const killDev = process.env.CLAUDE_PACKAGE_KILL_DEV === "1" || process.argv.includes("--kill-dev");

const targets = resolvePackagedTargets({ root });
const platform = targets.platform;
const packagedRoot = targets.packagedRoot;
const binary =
  platform === "darwin" && !fs.existsSync(targets.binary) && targets.binaryFallback
    ? targets.binaryFallback
    : targets.binary;
const ionIndex = targets.ionIndex;

if (!fs.existsSync(packagedRoot)) {
  throw new Error(`packaged app missing — run npm run package first:\n  ${packagedRoot}`);
}
if (!fs.existsSync(binary)) {
  throw new Error(
    platform === "win32"
      ? `packaged exe missing:\n  ${binary}`
      : `packaged binary missing (expected residual MacOS/Claude):\n  ${binary}`,
  );
}

const buildId = readIonBuildId(ionIndex);
if (buildId) {
  console.log(`[package:open] ion-dist data-build-id=${buildId} (expect product, not spa-dev)`);
  if (buildId === "spa-dev") {
    console.warn("[package:open] WARNING: residual spa still in ion-dist — re-run npm run package");
  }
}

if (killDev) {
  // Best-effort: free single-instance lock held by project electron dev.
  if (platform === "darwin") {
    spawnSync("pkill", ["-f", "open-claude-desktop/node_modules/electron/dist/Electron.app"], {
      stdio: "ignore",
    });
  } else if (platform === "win32") {
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'open-claude-desktop\\\\node_modules\\\\electron' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: "ignore" },
    );
  }
}

if (!isolated) {
  console.log(`[package:open] open ${packagedRoot}`);
  console.log("[package:open] load route: app://localhost (product web in Resources/ion-dist)");
  if (platform === "darwin") {
    spawnSync("open", [packagedRoot], { stdio: "inherit" });
  } else {
    const child = spawn(binary, [], {
      cwd: path.dirname(binary),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
  }
  process.exit(0);
}

const userData = path.join(root, ".package-user-data");
fs.mkdirSync(userData, { recursive: true });
console.log(`[package:open] isolated userData: ${userData}`);
console.log(`[package:open] binary: ${binary}`);
console.log("[package:open] load route: app://localhost");

const child = spawn(binary, [], {
  cwd: platform === "win32" ? path.dirname(binary) : root,
  env: {
    ...process.env,
    // Product residual prefers CLAUDE_USER_DATA_DIR when set (smoke + package isolated).
    CLAUDE_USER_DATA_DIR: userData,
  },
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
