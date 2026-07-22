import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  mergeAppPreferences,
  OFFICIAL_APP_PREFERENCE_DEFAULTS,
} from "./appPreferencesDefaults";
import { validateAppPreference } from "./appPreferencesSchema";
import {
  resolveOfficialAppConfigPath,
  readOfficialPreferencesSegment,
  writeOfficialGlobalShortcutSegment,
  writeOfficialPreferencesSegment,
} from "./officialConfigJson";

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

  getMcpConfigFile(): string {
    return path.join(this.getUserDataDir(), "mcp-servers.json");
  }

  private read(): PersistedSettings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsFile, "utf8")) as Partial<PersistedSettings>;
      const base = defaultState();
      // Dual-read residual: seed from official config.json preferences under shell prefs.
      const officialPrefs = readOfficialPreferencesSegment(this.officialConfigPath) ?? {};
      const shellPrefs = raw.preferences ?? {};
      const combinedStored = { ...officialPrefs, ...shellPrefs };
      return {
        ...base,
        ...raw,
        preferences: mergeAppPreferences(combinedStored),
        appFeatures: { ...base.appFeatures, ...(raw.appFeatures ?? {}) },
        mcpServersConfig: { ...base.mcpServersConfig, ...(raw.mcpServersConfig ?? {}) },
        custom3pConfigs: { ...base.custom3pConfigs, ...(raw.custom3pConfigs ?? {}) },
      };
    } catch {
      // Shell missing: still try official config preferences (honest dual-read).
      const officialPrefs = readOfficialPreferencesSegment(this.officialConfigPath);
      if (officialPrefs) {
        return {
          ...defaultState(),
          preferences: mergeAppPreferences(officialPrefs),
        };
      }
      return defaultState();
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.state, null, 2));
    fs.writeFileSync(this.getMcpConfigFile(), JSON.stringify(this.state.mcpServersConfig, null, 2));
    // Official F_("preferences", i) dual-write residual — does not invent other Xo keys.
    try {
      writeOfficialPreferencesSegment(
        this.officialConfigPath,
        this.state.preferences,
      );
    } catch {
      /* dual-write best-effort; shell file remains source of truth for product */
    }
  }

  getAppConfig(): Record<string, unknown> {
    return {
      is3p: true,
      desktopShell: "claude-deepseek-desktop",
      appVersion: app.getVersion(),
      ...this.state.appFeatures,
    };
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
   * Product shell capabilities that this process actually provides are supported.
   * nativeQuickEntry / quickEntryDictation / customQuickEntryDictationShortcut /
   * wakeScheduler stay unavailable until a real native API exists — never invent supported.
   */
  getSupportedFeatures(): Record<string, { status: string }> {
    const supported = { status: "supported" as const };
    const unavailable = { status: "unavailable" as const };
    return {
      // Honest product shell surface (desktop residual, not official X3t keys alone).
      localSessions: supported,
      scheduledTasks: supported,
      findInPage: supported,
      fileSystem: supported,
      desktopNotifications: supported,
      secondaryWindows: supported,
      customProtocols: supported,
      // Official pw() keys that gate Desktop General / onboarding — no native API yet.
      nativeQuickEntry: unavailable,
      quickEntryDictation: unavailable,
      customQuickEntryDictationShortcut: unavailable,
      wakeScheduler: unavailable,
    };
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
    this.save();
    return true;
  }

  isMenuBarEnabled(): boolean {
    return this.state.menuBarEnabled;
  }

  setMenuBarEnabled(enabled: boolean): boolean {
    this.state.menuBarEnabled = enabled;
    this.save();
    return true;
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

  setMcpServersConfig(config: Record<string, unknown>): boolean {
    this.state.mcpServersConfig = config;
    this.save();
    return true;
  }

  listCustom3pConfigs(): Custom3pConfigRecord[] {
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
    return this.state.appliedCustom3pConfigId;
  }

  getCredentialHelperLastRun(): unknown {
    return this.state.credentialHelperLastRun;
  }

  setCredentialHelperLastRun(value: unknown): void {
    this.state.credentialHelperLastRun = value;
    this.save();
  }
}
