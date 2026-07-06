import asar from "@electron/asar";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.resolve(projectRoot, "../docs");
const originalAppCandidates = [
  process.env.CLAUDE_ORIGINAL_APP,
  process.env.CLAUDE_ORIGINAL_APP_CONTENTS ? path.dirname(process.env.CLAUDE_ORIGINAL_APP_CONTENTS) : undefined,
  path.resolve(projectRoot, "../../Claude-Deepseek.app"),
  "D:\\BaiduNetdiskDownload\\Claude code 汉化mac桌面版\\Claude-Deepseek\\Claude-Deepseek.app",
].filter(Boolean);
const originalApp = originalAppCandidates.find((candidate) => fsSync.existsSync(candidate)) ?? originalAppCandidates[0];
const packagedApp = path.join(projectRoot, "out/Claude-Deepseek-darwin-arm64/Claude-Deepseek.app");

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

const originalInfo = path.join(originalApp, "Contents/Info.plist");
const packagedInfo = path.join(packagedApp, "Contents/Info.plist");
const originalExecutable = path.join(originalApp, "Contents/MacOS/Claude");
const packagedExecutable = path.join(packagedApp, "Contents/MacOS/Claude");
const generatedExecutable = path.join(packagedApp, "Contents/MacOS/Claude-Deepseek");
const packagedAsar = path.join(packagedApp, "Contents/Resources/app.asar");
const originalAsar = path.join(originalApp, "Contents/Resources/app.asar");

const originalResources = await listTopLevel(path.join(originalApp, "Contents/Resources"));
const packagedResources = await listTopLevel(path.join(packagedApp, "Contents/Resources"));
const originalFrameworks = await listTopLevel(path.join(originalApp, "Contents/Frameworks"));
const packagedFrameworks = await listTopLevel(path.join(packagedApp, "Contents/Frameworks"));
const originalHelpers = await listTopLevel(path.join(originalApp, "Contents/Helpers"));
const packagedHelpers = await listTopLevel(path.join(packagedApp, "Contents/Helpers"));
const packagedElectronFrameworkSymlinks = await topLevelSymlinks(path.join(packagedApp, "Contents/Frameworks/Electron Framework.framework"));

const infoKeys = ["CFBundleExecutable", "CFBundleName", "CFBundleIdentifier", "CFBundleShortVersionString"];
const info = Object.fromEntries(infoKeys.map((key) => [key, {
  original: plistPrint(originalInfo, key),
  packaged: plistPrint(packagedInfo, key),
}]));

const packagedAsarHeaderHash = (await exists(packagedAsar)) ? asarHeaderSha256(packagedAsar) : null;
const plistAsarHash = plistPrint(packagedInfo, "ElectronAsarIntegrity:Resources/app.asar:hash");
const asarEntries = (await exists(packagedAsar))
  ? asar.listPackage(packagedAsar).map((entry) => `/${entry.replace(/\\/g, "/").replace(/^\/+/, "")}`)
  : [];
const asarEntrySet = new Set(asarEntries);
const unpackedRoot = path.join(packagedApp, "Contents/Resources/app.asar.unpacked");
const missingRuntimeAsarEntries = expectedRuntimeEntries.filter((entry) => !asarEntrySet.has(entry));
const missingRuntimeUnpackedEntries = [];
for (const entry of expectedUnpackedRuntimeEntries) {
  if (!(await exists(path.join(unpackedRoot, entry)))) missingRuntimeUnpackedEntries.push(entry);
}

const report = {
  generated_at: new Date().toISOString(),
  project_root: projectRoot,
  original_app: originalApp,
  packaged_app: packagedApp,
  executable: {
    original_exists: await exists(originalExecutable),
    packaged_exists: await exists(packagedExecutable),
    generated_deepseek_executable_exists: await exists(generatedExecutable),
    original_sha256: (await exists(originalExecutable)) ? await sha256(originalExecutable) : null,
    packaged_sha256: (await exists(packagedExecutable)) ? await sha256(packagedExecutable) : null,
  },
  info,
  resources: {
    original_top_level_count: originalResources.length,
    packaged_top_level_count: packagedResources.length,
    missing_original_resource_entries_except_app_asar: diffMissing(originalResources.filter((entry) => entry !== "app.asar"), packagedResources),
    extra_packaged_resource_entries: packagedResources.filter((entry) => !new Set(originalResources).has(entry)),
  },
  frameworks: {
    missing: diffMissing(originalFrameworks, packagedFrameworks),
    extra: packagedFrameworks.filter((entry) => !new Set(originalFrameworks).has(entry)),
  },
  helpers: {
    missing: diffMissing(originalHelpers, packagedHelpers),
    extra: packagedHelpers.filter((entry) => !new Set(originalHelpers).has(entry)),
  },
  symlinks: {
    packaged_electron_framework_top_level: packagedElectronFrameworkSymlinks,
    has_absolute_framework_symlink: packagedElectronFrameworkSymlinks.some((entry) => path.isAbsolute(entry.target)),
  },
  asar: {
    original_sha256: (await exists(originalAsar)) ? await sha256(originalAsar) : null,
    packaged_sha256: (await exists(packagedAsar)) ? await sha256(packagedAsar) : null,
    intentionally_rebuilt: true,
    packaged_header_sha256: packagedAsarHeaderHash,
    plist_integrity_hash: plistAsarHash,
    plist_integrity_matches_packaged_asar: packagedAsarHeaderHash !== null && plistAsarHash === packagedAsarHeaderHash,
    contains_smoke_user_data: asarEntries.some((entry) => entry.startsWith("/.smoke-user-data")),
    missing_runtime_node_modules_entries: missingRuntimeAsarEntries,
    missing_unpacked_runtime_entries: missingRuntimeUnpackedEntries,
  },
};

report.ok =
  report.executable.original_exists &&
  report.executable.packaged_exists &&
  !report.executable.generated_deepseek_executable_exists &&
  report.executable.original_sha256 === report.executable.packaged_sha256 &&
  Object.values(report.info).every((entry) => entry.original === entry.packaged) &&
  report.resources.missing_original_resource_entries_except_app_asar.length === 0 &&
  report.resources.extra_packaged_resource_entries.length === 0 &&
  report.frameworks.missing.length === 0 && report.frameworks.extra.length === 0 &&
  report.helpers.missing.length === 0 && report.helpers.extra.length === 0 &&
  !report.symlinks.has_absolute_framework_symlink &&
  report.asar.plist_integrity_matches_packaged_asar &&
  !report.asar.contains_smoke_user_data &&
  report.asar.missing_runtime_node_modules_entries.length === 0 &&
  report.asar.missing_unpacked_runtime_entries.length === 0;

await fs.mkdir(docsRoot, { recursive: true });
const jsonPath = path.join(docsRoot, "electron-packaged-bundle-alignment.json");
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
const markdown = `# Electron packaged bundle 对齐审计\n\n` +
  `生成时间：${report.generated_at}\n\n` +
  `## 结论\n\n` +
  `- Claude 二进制 hash 对齐：${report.executable.original_sha256 === report.executable.packaged_sha256 ? "是" : "否"}\n` +
  `- 生成的 Claude-Deepseek 二进制是否已移除：${!report.executable.generated_deepseek_executable_exists ? "是" : "否"}\n` +
  `- Info.plist 关键字段是否对齐原包：${Object.values(report.info).every((entry) => entry.original === entry.packaged) ? "是" : "否"}\n` +
  `- 原包 Resources 配套项缺失数（不含 app.asar）：${report.resources.missing_original_resource_entries_except_app_asar.length}\n` +
  `- Resources 额外项数：${report.resources.extra_packaged_resource_entries.length}\n` +
  `- Frameworks 缺失/额外：${report.frameworks.missing.length}/${report.frameworks.extra.length}\n` +
  `- Helpers 缺失/额外：${report.helpers.missing.length}/${report.helpers.extra.length}\n` +
  `- Electron Framework 是否存在绝对 symlink：${report.symlinks.has_absolute_framework_symlink ? "是" : "否"}\n` +
  `- app.asar integrity 是否已重算：${report.asar.plist_integrity_matches_packaged_asar ? "是" : "否"}\n` +
  `- app.asar runtime node_modules 缺失数：${report.asar.missing_runtime_node_modules_entries.length}\n` +
  `- app.asar.unpacked runtime 缺失数：${report.asar.missing_unpacked_runtime_entries.length}\n` +
  `- app.asar 是否误打入 smoke user data：${report.asar.contains_smoke_user_data ? "是" : "否"}\n` +
  `- 是否通过：${report.ok ? "是" : "否"}\n\n` +
  `说明：外层 macOS bundle、Claude 二进制、Frameworks、Helpers、Resources 配套资源对齐原包；app.asar 保留当前重建主进程，因此不是原包 app.asar 的 byte-for-byte hash。\n`;
const markdownPath = path.join(docsRoot, "electron-packaged-bundle-alignment.md");
await fs.writeFile(markdownPath, markdown);
console.log(path.relative(projectRoot, jsonPath));
console.log(path.relative(projectRoot, markdownPath));
console.log(JSON.stringify({ ok: report.ok, executable_hash_aligned: report.executable.original_sha256 === report.executable.packaged_sha256, missing_resources: report.resources.missing_original_resource_entries_except_app_asar.length, extra_resources: report.resources.extra_packaged_resource_entries.length, absolute_framework_symlink: report.symlinks.has_absolute_framework_symlink, asar_integrity_ok: report.asar.plist_integrity_matches_packaged_asar, missing_runtime_node_modules: report.asar.missing_runtime_node_modules_entries.length, missing_unpacked_runtime: report.asar.missing_unpacked_runtime_entries.length, contains_smoke_user_data: report.asar.contains_smoke_user_data }, null, 2));
if (!report.ok) process.exit(1);
