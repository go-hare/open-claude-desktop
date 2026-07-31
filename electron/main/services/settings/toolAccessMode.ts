/**
 * Official tool_search_mode residual (c71860c77 we / ion-dist index S7):
 * - Account settings key `tool_search_mode`: "on" | "off" (auto → on)
 * - on  → load connector tools when needed (defer MCP apply until idle/warm)
 * - off → tools already loaded (eager setMcpServers for new conversations)
 *
 * Product: read from custom3p account settings bag; do not invent cloud tool-search.
 */

import fs from "node:fs";
import path from "node:path";

export type ToolSearchMode = "on" | "off";

/** custom3p account.settings disk residual (userData). */
export const ACCOUNT_SETTINGS_FILE_NAME = "account-settings.json";

export function normalizeToolSearchMode(value: unknown): ToolSearchMode {
  return value === "off" ? "off" : "on";
}

/** Eager path when user chose "Tools already loaded". */
export function isEagerConnectorToolLoad(mode: unknown): boolean {
  return normalizeToolSearchMode(mode) === "off";
}

export function toolSearchModeFromAccountSettings(
  settings: Record<string, unknown> | null | undefined,
): ToolSearchMode {
  if (!settings) return "on";
  return normalizeToolSearchMode(settings.tool_search_mode);
}

export function accountSettingsFilePath(userDataPath: string): string {
  return path.join(userDataPath, ACCOUNT_SETTINGS_FILE_NAME);
}

/** Pure disk read for main-process consumers (Cowork MCP apply gate). */
export function readAccountSettingsFromUserData(
  userDataPath: string,
): Record<string, unknown> {
  try {
    const file = accountSettingsFilePath(userDataPath);
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function isEagerConnectorToolLoadFromUserData(
  userDataPath: string,
): boolean {
  return isEagerConnectorToolLoad(
    toolSearchModeFromAccountSettings(
      readAccountSettingsFromUserData(userDataPath),
    ),
  );
}

/**
 * Official Qt residual: enabled_cowork_memory !== false (default ON).
 * Explicit false disables auto-memory mount (startSession memoryEnabled gate).
 */
export function isCoworkMemoryEnabledFromAccountSettings(
  settings: Record<string, unknown> | null | undefined,
): boolean {
  if (!settings) return true;
  return settings.enabled_cowork_memory !== false;
}

export function isCoworkMemoryEnabledFromUserData(userDataPath: string): boolean {
  return isCoworkMemoryEnabledFromAccountSettings(
    readAccountSettingsFromUserData(userDataPath),
  );
}

/**
 * Official Claude Code _t residual: ccr_autofix_on_pr_create === true.
 * When set, createLocalPr success seeds session.autoFixEnabled for CodeAutoFixEngine.
 */
export function isAutofixOnPrCreateFromAccountSettings(
  settings: Record<string, unknown> | null | undefined,
): boolean {
  if (!settings) return false;
  return settings.ccr_autofix_on_pr_create === true;
}

export function isAutofixOnPrCreateFromUserData(userDataPath: string): boolean {
  return isAutofixOnPrCreateFromAccountSettings(
    readAccountSettingsFromUserData(userDataPath),
  );
}
