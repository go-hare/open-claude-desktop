import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const docsRoot = path.join(workspaceRoot, "docs");
const originalPreloadRoot = path.join(workspaceRoot, "electron-shell-source/app-asar/.vite/build");
const originalPreloadFiles = ["mainView.js", "mainWindow.js", "findInPage.js", "aboutWindow.js", "quickWindow.js", "buddy.js", "coworkArtifact.js"];
const officialNamespaces = new Set([
  "claude.web",
  "claude.settings",
  "claude.skills",
  "claude.hybrid",
  "claude.simulator",
  "claude.officeAddin",
  "claude.buddy",
  "claude.internal.ui",
  "claude.internal.findInPage",
  "claude.coworkArtifact",
]);

const bridgeSpecs = [
  ["claude.web", "electron/preload/bridges/webBridge.ts", "webBridgeSpec"],
  ["claude.settings", "electron/preload/bridges/settingsBridge.ts", "settingsBridgeSpec"],
  ["claude.hybrid", "electron/preload/bridges/hybridBridge.ts", "hybridBridgeSpec"],
  ["claude.skills", "electron/preload/bridges/mainViewExtraBridge.ts", "skillsBridgeSpec"],
  ["claude.simulator", "electron/preload/bridges/mainViewExtraBridge.ts", "simulatorBridgeSpec"],
  ["claude.officeAddin", "electron/preload/bridges/mainViewExtraBridge.ts", "officeAddinBridgeSpec"],
  ["claude.buddy", "electron/preload/bridges/mainViewExtraBridge.ts", "buddyBridgeSpec"],
  ["claude.internal.ui", "electron/preload/bridges/internalUiBridge.ts", "internalUiBridgeSpec"],
  ["claude.internal.findInPage", "electron/preload/bridges/findInPageBridge.ts", "internalFindInPageBridgeSpec"],
  ["claude.coworkArtifact", "electron/preload/bridges/coworkArtifactBridge.ts", "coworkArtifactBridgeSpec"],
];

function key(namespace, iface) {
  return `${namespace}.${iface}`;
}

async function readProjectFile(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), "utf8");
}

async function parseProjectFile(relativePath) {
  const source = await readProjectFile(relativePath);
  return ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function propertyName(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function stringLiteralValue(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function unwrapExpression(node) {
  let current = node;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression?.(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function stringArrayLiteral(node) {
  const expression = unwrapExpression(node);
  if (!ts.isArrayLiteralExpression(expression)) return null;
  const values = [];
  for (const element of expression.elements) {
    const value = stringLiteralValue(element);
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

function collectConstArrays(sourceFile) {
  const arrays = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const values = stringArrayLiteral(declaration.initializer);
      if (values) arrays.set(declaration.name.text, values);
    }
  }
  return arrays;
}

function arrayFromExpression(expression, constArrays) {
  const literal = stringArrayLiteral(expression);
  if (literal) return literal;
  if (ts.isIdentifier(expression)) return constArrays.get(expression.text) ?? [];
  return [];
}

function findConstInitializer(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer;
    }
  }
  return null;
}

async function extractBridgeSpec(namespace, relativePath, exportName) {
  const sourceFile = await parseProjectFile(relativePath);
  const constArrays = collectConstArrays(sourceFile);
  const initializer = findConstInitializer(sourceFile, exportName);
  const entries = new Map();
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) return entries;

  for (const ifaceProp of initializer.properties) {
    if (!ts.isPropertyAssignment(ifaceProp) || !ts.isObjectLiteralExpression(ifaceProp.initializer)) continue;
    const iface = propertyName(ifaceProp.name);
    if (!iface) continue;
    const spec = { invoke: [], sync: [], events: [] };
    for (const methodProp of ifaceProp.initializer.properties) {
      if (!ts.isPropertyAssignment(methodProp)) continue;
      const methodKind = propertyName(methodProp.name);
      if (methodKind !== "invoke" && methodKind !== "sync" && methodKind !== "events") continue;
      spec[methodKind] = arrayFromExpression(methodProp.initializer, constArrays);
    }
    entries.set(key(namespace, iface), spec);
  }
  return entries;
}

function methodNamesFromObject(objectLiteral) {
  const methods = [];
  for (const prop of objectLiteral.properties) {
    if (ts.isSpreadAssignment(prop)) continue;
    const name = propertyName(prop.name);
    if (name) methods.push(name);
  }
  return methods;
}

function addMethods(map, namespace, iface, methods) {
  const id = key(namespace, iface);
  const existing = map.get(id) ?? new Set();
  for (const method of methods) existing.add(method);
  map.set(id, existing);
}

function collectRegisterCalls(sourceFile, constArrays, handlerMap) {
  function visit(node) {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
      ts.forEachChild(node, visit);
      return;
    }

    const callee = node.expression.text;
    if (callee === "registerNamespaceHandlers") {
      const namespace = stringLiteralValue(node.arguments[0]);
      const handlers = node.arguments[1];
      if (namespace && handlers && ts.isObjectLiteralExpression(handlers)) {
        for (const ifaceProp of handlers.properties) {
          if (!ts.isPropertyAssignment(ifaceProp) || !ts.isObjectLiteralExpression(ifaceProp.initializer)) continue;
          const iface = propertyName(ifaceProp.name);
          if (iface) addMethods(handlerMap, namespace, iface, methodNamesFromObject(ifaceProp.initializer));
        }
      }
    }

    if (callee === "registerInterfaceHandlers" || callee === "registerInterfaceSyncHandlers") {
      const namespace = stringLiteralValue(node.arguments[0]);
      const iface = stringLiteralValue(node.arguments[1]);
      const handlers = node.arguments[2];
      if (namespace && iface && handlers) {
        if (ts.isObjectLiteralExpression(handlers)) {
          addMethods(handlerMap, namespace, iface, methodNamesFromObject(handlers));
        } else if (ts.isCallExpression(handlers) && ts.isIdentifier(handlers.expression) && handlers.expression.text === "createSessionHandlers") {
          const methodArg = handlers.arguments[2];
          if (methodArg && ts.isIdentifier(methodArg)) addMethods(handlerMap, namespace, iface, constArrays.get(methodArg.text) ?? []);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function directReturnObjectKeys(sourceFile, functionName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name?.text !== functionName || !statement.body) continue;
    for (const bodyStatement of statement.body.statements) {
      if (ts.isReturnStatement(bodyStatement) && bodyStatement.expression && ts.isObjectLiteralExpression(bodyStatement.expression)) {
        return methodNamesFromObject(bodyStatement.expression);
      }
    }
  }
  return [];
}

function collectStoreStateMethods(sourceFile, handlerMap) {
  function visit(node) {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "registerStoreState") {
      ts.forEachChild(node, visit);
      return;
    }
    const arg = node.arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) return;
    const values = {};
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = propertyName(prop.name);
      const value = stringLiteralValue(prop.initializer);
      if (name && value) values[name] = value;
    }
    if (values.namespace && values.iface && values.storeName) {
      addMethods(handlerMap, values.namespace, values.iface, [
        `${values.storeName}_$store$_getState`,
        `${values.storeName}_$store$_getStateSync`,
      ]);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

async function walkTsFiles(dir, prefix = "") {
  const out = [];
  for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
    const abs = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...await walkTsFiles(abs, rel));
    else if (dirent.name.endsWith(".ts")) out.push(rel);
  }
  return out.sort();
}

function emptyOfficialSpec() {
  return { invoke: new Set(), sync: new Set(), events: new Set(), send: new Set(), files: new Set() };
}

async function parseOfficialPreloadBridgeSpecs() {
  const specs = new Map();
  const callRegex = /ipcRenderer\.(invoke|sendSync|send|on)\(\s*["']([^"']+)["']/g;

  for (const fileName of originalPreloadFiles) {
    let source = "";
    try {
      source = await fs.readFile(path.join(originalPreloadRoot, fileName), "utf8");
    } catch {
      continue;
    }
    let match;
    while ((match = callRegex.exec(source))) {
      const parts = match[2].split("_$_");
      if (parts.length < 4) continue;
      const namespace = parts[1];
      const iface = parts[2];
      const method = parts.slice(3).join("_$_");
      if (!officialNamespaces.has(namespace)) continue;
      const id = key(namespace, iface);
      const spec = specs.get(id) ?? emptyOfficialSpec();
      if (match[1] === "invoke") spec.invoke.add(method);
      else if (match[1] === "sendSync") spec.sync.add(method);
      else if (match[1] === "on") spec.events.add(method);
      else spec.send.add(method);
      spec.files.add(fileName);
      specs.set(id, spec);
    }
  }

  return specs;
}

function sorted(values) {
  return [...values].sort();
}

function compareLists(expected, actual) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    missing: expected.filter((item) => !actualSet.has(item)),
    extra: actual.filter((item) => !expectedSet.has(item)),
  };
}

async function collectCurrentBridgeSpecs() {
  const specs = new Map();
  for (const [namespace, relativePath, exportName] of bridgeSpecs) {
    for (const [id, spec] of await extractBridgeSpec(namespace, relativePath, exportName)) specs.set(id, spec);
  }
  return specs;
}

async function collectMainHandlers() {
  const handlerMap = new Map();
  const ipcRoot = path.join(projectRoot, "electron/main/ipc");
  for (const relativePath of await walkTsFiles(ipcRoot)) {
    const sourceFile = await parseProjectFile(`electron/main/ipc/${relativePath}`);
    const constArrays = collectConstArrays(sourceFile);
    collectRegisterCalls(sourceFile, constArrays, handlerMap);
    if (relativePath === "storeStateHandlers.ts") collectStoreStateMethods(sourceFile, handlerMap);
  }

  const scheduledSource = await parseProjectFile("electron/main/ipc/scheduledTasksHandlers.ts");
  const scheduledMethods = directReturnObjectKeys(scheduledSource, "createScheduledHandlers");
  addMethods(handlerMap, "claude.web", "CCDScheduledTasks", scheduledMethods);
  addMethods(handlerMap, "claude.web", "CoworkScheduledTasks", scheduledMethods);

  const fileSystemSource = await parseProjectFile("electron/main/ipc/fileSystemHandlers.ts");
  addMethods(handlerMap, "claude.web", "FileSystem", directReturnObjectKeys(fileSystemSource, "createFileSystemHandlers"));

  return handlerMap;
}

const failures = [];
const currentSpecs = await collectCurrentBridgeSpecs();
const mainHandlers = await collectMainHandlers();
const officialSpecs = await parseOfficialPreloadBridgeSpecs();

const interfaceResults = [];
for (const id of sorted(officialSpecs.keys())) {
  const current = currentSpecs.get(id);
  const official = officialSpecs.get(id) ?? emptyOfficialSpec();
  const handlers = sorted(mainHandlers.get(id) ?? []);
  const currentInvoke = sorted(current?.invoke ?? []);
  const currentSync = sorted(current?.sync ?? []);
  const currentEvents = sorted(current?.events ?? []);
  const invokeCompare = compareLists(sorted(official.invoke), currentInvoke);
  const syncCompare = compareLists(sorted(official.sync), currentSync);
  const eventCompare = compareLists(sorted(official.events), currentEvents);
  const sendCompare = compareLists(sorted(official.send), []);
  const requiredHandlers = sorted([...official.invoke, ...official.sync]);
  const handlerCompare = compareLists(requiredHandlers, handlers);
  const ok = Boolean(current)
    && invokeCompare.missing.length === 0
    && invokeCompare.extra.length === 0
    && syncCompare.missing.length === 0
    && syncCompare.extra.length === 0
    && eventCompare.missing.length === 0
    && eventCompare.extra.length === 0
    && sendCompare.missing.length === 0
    && handlerCompare.missing.length === 0;
  if (!current) failures.push(`Missing current bridge spec for ${id}`);
  if (invokeCompare.missing.length > 0 || invokeCompare.extra.length > 0) failures.push(`${id} invoke surface differs from original`);
  if (syncCompare.missing.length > 0 || syncCompare.extra.length > 0) failures.push(`${id} sync surface differs from original`);
  if (eventCompare.missing.length > 0 || eventCompare.extra.length > 0) failures.push(`${id} event surface differs from original`);
  if (sendCompare.missing.length > 0) failures.push(`${id} send surface is not represented in current bridge spec`);
  if (handlerCompare.missing.length > 0) failures.push(`${id} main handlers missing: ${handlerCompare.missing.join(", ")}`);
  interfaceResults.push({
    interface: id,
    ok,
    original_count: official.invoke.size + official.sync.size + official.events.size + official.send.size,
    current_count: currentInvoke.length + currentSync.length + currentEvents.length,
    handler_count: handlers.length,
    files: sorted(official.files),
    invoke_missing: invokeCompare.missing,
    invoke_extra: invokeCompare.extra,
    sync_missing: syncCompare.missing,
    sync_extra: syncCompare.extra,
    event_missing: eventCompare.missing,
    event_extra: eventCompare.extra,
    send_missing: sendCompare.missing,
    required_handlers_missing: handlerCompare.missing,
    handler_extra_vs_required: handlerCompare.extra,
    invoke: currentInvoke,
    sync: currentSync,
    events: currentEvents,
  });
}

for (const id of sorted(currentSpecs.keys())) {
  const namespace = id.split(".").slice(0, 2).join(".");
  if (officialNamespaces.has(namespace) && !officialSpecs.has(id)) failures.push(`Current bridge spec exposes non-original interface ${id}`);
}

const mainIpcText = await Promise.all((await walkTsFiles(path.join(projectRoot, "electron/main/ipc"))).map((file) => readProjectFile(`electron/main/ipc/${file}`)));
const hardStubHits = [];
mainIpcText.join("\n").split(/\r?\n/).forEach((line, index) => {
  if (/runtime_absent|cloud_teleport_absent/i.test(line)) hardStubHits.push({ line: index + 1, text: line.trim() });
});
if (hardStubHits.length > 0) failures.push("Hard runtime absence markers remain in main IPC source");

const report = {
  generated_at: new Date().toISOString(),
  policy: {
    scope: "Full official preload IPC parity for claude.web, claude.settings, claude.skills, claude.hybrid, claude.simulator, claude.officeAddin, claude.buddy, claude.internal.*, and claude.coworkArtifact.",
    original_source: path.relative(workspaceRoot, originalPreloadRoot),
    rule: "Current preload method surfaces must match original invoke/sync/event channel modes exactly, and every invoke/sync method must have an explicit main-process handler rather than relying on original preload fallback.",
  },
  interfaces: interfaceResults,
  hard_stub_hits: hardStubHits,
  ok: failures.length === 0,
  failures,
};

await fs.mkdir(docsRoot, { recursive: true });
const jsonPath = path.join(docsRoot, "electron-shell-bridge-parity.json");
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const lines = interfaceResults.map((item) => (
  `| ${item.interface} | ${item.ok ? "yes" : "no"} | ${item.original_count} | ${item.current_count} | ${item.handler_count} | ${[
    ...item.invoke_missing.map((method) => `invoke:${method}`),
    ...item.sync_missing.map((method) => `sync:${method}`),
    ...item.event_missing.map((method) => `event:${method}`),
    ...item.required_handlers_missing.map((method) => `handler:${method}`),
  ].join(", ") || "-"} |`
));
const markdown = `# Electron Shell Bridge Parity\n\n` +
  `Generated: ${report.generated_at}\n\n` +
  `Scope: ${report.policy.scope}\n\n` +
  `| interface | ok | original | current | handlers | missing handlers |\n` +
  `|---|---:|---:|---:|---:|---|\n` +
  `${lines.join("\n")}\n\n` +
  `Failures:\n${failures.length ? failures.map((failure) => `- ${failure}`).join("\n") : "- none"}\n\n` +
  `Machine-readable report: \`docs/electron-shell-bridge-parity.json\`\n`;
const markdownPath = path.join(docsRoot, "electron-shell-bridge-parity.md");
await fs.writeFile(markdownPath, markdown);

console.log(path.relative(projectRoot, jsonPath));
console.log(path.relative(projectRoot, markdownPath));
console.log(JSON.stringify({
  ok: report.ok,
  checked_interfaces: interfaceResults.length,
  checked_methods: interfaceResults.reduce((count, item) => count + item.original_count, 0),
  failures,
}, null, 2));

if (failures.length > 0) process.exit(1);
