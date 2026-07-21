/**
 * Non-destructive dual-exec readiness probe (no startVM, no native require).
 * Checks smol-bin, claudevm.bundle/rootfs, and @ant/claude-swift package.json presence.
 *
 * Do NOT require() the swift native addon under plain Node — it expects Electron
 * (UNUserNotificationCenter / app bundle) and can abort the process.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const home = os.homedir();
const arch = process.arch === "arm64" ? "arm64" : "x64";

const userData =
  process.env.CLAUDE_VM_USERDATA
  || path.join(home, "Library/Application Support/Claude-Deepseek");
const bundle = path.join(userData, "vm_bundles", "claudevm.bundle");
const rootfs = path.join(bundle, "rootfs.img");
const smol = path.join(root, "resources", `smol-bin.${arch}.img`);

const swiftCandidates = [
  path.join(
    root,
    "resources/original-runtime-node_modules/node_modules/@ant/claude-swift/package.json",
  ),
  path.join(root, "node_modules/@ant/claude-swift/package.json"),
];

const swiftPackage = swiftCandidates.find((p) => fs.existsSync(p)) ?? null;
let swiftAddonNode = null;
if (swiftPackage) {
  const addon = path.join(path.dirname(swiftPackage), "swift_addon.node");
  if (fs.existsSync(addon)) swiftAddonNode = addon;
}

const report = {
  arch,
  platform: process.platform,
  userData,
  bundleExists: fs.existsSync(bundle),
  rootfsExists: fs.existsSync(rootfs),
  rootfsBytes: fs.existsSync(rootfs) ? fs.statSync(rootfs).size : 0,
  smolBinExists: fs.existsSync(smol),
  smolBinPath: smol,
  swiftPackage,
  swiftAddonNode,
  readyForLiveElectronSmoke: false,
  notes: [
    "Native startVM/isGuestConnected must run under Electron main — not plain Node.",
  ],
};

if (!report.bundleExists || !report.rootfsExists) {
  report.notes.push(
    "Run: node scripts/link-claudevm-bundle-from-official.mjs",
  );
}
if (!report.smolBinExists) {
  report.notes.push("Run: node scripts/copy-smol-bin-from-official.mjs");
}
if (!report.swiftPackage) {
  report.notes.push(
    "Run: npm run copy:original-runtime (or ensure @ant/claude-swift)",
  );
}

report.readyForLiveElectronSmoke =
  report.platform === "darwin"
  && report.bundleExists
  && report.rootfsExists
  && report.rootfsBytes > 1_000_000
  && report.smolBinExists
  && Boolean(report.swiftPackage);

console.log(JSON.stringify(report, null, 2));
process.exit(report.readyForLiveElectronSmoke ? 0 : 2);
