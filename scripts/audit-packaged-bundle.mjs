import asar from "@electron/asar";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./originalAppPaths.mjs";
import {
  inspectPackagedAsarMain,
  inspectPackagedDualRoot,
  OFFICIAL_BUNDLE_ID,
  PRODUCT_BUNDLE_ID,
  PRODUCT_NAME,
  resolvePackagedTargets,
} from "./packagePaths.mjs";

const projectRoot = getProjectRoot();
const docsRoot = path.join(projectRoot, "docs");
const darwinTargets = resolvePackagedTargets({ root: projectRoot, platform: "darwin" });
const winTargets = resolvePackagedTargets({ root: projectRoot, platform: "win32" });
const packagedApp = darwinTargets.packagedRoot;

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function listTopLevel(dir) {
  if (!(await exists(dir))) return [];
  return (await fs.readdir(dir)).sort();
}

async function topLevelSymlinks(dir) {
  const out = [];
  if (!(await exists(dir))) return out;
  for (const name of await fs.readdir(dir)) {
    const target = path.join(dir, name);
    const stat = await fs.lstat(target);
    if (!stat.isSymbolicLink()) continue;
    out.push({ name, target: await fs.readlink(target) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function asarHeaderSha256(asarPath) {
  const { headerString } = asar.getRawHeader(asarPath);
  return crypto.createHash("sha256").update(headerString).digest("hex");
}

function plistPrint(infoPlist, key) {
  try {
    return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, infoPlist], { encoding: "utf8" }).trim();
  } catch {
    try {
      const source = fsSync.readFileSync(infoPlist, "utf8");
      if (key === "ElectronAsarIntegrity:Resources/app.asar:hash") {
        return source.match(/<key>ElectronAsarIntegrity<\/key>[\s\S]*?<key>Resources\/app\.asar<\/key>[\s\S]*?<key>hash<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
      }
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return source.match(new RegExp(`<key>${escaped}</key>\\s*<string>([^<]+)</string>`))?.[1] ?? null;
    } catch {
      return null;
    }
  }
}

function diffMissing(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((item) => !actualSet.has(item));
}

const expectedRuntimeEntries = [
  "/node_modules/node-pty/lib/index.js",
  "/node_modules/node-pty/build/Release/pty.node",
  "/node_modules/node-pty/build/Release/spawn-helper",
  "/node_modules/ws/index.js",
  "/node_modules/@ant/claude-native/index.js",
  "/node_modules/@ant/claude-native/claude-native-binding.node",
  "/node_modules/@ant/claude-swift/js/index.js",
  "/node_modules/@ant/claude-swift/build/Release/swift_addon.node",
  "/node_modules/@ant/claude-swift/build/Release/computer_use.node",
];

const expectedUnpackedRuntimeEntries = [
  "node_modules/@ant/claude-native/claude-native-binding.node",
  "node_modules/@ant/claude-swift/build/Release/computer_use.node",
  "node_modules/@ant/claude-swift/build/Release/swift_addon.node",
  "node_modules/node-pty/build/Release/pty.node",
  "node_modules/node-pty/build/Release/spawn-helper",
];

const packagedWinRoot = winTargets.packagedRoot;
if (!(await exists(packagedApp)) && (await exists(packagedWinRoot))) {
  const winResources = winTargets.resourcesRoot;
  const winAsar = winTargets.appAsar;
  const winExe = winTargets.binary;
  const winRuntimeRoot = path.join(winResources, "original-runtime-node_modules", "node_modules");
  const winClaudeCodeBinary = winTargets.claudeCodeBinary;
  const winClaudeCodeManifest = path.join(winResources, "claude-code-bin", "manifest.json");
  const winDualRoot = inspectPackagedDualRoot(winTargets);
  const winProductBuildId = winDualRoot.productBuildId;
  const winResidualBuildId = winDualRoot.residualBuildId;
  // Required on Windows hosts. Darwin-only native bits (swift_addon / computer_use)
  // are optional — may be JS shims only depending on copy:original-runtime.
  const winRuntimeRequired = [
    "node-pty/package.json",
    "node-pty/build/Release/conpty.node",
    "node-pty/build/Release/conpty_console_list.node",
    "node-pty/build/Release/pty.node",
    "ws/index.js",
    "@ant/claude-native/index.js",
    "@ant/cowork-win32-service/index.js",
    "@ant/utils/index.js",
  ];
  const winRuntimeOptional = [
    "@ant/chrome-native-host/index.js",
    "@ant/claude-for-chrome-mcp/dist/index.js",
    "@ant/claude-native/claude-native-binding.node",
    "@ant/claude-screen-app/index.js",
    "@ant/claude-ssh/index.js",
    "@ant/claude-swift/js/index.js",
    "@ant/claude-swift/build/Release/swift_addon.node",
    "@ant/claude-swift/build/Release/computer_use.node",
    "@ant/claude-swift-ant/index.js",
    "@ant/computer-use-mcp/dist/index.js",
    "@ant/disclaimer/index.js",
    "@ant/dxt-registry/index.js",
    "@ant/imagine-server/index.js",
    "@ant/ipc-codegen/index.js",
    "@ant/rfb-client/index.js",
    "@anthropic-ai/claude-agent-sdk-future/index.js",
    "@anthropic-ai/conway-client/index.js",
    "@anthropic-ai/electron-devtools-mcp/index.js",
  ];
  const missingRequiredRuntime = winRuntimeRequired.filter(
    (entry) => !fsSync.existsSync(path.join(winRuntimeRoot, entry)),
  );
  const missingOptionalRuntime = winRuntimeOptional.filter(
    (entry) => !fsSync.existsSync(path.join(winRuntimeRoot, entry)),
  );
  const winAsarEntries = (await exists(winAsar))
    ? asar.listPackage(winAsar).map((entry) => `/${entry.replace(/\\/g, "/").replace(/^\/+/, "")}`)
    : [];
  const winAsarSet = new Set(winAsarEntries);
  const winAsarMain = inspectPackagedAsarMain(winAsar, asar);
  const report = {
    generated_at: new Date().toISOString(),
    project_root: projectRoot,
    platform: "win32",
    packaged_root: packagedWinRoot,
    executable: {
      exists: await exists(winExe),
      sha256: (await exists(winExe)) ? await sha256(winExe) : null,
    },
    resources: {
      app_asar_exists: await exists(winAsar),
      product_web_exists: await exists(path.join(winResources, "product-web/index.html")),
      product_web_build_id: winProductBuildId,
      ion_dist_exists: await exists(path.join(winResources, "ion-dist")),
      residual_ion_dist_build_id: winResidualBuildId,
      dual_root: winDualRoot,
      dual_root_ok: winDualRoot.ok,
      original_runtime_exists: await exists(path.join(winResources, "original-runtime-node_modules")),
      claude_code_binary_exists: await exists(winClaudeCodeBinary),
      claude_code_binary_size: (await exists(winClaudeCodeBinary)) ? fsSync.statSync(winClaudeCodeBinary).size : 0,
      claude_code_binary_sha256: (await exists(winClaudeCodeBinary)) ? await sha256(winClaudeCodeBinary) : null,
      claude_code_manifest_exists: await exists(winClaudeCodeManifest),
      missing_original_runtime_entries: missingRequiredRuntime,
      missing_optional_runtime_entries: missingOptionalRuntime,
    },
    asar: {
      entry_count: winAsarEntries.length,
      contains_vite_index: winAsarSet.has("/.vite/build/index.js"),
      contains_vite_preload: winAsarSet.has("/.vite/build/mainView.js") && winAsarSet.has("/.vite/build/mainWindow.js"),
      contains_package_json: winAsarSet.has("/package.json"),
      contains_smoke_user_data: winAsarEntries.some((entry) => entry.startsWith("/.smoke-user-data")),
      product_main: winAsarMain,
    },
  };
  report.ok =
    report.executable.exists &&
    report.resources.app_asar_exists &&
    report.resources.product_web_exists &&
    report.resources.ion_dist_exists &&
    report.resources.dual_root_ok &&
    report.resources.original_runtime_exists &&
    report.resources.claude_code_binary_exists &&
    report.resources.claude_code_binary_size > 0 &&
    report.resources.claude_code_manifest_exists &&
    report.resources.missing_original_runtime_entries.length === 0 &&
    report.asar.contains_vite_index &&
    report.asar.contains_vite_preload &&
    report.asar.contains_package_json &&
    !report.asar.contains_smoke_user_data &&
    report.asar.product_main.ok;

  await fs.mkdir(docsRoot, { recursive: true });
  const jsonPath = path.join(docsRoot, "electron-packaged-bundle-alignment.json");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const markdown = `# Electron packaged bundle 对齐审计\n\n` +
    `生成时间：${report.generated_at}\n\n` +
    `## Windows packaged 结论\n\n` +
    `- exe 存在：${report.executable.exists ? "是" : "否"}\n` +
    `- app.asar 存在：${report.resources.app_asar_exists ? "是" : "否"}\n` +
    `- product-web 存在：${report.resources.product_web_exists ? "是" : "否"}\n` +
    `- product-web data-build-id：${report.resources.product_web_build_id ?? "missing"}（禁止 spa-dev）\n` +
    `- residual ion-dist 存在：${report.resources.ion_dist_exists ? "是" : "否"}\n` +
    `- residual ion-dist data-build-id：${report.resources.residual_ion_dist_build_id ?? "missing"}\n` +
    `- dual-root 通过：${report.resources.dual_root_ok ? "是" : "否"}（${report.resources.dual_root?.reason ?? "ok"}）\n` +
    `- 产品 main 指纹：${report.asar.product_main.ok ? "是" : "否"}（${report.asar.product_main.reason ?? "ok"}）\n` +
    `- original-runtime-node_modules 存在：${report.resources.original_runtime_exists ? "是" : "否"}\n` +
    `- Claude Code binary 存在：${report.resources.claude_code_binary_exists ? "是" : "否"}\n` +
    `- Claude Code binary 大小：${report.resources.claude_code_binary_size}\n` +
    `- Claude Code manifest 存在：${report.resources.claude_code_manifest_exists ? "是" : "否"}\n` +
    `- runtime 必选缺失数：${report.resources.missing_original_runtime_entries.length}\n` +
    `- runtime 可选缺失数：${report.resources.missing_optional_runtime_entries.length}\n` +
    `- app.asar 含 .vite 主入口：${report.asar.contains_vite_index ? "是" : "否"}\n` +
    `- app.asar 含 preload：${report.asar.contains_vite_preload ? "是" : "否"}\n` +
    `- app.asar 是否误打入 smoke user data：${report.asar.contains_smoke_user_data ? "是" : "否"}\n` +
    `- 是否通过：${report.ok ? "是" : "否"}\n\n` +
    `说明：Windows package 在 win32 主机生成；加载 \`app://\` dual-root → \`resources/product-web\` 主 SPA + \`resources/ion-dist\` residual（setup-desktop-3p）。macOS 外层 residual 对齐仅在 darwin .app 产物存在时审计。\n`;
  const markdownPath = path.join(docsRoot, "electron-packaged-bundle-alignment.md");
  await fs.writeFile(markdownPath, markdown);
  console.log(path.relative(projectRoot, jsonPath));
  console.log(path.relative(projectRoot, markdownPath));
  console.log(JSON.stringify({
    ok: report.ok,
    platform: report.platform,
    product_web_build_id: report.resources.product_web_build_id,
    residual_ion_dist_build_id: report.resources.residual_ion_dist_build_id,
    dual_root_ok: report.resources.dual_root_ok,
    product_main_ok: report.asar.product_main.ok,
    runtime_missing: report.resources.missing_original_runtime_entries.length,
    runtime_optional_missing: report.resources.missing_optional_runtime_entries.length,
    claude_code_binary_exists: report.resources.claude_code_binary_exists,
    claude_code_binary_size: report.resources.claude_code_binary_size,
    contains_vite_index: report.asar.contains_vite_index,
    contains_vite_preload: report.asar.contains_vite_preload,
  }, null, 2));
  if (!report.ok) process.exit(1);
  process.exit(0);
}

/**
 * darwin audit — own forge Electron shell (same model as win32).
 * Does NOT require official MacOS/Claude binary hash or Frameworks/Helpers ditto parity.
 */
const packagedInfo = path.join(packagedApp, "Contents/Info.plist");
const packagedExecutable = path.join(packagedApp, "Contents/MacOS", PRODUCT_NAME);
const residualClaudeExecutable = path.join(packagedApp, "Contents/MacOS/Claude");
const packagedAsar = path.join(packagedApp, "Contents/Resources/app.asar");
const packagedResourcesList = await listTopLevel(path.join(packagedApp, "Contents/Resources"));
const packagedFrameworks = await listTopLevel(path.join(packagedApp, "Contents/Frameworks"));
const packagedElectronFrameworkSymlinks = await topLevelSymlinks(
  path.join(packagedApp, "Contents/Frameworks/Electron Framework.framework"),
);
const helpersChrome = path.join(packagedApp, "Contents/Helpers/chrome-native-host");
const helpersDisclaimer = path.join(packagedApp, "Contents/Helpers/disclaimer");
const smolHost = path.join(
  packagedApp,
  "Contents/Resources",
  process.arch === "arm64" ? "smol-bin.arm64.img" : "smol-bin.x64.img",
);
const localeEnUs = path.join(packagedApp, "Contents/Resources/en-US.json");

const info = {
  CFBundleExecutable: { packaged: plistPrint(packagedInfo, "CFBundleExecutable") },
  CFBundleName: { packaged: plistPrint(packagedInfo, "CFBundleName") },
  CFBundleIdentifier: { packaged: plistPrint(packagedInfo, "CFBundleIdentifier") },
  CFBundleDisplayName: { packaged: plistPrint(packagedInfo, "CFBundleDisplayName") },
  CFBundleDocumentTypes: { packaged: plistPrint(packagedInfo, "CFBundleDocumentTypes") },
  CFBundleURLTypes: { packaged: plistPrint(packagedInfo, "CFBundleURLTypes") },
};

// Own shell: executable + CFBundleName = Claudex (forge Helper lookup).
const productIdentityOk =
  info.CFBundleIdentifier.packaged === PRODUCT_BUNDLE_ID &&
  info.CFBundleIdentifier.packaged !== OFFICIAL_BUNDLE_ID &&
  info.CFBundleName.packaged === PRODUCT_NAME &&
  info.CFBundleExecutable.packaged === PRODUCT_NAME;

// Document / URL residual present (PlistBuddy prints Array for dict arrays).
const documentTypesOk =
  info.CFBundleDocumentTypes.packaged != null &&
  String(info.CFBundleDocumentTypes.packaged).length > 0;
const urlTypesOk =
  info.CFBundleURLTypes.packaged != null &&
  String(info.CFBundleURLTypes.packaged).length > 0;

const packagedAsarHeaderHash = (await exists(packagedAsar)) ? asarHeaderSha256(packagedAsar) : null;
const plistAsarHash = plistPrint(packagedInfo, "ElectronAsarIntegrity:Resources/app.asar:hash");
const asarEntries = (await exists(packagedAsar))
  ? asar.listPackage(packagedAsar).map((entry) => `/${entry.replace(/\\/g, "/").replace(/^\/+/, "")}`)
  : [];
const asarEntrySet = new Set(asarEntries);
const asarProductMain = inspectPackagedAsarMain(packagedAsar, asar);
const unpackedRoot = path.join(packagedApp, "Contents/Resources/app.asar.unpacked");
const missingRuntimeAsarEntries = expectedRuntimeEntries.filter((entry) => !asarEntrySet.has(entry));
const missingRuntimeUnpackedEntries = [];
for (const entry of expectedUnpackedRuntimeEntries) {
  if (!(await exists(path.join(unpackedRoot, entry)))) missingRuntimeUnpackedEntries.push(entry);
}

const dualRoot = inspectPackagedDualRoot(darwinTargets);
const dualRootOk = Boolean(dualRoot?.ok);

const report = {
  generated_at: new Date().toISOString(),
  project_root: projectRoot,
  shell_model: "own-forge-electron",
  packaged_app: packagedApp,
  executable: {
    path: `Contents/MacOS/${PRODUCT_NAME}`,
    packaged_exists: await exists(packagedExecutable),
    residual_claude_overlay_present: await exists(residualClaudeExecutable),
    packaged_sha256: (await exists(packagedExecutable)) ? await sha256(packagedExecutable) : null,
  },
  info,
  resources: {
    packaged_top_level_count: packagedResourcesList.length,
    product_web_exists: await exists(
      path.join(packagedApp, "Contents/Resources/product-web/index.html"),
    ),
    residual_ion_dist_exists: await exists(
      path.join(packagedApp, "Contents/Resources/ion-dist/index.html"),
    ),
    smol_bin_host_exists: await exists(smolHost),
    locale_en_us_exists: await exists(localeEnUs),
    dual_root: dualRoot,
    dual_root_ok: dualRootOk,
  },
  residual_helpers: {
    chrome_native_host: await exists(helpersChrome),
    disclaimer: await exists(helpersDisclaimer),
  },
  frameworks: {
    top_level: packagedFrameworks,
    // Forge Electron always ships Electron Framework; *Helper*.app under Frameworks.
    has_electron_framework: packagedFrameworks.includes("Electron Framework.framework"),
  },
  symlinks: {
    packaged_electron_framework_top_level: packagedElectronFrameworkSymlinks,
    has_absolute_framework_symlink: packagedElectronFrameworkSymlinks.some((entry) =>
      path.isAbsolute(entry.target),
    ),
  },
  asar: {
    packaged_sha256: (await exists(packagedAsar)) ? await sha256(packagedAsar) : null,
    packaged_header_sha256: packagedAsarHeaderHash,
    plist_integrity_hash: plistAsarHash,
    // Integrity bag optional on pure forge shells; if present must match.
    plist_integrity_matches_packaged_asar:
      plistAsarHash == null ||
      (packagedAsarHeaderHash !== null && plistAsarHash === packagedAsarHeaderHash),
    contains_smoke_user_data: asarEntries.some((entry) => entry.startsWith("/.smoke-user-data")),
    missing_runtime_node_modules_entries: missingRuntimeAsarEntries,
    missing_unpacked_runtime_entries: missingRuntimeUnpackedEntries,
    product_main: asarProductMain,
  },
};

const codesignDv = spawnSync(
  "/usr/bin/codesign",
  ["-dv", "--verbose=2", packagedApp],
  { encoding: "utf8" },
);
const codesignId =
  `${codesignDv.stderr ?? ""}${codesignDv.stdout ?? ""}`.match(
    /^Identifier=(.+)$/m,
  )?.[1]?.trim() ?? null;
const codesignIdentityOk =
  codesignId === PRODUCT_BUNDLE_ID && codesignId !== OFFICIAL_BUNDLE_ID;

report.product_identity = {
  expected_bundle_id: PRODUCT_BUNDLE_ID,
  expected_name: PRODUCT_NAME,
  official_bundle_id: OFFICIAL_BUNDLE_ID,
  product_identity_ok: productIdentityOk,
  codesign_identifier: codesignId,
  codesign_identity_ok: codesignIdentityOk,
};

const executableOk =
  report.executable.packaged_exists &&
  !report.executable.residual_claude_overlay_present;

const residualHelpersOk =
  report.residual_helpers.chrome_native_host && report.residual_helpers.disclaimer;

report.ok =
  executableOk &&
  productIdentityOk &&
  codesignIdentityOk &&
  dualRootOk &&
  documentTypesOk &&
  urlTypesOk &&
  residualHelpersOk &&
  report.resources.product_web_exists &&
  report.resources.residual_ion_dist_exists &&
  report.resources.smol_bin_host_exists &&
  report.resources.locale_en_us_exists &&
  report.frameworks.has_electron_framework &&
  !report.symlinks.has_absolute_framework_symlink &&
  report.asar.plist_integrity_matches_packaged_asar &&
  !report.asar.contains_smoke_user_data &&
  report.asar.missing_runtime_node_modules_entries.length === 0 &&
  report.asar.missing_unpacked_runtime_entries.length === 0 &&
  report.asar.product_main.ok;

await fs.mkdir(docsRoot, { recursive: true });
const jsonPath = path.join(docsRoot, "electron-packaged-bundle-alignment.json");
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
const markdown =
  `# Electron packaged bundle 对齐审计\n\n` +
  `生成时间：${report.generated_at}\n\n` +
  `## 结论（own forge Electron shell）\n\n` +
  `- 壳模型：${report.shell_model}\n` +
  `- 产品二进制 Contents/MacOS/${PRODUCT_NAME} 存在：${report.executable.packaged_exists ? "是" : "否"}\n` +
  `- 是否残留官方 MacOS/Claude 覆盖：${report.executable.residual_claude_overlay_present ? "是（失败）" : "否"}\n` +
  `- 产品身份（Bundle ID / Name / Executable）：${productIdentityOk ? "是" : "否"}\n` +
  `- codesign Identifier 是否为产品 ID：${codesignIdentityOk ? "是" : "否"}（${codesignId}）\n` +
  `- 产品 Bundle ID：${info.CFBundleIdentifier.packaged}（期望 ${PRODUCT_BUNDLE_ID}）\n` +
  `- CFBundleDocumentTypes 残差：${documentTypesOk ? "是" : "否"}\n` +
  `- CFBundleURLTypes 残差：${urlTypesOk ? "是" : "否"}\n` +
  `- Helpers/chrome-native-host：${report.residual_helpers.chrome_native_host ? "是" : "否"}\n` +
  `- Helpers/disclaimer：${report.residual_helpers.disclaimer ? "是" : "否"}\n` +
  `- smol-bin host：${report.resources.smol_bin_host_exists ? "是" : "否"}\n` +
  `- locale en-US.json：${report.resources.locale_en_us_exists ? "是" : "否"}\n` +
  `- Electron Framework 存在：${report.frameworks.has_electron_framework ? "是" : "否"}\n` +
  `- Electron Framework 是否存在绝对 symlink：${report.symlinks.has_absolute_framework_symlink ? "是" : "否"}\n` +
  `- app.asar integrity：${report.asar.plist_integrity_matches_packaged_asar ? "是" : "否"}\n` +
  `- app.asar 产品 main 指纹：${report.asar.product_main.ok ? "是" : "否"}（${report.asar.product_main.reason ?? "ok"} index=${report.asar.product_main.indexSize ?? 0} chunks=${report.asar.product_main.hasChunks}）\n` +
  `- app.asar runtime node_modules 缺失数：${report.asar.missing_runtime_node_modules_entries.length}\n` +
  `- app.asar.unpacked runtime 缺失数：${report.asar.missing_unpacked_runtime_entries.length}\n` +
  `- product-web 存在：${report.resources.product_web_exists ? "是" : "否"}（build-id=${report.resources.dual_root?.productBuildId ?? "null"}）\n` +
  `- residual ion-dist 存在：${report.resources.residual_ion_dist_exists ? "是" : "否"}（build-id=${report.resources.dual_root?.residualBuildId ?? "null"}）\n` +
  `- dual-root 通过：${dualRootOk ? "是" : "否"}（${report.resources.dual_root?.reason ?? "ok"}）\n` +
  `- 是否通过：${report.ok ? "是" : "否"}\n\n` +
  `说明：壳与 web 一样是我们写的产品代码 + forge Electron 运行时；选择性注入官方 residual Helpers（chrome-native-host/disclaimer）、smol-bin、locale JSON、document/URL types。不做官方 Claude.app MacOS/Frameworks 整段覆盖。CFBundleIdentifier/Name/Executable 为产品身份（Claudex）；app.asar 必须是产品 main；Resources dual-root：product-web 主 SPA + residual ion-dist（setup-desktop-3p）。\n`;
const markdownPath = path.join(docsRoot, "electron-packaged-bundle-alignment.md");
await fs.writeFile(markdownPath, markdown);
console.log(path.relative(projectRoot, jsonPath));
console.log(path.relative(projectRoot, markdownPath));
console.log(
  JSON.stringify(
    {
      ok: report.ok,
      shell_model: report.shell_model,
      product_identity_ok: productIdentityOk,
      product_main_ok: report.asar.product_main.ok,
      dual_root_ok: dualRootOk,
      document_types_ok: documentTypesOk,
      url_types_ok: urlTypesOk,
      helpers_ok: residualHelpersOk,
      smol_bin_ok: report.resources.smol_bin_host_exists,
      locale_en_us_ok: report.resources.locale_en_us_exists,
      product_web_build_id: report.resources.dual_root?.productBuildId ?? null,
      residual_ion_dist_build_id: report.resources.dual_root?.residualBuildId ?? null,
      codesign_identity_ok: codesignIdentityOk,
      codesign_identifier: codesignId,
      product_bundle_id: info.CFBundleIdentifier.packaged,
      residual_claude_overlay: report.executable.residual_claude_overlay_present,
      absolute_framework_symlink: report.symlinks.has_absolute_framework_symlink,
      asar_integrity_ok: report.asar.plist_integrity_matches_packaged_asar,
      missing_runtime_node_modules: report.asar.missing_runtime_node_modules_entries.length,
      missing_unpacked_runtime: report.asar.missing_unpacked_runtime_entries.length,
      contains_smoke_user_data: report.asar.contains_smoke_user_data,
    },
    null,
    2,
  ),
);
if (!report.ok) process.exit(1);
