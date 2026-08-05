#!/usr/bin/env node
/**
 * Real Win32 Computer Use smoke (Electron main process).
 *
 * Validates residual product path on this host:
 *   PE @ant/claude-native → createWin32Executor → screenshot(mask) →
 *   bindSessionContext allowlist gates.
 *
 * Usage (from open-claude-desktop root):
 *   node scripts/smoke-win32-computer-use.mjs
 *
 * Does NOT start the full Claudex UI. Safe defaults: hide-before-action off,
 * no click/type, only list + screenshot + cursor position.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, ".tmp-smoke-win32-cu");
const entryTs = path.join(outDir, "entry.ts");
const bundleJs = path.join(outDir, "bundle.cjs");
const electronCli = path.join(root, "node_modules", "electron", "cli.js");
const originalRuntimeNm = path.join(
  root,
  "resources",
  "original-runtime-node_modules",
  "node_modules",
);
const screenshotOut = path.join(outDir, "screenshot.jpg");
const reportOut = path.join(outDir, "report.json");

if (process.platform !== "win32") {
  console.error("smoke-win32-computer-use: win32 only");
  process.exit(1);
}
if (!fs.existsSync(electronCli)) {
  console.error("electron cli missing:", electronCli);
  process.exit(1);
}
if (
  !fs.existsSync(
    path.join(originalRuntimeNm, "@ant", "claude-native", "claude-native-binding.node"),
  )
) {
  console.error(
    "Win PE claude-native-binding.node missing under original-runtime-node_modules",
  );
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(
  entryTs,
  `/**
 * Bundled Electron main for Win CU smoke — imports product modules.
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import {
  bindSessionContext,
  ALL_SUB_GATES_ON,
  DEFAULT_GRANT_FLAGS,
} from "@ant/computer-use-mcp";
import { maybeGetClaudeNative, requireClaudeNative } from ${JSON.stringify(
    path.join(
      root,
      "electron/main/services/coworkRuntime/computerUse/claudeNative.ts",
    ).replace(/\\\\/g, "/"),
  )};
import {
  createWin32Executor,
  getWin32HostBundleId,
} from ${JSON.stringify(
    path.join(
      root,
      "electron/main/services/coworkRuntime/computerUse/createWin32Executor.ts",
    ).replace(/\\\\/g, "/"),
  )};
import { getComputerUseHostAdapter } from ${JSON.stringify(
    path.join(
      root,
      "electron/main/services/coworkRuntime/computerUse/hostAdapter.ts",
    ).replace(/\\\\/g, "/"),
  )};

const screenshotOut = process.env.CU_SMOKE_SCREENSHOT_OUT!;
const reportOut = process.env.CU_SMOKE_REPORT_OUT!;
const originalRuntimeNm = process.env.CU_SMOKE_ORIGINAL_RUNTIME_NM!;

function configureNodePath() {
  if (!process.env.NODE_PATH?.split(path.delimiter).includes(originalRuntimeNm)) {
    process.env.NODE_PATH = [originalRuntimeNm, process.env.NODE_PATH]
      .filter(Boolean)
      .join(path.delimiter);
  }
  // @ts-expect-error Node internal
  Module._initPaths?.();
}

function fail(message: string, detail?: unknown): never {
  console.error("[cu-smoke] FAIL:", message, detail ?? "");
  try {
    fs.writeFileSync(
      reportOut,
      JSON.stringify({ ok: false, message, detail: String(detail ?? "") }, null, 2),
    );
  } catch {
    /* ignore */
  }
  app.exit(1);
  throw new Error(message);
}

async function main() {
  configureNodePath();
  await app.whenReady();

  // Hidden window so Electron main has a display context (desktopCapturer).
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: { sandbox: true },
  });
  await win.loadURL("about:blank");

  const report: Record<string, unknown> = {
    ok: false,
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
  };

  // 1) PE load
  const native = maybeGetClaudeNative();
  if (!native) fail("maybeGetClaudeNative() returned null");
  report.nativeLoaded = true;
  report.nativeMembers = {
    cuListDisplays: typeof native.cuListDisplays,
    cuListRunningApps: typeof native.cuListRunningApps,
    cuListInstalledApps: typeof native.cuListInstalledApps,
    moveMouse: typeof native.moveMouse,
    mouseLocation: typeof native.mouseLocation,
    cuExcludedWindowRects: typeof native.cuExcludedWindowRects,
  };

  const peDisplays = native.cuListDisplays();
  report.peDisplays = peDisplays;
  console.log("[cu-smoke] PE displays:", peDisplays?.length ?? 0);

  const running = native.cuListRunningApps();
  report.runningAppsCount = running?.length ?? 0;
  report.runningAppsSample = (running ?? []).slice(0, 5);
  console.log("[cu-smoke] running apps:", report.runningAppsCount);

  const installed = native.cuListInstalledApps();
  report.installedAppsCount = Array.isArray(installed) ? installed.length : -1;
  console.log("[cu-smoke] installed apps:", report.installedAppsCount);

  const cursor = await Promise.resolve(native.mouseLocation());
  report.cursor = cursor;
  console.log("[cu-smoke] cursor:", cursor);

  // 2) Executor
  const hostBundleId = getWin32HostBundleId();
  report.hostBundleId = hostBundleId;
  const executor = createWin32Executor({
    getMouseAnimationEnabled: () => false,
    getHideBeforeActionEnabled: () => false,
    hostBundleId,
  });
  report.capabilities = executor.capabilities;
  if (executor.capabilities.screenshotFiltering !== "mask") {
    fail("expected screenshotFiltering mask", executor.capabilities);
  }
  if (executor.capabilities.platform !== "win32") {
    fail("expected platform win32", executor.capabilities);
  }
  console.log("[cu-smoke] capabilities:", executor.capabilities);

  const displays = await executor.listDisplays();
  report.executorDisplays = displays;
  console.log("[cu-smoke] executor listDisplays:", displays.length);
  if (!displays.length) fail("listDisplays empty");

  // Prefer explorer / any running app as allowlist so mask has something allowed.
  const explorer =
    running.find((a) => /explorer\\.exe$/i.test(a.bundleId)) ??
    running[0];
  const allowedBundleIds = explorer
    ? [explorer.bundleId, hostBundleId]
    : [hostBundleId];
  report.allowedBundleIds = allowedBundleIds;
  console.log("[cu-smoke] allowlist for screenshot:", allowedBundleIds);

  // 3) Screenshot (mask path)
  const shot = await executor.screenshot({
    allowedBundleIds,
    displayId: displays[0]?.displayId,
  });
  report.screenshot = {
    width: shot.width,
    height: shot.height,
    displayWidth: shot.displayWidth,
    displayHeight: shot.displayHeight,
    displayId: shot.displayId,
    originX: shot.originX,
    originY: shot.originY,
    base64Len: shot.base64?.length ?? 0,
  };
  if (!shot.base64 || shot.base64.length < 100) {
    fail("screenshot base64 missing/too small", report.screenshot);
  }
  const jpeg = Buffer.from(shot.base64, "base64");
  if (!(jpeg[0] === 0xff && jpeg[1] === 0xd8)) {
    fail("screenshot is not JPEG SOI");
  }
  fs.writeFileSync(screenshotOut, jpeg);
  report.screenshotPath = screenshotOut;
  console.log(
    "[cu-smoke] screenshot ok",
    report.screenshot,
    "→",
    screenshotOut,
  );

  // 4) Cursor via executor
  const execCursor = await executor.getCursorPosition();
  report.executorCursor = execCursor;
  console.log("[cu-smoke] executor cursor:", execCursor);

  // 5) Host adapter + bindSessionContext
  // Reset singleton by using getComputerUseHostAdapter (first call builds).
  const adapter = getComputerUseHostAdapter({
    isDisabled: () => false,
    getAutoUnhideEnabled: () => true,
    getSubGates: () => ALL_SUB_GATES_ON,
    getMouseAnimationEnabled: () => false,
    getHideBeforeActionEnabled: () => false,
  });
  if (!adapter) fail("getComputerUseHostAdapter returned null");
  report.adapterReady = true;
  report.adapterCaps = adapter.executor.capabilities;

  let allowed: Array<{
    bundleId: string;
    displayName: string;
    grantedAt: number;
    tier: "full";
  }> = [];
  const dispatch = bindSessionContext(adapter, "pixels", {
    getAllowedApps: () => allowed,
    getGrantFlags: () => ({ ...DEFAULT_GRANT_FLAGS }),
    getUserDeniedBundleIds: () => [],
    getSelectedDisplayId: () => undefined,
  });

  const empty = await dispatch("screenshot", {});
  report.emptyAllowlist = {
    isError: empty.isError === true,
    text: (empty.content?.[0] as { text?: string } | undefined)?.text?.slice(
      0,
      200,
    ),
  };
  if (empty.isError !== true) {
    fail("expected allowlist_empty error without grants", report.emptyAllowlist);
  }
  console.log("[cu-smoke] empty allowlist residual:", report.emptyAllowlist.text);

  allowed = allowedBundleIds.map((bundleId) => ({
    bundleId,
    displayName: path.basename(bundleId),
    grantedAt: Date.now(),
    tier: "full" as const,
  }));

  const listed = await dispatch("list_granted_applications", {});
  report.listGranted = {
    isError: listed.isError === true,
    text: (listed.content?.[0] as { text?: string } | undefined)?.text?.slice(
      0,
      400,
    ),
  };
  console.log("[cu-smoke] list_granted:", report.listGranted.text);

  const grantedShot = await dispatch("screenshot", {});
  const hasImage = (grantedShot.content ?? []).some(
    (c) => (c as { type?: string }).type === "image",
  );
  const hasTextError =
    grantedShot.isError === true &&
    (grantedShot.content ?? []).some(
      (c) =>
        (c as { type?: string }).type === "text" &&
        typeof (c as { text?: string }).text === "string",
    );
  report.grantedScreenshot = {
    isError: grantedShot.isError === true,
    hasImage,
    contentTypes: (grantedShot.content ?? []).map(
      (c) => (c as { type?: string }).type,
    ),
    textPreview: (grantedShot.content ?? [])
      .filter((c) => (c as { type?: string }).type === "text")
      .map((c) => ((c as { text?: string }).text ?? "").slice(0, 160))
      .join(" | "),
  };
  console.log("[cu-smoke] granted screenshot:", report.grantedScreenshot);

  if (grantedShot.isError && !hasImage) {
    fail(
      "screenshot with grants failed",
      report.grantedScreenshot,
    );
  }

  // Soft check: refuse string from old product path must not appear.
  const refuseLegacy =
    "Computer use actions could not be completed on the desktop host";
  if (
    report.grantedScreenshot.textPreview &&
    String(report.grantedScreenshot.textPreview).includes(refuseLegacy)
  ) {
    fail("legacy refuse string still returned after grants");
  }

  report.ok = true;
  fs.writeFileSync(reportOut, JSON.stringify(report, null, 2));
  console.log("[cu-smoke] PASS");
  console.log("[cu-smoke] report →", reportOut);

  try {
    if (!win.isDestroyed()) win.destroy();
  } catch {
    /* ignore */
  }
  // Force process exit — on Windows app.exit alone can leave Electron alive.
  setTimeout(() => process.exit(0), 50);
  app.exit(0);
}

main().catch((error) => {
  console.error("[cu-smoke] uncaught", error);
  try {
    fs.writeFileSync(
      reportOut,
      JSON.stringify(
        { ok: false, message: String(error?.stack ?? error) },
        null,
        2,
      ),
    );
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(1), 50);
  app.exit(1);
});
`,
);

console.log("[cu-smoke] bundling entry with esbuild…");
await esbuild.build({
  entryPoints: [entryTs],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundleJs,
  target: "node22",
  external: [
    "electron",
    "@ant/claude-native",
    // Keep computer-use-mcp external so dist JS loads as-is (has side deps).
    "@ant/computer-use-mcp",
  ],
  sourcemap: true,
  logLevel: "info",
});

const env = {
  ...process.env,
  // Critical: clear so Chromium flags work under electron.
  ELECTRON_RUN_AS_NODE: "",
  CU_SMOKE_SCREENSHOT_OUT: screenshotOut,
  CU_SMOKE_REPORT_OUT: reportOut,
  CU_SMOKE_ORIGINAL_RUNTIME_NM: originalRuntimeNm,
  NODE_PATH: [originalRuntimeNm, process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter),
  electron_config_cache: path.join(root, ".electron-cache"),
};
delete env.ELECTRON_RUN_AS_NODE;

console.log("[cu-smoke] launching electron…");
const child = spawn(process.execPath, [electronCli, bundleJs], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  const s = chunk.toString();
  stdout += s;
  process.stdout.write(s);
});
child.stderr.on("data", (chunk) => {
  const s = chunk.toString();
  stderr += s;
  process.stderr.write(s);
});

const code = await new Promise((resolve) => {
  let settled = false;
  const finish = (c) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(c ?? 1);
  };
  const timer = setTimeout(() => {
    console.error("[cu-smoke] timeout 60s — killing");
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    finish(124);
  }, 60_000);
  child.on("exit", (c) => finish(c ?? 1));
  child.on("close", (c) => finish(c ?? 1));
});

if (code !== 0) {
  console.error("[cu-smoke] electron exit", code);
  if (fs.existsSync(reportOut)) {
    console.error(fs.readFileSync(reportOut, "utf8"));
  }
  process.exit(code || 1);
}

if (!fs.existsSync(reportOut)) {
  console.error("[cu-smoke] missing report");
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(reportOut, "utf8"));
if (!report.ok) {
  console.error("[cu-smoke] report not ok", report);
  process.exit(1);
}
console.log("[cu-smoke] done ok; screenshot bytes", fs.statSync(screenshotOut).size);
