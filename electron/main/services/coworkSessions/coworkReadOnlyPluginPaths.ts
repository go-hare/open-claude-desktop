/**
 * Official UXe pre-start plugin path fill (LocalAgentModeSessionManager):
 *
 *   Ve = [
 *     ...skillsPluginPath SA/sA,
 *     ...gt (remote plugin sdk/install paths),
 *     ...H.flatMap installPath not already in gt,
 *     ...mt (local CLI plugin paths),
 *     ...projectContexts / other hostPath lists,
 *     ...tmpdir claude-hostloop-plugins when any path had spaces (kK),
 *   ]
 *   Ke.readOnlyPluginPaths = Ve
 *
 * Product residual: collect host install paths from official on-disk manifests
 * under userData/local-agent-mode-sessions/<account>/<org>/cowork_plugins/
 * (installed_plugins.json) + remote rpm/remote_cowork_plugins when present.
 * Does not invent plugin roots; empty when account/org or manifests absent.
 */
import fs from "node:fs";
import path from "node:path";
import { coworkAccountStorageDir } from "./coworkAutoMemoryPaths";

/** Official uC = join(zV(account, org), "cowork_plugins") */
export function coworkPluginsDir(
  userDataPath: string,
  accountId: string,
  orgId: string,
): string {
  return path.join(
    coworkAccountStorageDir(userDataPath, accountId, orgId),
    "cowork_plugins",
  );
}

/** Official Nw */
export function coworkInstalledPluginsFile(
  userDataPath: string,
  accountId: string,
  orgId: string,
): string {
  return path.join(
    coworkPluginsDir(userDataPath, accountId, orgId),
    "installed_plugins.json",
  );
}

/** Official eK remote plugins dir (rpm) + legacy remote_cowork_plugins */
export function coworkRemotePluginDirs(
  userDataPath: string,
  accountId: string,
  orgId: string,
): string[] {
  const root = coworkAccountStorageDir(userDataPath, accountId, orgId);
  return [
    path.join(root, "rpm"),
    path.join(root, "remote_cowork_plugins"),
  ];
}

export type CollectCoworkReadOnlyPluginPathsInput = {
  accountId?: string | null;
  extraPaths?: readonly string[] | null;
  orgId?: string | null;
  userDataPath: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Official installed_plugins.json: { version, plugins: { [id]: Array<{ installPath, scope, ... }> } }
 */
export function parseInstalledPluginInstallPaths(
  raw: unknown,
): string[] {
  if (!raw || typeof raw !== "object") return [];
  const plugins = (raw as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== "object") return [];
  const out: string[] = [];
  for (const entries of Object.values(plugins as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const installPath = (entry as { installPath?: unknown }).installPath;
      if (isNonEmptyString(installPath)) out.push(path.resolve(installPath));
    }
  }
  return out;
}

function readJsonFile(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/**
 * Walk remote plugin trees for directories that look like installed plugins
 * (contain .claude-plugin/plugin.json) — honest residual when rpm layout varies.
 */
function collectRemotePluginInstallDirs(remoteRoot: string): string[] {
  if (!fs.existsSync(remoteRoot)) return [];
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(remoteRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(remoteRoot, ent.name);
    const marker = path.join(dir, ".claude-plugin", "plugin.json");
    if (fs.existsSync(marker)) {
      out.push(dir);
      continue;
    }
    // one level nested marketplace/name
    try {
      const nested = fs.readdirSync(dir, { withFileTypes: true });
      for (const child of nested) {
        if (!child.isDirectory()) continue;
        const childDir = path.join(dir, child.name);
        if (
          fs.existsSync(path.join(childDir, ".claude-plugin", "plugin.json"))
        ) {
          out.push(childDir);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/**
 * Collect host paths for session.readOnlyPluginPaths (official Ve subset).
 * Dedupes; preserves order: extras → installed_plugins → remote dirs.
 */
export function collectCoworkReadOnlyPluginPaths(
  input: CollectCoworkReadOnlyPluginPathsInput,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (p: string) => {
    const resolved = path.resolve(p);
    if (seen.has(resolved)) return;
    // Only keep paths that exist on disk — do not invent mounts for missing dirs.
    try {
      if (!fs.existsSync(resolved)) return;
    } catch {
      return;
    }
    seen.add(resolved);
    out.push(resolved);
  };

  for (const extra of input.extraPaths ?? []) {
    if (isNonEmptyString(extra)) push(extra);
  }

  const accountId = input.accountId?.trim();
  const orgId = input.orgId?.trim();
  if (!accountId || !orgId) return out;

  const installedFile = coworkInstalledPluginsFile(
    input.userDataPath,
    accountId,
    orgId,
  );
  const manifest = readJsonFile(installedFile);
  for (const p of parseInstalledPluginInstallPaths(manifest)) {
    push(p);
  }

  for (const remoteRoot of coworkRemotePluginDirs(
    input.userDataPath,
    accountId,
    orgId,
  )) {
    for (const p of collectRemotePluginInstallDirs(remoteRoot)) {
      push(p);
    }
  }

  return out;
}
