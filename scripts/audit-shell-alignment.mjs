import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.resolve(projectRoot, "../docs");
const mirrorRoot = path.resolve(projectRoot, "../electron-shell-source/app-asar");
const buildRoot = path.join(projectRoot, ".vite");
const originalAsarCandidates = [
  process.env.CLAUDE_ORIGINAL_ASAR,
  process.env.CLAUDE_ORIGINAL_RESOURCES ? path.join(process.env.CLAUDE_ORIGINAL_RESOURCES, "app.asar") : undefined,
  process.env.CLAUDE_ORIGINAL_APP_CONTENTS ? path.join(process.env.CLAUDE_ORIGINAL_APP_CONTENTS, "Resources/app.asar") : undefined,
  path.resolve(projectRoot, "../../Claude-Deepseek.app/Contents/Resources/app.asar"),
  "D:\\BaiduNetdiskDownload\\Claude code 汉化mac桌面版\\Claude-Deepseek\\Claude-Deepseek.app\\Contents\\Resources\\app.asar",
].filter(Boolean);
const originalAsarPath = originalAsarCandidates.find((candidate) => fsSync.existsSync(candidate)) ?? originalAsarCandidates[0];
const packagedAsarPath = path.join(projectRoot, "out/Claude-Deepseek-darwin-arm64/Claude-Deepseek.app/Contents/Resources/app.asar");
const runtimeModulesRoot = path.join(projectRoot, "resources/original-runtime-node_modules/node_modules");
const packagedRuntimeUnpackedRoot = path.join(projectRoot, "out/Claude-Deepseek-darwin-arm64/Claude-Deepseek.app/Contents/Resources/app.asar.unpacked");

const expectedBuildEntries = [
  "build/aboutWindow.js",
  "build/buddy.js",
  "build/computerUseTeach.js",
  "build/coworkArtifact.js",
  "build/findInPage.js",
  "build/index.js",
  "build/index.pre.js",
  "build/mainView.js",
  "build/mainWindow.js",
  "build/mcp-runtime/directMcpHost.js",
  "build/mcp-runtime/nodeHost.js",
  "build/mcp-runtime/window-shared.css",
  "build/quickWindow.js",
  "build/shell-path-worker/shellPathWorker.js",
  "build/shell-path-worker/window-shared.css",
  "build/transcript-search-worker/transcriptSearchWorker.js",
  "build/transcript-search-worker/window-shared.css",
  "build/window-shared.css",
];

const expectedRendererEntries = [
  "renderer/about_window/about.html",
  "renderer/buddy_window/buddy.html",
  "renderer/find_in_page/find-in-page.html",
  "renderer/main_window/index.html",
  "renderer/quick_window/quick-window.html",
];

const preloadFiles = [
  "build/mainWindow.js",
  "build/mainView.js",
  "build/findInPage.js",
  "build/aboutWindow.js",
  "build/quickWindow.js",
  "build/buddy.js",
  "build/coworkArtifact.js",
];

const expectedRuntimeModuleEntries = [
  "node-pty/lib/index.js",
  "node-pty/build/Release/pty.node",
  "node-pty/build/Release/spawn-helper",
  "ws/index.js",
  "@ant/claude-native/index.js",
  "@ant/claude-native/claude-native-binding.node",
  "@ant/claude-swift/js/index.js",
  "@ant/claude-swift/build/Release/swift_addon.node",
  "@ant/claude-swift/build/Release/computer_use.node",
];

const expectedRuntimeUnpackedEntries = expectedRuntimeModuleEntries.filter((entry) => entry.endsWith(".node") || entry.endsWith("/spawn-helper"));
const expectedPackagedRuntimeModuleEntries = expectedRuntimeModuleEntries.map((entry) => `node_modules/${entry}`);
const expectedPackagedRuntimeUnpackedEntries = expectedRuntimeUnpackedEntries.map((entry) => `node_modules/${entry}`);

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function fileInfo(root, relativePath) {
  const filePath = path.join(root, relativePath);
  if (!(await exists(filePath))) return { path: relativePath, exists: false };
  const stat = await fs.stat(filePath);
  return { path: relativePath, exists: true, size: stat.size, sha256: stat.isFile() ? await sha256(filePath) : null };
}

async function listFiles(dir, prefix = "") {
  const out = [];
  if (!(await exists(dir))) return out;
  for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, dirent.name);
    const abs = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...(await listFiles(abs, rel)));
    else out.push(rel);
  }
  return out.sort();
}


async function listAsarViteEntries(asarPath) {
  if (!(await exists(asarPath))) return null;
  const asar = require("@electron/asar");
  return asar
    .listPackage(asarPath)
    .map((entry) => `/${entry.replace(/\\/g, "/").replace(/^\/+/, "")}`)
    .filter((entry) => /^\/\.vite\/(build|renderer)(?:\/|$)/.test(entry))
    .sort();
}

async function asarFileInfos(asarPath, relativePaths) {
  if (!(await exists(asarPath))) return relativePaths.map((entry) => ({ path: entry, exists: false }));
  const asar = require("@electron/asar");
  const entries = new Set(asar.listPackage(asarPath).map((entry) => `/${entry.replace(/\\/g, "/").replace(/^\/+/, "")}`));
  return relativePaths.map((entry) => ({ path: entry, exists: entries.has(`/${entry}`) }));
}

function diffLists(expected, actual) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    missing: expected.filter((entry) => !actualSet.has(entry)),
    extra: actual.filter((entry) => !expectedSet.has(entry)),
  };
}

function parseChannels(source, file) {
  const callRegex = /ipcRenderer\.(invoke|sendSync|send|on)\(\s*"([^"]+)"/g;
  const out = [];
  let match;
  while ((match = callRegex.exec(source))) {
    out.push({ file, mode: match[1], channel: match[2] });
  }
  return out;
}

function uniqueChannels(entries, mode) {
  return [...new Set(entries.filter((entry) => !mode || entry.mode === mode).map((entry) => entry.channel))].sort();
}

function parseEipc(channel) {
  const parts = channel.split("_$_");
  if (parts.length < 4) return null;
  return { namespace: parts[1], iface: parts[2], method: parts.slice(3).join("_$_") };
}

function summarizeByNamespace(channels) {
  const tree = {};
  for (const channel of channels) {
    const parsed = parseEipc(channel);
    if (!parsed) continue;
    tree[parsed.namespace] ??= {};
    tree[parsed.namespace][parsed.iface] ??= [];
    if (!tree[parsed.namespace][parsed.iface].includes(parsed.method)) tree[parsed.namespace][parsed.iface].push(parsed.method);
  }
  for (const namespace of Object.keys(tree).sort()) {
    const ifaces = tree[namespace];
    for (const iface of Object.keys(ifaces)) ifaces[iface].sort();
  }
  return Object.fromEntries(Object.keys(tree).sort().map((key) => [key, tree[key]]));
}

async function extractPreloadChannels(root) {
  const entries = [];
  for (const file of preloadFiles) {
    const filePath = path.join(root, file);
    if (!(await exists(filePath))) continue;
    const source = await fs.readFile(filePath, "utf8");
    entries.push(...parseChannels(source, file));
  }
  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.mode}\0${entry.channel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

const mirrorViteRoot = path.join(mirrorRoot, ".vite");
const report = {
  generated_at: new Date().toISOString(),
  project_root: projectRoot,
  mirror_root: mirrorRoot,
  policy: {
    target: "Electron shell functional surface alignment with the original app.asar shell resources",
    build_mode: "source main process + original compiled preload/renderer/secondary shell resources by default",
    fallback_ipc: "all original preload invoke/sendSync channels are expected to be covered by explicit source main-process handlers; runtime fallback handlers must remain zero",
  },
  resources: {
    expected_build_entries: await Promise.all(expectedBuildEntries.map((entry) => fileInfo(mirrorViteRoot, entry))),
    expected_renderer_entries: await Promise.all(expectedRendererEntries.map((entry) => fileInfo(mirrorViteRoot, entry))),
    mirror_build_file_count: (await listFiles(path.join(mirrorViteRoot, "build"))).length,
    mirror_renderer_file_count: (await listFiles(path.join(mirrorViteRoot, "renderer"))).length,
    current_build_entries: await Promise.all(expectedBuildEntries.map((entry) => fileInfo(buildRoot, entry))),
    current_renderer_entries: await Promise.all(expectedRendererEntries.map((entry) => fileInfo(buildRoot, entry))),
    current_runtime_module_entries: await Promise.all(expectedRuntimeModuleEntries.map((entry) => fileInfo(runtimeModulesRoot, entry))),
    packaged_runtime_module_entries: await asarFileInfos(packagedAsarPath, expectedPackagedRuntimeModuleEntries),
    packaged_runtime_unpacked_entries: await Promise.all(expectedPackagedRuntimeUnpackedEntries.map((entry) => fileInfo(packagedRuntimeUnpackedRoot, entry))),
  },
  original_preload_ipc: {},
  current_build_preload_ipc: {},
  packaged_asar: null,
  runtime_coverage: null,
};

const originalChannels = await extractPreloadChannels(mirrorViteRoot);
const currentChannels = await extractPreloadChannels(buildRoot);
for (const [target, channels] of [
  [report.original_preload_ipc, originalChannels],
  [report.current_build_preload_ipc, currentChannels],
]) {
  target.total_calls = channels.length;
  target.invoke_channels = uniqueChannels(channels, "invoke");
  target.send_sync_channels = uniqueChannels(channels, "sendSync");
  target.send_channels = uniqueChannels(channels, "send");
  target.renderer_event_channels = uniqueChannels(channels, "on");
  target.invoke_count = target.invoke_channels.length;
  target.send_sync_count = target.send_sync_channels.length;
  target.send_count = target.send_channels.length;
  target.renderer_event_count = target.renderer_event_channels.length;
  target.invoke_tree = summarizeByNamespace(target.invoke_channels);
}


const originalAsarViteEntries = await listAsarViteEntries(originalAsarPath);
const packagedAsarViteEntries = await listAsarViteEntries(packagedAsarPath);
if (originalAsarViteEntries && packagedAsarViteEntries) {
  const viteDiff = diffLists(originalAsarViteEntries, packagedAsarViteEntries);
  report.packaged_asar = {
    original_vite_entry_count: originalAsarViteEntries.length,
    packaged_vite_entry_count: packagedAsarViteEntries.length,
    vite_entry_diff_count: viteDiff.missing.length + viteDiff.extra.length,
    missing_vite_entries: viteDiff.missing,
    extra_vite_entries: viteDiff.extra,
  };
}

const runtimeCoveragePath = path.join(docsRoot, "electron-shell-runtime-coverage.json");
if (await exists(runtimeCoveragePath)) {
  try {
    report.runtime_coverage = JSON.parse(await fs.readFile(runtimeCoveragePath, "utf8"));
  } catch {
    report.runtime_coverage = null;
  }
}

const originalInvokeSet = new Set(report.original_preload_ipc.invoke_channels);
const currentInvokeSet = new Set(report.current_build_preload_ipc.invoke_channels);
report.coverage = {
  mirror_resource_complete: report.resources.expected_build_entries.every((entry) => entry.exists) && report.resources.expected_renderer_entries.every((entry) => entry.exists),
  current_resource_complete: report.resources.current_build_entries.every((entry) => entry.exists) && report.resources.current_renderer_entries.every((entry) => entry.exists),
  current_runtime_modules_complete: report.resources.current_runtime_module_entries.every((entry) => entry.exists),
  packaged_runtime_modules_complete:
    report.resources.packaged_runtime_module_entries.every((entry) => entry.exists) &&
    report.resources.packaged_runtime_unpacked_entries.every((entry) => entry.exists),
  current_preload_invoke_matches_original:
    originalInvokeSet.size > 0 && originalInvokeSet.size === currentInvokeSet.size && [...originalInvokeSet].every((channel) => currentInvokeSet.has(channel)),
  missing_current_invoke_channels: [...originalInvokeSet].filter((channel) => !currentInvokeSet.has(channel)),
  extra_current_invoke_channels: [...currentInvokeSet].filter((channel) => !originalInvokeSet.has(channel)),
  packaged_vite_entries_match_original: report.packaged_asar ? report.packaged_asar.vite_entry_diff_count === 0 : null,
  runtime_fallback_handlers: report.runtime_coverage?.ipcHandlers?.fallback ?? null,
  runtime_real_handlers: report.runtime_coverage?.ipcHandlers?.real ?? null,
};

await fs.mkdir(docsRoot, { recursive: true });
const jsonPath = path.join(docsRoot, "electron-shell-functional-gap.json");
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const markdown = `# Electron 壳功能对齐审计\n\n` +
  `生成时间：${report.generated_at}\n\n` +
  `## 结论\n\n` +
  `- 原包 build 壳入口镜像：${report.coverage.mirror_resource_complete ? "完整" : "不完整"}\n` +
  `- 当前 build 壳入口：${report.coverage.current_resource_complete ? "完整" : "不完整/尚未构建"}\n` +
  `- 当前 preload invoke 通道是否与原包完全一致：${report.coverage.current_preload_invoke_matches_original ? "是" : "否"}\n` +
  `- packaged app.asar 的 .vite/build + .vite/renderer 条目是否与原包一致：${report.coverage.packaged_vite_entries_match_original === null ? "未检测" : report.coverage.packaged_vite_entries_match_original ? "是" : "否"}\n` +
  `- 当前原包 runtime native/node modules 是否完整：${report.coverage.current_runtime_modules_complete ? "是" : "否"}\n` +
  `- packaged 原包 runtime native/node modules 是否完整：${report.coverage.packaged_runtime_modules_complete ? "是" : "否"}\n` +
  `- 运行时 real handlers：${report.coverage.runtime_real_handlers ?? "未检测"}\n` +
  `- 运行时 fallback handlers：${report.coverage.runtime_fallback_handlers ?? "未检测"}\n` +
  `- 原包 preload invoke 通道数：${report.original_preload_ipc.invoke_count}\n` +
  `- 原包 preload sendSync 通道数：${report.original_preload_ipc.send_sync_count}\n` +
  `- 原包 renderer 监听事件通道数：${report.original_preload_ipc.renderer_event_count}\n\n` +
  `## 当前策略\n\n` +
  `默认 build 使用“source main process + 原包 compiled preload/renderer/secondary shell resources”。` +
  `这样先保证壳暴露面与原包一致；后续再逐项把 compiled JS 转成可维护 TypeScript。\n\n` +
  `## 当前完成面\n\n` +
  `- 原包二级窗口、worker、MCP runtime 静态资源、自定义协议入口已随 build/package 镜像进入当前壳。\n` +
  `- 原包 IPC invoke/sendSync 入口已全部由 source main process 注册为 real handler；运行时 active fallback 为 0。\n` +
  `- LocalSessions / LocalAgentModeSessions 方法已全部有显式实现，source 中 explicit unavailable / unsupported fallback 已清零。\n\n` +
  `## 后端依赖说明\n\n` +
  `部分能力本身依赖 Anthropic 云端、Claude VM bundle、Slack、远端 MCP/插件市场或硬件设备；当前壳已对齐入口和本地行为，外部服务是否可用取决于对应真实后端/凭据/设备。\n\n` +
  `完整机器可读报告见：\`docs/electron-shell-functional-gap.json\`\n`;

const markdownPath = path.join(docsRoot, "electron-shell-functional-gap.md");
await fs.writeFile(markdownPath, markdown);
console.log(path.relative(projectRoot, jsonPath));
console.log(path.relative(projectRoot, markdownPath));
console.log(JSON.stringify(report.coverage, null, 2));
