import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const external = ["electron", ...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)];
const appVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version ?? "0.0.0";

/** Product TypeScript preloads — including secondary windows formerly residual-only. */
const entries = [
  ["mainWindow", "electron/preload/mainWindow.ts"],
  ["mainView", "electron/preload/mainView.ts"],
  ["findInPage", "electron/preload/findInPage.ts"],
  ["coworkArtifact", "electron/preload/coworkArtifact.ts"],
  ["aboutWindow", "electron/preload/aboutWindow.ts"],
  ["quickWindow", "electron/preload/quickWindow.ts"],
  ["buddy", "electron/preload/buddy.ts"],
  ["computerUseTeach", "electron/preload/computerUseTeach.ts"],
];

for (const [name, relativeEntry] of entries) {
  await build({
    root,
    publicDir: false,
    define: {
      __CLAUDEX_APP_VERSION__: JSON.stringify(appVersion),
    },
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
