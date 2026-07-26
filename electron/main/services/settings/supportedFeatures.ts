/**
 * Official AppFeatures residual (app.asar `pw` + sync subset of `DoA`):
 *
 *   function pw(){
 *     return {
 *       nativeQuickEntry: Dvi(),
 *       quickEntryDictation: mvi(),
 *       customQuickEntryDictationShortcut: OW,          // always supported
 *       plushRaccoon: mT(() => OW),                     // unpackaged only
 *       quietPenguin: mT(Tvi),                          // unpackaged + darwin
 *       chillingSlothFeat: Svi(),                       // YiA = darwin|win32
 *       chillingSlothEnterprise: yvi(),
 *       chillingSlothLocal: Rvi(),                      // always supported
 *       chillingSlothPool: ft("1992087837") ? OW : unavailable,
 *       yukonSilver: pHA(),
 *       yukonSilverGems: Ole(),
 *       yukonSilverGemsCache: Ole(),
 *       wakeScheduler: mT(Ovi),
 *       desktopTopBar: Gvi(),                           // always supported
 *       ccdPlugins: OW,                                 // always supported
 *       computerUse: bvi(),                             // darwin|win32
 *       coworkKappa / coworkArtifacts / markTaskComplete: unavailable (sync),
 *       framebufferPreview: mT(() => ft("1928275548") ? supported : unavailable),
 *       iosSimulator / androidEmulator: mT(Fle),        // unpackaged + darwin
 *       grandPrix: Fvi(),                               // darwin + partners map
 *     }
 *   }
 *
 * Product shell also exposes honest local surface keys (localSessions, …)
 * that this process actually provides — not invented as official pw keys alone.
 *
 * Rules:
 *   - Never invent status:"supported" without residual gate.
 *   - GrowthBook flags outside kni default off → unavailable (ft residual).
 *   - mT(e): packaged → unavailable; else e().
 *   - DoA async upgrades (louderPenguin / kappa / artifacts / markTaskComplete)
 *     stay unavailable until those residual bridges are wired.
 */

import { systemPreferences } from "electron";
import {
  getCoworkEnterpriseBoolean,
  isClaudeCodeForDesktopEnterpriseDisabled,
  isSecureVmFeaturesEnterpriseDisabled,
  type CoworkEnterpriseConfigDeps,
} from "../coworkHostLoop/coworkEnterpriseConfig";
import {
  isCoworkGrowthBookFeatureOn,
} from "../coworkHostLoop/coworkGrowthBookFeatures";
import {
  resolveMacOsMajor,
  resolveNativeQuickEntryFeature,
  type NativeFeatureStatus,
} from "./nativeQuickEntryFeature";

export type SupportedFeatureStatus = NativeFeatureStatus;

export type SupportedFeaturesMap = Record<string, SupportedFeatureStatus>;

export type SupportedFeaturesDeps = {
  platform?: NodeJS.Platform;
  arch?: string;
  macOsMajor?: number;
  /** Official gA.app.isPackaged residual for mT(). */
  isPackaged?: boolean;
  /** Official gi("secureVmFeaturesEnabled") preference. */
  secureVmFeaturesEnabledPref?: boolean;
  /** Microphone media access status residual for mvi(). */
  microphoneAccessStatus?: string;
  /** Official Hn.files residual — platforms/arches with rootfs assets. */
  hasCoworkRootfsAsset?: (platform: string, arch: string) => boolean;
  /** Official Hc() MSIX residual (win32 modern installer). */
  isMsix?: boolean;
  /** Windows build number residual (M1().patch on win32). */
  windowsBuild?: number;
  /** Official vm.isVirtualizationSupported residual (darwin). */
  virtualizationSupport?:
    | "supported"
    | "entitlement_missing"
    | "unsupported"
    | string
    | null;
  /** Official NZe() partners residual for grandPrix — never invent partners. */
  grandPrixPartnerCount?: number;
  /** Enterprise bag deps (yvi / pHA). */
  enterprise?: CoworkEnterpriseConfigDeps;
  /** GrowthBook ft residual override (tests). */
  isGrowthBookFeatureOn?: (flagId: string) => boolean;
  /** Optional locale for reason strings (currently English defaultMessage residual). */
  locale?: string | null;
};

const SUPPORTED: SupportedFeatureStatus = { status: "supported" };
const UNAVAILABLE: SupportedFeatureStatus = { status: "unavailable" };

/** Official OW residual constant. */
export const OFFICIAL_FEATURE_SUPPORTED: SupportedFeatureStatus = SUPPORTED;

/** Official chillingSlothPool / framebufferPreview GrowthBook flag ids. */
export const CHILLING_SLOTH_POOL_FLAG_ID = "1992087837";
export const FRAMEBUFFER_PREVIEW_FLAG_ID = "1928275548";
/** Official Ovi / pU wakeScheduler GrowthBook residual flag. */
export const WAKE_SCHEDULER_FEATURE_FLAG_ID = "2893011886";

/** Official computer-use platforms (QoA residual). */
const COMPUTER_USE_PLATFORMS = new Set(["darwin", "win32"]);

/** Official Hn.files residual — product ships rootfs for these. */
const DEFAULT_COWORK_ROOTFS: Record<string, ReadonlySet<string>> = {
  darwin: new Set(["arm64", "x64"]),
  win32: new Set(["arm64", "x64"]),
};

function platformLabel(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}

/**
 * Official mT residual:
 *   return gA.app.isPackaged ? { status: "unavailable" } : e()
 */
export function withUnpackagedOnly(
  isPackaged: boolean,
  resolve: () => SupportedFeatureStatus,
): SupportedFeatureStatus {
  if (isPackaged) return UNAVAILABLE;
  return resolve();
}

function resolveOsMajor(
  platform: NodeJS.Platform,
  deps: SupportedFeaturesDeps,
): number {
  if (typeof deps.macOsMajor === "number") return deps.macOsMajor;
  if (platform === "darwin") {
    return resolveMacOsMajor(
      typeof process.getSystemVersion === "function" ? process.getSystemVersion() : "",
    );
  }
  return 0;
}

function growthBookOn(flagId: string, deps: SupportedFeaturesDeps): boolean {
  if (deps.isGrowthBookFeatureOn) return deps.isGrowthBookFeatureOn(flagId);
  return isCoworkGrowthBookFeatureOn(flagId);
}

function hasRootfs(
  platform: string,
  arch: string,
  deps: SupportedFeaturesDeps,
): boolean {
  if (deps.hasCoworkRootfsAsset) return deps.hasCoworkRootfsAsset(platform, arch);
  return DEFAULT_COWORK_ROOTFS[platform]?.has(arch) === true;
}

/**
 * Official Dvi residual — re-export path used by pw().
 */
export function resolveNativeQuickEntryFeatureStatus(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  return resolveNativeQuickEntryFeature({
    platform: deps.platform,
    macOsMajor: deps.macOsMajor,
  });
}

/**
 * Official mvi residual (quickEntryDictation):
 *   !darwin → unavailable
 *   major < 14 → unsupported (macOS 14+)
 *   mic restricted → unsupported
 *   else supported
 */
export function resolveQuickEntryDictationFeature(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") return UNAVAILABLE;
  const major = resolveOsMajor(platform, deps);
  if (major < 14) {
    return {
      status: "unsupported",
      reason: "This feature requires macOS 14.0 or higher",
      unsupportedCode: "unknown",
    };
  }
  let mic = deps.microphoneAccessStatus;
  if (mic === undefined) {
    try {
      mic = systemPreferences.getMediaAccessStatus("microphone");
    } catch {
      mic = "unknown";
    }
  }
  if (mic === "restricted") {
    return {
      status: "unsupported",
      reason:
        "Claude Nest has been restricted from accessing the microphone by a system administrator",
      unsupportedCode: "unknown",
    };
  }
  return SUPPORTED;
}

/**
 * Official Tvi residual (quietPenguin body, before mT):
 *   !darwin → unavailable; else supported
 */
export function resolveQuietPenguinBody(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") return UNAVAILABLE;
  return SUPPORTED;
}

/**
 * Official Svi residual (chillingSlothFeat):
 *   YiA = darwin || win32
 */
export function resolveChillingSlothFeatFeature(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  const platform = deps.platform ?? process.platform;
  if (platform === "darwin" || platform === "win32") return SUPPORTED;
  return UNAVAILABLE;
}

/**
 * Official yvi residual (chillingSlothEnterprise):
 *   isClaudeCodeForDesktopEnabled === false → unsupported
 *   else supported
 */
export function resolveChillingSlothEnterpriseFeature(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  if (isClaudeCodeForDesktopEnterpriseDisabled(deps.enterprise)) {
    return {
      status: "unsupported",
      reason:
        "Claude Code for Desktop has been disabled by your organization administrator",
      unsupportedCode: "disabled_by_enterprise",
    };
  }
  return SUPPORTED;
}

/**
 * Official bvi residual (computerUse):
 *   uoA() = QoA.has(platform) → darwin|win32 supported else unsupported_platform
 */
export function resolveComputerUseFeature(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  const platform = deps.platform ?? process.platform;
  if (COMPUTER_USE_PLATFORMS.has(platform)) return SUPPORTED;
  return {
    status: "unsupported",
    reason: "Computer use is not available on this platform",
    unsupportedCode: "unsupported_platform",
  };
}

/**
 * Official Fle residual (device simulator panel body):
 *   !darwin → unsupported_platform; else supported
 * Applied under mT for iosSimulator / androidEmulator.
 */
export function resolveDeviceSimulatorBody(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") {
    return {
      status: "unsupported",
      reason: "Device simulator panel requires macOS",
      unsupportedCode: "unsupported_platform",
    };
  }
  return SUPPORTED;
}

/**
 * Official _vi residual (yukonSilver platform/arch/OS/rootfs gate) — honest subset.
 * Does not invent MSIX/HCS success; win32 without isMsix → msix_required.
 * Darwin virtualization: only when caller supplies residual result; null skips
 * (product may not have loaded swift yet — do not invent entitlement_missing).
 */
export function resolveYukonSilverPlatformGate(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;

  if (platform !== "darwin" && platform !== "win32") {
    return {
      status: "unsupported",
      reason: `Cowork is not currently supported on ${platformLabel(platform)}`,
      unsupportedCode: "unsupported_platform",
    };
  }
  if (arch !== "x64" && arch !== "arm64") {
    return {
      status: "unsupported",
      reason: `Cowork is not currently supported on ${platformLabel(platform)} with an ${arch} CPU`,
      unsupportedCode: "unsupported_architecture",
    };
  }
  if (!hasRootfs(platform, arch, deps)) {
    return {
      status: "unsupported",
      reason: `Cowork is not currently supported on ${platformLabel(platform)} with an ${arch} CPU`,
      unsupportedCode: "unsupported_architecture",
    };
  }
  if (platform === "win32") {
    const isMsix = deps.isMsix === true;
    if (!isMsix) {
      return {
        status: "unsupported",
        reason:
          "Cowork requires Claude Desktop be installed with our modern installer",
        unsupportedCode: "msix_required",
      };
    }
    const build = deps.windowsBuild;
    if (typeof build === "number" && build < 19041) {
      return {
        status: "unsupported",
        reason:
          "Cowork requires Windows 10 build 2004 or later. Update your operating system to use this feature.",
        unsupportedCode: "unsupported_os_version",
      };
    }
  }
  if (platform === "darwin") {
    const major = resolveOsMajor(platform, deps);
    if (major < 14) {
      return {
        status: "unsupported",
        reason:
          "Cowork requires macOS 14.0 (Sonoma) or later. Update your operating system to use this feature.",
        unsupportedCode: "unsupported_os_version",
      };
    }
    const virt = deps.virtualizationSupport;
    if (virt === "entitlement_missing") {
      return {
        status: "unsupported",
        reason:
          "Claude's installation appears to be corrupted. Reinstall Claude from claude.com/download to use this feature.",
        unsupportedCode: "virtualization_entitlement_missing",
      };
    }
    if (virt != null && virt !== "supported") {
      // Official _vi residual code is virtualization_not_available (schema enum).
      return {
        status: "unsupported",
        reason:
          "Cowork requires virtualization. Your Mac does not support virtualization. If you are currently running macOS inside a virtual machine (like Parallels), you might need to enable a feature called 'nested virtualization'.",
        unsupportedCode: "virtualization_not_available",
      };
    }
  }
  return SUPPORTED;
}

/**
 * Official pHA residual (yukonSilver) without IeA/fHA early exit cache:
 *   _vi() gate → enterprise secureVm → user pref secureVm → supported
 */
export function resolveYukonSilverFeature(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  const platformGate = resolveYukonSilverPlatformGate(deps);
  if (platformGate.status !== "supported") return platformGate;

  if (isSecureVmFeaturesEnterpriseDisabled(deps.enterprise)) {
    return {
      status: "unsupported",
      reason:
        "Ask your IT administrator to enable the secureVmFeaturesEnabled setting in the Claude desktop configuration profile.",
      unsupportedCode: "disabled_by_enterprise",
    };
  }

  const pref =
    typeof deps.secureVmFeaturesEnabledPref === "boolean"
      ? deps.secureVmFeaturesEnabledPref
      : true; // official SSA default is true; caller should pass live pref
  if (pref === false) {
    return {
      status: "unsupported",
      reason: "Enable the secureVmFeaturesEnabled preference to use this feature.",
      unsupportedCode: "disabled_by_user",
    };
  }

  return SUPPORTED;
}

/** Official Ole residual: if yukon not supported, mirror; else supported. */
export function resolveYukonSilverGemsFeature(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  const yukon = resolveYukonSilverFeature(deps);
  if (yukon.status !== "supported") return yukon;
  return SUPPORTED;
}

/**
 * Official Ovi residual body (before mT) for wakeScheduler:
 *   !darwin → unavailable
 *   major < 13 → unsupported
 *   pU() GrowthBook → supported else unavailable
 *
 * Product does not invent pU true: only when flag on via kni/applied map.
 */
export function resolveWakeSchedulerBody(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") return UNAVAILABLE;
  const major = resolveOsMajor(platform, deps);
  if (major < 13) {
    return {
      status: "unsupported",
      reason: "This feature requires macOS 13.0 or higher",
      unsupportedCode: "unsupported_os_version",
    };
  }
  // Official pU: wr("2893011886","enabled",!1,at()) — without inventing true.
  if (!growthBookOn(WAKE_SCHEDULER_FEATURE_FLAG_ID, deps)) {
    return UNAVAILABLE;
  }
  return SUPPORTED;
}

/**
 * Official Fvi / rvi residual (grandPrix):
 *   !darwin → false/unavailable
 *   partners map empty → unavailable
 * Never invent partners.
 */
export function resolveGrandPrixFeature(
  deps: SupportedFeaturesDeps = {},
): SupportedFeatureStatus {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") return UNAVAILABLE;
  const count = deps.grandPrixPartnerCount ?? 0;
  if (count > 0) return SUPPORTED;
  return UNAVAILABLE;
}

/**
 * Official pw() residual map + product shell surface keys.
 */
export function resolveSupportedFeatures(
  deps: SupportedFeaturesDeps = {},
): SupportedFeaturesMap {
  const isPackaged = deps.isPackaged ?? false;
  const secureVmPref =
    typeof deps.secureVmFeaturesEnabledPref === "boolean"
      ? deps.secureVmFeaturesEnabledPref
      : true;

  const nativeQuickEntry = resolveNativeQuickEntryFeatureStatus(deps);
  const quickEntryDictation = resolveQuickEntryDictationFeature(deps);
  const chillingSlothPool = growthBookOn(CHILLING_SLOTH_POOL_FLAG_ID, deps)
    ? SUPPORTED
    : UNAVAILABLE;
  const yukonSilver = resolveYukonSilverFeature({
    ...deps,
    secureVmFeaturesEnabledPref: secureVmPref,
  });
  const yukonGems = resolveYukonSilverGemsFeature({
    ...deps,
    secureVmFeaturesEnabledPref: secureVmPref,
  });
  const wakeScheduler = withUnpackagedOnly(isPackaged, () =>
    resolveWakeSchedulerBody(deps),
  );
  const framebufferPreview = withUnpackagedOnly(isPackaged, () =>
    growthBookOn(FRAMEBUFFER_PREVIEW_FLAG_ID, deps) ? SUPPORTED : UNAVAILABLE,
  );
  const deviceSim = withUnpackagedOnly(isPackaged, () =>
    resolveDeviceSimulatorBody(deps),
  );

  return {
    // Product shell surface this process honestly provides.
    localSessions: SUPPORTED,
    scheduledTasks: SUPPORTED,
    findInPage: SUPPORTED,
    fileSystem: SUPPORTED,
    desktopNotifications: SUPPORTED,
    secondaryWindows: SUPPORTED,
    customProtocols: SUPPORTED,

    // Official pw() keys.
    nativeQuickEntry,
    quickEntryDictation,
    customQuickEntryDictationShortcut: SUPPORTED,
    plushRaccoon: withUnpackagedOnly(isPackaged, () => SUPPORTED),
    quietPenguin: withUnpackagedOnly(isPackaged, () => resolveQuietPenguinBody(deps)),
    chillingSlothFeat: resolveChillingSlothFeatFeature(deps),
    chillingSlothEnterprise: resolveChillingSlothEnterpriseFeature(deps),
    chillingSlothLocal: SUPPORTED,
    chillingSlothPool,
    yukonSilver,
    yukonSilverGems: yukonGems,
    yukonSilverGemsCache: yukonGems,
    wakeScheduler,
    desktopTopBar: SUPPORTED,
    ccdPlugins: SUPPORTED,
    computerUse: resolveComputerUseFeature(deps),
    // Sync pw() stubs — DoA may upgrade via GrowthBook after swift load.
    coworkKappa: UNAVAILABLE,
    coworkArtifacts: UNAVAILABLE,
    markTaskComplete: UNAVAILABLE,
    framebufferPreview,
    iosSimulator: deviceSim,
    androidEmulator: deviceSim,
    grandPrix: resolveGrandPrixFeature(deps),
    // DoA-only keys (louderPenguin) stay absent → YK defaults unavailable.
  };
}

/**
 * Build deps from live SettingsStore-ish preference bag + process.
 * Does not invent isPackaged=true in tests; caller can override.
 */
export function buildSupportedFeaturesDepsFromRuntime(input: {
  preferences?: Record<string, unknown>;
  isPackaged?: boolean;
  enterprise?: CoworkEnterpriseConfigDeps;
  platform?: NodeJS.Platform;
  arch?: string;
  macOsMajor?: number;
  microphoneAccessStatus?: string;
  virtualizationSupport?: SupportedFeaturesDeps["virtualizationSupport"];
  grandPrixPartnerCount?: number;
  isMsix?: boolean;
  windowsBuild?: number;
}): SupportedFeaturesDeps {
  const prefs = input.preferences ?? {};
  const secure =
    typeof prefs.secureVmFeaturesEnabled === "boolean"
      ? prefs.secureVmFeaturesEnabled
      : true;
  return {
    platform: input.platform ?? process.platform,
    arch: input.arch ?? process.arch,
    macOsMajor: input.macOsMajor,
    isPackaged: input.isPackaged ?? false,
    secureVmFeaturesEnabledPref: secure,
    microphoneAccessStatus: input.microphoneAccessStatus,
    enterprise: input.enterprise,
    virtualizationSupport: input.virtualizationSupport,
    grandPrixPartnerCount: input.grandPrixPartnerCount,
    isMsix: input.isMsix,
    windowsBuild: input.windowsBuild,
  };
}

/** YK residual: features[key] || { status: "unavailable" }. */
export function getFeatureStatus(
  features: SupportedFeaturesMap,
  key: string,
): SupportedFeatureStatus {
  return features[key] ?? UNAVAILABLE;
}
