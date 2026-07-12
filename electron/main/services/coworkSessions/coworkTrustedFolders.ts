import path from "node:path";
import type { SettingsStore } from "../settings/settingsStore";

const preferenceKey = "localAgentModeTrustedFolders";
const maximumTrustedFolders = 300;

function normalizeEnd(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length === 0 ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

export class CoworkTrustedFolders {
  constructor(private readonly settings: SettingsStore) {}

  getAll(): string[] {
    const stored = this.settings.getPreferences()[preferenceKey];
    return Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === "string")
      : [];
  }

  isTrusted(folderPath: string): boolean {
    return this.getAll().some((trusted) => isWithin(folderPath, trusted));
  }

  add(folderPath: string): void {
    const folders = this.getAll();
    const normalized = normalizeEnd(folderPath);
    if (folders.some((folder) => normalizeEnd(folder) === normalized)) return;
    this.settings.setPreference(
      preferenceKey,
      [...folders, folderPath].slice(-maximumTrustedFolders),
    );
  }

  remove(folderPath: string): void {
    const normalized = normalizeEnd(folderPath);
    this.settings.setPreference(
      preferenceKey,
      this.getAll().filter((folder) => normalizeEnd(folder) !== normalized),
    );
  }
}
