/**
 * Shared residual original-app path resolution.
 * Prefer vendored resources/original-claude.app so package/audit work offline.
 */
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_DOWNLOADS_APP =
  "/Users/apple/Downloads/Claude code 汉化mac桌面版/Claude-Deepseek.app";

export function getProjectRoot() {
  return projectRoot;
}

export function originalAppCandidates() {
  return [
    process.env.CLAUDE_ORIGINAL_APP,
    process.env.CLAUDE_ORIGINAL_APP_CONTENTS
      ? path.dirname(process.env.CLAUDE_ORIGINAL_APP_CONTENTS)
      : undefined,
    // Vendored residual inside product tree (preferred default).
    path.join(projectRoot, "resources/original-claude.app"),
    // CLAUDE.md residual path.
    DEFAULT_DOWNLOADS_APP,
    path.resolve(projectRoot, "../Claude-Deepseek.app"),
    path.resolve(projectRoot, "../../Claude-Deepseek.app"),
    // Legacy names still seen in older checkouts / Windows mirrors.
    path.resolve(projectRoot, "../Claudex.app"),
    path.resolve(projectRoot, "../../Claudex.app"),
    "/Users/apple/Downloads/Claude code 汉化mac桌面版/Claudex.app",
    String.raw`D:\BaiduNetdiskDownload\Claude code 汉化mac桌面版\Claudex\Claudex.app`,
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
  if (process.env.CLAUDE_ORIGINAL_ION_DIST) return process.env.CLAUDE_ORIGINAL_ION_DIST;
  return path.join(resolveOriginalResources(), "ion-dist");
}
