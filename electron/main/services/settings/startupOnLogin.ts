/**
 * Official Startup / EKA residual (app.asar):
 *
 *   isStartupOnLoginEnabled() {
 *     if (process.env.CLAUDE_AVOID_READING_LOGING_ITEM_SETTINGS) return false;
 *     const e = app.getLoginItemSettings({ path: xSe() });
 *     return e.openAtLogin || e.executableWillLaunchAtLogin;
 *   }
 *   setStartupOnLoginEnabled(e) {
 *     app.setLoginItemSettings({
 *       openAtLogin: e, enabled: e, path: xSe(), name: "Claude",
 *     });
 *   }
 *   function xSe() {
 *     // win32 + !msix: `"…/Claude.exe" --startup`
 *     // else (darwin / msix / unpackaged win): process.execPath
 *     if (!win32 || isMsix()) return process.execPath;
 *     return `"${resolve(dirname(execPath), "..", basename(execPath))}" --startup`;
 *   }
 *
 * Boot residual SEr (main window show gate):
 *   darwin: !(avoidEnv && wasOpenedAtLogin)  → hide only when avoid+login-open
 *   win32:  !argv.includes("--startup")
 * Product: same gate for showOnCreate; product name is Claudex.
 */
import { app } from "electron";
import path from "node:path";

/** Official typo residual kept: LOGING not LOGIN. */
export const CLAUDE_AVOID_READING_LOGING_ITEM_SETTINGS =
  "CLAUDE_AVOID_READING_LOGING_ITEM_SETTINGS";

/** Product Login Item display name (official uses "Claude"; product is Claudex). */
export const STARTUP_LOGIN_ITEM_NAME =
  process.env.CLAUDE_PRODUCT_NAME?.trim() || "Claudex";

export type StartupLoginItemSettingsLike = {
  openAtLogin?: boolean;
  executableWillLaunchAtLogin?: boolean;
  wasOpenedAtLogin?: boolean;
};

export type StartupOnLoginDeps = {
  platform?: NodeJS.Platform;
  execPath?: string;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  /** Official Hc residual — windowsStore / MSIX. Default: process.windowsStore. */
  isMsix?: () => boolean;
  getLoginItemSettings?: (opts?: { path?: string }) => StartupLoginItemSettingsLike;
  setLoginItemSettings?: (settings: {
    openAtLogin: boolean;
    enabled: boolean;
    path: string;
    name: string;
  }) => void;
  /** Override product display name (tests). */
  loginItemName?: string;
};

function defaultIsMsix(): boolean {
  return Boolean(
    (process as NodeJS.Process & { windowsStore?: boolean }).windowsStore,
  );
}

/**
 * Official xSe residual — login-item path string passed to get/setLoginItemSettings.
 * Darwin / MSIX / non-win: bare execPath.
 * Packaged win32 non-MSIX: quoted parent-dir binary + ` --startup`.
 */
export function resolveStartupLoginItemPath(
  deps: Pick<StartupOnLoginDeps, "platform" | "execPath" | "isMsix"> = {},
): string {
  const platform = deps.platform ?? process.platform;
  const execPath = deps.execPath ?? process.execPath;
  const isMsix = deps.isMsix ?? defaultIsMsix;
  if (platform !== "win32" || isMsix()) {
    return execPath;
  }
  // Official: `"${resolve(dirname(e), "..", basename(e))}" --startup`
  const target = path.resolve(path.dirname(execPath), "..", path.basename(execPath));
  return `"${target}" --startup`;
}

export function isStartupOnLoginEnabled(
  deps: StartupOnLoginDeps = {},
): boolean {
  const env = deps.env ?? process.env;
  // Official spelling residual (LOGING).
  if (env[CLAUDE_AVOID_READING_LOGING_ITEM_SETTINGS]) {
    return false;
  }
  const get =
    deps.getLoginItemSettings
    ?? ((opts?: { path?: string }) => app.getLoginItemSettings(opts ?? {}));
  const pathArg = resolveStartupLoginItemPath(deps);
  const settings = get({ path: pathArg });
  return Boolean(
    settings.openAtLogin || settings.executableWillLaunchAtLogin,
  );
}

/**
 * Official setStartupOnLoginEnabled residual.
 * Product returns boolean for bridge (official set is void; UI checks re-read).
 */
export function setStartupOnLoginEnabled(
  enabled: boolean,
  deps: StartupOnLoginDeps = {},
): boolean {
  const next = Boolean(enabled);
  const pathArg = resolveStartupLoginItemPath(deps);
  const name = deps.loginItemName ?? STARTUP_LOGIN_ITEM_NAME;
  const set =
    deps.setLoginItemSettings
    ?? ((settings) => {
      app.setLoginItemSettings(settings);
    });
  try {
    set({
      openAtLogin: next,
      enabled: next,
      path: pathArg,
      name,
    });
  } catch (error) {
    console.warn("[startupOnLogin] setLoginItemSettings failed", error);
    return false;
  }
  // Avoid-env forces is* false — write still applied; report false only when
  // avoid env is set so UI does not claim enabled while reader is forced off.
  if ((deps.env ?? process.env)[CLAUDE_AVOID_READING_LOGING_ITEM_SETTINGS]) {
    return false;
  }
  return isStartupOnLoginEnabled(deps) === next;
}

/**
 * Official SEr residual — whether main BrowserWindow should `show` on create:
 *
 *   const SEr = !(
 *     sr
 *       ? !env.CLAUDE_AVOID_READING_LOGING_ITEM_SETTINGS
 *         && app.getLoginItemSettings().wasOpenedAtLogin
 *       : argv.includes("--startup")
 *   );
 *   // BrowserWindow show: (SEr || !1) && !L1e()  → effectively SEr (L1e = deep-link hold)
 *
 *   darwin: hide only when avoid-env is NOT set AND wasOpenedAtLogin
 *           (login-item quiet boot). If avoid-env is set → always show.
 *   win32:  hide when argv has `--startup`
 *   other:  true
 *
 * wasOpenedAtLogin uses getLoginItemSettings() without path (official SEr).
 */
export function shouldShowMainWindowOnCreate(
  deps: StartupOnLoginDeps = {},
): boolean {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const argv = deps.argv ?? process.argv;
  if (platform === "darwin") {
    // Official: condition = !avoidEnv && wasOpenedAtLogin; SEr = !condition
    const avoidSet = Boolean(env[CLAUDE_AVOID_READING_LOGING_ITEM_SETTINGS]);
    if (avoidSet) return true;
    const get =
      deps.getLoginItemSettings
      ?? (() => app.getLoginItemSettings());
    const wasOpenedAtLogin = get().wasOpenedAtLogin === true;
    return !wasOpenedAtLogin;
  }
  if (platform === "win32") {
    return !argv.includes("--startup");
  }
  return true;
}
