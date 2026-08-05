/**
 * Official sFi / GUi / aFi residual (app.asar):
 *   xQe = 1000ms race on listInstalledApps + listRunningApps
 *   GUi(apps, homedir, runningSet, platform) → sanitized display-name list
 *   aFi → hMA(buildComputerUseTools(..., installedAppNames)) cache when enumeration succeeds
 *
 * Product: pure GUi-style sanitizer + optional async prewarm against Darwin executor.
 * Never invents an app list when natives / enumeration fail or timeout.
 */
import { homedir } from "node:os";

/** Official xQe residual — 1s race. */
export const COMPUTER_USE_APP_ENUM_TIMEOUT_MS = 1000;

/** Official bUi / _fA residual caps. */
const MAX_NAME_LEN = 40;
const MAX_APP_COUNT = 200;

/** Official name character allowlist LUi residual. */
const NAME_ALLOW = /^[\p{L}\p{N}_ .&'()+-]+$/u;

/** Official kUi residual — helper/agent noise names. */
const NOISE_NAME_RES: readonly RegExp[] = [
  /Helper(?:$|\s\()/,
  /Agent(?:$|\s\()/,
  /Service(?:$|\s\()/,
  /Uninstaller(?:$|\s\()/,
  /Updater(?:$|\s\()/,
  /^\./,
];

/** Official NUi residual — app path prefixes (darwin). */
const APP_PATH_PREFIXES = ["/Applications/", "/System/Applications/"] as const;

/**
 * Official TUi residual — priority apps (listed first when installed).
 * Truncated to the residual set used by GUi for description ordering.
 */
export const PRIORITY_APP_BUNDLE_IDS: ReadonlySet<string> = new Set([
  "com.tinyspeck.slackmacgap",
  "us.zoom.xos",
  "com.microsoft.teams2",
  "com.microsoft.teams",
  "com.apple.MobileSMS",
  "com.apple.mail",
  "com.microsoft.Word",
  "com.microsoft.Excel",
  "com.microsoft.Powerpoint",
  "com.microsoft.Outlook",
  "com.apple.iWork.Pages",
  "com.apple.iWork.Numbers",
  "com.apple.iWork.Keynote",
  "com.google.GoogleDocs",
  "notion.id",
  "com.apple.Notes",
  "md.obsidian",
  "com.linear",
  "com.figma.Desktop",
  "com.github.GitHubDesktop",
  "com.apple.finder",
  "com.apple.iCal",
  "com.apple.systempreferences",
]);

export type ComputerUseInstalledApp = {
  bundleId: string;
  displayName: string;
  path?: string;
};

function isNoiseName(name: string): boolean {
  return NOISE_NAME_RES.some((re) => re.test(name));
}

function isAllowedAppPath(appPath: string | undefined, home: string): boolean {
  if (!appPath) return false;
  for (const prefix of APP_PATH_PREFIXES) {
    if (appPath.startsWith(prefix)) return true;
  }
  if (home) {
    const userApps = home.endsWith("/")
      ? `${home}Applications/`
      : `${home}/Applications/`;
    if (appPath.startsWith(userApps)) return true;
  }
  return false;
}

function sanitizeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim();
    if (!n || n.length > MAX_NAME_LEN) continue;
    if (!NAME_ALLOW.test(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function capList(names: string[]): string[] {
  if (names.length <= MAX_APP_COUNT) return names;
  const extra = names.length - MAX_APP_COUNT;
  return [...names.slice(0, MAX_APP_COUNT), `... and ${extra} more`];
}

/**
 * Official GUi residual (darwin path). Win32 branch not productized here.
 *
 * Priority bundle ids first (sorted), then other allowed-path apps (sorted);
 * running apps float to the front of the merged list.
 */
export function formatInstalledAppNamesForTools(
  apps: readonly ComputerUseInstalledApp[],
  options?: {
    homeDir?: string;
    platform?: NodeJS.Platform;
    runningBundleIds?: ReadonlySet<string> | readonly string[];
  },
): string[] {
  const platform = options?.platform ?? process.platform;
  const home = options?.homeDir ?? "";
  const running = new Set(
    options?.runningBundleIds instanceof Set
      ? options.runningBundleIds
      : (options?.runningBundleIds ?? []),
  );

  if (platform === "win32") {
    // Residual win32 GUi exists; product Mac-only — return empty rather than invent.
    return [];
  }

  const priorityNames: string[] = [];
  const otherNames: string[] = [];
  const runningNames = new Set<string>();

  for (const app of apps) {
    const name = typeof app.displayName === "string" ? app.displayName : "";
    if (!name) continue;
    if (running.has(app.bundleId)) {
      runningNames.add(name.trim());
    }
    if (PRIORITY_APP_BUNDLE_IDS.has(app.bundleId)) {
      priorityNames.push(name);
      continue;
    }
    if (isAllowedAppPath(app.path, home) && !isNoiseName(name)) {
      otherNames.push(name);
    }
  }

  const prioritySorted = sanitizeNames(priorityNames);
  const prioritySet = new Set(prioritySorted);
  const otherSorted = sanitizeNames(otherNames).filter((n) => !prioritySet.has(n));
  const merged = [...prioritySorted, ...otherSorted];
  const [front, back] = merged.reduce<[string[], string[]]>(
    (acc, name) => {
      if (runningNames.has(name) || runningNames.has(name.trim())) {
        acc[0].push(name);
      } else {
        acc[1].push(name);
      }
      return acc;
    },
    [[], []],
  );
  return capList([...front, ...back]);
}

async function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type ComputerUseAppEnumExecutor = {
  listInstalledApps: () => Promise<ComputerUseInstalledApp[]>;
  listRunningApps?: () => Promise<Array<{ bundleId: string }>>;
};

/**
 * Official sFi residual: race listInstalledApps (1s); optional running set;
 * format via GUi. Returns undefined on timeout/failure (tool desc omits list).
 */
export async function enumerateInstalledAppNamesForTools(
  executor: ComputerUseAppEnumExecutor,
  options?: {
    homeDir?: string;
    platform?: NodeJS.Platform;
    timeoutMs?: number;
  },
): Promise<string[] | undefined> {
  const timeoutMs = options?.timeoutMs ?? COMPUTER_USE_APP_ENUM_TIMEOUT_MS;
  try {
    const installedPromise = executor.listInstalledApps();
    const installed = await raceTimeout(installedPromise, timeoutMs);
    if (!installed) {
      installedPromise.catch(() => undefined);
      return undefined;
    }
    let running = new Set<string>();
    if (executor.listRunningApps) {
      try {
        const runningPromise = executor.listRunningApps();
        const rows = await raceTimeout(runningPromise, timeoutMs);
        if (rows) {
          running = new Set(
            rows
              .map((r) => r.bundleId)
              .filter((id): id is string => typeof id === "string" && id.length > 0),
          );
        } else {
          runningPromise.catch(() => undefined);
        }
      } catch {
        // residual: running set optional
      }
    }
    const names = formatInstalledAppNamesForTools(installed, {
      homeDir: options?.homeDir ?? homedir(),
      platform: options?.platform ?? process.platform,
      runningBundleIds: running,
    });
    return names.length > 0 ? names : undefined;
  } catch {
    return undefined;
  }
}

/** Module cache for aFi residual (HQe + OR). */
let cachedInstalledAppNames: string[] | undefined;
let cacheComplete = false;

/**
 * Sync peek of aFi cache (OR when HQe). Undefined when enumeration never succeeded.
 */
export function peekCachedInstalledAppNamesForTools(): string[] | undefined {
  return cacheComplete && cachedInstalledAppNames
    ? cachedInstalledAppNames
    : undefined;
}

/**
 * Official aFi residual: return cached tool-app names when enumeration succeeded once.
 * When chicago disabled / enumeration fails, returns undefined (hMA without list).
 */
export async function getCachedInstalledAppNamesForTools(
  load: () => Promise<string[] | undefined>,
): Promise<string[] | undefined> {
  if (cacheComplete && cachedInstalledAppNames) {
    return cachedInstalledAppNames;
  }
  const names = await load();
  if (names && names.length > 0) {
    cachedInstalledAppNames = names;
    cacheComplete = true;
    return names;
  }
  return cachedInstalledAppNames;
}

/**
 * Official aFi/gFi prewarm entry for desktop bootstrap / MCP inject.
 * Fire-and-forget; safe when natives missing (returns undefined, no invent list).
 */
export function kickComputerUseAppEnumerationPrewarm(
  loadExecutor: () => ComputerUseAppEnumExecutor | null | undefined,
): void {
  if (process.platform !== "darwin") return;
  void getCachedInstalledAppNamesForTools(async () => {
    const executor = loadExecutor();
    if (!executor?.listInstalledApps) return undefined;
    return enumerateInstalledAppNamesForTools(executor);
  }).catch(() => undefined);
}

/** Test helper */
export function resetComputerUseAppEnumerationForTests(): void {
  cachedInstalledAppNames = undefined;
  cacheComplete = false;
}
