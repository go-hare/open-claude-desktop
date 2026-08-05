/**
 * Sync residual Helpers binaries + locale JSON into project resources/.
 *
 * Sources (first hit wins):
 *   1) CLAUDE_ORIGINAL_APP / resources/original-claude.app
 *   2) Downloads residual path (sync-only)
 *
 * Targets (OUR tree — package reads these, not Downloads):
 *   resources/Helpers/chrome-native-host
 *   resources/Helpers/disclaimer
 *   resources/locale-json/*.json
 *
 * Usage: node scripts/sync-helpers-and-locales.mjs
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {
  getProjectRoot,
  originalAppSyncCandidates,
  resolveOriginalApp,
} from "./originalAppPaths.mjs";

const root = getProjectRoot();
const LOCALE_NAMES = [
  "de-DE",
  "en-US",
  "es-419",
  "es-ES",
  "fr-FR",
  "hi-IN",
  "id-ID",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "pt-BR",
  "zh-CN",
];

function resolveSourceApp() {
  const candidates = [
    process.argv[2] ? path.resolve(process.argv[2]) : undefined,
    ...originalAppSyncCandidates(),
    resolveOriginalApp(),
  ].filter(Boolean);
  return (
    candidates.find((app) => {
      try {
        return fsSync.existsSync(path.join(app, "Contents/Helpers/chrome-native-host"));
      } catch {
        return false;
      }
    }) ?? null
  );
}

const sourceApp = resolveSourceApp();
if (!sourceApp) {
  throw new Error(
    "official residual .app with Contents/Helpers/chrome-native-host not found. " +
      "Run npm run sync:original-app first or pass path.",
  );
}

const helpersSrc = path.join(sourceApp, "Contents/Helpers");
const helpersDest = path.join(root, "resources/Helpers");
await fs.mkdir(helpersDest, { recursive: true });

const helpersCopied = [];
for (const name of ["chrome-native-host", "disclaimer"]) {
  const src = path.join(helpersSrc, name);
  const dest = path.join(helpersDest, name);
  if (!fsSync.existsSync(src)) {
    console.warn(`[sync-helpers] missing ${src}`);
    continue;
  }
  await fs.copyFile(src, dest);
  await fs.chmod(dest, 0o755);
  helpersCopied.push(name);
}

const localeDest = path.join(root, "resources/locale-json");
await fs.mkdir(localeDest, { recursive: true });
const localeCopied = [];
const resourcesSrc = path.join(sourceApp, "Contents/Resources");
for (const name of LOCALE_NAMES) {
  const src = path.join(resourcesSrc, `${name}.json`);
  const dest = path.join(localeDest, `${name}.json`);
  if (!fsSync.existsSync(src)) continue;
  await fs.copyFile(src, dest);
  localeCopied.push(`${name}.json`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      sourceApp,
      helpersDest: path.relative(root, helpersDest),
      helpersCopied,
      localeDest: path.relative(root, localeDest),
      localeCopied,
    },
    null,
    2,
  ),
);
