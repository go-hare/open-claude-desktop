/**
 * Official CCD residual: LocalSessions.getDefaultPermissionMode(cwd)
 *
 * app.asar:
 *   async getDefaultPermissionMode(A) {
 *     const t = await bsA(A);           // user + project + projectLocal + managed settings
 *     const i = grt(t)?.value;          // permissions.defaultMode merge
 *     return i === undefined ? null
 *       : drt.has(i) ? i
 *       : (warn invalid, null);
 *   }
 *
 * Settings tiers (bsA):
 *   User:         ~/.claude/settings.json
 *   Project:      <cwd>/.claude/settings.json
 *   ProjectLocal: <cwd>/.claude/settings.local.json
 *   Managed:      remote/managed (product: optional; skip if absent)
 *
 * grt: walk tiers in order; later valid defaultMode wins.
 * auto / bypassPermissions only from User or Managed (not project tiers).
 *
 * This is **settings persistence**, not "last Mode pill on previous session".
 * Official Mode pill setPermissionMode does not write permissions.defaultMode.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CODE_PERMISSION_MODES,
  clampCodePermissionMode,
  normalizeCodePermissionMode,
} from "./codePermissionModePolicy";

export type SettingsTier = "user" | "project" | "projectLocal" | "managed";

export type SettingsLayer = {
  tier: SettingsTier;
  path: string;
  settings: Record<string, unknown> | null;
};

const PROJECT_TIERS = new Set<SettingsTier>(["project", "projectLocal"]);
/** Official srt: auto/bypass only allowed from user or managed tiers. */
const RESTRICTED_DEFAULT_MODES = new Set(["auto", "bypassPermissions", "bypass"]);

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function userClaudeSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

/**
 * Official bsA(cwd) residual without remote managed fetch.
 * Managed tier omitted when no local managed file is present (product honesty).
 */
export function loadClaudeSettingsLayers(cwd?: string | null): SettingsLayer[] {
  const layers: SettingsLayer[] = [];
  const userPath = userClaudeSettingsPath();
  layers.push({
    tier: "user",
    path: userPath,
    settings: readJsonObject(userPath),
  });

  const root = typeof cwd === "string" && cwd.trim().length > 0 ? cwd.trim() : null;
  if (root) {
    const projectPath = path.join(root, ".claude", "settings.json");
    const projectLocalPath = path.join(root, ".claude", "settings.local.json");
    layers.push({
      tier: "project",
      path: projectPath,
      settings: readJsonObject(projectPath),
    });
    layers.push({
      tier: "projectLocal",
      path: projectLocalPath,
      settings: readJsonObject(projectLocalPath),
    });
  }

  return layers;
}

function defaultModeFromSettings(settings: Record<string, unknown> | null): string | undefined {
  if (!settings) return undefined;
  const permissions = settings.permissions;
  if (permissions && typeof permissions === "object" && !Array.isArray(permissions)) {
    const mode = (permissions as Record<string, unknown>).defaultMode;
    if (typeof mode === "string" && mode.length > 0) return mode;
  }
  // Legacy top-level key (some residual bags) — only if permissions.defaultMode absent.
  const top = settings.defaultPermissionMode;
  if (typeof top === "string" && top.length > 0) return top;
  return undefined;
}

function isKnownPermissionMode(mode: string): boolean {
  const normalized = mode === "bypass" ? "bypassPermissions" : mode;
  return (CODE_PERMISSION_MODES as readonly string[]).includes(normalized);
}

/**
 * Official grt(layers) → permissions.defaultMode value, or null when unset/invalid.
 */
export function resolveDefaultPermissionModeFromLayers(
  layers: SettingsLayer[],
): string | null {
  let resolved: string | undefined;
  for (const layer of layers) {
    const raw = defaultModeFromSettings(layer.settings);
    if (raw === undefined) continue;
    const mapped = raw === "bypass" ? "bypassPermissions" : raw;
    if (!isKnownPermissionMode(mapped)) {
      // Official: invalid → ignore this tier (final may still be null).
      continue;
    }
    if (RESTRICTED_DEFAULT_MODES.has(mapped) && PROJECT_TIERS.has(layer.tier)) {
      // Official: only user/managed may default to auto/bypass.
      continue;
    }
    resolved = mapped;
  }
  return resolved ?? null;
}

/**
 * Host IPC residual for getDefaultPermissionMode(cwd).
 * Returns null when settings have no valid default (official); caller/UI seeds "default".
 * When bypassPermissionsModeEnabled is false, clamp bypass → acceptEdits.
 */
export function resolveDefaultPermissionMode(
  cwd?: string | null,
  options?: { bypassPermissionsModeEnabled?: boolean },
): string | null {
  const layers = loadClaudeSettingsLayers(cwd);
  const raw = resolveDefaultPermissionModeFromLayers(layers);
  if (!raw) return null;
  const bypassOk = options?.bypassPermissionsModeEnabled === true;
  // Clamp only bypass; leave auto/plan/etc. as settings say.
  if (raw === "bypassPermissions" || raw === "bypass") {
    return clampCodePermissionMode(raw, bypassOk);
  }
  return normalizeCodePermissionMode(raw);
}
