/**
 * Residual process shim for renderer preloads.
 * data-official-source: aboutWindow.js / mainWindow.js
 *   allowlist arch/platform/type/versions + version=appVersion + env={}
 *
 * APP_VERSION is injected at build:preload from package.json.
 */
declare const __CLAUDEX_APP_VERSION__: string | undefined;

function resolveAppVersion(explicit?: string): string {
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  try {
    if (typeof __CLAUDEX_APP_VERSION__ === "string" && __CLAUDEX_APP_VERSION__.length > 0) {
      return __CLAUDEX_APP_VERSION__;
    }
  } catch {
    /* define may be absent in unit tests */
  }
  return "0.0.0";
}

export function createProcessShim(appVersion?: string) {
  return {
    arch: process.arch,
    platform: process.platform,
    type: process.type,
    versions: process.versions,
    version: resolveAppVersion(appVersion),
    env: {},
  };
}
