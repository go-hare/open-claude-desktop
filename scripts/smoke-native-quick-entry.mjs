#!/usr/bin/env node
/**
 * Electron-main smoke: load @ant/claude-swift and toggle quickAccess.overlay.
 * Usage: node node_modules/electron/cli.js scripts/smoke-native-quick-entry.mjs
 */
import { app } from "electron";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  await app.whenReady();
  // Dev FontLoader residual: Swift looks under process.resourcesPath/fonts
  const fontsSrc = path.join(root, "resources/fonts");
  const fontsDst = path.join(process.resourcesPath, "fonts");
  if (fs.existsSync(fontsSrc) && !fs.existsSync(fontsDst)) {
    try {
      fs.symlinkSync(fontsSrc, fontsDst);
      console.log("[smoke] linked fonts →", fontsDst);
    } catch (e) {
      console.warn("[smoke] fonts link failed", e);
    }
  }

  const pkgJson = path.join(
    root,
    "resources/original-runtime-node_modules/node_modules/@ant/claude-swift/package.json",
  );
  if (!fs.existsSync(pkgJson)) {
    console.error("[smoke] FAIL missing claude-swift package", pkgJson);
    app.exit(2);
    return;
  }
  const req = createRequire(pkgJson);
  let mod;
  try {
    mod = req(path.dirname(pkgJson));
  } catch (e) {
    console.error("[smoke] FAIL require", e);
    app.exit(3);
    return;
  }
  const nr = mod?.default ?? mod;
  const toggle = nr?.quickAccess?.overlay?.toggle;
  console.log("[smoke] keys", Object.keys(nr || {}));
  console.log("[smoke] has toggle", typeof toggle);
  if (typeof toggle !== "function") {
    console.error("[smoke] FAIL no overlay.toggle");
    app.exit(4);
    return;
  }
  try {
    console.log("[smoke] calling toggle() …");
    await toggle.call(nr.quickAccess.overlay);
    console.log("[smoke] toggle() returned OK — leave overlay up 4s");
    await new Promise((r) => setTimeout(r, 4000));
    await toggle.call(nr.quickAccess.overlay);
    console.log("[smoke] toggle off OK");
    app.exit(0);
  } catch (e) {
    console.error("[smoke] FAIL toggle", e);
    app.exit(5);
  }
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
