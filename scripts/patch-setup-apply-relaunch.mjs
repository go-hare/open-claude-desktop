/**
 * Product patch: Setup "Relaunch now" must not run the residual countdown on the
 * small Setup window.
 *
 * Official residual (c71860c77):
 *   A = commitApply then relaunchApp
 *   L = I({ variant:"apply", onDone:A, onCancel:... })  // I = ve() = m2t trigger
 *   Ce mounts h2t host inside Setup → countdown stuck on 900×720 Setup window
 *
 * Product main process (settingsHandlers.relaunchApp):
 *   close Setup → main SPA applyRelaunchRequested → RelaunchInterstitial apply → exit
 *
 * So residual L should call A directly (skip Setup-local interstitial). Main owns
 * close + main countdown. Idempotent.
 *
 * Dual-root: patch ion-dist + product-web setup chunks (and open-claude-web mirrors).
 */
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./originalAppPaths.mjs";

const root = getProjectRoot();

const SETUP_PATHS = [
  path.join(root, "resources/ion-dist/assets/v1/c71860c77-BOaDa5w5.js"),
  path.join(root, "resources/product-web/assets/v1/c71860c77-BOaDa5w5.js"),
  path.join(root, "..", "open-claude-web", "public/assets/v1/c71860c77-BOaDa5w5.js"),
  path.join(root, "..", "open-claude-web", "dist/assets/v1/c71860c77-BOaDa5w5.js"),
];

/** Residual: open apply interstitial (countdown) in Setup window, then A. */
const L_RESIDUAL =
  'L=f.useCallback(()=>{I({variant:"apply",onDone:A,onCancel:()=>b(!0)})},[I,A])';

/**
 * Product: skip Setup-local countdown. Relaunch now → commitApply + relaunchApp;
 * main process closes Setup and drives main-window apply interstitial.
 * Keep I=ve() unused (harmless) so surrounding minified graph stays stable.
 */
const L_PRODUCT = "L=f.useCallback(()=>{void A()},[A])";

function patchSetup(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn("setup apply-relaunch skip (missing):", filePath);
    return false;
  }
  let t = fs.readFileSync(filePath, "utf8");
  if (t.includes(L_PRODUCT)) {
    console.log("setup apply-relaunch already patched", filePath);
    return true;
  }
  if (!t.includes(L_RESIDUAL)) {
    // Already transformed or residual hash moved — fail hard for product trees.
    if (filePath.includes(`${path.sep}open-claude-web${path.sep}`)) {
      console.warn("setup apply-relaunch anchor missing (web mirror):", filePath);
      return false;
    }
    throw new Error(`setup apply-relaunch L= anchor not found in ${filePath}`);
  }
  t = t.replace(L_RESIDUAL, L_PRODUCT);
  fs.writeFileSync(filePath, t, "utf8");
  console.log("patched setup apply-relaunch (skip Setup countdown)", filePath);
  return true;
}

function main() {
  let any = false;
  for (const p of SETUP_PATHS) {
    try {
      if (patchSetup(p)) any = true;
    } catch (e) {
      if (p.includes(`${path.sep}open-claude-web${path.sep}`)) {
        console.warn("web setup apply-relaunch skip:", e instanceof Error ? e.message : String(e));
        continue;
      }
      throw e;
    }
  }
  if (!any) console.warn("no setup apply-relaunch files patched");
  console.log("OK setup apply-relaunch");
}

main();
