/**
 * Official WindowControl.setThemeMode residual (app.asar):
 *   setThemeMode(t) {
 *     gA.nativeTheme.themeSource = t;
 *     Yi.set("userThemeMode", t);
 *   }
 * Bootstrap:
 *   const _z = Yi.get("userThemeMode");
 *   (_z === "system" || _z === "light" || _z === "dark") &&
 *     (gA.nativeTheme.themeSource = _z);
 *
 * Yi is official electron-store; product persists userThemeMode beside shell
 * settings (not inventing an SSA preference key).
 *
 * data-official-source: app.asar index.js setThemeMode / userThemeMode bootstrap
 */

import { app, nativeTheme } from "electron";
import fs from "node:fs";
import path from "node:path";

export type UserThemeMode = "system" | "light" | "dark";

const VALID = new Set<UserThemeMode>(["system", "light", "dark"]);

export function isUserThemeMode(value: unknown): value is UserThemeMode {
  return typeof value === "string" && VALID.has(value as UserThemeMode);
}

function themeFile(userDataPath?: string): string {
  const root = userDataPath ?? app.getPath("userData");
  return path.join(root, "user-theme-mode.json");
}

export function readUserThemeMode(userDataPath?: string): UserThemeMode | null {
  try {
    const raw = JSON.parse(fs.readFileSync(themeFile(userDataPath), "utf8")) as {
      userThemeMode?: unknown;
    };
    return isUserThemeMode(raw.userThemeMode) ? raw.userThemeMode : null;
  } catch {
    return null;
  }
}

export function writeUserThemeMode(
  mode: UserThemeMode,
  userDataPath?: string,
): void {
  const file = themeFile(userDataPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ userThemeMode: mode }, null, 2)}\n`,
    "utf8",
  );
}

/** Official setThemeMode body. */
export function setUserThemeMode(mode: unknown, userDataPath?: string): boolean {
  if (!isUserThemeMode(mode)) return false;
  nativeTheme.themeSource = mode;
  writeUserThemeMode(mode, userDataPath);
  return true;
}

/** Official bootstrap residual — apply stored theme if valid. */
export function applyStoredUserThemeMode(userDataPath?: string): void {
  const mode = readUserThemeMode(userDataPath);
  if (mode) nativeTheme.themeSource = mode;
}
