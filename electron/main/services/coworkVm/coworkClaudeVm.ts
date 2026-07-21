/**
 * Official dual-exec VM surface (app.asar LocalAgentMode / ClaudeVM):
 *   load `@ant/claude-swift` → vm.createVM / startVM / stopVM / isRunning / isGuestConnected
 * Bundle dir: userData/vm_bundles/claudevm.bundle (official RHA()+aGi)
 * Guest image: Resources/smol-bin.<arch>.img (USB mass storage; rootfs.img downloaded separately)
 *
 * Honest residual vs full official UXe:
 * - rootfs download via ensureCoworkVmRootfs (EGi/JZe/Hn); link residual still valid offline
 * - session spawn/kill/mountPath/runBash wired in P1/P2, not invented on host
 * - bare Node load of swift_addon crashes (UserNotifications) — only load inside Electron app
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { configureOriginalRuntimeModules } from "../originalRuntime/originalRuntimeModules";
import { ensureCoworkVmRootfs } from "./coworkVmBundleDownload";

/** Official sGi */
export const COWORK_VM_BUNDLES_DIRNAME = "vm_bundles";
/** Official aGi */
export const COWORK_VM_BUNDLE_NAME = "claudevm.bundle";
/** Official Hn.sha (this app.asar cut) — origin marker for rootfs.img */
export const COWORK_VM_BUNDLE_SHA = "5680b11bcdab215cccf07e0c0bd1bd9213b0c25d";

export type CoworkVmRunningStatus =
  | "stopped"
  | "starting"
  | "booting"
  | "running"
  | "failed"
  | "offline";

export type CoworkVmStatusSnapshot = {
  connected: boolean;
  downloadStatus: "missing" | "downloaded" | "downloading";
  error?: string;
  mode: "vm" | "host-loop-unavailable";
  platform: NodeJS.Platform;
  running: boolean;
  runningStatus: CoworkVmRunningStatus;
  swiftLoaded: boolean;
  updatedAt: string;
  bundlePath: string;
  bundleReady: boolean;
  smolBinPath: string | null;
};

export type CoworkSwiftVmApi = {
  configure?: (opts?: { userDataName?: string; memoryMB?: number; cpuCount?: number }) => Promise<unknown>;
  createVM?: (args: { bundlePath: string; diskSizeGB?: number }) => Promise<unknown>;
  startVM: (
    bundlePath: string | { bundlePath: string; memoryGB?: number; cpuCount?: number; apiProbeURL?: string },
    memoryGB?: number,
    cpuCount?: number,
    networkMode?: string,
    apiProbeURL?: string,
  ) => Promise<unknown>;
  stopVM?: (isAppQuit?: boolean) => Promise<unknown>;
  isRunning: (...args: unknown[]) => Promise<boolean | { running?: boolean }>;
  isGuestConnected: (...args: unknown[]) => Promise<boolean | { connected?: boolean }>;
  isVirtualizationSupported?: () => string | Promise<string>;
  mountPath?: (
    processId: string,
    subpath: string,
    mountName: string,
    mode: string,
  ) => Promise<unknown>;
  /**
   * Official multi-arg spawn:
   *   spawn(id, processName, command, args, cwd, env, additionalMounts, isResume, allowedDomains, oneShot, mountSkeletonHome)
   * Some builds also accept a single options object.
   */
  spawn?: (
    idOrOpts:
      | string
      | {
          additionalMounts?: Record<string, unknown>;
          allowedDomains?: string[];
          args?: string[];
          command: string;
          cwd?: string;
          env?: Record<string, string>;
          id: string;
          isResume?: boolean;
          mountSkeletonHome?: boolean;
          name: string;
          oneShot?: boolean;
        },
    processName?: string,
    command?: string,
    args?: string[],
    cwd?: string,
    env?: Record<string, string>,
    additionalMounts?: Record<string, unknown>,
    isResume?: boolean,
    allowedDomains?: string[],
    oneShot?: boolean,
    mountSkeletonHome?: boolean,
  ) => Promise<unknown>;
  kill?: (id: string, signal?: string) => Promise<unknown>;
  writeStdin?: (id: string, data: string) => Promise<unknown>;
  /** Official MITM OAuth approve before dual-exec claude spawn. */
  addApprovedOauthToken?: (token: string) => Promise<unknown>;
  /**
   * Official setEventCallbacks(onStdout, onStderr, onExit, onError, onNetworkStatus, onApiReachability, onStartupStep).
   * Required for oneshot bash output/exit (YTi + kXe).
   */
  setEventCallbacks?: (
    onStdout: (id: string, data: string) => void,
    onStderr: (id: string, data: string) => void,
    onExit: (
      id: string,
      exitCode: number | null | undefined,
      signal: string | null | undefined,
      oomKillCount?: number,
    ) => void,
    onError: (id: string, message: string, fatal?: boolean) => void,
    onNetworkStatus?: (status: string) => void,
    onApiReachability?: (status: string) => void,
    onStartupStep?: (step: string, status: string) => void,
  ) => void;
};

export type CoworkClaudeVmServiceOptions = {
  env?: NodeJS.ProcessEnv;
  getUserDataPath?: () => string;
  getResourcesPath?: () => string;
  /** Injected for tests — when set, skip require("@ant/claude-swift"). */
  loadSwiftVm?: () => Promise<CoworkSwiftVmApi | null>;
  platform?: NodeJS.Platform;
  arch?: string;
  log?: (message: string, extra?: unknown) => void;
};

function defaultLog(message: string, extra?: unknown) {
  if (extra !== undefined) console.info(`[CoworkClaudeVm] ${message}`, extra);
  else console.info(`[CoworkClaudeVm] ${message}`);
}

function asBooleanResult(
  value: boolean | { running?: boolean; connected?: boolean } | null | undefined,
  key: "running" | "connected",
): boolean {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object") {
    const raw = value[key];
    return raw === true;
  }
  return false;
}

export function resolveCoworkVmArch(arch: string = process.arch): "arm64" | "x64" {
  if (arch === "arm64" || arch === "aarch64") return "arm64";
  return "x64";
}

export function resolveCoworkVmBundlePath(userDataPath: string): string {
  return path.join(userDataPath, COWORK_VM_BUNDLES_DIRNAME, COWORK_VM_BUNDLE_NAME);
}

export function resolveCoworkSmolBinPath(
  resourcesPath: string,
  arch: string = process.arch,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const a = resolveCoworkVmArch(arch);
  const candidates =
    platform === "win32"
      ? [
          path.join(resourcesPath, `smol-bin.${a}.vhdx`),
          path.join(resourcesPath, "smol-bin.vhdx"),
        ]
      : [
          path.join(resourcesPath, `smol-bin.${a}.img`),
          path.join(resourcesPath, "smol-bin.img"),
        ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function isCoworkVmBundleReady(bundlePath: string): boolean {
  const rootfs = path.join(bundlePath, "rootfs.img");
  if (!fs.existsSync(rootfs)) return false;
  // Official JZe: origin must exist and equal Hn.sha.
  // Product residual: legacy bare rootfs without origin is accepted (link residual).
  // When origin IS present, require exact COWORK_VM_BUNDLE_SHA — never ready on stale sha.
  const origin = path.join(bundlePath, ".rootfs.img.origin");
  if (!fs.existsSync(origin)) return true;
  try {
    const sha = fs.readFileSync(origin, "utf8").trim();
    return sha === COWORK_VM_BUNDLE_SHA;
  } catch {
    return false;
  }
}

let cachedSwiftVm: CoworkSwiftVmApi | null | undefined;
let loadPromise: Promise<CoworkSwiftVmApi | null> | null = null;

/**
 * Load official `@ant/claude-swift` vm API (Electron main only).
 * Returns null on non-darwin / load failure — never invents a host-side VM.
 */
export async function loadCoworkSwiftVm(
  options: { forceReload?: boolean } = {},
): Promise<CoworkSwiftVmApi | null> {
  if (!options.forceReload && cachedSwiftVm !== undefined) return cachedSwiftVm;
  if (!options.forceReload && loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (process.platform !== "darwin") {
      cachedSwiftVm = null;
      return null;
    }
    try {
      // Honor NODE_PATH original-runtime (same as node-pty).
      configureOriginalRuntimeModules();
      const roots = [
        process.env.CLAUDE_ORIGINAL_RUNTIME_NODE_MODULES,
        process.resourcesPath
          ? path.join(process.resourcesPath, "original-runtime-node_modules", "node_modules")
          : null,
        app.isPackaged
          ? null
          : path.join(app.getAppPath(), "resources", "original-runtime-node_modules", "node_modules"),
        path.join(app.getAppPath(), "node_modules"),
        path.resolve(process.cwd(), "resources/original-runtime-node_modules/node_modules"),
      ].filter((v): v is string => Boolean(v));

      let mod: { default?: { vm?: CoworkSwiftVmApi }; vm?: CoworkSwiftVmApi } | CoworkSwiftVmApi | null =
        null;
      for (const root of roots) {
        const pkgJson = path.join(root, "@ant/claude-swift", "package.json");
        if (!fs.existsSync(pkgJson)) continue;
        try {
          const runtimeRequire = createRequire(pkgJson);
          mod = runtimeRequire(path.dirname(pkgJson)) as typeof mod;
          break;
        } catch (error) {
          defaultLog("require original-runtime claude-swift failed", error);
        }
      }
      if (!mod) {
        try {
          const fallbackRequire = createRequire(path.join(app.getAppPath(), "package.json"));
          mod = fallbackRequire("@ant/claude-swift") as typeof mod;
        } catch (error) {
          defaultLog("require @ant/claude-swift failed", error);
          cachedSwiftVm = null;
          return null;
        }
      }
      const container = mod && typeof mod === "object" && "default" in mod ? mod.default ?? mod : mod;
      const vm =
        container && typeof container === "object" && "vm" in container
          ? (container as { vm: CoworkSwiftVmApi }).vm
          : (container as CoworkSwiftVmApi | null);
      if (!vm || typeof vm.isRunning !== "function") {
        cachedSwiftVm = null;
        return null;
      }
      cachedSwiftVm = vm;
      return vm;
    } catch (error) {
      defaultLog("loadCoworkSwiftVm failed", error);
      cachedSwiftVm = null;
      return null;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

export function createCoworkClaudeVmService(options: CoworkClaudeVmServiceOptions = {}) {
  const log = options.log ?? defaultLog;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const getUserDataPath =
    options.getUserDataPath ?? (() => app.getPath("userData"));
  const getResourcesPath =
    options.getResourcesPath
    ?? (() => {
      if (app.isPackaged) return process.resourcesPath;
      // Dev: smol-bin lives under project resources/ (not Electron framework Resources).
      return path.join(app.getAppPath(), "resources");
    });
  const loadSwift = options.loadSwiftVm ?? (() => loadCoworkSwiftVm());

  let lastStatus: CoworkVmRunningStatus = "stopped";
  let lastError: string | undefined;
  let startPromise: Promise<CoworkVmStatusSnapshot> | null = null;
  let downloadPromise: Promise<CoworkVmStatusSnapshot> | null = null;
  let downloadProgress = 0;

  const bundlePath = () => resolveCoworkVmBundlePath(getUserDataPath());
  const smolBinPath = () => resolveCoworkSmolBinPath(getResourcesPath(), arch, platform);

  async function probe(vm: CoworkSwiftVmApi | null): Promise<{
    running: boolean;
    connected: boolean;
  }> {
    if (!vm) return { running: false, connected: false };
    try {
      const runningRaw = await vm.isRunning();
      const connectedRaw = await vm.isGuestConnected();
      return {
        running: asBooleanResult(runningRaw, "running"),
        connected: asBooleanResult(connectedRaw, "connected"),
      };
    } catch (error) {
      log("probe failed", error);
      return { running: false, connected: false };
    }
  }

  async function snapshot(): Promise<CoworkVmStatusSnapshot> {
    const bundle = bundlePath();
    const ready = isCoworkVmBundleReady(bundle);
    const smol = smolBinPath();
    const vm = await loadSwift();
    const { running, connected } = await probe(vm);
    let runningStatus: CoworkVmRunningStatus = lastStatus;
    if (connected) runningStatus = "running";
    else if (running && (lastStatus === "starting" || lastStatus === "booting")) {
      runningStatus = "booting";
    } else if (running) runningStatus = "booting";
    else if (lastStatus === "failed" || lastStatus === "offline") {
      runningStatus = lastStatus;
    } else if (!vm && platform === "darwin") runningStatus = "offline";
    else if (!running) runningStatus = "stopped";

    return {
      connected,
      downloadStatus: ready ? "downloaded" : "missing",
      error: lastError,
      mode: vm ? "vm" : "host-loop-unavailable",
      platform,
      running,
      runningStatus,
      swiftLoaded: Boolean(vm),
      updatedAt: new Date().toISOString(),
      bundlePath: bundle,
      bundleReady: ready,
      smolBinPath: smol,
    };
  }

  async function ensureBundleDir(): Promise<string> {
    const bundle = bundlePath();
    fs.mkdirSync(bundle, { recursive: true });
    return bundle;
  }

  /**
   * Official KZe/QGi downloadVM residual — fetch rootfs.img.zst from CDN when missing.
   * When bundle already ready (linked or prior download), returns downloaded without network.
   */
  async function downloadVM(options?: {
    force?: boolean;
    onProgress?: (percent: number) => void;
  }): Promise<CoworkVmStatusSnapshot> {
    if (downloadPromise && !options?.force) return downloadPromise;
    downloadPromise = (async () => {
      lastError = undefined;
      downloadProgress = 0;
      try {
        const bundle = await ensureBundleDir();
        if (!options?.force && isCoworkVmBundleReady(bundle)) {
          downloadProgress = 100;
          options?.onProgress?.(100);
          return snapshot();
        }
        const result = await ensureCoworkVmRootfs(bundle, {
          arch,
          force: options?.force === true,
          platform,
          onProgress: (p) => {
            const total = p.totalBytes > 0 ? p.totalBytes : 1;
            const pct = Math.min(
              99,
              Math.max(0, Math.round((p.receivedBytes / total) * 100)),
            );
            downloadProgress = pct;
            options?.onProgress?.(pct);
          },
        });
        if (!result.ok) {
          lastError =
            result.error
            ?? "VM rootfs download failed (CDN unavailable or checksum mismatch). "
              + "Use scripts/link-claudevm-bundle-from-official.mjs offline residual.";
          downloadProgress = 0;
          return snapshot();
        }
        downloadProgress = 100;
        options?.onProgress?.(100);
        return snapshot();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        downloadProgress = 0;
        log("downloadVM failed", error);
        return snapshot();
      } finally {
        downloadPromise = null;
      }
    })();
    return downloadPromise;
  }

  /**
   * Official start path subset: require rootfs bundle + swift addon.
   * Does not invent host-side bash or fake "running" without guest connect.
   */
  async function startVM(startOptions?: {
    memoryGB?: number;
    cpuCount?: number;
    apiProbeURL?: string;
  }): Promise<CoworkVmStatusSnapshot> {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      lastError = undefined;
      lastStatus = "starting";
      try {
        if (platform !== "darwin") {
          lastStatus = "offline";
          lastError = `VM sandbox not implemented on ${platform} in this build (official uses platform-specific hypervisor).`;
          return snapshot();
        }

        const vm = await loadSwift();
        if (!vm) {
          lastStatus = "failed";
          lastError =
            "Swift VM addon not available. Ensure original-runtime @ant/claude-swift is copied and app runs under Electron.";
          return snapshot();
        }

        if (typeof vm.isVirtualizationSupported === "function") {
          try {
            const support = await vm.isVirtualizationSupported();
            if (support && support !== "supported") {
              lastStatus = "offline";
              lastError =
                support === "entitlement_missing"
                  ? "Claude's installation appears to be invalid or has been modified. Reinstall Claude from claude.ai/download to use this feature."
                  : `Virtualization is not supported on this Mac (${support}).`;
              return snapshot();
            }
          } catch {
            // Optional probe — continue to start.
          }
        }

        const bundle = await ensureBundleDir();
        if (!isCoworkVmBundleReady(bundle)) {
          lastStatus = "failed";
          lastError =
            "VM bundle not ready (rootfs.img missing under userData/vm_bundles/claudevm.bundle). Official download path residual — copy from an existing Claude install or complete downloadVM.";
          return snapshot();
        }

        const smol = smolBinPath();
        if (!smol) {
          log("smol-bin image not found in Resources — Swift may still start if embedded elsewhere");
        }

        // Official Windows uses configure(); darwin path goes straight to startVM(bundlePath,...).
        if (typeof vm.configure === "function" && platform === "win32") {
          await vm.configure({ userDataName: "claude_desktop" });
        }

        // Prefer multi-arg official client shape: startVM(bundlePath, memoryGB, cpuCount, "gvisor", apiProbeURL)
        const memoryGB = startOptions?.memoryGB;
        const cpuCount = startOptions?.cpuCount;
        const apiProbe = startOptions?.apiProbeURL;
        try {
          await vm.startVM(bundle, memoryGB, cpuCount, "gvisor", apiProbe);
        } catch (firstError) {
          // Some native builds accept object form only.
          try {
            await vm.startVM({
              bundlePath: bundle,
              ...(memoryGB !== undefined ? { memoryGB } : {}),
              ...(cpuCount !== undefined ? { cpuCount } : {}),
              ...(apiProbe ? { apiProbeURL: apiProbe } : {}),
            });
          } catch {
            throw firstError;
          }
        }

        lastStatus = "booting";
        // Poll guest connect (official ~timeout loop simplified).
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          const { running, connected } = await probe(vm);
          if (connected) {
            lastStatus = "running";
            return snapshot();
          }
          if (!running && Date.now() > deadline - 80_000) {
            // still early; keep waiting
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        const after = await probe(vm);
        if (after.connected) {
          lastStatus = "running";
        } else if (after.running) {
          lastStatus = "booting";
          lastError = "VM running but guest connection timeout (90s).";
        } else {
          lastStatus = "failed";
          lastError = "VM connection timeout after 90 seconds.";
        }
        return snapshot();
      } catch (error) {
        lastStatus = "failed";
        lastError = error instanceof Error ? error.message : String(error);
        log("startVM failed", error);
        return snapshot();
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  }

  async function stopVM(isAppQuit = false): Promise<CoworkVmStatusSnapshot> {
    const vm = await loadSwift();
    if (vm?.stopVM) {
      try {
        await vm.stopVM(isAppQuit);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        log("stopVM failed", error);
      }
    }
    lastStatus = "stopped";
    return snapshot();
  }

  return {
    downloadVM,
    getBundlePath: bundlePath,
    getDownloadProgress: () => downloadProgress,
    getSmolBinPath: smolBinPath,
    isBundleReady: () => isCoworkVmBundleReady(bundlePath()),
    loadSwiftVm: loadSwift,
    snapshot,
    startVM,
    stopVM,
  };
}

export type CoworkClaudeVmService = ReturnType<typeof createCoworkClaudeVmService>;

/** Process singleton for IPC handlers. */
let singleton: CoworkClaudeVmService | null = null;

export function getCoworkClaudeVmService(): CoworkClaudeVmService {
  if (!singleton) singleton = createCoworkClaudeVmService();
  return singleton;
}

/** Test helper */
export function resetCoworkClaudeVmServiceForTests(): void {
  singleton = null;
  cachedSwiftVm = undefined;
  loadPromise = null;
}
