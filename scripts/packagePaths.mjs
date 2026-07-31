/**
 * Shared packaged product paths (host-native).
 *
 * macOS: out/Claudex-darwin-<arch>/Claudex.app
 * Windows: out/Claudex-win32-<arch>/
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const PRODUCT_BUNDLE_ID =
  process.env.CLAUDE_PRODUCT_BUNDLE_ID ?? "com.local.claudex.desktop";
export const PRODUCT_NAME = process.env.CLAUDE_PRODUCT_NAME ?? "Claudex";
export const OFFICIAL_BUNDLE_ID = "com.anthropic.claudefordesktop";

export function getProjectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function packageArch() {
  return process.env.CLAUDE_PACKAGE_ARCH || process.arch;
}

/**
 * Resolve packaged targets for the host (or CLAUDE_PACKAGE_PLATFORM override).
 * @param {{ root?: string, platform?: string, arch?: string }} [opts]
 */
export function resolvePackagedTargets(opts = {}) {
  const root = opts.root ?? getProjectRoot();
  const platform = opts.platform ?? process.env.CLAUDE_PACKAGE_PLATFORM ?? process.platform;
  const arch = opts.arch ?? packageArch();

  if (platform === "win32") {
    const packagedRoot = path.join(root, `out/Claudex-win32-${arch}`);
    const resourcesRoot = path.join(packagedRoot, "resources");
    return {
      platform: "win32",
      arch,
      packagedRoot,
      binary: path.join(packagedRoot, "Claudex.exe"),
      resourcesRoot,
      // Product dual-root residual (electronShellPaths):
      //   primary app:// SPA → resources/product-web
      //   residual setup SPA → resources/ion-dist (spa-dev / official)
      productWebIndex: path.join(resourcesRoot, "product-web/index.html"),
      ionIndex: path.join(resourcesRoot, "ion-dist/index.html"),
      residualIonIndex: path.join(resourcesRoot, "ion-dist/index.html"),
      appAsar: path.join(resourcesRoot, "app.asar"),
      claudeCodeBinary: path.join(resourcesRoot, "claude-code-bin/claude.exe"),
      webLabel: "resources/product-web + resources/ion-dist residual",
    };
  }

  // Prefer arch-specific tree; fall back to historical arm64 folder if present.
  const preferred = path.join(root, `out/Claudex-darwin-${arch}/Claudex.app`);
  const legacyArm64 = path.join(root, "out/Claudex-darwin-arm64/Claudex.app");
  const packagedRoot =
    fs.existsSync(preferred)
      ? preferred
      : arch !== "arm64" && fs.existsSync(legacyArm64)
        ? legacyArm64
        : preferred;
  const resourcesRoot = path.join(packagedRoot, "Contents/Resources");

  return {
    platform: "darwin",
    arch,
    packagedRoot,
    binary: path.join(packagedRoot, "Contents/MacOS/Claude"),
    binaryFallback: path.join(packagedRoot, "Contents/MacOS/Claudex"),
    resourcesRoot,
    productWebIndex: path.join(resourcesRoot, "product-web/index.html"),
    ionIndex: path.join(resourcesRoot, "ion-dist/index.html"),
    residualIonIndex: path.join(resourcesRoot, "ion-dist/index.html"),
    appAsar: path.join(resourcesRoot, "app.asar"),
    infoPlist: path.join(packagedRoot, "Contents/Info.plist"),
    claudeCodeBinary: path.join(resourcesRoot, "claude-code-bin/claude"),
    webLabel: "Contents/Resources/product-web + ion-dist residual",
  };
}

/**
 * Product main fingerprint inside packaged app.asar.
 * Product vite emits tiny index + chunks; official shell is a single ~12MB index.js.
 * @param {string} appAsarPath
 * @param {typeof import("@electron/asar") | null} [asarModule]
 */
export function inspectPackagedAsarMain(appAsarPath, asarModule = null) {
  const asar = asarModule ?? require("@electron/asar");
  if (!fs.existsSync(appAsarPath)) {
    return {
      exists: false,
      ok: false,
      reason: "app.asar missing",
    };
  }
  const entries = asar.listPackage(appAsarPath).map((entry) =>
    `/${entry.replace(/\\/g, "/").replace(/^\/+/, "")}`,
  );
  const entrySet = new Set(entries);
  const hasChunks = entries.some((e) => e.startsWith("/.vite/build/chunks/"));
  let indexSize = 0;
  let indexTextSample = "";
  try {
    const buf = asar.extractFile(appAsarPath, ".vite/build/index.js");
    indexSize = buf.length;
    indexTextSample = buf.toString("utf8").slice(0, 4000);
  } catch {
    // no index
  }
  let preText = "";
  try {
    preText = asar.extractFile(appAsarPath, ".vite/build/index.pre.js").toString("utf8");
  } catch {
    // no pre
  }
  const productMarkers = [
    /Claudex Desktop failed to launch/,
    /bootstrapDesktopApp/,
    /chunks\/index-/,
    /com\.local\.claudex/,
    /CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW/,
    /CLAUDE_DESKTOP_SMOKE_TEST/,
  ];
  const blob = `${preText}\n${indexTextSample}`;
  const productMarkerHits = productMarkers.filter((re) => re.test(blob)).map((re) => re.source);
  // Official residual main is a huge single-file bundle without product chunks.
  const looksOfficialMonolith = !hasChunks && indexSize > 1_000_000;
  const looksProduct =
    hasChunks ||
    productMarkerHits.length > 0 ||
    (indexSize > 0 && indexSize < 50_000 && /chunks\//.test(preText));

  // Workspace pollution that must never ship in app.asar (forge ignore allowlist).
  const pollutionPrefixes = [
    "/.dev-user-data",
    "/.preview-product-user-data",
    "/.bridge-eval-user-data",
    "/.smoke-",
    "/.codex-",
    "/.electron-cache",
    "/docs/",
    "/vendor/",
    "/tmp-",
    "/electron/",
    "/scripts/",
    "/resources/",
    "/out/",
  ];
  const pollutionHits = entries
    .filter((e) =>
      pollutionPrefixes.some(
        (prefix) => e === prefix.replace(/\/$/, "") || e.startsWith(prefix),
      ),
    )
    .slice(0, 20);

  // Residual official shell sometimes left at workspace root as index.js and was
  // historically allowlisted into asar. Product entry is .vite/build/index.pre.js.
  let rootIndexSize = 0;
  if (entrySet.has("/index.js")) {
    try {
      rootIndexSize = asar.extractFile(appAsarPath, "index.js").length;
    } catch {
      rootIndexSize = -1;
    }
  }
  const hasStrayRootIndex = entrySet.has("/index.js") && rootIndexSize > 100_000;
  if (hasStrayRootIndex) {
    pollutionHits.unshift(`/index.js(${rootIndexSize}B residual)`);
  }

  const hasNodeModules =
    entrySet.has("/node_modules") ||
    entries.some((e) => e.startsWith("/node_modules/"));
  // node-pty is the canary for original-runtime inject (mac align into asar).
  const hasNodePty =
    entrySet.has("/node_modules/node-pty/package.json") ||
    entries.some((e) => e.includes("/node_modules/node-pty/"));

  const cleanAsar = pollutionHits.length === 0 && !hasStrayRootIndex;

  const ok = Boolean(
    looksProduct &&
      !looksOfficialMonolith &&
      entrySet.has("/.vite/build/index.js") &&
      cleanAsar &&
      hasNodeModules &&
      hasNodePty,
  );

  let reason = null;
  if (!cleanAsar) {
    reason = `app.asar contains workspace pollution: ${pollutionHits.slice(0, 5).join(", ")}`;
  } else if (!looksProduct || looksOfficialMonolith) {
    reason = looksOfficialMonolith
      ? "official monolith still present"
      : "product main fingerprint missing (no chunks / product markers)";
  } else if (!hasNodeModules || !hasNodePty) {
    reason =
      "app.asar missing original-runtime node_modules (align must inject; win must rebuild asar too)";
  }

  return {
    exists: true,
    entryCount: entries.length,
    hasViteIndex: entrySet.has("/.vite/build/index.js"),
    hasVitePre: entrySet.has("/.vite/build/index.pre.js"),
    hasChunks,
    indexSize,
    rootIndexSize,
    hasStrayRootIndex,
    hasNodeModules,
    hasNodePty,
    productMarkerHits,
    looksOfficialMonolith,
    looksProduct,
    pollutionHits,
    cleanAsar,
    ok,
    reason,
  };
}

export function readIonBuildId(ionIndexPath) {
  if (!fs.existsSync(ionIndexPath)) return null;
  const html = fs.readFileSync(ionIndexPath, "utf8");
  return html.match(/data-build-id="([^"]+)"/)?.[1] ?? "unknown";
}

/**
 * Packaged dual-root residual check.
 * Product main prefers product-web; residual ion-dist keeps setup-desktop-3p SPA.
 * @param {{ productWebIndex: string, residualIonIndex?: string, ionIndex?: string }} targets
 */
export function inspectPackagedDualRoot(targets) {
  const productWebIndex = targets.productWebIndex;
  const residualIonIndex = targets.residualIonIndex ?? targets.ionIndex;
  const productBuildId = readIonBuildId(productWebIndex);
  const residualBuildId = readIonBuildId(residualIonIndex);
  const productOk =
    Boolean(productWebIndex && fs.existsSync(productWebIndex)) &&
    productBuildId != null &&
    productBuildId !== "spa-dev" &&
    productBuildId !== "unknown";
  const residualOk =
    Boolean(residualIonIndex && fs.existsSync(residualIonIndex));
  // Roots must be distinct directories so residual setup routes are not the product SPA.
  const productRoot = productWebIndex ? path.dirname(productWebIndex) : null;
  const residualRoot = residualIonIndex ? path.dirname(residualIonIndex) : null;
  const rootsDistinct =
    Boolean(productRoot && residualRoot) &&
    path.resolve(productRoot) !== path.resolve(residualRoot);
  // Residual should stay official spa (or at least not equal product build id).
  const residualIsNotProduct =
    residualOk &&
    productOk &&
    (residualBuildId === "spa-dev" || residualBuildId !== productBuildId);
  const ok = productOk && residualOk && rootsDistinct && residualIsNotProduct;
  let reason = null;
  if (!productOk) {
    reason = `product-web missing or still spa-dev (buildId=${productBuildId ?? "null"})`;
  } else if (!residualOk) {
    reason = "residual ion-dist/index.html missing (setup-desktop-3p needs official SPA)";
  } else if (!rootsDistinct) {
    reason = "product-web and residual ion-dist resolve to the same path";
  } else if (!residualIsNotProduct) {
    reason = `residual ion-dist looks like product (buildId=${residualBuildId}); keep official spa-dev for setup routes`;
  }
  return {
    ok,
    reason,
    productBuildId,
    residualBuildId,
    productOk,
    residualOk,
    rootsDistinct,
    residualIsNotProduct,
  };
}
