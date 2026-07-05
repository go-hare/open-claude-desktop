import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";

const external = ["electron", ...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)];

export default defineConfig({
  publicDir: false,
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    sourcemap: false,
    minify: false,
    target: "node22",
    lib: {
      entry: {
        mainWindow: path.resolve(__dirname, "electron/preload/mainWindow.ts"),
        mainView: path.resolve(__dirname, "electron/preload/mainView.ts"),
        findInPage: path.resolve(__dirname, "electron/preload/findInPage.ts"),
      },
      formats: ["cjs"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external,
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        exports: "named",
      },
    },
  },
});
