const fs = require("node:fs");
const path = require("node:path");

const packageName = "@ant/claude-swift";
let loadError = null;

function placeholder(member) {
  const suffix = member ? " member " + String(member) : "";
  const reason = loadError ? " Runtime load failed: " + loadError.message : "";
  throw new Error(packageName + suffix + " is a local built-in runtime proxy, but the copied native runtime is not usable on this platform yet." + reason);
}

function placeholderModule() {
  const callable = function antBuiltinRuntimePlaceholder() { return placeholder("default call"); };
  return new Proxy(callable, {
    apply() { return placeholder("default call"); },
    get(_target, prop) {
      if (prop === "__esModule") return false;
      if (prop === "default") return module.exports;
      if (prop === "then") return undefined;
      if (prop === Symbol.toStringTag) return "AntBuiltinRuntimeProxy";
      if (prop === "__loadError") return loadError;
      return function antBuiltinRuntimeMemberPlaceholder() { return placeholder(prop); };
    },
  });
}

function runtimeRoots() {
  const roots = [];
  if (process.env.CLAUDE_ORIGINAL_RUNTIME_NODE_MODULES) roots.push(process.env.CLAUDE_ORIGINAL_RUNTIME_NODE_MODULES);
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, "original-runtime-node_modules", "node_modules"));
  roots.push(path.resolve(__dirname, "../../../resources/original-runtime-node_modules/node_modules"));
  roots.push(path.resolve(process.cwd(), "resources/original-runtime-node_modules/node_modules"));
  return [...new Set(roots)];
}

function loadRuntimePackage() {
  const relativePackagePath = path.join(...packageName.split("/"));
  const tried = [];
  for (const root of runtimeRoots()) {
    const packagePath = path.join(root, relativePackagePath, "package.json");
    tried.push(packagePath);
    if (!fs.existsSync(packagePath)) continue;
    try {
      return require(path.dirname(packagePath));
    } catch (error) {
      loadError = error;
      return placeholderModule();
    }
  }
  loadError = new Error("runtime copy is missing. Run npm run copy:original-runtime first. Tried:\n" + tried.join("\n"));
  return placeholderModule();
}

module.exports = loadRuntimePackage();
