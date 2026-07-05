import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

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

function defaultState(): PersistedSettings {
  return {
    preferences: {},
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
  private state: PersistedSettings;

  constructor(settingsFile = path.join(app.getPath("userData"), "desktop-shell-settings.json")) {
    this.settingsFile = settingsFile;
    this.state = this.read();
  }

  getSettingsFile(): string {
    return this.settingsFile;
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
      return { ...defaultState(), ...JSON.parse(fs.readFileSync(this.settingsFile, "utf8")) };
    } catch {
      return defaultState();
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.state, null, 2));
    fs.writeFileSync(this.getMcpConfigFile(), JSON.stringify(this.state.mcpServersConfig, null, 2));
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

  getSupportedFeatures(): Record<string, boolean> {
    return {
      localSessions: true,
      scheduledTasks: true,
      findInPage: true,
      fileSystem: true,
      desktopNotifications: true,
      secondaryWindows: true,
      customProtocols: true,
    };
  }

  getPreferences(): Record<string, unknown> {
    return { ...this.state.preferences };
  }

  setPreference(key: string, value: unknown): boolean {
    this.state.preferences[key] = value;
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
