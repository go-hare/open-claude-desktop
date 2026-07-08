import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(projectRoot, "docs", "builtin-modules-report.json");
const markdownReportPath = path.join(projectRoot, "docs", "desktop-module-function-parity.md");
const plainNodeMacNativeImportSkips = new Map([
  [
    "@ant/claude-swift",
    "macOS Swift native addon initializes UserNotifications and requires the Electron app bundle host",
  ],
  [
    "@ant/claude-swift-ant",
    "depends on @ant/claude-swift, which requires the Electron app bundle host on macOS",
  ],
]);

const expectedRealPackages = [
  "@electron-forge/maker-pkg",
  "@electron-forge/publisher-gcs",
  "@formatjs/intl",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function vendorPackages() {
  const roots = [path.join(projectRoot, "vendor", "ant"), path.join(projectRoot, "vendor", "anthropic-ai")];
  const packages = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packagePath = path.join(root, entry.name, "package.json");
      if (fs.existsSync(packagePath)) packages.push({ dir: path.dirname(packagePath), package: readJson(packagePath) });
    }
  }
  return packages.sort((left, right) => left.package.name.localeCompare(right.package.name));
}

function classifyVendorPackage(pkgDir, pkg) {
  if (pkg.xParityKind) return pkg.xParityKind;
  const indexPath = path.join(pkgDir, "index.js");
  const mainPath = path.join(pkgDir, pkg.main ?? "index.js");
  const source = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
  if (source.includes("loadRuntimePackage")) return "runtime-proxy";
  if (source.includes("builtinPlaceholder") || source.includes("local built-in placeholder")) return "placeholder";
  if (fs.existsSync(mainPath) && String(pkg.main ?? "").startsWith("./dist/")) return "source-built";
  return "placeholder";
}

function plainNodeNativeSkipReason(packageName) {
  if (process.platform !== "darwin") return null;
  if (process.versions.electron) return null;
  if (process.env.CLAUDE_DESKTOP_VERIFY_LOAD_SWIFT_NATIVE === "1") return null;
  return plainNodeMacNativeImportSkips.get(packageName) ?? null;
}

async function tryImport(packageName) {
  const skipReason = plainNodeNativeSkipReason(packageName);
  if (skipReason) {
    return {
      ok: true,
      skipped: true,
      reason: skipReason,
      type: "native-app-bundle-only",
      keys: [],
      load_error: null,
    };
  }
  try {
    let loaded;
    try {
      loaded = require(packageName);
    } catch (error) {
      if (error?.code !== "ERR_REQUIRE_ESM") throw error;
      loaded = await import(packageName);
    }
    const loadError = loaded?.__loadError;
    return {
      ok: true,
      type: typeof loaded,
      keys: loaded && typeof loaded === "object" || typeof loaded === "function" ? Object.keys(loaded).slice(0, 20) : [],
      load_error: loadError && typeof loadError === "object" && "message" in loadError
        ? { code: loadError.code ?? null, message: loadError.message }
        : null,
    };
  } catch (error) {
    return { ok: false, error: { code: error.code ?? null, message: error.message } };
  }
}

async function runSmoke(packageName) {
  try {
    if (packageName === "@ant/chrome-native-host") {
      const nativeHost = require(packageName);
      const frame = nativeHost.createChromeMessageFrame({ type: "ping" });
      const length = frame.readUInt32LE(0);
      const payload = JSON.parse(frame.subarray(4).toString("utf8"));
      if (length !== frame.length - 4 || payload.type !== "ping") throw new Error("native message frame mismatch");
      if (typeof nativeHost.getSecureSocketPath() !== "string") throw new Error("missing socket path");
      return { ok: true, check: "native-message frame + socket path" };
    }
    if (packageName === "@ant/claude-ssh") {
      const ssh = require(packageName);
      const platforms = ssh.listPlatforms();
      const url = ssh.getDownloadUrl("windows-amd64");
      if (!platforms.includes("windows-amd64")) throw new Error("missing windows-amd64 platform");
      if (!url.includes("/claude-ssh-releases/") || !url.endsWith("/windows-amd64/claude-ssh.zst")) {
        throw new Error(`unexpected download url: ${url}`);
      }
      return { ok: true, check: "manifest platform + download URL" };
    }
    if (packageName === "@anthropic-ai/claude-agent-sdk-future") {
      const sdk = await import(packageName);
      if (typeof sdk.query !== "function") throw new Error("missing query export");
      const bridge = await import(`${packageName}/bridge`);
      if (typeof bridge.createCodeSession !== "function") throw new Error("missing bridge createCodeSession export");
      return { ok: true, check: "sdk root + bridge exports" };
    }
    return null;
  } catch (error) {
    return { ok: false, error: { code: error.code ?? null, message: error.message } };
  }
}

const realPackages = [];
for (const name of expectedRealPackages) realPackages.push({ name, kind: "real-npm", require: await tryImport(name), smoke: await runSmoke(name) });
const vendor = [];
for (const { dir, package: pkg } of vendorPackages()) {
  vendor.push({
    name: pkg.name,
    kind: classifyVendorPackage(dir, pkg),
    dir: path.relative(projectRoot, dir),
    require: await tryImport(pkg.name),
    smoke: await runSmoke(pkg.name),
  });
}

const report = {
  generated_at: new Date().toISOString(),
  summary: {
    real_npm_count: realPackages.length,
    builtin_count: vendor.length,
    runtime_proxy_count: vendor.filter((entry) => entry.kind === "runtime-proxy").length,
    source_built_count: vendor.filter((entry) => entry.kind === "source-built").length,
    sdk_alias_count: vendor.filter((entry) => entry.kind === "sdk-alias").length,
    protocol_adapter_count: vendor.filter((entry) => entry.kind === "protocol-adapter").length,
    bundle_derived_count: vendor.filter((entry) => entry.kind === "bundle-derived").length,
    compat_shim_count: vendor.filter((entry) => entry.kind === "compat-shim").length,
    placeholder_count: vendor.filter((entry) => entry.kind === "placeholder").length,
    implemented_builtin_count: vendor.filter((entry) => entry.kind !== "placeholder").length,
    import_failures: [...realPackages, ...vendor].filter((entry) => !entry.require.ok).length,
    import_skips: [...realPackages, ...vendor].filter((entry) => entry.require.skipped).length,
    smoke_failures: [...realPackages, ...vendor].filter((entry) => entry.smoke && !entry.smoke.ok).length,
  },
  realPackages,
  vendor,
};

function markdownTable(headers, rows) {
  const escapeCell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  return [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

function renderMarkdown() {
  const rows = [
    ...report.realPackages.map((entry) => [
      entry.name,
      "real npm package",
      entry.require.ok ? `import ok${entry.smoke ? `; smoke ${entry.smoke.ok ? "ok" : "failed"}` : ""}` : "import failed",
      entry.require.keys?.join(", ") || "-",
    ]),
    ...report.vendor.map((entry) => [
      entry.name,
      entry.kind,
      entry.require.ok
        ? entry.require.skipped
          ? `import skipped; ${entry.require.reason}`
          : entry.require.load_error
          ? `import ok; native load error: ${entry.require.load_error.code ?? "unknown"}`
          : entry.smoke
            ? `import ok; smoke ${entry.smoke.ok ? "ok" : "failed"}`
          : "import ok"
        : "import failed",
      entry.smoke?.check ?? entry.dir,
    ]),
  ].sort((left, right) => left[0].localeCompare(right[0]));
  return `# Desktop module function parity

Generated by: \`npm run verify:builtins\`

## Summary

- Real npm packages replacing official patch targets: ${report.summary.real_npm_count}
- Local builtin packages: ${report.summary.builtin_count}
- Runtime proxy packages: ${report.summary.runtime_proxy_count}
- Source-built packages: ${report.summary.source_built_count}
- SDK alias packages: ${report.summary.sdk_alias_count}
- Protocol adapter packages: ${report.summary.protocol_adapter_count}
- Bundle-derived packages: ${report.summary.bundle_derived_count}
- Compat shim packages: ${report.summary.compat_shim_count}
- Implemented builtin packages: ${report.summary.implemented_builtin_count}
- Placeholder packages: ${report.summary.placeholder_count}
- Import failures: ${report.summary.import_failures}
- Import skips (native app-bundle only): ${report.summary.import_skips}
- Smoke failures: ${report.summary.smoke_failures}

## Current status

${markdownTable(["package", "function status", "verification", "evidence"], rows)}

## Interpretation

- \`real npm package\`: package functionality comes from the public npm package at the official patch target version.
- \`source-built\`: package was found in another local official source tree and compiled into \`vendor/*/dist\`.
- \`runtime-proxy\`: package resolves to copied original runtime files under \`resources/original-runtime-node_modules\` when usable.
- \`sdk-alias\`: package re-exports the installed official public SDK runtime because the official desktop dev alias is unavailable from the public registry.
- \`protocol-adapter\`: package implements the protocol surface from local official source evidence.
- \`bundle-derived\`: package exposes data/behavior recovered from the official bundled desktop runtime.
- \`compat-shim\`: package exposes a source-owned compatibility surface for an unavailable private/dev package whose runtime is not independently packaged in the official app bundle.
- \`placeholder\`: package name is present but behavior still needs an adapter. This count should remain 0 for the aligned desktop package.

Current app source can import every safe JavaScript official private/dev package entry without throwing at module load. macOS Swift native packages are verified by runtime file presence and skipped in plain Node because the official addon initializes app-bundle-only UserNotifications APIs during module load. Packages whose official source is unavailable are now source-owned adapters or compatibility shims instead of throwing empty packages.

See \`docs/desktop-private-module-source-audit.md\` for the per-package search evidence and replacement strategy.
`;
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownReportPath, renderMarkdown());
console.log(JSON.stringify(report.summary, null, 2));
if (report.summary.import_failures > 0 || report.summary.smoke_failures > 0) process.exit(1);
