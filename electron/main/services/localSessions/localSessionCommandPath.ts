/**
 * Official residual (app.asar / index.js):
 *   lFi() extra bin dirs · Dl/allPaths · SE/findActualExecutableCustomPath ·
 *   GitHubPrManager.resolveGhPath · installGh (darwin brew install gh).
 *
 * GUI Electron often has a stripped PATH (no /opt/homebrew/bin), so bare
 * `execFile("gh")` yields spawn ENOENT even when Homebrew gh is installed.
 * Product matches official: expand candidate dirs + resolve absolute cmd.
 */

import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let cachedAllPaths: Promise<string[]> | null = null;

/** Official lFi() macOS extra dirs (subset used for tool discovery). */
export function officialExtraBinDirGlobs(
  home: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "darwin" || platform === "linux") {
    const username = (() => {
      try {
        return os.userInfo().username;
      } catch {
        return path.basename(home);
      }
    })();
    return [
      path.join(home, ".nvm/versions/node/*/bin"),
      "/opt/homebrew/Caskroom/miniforge/base/envs/py*/bin",
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/opt/local/bin",
      path.join(home, ".cargo/bin"),
      path.join(home, "go/bin"),
      "/usr/local/go/bin",
      path.join(home, ".bun/bin"),
      path.join(home, ".deno/bin"),
      path.join(home, "Library/pnpm"),
      path.join(home, ".local/bin"),
      path.join(home, "bin"),
      path.join(home, ".volta/bin"),
      path.join(home, ".local/share/mise/shims"),
      path.join(home, ".asdf/shims"),
      path.join(home, ".pyenv/shims"),
      path.join(home, ".rbenv/shims"),
      path.join(home, ".orbstack/bin"),
      path.join(home, ".rd/bin"),
      path.join(home, ".nix-profile/bin"),
      `/etc/profiles/per-user/${username}/bin`,
      "/run/current-system/sw/bin",
      "/nix/var/nix/profiles/default/bin",
      "/usr/bin",
    ];
  }
  if (platform === "win32") {
    return [
      path.join(home, "AppData\\Local\\Programs\\Git\\cmd"),
      path.join(home, "AppData\\Local\\Programs\\Git\\mingw64\\bin"),
      "C:\\Program Files\\Git\\cmd",
      "C:\\Program Files\\Git\\mingw64\\bin",
      "C:\\Program Files\\nodejs",
    ];
  }
  return [];
}

/**
 * Expand simple trailing star globs used by official lFi (e.g. nvm node star/bin).
 * Non-glob paths are returned as-is when they exist as directories.
 */
async function expandBinDirPattern(pattern: string): Promise<string[]> {
  if (!pattern.includes("*")) {
    try {
      const st = await fs.stat(pattern);
      return st.isDirectory() ? [pattern] : [];
    } catch {
      return [];
    }
  }
  const parts = pattern.split(path.sep);
  const starIndex = parts.findIndex((part) => part.includes("*"));
  if (starIndex < 0) return [];
  const parent = parts.slice(0, starIndex).join(path.sep) || path.sep;
  const starPart = parts[starIndex]!;
  const rest = parts.slice(starIndex + 1);
  let names: string[];
  try {
    names = await fs.readdir(parent);
  } catch {
    return [];
  }
  const re = new RegExp(
    `^${starPart.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
  const out: string[] = [];
  for (const name of names) {
    if (!re.test(name)) continue;
    const full = path.join(parent, name, ...rest);
    try {
      const st = await fs.stat(full);
      if (st.isDirectory()) out.push(full);
    } catch {
      /* skip */
    }
  }
  // Official reverses glob hits so higher versions sort later then reverse → prefer newer.
  out.reverse();
  return out;
}

/** Official Dl / allPaths residual (+ shell-path worker PATH when available). */
export async function resolveOfficialAllPaths(
  processEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): Promise<string[]> {
  const expanded: string[] = [];
  for (const pattern of officialExtraBinDirGlobs(home, platform)) {
    expanded.push(...(await expandBinDirPattern(pattern)));
  }

  // residual lq/E5e: prefer login-shell PATH from shellPathWorker when present
  let pathSource = processEnv.PATH ?? "";
  try {
    const { getShellPath } = await import("../shell/shellEnvironment");
    const shellPath = await getShellPath();
    if (shellPath) pathSource = shellPath;
  } catch {
    /* keep processEnv.PATH */
  }

  const fromEnv = pathSource
    .split(path.delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Set([...expanded, ...fromEnv]));
}

export async function getOfficialAllPaths(): Promise<string[]> {
  if (!cachedAllPaths) {
    cachedAllPaths = resolveOfficialAllPaths().catch((error) => {
      cachedAllPaths = null;
      throw error;
    });
  }
  return [...(await cachedAllPaths)];
}

/** Test helper — drop memo so PATH/install changes are visible. */
export function resetOfficialAllPathsCache(): void {
  cachedAllPaths = null;
}

async function pathIsExecutableFile(filePath: string): Promise<boolean> {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile() && !st.isSymbolicLink()) return false;
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Official qQe + SE(non-win) residual: resolve command against allPaths.
 * Returns absolute path or null.
 */
export async function resolveCommandOnAllPaths(
  command: string,
  allPaths?: string[],
): Promise<string | null> {
  if (!command) return null;
  if (command.includes("/") || command.includes("\\")) {
    return (await pathIsExecutableFile(command)) ? command : null;
  }
  const dirs = allPaths ?? (await getOfficialAllPaths());
  // Official also checks ./command — keep for parity.
  const cwdCandidate = path.join(".", command);
  if (await pathIsExecutableFile(cwdCandidate)) {
    return path.resolve(cwdCandidate);
  }
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    if (await pathIsExecutableFile(candidate)) return candidate;
  }
  return null;
}

/** Official GitHubPrManager.resolveGhPath residual. */
export async function resolveGhPath(): Promise<string | null> {
  return resolveCommandOnAllPaths("gh");
}

export async function commandExistsOnAllPaths(command: string): Promise<boolean> {
  if (process.platform === "win32") {
    try {
      await execFileAsync("where.exe", [command], { timeout: 3000 });
      return true;
    } catch {
      /* fall through to allPaths */
    }
  }
  return (await resolveCommandOnAllPaths(command)) !== null;
}

/**
 * Official installGh residual (darwin): brew install gh via allPaths brew.
 * Non-darwin / no brew → open https://cli.github.com/ (product previously always opened).
 */
export async function installGhResidual(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (process.platform !== "darwin") {
    return {
      success: false,
      error:
        "Automatic installation is only supported on macOS. Visit https://cli.github.com to install the GitHub CLI manually.",
    };
  }
  const brew = await resolveCommandOnAllPaths("brew");
  if (!brew) {
    return {
      success: false,
      error:
        "Homebrew is not installed. Visit https://cli.github.com to install the GitHub CLI manually.",
    };
  }
  try {
    await execFileAsync(brew, ["install", "gh"], {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    resetOfficialAllPathsCache();
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Installation failed. Visit https://cli.github.com to install the GitHub CLI manually. (${message})`,
    };
  }
}
