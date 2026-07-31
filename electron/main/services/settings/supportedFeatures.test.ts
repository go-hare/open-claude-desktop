import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => `/tmp/hare-code-settings-test/${name}`,
    isPackaged: false,
    getVersion: () => "0.0.0-test",
  },
  systemPreferences: {
    getMediaAccessStatus: () => "granted",
  },
}));

import { SettingsStore } from "./settingsStore";
import { resolveNativeQuickEntryFeature } from "./nativeQuickEntryFeature";
import {
  CHILLING_SLOTH_POOL_FLAG_ID,
  FRAMEBUFFER_PREVIEW_FLAG_ID,
  WAKE_SCHEDULER_FEATURE_FLAG_ID,
  getFeatureStatus,
  resolveChillingSlothEnterpriseFeature,
  resolveChillingSlothFeatFeature,
  resolveComputerUseFeature,
  resolveGrandPrixFeature,
  resolveQuickEntryDictationFeature,
  resolveSupportedFeatures,
  resolveWakeSchedulerBody,
  resolveYukonSilverFeature,
  resolveYukonSilverPlatformGate,
  withUnpackagedOnly,
} from "./supportedFeatures";

describe("supportedFeatures pw residual", () => {
  it("withUnpackagedOnly (mT): packaged → unavailable", () => {
    expect(withUnpackagedOnly(true, () => ({ status: "supported" }))).toEqual({
      status: "unavailable",
    });
    expect(withUnpackagedOnly(false, () => ({ status: "supported" }))).toEqual({
      status: "supported",
    });
  });

  it("Dvi nativeQuickEntry still matches dedicated residual helper", () => {
    const features = resolveSupportedFeatures({
      platform: "darwin",
      macOsMajor: 26,
      isPackaged: false,
    });
    expect(features.nativeQuickEntry?.status).toBe(
      resolveNativeQuickEntryFeature({ platform: "darwin", macOsMajor: 26 }).status,
    );
    expect(
      resolveSupportedFeatures({ platform: "linux", macOsMajor: 26 }).nativeQuickEntry,
    ).toEqual({ status: "unavailable" });
  });

  it("mvi quickEntryDictation: darwin 14+ supported; <14 unsupported; non-darwin unavailable", () => {
    expect(
      resolveQuickEntryDictationFeature({
        platform: "darwin",
        macOsMajor: 14,
        microphoneAccessStatus: "granted",
      }),
    ).toEqual({ status: "supported" });
    expect(
      resolveQuickEntryDictationFeature({
        platform: "darwin",
        macOsMajor: 13,
        microphoneAccessStatus: "granted",
      }).status,
    ).toBe("unsupported");
    expect(
      resolveQuickEntryDictationFeature({
        platform: "darwin",
        macOsMajor: 14,
        microphoneAccessStatus: "restricted",
      }).unsupportedCode,
    ).toBe("unknown");
    expect(
      resolveQuickEntryDictationFeature({ platform: "win32", macOsMajor: 14 }),
    ).toEqual({ status: "unavailable" });
  });

  it("customQuickEntryDictationShortcut is always OW supported", () => {
    const features = resolveSupportedFeatures({ platform: "linux", isPackaged: true });
    expect(features.customQuickEntryDictationShortcut).toEqual({ status: "supported" });
  });

  it("Svi chillingSlothFeat: darwin|win32 only", () => {
    expect(resolveChillingSlothFeatFeature({ platform: "darwin" })).toEqual({
      status: "supported",
    });
    expect(resolveChillingSlothFeatFeature({ platform: "win32" })).toEqual({
      status: "supported",
    });
    expect(resolveChillingSlothFeatFeature({ platform: "linux" })).toEqual({
      status: "unavailable",
    });
  });

  it("yvi chillingSlothEnterprise: only false enterprise disables", () => {
    expect(
      resolveChillingSlothEnterpriseFeature({
        enterprise: { getManagedConfig: () => ({}) },
      }),
    ).toEqual({ status: "supported" });
    expect(
      resolveChillingSlothEnterpriseFeature({
        enterprise: {
          getManagedConfig: () => ({ isClaudeCodeForDesktopEnabled: false }),
        },
      }),
    ).toMatchObject({
      status: "unsupported",
      unsupportedCode: "disabled_by_enterprise",
    });
  });

  it("bvi computerUse: darwin|win32 supported else unsupported_platform", () => {
    expect(resolveComputerUseFeature({ platform: "darwin" })).toEqual({
      status: "supported",
    });
    expect(resolveComputerUseFeature({ platform: "win32" })).toEqual({
      status: "supported",
    });
    expect(resolveComputerUseFeature({ platform: "linux" })).toMatchObject({
      status: "unsupported",
      unsupportedCode: "unsupported_platform",
    });
  });

  it("yukonSilver _vi+pHA: darwin 14+ supported; linux unsupported; pref false disables", () => {
    expect(
      resolveYukonSilverPlatformGate({
        platform: "darwin",
        arch: "arm64",
        macOsMajor: 14,
      }),
    ).toEqual({ status: "supported" });
    expect(
      resolveYukonSilverPlatformGate({
        platform: "darwin",
        arch: "arm64",
        macOsMajor: 13,
      }).unsupportedCode,
    ).toBe("unsupported_os_version");
    expect(
      resolveYukonSilverPlatformGate({ platform: "linux", arch: "x64" }).unsupportedCode,
    ).toBe("unsupported_platform");
    // Official _vi residual enum: virtualization_not_available (not invented *_not_supported).
    expect(
      resolveYukonSilverPlatformGate({
        platform: "darwin",
        arch: "arm64",
        macOsMajor: 15,
        virtualizationSupport: "unsupported",
      }).unsupportedCode,
    ).toBe("virtualization_not_available");
    expect(
      resolveYukonSilverPlatformGate({
        platform: "darwin",
        arch: "arm64",
        macOsMajor: 15,
        virtualizationSupport: "entitlement_missing",
      }).unsupportedCode,
    ).toBe("virtualization_entitlement_missing");
    expect(
      resolveYukonSilverFeature({
        platform: "darwin",
        arch: "arm64",
        macOsMajor: 15,
        secureVmFeaturesEnabledPref: false,
      }),
    ).toMatchObject({
      status: "unsupported",
      unsupportedCode: "disabled_by_user",
    });
    expect(
      resolveYukonSilverFeature({
        platform: "darwin",
        arch: "arm64",
        macOsMajor: 15,
        enterprise: {
          getManagedConfig: () => ({ secureVmFeaturesEnabled: false }),
        },
      }),
    ).toMatchObject({
      status: "unsupported",
      unsupportedCode: "disabled_by_enterprise",
    });
  });

  it("win32 yukon requires msix residual (never invent modern installer)", () => {
    expect(
      resolveYukonSilverPlatformGate({
        platform: "win32",
        arch: "x64",
        isMsix: false,
      }).unsupportedCode,
    ).toBe("msix_required");
    expect(
      resolveYukonSilverPlatformGate({
        platform: "win32",
        arch: "x64",
        isMsix: true,
        windowsBuild: 19041,
      }),
    ).toEqual({ status: "supported" });
  });

  it("Ovi wakeScheduler body: needs darwin 13+ and GrowthBook flag", () => {
    expect(
      resolveWakeSchedulerBody({
        platform: "darwin",
        macOsMajor: 14,
        isGrowthBookFeatureOn: () => false,
      }),
    ).toEqual({ status: "unavailable" });
    expect(
      resolveWakeSchedulerBody({
        platform: "darwin",
        macOsMajor: 14,
        isGrowthBookFeatureOn: (id) => id === WAKE_SCHEDULER_FEATURE_FLAG_ID,
      }),
    ).toEqual({ status: "supported" });
    expect(
      resolveWakeSchedulerBody({ platform: "win32", macOsMajor: 14 }),
    ).toEqual({ status: "unavailable" });
  });

  it("Fvi grandPrix: never invent partners", () => {
    expect(resolveGrandPrixFeature({ platform: "darwin" })).toEqual({
      status: "unavailable",
    });
    expect(
      resolveGrandPrixFeature({ platform: "darwin", grandPrixPartnerCount: 2 }),
    ).toEqual({ status: "supported" });
    expect(
      resolveGrandPrixFeature({ platform: "win32", grandPrixPartnerCount: 2 }),
    ).toEqual({ status: "unavailable" });
  });

  it("chillingSlothPool / framebufferPreview follow GrowthBook ft residual", () => {
    const off = resolveSupportedFeatures({
      platform: "darwin",
      macOsMajor: 15,
      isPackaged: false,
      isGrowthBookFeatureOn: () => false,
    });
    expect(off.chillingSlothPool).toEqual({ status: "unavailable" });
    expect(off.framebufferPreview).toEqual({ status: "unavailable" });

    const on = resolveSupportedFeatures({
      platform: "darwin",
      macOsMajor: 15,
      isPackaged: false,
      isGrowthBookFeatureOn: (id) =>
        id === CHILLING_SLOTH_POOL_FLAG_ID || id === FRAMEBUFFER_PREVIEW_FLAG_ID,
    });
    expect(on.chillingSlothPool).toEqual({ status: "supported" });
    expect(on.framebufferPreview).toEqual({ status: "supported" });

    const packaged = resolveSupportedFeatures({
      platform: "darwin",
      macOsMajor: 15,
      isPackaged: true,
      isGrowthBookFeatureOn: () => true,
    });
    // mT gates: packaged → unavailable even if flag on
    expect(packaged.framebufferPreview).toEqual({ status: "unavailable" });
    expect(packaged.plushRaccoon).toEqual({ status: "unavailable" });
    expect(packaged.quietPenguin).toEqual({ status: "unavailable" });
    expect(packaged.wakeScheduler).toEqual({ status: "unavailable" });
    expect(packaged.iosSimulator).toEqual({ status: "unavailable" });
  });

  it("YK residual defaults missing keys to unavailable", () => {
    const features = resolveSupportedFeatures({ platform: "darwin", macOsMajor: 15 });
    expect(getFeatureStatus(features, "louderPenguin")).toEqual({
      status: "unavailable",
    });
    expect(getFeatureStatus(features, "notARealKey")).toEqual({
      status: "unavailable",
    });
  });

  it("sync DoA stubs: kappa unavailable; artifacts + markTaskComplete residual supported", () => {
    const features = resolveSupportedFeatures({
      platform: "darwin",
      macOsMajor: 15,
      isPackaged: false,
      isGrowthBookFeatureOn: () => true,
    });
    // Kappa has no product residual bridge — never invent supported.
    expect(features.coworkKappa).toEqual({ status: "unavailable" });
    // Host Artifacts residual (list + show/hide view) is product-supported.
    expect(features.coworkArtifacts).toEqual({ status: "supported" });
    // Host-loop VUA mark_task_complete residual is product-supported.
    expect(features.markTaskComplete).toEqual({ status: "supported" });
  });

  it("desktopTopBar / ccdPlugins / chillingSlothLocal always supported", () => {
    const features = resolveSupportedFeatures({ platform: "linux", isPackaged: true });
    expect(features.desktopTopBar).toEqual({ status: "supported" });
    expect(features.ccdPlugins).toEqual({ status: "supported" });
    expect(features.chillingSlothLocal).toEqual({ status: "supported" });
  });
});

describe("SettingsStore.getSupportedFeatures", () => {
  it("returns official pw residual map via resolveSupportedFeatures", () => {
    const store = new SettingsStore("/tmp/hare-code-settings-test/desktop-shell-settings.json");
    const features = store.getSupportedFeatures();

    for (const key of [
      "localSessions",
      "scheduledTasks",
      "findInPage",
      "fileSystem",
      "desktopNotifications",
      "secondaryWindows",
      "customProtocols",
      "customQuickEntryDictationShortcut",
      "desktopTopBar",
      "ccdPlugins",
      "chillingSlothLocal",
    ]) {
      expect(features[key]).toEqual({ status: "supported" });
    }

    // Official Dvi: must match resolveNativeQuickEntryFeature — never invent beyond Dvi.
    expect(features.nativeQuickEntry?.status).toBe(resolveNativeQuickEntryFeature().status);

    // Kappa unbridged; artifacts + markTaskComplete residual supported.
    expect(features.coworkKappa).toEqual({ status: "unavailable" });
    expect(features.coworkArtifacts).toEqual({ status: "supported" });
    expect(features.markTaskComplete).toEqual({ status: "supported" });

    // Full pw key surface present (YK readers can resolve).
    for (const key of [
      "quickEntryDictation",
      "plushRaccoon",
      "quietPenguin",
      "chillingSlothFeat",
      "chillingSlothEnterprise",
      "chillingSlothPool",
      "yukonSilver",
      "yukonSilverGems",
      "yukonSilverGemsCache",
      "wakeScheduler",
      "computerUse",
      "framebufferPreview",
      "iosSimulator",
      "androidEmulator",
      "grandPrix",
    ]) {
      expect(features[key]).toBeDefined();
      expect(["supported", "unavailable", "unsupported"]).toContain(features[key]!.status);
    }
  });
});
