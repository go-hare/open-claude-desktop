import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";

const external = ["electron", ...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)];

export default defineConfig({
  publicDir: false,
  build: {
    outDir: ".vite/build",
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    target: "node22",
    lib: {
      entry: {
        index: path.resolve(__dirname, "electron/main/index.ts"),
        "index.pre": path.resolve(__dirname, "electron/main/index.pre.ts"),
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
