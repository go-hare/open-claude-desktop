/**
 * Official app config path residual (app.asar Fb / XYe / Xo / F_ / GV / VWt / Hne):
 *
 *   XYe = "claude_desktop_config.json"
 *   Fb() = join(app.getPath("userData"), XYe)
 *   VWt() = parse + Hne.safeParse (+ $Wt mcp filter)
 *   F_("preferences", bag) → write preferences key into that file
 *
 * Product still uses desktop-shell-settings.json for shell-specific bags
 * (custom3p, appFeatures, …). Preferences dual-write residual keeps an
 * official-shaped preferences segment on disk without inventing full enterprise.
 */
import fs from "node:fs";
import path from "node:path";
import {
  getConfigLoadErrorCopy,
  getInvalidMcpServersCopy,
} from "./desktopDialogI18n";
import {
  parseOfficialAppConfig,
  type OfficialAppConfig,
  type ParseOfficialConfigResult,
} from "./officialConfigSchema";

export const OFFICIAL_APP_CONFIG_FILENAME = "claude_desktop_config.json";

export function resolveOfficialAppConfigPath(userDataPath: string): string {
  return path.join(userDataPath, OFFICIAL_APP_CONFIG_FILENAME);
}

export type OfficialAppConfigFile = OfficialAppConfig & {
  preferences?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  globalShortcut?: string;
  [key: string]: unknown;
};

export type ReadOfficialConfigOptions = {
  /** When true, run Hne schema residual (default true). */
  validate?: boolean;
  /** Locale for optional error dialog residual. */
  locale?: string | null;
  /**
   * Official Pne / WWt dialog residual. Default no-op (tests / headless).
   * Product may inject electron dialog.
   */
  onParseError?: (copy: { message: string; detail: string }) => void;
  onInvalidMcpServers?: (
    names: string[],
    copy: { message: string; detail: string },
  ) => void;
};

/**
 * Raw JSON read without schema (legacy dual-write helpers).
 */
export function readOfficialAppConfigFileRaw(
  configPath: string,
): OfficialAppConfigFile {
  try {
    if (!fs.existsSync(configPath)) return {};
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw as OfficialAppConfigFile;
  } catch {
    return {};
  }
}

/**
 * Official VWt residual: read + Hne validate + mcp filter.
 * On total failure returns {} (never invent config).
 */
export function readOfficialAppConfigFile(
  configPath: string,
  options: ReadOfficialConfigOptions = {},
): OfficialAppConfigFile {
  const validate = options.validate !== false;
  try {
    if (!fs.existsSync(configPath)) return {};
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      options.onParseError?.(getConfigLoadErrorCopy(message, options.locale));
      return {};
    }

    if (!validate) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return raw as OfficialAppConfigFile;
    }

    const parsed = parseOfficialAppConfig(raw);
    if (parsed.invalidMcpServers.length > 0) {
      options.onInvalidMcpServers?.(
        parsed.invalidMcpServers,
        getInvalidMcpServersCopy(parsed.invalidMcpServers, options.locale),
      );
    }
    if (!parsed.ok && parsed.usedFallback) {
      if (parsed.error) {
        options.onParseError?.(
          getConfigLoadErrorCopy(parsed.error, options.locale),
        );
      }
      return parsed.data as OfficialAppConfigFile;
    }
    return parsed.data as OfficialAppConfigFile;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    options.onParseError?.(getConfigLoadErrorCopy(message, options.locale));
    return {};
  }
}

/**
 * Schema-aware parse entry for tests / callers that already have raw JSON.
 */
export function parseOfficialConfigFileContent(
  raw: unknown,
): ParseOfficialConfigResult {
  return parseOfficialAppConfig(raw);
}

export function readOfficialPreferencesSegment(
  configPath: string,
): Record<string, unknown> | null {
  const cfg = readOfficialAppConfigFile(configPath, { validate: true });
  const prefs = cfg.preferences;
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return null;
  return { ...(prefs as Record<string, unknown>) };
}

/**
 * Official F_("preferences", i) residual — merge preferences into config.json
 * without clobbering mcpServers / other keys. Creates file when missing.
 * Preferences segment is not re-validated as full Hne on write (writer trusts
 * AppPreferences HSA residual); mcpServers left untouched.
 */
export function writeOfficialPreferencesSegment(
  configPath: string,
  preferences: Record<string, unknown>,
): void {
  const existing = readOfficialAppConfigFileRaw(configPath);
  const next: OfficialAppConfigFile = {
    ...existing,
    preferences: { ...preferences },
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
}

/**
 * Best-effort globalShortcut dual-write residual (official Gxe).
 */
export function writeOfficialGlobalShortcutSegment(
  configPath: string,
  accelerator: string | null,
): void {
  const existing = readOfficialAppConfigFileRaw(configPath);
  const next: OfficialAppConfigFile = { ...existing };
  if (accelerator === null || accelerator === "") {
    delete next.globalShortcut;
  } else {
    next.globalShortcut = accelerator;
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
}

/**
 * Write full official config bag after Hne validate residual.
 * Only writes when parse succeeds (including after $Wt MCP filter).
 * Total Hne failure (usedFallback / !ok) must NOT clobber disk with {}.
 */
export function writeOfficialAppConfigFile(
  configPath: string,
  config: unknown,
): { ok: boolean; error?: string; invalidMcpServers?: string[] } {
  const parsed = parseOfficialAppConfig(config);
  // Accept only successful Hne parse (raw or after invalid-MCP filter).
  // Never write empty fallback data — that would wipe a valid on-disk config.
  if (!parsed.ok || parsed.usedFallback) {
    return {
      ok: false,
      error: parsed.error ?? "invalid config",
      invalidMcpServers: parsed.invalidMcpServers,
    };
  }
  const data = parsed.data;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
  return {
    ok: true,
    invalidMcpServers: parsed.invalidMcpServers,
  };
}
