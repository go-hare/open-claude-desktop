/**
 * Platform dispatcher for packaged bundle align.
 *
 *   darwin → align-packaged-macos-bundle.mjs
 *            residual MacOS/Frameworks + product-web → ion-dist + codesign
 *   win32  → align-packaged-win32-bundle.mjs
 *            product-web → resources/ion-dist + claude-code-bin inject
 *
 * Cross-host: packaging is host-native (build win package on Windows, mac on macOS).
 * If only the other platform's out/ tree exists, the platform script may skip.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script =
  process.platform === "win32"
    ? path.join(root, "scripts/align-packaged-win32-bundle.mjs")
    : path.join(root, "scripts/align-packaged-macos-bundle.mjs");

const result = spawnSync(process.execPath, [script], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
