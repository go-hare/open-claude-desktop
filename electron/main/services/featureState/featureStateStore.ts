import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type FeatureStateKey =
  | "spaces"
  | "artifacts"
  | "memories"
  | "orbitDeploys"
  | "customMarketplaces"
  | "localPlugins"
  | "autoVerify";

type FeatureState = Record<FeatureStateKey, Record<string, unknown>>;

function emptyState(): FeatureState {
  return {
    spaces: {},
    artifacts: {},
    memories: {},
    orbitDeploys: {},
    customMarketplaces: {},
    localPlugins: {},
    autoVerify: {},
  };
}

export class FeatureStateStore {
  private readonly filePath: string;
  private state: FeatureState;

  constructor(filePath = path.join(app.getPath("userData"), "desktop-shell-feature-state.json")) {
    this.filePath = filePath;
    this.state = this.read();
  }

  private read(): FeatureState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<FeatureState>;
      return { ...emptyState(), ...parsed };
    } catch {
      return emptyState();
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  loadMap<T extends Record<string, unknown> | string | boolean>(key: FeatureStateKey): Map<string, T> {
    return new Map(Object.entries(this.state[key] ?? {}) as Array<[string, T]>);
  }

  saveMap<T extends Record<string, unknown> | string | boolean>(key: FeatureStateKey, map: Map<string, T>): void {
    this.state[key] = Object.fromEntries(map.entries());
    this.save();
  }

  getBoolean(key: FeatureStateKey, id: string, defaultValue = false): boolean {
    const value = this.state[key]?.[id];
    return typeof value === "boolean" ? value : defaultValue;
  }

  setBoolean(key: FeatureStateKey, id: string, value: boolean): void {
    this.state[key][id] = value;
    this.save();
  }
}
