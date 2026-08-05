/**
 * Canonical product package pipeline (darwin + win32).
 *
 * Shell model (same as open-claude-web): we WRITE the product shell.
 *   - electron-forge Electron runtime (Claudex binary / Helpers / Frameworks)
 *   - product main/preload in app.asar (our code, residual-aligned behavior)
 *   - NO wholesale official Claude.app MacOS/Frameworks/Helpers overlay
 *
 * Two load routes (do not collapse):
 *   package → app://localhost → packaged Resources dual-root:
 *             product-web (primary SPA) + ion-dist (residual setup SPA)
 *   test/dev → http://localhost:5176                        (vite open-claude-web)
 *
 * Steps:
 *   1) build          — product TS main + preloads + project secondary shell assets
 *                       (no copy:original-shell; no external residual mirror)
 *   2) restore main   — re-run build:main (safety if anything touched .vite)
 *   3) product-web    — vite-build open-claude-web → resources/product-web
 *   4) electron-zip   — clean polluted dist fonts symlink if needed
 *   5) forge package  — host-native out/ tree (own Electron shell)
 *   6) align:bundle   — finalize Helpers path + asar runtime inject (project resources only)
 *   7) audit:bundle   — product identity / dual-root / layout checks
 *   8) post-checks    — product-web + residual ion-dist + product main asar fingerprint
 *
 * Host-native only:
 *   macOS  → out/Claudex-darwin-<arch>/Claudex.app  (Contents/MacOS/Claudex)
 *   Windows → out/Claudex-win32-<arch>/Claudex.exe
 *
 * Usage: npm run package
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectPackagedAsarMain,
  inspectPackagedDualRoot,
  PRODUCT_BUNDLE_ID,
  readIonBuildId,
  resolvePackagedTargets,
} from "./packagePaths.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  electron_config_cache: path.join(root, ".electron-cache"),
};

/**
 * Package only packs OUR project resources/ tree (normal Electron).
 * Does NOT read original-claude.app / Downloads at package time.
 * One-time asset import: npm run sync:residual / sync:helpers / copy:original-runtime.
 */
function preflightPackageResources() {
  const required = [
    ["resources/ion-dist/index.html", "npm run sync:ion-dist"],
    [
      "resources/original-runtime-node_modules/node_modules/node-pty/package.json",
      "npm run copy:original-runtime",
    ],
    ["resources/Helpers/chrome-native-host", "npm run sync:helpers"],
  ];
  const missing = [];
  for (const [rel, fix] of required) {
    if (!fs.existsSync(path.join(root, rel))) {
      missing.push(`  missing ${rel} — fix once: ${fix}`);
    }
  }
  if (missing.length) {
    throw new Error(
      "Project resources incomplete (package does not pull from official residual .app):\n" +
        missing.join("\n"),
    );
  }
  console.log(
    `\n[package] normal project pack\n` +
      `          shell: forge Electron (Claudex)\n` +
      `          assets: already under resources/ (ion-dist, Helpers, runtime, …)\n` +
      `          package does NOT copy from original-claude.app / Downloads\n`,
  );
}

function run(label, command, args) {
  console.log(`\n==> ${label}\n    ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status ?? "null"}`);
  }
}

function npmRun(script) {
  run(`npm run ${script}`, "npm", ["run", script]);
}

function readPlistString(infoPlist, key) {
  if (!fs.existsSync(infoPlist)) return null;
  try {
    const out = spawnSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Print :${key}`, infoPlist],
      { encoding: "utf8" },
    );
    if (out.status === 0) return out.stdout.trim();
  } catch {
    // fall through
  }
  try {
    const source = fs.readFileSync(infoPlist, "utf8");
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return source.match(new RegExp(`<key>${escaped}</key>\\s*<string>([^<]+)</string>`))?.[1] ?? null;
  } catch {
    return null;
  }
}

function readCodesignIdentifier(appPath) {
  if (process.platform !== "darwin" || !fs.existsSync(appPath)) return null;
  const dv = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=2", appPath], {
    encoding: "utf8",
  });
  return `${dv.stderr ?? ""}${dv.stdout ?? ""}`.match(/^Identifier=(.+)$/m)?.[1]?.trim() ?? null;
}

const productWebIndex = path.join(root, "resources/product-web/index.html");

// Fail early: dual-root SPA + runtime natives in resources/ (own shell; no official .app).
preflightPackageResources();

// 1–2 residual-aligned build, then product main wins for package payload
npmRun("build");
npmRun("restore:product-main");
npmRun("build:product-web");

if (!fs.existsSync(productWebIndex)) {
  throw new Error(`product-web missing after build: ${productWebIndex}`);
}

npmRun("prepare:electron-zip");
run(
  "electron-forge package",
  process.execPath,
  [path.join(root, "node_modules/@electron-forge/cli/dist/electron-forge.js"), "package"],
);
npmRun("align:bundle");
npmRun("audit:bundle");

const targets = resolvePackagedTargets({ root });
const binary =
  targets.platform === "darwin" && !fs.existsSync(targets.binary) && targets.binaryFallback
    ? targets.binaryFallback
    : targets.binary;

// Post-checks: dual-root product-web + residual ion-dist + binary + product main asar
const dualRoot = inspectPackagedDualRoot(targets);
if (!dualRoot.ok) {
  throw new Error(
    `packaged dual-root failed: ${dualRoot.reason ?? "unknown"} ` +
      `(product=${dualRoot.productBuildId ?? "null"} residual=${dualRoot.residualBuildId ?? "null"}). ` +
      `Align must keep product-web primary and residual ion-dist (spa-dev) for setup-desktop-3p.`,
  );
}
const buildId = dualRoot.productBuildId ?? readIonBuildId(targets.productWebIndex) ?? "unknown";
if (!fs.existsSync(binary)) {
  throw new Error(`packaged binary missing: ${binary}`);
}

const asarMain = inspectPackagedAsarMain(targets.appAsar);
if (!asarMain.ok) {
  throw new Error(
    `packaged app.asar is not product main: ${asarMain.reason ?? "unknown"} ` +
      `(indexSize=${asarMain.indexSize ?? 0} hasChunks=${asarMain.hasChunks ?? false} ` +
      `markers=${JSON.stringify(asarMain.productMarkerHits ?? [])}). ` +
      `Ensure restore:product-main ran after copy:original-shell and align kept forge asar.`,
  );
}

if (targets.platform === "darwin") {
  const bundleId = readPlistString(targets.infoPlist, "CFBundleIdentifier");
  if (bundleId !== PRODUCT_BUNDLE_ID) {
    throw new Error(
      `packaged CFBundleIdentifier is ${bundleId ?? "null"}, expected ${PRODUCT_BUNDLE_ID} (align reStamp failed)`,
    );
  }
  const codesignId = readCodesignIdentifier(targets.packagedRoot);
  if (codesignId !== PRODUCT_BUNDLE_ID) {
    throw new Error(
      `codesign Identifier is ${codesignId ?? "null"}, expected ${PRODUCT_BUNDLE_ID}`,
    );
  }
}

if (targets.platform === "win32" && !fs.existsSync(targets.claudeCodeBinary)) {
  throw new Error(
    `packaged claude.exe missing: ${targets.claudeCodeBinary} (copy:claude-code-binary + align:win32)`,
  );
}

const openHint =
  targets.platform === "win32"
    ? "npm run package:open\n  # or: start out\\Claudex-win32-<arch>\\Claudex.exe"
    : `npm run package:open\n  # or: open "${targets.packagedRoot}"`;

console.log(`
────────────────────────────────────────
Claudex package ready (${targets.platform}/${targets.arch})

  root:    ${targets.packagedRoot}
  binary:  ${binary}
  web:     ${targets.webLabel}
           product-web data-build-id=${buildId}
           residual ion-dist data-build-id=${dualRoot.residualBuildId ?? "unknown"}
  asar:    product main ok (index=${asarMain.indexSize}B chunks=${asarMain.hasChunks})
  load:    app://localhost → product-web (setup residual → ion-dist)
  identity:${targets.platform === "darwin" ? ` ${PRODUCT_BUNDLE_ID}` : " Claudex.exe (win32)"}

Routes:
  package  → app://localhost  (this build; dual-root)
  test/dev → http://localhost:5176
             npm run dev
             (requires open-claude-web vite on 5176)

Open:
  ${openHint}

Do not run packaged app while npm run dev holds the same
userData single-instance lock (Claudex product name).
package:open defaults to isolated userData; use --no-isolated to share.

Windows notes:
  - Package on a Windows host (host-native forge + native modules).
  - Exe is Claudex.exe under out/Claudex-win32-<arch>/.
  - align keeps dual-root product-web + residual ion-dist (same as mac).
  - smoke:packaged expects resources/claude-code-bin/claude.exe.
────────────────────────────────────────
`);
