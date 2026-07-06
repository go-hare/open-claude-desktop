import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const external = ["electron", ...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)];
const entries = [
  ["mainWindow", "electron/preload/mainWindow.ts"],
  ["mainView", "electron/preload/mainView.ts"],
  ["findInPage", "electron/preload/findInPage.ts"],
  ["coworkArtifact", "electron/preload/coworkArtifact.ts"],
];

for (const [name, relativeEntry] of entries) {
  await build({
    root,
    publicDir: false,
    build: {
      outDir: path.join(root, ".vite/build"),
      emptyOutDir: false,
      sourcemap: false,
      minify: false,
      target: "node22",
      lib: {
        entry: path.join(root, relativeEntry),
        formats: ["cjs"],
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        external,
        output: {
          inlineDynamicImports: true,
          exports: "named",
        },
      },
    },
  });
}
