import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dependencySections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

const defaultOfficialAsarCandidates = [
  process.env.CLAUDE_ORIGINAL_ASAR,
  process.env.CLAUDE_ORIGINAL_RESOURCES ? path.join(process.env.CLAUDE_ORIGINAL_RESOURCES, "app.asar") : undefined,
  process.env.CLAUDE_ORIGINAL_APP_CONTENTS ? path.join(process.env.CLAUDE_ORIGINAL_APP_CONTENTS, "Resources", "app.asar") : undefined,
  path.resolve(projectRoot, "../../Claude-Deepseek.app/Contents/Resources/app.asar"),
  String.raw`D:\BaiduNetdiskDownload\Claude code 汉化mac桌面版\Claude-Deepseek\Claude-Deepseek.app\Contents\Resources\app.asar`,
].filter(Boolean);

function parseArgs(argv) {
  const args = {
    officialAsar: undefined,
    currentPackage: path.join(projectRoot, "package.json"),
    writeDoc: undefined,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--official-asar") args.officialAsar = argv[++index];
    else if (arg === "--current-package") args.currentPackage = argv[++index];
    else if (arg === "--write-doc") args.writeDoc = argv[++index];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/compare-official-desktop-deps.mjs [--official-asar <path>] [--current-package <path>] [--write-doc <path>] [--json]`);
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function firstExisting(paths) {
  return paths.find((candidate) => fs.existsSync(candidate));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readOfficialPackage(officialAsar) {
  const buffer = asar.extractFile(officialAsar, "package.json");
  return JSON.parse(Buffer.from(buffer).toString("utf8"));
}

function collectDependencies(pkg) {
  const output = new Map();
  for (const section of dependencySections) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      output.set(name, { name, spec, section });
    }
  }
  return output;
}

function byName(left, right) {
  return left.name.localeCompare(right.name);
}

function packageEntries(archivePath, packageName) {
  const prefix = `node_modules/${packageName}`;
  return asar.listPackage(archivePath)
    .map((entry) => entry.replace(/\\/g, "/").replace(/^\/+/, ""))
    .filter((entry) => entry === prefix || entry.startsWith(`${prefix}/`))
    .sort();
}

function classifyOfficialDependency(dep, archivePath) {
  const spec = String(dep.spec);
  const packagedEntries = packageEntries(archivePath, dep.name);
  return {
    ...dep,
    privateAnt: dep.name.startsWith("@ant/"),
    nonNpmProtocol: spec.startsWith("patch:") || spec.startsWith("workspace:"),
    npmAlias: spec.startsWith("npm:"),
    packaged: packagedEntries.length > 0,
    packagedEntryCount: packagedEntries.length,
    packagedEntrySample: packagedEntries.slice(0, 5),
  };
}

function isLocalBuiltin(officialDep, currentDep) {
  return Boolean(
    currentDep &&
    String(currentDep.spec).startsWith("file:vendor/"),
  );
}

function patchNpmSpec(spec) {
  const match = String(spec).match(/^patch:.*@npm:([^#]+)#/);
  return match?.[1] ?? null;
}

function sameVersionIntent(left, right) {
  const normalize = (value) => String(value).trim().replace(/^\^/, "");
  return String(left).trim() === String(right).trim() || normalize(left) === normalize(right);
}

function isAlignedSpec(officialDep, currentDep) {
  if (!currentDep) return false;
  if (officialDep.spec === currentDep.spec) return true;
  if (isLocalBuiltin(officialDep, currentDep)) return true;
  const patchTarget = patchNpmSpec(officialDep.spec);
  return Boolean(patchTarget && sameVersionIntent(patchTarget, currentDep.spec));
}

function diffPackages(officialPkg, currentPkg, officialAsar) {
  const officialMap = collectDependencies(officialPkg);
  const currentMap = collectDependencies(currentPkg);
  const officialDeps = [...officialMap.values()].map((dep) => classifyOfficialDependency(dep, officialAsar)).sort(byName);
  const currentDeps = [...currentMap.values()].sort(byName);
  const officialOnly = officialDeps.filter((dep) => !currentMap.has(dep.name));
  const currentOnly = currentDeps.filter((dep) => !officialMap.has(dep.name));
  const versionMismatches = officialDeps
    .filter((dep) => currentMap.has(dep.name) && !isAlignedSpec(dep, currentMap.get(dep.name)))
    .map((dep) => ({ name: dep.name, official: dep, current: currentMap.get(dep.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const privateAnt = officialDeps.filter((dep) => dep.privateAnt);
  const privateAntBuiltins = privateAnt
    .filter((dep) => isLocalBuiltin(dep, currentMap.get(dep.name)))
    .map((dep) => ({ ...dep, current: currentMap.get(dep.name) }));
  const privateAntMissing = privateAnt.filter((dep) => !currentMap.has(dep.name));
  const nonDirectInstall = officialDeps
    .filter((dep) => dep.nonNpmProtocol || dep.npmAlias)
    .map((dep) => ({ ...dep, current: currentMap.get(dep.name) }));

  return {
    official: {
      name: officialPkg.name,
      version: officialPkg.version,
      dependencyEntryCount: officialDeps.length,
    },
    current: {
      name: currentPkg.name,
      version: currentPkg.version,
      dependencyEntryCount: currentDeps.length,
    },
    officialOnly,
    currentOnly,
    versionMismatches,
    privateAnt,
    privateAntBuiltins,
    privateAntMissing,
    nonDirectInstall,
  };
}

function markdownTable(headers, rows) {
  const escapeCell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const header = `| ${headers.map(escapeCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function renderDoc({ officialAsar, report }) {
  const publicOfficialMissing = report.officialOnly.filter((dep) => !dep.privateAnt && !dep.nonNpmProtocol && !dep.npmAlias);
  const builtinKind = (dep) => {
    const spec = dep.current?.spec ?? "";
    if (!spec.startsWith("file:")) return dep.packaged ? `runtime proxy（app.asar ${dep.packagedEntryCount} 项）` : "unknown";
    const packageJsonPath = path.resolve(spec.slice("file:".length), "package.json");
    try {
      const pkg = readJson(packageJsonPath);
      if (pkg.xParityKind) return pkg.xParityKind;
      if (pkg.main && String(pkg.main).startsWith("./dist/")) return "source-built";
    } catch {
      // Fall through to evidence-based status.
    }
    return dep.packaged ? `runtime proxy（app.asar ${dep.packagedEntryCount} 项）` : "local builtin";
  };
  const privateBuiltinRows = report.privateAntBuiltins.map((dep) => [
    dep.name,
    dep.section,
    dep.current.spec,
    builtinKind(dep),
    dep.packagedEntrySample.join("<br>") || "官方安装包无独立模块，使用本地 builtin adapter",
  ]);
  const privateRows = report.privateAnt.map((dep) => [
    dep.name,
    dep.section,
    dep.spec,
    dep.packaged ? `是（${dep.packagedEntryCount} 项）` : "否",
    dep.packagedEntrySample.join("<br>") || "未在 app.asar 独立打包",
  ]);
  const nonDirectRows = report.nonDirectInstall.map((dep) => [
    dep.name,
    dep.section,
    dep.spec,
    dep.current?.spec ?? "missing",
    dep.name === "@anthropic-ai/claude-agent-sdk-future"
      ? "sdk alias to installed @anthropic-ai/claude-agent-sdk"
      : isLocalBuiltin(dep, dep.current)
        ? "local builtin"
        : patchNpmSpec(dep.spec) && dep.current
          ? "real npm package for patch target"
          : dep.nonNpmProtocol
            ? "workspace/patch unresolved"
            : "npm alias unresolved",
  ]);

  return `# Desktop 官方依赖基线对齐报告

生成命令：\`npm run compare:official-deps\`

## 结论

- 官方 package：\`${report.official.name}@${report.official.version}\`，依赖入口 ${report.official.dependencyEntryCount} 个。
- 当前 package：\`${report.current.name}@${report.current.version}\`，依赖入口 ${report.current.dependencyEntryCount} 个。
- 官方有 / 本地没有：${report.officialOnly.length} 个。
- 本地有 / 官方没有：${report.currentOnly.length} 个。
- 同名版本不一致：${report.versionMismatches.length} 个。
- private \`@ant/*\`：${report.privateAnt.length} 个；本地已内建 ${report.privateAntBuiltins.length} 个，仍缺失 ${report.privateAntMissing.length} 个。

官方来源：\`${officialAsar}\`

## 已优先补齐的公开 npm 依赖

本仓库先补 desktop 壳子直接需要、且可从 npm 正常安装的官方公开依赖。未一次性补齐全部 UI/测试/内部构建依赖，避免把 renderer/web 依赖面扩散到 desktop-only 改造。

- runtime / IPC / MCP：\`ws\`, \`@anthropic-ai/claude-agent-sdk\`, \`@anthropic-ai/mcpb\`, \`@anthropic-ai/sdk\`, \`@modelcontextprotocol/sdk\`
- desktop shell：\`electron-store\`, \`electron-window-state\`, \`fs-extra\`, \`jsonc-parser\`, \`semver\`, \`ssh2\`, \`p-queue\`, \`rxjs\`, \`winston\`, \`winston-transport\`
- archive / media：\`tar\`, \`yauzl\`, \`extract-zip\`, \`fflate\`, \`sharp\`
- packaging / Forge：\`@electron/asar\`, \`@electron-forge/maker-base\`, \`@electron-forge/maker-dmg\`, \`@electron-forge/maker-msix\`, \`@electron-forge/maker-squirrel\`, \`@electron-forge/plugin-base\`, \`@electron-forge/plugin-fuses\`, \`@electron-forge/plugin-vite\`, \`@electron-forge/shared-types\`, \`@electron/fuses\`, \`@electron/notarize\`

## 官方有 / 本地没有

${markdownTable(["package", "section", "official spec", "packaged in app.asar", "note"], report.officialOnly.map((dep) => [
  dep.name,
  dep.section,
  dep.spec,
  dep.packaged ? `yes (${dep.packagedEntryCount})` : "no",
  dep.privateAnt ? "private @ant/*; adapter/runtime copy" : dep.nonNpmProtocol ? "官方 yarn patch/workspace，不直接照抄" : dep.npmAlias ? "npm alias / 特殊发布流，先记录" : "public npm candidate",
]))}

## 本地有 / 官方没有

${report.currentOnly.length === 0 ? "无。" : markdownTable(["package", "section", "local spec"], report.currentOnly.map((dep) => [dep.name, dep.section, dep.spec]))}

## 同名版本不一致

${report.versionMismatches.length === 0 ? "无。" : markdownTable(["package", "official", "local"], report.versionMismatches.map((item) => [item.name, `${item.official.spec} (${item.official.section})`, `${item.current.spec} (${item.current.section})`]))}

## private @ant/* 本地内建清单

${markdownTable(["package", "section", "local spec", "内建方式", "官方安装包证据"], privateBuiltinRows)}

说明：官方私有包不走 registry 安装；当前用 \`file:vendor/ant/*\` 内建进本包。官方安装包里有实体模块的包走 runtime proxy；能在本机官方源码树找到的包走 source-built；能从官方 bundle 或本机官方源码恢复行为的包走 bundle-derived / protocol-adapter；官方私有源码不可得且安装包无独立模块的 dev 包走 source-owned compat-shim。

## private @ant/* 官方证据清单

${markdownTable(["package", "section", "official spec", "app.asar 独立模块", "官方入口证据"], privateRows)}

处理原则：不能从 npm registry 直接安装 \`@ant/*\`。本仓库用本地 builtin 包占住依赖入口，并把包内部补成 runtime proxy / source-built / protocol-adapter / bundle-derived / compat-shim；当前不再保留会在调用时直接抛错的空包。

### @ant/* 替代策略

| package | 官方用途 | 官方调用入口 / 证据 | 当前本地替代方案 | 状态 |
| --- | --- | --- | --- | --- |
| @ant/claude-native | 原生 Node binding，承载官方 desktop native 能力。 | \`app.asar/node_modules/@ant/claude-native\`，含 \`index.js\` 与 \`claude-native-binding.node\`。 | \`vendor/ant/claude-native\` 内建包代理 \`resources/original-runtime-node_modules\`。 | builtin runtime proxy |
| @ant/claude-swift | Swift / computer-use 原生 addon。 | \`app.asar/node_modules/@ant/claude-swift\`，含 \`js/index.js\`、\`swift_addon.node\`、\`computer_use.node\`。 | \`vendor/ant/claude-swift\` 内建包代理 \`resources/original-runtime-node_modules\`。 | builtin runtime proxy |
| @ant/claude-for-chrome-mcp | 官方 Chrome MCP 能力包。 | package.json dependency；app.asar 已被 Vite 打包；本机 \`claude-code/packages/@ant/claude-for-chrome-mcp\` 有源码。 | 已拷贝源码到 \`vendor/ant/claude-for-chrome-mcp\` 并编译 \`dist\`。 | source-built |
| @ant/computer-use-mcp | 官方 computer-use MCP 能力包。 | package.json dependency；相关 native 证据在 \`@ant/claude-swift/build/Release/computer_use.node\`；本机 \`claude-code/packages/@ant/computer-use-mcp\` 有源码。 | 已拷贝源码到 \`vendor/ant/computer-use-mcp\` 并编译 \`dist\`。 | source-built |
| @ant/imagine-server | 官方 imagine 相关本地服务。 | package.json dependency；官方前端 bundle 暴露 \`ui://imagine/show-widget.html\` 与 \`show_widget\` 工具语义。 | \`vendor/ant/imagine-server\` 实现 widget/MCP lifecycle adapter。 | bundle-derived |
| @ant/claude-ssh | 官方 SSH 能力。 | package.json devDependency；official \`.vite/build/index.js\` 内嵌 \`claude-ssh-releases\` manifest。 | \`vendor/ant/claude-ssh\` 暴露官方 bundle 中恢复的版本、checksum、平台和下载 URL。 | bundle-derived |
| @ant/rfb-client | 官方 RFB / remote framebuffer 客户端能力。 | package.json devDependency；renderer bundle 有 framebuffer/RFB 相关调用语义。 | \`vendor/ant/rfb-client\` 实现 RFB event client、frame/update/key/pointer surface。 | protocol-adapter |
| @ant/utils | 官方共享工具库。 | package.json devDependency；未在 app.asar 中发现独立模块。 | \`vendor/ant/utils\` 提供 source-owned 通用工具兼容面。 | compat-shim |
| @ant/cowork-win32-service | 官方 Windows cowork service。 | package.json devDependency；未在 app.asar 中发现独立模块。 | \`vendor/ant/cowork-win32-service\` 实现 Windows \`sc.exe\` service controller adapter。 | protocol-adapter |
| @ant/chrome-native-host | 官方 Chrome native host 开发/打包支持。 | package.json devDependency；本机 \`claude-code/src/utils/claudeInChrome/chromeNativeHost.ts\` 有纯 TS 实现。 | \`vendor/ant/chrome-native-host\` 已实现 native-messaging frame、socket/pipe bridge、reader 与 host runtime。 | protocol-adapter |
| @ant/disclaimer | 官方 disclaimer 内部包。 | official \`shellPathWorker.js\` 与 main bundle 含 disclaimer binary wrapping 逻辑。 | \`vendor/ant/disclaimer\` 实现 bundle-derived launch/spawn wrapper。 | bundle-derived |
| @ant/dxt-registry | 官方 DXT registry 内部包。 | official preload/main settings surface 含 \`/dxt/extensions\` registry/list/version shape。 | \`vendor/ant/dxt-registry\` 实现 registry URL、memory registry、extension/version API adapter。 | protocol-adapter |
| @ant/ipc-codegen | 官方 IPC codegen 内部包。 | official preload 使用 \`$eipc_message$\` channel 编码与 namespace/interface/method 结构。 | \`vendor/ant/ipc-codegen\` 实现 channel build/parse、invoke/sync proxy 和 event emit adapter。 | protocol-adapter |
| @ant/claude-screen-app | 官方 screen app 内部包。 | package.json devDependency；desktop main/renderer 需要 screen/session/capture 语义。 | \`vendor/ant/claude-screen-app\` 实现 screen session lifecycle adapter。 | protocol-adapter |
| @ant/claude-swift-ant | 官方 Swift Ant 开发包。 | official runtime native implementation 已通过 \`@ant/claude-swift\` 复制。 | \`vendor/ant/claude-swift-ant\` 代理本地 \`@ant/claude-swift\` runtime surface。 | runtime proxy |

## 官方非标准依赖处理

${markdownTable(["package", "section", "official spec", "current spec", "处理方式"], nonDirectRows)}

说明：官方 yarn patch / workspace / npm alias 不能在 npm lockfile 中原样复用。可安装的 patch target 已改为真实 npm 包；registry/workspace 不可用的包使用本地 builtin。

## 仍待评估的公开 npm 依赖

以下官方公开依赖本轮没有强行加入 desktop-only package，避免把完整 renderer / monorepo / lint-test 面全部拉入壳子。后续若源码开始直接 import，再按官方版本补齐。

${publicOfficialMissing.length === 0 ? "无。" : markdownTable(["package", "section", "official spec"], publicOfficialMissing.map((dep) => [dep.name, dep.section, dep.spec]))}
`;
}

const args = parseArgs(process.argv.slice(2));
const officialAsar = args.officialAsar ? path.resolve(args.officialAsar) : firstExisting(defaultOfficialAsarCandidates);
if (!officialAsar) {
  throw new Error(`official app.asar not found. Tried:\n${defaultOfficialAsarCandidates.join("\n")}`);
}
const currentPackagePath = path.resolve(args.currentPackage);
const officialPkg = readOfficialPackage(officialAsar);
const currentPkg = readJson(currentPackagePath);
const report = diffPackages(officialPkg, currentPkg, officialAsar);

if (args.writeDoc) {
  const docPath = path.resolve(args.writeDoc);
  fs.mkdirSync(path.dirname(docPath), { recursive: true });
  fs.writeFileSync(docPath, renderDoc({ officialAsar, report }));
}

const summary = {
  official_asar: officialAsar,
  official: report.official,
  current: report.current,
  official_only_count: report.officialOnly.length,
  current_only_count: report.currentOnly.length,
  version_mismatch_count: report.versionMismatches.length,
  private_ant_count: report.privateAnt.length,
  private_ant_builtin_count: report.privateAntBuiltins.length,
  private_ant_missing_count: report.privateAntMissing.length,
  non_direct_install_count: report.nonDirectInstall.length,
  official_only: report.officialOnly.map(({ name, spec, section, privateAnt, nonNpmProtocol, npmAlias, packaged, packagedEntryCount }) => ({ name, spec, section, privateAnt, nonNpmProtocol, npmAlias, packaged, packagedEntryCount })),
  current_only: report.currentOnly,
  version_mismatches: report.versionMismatches.map((item) => ({ name: item.name, official: item.official, current: item.current })),
  private_ant: report.privateAnt.map(({ name, spec, section, packaged, packagedEntryCount }) => ({ name, spec, section, packaged, packagedEntryCount })),
  private_ant_builtins: report.privateAntBuiltins.map(({ name, spec, section, packaged, packagedEntryCount, current }) => ({ name, spec, section, packaged, packagedEntryCount, current })),
  private_ant_missing: report.privateAntMissing.map(({ name, spec, section, packaged, packagedEntryCount }) => ({ name, spec, section, packaged, packagedEntryCount })),
  non_direct_install: report.nonDirectInstall.map(({ name, spec, section, current }) => ({ name, spec, section, current })),
};

if (args.json) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`official ${report.official.name}@${report.official.version}: ${report.official.dependencyEntryCount} dependency entries`);
  console.log(`current ${report.current.name}@${report.current.version}: ${report.current.dependencyEntryCount} dependency entries`);
  console.log(`official-only=${report.officialOnly.length} current-only=${report.currentOnly.length} mismatches=${report.versionMismatches.length} private-ant=${report.privateAnt.length} private-ant-builtins=${report.privateAntBuiltins.length}`);
  if (args.writeDoc) console.log(`wrote ${path.relative(projectRoot, path.resolve(args.writeDoc))}`);
}
