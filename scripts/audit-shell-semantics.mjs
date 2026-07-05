import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.resolve(projectRoot, "../docs");
const sourceRoots = ["electron/main", "electron/preload"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const debtMarker = /\b(P0|stub|not implemented|TODO|inferred|fake|placeholder)\b|未实现|占位|假数据/i;

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir, prefix = "") {
  const out = [];
  if (!(await exists(dir))) return out;
  for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, dirent.name);
    const abs = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...(await listFiles(abs, rel)));
    else if (sourceExtensions.has(path.extname(dirent.name))) out.push(rel);
  }
  return out.sort();
}

async function readProjectFile(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), "utf8");
}

const scannedFiles = [];
const debtMarkerHits = [];
for (const root of sourceRoots) {
  const rootAbs = path.join(projectRoot, root);
  for (const relativeToRoot of await listFiles(rootAbs)) {
    const relativePath = path.join(root, relativeToRoot);
    const source = await readProjectFile(relativePath);
    scannedFiles.push(relativePath);
    source.split(/\r?\n/).forEach((line, index) => {
      if (debtMarker.test(line)) debtMarkerHits.push({ file: relativePath, line: index + 1, text: line.trim() });
    });
  }
}

const contracts = [
  {
    id: "file-pickers-return-original-array-shape",
    file: "electron/main/ipc/settingsHandlers.ts",
    description: "FilePickers getDirectoryPath/getFilePath must return [] or filePaths[], matching original preload consumer expectations.",
    pass: (source) => source.includes("return result.canceled ? [] : result.filePaths;"),
  },
  {
    id: "custom3p-setup-opens-secondary-window",
    file: "electron/main/menu/applicationMenu.ts",
    description: "Developer > Configure third-party inference opens the setup route in a popup BrowserWindow, not by replacing main task page.",
    pass: (source) => source.includes("openCustom3pSetupWindow(context.windows.mainWindow)"),
  },
  {
    id: "extension-menu-installs-through-extension-service",
    file: "electron/main/menu/applicationMenu.ts",
    description: "Developer extension install menu must install through the extension service and emit the original Extensions change event.",
    pass: (source) => source.includes("installDxtArchive(context.settings.getUserDataDir(), source)") && source.includes('"Extensions", "extensionsChanged"'),
  },
  {
    id: "desktop-extension-store-has-local-lifecycle",
    file: "electron/main/services/extensions/desktopExtensions.ts",
    description: "Desktop Extensions must support local list/install/settings/delete lifecycle instead of empty handlers.",
    pass: (source) => ["listInstalledExtensions", "installDxtArchive", "installUnpackedExtension", "deleteInstalledExtension", "setInstalledExtensionSettings"].every((name) => source.includes(`export async function ${name}`)),
  },
  {
    id: "extension-directory-api-route-present",
    file: "electron/main/protocol/custom3pApi.ts",
    description: "app:// local API must expose DXT directory endpoints expected by original route chunks.",
    pass: (source) => source.includes('/dxt/extensions') && source.includes('versions: []'),
  },
  {
    id: "update-availability-original-null-shape",
    file: "electron/main/ipc/settingsHandlers.ts",
    description: "getIsUpdateAvailable returns string|null, matching original validator shape; local no-update path is null.",
    pass: (source) => source.includes("getIsUpdateAvailable: async () => null"),
  },
  {
    id: "custom3p-probes-return-original-route-shapes",
    file: "electron/main/ipc/settingsHandlers.ts",
    description: "Custom3p setup probes return reachable/latency and MCP kind/title/message shapes consumed by original setup route.",
    pass: (source) => source.includes("reachable:") && source.includes("latencyMs") && source.includes('kind: "ok"') && source.includes('kind: "err"'),
  },
];

const contractResults = [];
for (const contract of contracts) {
  let ok = false;
  try {
    ok = contract.pass(await readProjectFile(contract.file));
  } catch {
    ok = false;
  }
  contractResults.push({ id: contract.id, file: contract.file, description: contract.description, ok });
}

const report = {
  generated_at: new Date().toISOString(),
  project_root: projectRoot,
  scanned_files: scannedFiles,
  debt_marker_policy: "electron/main and electron/preload must not contain P0/stub/TODO/inferred/fake/placeholder/not implemented markers after shell features are turned into source-owned behavior.",
  debt_marker_hits: debtMarkerHits,
  contracts: contractResults,
  ok: debtMarkerHits.length === 0 && contractResults.every((item) => item.ok),
};

await fs.mkdir(docsRoot, { recursive: true });
const jsonPath = path.join(docsRoot, "electron-shell-semantic-debt.json");
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const markdown = `# Electron 壳语义债审计\n\n` +
  `生成时间：${report.generated_at}\n\n` +
  `## 结论\n\n` +
  `- 源码债务标记命中：${debtMarkerHits.length}\n` +
  `- 壳关键语义合同：${contractResults.filter((item) => item.ok).length}/${contractResults.length}\n` +
  `- 是否通过：${report.ok ? "是" : "否"}\n\n` +
  `## 语义合同\n\n` +
  contractResults.map((item) => `- ${item.ok ? "✅" : "❌"} ${item.id}：${item.description}（${item.file}）`).join("\n") +
  `\n\n完整机器可读报告见：\`docs/electron-shell-semantic-debt.json\`\n`;
const markdownPath = path.join(docsRoot, "electron-shell-semantic-debt.md");
await fs.writeFile(markdownPath, markdown);

console.log(path.relative(projectRoot, jsonPath));
console.log(path.relative(projectRoot, markdownPath));
console.log(JSON.stringify({ ok: report.ok, debt_marker_hits: debtMarkerHits.length, contracts_ok: contractResults.filter((item) => item.ok).length, contracts_total: contractResults.length }, null, 2));

if (!report.ok) process.exit(1);
