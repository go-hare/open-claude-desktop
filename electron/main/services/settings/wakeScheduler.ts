/**
 * Official WakeScheduler residual (app.asar pvi / wvi / $_A / wU / fvi / FW / Ule):
 *
 *   class pvi {
 *     scheduleWake(A)  → api ? api.scheduleWake(A) : 3758097095
 *     cancelWakes()    → api ? api.cancelWakes()   : 3758097095
 *     reconcileInner:
 *       !api → defer (never invent install/enabled)
 *       !fvi() kill-switch → release approval claim + courtesy-flip rollback
 *       enabled + version change → re-register
 *       enabled + notRegistered|notFound → install()
 *       !enabled + enabled|requiresApproval → uninstall
 *       enabled + requiresApproval + approvedThisCycle → user revoked → uninstall + pref off
 *       status enabled && !approved → mark approvedThisCycle
 *       approval pending → UZe(FW) + 15min timeout flip pref off
 *       enabled + keepAwake both on → courtesy-flip keepAwake off
 *   }
 *   wvi: darwin → pvi; win32/other → null
 *
 * Official boot residual (app.asar):
 *   F9i().then(() => dvi(wvi(hkA)))
 *   hkA() = (nr?.wakeScheduler) ?? null   // after Y9i loads @ant/claude-swift
 *   wvi(hkA) = darwin pvi(getApi=hkA)
 *   dvi(controller): wU=controller; reconcile(); Rh.on(wakeSchedulerEnabled)
 *
 * Product: JS pvi/reconcile residual already present. Native path aligns by
 * binding `nr.wakeScheduler` into getApi after Swift load (hkA/dvi) — never
 * invents a daemon when addon omits wakeScheduler or scheduleWake fails
 * (Nest-only / unpackaged LaunchDaemons → kIOReturnUnsupported is native truth).
 */
import {
  claimKeepAwake,
  KEEP_AWAKE_WAKE_SCHEDULER_CLAIM,
  releaseKeepAwake,
} from "./keepAwake";

/** Official 3758097095 — schedule/cancel when native API absent. */
export const WAKE_SCHEDULER_NO_API_ERROR = 3758097095;

/** Official Ule = 15 * 60000 (15 minutes). */
export const WAKE_SCHEDULER_APPROVAL_TIMEOUT_MS = 15 * 60_000;

/** Official FW claim id. */
export const WAKE_SCHEDULER_APPROVAL_CLAIM = KEEP_AWAKE_WAKE_SCHEDULER_CLAIM;

export type WakeSchedulerStatusCode =
  | "notFound"
  | "notRegistered"
  | "requiresApproval"
  | "enabled"
  | "unsupported";

export type WakeSchedulerGetStatusResult = {
  status: WakeSchedulerStatusCode | string;
  requiresSetup: boolean;
  approvedThisCycle: boolean;
  supported: boolean;
  /**
   * Product residual for older UI that read `enabled`.
   * True only when status === "enabled" (never invent from preference alone).
   */
  enabled: boolean;
};

export type WakeInstallResult = {
  success: boolean;
  error?: string;
};

/**
 * Official native wake API handle ($A / wU). Product never invents this.
 * Tests inject fakes; production remains null until a real bridge exists.
 */
export type WakeSchedulerNativeApi = {
  status: () => Promise<WakeSchedulerStatusCode | string>;
  requiresSetup?: boolean;
  approvedThisCycle?: () => boolean;
  openSettings?: () => void;
  install?: () => Promise<WakeInstallResult>;
  uninstall?: () => Promise<void> | void;
  scheduleWake?: (when: unknown) => Promise<number> | number;
  cancelWakes?: () => Promise<number> | number;
};

/** Back-compat alias used by existing tests. */
export type WakeSchedulerApi = WakeSchedulerNativeApi;

export type WakePreferenceKey =
  | "wakeSchedulerEnabled"
  | "wakeSchedulerApprovedThisCycle"
  | "wakeSchedulerRegisteredAtVersion"
  | "wakeSchedulerCourtesyFlippedKeepAwake"
  | "keepAwakeEnabled";

export type WakeSchedulerControllerDeps = {
  platform?: NodeJS.Platform;
  /** Official $_A() handle. Default null. */
  getApi?: () => WakeSchedulerNativeApi | null;
  /** Official fvi() GrowthBook gate residual. Default true (no kill-switch). */
  isFeatureEnabled?: () => boolean;
  /** Official gi(key) preference reader. */
  getPreference?: (key: WakePreferenceKey) => unknown;
  /** Official xn(key, value) preference writer. */
  setPreference?: (key: WakePreferenceKey, value: unknown) => Promise<void> | void;
  /** Official gA.app.getVersion(). */
  getAppVersion?: () => string;
  /** Official pw().wakeScheduler.status === "supported". */
  isPlatformSupported?: () => boolean;
  /** Claim/release keep-awake (UZe/z5). Injectable for tests. */
  claimApprovalPending?: () => void;
  releaseApprovalPending?: () => void;
  /** Timer injection for approval timeout tests. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  log?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
  };
};

function defaultPlatformSupported(platform: NodeJS.Platform): boolean {
  return platform === "darwin";
}

function defaultGetPreference(_key: WakePreferenceKey): unknown {
  return undefined;
}

/**
 * Official wvi residual — only darwin gets a pvi controller instance.
 * Product always may construct the controller for tests; platform gate is
 * applied at getStatus.supported / createWakeSchedulerForPlatform.
 */
export function createWakeSchedulerForPlatform(
  getApi: () => WakeSchedulerNativeApi | null,
  platform: NodeJS.Platform = process.platform,
): WakeSchedulerController | null {
  switch (platform) {
    case "darwin":
      return new WakeSchedulerController({ getApi, platform });
    case "win32":
      return null;
    default:
      return null;
  }
}

/**
 * Official pvi residual.
 */
export class WakeSchedulerController {
  readonly requiresSetup = true;
  private statusCache: WakeSchedulerStatusCode | string = "notFound";
  private reconciling = false;
  private pendingReconcile = false;
  private approvalBlockTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly deps: Required<
    Pick<
      WakeSchedulerControllerDeps,
      | "getApi"
      | "isFeatureEnabled"
      | "getPreference"
      | "setPreference"
      | "getAppVersion"
      | "isPlatformSupported"
      | "claimApprovalPending"
      | "releaseApprovalPending"
      | "setTimeoutFn"
      | "clearTimeoutFn"
      | "log"
    >
  > & { platform: NodeJS.Platform };

  constructor(deps: WakeSchedulerControllerDeps = {}) {
    const platform = deps.platform ?? process.platform;
    this.deps = {
      platform,
      getApi: deps.getApi ?? (() => null),
      isFeatureEnabled: deps.isFeatureEnabled ?? (() => true),
      getPreference: deps.getPreference ?? defaultGetPreference,
      setPreference: deps.setPreference ?? (async () => {}),
      getAppVersion: deps.getAppVersion ?? (() => "0.0.0"),
      isPlatformSupported:
        deps.isPlatformSupported
        ?? (() => defaultPlatformSupported(platform)),
      claimApprovalPending:
        deps.claimApprovalPending
        ?? (() => claimKeepAwake(WAKE_SCHEDULER_APPROVAL_CLAIM)),
      releaseApprovalPending:
        deps.releaseApprovalPending
        ?? (() => releaseKeepAwake(WAKE_SCHEDULER_APPROVAL_CLAIM)),
      setTimeoutFn: deps.setTimeoutFn ?? setTimeout,
      clearTimeoutFn: deps.clearTimeoutFn ?? clearTimeout,
      log: deps.log ?? {},
    };
  }

  openSettings = (): void => {
    const api = this.deps.getApi();
    api?.openSettings?.();
  };

  clearApprovalBlockTimer(): void {
    if (this.approvalBlockTimer !== null) {
      this.deps.clearTimeoutFn(this.approvalBlockTimer);
      this.approvalBlockTimer = null;
    }
  }

  async status(): Promise<WakeSchedulerStatusCode | string> {
    const api = this.deps.getApi();
    if (!api) return "notFound";
    const prev = this.statusCache;
    const next = await api.status();
    this.statusCache = next;
    if (
      (prev === "requiresApproval" && next === "enabled")
      || (prev === "enabled" && next === "requiresApproval")
    ) {
      void this.reconcile();
    }
    return next;
  }

  isReady(): boolean {
    return this.statusCache === "enabled";
  }

  /**
   * Official scheduleWake residual. Without API → 3758097095 (never invent success).
   */
  async scheduleWake(when: unknown): Promise<number> {
    const api = this.deps.getApi();
    if (!api?.scheduleWake) return WAKE_SCHEDULER_NO_API_ERROR;
    return await api.scheduleWake(when);
  }

  /**
   * Official cancelWakes residual. Without API → 3758097095.
   */
  async cancelWakes(): Promise<number> {
    const api = this.deps.getApi();
    if (!api?.cancelWakes) return WAKE_SCHEDULER_NO_API_ERROR;
    return await api.cancelWakes();
  }

  async onResume(): Promise<void> {
    await this.status();
  }

  approvedThisCycle(): boolean {
    return this.deps.getPreference("wakeSchedulerApprovedThisCycle") === true;
  }

  async reconcile(): Promise<void> {
    if (this.reconciling) {
      this.pendingReconcile = true;
      return;
    }
    this.reconciling = true;
    try {
      do {
        this.pendingReconcile = false;
        await this.reconcileInner();
      } while (this.pendingReconcile);
    } finally {
      this.reconciling = false;
    }
  }

  async reconcileInner(): Promise<void> {
    const { getApi, isFeatureEnabled, getPreference, setPreference, getAppVersion, log } =
      this.deps;
    const api = getApi();
    if (!api) {
      log.info?.("[wake-scheduler] api not ready, deferring reconcile");
      return;
    }

    if (!isFeatureEnabled()) {
      this.clearApprovalBlockTimer();
      this.deps.releaseApprovalPending();
      if (getPreference("wakeSchedulerCourtesyFlippedKeepAwake") === true) {
        await setPreference("keepAwakeEnabled", true);
        await setPreference("wakeSchedulerCourtesyFlippedKeepAwake", false);
        log.info?.(
          "[wake-scheduler] kill-switch: restored keepAwakeEnabled (courtesy-flip rollback)",
        );
      }
      return;
    }

    let t = await this.status();
    const prefOn = getPreference("wakeSchedulerEnabled") === true;
    const registeredAt = getPreference("wakeSchedulerRegisteredAtVersion");
    const version = getAppVersion();

    // Version re-register residual.
    if (prefOn && t === "enabled" && registeredAt !== version) {
      log.info?.(
        "[wake-scheduler] version changed %s → %s, re-registering",
        registeredAt,
        version,
      );
      try {
        await api.cancelWakes?.();
      } catch {
        /* ignore */
      }
      await api.uninstall?.();
      await setPreference("wakeSchedulerApprovedThisCycle", false);
      const installed = (await api.install?.()) ?? { success: false, error: "no install" };
      if (installed.success) {
        await setPreference("wakeSchedulerRegisteredAtVersion", version);
      }
      t = await this.status();
    }

    const approved = getPreference("wakeSchedulerApprovedThisCycle") === true;

    if (prefOn && (t === "notRegistered" || t === "notFound")) {
      await setPreference("wakeSchedulerApprovedThisCycle", false);
      const installed = (await api.install?.()) ?? {
        success: false,
        error: "no install",
      };
      if (installed.success) {
        await setPreference("wakeSchedulerRegisteredAtVersion", version);
        log.info?.("[wake-scheduler] registered; awaiting Login Items approval");
      } else {
        log.warn?.("[wake-scheduler] register failed: %s", installed.error);
        await setPreference("wakeSchedulerEnabled", false);
      }
      t = await this.status();
    } else if (!prefOn && (t === "enabled" || t === "requiresApproval")) {
      try {
        await api.cancelWakes?.();
      } catch {
        /* ignore */
      }
      await api.uninstall?.();
      await setPreference("wakeSchedulerApprovedThisCycle", false);
      await setPreference("wakeSchedulerCourtesyFlippedKeepAwake", false);
      log.info?.("[wake-scheduler] unregistered");
      t = await this.status();
    } else if (prefOn && t === "requiresApproval" && approved) {
      // User revoked in Login Items after previously approving.
      log.info?.("[wake-scheduler] user revoked in Login Items, uninstalling");
      try {
        await api.cancelWakes?.();
      } catch {
        /* ignore */
      }
      await api.uninstall?.();
      await setPreference("wakeSchedulerApprovedThisCycle", false);
      await setPreference("wakeSchedulerCourtesyFlippedKeepAwake", false);
      await setPreference("wakeSchedulerEnabled", false);
      t = await this.status();
    }

    if (t === "enabled" && !approved) {
      await setPreference("wakeSchedulerApprovedThisCycle", true);
      log.info?.("[wake-scheduler] daemon enabled (approved this cycle)");
    }

    const approvalPending =
      prefOn && t === "requiresApproval" && getPreference("wakeSchedulerApprovedThisCycle") !== true;

    if (approvalPending) {
      this.deps.claimApprovalPending();
      this.clearApprovalBlockTimer();
      this.approvalBlockTimer = this.deps.setTimeoutFn(() => {
        this.deps.releaseApprovalPending();
        this.approvalBlockTimer = null;
        void this.status().then((s) => {
          if (s !== "enabled") {
            log.warn?.(
              "[wake-scheduler] approval timed out after %dm — flipping wakeSchedulerEnabled off",
              WAKE_SCHEDULER_APPROVAL_TIMEOUT_MS / 60_000,
            );
            void setPreference("wakeSchedulerEnabled", false);
          }
        });
      }, WAKE_SCHEDULER_APPROVAL_TIMEOUT_MS);
    } else {
      this.clearApprovalBlockTimer();
      this.deps.releaseApprovalPending();
    }

    // Courtesy-flip: wake enabled + keepAwake both on → flip keepAwake off.
    if (
      prefOn
      && t === "enabled"
      && getPreference("keepAwakeEnabled") === true
    ) {
      await setPreference("keepAwakeEnabled", false);
      await setPreference("wakeSchedulerCourtesyFlippedKeepAwake", true);
      log.info?.(
        "[wake-scheduler] courtesy-flipped keepAwakeEnabled off (legacy always-on → scheduled)",
      );
    }

    log.info?.(
      "[wake-scheduler] reconcile done: status=%s prefOn=%s approvedThisCycle=%s approvalPending=%s",
      t,
      prefOn,
      getPreference("wakeSchedulerApprovedThisCycle") === true,
      approvalPending,
    );
  }

  /** Test helper: current cached status without API call. */
  getStatusCacheForTests(): WakeSchedulerStatusCode | string {
    return this.statusCache;
  }

  dispose(): void {
    this.clearApprovalBlockTimer();
    this.deps.releaseApprovalPending();
  }
}

// ---------------------------------------------------------------------------
// Module singleton + getStatus residual (existing product surface)
// ---------------------------------------------------------------------------

let activeController: WakeSchedulerController | null = null;
let activeNativeApi: WakeSchedulerNativeApi | null = null;

/**
 * Official inject of native handle used by pvi.getApi.
 * Product stores the hkA result; controller getApi re-reads this (+ optional live nr).
 * Does not invent a daemon.
 */
export function setWakeSchedulerNativeApi(
  api: WakeSchedulerNativeApi | null,
): void {
  activeNativeApi = api;
}

export function getWakeSchedulerNativeApi(): WakeSchedulerNativeApi | null {
  return activeNativeApi;
}

/**
 * Official hkA residual shape check:
 *   function hkA(){ return (nr?.wakeScheduler) ?? null }
 * Require `status` function — without it pvi cannot leave notFound honestly.
 */
export function resolveHkAWakeSchedulerApi(
  nr: { wakeScheduler?: unknown } | null | undefined,
): WakeSchedulerNativeApi | null {
  const raw = nr?.wakeScheduler;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as WakeSchedulerNativeApi;
  if (typeof candidate.status !== "function") return null;
  return candidate;
}

export type BindWakeSchedulerAfterSwiftResult = {
  /** True when nr.wakeScheduler exposed a usable status() handle. */
  bound: boolean;
  /** Native/controller status after reconcile, if bound. */
  status?: string;
  error?: string;
};

/**
 * Official F9i().then(() => dvi(wvi(hkA))) after Y9i / ensureNativeQuickEntry:
 *   1) hkA → nr.wakeScheduler
 *   2) set native getApi handle
 *   3) pvi.reconcile() (install only when pref on + native allows — never invent)
 *
 * Unpackaged: official warns LaunchDaemons missing / scheduleWake may be
 * kIOReturnUnsupported; we still bind so status is native truth not permanent notFound.
 */
export async function bindWakeSchedulerAfterSwiftLoad(
  nr: { wakeScheduler?: unknown } | null | undefined,
  options: {
    isPackaged?: boolean;
    log?: {
      info?: (...args: unknown[]) => void;
      warn?: (...args: unknown[]) => void;
      error?: (...args: unknown[]) => void;
    };
  } = {},
): Promise<BindWakeSchedulerAfterSwiftResult> {
  const api = resolveHkAWakeSchedulerApi(nr);
  setWakeSchedulerNativeApi(api);
  if (!api) {
    return { bound: false };
  }

  const log = options.log ?? console;
  const isPackaged = options.isPackaged ?? false;
  if (!isPackaged) {
    log.warn?.(
      "[wake-scheduler] DEV BUILD — daemon registration will fail. The dev Electron bundle has no Contents/Library/LaunchDaemons/ plist. Detector ticks and PreventSystemSleep assertions still work; XPC scheduleWake returns kIOReturnUnsupported. Use a packaged build (yarn make + personal cert) to test the full flow.",
    );
  }

  const controller =
    activeController
    ?? ensureWakeSchedulerController({
      getApi: () => activeNativeApi,
    });
  if (!controller) {
    return { bound: true, error: "no controller (non-darwin)" };
  }

  try {
    await controller.reconcile();
  } catch (error) {
    log.error?.("[wake-scheduler] initial reconcile failed:", error);
    return {
      bound: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const status = await controller.status();
    return { bound: true, status: String(status) };
  } catch (error) {
    return {
      bound: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type EnsureWakeSchedulerOptions = WakeSchedulerControllerDeps & {
  /** When true, construct even on non-darwin (tests). Default respects wvi. */
  forceConstruct?: boolean;
};

/**
 * Ensure singleton controller. Official wvi: only darwin; tests may force.
 * Without force, non-darwin returns null (does not invent win32 scheduler).
 */
export function ensureWakeSchedulerController(
  options: EnsureWakeSchedulerOptions = {},
): WakeSchedulerController | null {
  if (activeController) {
    return activeController;
  }
  const platform = options.platform ?? process.platform;
  if (!options.forceConstruct && platform !== "darwin") {
    return null;
  }
  const getApi =
    options.getApi
    ?? (() => activeNativeApi);
  activeController = new WakeSchedulerController({
    ...options,
    platform,
    getApi,
  });
  return activeController;
}

export function getActiveWakeSchedulerController(): WakeSchedulerController | null {
  return activeController;
}

export function resetWakeSchedulerForTests(): void {
  activeController?.dispose();
  activeController = null;
  activeNativeApi = null;
}

export type WakeSchedulerDeps = {
  platform?: NodeJS.Platform;
  getApi?: () => WakeSchedulerNativeApi | null;
  isPlatformSupported?: () => boolean;
  getApprovedThisCycle?: () => boolean;
  openLoginItemsSettings?: () => Promise<void> | void;
  controller?: WakeSchedulerController | null;
};

/**
 * Official getStatus residual without inventing a live native scheduler.
 */
export async function getWakeSchedulerStatus(
  deps: WakeSchedulerDeps = {},
): Promise<WakeSchedulerGetStatusResult> {
  const platform = deps.platform ?? process.platform;
  const supported =
    deps.isPlatformSupported?.() ?? defaultPlatformSupported(platform);
  const getApi = deps.getApi ?? (() => activeNativeApi);
  const api = getApi();
  const controller = deps.controller ?? activeController;

  const approvedThisCycle =
    deps.getApprovedThisCycle?.()
    ?? (controller ? controller.approvedThisCycle() : false)
    ?? (api?.approvedThisCycle ? api.approvedThisCycle() : false);

  if (!api) {
    return {
      status: "notFound",
      requiresSetup: false,
      approvedThisCycle: approvedThisCycle === true,
      supported,
      enabled: false,
    };
  }

  const status = controller
    ? await controller.status()
    : await api.status();
  return {
    status,
    requiresSetup: (api.requiresSetup ?? controller?.requiresSetup) === true,
    approvedThisCycle:
      (controller
        ? controller.approvedThisCycle()
        : api.approvedThisCycle?.() ?? approvedThisCycle) === true,
    supported,
    enabled: status === "enabled",
  };
}

/**
 * Official openSettings residual: native API first; else Login Items residual.
 */
export async function openWakeSchedulerSettings(
  deps: WakeSchedulerDeps = {},
): Promise<boolean> {
  const getApi = deps.getApi ?? (() => activeNativeApi);
  const api = getApi();
  if (api?.openSettings) {
    api.openSettings();
    return true;
  }
  const controller = deps.controller ?? activeController;
  if (controller && getApi()) {
    controller.openSettings();
    // openSettings no-ops without api.openSettings — fall through
  }
  if (deps.openLoginItemsSettings) {
    await deps.openLoginItemsSettings();
    return true;
  }
  return false;
}

/**
 * scheduleWake entry used by scheduled-task residual.
 * Never invents success without native API.
 */
export async function scheduleWake(when: unknown): Promise<number> {
  const controller = activeController;
  if (controller) return controller.scheduleWake(when);
  const api = activeNativeApi;
  if (api?.scheduleWake) return await api.scheduleWake(when);
  return WAKE_SCHEDULER_NO_API_ERROR;
}

export async function cancelWakes(): Promise<number> {
  const controller = activeController;
  if (controller) return controller.cancelWakes();
  const api = activeNativeApi;
  if (api?.cancelWakes) return await api.cancelWakes();
  return WAKE_SCHEDULER_NO_API_ERROR;
}

/**
 * Trigger reconcile after wakeSchedulerEnabled preference write (Rh.on residual).
 * No-op when controller/API absent — never invents install.
 */
export async function reconcileWakeScheduler(): Promise<void> {
  if (!activeController) return;
  await activeController.reconcile();
}
