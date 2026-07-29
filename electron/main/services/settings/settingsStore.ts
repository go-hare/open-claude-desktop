import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  mergeAppPreferences,
  OFFICIAL_APP_PREFERENCE_DEFAULTS,
} from "./appPreferencesDefaults";
import {
  isOfficialAppPreferenceKey,
  isProductResidualPreferenceKey,
  validateAppPreference,
} from "./appPreferencesSchema";
import {
  resolveOfficialAppConfigPath,
  readOfficialMcpServersSegment,
  readOfficialPreferencesSegment,
  writeOfficialGlobalShortcutSegment,
  writeOfficialMcpServersSegment,
  writeOfficialPreferencesSegment,
} from "./officialConfigJson";
import {
  buildSupportedFeaturesDepsFromRuntime,
  resolveSupportedFeatures,
} from "./supportedFeatures";
import {
  resolveIsDxtEnabled,
  resolveIsLocalDevMcpEnabled,
} from "./localDevMcpPolicy";
import { getCoworkEnterpriseBoolean } from "../coworkHostLoop/coworkEnterpriseConfig";
import {
  getAppliedCustom3pConfigLibraryBag,
  getAppliedCustom3pConfigLibraryId,
  listCustom3pConfigLibrary,
  readCustom3pConfigLibraryBag,
} from "../custom3p/custom3pConfigLibrary";

export type Custom3pConfigRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  config: unknown;
};

type PersistedSettings = {
  preferences: Record<string, unknown>;
  appFeatures: Record<string, unknown>;
  menuBarEnabled: boolean;
  globalShortcut: string | null;
  mcpServersConfig: Record<string, unknown>;
  custom3pConfigs: Record<string, Custom3pConfigRecord>;
  appliedCustom3pConfigId: string | null;
  credentialHelperLastRun: unknown;
};

/**
 * Official SSA defaults used by getPreferences / bLA residual.
 */
const DEFAULT_PREFERENCES: Record<string, unknown> = {
  ...OFFICIAL_APP_PREFERENCE_DEFAULTS,
};

function defaultState(): PersistedSettings {
  return {
    preferences: { ...DEFAULT_PREFERENCES },
    appFeatures: {},
    menuBarEnabled: true,
    globalShortcut: null,
    mcpServersConfig: {},
    custom3pConfigs: {},
    appliedCustom3pConfigId: null,
    credentialHelperLastRun: null,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `config-${Date.now()}`;
}

export class SettingsStore {
  private readonly settingsFile: string;
  private readonly officialConfigPath: string;
  private state: PersistedSettings;

  constructor(
    settingsFile = path.join(app.getPath("userData"), "desktop-shell-settings.json"),
    officialConfigPath?: string,
  ) {
    this.settingsFile = settingsFile;
    this.officialConfigPath =
      officialConfigPath
      ?? resolveOfficialAppConfigPath(path.dirname(settingsFile));
    this.state = this.read();
  }

  getSettingsFile(): string {
    return this.settingsFile;
  }

  /** Official Fb() residual — userData/claude_desktop_config.json */
  getOfficialConfigPath(): string {
    return this.officialConfigPath;
  }

  getUserDataDir(): string {
    return path.dirname(this.settingsFile);
  }

  getLogsDir(): string {
    return app.getPath("logs");
  }

  /**
   * Official Fb residual for Edit Config / revealConfig:
   * userData/claude_desktop_config.json (mcpServers lives here under Hne/Xo).
   * Legacy product mirror mcp-servers.json is still dual-written for diagnostics.
   */
  getMcpConfigFile(): string {
    return this.officialConfigPath;
  }

  /** Legacy product mirror path (pre-official dual-write). */
  getLegacyMcpServersMirrorFile(): string {
    return path.join(this.getUserDataDir(), "mcp-servers.json");
  }

  private read(): PersistedSettings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsFile, "utf8")) as Partial<PersistedSettings>;
      const base = defaultState();
      // Dual-read residual: seed from official config.json preferences under shell prefs.
      const officialPrefs = readOfficialPreferencesSegment(this.officialConfigPath) ?? {};
      const shellPrefs = raw.preferences ?? {};
      // Legacy shell top-level menuBarEnabled (pre-preference path) → seed prefs once.
      const legacyMenuBar =
        typeof raw.menuBarEnabled === "boolean"
        && shellPrefs.menuBarEnabled === undefined
        && officialPrefs.menuBarEnabled === undefined
          ? { menuBarEnabled: raw.menuBarEnabled }
          : {};
      const combinedStored = { ...officialPrefs, ...shellPrefs, ...legacyMenuBar };
      const preferences = mergeAppPreferences(combinedStored);
      // Official Xo residual: mcpServers from claude_desktop_config.json wins over shell bag.
      // Fall back: shell mcpServersConfig → legacy mcp-servers.json mirror.
      const officialMcp = readOfficialMcpServersSegment(this.officialConfigPath);
      const shellMcp =
        raw.mcpServersConfig && typeof raw.mcpServersConfig === "object"
          ? (raw.mcpServersConfig as Record<string, unknown>)
          : {};
      const legacyMirror = this.readLegacyMcpServersMirror();
      const mcpServersConfig =
        Object.keys(officialMcp).length > 0
          ? officialMcp
          : Object.keys(shellMcp).length > 0
            ? { ...base.mcpServersConfig, ...shellMcp }
            : { ...base.mcpServersConfig, ...legacyMirror };
      return {
        ...base,
        ...raw,
        preferences,
        menuBarEnabled:
          typeof preferences.menuBarEnabled === "boolean"
            ? preferences.menuBarEnabled
            : (raw.menuBarEnabled ?? base.menuBarEnabled),
        appFeatures: { ...base.appFeatures, ...(raw.appFeatures ?? {}) },
        mcpServersConfig,
        custom3pConfigs: { ...base.custom3pConfigs, ...(raw.custom3pConfigs ?? {}) },
      };
    } catch {
      // Shell missing: still try official config preferences + mcpServers (honest dual-read).
      const officialPrefs = readOfficialPreferencesSegment(this.officialConfigPath);
      const officialMcp = readOfficialMcpServersSegment(this.officialConfigPath);
      const legacyMirror = this.readLegacyMcpServersMirror();
      const mcpServersConfig =
        Object.keys(officialMcp).length > 0
          ? officialMcp
          : legacyMirror;
      if (officialPrefs || Object.keys(mcpServersConfig).length > 0) {
        return {
          ...defaultState(),
          ...(officialPrefs
            ? { preferences: mergeAppPreferences(officialPrefs) }
            : {}),
          mcpServersConfig,
        };
      }
      return defaultState();
    }
  }

  private readLegacyMcpServersMirror(): Record<string, unknown> {
    try {
      const mirror = this.getLegacyMcpServersMirrorFile();
      if (!fs.existsSync(mirror)) return {};
      const raw = JSON.parse(fs.readFileSync(mirror, "utf8")) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      // Mirror may be flat map or { mcpServers: ... }.
      const rec = raw as Record<string, unknown>;
      if (
        rec.mcpServers
        && typeof rec.mcpServers === "object"
        && !Array.isArray(rec.mcpServers)
      ) {
        return { ...(rec.mcpServers as Record<string, unknown>) };
      }
      return { ...rec };
    } catch {
      return {};
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.state, null, 2));
    // Legacy mirror for diagnostics / older tooling (not the Edit Config target).
    try {
      fs.writeFileSync(
        this.getLegacyMcpServersMirrorFile(),
        JSON.stringify(this.state.mcpServersConfig, null, 2),
      );
    } catch {
      /* best-effort */
    }
    // Official F_("preferences", i) dual-write residual — does not invent other Xo keys.
    try {
      writeOfficialPreferencesSegment(
        this.officialConfigPath,
        this.state.preferences,
      );
    } catch {
      /* dual-write best-effort; shell file remains source of truth for product */
    }
    // Official F_("mcpServers", bag) dual-write residual.
    try {
      writeOfficialMcpServersSegment(
        this.officialConfigPath,
        this.state.mcpServersConfig,
      );
    } catch {
      /* best-effort */
    }
  }

  /**
   * Official AppConfig.getAppConfig residual returns Xo() bag with nested
   * `features` (not flat feature keys). Renderer Developer settings reads
   * `getAppConfig().features.isDxtEnabled`.
   */
  getAppConfig(): Record<string, unknown> {
    let appVersion = "";
    try {
      appVersion = app.getVersion();
    } catch {
      appVersion = "";
    }
    return {
      is3p: true,
      desktopShell: "claudex-desktop",
      appVersion,
      // Official Xo residual: feature flags live under `features`, not flat.
      features: { ...this.state.appFeatures },
    };
  }

  /**
   * Official InA residual:
   *   vi().isLocalDevMcpEnabled === false ? false
   *     : (Xo().features)?.isLocalDevMcpEnabled !== false
   * Never `Boolean(undefined)` — absent means enabled.
   */
  isLocalDevMcpEnabled(): boolean {
    return resolveIsLocalDevMcpEnabled({
      enterpriseIsLocalDevMcpEnabled: getCoworkEnterpriseBoolean(
        "isLocalDevMcpEnabled",
      ),
      featureIsLocalDevMcpEnabled: this.state.appFeatures.isLocalDevMcpEnabled,
    });
  }

  /**
   * Official isDxt residual:
   *   vi().isDesktopExtensionEnabled === false ? false
   *     : (Xo().features)?.isDxtEnabled !== false
   */
  isDxtEnabled(): boolean {
    return resolveIsDxtEnabled({
      enterpriseIsDesktopExtensionEnabled: getCoworkEnterpriseBoolean(
        "isDesktopExtensionEnabled",
      ),
      featureIsDxtEnabled: this.state.appFeatures.isDxtEnabled,
    });
  }

  setAppFeature(key: string, value: unknown): boolean {
    this.state.appFeatures[key] = value;
    this.save();
    return true;
  }

  /**
   * Official AppFeatures.getSupportedFeatures / pw()+DoA residual (app.asar):
   * each key is `{ status: "supported" | "unavailable" | "unsupported", ... }`.
   * YK(features, key) → e[key] || { status: "unavailable" }.
   *
   * Sync `pw()` map is resolved via `resolveSupportedFeatures` (Dvi/mvi/pHA/…).
   * Product shell surface keys (localSessions, …) are honest process capabilities.
   * DoA async upgrades (louderPenguin / kappa / artifacts) stay unavailable until
   * those residual bridges are wired — never invent supported.
   */
  getSupportedFeatures(): Record<string, { status: string; reason?: string; unsupportedCode?: string }> {
    let isPackaged = false;
    try {
      isPackaged = app.isPackaged === true;
    } catch {
      isPackaged = false;
    }
    const prefs = this.getPreferences();
    return resolveSupportedFeatures(
      buildSupportedFeaturesDepsFromRuntime({
        preferences: prefs,
        isPackaged,
      }),
    );
  }

  /**
   * Official getPreferences → bLA(Xo().preferences ?? {}).
   * Always merge SSA defaults under stored preferences.
   */
  getPreferences(): Record<string, unknown> {
    return mergeAppPreferences(this.state.preferences);
  }

  /**
   * Official setPreference body (after eZt pre-hooks in handlers):
   * HSA validate then write. Returns false on reject (IPC-safe).
   * Does not invent requireCoworkFullVmSandbox true.
   */
  setPreference(key: string, value: unknown): boolean {
    const parsed = validateAppPreference(key, value);
    if (!parsed.ok) return false;
    this.state.preferences[parsed.key] = parsed.value;
    // Official gi("menuBarEnabled") lives on preferences; keep top-level mirror for shell dual-read.
    if (parsed.key === "menuBarEnabled") {
      this.state.menuBarEnabled = parsed.value === true;
    }
    this.save();
    return true;
  }

  /**
   * Official jsA(undefined) residual for setDeploymentMode("clear"):
   * write void deploymentMode (delete key) so next launch re-resolves SM/N1e.
   * validateAppPreference rejects undefined, so clear cannot go through setPreference.
   */
  deletePreference(key: string): boolean {
    if (typeof key !== "string" || key.length === 0) return false;
    if (
      !isOfficialAppPreferenceKey(key)
      && !isProductResidualPreferenceKey(key)
    ) {
      return false;
    }
    if (!(key in this.state.preferences)) {
      this.save();
      return true;
    }
    delete this.state.preferences[key];
    if (key === "menuBarEnabled") {
      this.state.menuBarEnabled = true;
    }
    this.save();
    return true;
  }

  /**
   * Official EKA.isMenuBarEnabled → gi("menuBarEnabled").
   * Prefer preferences bag; fall back to legacy top-level shell field.
   */
  isMenuBarEnabled(): boolean {
    const fromPrefs = this.getPreferences().menuBarEnabled;
    if (typeof fromPrefs === "boolean") return fromPrefs;
    return this.state.menuBarEnabled !== false;
  }

  /**
   * Official EKA.setMenuBarEnabled → xn("menuBarEnabled", e).
   * Writes preference (SSA key) so Rh/post-write effects + getPreferences stay consistent.
   */
  setMenuBarEnabled(enabled: boolean): boolean {
    return this.setPreference("menuBarEnabled", enabled);
  }

  getGlobalShortcut(): string | null {
    return this.state.globalShortcut;
  }

  setGlobalShortcut(accelerator: string | null): boolean {
    this.state.globalShortcut = accelerator;
    this.save();
    try {
      writeOfficialGlobalShortcutSegment(this.officialConfigPath, accelerator);
    } catch {
      /* best-effort */
    }
    return true;
  }

  getMcpServersConfig(): Record<string, unknown> {
    return { ...this.state.mcpServersConfig };
  }

  /**
   * Write MCP server map (Developer settings / setMcpServerConfigs residual).
   * Persists shell bag + legacy mirror + official claude_desktop_config.json#mcpServers.
   */
  setMcpServersConfig(config: Record<string, unknown>): boolean {
    this.state.mcpServersConfig =
      config && typeof config === "object" && !Array.isArray(config) ? { ...config } : {};
    this.save();
    return true;
  }

  /**
   * Re-read official mcpServers from disk (Developer menu "Reload MCP config" residual).
   * Useful when user edits claude_desktop_config.json externally.
   */
  reloadMcpServersConfigFromOfficial(): Record<string, unknown> {
    const officialMcp = readOfficialMcpServersSegment(this.officialConfigPath);
    this.state.mcpServersConfig = { ...officialMcp };
    // Keep mirrors in sync without re-filtering already-validated official bag.
    try {
      fs.writeFileSync(
        this.getLegacyMcpServersMirrorFile(),
        JSON.stringify(this.state.mcpServersConfig, null, 2),
      );
    } catch {
      /* best-effort */
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsFile, "utf8")) as PersistedSettings;
      raw.mcpServersConfig = this.state.mcpServersConfig;
      fs.writeFileSync(this.settingsFile, JSON.stringify(raw, null, 2));
    } catch {
      /* shell may be absent; save() path still dual-writes on next set */
      try {
        this.save();
      } catch {
        /* ignore */
      }
    }
    return this.getMcpServersConfig();
  }

  /**
   * Legacy shell multi-config list (desktop-shell-settings.json).
   * Custom3pSetup IPC uses official configLibrary residual; this remains for
   * one-shot migration input and support diagnostics.
   */
  listCustom3pConfigs(): Custom3pConfigRecord[] {
    // Prefer official configLibrary residual when present.
    try {
      const userDataDir = this.getUserDataDir();
      const listed = listCustom3pConfigLibrary(userDataDir);
      if (listed.entries.length > 0) {
        return listed.entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          createdAt: entry.createdAt ?? "",
          updatedAt: entry.updatedAt ?? "",
          config: readCustom3pConfigLibraryBag(userDataDir, entry.id),
        }));
      }
    } catch {
      // fall through
    }
    return Object.values(this.state.custom3pConfigs).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  readCustom3pConfig(id: string): Custom3pConfigRecord | null {
    return this.state.custom3pConfigs[id] ?? null;
  }

  createCustom3pConfig(name: string, config: unknown = {}): Custom3pConfigRecord {
    const timestamp = nowIso();
    const id = `${slug(name)}-${Date.now()}`;
    const record = { id, name, config, createdAt: timestamp, updatedAt: timestamp };
    this.state.custom3pConfigs[id] = record;
    this.save();
    return record;
  }

  writeCustom3pConfig(id: string, config: unknown): Custom3pConfigRecord | null {
    const existing = this.state.custom3pConfigs[id];
    if (!existing) return null;
    const updated = { ...existing, config, updatedAt: nowIso() };
    this.state.custom3pConfigs[id] = updated;
    this.save();
    return updated;
  }

  renameCustom3pConfig(id: string, name: string): Custom3pConfigRecord | null {
    const existing = this.state.custom3pConfigs[id];
    if (!existing) return null;
    const updated = { ...existing, name, updatedAt: nowIso() };
    this.state.custom3pConfigs[id] = updated;
    this.save();
    return updated;
  }

  duplicateCustom3pConfig(id: string, name?: string): Custom3pConfigRecord | null {
    const existing = this.state.custom3pConfigs[id];
    if (!existing) return null;
    return this.createCustom3pConfig(name ?? `${existing.name} copy`, existing.config);
  }

  deleteCustom3pConfig(id: string): boolean {
    const existed = Boolean(this.state.custom3pConfigs[id]);
    delete this.state.custom3pConfigs[id];
    if (this.state.appliedCustom3pConfigId === id) this.state.appliedCustom3pConfigId = null;
    this.save();
    return existed;
  }

  setAppliedCustom3pConfig(id: string | null): boolean {
    if (id && !this.state.custom3pConfigs[id]) return false;
    this.state.appliedCustom3pConfigId = id;
    this.save();
    return true;
  }

  getAppliedCustom3pConfigId(): string | null {
    try {
      const fromLibrary = getAppliedCustom3pConfigLibraryId(this.getUserDataDir());
      if (fromLibrary) return fromLibrary;
    } catch {
      // fall through to legacy shell bag
    }
    return this.state.appliedCustom3pConfigId;
  }

  /**
   * Applied custom3p enterprise bag from official configLibrary residual
   * (legacy shell bag fallback). Main injects this bag as env (G4/HFi).
   */
  getAppliedCustom3pConfig(): unknown | null {
    try {
      const fromLibrary = getAppliedCustom3pConfigLibraryBag(this.getUserDataDir());
      if (fromLibrary.id) return fromLibrary.config;
    } catch {
      // fall through
    }
    const id = this.state.appliedCustom3pConfigId;
    if (!id) return null;
    return this.state.custom3pConfigs[id]?.config ?? null;
  }

  getCredentialHelperLastRun(): unknown {
    return this.state.credentialHelperLastRun;
  }

  setCredentialHelperLastRun(value: unknown): void {
    this.state.credentialHelperLastRun = value;
    this.save();
  }
}
