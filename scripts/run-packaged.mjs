/**
 * Launch packaged Claudex for manual testing.
 *
 * darwin:  out/Claudex-darwin-<arch>/Claudex.app  (Contents/MacOS/Claudex — own forge shell)
 * win32:   out/Claudex-win32-<arch>/Claudex.exe
 *
 * Default: isolated userData so package:open does not fight npm run dev
 * (same productName single-instance / Claudex userData).
 *   CLAUDE_PACKAGE_ISOLATED=0 / --no-isolated → share default userData via OS open.
 *
 * Never sets CLAUDE_DESKTOP_MAIN_VIEW_URL — packaged must load app:// product web.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectPackagedDualRoot,
  readIonBuildId,
  resolvePackagedTargets,
} from "./packagePaths.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Default isolated — package:open used to share userData and collide with dev.
const isolated =
  process.env.CLAUDE_PACKAGE_ISOLATED === "0" || process.argv.includes("--no-isolated")
    ? false
    : true;
const killDev = process.env.CLAUDE_PACKAGE_KILL_DEV === "1" || process.argv.includes("--kill-dev");

const targets = resolvePackagedTargets({ root });
const platform = targets.platform;
const packagedRoot = targets.packagedRoot;
const binary =
  platform === "darwin" && !fs.existsSync(targets.binary) && targets.binaryFallback
    ? targets.binaryFallback
    : targets.binary;

if (!fs.existsSync(packagedRoot)) {
  throw new Error(`packaged app missing — run npm run package first:\n  ${packagedRoot}`);
}
if (!fs.existsSync(binary)) {
  throw new Error(
    platform === "win32"
      ? `packaged exe missing:\n  ${binary}`
      : `packaged binary missing (expected Contents/MacOS/Claudex):\n  ${binary}`,
  );
}

const dualRoot = inspectPackagedDualRoot(targets);
const productBuildId =
  dualRoot.productBuildId ?? readIonBuildId(targets.productWebIndex);
const residualBuildId =
  dualRoot.residualBuildId ?? readIonBuildId(targets.residualIonIndex ?? targets.ionIndex);
console.log(
  `[package:open] dual-root product-web=${productBuildId ?? "missing"} residual-ion=${residualBuildId ?? "missing"}`,
);
if (!dualRoot.ok) {
  console.warn(
    `[package:open] WARNING: dual-root check failed: ${dualRoot.reason ?? "unknown"} — re-run npm run package`,
  );
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
  console.log(`[package:open] open ${packagedRoot} (shared userData; may fight npm run dev)`);
  console.log(
    "[package:open] load route: app://localhost → product-web (setup residual → ion-dist)",
  );
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
console.log(
  "[package:open] load route: app://localhost → product-web (setup residual → ion-dist)",
);

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
