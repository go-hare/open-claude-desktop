#!/usr/bin/env node
/**
 * Copy stock Electron into .smoke-cowork-vm-electron and ad-hoc codesign with
 * com.apple.security.virtualization (matches official Claude Desktop).
 *
 * Stock node_modules/electron lacks this entitlement → swift reports
 * entitlement_missing. Does not mutate node_modules.
 *
 * Run once (or after electron upgrade):
 *   node scripts/prepare-smoke-electron.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules/electron/dist/Electron.app");
const outDir = path.join(root, ".smoke-cowork-vm-electron");
const dst = path.join(outDir, "Electron.app");
const entPath = path.join(outDir, "smoke.entitlements");
const bin = path.join(dst, "Contents/MacOS/Electron");

if (process.platform !== "darwin") {
  console.error("prepare-smoke-electron: darwin only");
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error("Stock Electron.app missing:", src);
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const ditto = spawnSync("ditto", [src, dst], { encoding: "utf8" });
if (ditto.status !== 0) {
  console.error("ditto failed:", ditto.stderr || ditto.stdout);
  process.exit(2);
}

// Swift looks for smol-bin under process.resourcesPath (Electron.app/Contents/Resources).
const resourcesDir = path.join(dst, "Contents/Resources");
const projectResources = path.join(root, "resources");
for (const name of ["smol-bin.arm64.img", "smol-bin.x64.img", "smol-bin.img"]) {
  const from = path.join(projectResources, name);
  if (!fs.existsSync(from)) continue;
  fs.copyFileSync(from, path.join(resourcesDir, name));
  console.log("copied", name, "into smoke Electron Resources");
}

const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.cs.allow-jit</key>
	<true/>
	<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
	<true/>
	<key>com.apple.security.cs.disable-library-validation</key>
	<true/>
	<key>com.apple.security.virtualization</key>
	<true/>
</dict>
</plist>
`;
fs.writeFileSync(entPath, entitlements);

const sign = spawnSync(
  "codesign",
  ["--force", "--deep", "--sign", "-", "--entitlements", entPath, dst],
  { encoding: "utf8" },
);
if (sign.status !== 0) {
  console.error("codesign failed:", sign.stderr || sign.stdout);
  process.exit(3);
}

const check = spawnSync(
  "codesign",
  ["-d", "--entitlements", "-", dst],
  { encoding: "utf8" },
);
const dump = `${check.stdout || ""}${check.stderr || ""}`;
const hasVirt = dump.includes("com.apple.security.virtualization");
console.log(JSON.stringify({
  ok: hasVirt && fs.existsSync(bin),
  electron: bin,
  virtualizationEntitlement: hasVirt,
}, null, 2));
process.exit(hasVirt && fs.existsSync(bin) ? 0 : 4);
