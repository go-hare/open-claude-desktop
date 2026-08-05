/**
 * Residual original-app path resolution for package / align / audit.
 *
 * Product rule (user): package must use **our** vendored residual under
 *   resources/original-claude.app
 * so deleting the Downloads official install does not break packaging.
 *
 * - Default / package: ONLY project resources (+ explicit env override).
 * - Sync scripts may still pass a source path / env to refresh the vendor tree.
 */
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Vendored residual .app inside the product tree (canonical package source). */
export const VENDORED_ORIGINAL_APP = path.join(projectRoot, "resources/original-claude.app");

/** Only for sync:original-app / one-off refresh — NOT used by package/align resolve. */
const SYNC_ONLY_DOWNLOADS_APP =
  "/Users/apple/Downloads/Claude code 汉化mac桌面版/Claude-Deepseek.app";

export function getProjectRoot() {
  return projectRoot;
}

/**
 * Paths package/align/audit may use.
 * Order: explicit env → vendored resources/original-claude.app only.
 * No Downloads / sibling fallbacks (those are sync-only).
 */
export function originalAppCandidates() {
  return [
    process.env.CLAUDE_ORIGINAL_APP,
    process.env.CLAUDE_ORIGINAL_APP_CONTENTS
      ? path.dirname(process.env.CLAUDE_ORIGINAL_APP_CONTENTS)
      : undefined,
    VENDORED_ORIGINAL_APP,
  ].filter(Boolean);
}

/**
 * Sources allowed when running sync:original-app (refresh vendor tree).
 * Includes Downloads residual path from CLAUDE.md.
 */
export function originalAppSyncCandidates() {
  return [
    process.env.CLAUDE_ORIGINAL_APP,
    process.env.CLAUDE_ORIGINAL_APP_CONTENTS
      ? path.dirname(process.env.CLAUDE_ORIGINAL_APP_CONTENTS)
      : undefined,
    SYNC_ONLY_DOWNLOADS_APP,
    path.resolve(projectRoot, "../Claude-Deepseek.app"),
    path.resolve(projectRoot, "../../Claude-Deepseek.app"),
    VENDORED_ORIGINAL_APP,
  ].filter(Boolean);
}

export function originalResourceCandidates() {
  return [
    process.env.CLAUDE_ORIGINAL_RESOURCES,
    process.env.CLAUDE_ORIGINAL_APP_CONTENTS
      ? path.join(process.env.CLAUDE_ORIGINAL_APP_CONTENTS, "Resources")
      : undefined,
    ...originalAppCandidates().map((app) => path.join(app, "Contents/Resources")),
  ].filter(Boolean);
}

export function resolveExisting(candidates) {
  return (
    candidates.find((candidate) => {
      try {
        return fsSync.existsSync(candidate);
      } catch {
        return false;
      }
    }) ?? candidates[0]
  );
}

export function resolveOriginalApp() {
  return resolveExisting(originalAppCandidates());
}

/**
 * Hard require vendored residual for package/align.
 * Throws with fix command if resources/original-claude.app is missing.
 */
export function requireVendoredOriginalApp() {
  const app = resolveOriginalApp();
  const asar = path.join(app, "Contents/Resources/app.asar");
  if (!fsSync.existsSync(app) || !fsSync.existsSync(asar)) {
    throw new Error(
      [
        "Packaging residual source missing: resources/original-claude.app",
        "(with Contents/Resources/app.asar).",
        "This is OUR vendored residual — package does not read Downloads.",
        "Fix: npm run sync:original-app",
        `  (optional source: CLAUDE_ORIGINAL_APP=/path/to/Claude-Deepseek.app)`,
        `Resolved tried: ${originalAppCandidates().join(" | ")}`,
      ].join("\n"),
    );
  }
  return app;
}

export function resolveOriginalResources() {
  // Prefer a Resources dir that actually has app.asar when multiple candidates exist.
  const candidates = originalResourceCandidates();
  const withAsar = candidates.find((candidate) => {
    try {
      return fsSync.existsSync(path.join(candidate, "app.asar"));
    } catch {
      return false;
    }
  });
  return withAsar ?? resolveExisting(candidates);
}

export function resolveOriginalIonDist() {
  // Package prefers project resources/ion-dist (already synced into our tree).
  if (process.env.CLAUDE_ORIGINAL_ION_DIST) return process.env.CLAUDE_ORIGINAL_ION_DIST;
  const vendoredIon = path.join(projectRoot, "resources/ion-dist");
  if (fsSync.existsSync(vendoredIon)) return vendoredIon;
  return path.join(resolveOriginalResources(), "ion-dist");
}
