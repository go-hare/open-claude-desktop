/**
 * Build product TypeScript UtilityProcess workers into .vite/build.
 *
 * Outputs (residual path parity):
 *   shell-path-worker/shellPathWorker.js
 *   transcript-search-worker/transcriptSearchWorker.js
 *   mcp-runtime/nodeHost.js
 *   mcp-runtime/directMcpHost.js
 */
import fs from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const external = ["electron", ...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)];

const workers = [
  {
    entry: "electron/workers/shellPathWorker.ts",
    outDir: ".vite/build/shell-path-worker",
    fileName: "shellPathWorker.js",
  },
  {
    entry: "electron/workers/transcriptSearchWorker.ts",
    outDir: ".vite/build/transcript-search-worker",
    fileName: "transcriptSearchWorker.js",
  },
  {
    entry: "electron/workers/nodeHost.ts",
    outDir: ".vite/build/mcp-runtime",
    fileName: "nodeHost.js",
  },
  {
    entry: "electron/workers/directMcpHost.ts",
    outDir: ".vite/build/mcp-runtime",
    fileName: "directMcpHost.js",
    // Residual bundles MCP SDK into the worker; product does the same so
    // UtilityProcess does not depend on residual vendor directMcpHost.js.
    external: ["electron", "electron/utility", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  },
];

for (const worker of workers) {
  const outDir = path.join(root, worker.outDir);
  await fs.mkdir(outDir, { recursive: true });
  const workerExternal = worker.external ?? external;
  await build({
    root,
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: false,
      minify: false,
      target: "node22",
      lib: {
        entry: path.join(root, worker.entry),
        formats: ["cjs"],
        fileName: () => worker.fileName,
      },
      rollupOptions: {
        external: workerExternal,
        output: {
          inlineDynamicImports: true,
          exports: "named",
          entryFileNames: worker.fileName,
        },
      },
    },
  });
  console.log(`[build-workers] ${worker.outDir}/${worker.fileName}`);
}
