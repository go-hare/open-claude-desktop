/**
 * Official kK residual (app.asar HostLoop plugin path staging):
 *
 *   HeA = join(tmpdir(), "claude-hostloop-plugins")
 *   async function kK(e) {
 *     if (!e.includes(" ")) return e
 *     stage symlink under HeA / sha256(e).slice(0,16) → e
 *     on failure: fall back to raw path (honest)
 *   }
 *
 * Used when building Ve so paths with spaces do not break unquoted
 * ${CLAUDE_PLUGIN_ROOT} hooks. Product residual: sync mkdir/symlink;
 * never invent a staged path for non-existent targets.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const COWORK_HOSTLOOP_PLUGINS_STAGING_DIRNAME =
  "claude-hostloop-plugins";

export function resolveCoworkHostloopPluginsStagingDir(
  tmpdir: string = os.tmpdir(),
): string {
  return path.join(tmpdir, COWORK_HOSTLOOP_PLUGINS_STAGING_DIRNAME);
}

export type StageCoworkPluginPathDeps = {
  existsSync?: (p: string) => boolean;
  lstatSync?: (p: string) => fs.Stats;
  mkdirSync?: (p: string) => void;
  readlinkSync?: (p: string) => string;
  rmSync?: (p: string) => void;
  symlinkSync?: (target: string, link: string) => void;
  tmpdir?: string;
  log?: (message: string, ...args: unknown[]) => void;
};

/**
 * Official kK — return path without spaces when possible.
 * Paths without spaces pass through. Missing targets are not staged.
 */
export function stageCoworkPluginPathIfNeeded(
  pluginPath: string,
  deps: StageCoworkPluginPathDeps = {},
): string {
  if (!pluginPath.includes(" ")) return pluginPath;
  const existsSync = deps.existsSync ?? fs.existsSync;
  if (!existsSync(pluginPath)) return pluginPath;

  const stagingRoot = resolveCoworkHostloopPluginsStagingDir(
    deps.tmpdir ?? os.tmpdir(),
  );
  const hash = crypto
    .createHash("sha256")
    .update(pluginPath)
    .digest("hex")
    .slice(0, 16);
  const staged = path.join(stagingRoot, hash);
  const mkdirSync =
    deps.mkdirSync
    ?? ((p: string) => fs.mkdirSync(p, { recursive: true }));
  const readlinkSync = deps.readlinkSync ?? ((p) => fs.readlinkSync(p));
  const rmSync =
    deps.rmSync
    ?? ((p: string) => fs.rmSync(p, { force: true, recursive: true }));
  const symlinkSync =
    deps.symlinkSync
    ?? ((target: string, link: string) => fs.symlinkSync(target, link, "dir"));

  try {
    mkdirSync(stagingRoot);
    try {
      if (readlinkSync(staged) === pluginPath) return staged;
      rmSync(staged);
    } catch {
      // no existing link
    }
    try {
      symlinkSync(pluginPath, staged);
      return staged;
    } catch (error) {
      // EEXIST race: re-check
      try {
        if (readlinkSync(staged) === pluginPath) return staged;
      } catch {
        /* fall through */
      }
      deps.log?.(
        "[HostLoop] Could not stage plugin symlink, falling back to raw path: %s -> %s: %s",
        staged,
        pluginPath,
        error instanceof Error ? error.message : String(error),
      );
      return pluginPath;
    }
  } catch (error) {
    deps.log?.(
      "[HostLoop] plugin stage residual failed: %o",
      error,
    );
    return pluginPath;
  }
}

/**
 * Stage every path that contains spaces; preserve order; dedupe by staged result.
 */
export function stageCoworkPluginPaths(
  paths: readonly string[],
  deps: StageCoworkPluginPathDeps = {},
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const staged = stageCoworkPluginPathIfNeeded(p, deps);
    if (seen.has(staged)) continue;
    seen.add(staged);
    out.push(staged);
  }
  // Official Ve also includes HeA staging root when any path was staged under it.
  const stagingRoot = resolveCoworkHostloopPluginsStagingDir(
    deps.tmpdir ?? os.tmpdir(),
  );
  if (
    out.some((p) => p.startsWith(stagingRoot + path.sep) || p === stagingRoot)
    && !seen.has(stagingRoot)
  ) {
    try {
      if ((deps.existsSync ?? fs.existsSync)(stagingRoot)) {
        out.push(stagingRoot);
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}
