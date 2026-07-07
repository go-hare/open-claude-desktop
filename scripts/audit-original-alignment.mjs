import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const docsRoot = path.join(workspaceRoot, "docs");
const originalResourceCandidates = [
  process.env.CLAUDE_ORIGINAL_RESOURCES,
  process.env.CLAUDE_ORIGINAL_APP_CONTENTS ? path.join(process.env.CLAUDE_ORIGINAL_APP_CONTENTS, "Resources") : undefined,
  path.resolve(projectRoot, "../Claude-Deepseek.app/Contents/Resources"),
  path.resolve(projectRoot, "../../Claude-Deepseek.app/Contents/Resources"),
  "/Users/apple/Downloads/Claude code 汉化mac桌面版/Claude-Deepseek.app/Contents/Resources",
  "D:\\BaiduNetdiskDownload\\Claude code 汉化mac桌面版\\Claude-Deepseek\\Claude-Deepseek.app\\Contents\\Resources",
].filter(Boolean);
const originalAppResourcesRoot = originalResourceCandidates.find((candidate) => fsSync.existsSync(candidate)) ?? originalResourceCandidates[0];
const originalIonDistRoot = path.join(originalAppResourcesRoot, "ion-dist");
const currentIonDistRoot = path.join(projectRoot, "resources/ion-dist");
const mirrorViteRoot = path.join(workspaceRoot, "electron-shell-source/app-asar/.vite");
const currentViteRoot = path.join(projectRoot, ".vite");
const originalPackagePath = path.join(workspaceRoot, "electron-shell-source/app-asar/package.json");
const currentPackagePath = path.join(projectRoot, "package.json");
const routeManifestPath = path.join(docsRoot, "route-manifest.json");
const decompiledRoot = path.join(workspaceRoot, "decompiled");

const sourceOwnedViteEntries = new Set();
const uiLibraryAllowlist = new Set([
  "react",
  "react-dom",
  "react-intl",
  "@phosphor-icons/react",
  "@tailwindcss/forms",
  "@tailwindcss/typography",
  "tailwindcss",
  "clsx",
  "lit",
]);
const uiLibraryNamePatterns = [/^react($|-)/, /^@radix-ui\//, /^@headlessui\//, /^@floating-ui\//, /^@phosphor-icons\//, /^lucide/, /^framer-motion$/];
const componentEvidenceTokens = [
  { name: "React", tokens: ["React", "react-dom"] },
  { name: "react-intl", tokens: ["react-intl", "formatMessage", "defaultMessage"] },
  { name: "Tailwind utility CSS", tokens: ["tailwind", "font-ui", "text-text-", "bg-bg-"] },
  { name: "Radix-style primitives", tokens: ["radix", "data-radix", "DismissableLayer"] },
  { name: "Headless UI traces", tokens: ["Headless"] },
  { name: "Phosphor/icon layer", tokens: ["@phosphor-icons/react", "Phosphor"] },
];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function sha256(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function walkFiles(root, prefix = "") {
  if (!(await exists(root))) return [];
  const out = [];
  for (const dirent of await fs.readdir(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
    const abs = path.join(root, dirent.name);
    if (dirent.isDirectory()) out.push(...(await walkFiles(abs, rel)));
    else out.push(rel);
  }
  return out.sort();
}

async function treeCompare(sourceRoot, targetRoot, options = {}) {
  const allowedChanged = options.allowedChanged ?? new Set();
  const sourceFiles = await walkFiles(sourceRoot);
  const targetFiles = await walkFiles(targetRoot);
  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);
  const missing = sourceFiles.filter((entry) => !targetSet.has(entry));
  const extra = targetFiles.filter((entry) => !sourceSet.has(entry));
  const changed = [];
  const allowedChangedEntries = [];

  for (const entry of sourceFiles) {
    if (!targetSet.has(entry)) continue;
    const sourceHash = await sha256(path.join(sourceRoot, entry));
    const targetHash = await sha256(path.join(targetRoot, entry));
    if (sourceHash === targetHash) continue;
    if (allowedChanged.has(entry)) allowedChangedEntries.push(entry);
    else changed.push(entry);
  }

  return {
    source_file_count: sourceFiles.length,
    target_file_count: targetFiles.length,
    missing,
    extra,
    changed,
    allowed_changed: allowedChangedEntries,
    exact: missing.length === 0 && extra.length === 0 && changed.length === 0 && allowedChangedEntries.length === 0,
    aligned_with_allowlist: missing.length === 0 && extra.length === 0 && changed.length === 0,
  };
}

async function collectFontEvidence() {
  const files = await walkFiles(currentIonDistRoot);
  const fontFiles = files.filter((entry) => /\.(?:woff2?|ttf|otf)$/i.test(entry));
  const cssFiles = files.filter((entry) => /\.css$/i.test(entry));
  const fontFamilies = new Set();
  const fontFaceCssFiles = new Set();

  for (const entry of cssFiles) {
    const source = await fs.readFile(path.join(currentIonDistRoot, entry), "utf8");
    if (source.includes("@font-face")) fontFaceCssFiles.add(entry);
    for (const match of source.matchAll(/font-family\s*:\s*(["']?)([^;,'"}]+)\1/g)) {
      const family = match[2]?.trim();
      if (family) fontFamilies.add(family);
    }
  }

  return {
    font_file_count: fontFiles.length,
    font_files_sample: fontFiles.slice(0, 20),
    css_file_count: cssFiles.length,
    font_face_css_files: [...fontFaceCssFiles].sort(),
    font_families_sample: [...fontFamilies].sort().slice(0, 40),
  };
}

function collectDependencies(pkg) {
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
}

function isUiLibraryName(name) {
  return uiLibraryAllowlist.has(name) || uiLibraryNamePatterns.some((pattern) => pattern.test(name));
}

async function collectPackageEvidence() {
  const originalPkg = await readJson(originalPackagePath);
  const currentPkg = await readJson(currentPackagePath);
  const originalDeps = collectDependencies(originalPkg);
  const currentDeps = collectDependencies(currentPkg);
  const originalUiLibraries = Object.fromEntries(Object.entries(originalDeps).filter(([name]) => isUiLibraryName(name)));
  const currentUiLibraries = Object.fromEntries(Object.entries(currentDeps).filter(([name]) => isUiLibraryName(name)));
  const unapproved = [];
  const versionMismatches = [];

  for (const [name, version] of Object.entries(currentUiLibraries)) {
    if (!Object.prototype.hasOwnProperty.call(originalUiLibraries, name)) {
      unapproved.push({ name, version, reason: "not declared by original app package.json" });
      continue;
    }
    if (originalUiLibraries[name] !== version) {
      versionMismatches.push({ name, current: version, original: originalUiLibraries[name] });
    }
  }

  return {
    original_package: { name: originalPkg.name, version: originalPkg.version, ui_libraries: originalUiLibraries },
    current_package: { name: currentPkg.name, version: currentPkg.version, ui_libraries: currentUiLibraries },
    unapproved_current_ui_libraries: unapproved,
    current_ui_version_mismatches: versionMismatches,
  };
}

async function collectRouteComponentEvidence() {
  if (!(await exists(routeManifestPath))) return { manifest_exists: false };
  const manifest = await readJson(routeManifestPath);
  const routes = Array.isArray(manifest.routes) ? manifest.routes : [];
  const chunkRoutes = routes.filter((route) => typeof route.chunk === "string" && route.chunk.length > 0);
  const evidence = [];
  let chunksExisting = 0;
  let decompiledExisting = 0;

  for (const route of chunkRoutes) {
    const chunkFile = route.chunk.replace(/^assets\/v1\//, "");
    const chunkPath = path.join(currentIonDistRoot, route.chunk);
    const decompiledPath = path.join(decompiledRoot, chunkFile.replace(/\.js$/, ""), "deobfuscated.js");
    const chunkExists = await exists(chunkPath);
    const decompiledExists = await exists(decompiledPath);
    if (chunkExists) chunksExisting += 1;
    if (decompiledExists) decompiledExisting += 1;
    if (route.path === "setup-desktop-3p" || route.path === "desktop_landing" || route.path === "device-code-verify") {
      evidence.push({
        path: route.path,
        chunk: route.chunk,
        chunk_exists: chunkExists,
        decompiled: path.relative(workspaceRoot, decompiledPath),
        decompiled_exists: decompiledExists,
      });
    }
  }

  return {
    manifest_exists: true,
    route_count: routes.length,
    chunk_route_count: chunkRoutes.length,
    chunk_routes_with_assets: chunksExisting,
    chunk_routes_with_decompiled_source: decompiledExisting,
    key_routes: evidence,
    missing_chunk_assets: chunkRoutes
      .filter((route) => !route.chunk || !route.chunk.startsWith("assets/v1/"))
      .map((route) => route.path)
      .slice(0, 20),
  };
}

async function collectComponentTokenEvidence() {
  const files = await walkFiles(currentIonDistRoot);
  const jsFiles = files.filter((entry) => /\.js$/i.test(entry));
  const hits = Object.fromEntries(componentEvidenceTokens.map((item) => [item.name, []]));

  for (const entry of jsFiles) {
    const source = await fs.readFile(path.join(currentIonDistRoot, entry), "utf8");
    for (const item of componentEvidenceTokens) {
      if (hits[item.name].length >= 8) continue;
      if (item.tokens.some((token) => source.includes(token))) hits[item.name].push(entry);
    }
  }

  return hits;
}

function addFailure(failures, condition, message) {
  if (!condition) failures.push(message);
}

const failures = [];

addFailure(failures, await exists(originalIonDistRoot), `Missing original ion-dist: ${originalIonDistRoot}`);
addFailure(failures, await exists(currentIonDistRoot), `Missing current ion-dist: ${currentIonDistRoot}`);
addFailure(failures, await exists(mirrorViteRoot), `Missing original shell .vite mirror: ${mirrorViteRoot}`);
addFailure(failures, await exists(currentViteRoot), `Missing current .vite build output: ${currentViteRoot}`);

const ionDist = await treeCompare(originalIonDistRoot, currentIonDistRoot);
const shellVite = await treeCompare(mirrorViteRoot, currentViteRoot, { allowedChanged: sourceOwnedViteEntries });
const fonts = await collectFontEvidence();
const packages = await collectPackageEvidence();
const routes = await collectRouteComponentEvidence();
const componentTokens = await collectComponentTokenEvidence();

addFailure(failures, ionDist.exact, "resources/ion-dist must be byte-for-byte identical to original Claude-Deepseek.app ion-dist");
addFailure(failures, shellVite.exact, ".vite shell resources must be byte-for-byte identical to original mirror");
addFailure(failures, packages.unapproved_current_ui_libraries.length === 0, "Current package.json adds UI/component libraries not declared by original app package.json");
addFailure(failures, packages.current_ui_version_mismatches.length === 0, "Current package.json UI/component library versions differ from original app package.json");
if (routes.manifest_exists) {
  addFailure(failures, routes.chunk_route_count === routes.chunk_routes_with_assets, "Some route component chunks are missing from current ion-dist assets");
  addFailure(failures, routes.key_routes.every((entry) => entry.chunk_exists && entry.decompiled_exists), "Key desktop/setup routes must have original chunk and decompiled evidence");
}

const report = {
  generated_at: new Date().toISOString(),
  policy: {
    standard: "original-first alignment: no guessed JS/CSS/font/component structure",
    original_js_css_fonts: "resources/ion-dist must stay byte-for-byte identical to Claude-Deepseek.app/Contents/Resources/ion-dist",
    electron_shell_resources: "all original .vite build/renderer files must match byte-for-byte",
    component_library: "renderer components come from original compiled chunks; new source UI libraries are forbidden unless declared by original package.json with matching version",
    route_manifest: "optional evidence only; byte-for-byte .vite and ion-dist alignment are the hard gates",
    source_main_process: "main-process output must come from original extracted .vite/build/index.js and index.pre.js in code-1:1 mode",
  },
  paths: {
    project_root: projectRoot,
    original_ion_dist: originalIonDistRoot,
    current_ion_dist: currentIonDistRoot,
    original_vite_mirror: mirrorViteRoot,
    current_vite: currentViteRoot,
    route_manifest: routeManifestPath,
    decompiled_root: decompiledRoot,
  },
  checks: {
    ion_dist: ionDist,
    shell_vite: shellVite,
    fonts,
    packages,
    routes,
    component_token_evidence: componentTokens,
  },
  failures,
  ok: failures.length === 0,
};

await fs.mkdir(docsRoot, { recursive: true });
const jsonPath = path.join(docsRoot, "original-first-alignment-report.json");
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const keyRouteLines = (routes.key_routes ?? [])
  .map((entry) => `| ${entry.path} | ${entry.chunk} | ${entry.chunk_exists ? "是" : "否"} | ${entry.decompiled} | ${entry.decompiled_exists ? "是" : "否"} |`)
  .join("\n");
const componentLines = Object.entries(componentTokens)
  .map(([name, files]) => `- ${name}: ${files.length ? files.slice(0, 4).map((file) => `\`${file}\``).join(", ") : "未命中"}`)
  .join("\n");
const markdown = `# 原版优先对齐报告\n\n` +
  `生成时间：${report.generated_at}\n\n` +
  `## 硬标准\n\n` +
  `1. JS/CSS/字体先找原版资源，不能自己猜。\n` +
  `2. 页面组件结构以原版 route chunk 与 decompiled 文件为依据。\n` +
  `3. 组件库不得自行替换；新增 UI 依赖必须在原版 package.json 中存在且版本一致。\n` +
  `4. Electron 主进程转源码时，未找到原版证据的行为必须标成 inferred，不能宣称已完全对齐。\n\n` +
  `## 当前检查结论\n\n` +
  `- ion-dist 字节级一致：${ionDist.exact ? "是" : "否"}（原版 ${ionDist.source_file_count} / 当前 ${ionDist.target_file_count}）\n` +
  `- .vite 壳资源一致：${shellVite.aligned_with_allowlist ? "是" : "否"}（允许源码入口差异：${shellVite.allowed_changed.join(", ") || "无"}）\n` +
  `- 字体文件数：${fonts.font_file_count}\n` +
  `- CSS 文件数：${fonts.css_file_count}\n` +
  `- route chunks 有资源：${routes.chunk_routes_with_assets ?? 0}/${routes.chunk_route_count ?? 0}\n` +
  `- route chunks 有 decompiled 证据：${routes.chunk_routes_with_decompiled_source ?? 0}/${routes.chunk_route_count ?? 0}\n` +
  `- 未授权 UI 依赖：${packages.unapproved_current_ui_libraries.length}\n` +
  `- UI 依赖版本不一致：${packages.current_ui_version_mismatches.length}\n` +
  `- 结论：${report.ok ? "通过" : "失败"}\n\n` +
  `## 关键桌面路由证据\n\n` +
  `| route | 原版 chunk | chunk 存在 | decompiled 文件 | decompiled 存在 |\n` +
  `|---|---|---|---|---|\n` +
  `${keyRouteLines}\n\n` +
  `## 组件库/样式证据\n\n${componentLines}\n\n` +
  `## 失败项\n\n` +
  `${failures.length ? failures.map((failure) => `- ${failure}`).join("\n") : "- 无"}\n\n` +
  `机器可读报告：\`docs/original-first-alignment-report.json\`\n`;
const markdownPath = path.join(docsRoot, "original-first-alignment-report.md");
await fs.writeFile(markdownPath, markdown);

console.log(path.relative(projectRoot, jsonPath));
console.log(path.relative(projectRoot, markdownPath));
console.log(JSON.stringify({ ok: report.ok, failures, ionDist: { exact: ionDist.exact, files: ionDist.target_file_count }, shellVite: { aligned: shellVite.aligned_with_allowlist, allowedChanged: shellVite.allowed_changed }, fonts: { files: fonts.font_file_count, css: fonts.css_file_count }, routes: { chunkAssets: `${routes.chunk_routes_with_assets ?? 0}/${routes.chunk_route_count ?? 0}`, decompiled: `${routes.chunk_routes_with_decompiled_source ?? 0}/${routes.chunk_route_count ?? 0}` } }, null, 2));

if (failures.length > 0) process.exitCode = 1;
