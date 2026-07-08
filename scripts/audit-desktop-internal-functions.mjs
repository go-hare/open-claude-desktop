import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, Node, SyntaxKind } from "ts-morph";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.join(projectRoot, "docs");
const mirrorRootCandidates = [
  process.env.CLAUDE_ELECTRON_SHELL_MIRROR,
  path.resolve(projectRoot, "../electron-shell-source/app-asar"),
  path.resolve(projectRoot, "../claude-ion-react-workbench/electron-shell-source/app-asar"),
  path.resolve(projectRoot, "../claude-ion-react-workbench/claude-ion-react-workbench/electron-shell-source/app-asar"),
  String.raw`D:\work\py\claude\claude-ion-react-workbench\electron-shell-source\app-asar`,
  String.raw`D:\BaiduNetdiskDownload\claude-ion-react-workbench\claude-ion-react-workbench\electron-shell-source\app-asar`,
].filter(Boolean);
const mirrorRoot = mirrorRootCandidates.find((candidate) => fsSync.existsSync(candidate)) ?? mirrorRootCandidates[0];
const mirrorViteRoot = path.join(mirrorRoot, ".vite");
const sourceIpcRoot = path.join(projectRoot, "electron/main/ipc");
const sourceMainRoot = path.join(projectRoot, "electron/main");
const preloadFiles = [
  "build/mainWindow.js",
  "build/mainView.js",
  "build/findInPage.js",
  "build/aboutWindow.js",
  "build/quickWindow.js",
  "build/buddy.js",
  "build/coworkArtifact.js",
];
const sourceExtensions = new Set([".ts", ".tsx"]);
const debtMarker = /\b(P0|stub|not implemented|TODO|fake|placeholder)\b|未实现|占位|假数据/i;

function buildIpcChannel(namespace, iface, method) {
  return `$eipc_message$_ea5fa1fd-aa4e-4f73-a689-0f14f3e8be79_$_${namespace}_$_${iface}_$_${method}`;
}

function parseEipc(channel) {
  const parts = channel.split("_$_");
  if (parts.length < 4) return null;
  return { namespace: parts[1] ?? "", iface: parts[2] ?? "", method: parts.slice(3).join("_$_") };
}

function parseChannels(source, file) {
  const callRegex = /ipcRenderer\.(invoke|sendSync|send|on)\(\s*"([^"]+)"/g;
  const out = [];
  let match;
  while ((match = callRegex.exec(source))) out.push({ file, mode: match[1], channel: match[2], parsed: parseEipc(match[2]) });
  return out;
}

function parseMinifiedEnumValues(source) {
  const values = {};
  const enumRegex = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)=\(([A-Za-z_$][\w$]*)=>\((.{0,2500}?)\)\)\(\1\|\|\{\}\)/g;
  let block;
  while ((block = enumRegex.exec(source))) {
    const enumName = block[1];
    const paramName = block[2].replace(/[$]/g, "\\$&");
    const body = block[3];
    const valueRegex = new RegExp(`${paramName}\\.([A-Za-z_$][\\w$]*)="([^"]+)"`, "g");
    let value;
    while ((value = valueRegex.exec(body))) values[`${enumName}.${value[1]}`] = value[2];
  }
  return values;
}

function parseDirectChannels(source, file) {
  const enumValues = parseMinifiedEnumValues(source);
  const callRegex = /ipcRenderer\.(invoke|sendSync|send|on)\(\s*([^,)]+)/g;
  const out = [];
  let match;
  while ((match = callRegex.exec(source))) {
    const raw = match[2].trim();
    const literal = raw.match(/^"([^"]+)"$/)?.[1];
    const channel = literal ?? enumValues[raw];
    if (!channel || channel.startsWith("$eipc_message") || parseEipc(channel)) continue;
    out.push({ file, mode: match[1], channel });
  }
  return out;
}

function uniqueBy(entries, keyFn) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = keyFn(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

async function extractOfficialChannels() {
  const entries = [];
  for (const file of preloadFiles) {
    const filePath = path.join(mirrorViteRoot, file);
    if (!fsSync.existsSync(filePath)) continue;
    entries.push(...parseChannels(await fs.readFile(filePath, "utf8"), file));
  }
  return uniqueBy(entries, (entry) => `${entry.mode}\0${entry.channel}`);
}

async function extractOfficialDirectChannels() {
  const entries = [];
  for (const file of preloadFiles) {
    const filePath = path.join(mirrorViteRoot, file);
    if (!fsSync.existsSync(filePath)) continue;
    entries.push(...parseDirectChannels(await fs.readFile(filePath, "utf8"), file));
  }
  return uniqueBy(entries, (entry) => `${entry.mode}\0${entry.channel}`);
}

async function walkFiles(root, prefix = "") {
  const out = [];
  if (!fsSync.existsSync(root)) return out;
  for (const dirent of await fs.readdir(root, { withFileTypes: true })) {
    const rel = prefix ? path.join(prefix, dirent.name) : dirent.name;
    const abs = path.join(root, dirent.name);
    if (dirent.isDirectory()) out.push(...(await walkFiles(abs, rel)));
    else if (sourceExtensions.has(path.extname(dirent.name))) out.push(rel);
  }
  return out.sort();
}

function exprText(expr) {
  expr = unwrapExpression(expr);
  if (!expr) return null;
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return expr.getLiteralText();
  return null;
}

function unwrapExpression(expr) {
  let current = expr;
  while (
    current &&
    (Node.isAsExpression(current) ||
      Node.isTypeAssertion(current) ||
      Node.isSatisfiesExpression?.(current) ||
      Node.isParenthesizedExpression(current))
  ) {
    current = current.getExpression();
  }
  return current;
}

function propName(prop) {
  const nameNode = prop.getNameNode?.();
  if (!nameNode) return null;
  if (Node.isIdentifier(nameNode) || Node.isStringLiteral(nameNode) || Node.isNoSubstitutionTemplateLiteral(nameNode) || Node.isNumericLiteral(nameNode)) return nameNode.getText().replace(/^['"]|['"]$/g, "");
  return null;
}

function findVarInitializer(sourceFile, name) {
  const declarations = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration).filter((decl) => decl.getName() === name);
  return declarations[0]?.getInitializer() ?? null;
}

function stringArrayFromExpression(expr, sourceFile) {
  expr = unwrapExpression(expr);
  if (!expr) return [];
  if (Node.isIdentifier(expr)) return stringArrayFromExpression(findVarInitializer(sourceFile, expr.getText()), sourceFile);
  if (!Node.isArrayLiteralExpression(expr)) return [];
  return expr.getElements().map((item) => exprText(item)).filter(Boolean);
}

function objectLiteralFromExpression(expr, sourceFile) {
  expr = unwrapExpression(expr);
  if (!expr) return null;
  if (Node.isObjectLiteralExpression(expr)) return expr;
  if (Node.isIdentifier(expr)) {
    const init = findVarInitializer(sourceFile, expr.getText());
    return init && Node.isObjectLiteralExpression(init) ? init : null;
  }
  return null;
}

function factoryReturnObjectMethods(project, functionName) {
  for (const sourceFile of project.getSourceFiles()) {
    const declaration = sourceFile.getFunction(functionName);
    if (!declaration) continue;
    const body = declaration.getBody();
    if (!body) continue;
    for (const returnStatement of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      const expression = unwrapExpression(returnStatement.getExpression());
      if (expression && Node.isObjectLiteralExpression(expression)) return methodNamesFromObjectLiteral(expression);
    }
  }
  return [];
}

function methodNamesFromObjectLiteral(objectLiteral) {
  const methods = [];
  for (const prop of objectLiteral.getProperties()) {
    if (Node.isSpreadAssignment(prop)) continue;
    const name = propName(prop);
    if (name) methods.push(name);
  }
  return methods;
}

function handlerMethodsFromExpression(expr, sourceFile, project) {
  expr = unwrapExpression(expr);
  const objectLiteral = objectLiteralFromExpression(expr, sourceFile);
  if (objectLiteral) return methodNamesFromObjectLiteral(objectLiteral);
  if (Node.isIdentifier(expr)) {
    const init = findVarInitializer(sourceFile, expr.getText());
    return init ? handlerMethodsFromExpression(init, sourceFile, project) : [];
  }
  if (Node.isCallExpression(expr)) {
    const callee = expr.getExpression().getText();
    if (callee === "createSessionHandlers") return stringArrayFromExpression(expr.getArguments()[2], sourceFile);
    const factoryMethods = factoryReturnObjectMethods(project, callee);
    if (factoryMethods.length > 0) return factoryMethods;
  }
  return [];
}

function addRegistered(registered, sourceFile, mode, namespace, iface, method, owner) {
  if (!namespace || !iface || !method) return;
  registered.push({ mode, namespace, iface, method, channel: buildIpcChannel(namespace, iface, method), source: path.relative(projectRoot, sourceFile.getFilePath()), owner });
}

function extractBuildIpcChannel(arg, sourceFile) {
  if (!arg) return null;
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) return { channel: arg.getLiteralText() };
  if (Node.isPropertyAccessExpression(arg)) return null;
  if (Node.isCallExpression(arg) && arg.getExpression().getText() === "buildIpcChannel") {
    const args = arg.getArguments();
    const namespace = exprText(args[0]);
    const iface = exprText(args[1]);
    const method = exprText(args[2]);
    return namespace && iface && method ? { namespace, iface, method, channel: buildIpcChannel(namespace, iface, method) } : null;
  }
  if (Node.isIdentifier(arg)) {
    const init = findVarInitializer(sourceFile, arg.getText());
    return init ? extractBuildIpcChannel(init, sourceFile) : null;
  }
  return null;
}

function directChannelFromExpression(expr, sourceFile) {
  expr = unwrapExpression(expr);
  if (!expr) return null;
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return expr.getLiteralText();
  if (Node.isIdentifier(expr)) {
    const init = findVarInitializer(sourceFile, expr.getText());
    return init ? directChannelFromExpression(init, sourceFile) : null;
  }
  if (Node.isPropertyAccessExpression(expr)) {
    const objectName = expr.getExpression().getText();
    const propertyName = expr.getName();
    const objectLiteral = objectLiteralFromExpression(findVarInitializer(sourceFile, objectName), sourceFile);
    if (!objectLiteral) return null;
    for (const prop of objectLiteral.getProperties()) {
      if (!Node.isPropertyAssignment(prop) || propName(prop) !== propertyName) continue;
      return directChannelFromExpression(prop.getInitializer(), sourceFile);
    }
  }
  return null;
}

function extractSourceRegistrations() {
  const project = new Project({ tsConfigFilePath: path.join(projectRoot, "tsconfig.json"), skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(path.join(sourceMainRoot, "**/*.ts"));
  const registered = [];
  const dispatched = [];
  const directRegistered = [];
  const directDispatched = [];

  for (const sourceFile of project.getSourceFiles()) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression().getText();
      const args = call.getArguments();
      if (callee === "registerNamespaceHandlers") {
        const namespace = exprText(args[0]);
        const namespaceObject = objectLiteralFromExpression(args[1], sourceFile);
        if (!namespace || !namespaceObject) continue;
        for (const ifaceProp of namespaceObject.getProperties()) {
          const iface = propName(ifaceProp);
          const initializer = Node.isPropertyAssignment(ifaceProp) ? ifaceProp.getInitializer() : null;
          const ifaceObject = objectLiteralFromExpression(initializer, sourceFile);
          if (!iface) continue;
          const methods = ifaceObject ? methodNamesFromObjectLiteral(ifaceObject) : handlerMethodsFromExpression(initializer, sourceFile, project);
          for (const method of methods) addRegistered(registered, sourceFile, "invoke", namespace, iface, method, "registerNamespaceHandlers");
        }
      }
      if (callee === "registerInterfaceHandlers" || callee === "registerInterfaceSyncHandlers") {
        const namespace = exprText(args[0]);
        const iface = exprText(args[1]);
        const mode = callee === "registerInterfaceSyncHandlers" ? "sendSync" : "invoke";
        if (!namespace || !iface) continue;
        for (const method of handlerMethodsFromExpression(args[2], sourceFile, project)) addRegistered(registered, sourceFile, mode, namespace, iface, method, callee);
      }
      if (callee === "registerDirectInvokeHandler" || callee === "registerDirectSyncHandler") {
        const mode = callee === "registerDirectSyncHandler" ? "sendSync" : "invoke";
        const parsed = extractBuildIpcChannel(args[0], sourceFile);
        if (parsed?.namespace) addRegistered(registered, sourceFile, mode, parsed.namespace, parsed.iface, parsed.method, callee);
        else {
          const channel = directChannelFromExpression(args[0], sourceFile);
          if (channel) directRegistered.push({ mode, channel, source: path.relative(projectRoot, sourceFile.getFilePath()), owner: callee });
        }
      }
      if (callee === "registerStoreState") {
        const objectLiteral = objectLiteralFromExpression(args[0], sourceFile);
        if (!objectLiteral) continue;
        const values = {};
        for (const prop of objectLiteral.getProperties()) {
          if (!Node.isPropertyAssignment(prop)) continue;
          const name = propName(prop);
          const value = exprText(prop.getInitializer());
          if (name && value) values[name] = value;
        }
        if (values.namespace && values.iface && values.storeName) {
          addRegistered(registered, sourceFile, "invoke", values.namespace, values.iface, `${values.storeName}_$store$_getState`, "registerStoreState");
          addRegistered(registered, sourceFile, "sendSync", values.namespace, values.iface, `${values.storeName}_$store$_getStateSync`, "registerStoreState");
        }
      }
      if (callee === "dispatchBridgeEvent") {
        const namespace = exprText(args[1]);
        const iface = exprText(args[2]);
        const method = exprText(args[3]);
        if (namespace && iface && method) dispatched.push({ namespace, iface, method, channel: buildIpcChannel(namespace, iface, method), source: path.relative(projectRoot, sourceFile.getFilePath()) });
      }
      if (callee.endsWith(".send")) {
        const channel = directChannelFromExpression(args[0], sourceFile);
        if (channel && !channel.startsWith("$eipc_message")) directDispatched.push({ mode: "on", channel, source: path.relative(projectRoot, sourceFile.getFilePath()) });
      }
    }
  }

  return {
    registered: uniqueBy(registered, (entry) => `${entry.mode}\0${entry.channel}`),
    dispatched: uniqueBy(dispatched, (entry) => entry.channel),
    directRegistered: uniqueBy(directRegistered, (entry) => `${entry.mode}\0${entry.channel}`),
    directDispatched: uniqueBy(directDispatched, (entry) => `${entry.mode}\0${entry.channel}`),
  };
}

function summarize(entries) {
  const tree = {};
  for (const entry of entries) {
    const parsed = entry.parsed ?? entry;
    if (!parsed?.namespace) continue;
    tree[parsed.namespace] ??= {};
    tree[parsed.namespace][parsed.iface] ??= [];
    if (!tree[parsed.namespace][parsed.iface].includes(parsed.method)) tree[parsed.namespace][parsed.iface].push(parsed.method);
  }
  for (const namespace of Object.keys(tree)) {
    for (const iface of Object.keys(tree[namespace])) tree[namespace][iface].sort();
    tree[namespace] = Object.fromEntries(Object.entries(tree[namespace]).sort());
  }
  return Object.fromEntries(Object.entries(tree).sort());
}

async function collectDebtMarkers() {
  const hits = [];
  for (const rel of await walkFiles(sourceMainRoot)) {
    const file = path.join(sourceMainRoot, rel);
    const source = await fs.readFile(file, "utf8");
    source.split(/\r?\n/).forEach((line, index) => {
      if (debtMarker.test(line)) hits.push({ file: path.relative(projectRoot, file), line: index + 1, text: line.trim() });
    });
  }
  return hits;
}

const officialChannels = await extractOfficialChannels();
const officialDirectChannels = await extractOfficialDirectChannels();
const officialInvoke = officialChannels.filter((entry) => entry.mode === "invoke" && entry.parsed);
const officialSync = officialChannels.filter((entry) => entry.mode === "sendSync" && entry.parsed);
const officialEvents = officialChannels.filter((entry) => entry.mode === "on" && entry.parsed);
const officialDirectInvoke = officialDirectChannels.filter((entry) => entry.mode === "invoke");
const officialDirectEvents = officialDirectChannels.filter((entry) => entry.mode === "on");
const { registered, dispatched, directRegistered, directDispatched } = extractSourceRegistrations();
const debtMarkers = await collectDebtMarkers();

const registeredInvokeSet = new Set(registered.filter((entry) => entry.mode === "invoke").map((entry) => entry.channel));
const registeredSyncSet = new Set(registered.filter((entry) => entry.mode === "sendSync").map((entry) => entry.channel));
const dispatchedSet = new Set(dispatched.map((entry) => entry.channel));
const directRegisteredInvokeSet = new Set(directRegistered.filter((entry) => entry.mode === "invoke").map((entry) => entry.channel));
const directDispatchedEventSet = new Set(directDispatched.filter((entry) => entry.mode === "on").map((entry) => entry.channel));

const missingInvoke = officialInvoke.filter((entry) => !registeredInvokeSet.has(entry.channel));
const missingSync = officialSync.filter((entry) => !registeredSyncSet.has(entry.channel));
const missingEvents = officialEvents.filter((entry) => !dispatchedSet.has(entry.channel));
const extraInvoke = registered.filter((entry) => entry.mode === "invoke" && !officialInvoke.some((official) => official.channel === entry.channel));
const extraSync = registered.filter((entry) => entry.mode === "sendSync" && !officialSync.some((official) => official.channel === entry.channel));
const missingDirectInvoke = officialDirectInvoke.filter((entry) => !directRegisteredInvokeSet.has(entry.channel));
const missingDirectEvents = officialDirectEvents.filter((entry) => !directDispatchedEventSet.has(entry.channel));
const extraDirectInvoke = directRegistered.filter((entry) => entry.mode === "invoke" && !officialDirectInvoke.some((official) => official.channel === entry.channel));
const extraDirectEvents = directDispatched.filter((entry) => entry.mode === "on" && !officialDirectEvents.some((official) => official.channel === entry.channel));

const report = {
  generated_at: new Date().toISOString(),
  mirror_root: mirrorRoot,
  official: {
    total_channels: officialChannels.length,
    direct_channel_count: officialDirectChannels.length,
    invoke_count: officialInvoke.length,
    send_sync_count: officialSync.length,
    renderer_event_count: officialEvents.length,
    direct_invoke_count: officialDirectInvoke.length,
    direct_event_count: officialDirectEvents.length,
    invoke_tree: summarize(officialInvoke),
    send_sync_tree: summarize(officialSync),
    renderer_event_tree: summarize(officialEvents),
  },
  source: {
    registered_invoke_count: registered.filter((entry) => entry.mode === "invoke").length,
    registered_send_sync_count: registered.filter((entry) => entry.mode === "sendSync").length,
    dispatched_event_count: dispatched.length,
    direct_registered_invoke_count: directRegistered.filter((entry) => entry.mode === "invoke").length,
    direct_dispatched_event_count: directDispatched.filter((entry) => entry.mode === "on").length,
    registered_tree: summarize(registered),
    dispatched_tree: summarize(dispatched),
  },
  gap: {
    missing_invoke_count: missingInvoke.length,
    missing_send_sync_count: missingSync.length,
    missing_renderer_event_dispatch_count: missingEvents.length,
    extra_source_invoke_count: extraInvoke.length,
    extra_source_send_sync_count: extraSync.length,
    missing_direct_invoke_count: missingDirectInvoke.length,
    missing_direct_event_dispatch_count: missingDirectEvents.length,
    extra_direct_invoke_count: extraDirectInvoke.length,
    extra_direct_event_dispatch_count: extraDirectEvents.length,
    missing_invoke: missingInvoke.map((entry) => ({ file: entry.file, ...entry.parsed, channel: entry.channel })),
    missing_send_sync: missingSync.map((entry) => ({ file: entry.file, ...entry.parsed, channel: entry.channel })),
    missing_renderer_event_dispatch: missingEvents.map((entry) => ({ file: entry.file, ...entry.parsed, channel: entry.channel })),
    extra_source_invoke: extraInvoke,
    extra_source_send_sync: extraSync,
    missing_direct_invoke: missingDirectInvoke,
    missing_direct_event_dispatch: missingDirectEvents,
    extra_direct_invoke: extraDirectInvoke,
    extra_direct_event_dispatch: extraDirectEvents,
  },
  debt_markers: debtMarkers,
  ok: missingInvoke.length === 0
    && missingSync.length === 0
    && missingEvents.length === 0
    && extraInvoke.length === 0
    && extraSync.length === 0
    && missingDirectInvoke.length === 0
    && missingDirectEvents.length === 0
    && extraDirectInvoke.length === 0
    && extraDirectEvents.length === 0,
};

await fs.mkdir(docsRoot, { recursive: true });
await fs.writeFile(path.join(docsRoot, "desktop-internal-function-audit.json"), `${JSON.stringify(report, null, 2)}\n`);

function mdTree(tree, limit = 120) {
  const rows = [];
  for (const [namespace, ifaces] of Object.entries(tree)) {
    for (const [iface, methods] of Object.entries(ifaces)) rows.push(`| ${namespace} | ${iface} | ${methods.length} | ${methods.join(", ")} |`);
  }
  return rows.slice(0, limit).join("\n");
}

const markdown = `# Desktop internal function audit\n\n` +
  `Generated: ${report.generated_at}\n\n` +
  `## Summary\n\n` +
  `- Official preload invoke methods: ${report.official.invoke_count}\n` +
  `- Official preload sendSync methods: ${report.official.send_sync_count}\n` +
  `- Official renderer event listeners: ${report.official.renderer_event_count}\n` +
  `- Official direct app binding invoke methods: ${report.official.direct_invoke_count}\n` +
  `- Official direct app binding event listeners: ${report.official.direct_event_count}\n` +
  `- Source registered invoke methods: ${report.source.registered_invoke_count}\n` +
  `- Source registered sendSync methods: ${report.source.registered_send_sync_count}\n` +
  `- Source dispatched event methods: ${report.source.dispatched_event_count}\n` +
  `- Source direct registered invoke methods: ${report.source.direct_registered_invoke_count}\n` +
  `- Source direct dispatched event methods: ${report.source.direct_dispatched_event_count}\n` +
  `- Missing invoke handlers: ${report.gap.missing_invoke_count}\n` +
  `- Missing sendSync handlers: ${report.gap.missing_send_sync_count}\n` +
  `- Missing event dispatch sites: ${report.gap.missing_renderer_event_dispatch_count}\n` +
  `- Extra source invoke handlers: ${report.gap.extra_source_invoke_count}\n` +
  `- Extra source sendSync handlers: ${report.gap.extra_source_send_sync_count}\n` +
  `- Missing direct invoke handlers: ${report.gap.missing_direct_invoke_count}\n` +
  `- Missing direct event dispatch sites: ${report.gap.missing_direct_event_dispatch_count}\n` +
  `- Extra direct invoke handlers: ${report.gap.extra_direct_invoke_count}\n` +
  `- Extra direct event dispatch sites: ${report.gap.extra_direct_event_dispatch_count}\n` +
  `- Internal request/event surface ok: ${report.ok ? "yes" : "no"}\n\n` +
  `## Official internal invoke tree\n\n` +
  `| namespace | interface | methods | names |\n| --- | --- | ---: | --- |\n${mdTree(report.official.invoke_tree)}\n\n` +
  `## Missing request handlers\n\n` +
  (report.gap.missing_invoke.length || report.gap.missing_send_sync.length
    ? [...report.gap.missing_invoke, ...report.gap.missing_send_sync].map((entry) => `- ${entry.namespace}.${entry.iface}.${entry.method} (${entry.file})`).join("\n")
    : `None.\n`) +
  `\n\n## Event dispatch gaps\n\n` +
  (report.gap.missing_renderer_event_dispatch.length
    ? report.gap.missing_renderer_event_dispatch.slice(0, 120).map((entry) => `- ${entry.namespace}.${entry.iface}.${entry.method} (${entry.file})`).join("\n")
    : `None.\n`) +
  `\n\nFull machine-readable report: \`docs/desktop-internal-function-audit.json\`\n`;
await fs.writeFile(path.join(docsRoot, "desktop-internal-function-audit.md"), markdown);
console.log(JSON.stringify({
  official_invoke: report.official.invoke_count,
  official_sendSync: report.official.send_sync_count,
  official_direct_invoke: report.official.direct_invoke_count,
  official_direct_events: report.official.direct_event_count,
  source_invoke: report.source.registered_invoke_count,
  source_sendSync: report.source.registered_send_sync_count,
  source_direct_invoke: report.source.direct_registered_invoke_count,
  source_direct_events: report.source.direct_dispatched_event_count,
  missing_invoke: report.gap.missing_invoke_count,
  missing_sendSync: report.gap.missing_send_sync_count,
  missing_events: report.gap.missing_renderer_event_dispatch_count,
  extra_invoke: report.gap.extra_source_invoke_count,
  extra_sendSync: report.gap.extra_source_send_sync_count,
  missing_direct_invoke: report.gap.missing_direct_invoke_count,
  missing_direct_events: report.gap.missing_direct_event_dispatch_count,
  extra_direct_invoke: report.gap.extra_direct_invoke_count,
  extra_direct_events: report.gap.extra_direct_event_dispatch_count,
  debt_markers: report.debt_markers.length,
  ok: report.ok,
}, null, 2));
if (!report.ok) process.exit(1);
