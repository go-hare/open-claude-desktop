import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimKeepAwake,
  getKeepAwakeClaimsForTests,
  KEEP_AWAKE_WAKE_SCHEDULER_CLAIM,
  releaseKeepAwake,
  resetKeepAwakeForTests,
} from "./keepAwake";
import {
  createWakeSchedulerForPlatform,
  getWakeSchedulerStatus,
  openWakeSchedulerSettings,
  resetWakeSchedulerForTests,
  scheduleWake,
  cancelWakes,
  WAKE_SCHEDULER_NO_API_ERROR,
  WakeSchedulerController,
  type WakeSchedulerNativeApi,
} from "./wakeScheduler";

afterEach(() => {
  resetWakeSchedulerForTests();
  resetKeepAwakeForTests();
});

describe("wakeScheduler residual", () => {
  it("notFound when native API absent — never invent enabled", async () => {
    const status = await getWakeSchedulerStatus({
      platform: "darwin",
      getApi: () => null,
      getApprovedThisCycle: () => false,
    });
    expect(status).toEqual({
      status: "notFound",
      requiresSetup: false,
      approvedThisCycle: false,
      supported: true,
      enabled: false,
    });
  });

  it("linux unsupported residual", async () => {
    const status = await getWakeSchedulerStatus({
      platform: "linux",
      getApi: () => null,
    });
    expect(status.supported).toBe(false);
    expect(status.enabled).toBe(false);
  });

  it("uses injected API status without inventing", async () => {
    const api: WakeSchedulerNativeApi = {
      requiresSetup: true,
      approvedThisCycle: () => true,
      status: async () => "requiresApproval",
    };
    const status = await getWakeSchedulerStatus({
      platform: "darwin",
      getApi: () => api,
    });
    expect(status.status).toBe("requiresApproval");
    expect(status.requiresSetup).toBe(true);
    expect(status.approvedThisCycle).toBe(true);
    expect(status.enabled).toBe(false);
  });

  it("enabled only when API status is enabled", async () => {
    const status = await getWakeSchedulerStatus({
      getApi: () => ({
        requiresSetup: false,
        approvedThisCycle: () => true,
        status: async () => "enabled",
      }),
    });
    expect(status.enabled).toBe(true);
  });

  it("openSettings prefers API then residual login items", async () => {
    let opened = false;
    await openWakeSchedulerSettings({
      getApi: () => ({
        requiresSetup: false,
        approvedThisCycle: () => false,
        status: async () => "notFound",
        openSettings: () => {
          opened = true;
        },
      }),
    });
    expect(opened).toBe(true);

    let residual = false;
    await openWakeSchedulerSettings({
      getApi: () => null,
      openLoginItemsSettings: () => {
        residual = true;
      },
    });
    expect(residual).toBe(true);
  });

  it("scheduleWake/cancelWakes return NO_API without native stack", async () => {
    const ctrl = new WakeSchedulerController({ getApi: () => null });
    expect(await ctrl.scheduleWake(Date.now())).toBe(WAKE_SCHEDULER_NO_API_ERROR);
    expect(await ctrl.cancelWakes()).toBe(WAKE_SCHEDULER_NO_API_ERROR);
    expect(await scheduleWake(1)).toBe(WAKE_SCHEDULER_NO_API_ERROR);
    expect(await cancelWakes()).toBe(WAKE_SCHEDULER_NO_API_ERROR);
  });

  it("wvi residual: only darwin constructs platform controller", () => {
    expect(createWakeSchedulerForPlatform(() => null, "darwin")).not.toBeNull();
    expect(createWakeSchedulerForPlatform(() => null, "win32")).toBeNull();
    expect(createWakeSchedulerForPlatform(() => null, "linux")).toBeNull();
  });

  it("reconcile defers when API absent — no install invent", async () => {
    const installs: number[] = [];
    const prefs: Record<string, unknown> = {
      wakeSchedulerEnabled: true,
      wakeSchedulerApprovedThisCycle: false,
      wakeSchedulerRegisteredAtVersion: "",
      wakeSchedulerCourtesyFlippedKeepAwake: false,
      keepAwakeEnabled: false,
    };
    const ctrl = new WakeSchedulerController({
      getApi: () => null,
      getPreference: (k) => prefs[k],
      setPreference: (k, v) => {
        prefs[k] = v;
      },
    });
    await ctrl.reconcile();
    expect(installs).toEqual([]);
    expect(prefs.wakeSchedulerEnabled).toBe(true);
  });

  it("reconcile install path on notFound when pref on", async () => {
    let status: string = "notFound";
    const installs: string[] = [];
    const prefs: Record<string, unknown> = {
      wakeSchedulerEnabled: true,
      wakeSchedulerApprovedThisCycle: false,
      wakeSchedulerRegisteredAtVersion: "",
      wakeSchedulerCourtesyFlippedKeepAwake: false,
      keepAwakeEnabled: false,
    };
    const api: WakeSchedulerNativeApi = {
      status: async () => status,
      install: async () => {
        installs.push("install");
        status = "requiresApproval";
        return { success: true };
      },
      uninstall: async () => {
        installs.push("uninstall");
        status = "notFound";
      },
      cancelWakes: async () => 0,
      scheduleWake: async () => 0,
    };
    const ctrl = new WakeSchedulerController({
      getApi: () => api,
      getPreference: (k) => prefs[k],
      setPreference: async (k, v) => {
        prefs[k] = v;
      },
      getAppVersion: () => "1.0.0",
      claimApprovalPending: () => claimKeepAwake(KEEP_AWAKE_WAKE_SCHEDULER_CLAIM),
      releaseApprovalPending: () =>
        releaseKeepAwake(KEEP_AWAKE_WAKE_SCHEDULER_CLAIM),
    });
    await ctrl.reconcile();
    expect(installs).toEqual(["install"]);
    expect(prefs.wakeSchedulerRegisteredAtVersion).toBe("1.0.0");
    expect(getKeepAwakeClaimsForTests().has(KEEP_AWAKE_WAKE_SCHEDULER_CLAIM)).toBe(
      true,
    );
    ctrl.dispose();
  });

  it("courtesy-flip keepAwake when wake enabled and keepAwake on", async () => {
    const prefs: Record<string, unknown> = {
      wakeSchedulerEnabled: true,
      wakeSchedulerApprovedThisCycle: false,
      wakeSchedulerRegisteredAtVersion: "1.0.0",
      wakeSchedulerCourtesyFlippedKeepAwake: false,
      keepAwakeEnabled: true,
    };
    const api: WakeSchedulerNativeApi = {
      status: async () => "enabled",
      install: async () => ({ success: true }),
      uninstall: async () => {},
      cancelWakes: async () => 0,
    };
    const ctrl = new WakeSchedulerController({
      getApi: () => api,
      getPreference: (k) => prefs[k],
      setPreference: async (k, v) => {
        prefs[k] = v;
      },
      getAppVersion: () => "1.0.0",
    });
    await ctrl.reconcile();
    expect(prefs.keepAwakeEnabled).toBe(false);
    expect(prefs.wakeSchedulerCourtesyFlippedKeepAwake).toBe(true);
    expect(prefs.wakeSchedulerApprovedThisCycle).toBe(true);
  });

  it("kill-switch restores courtesy-flipped keepAwake", async () => {
    const prefs: Record<string, unknown> = {
      wakeSchedulerEnabled: true,
      wakeSchedulerApprovedThisCycle: true,
      wakeSchedulerRegisteredAtVersion: "1.0.0",
      wakeSchedulerCourtesyFlippedKeepAwake: true,
      keepAwakeEnabled: false,
    };
    const api: WakeSchedulerNativeApi = {
      status: async () => "enabled",
    };
    const ctrl = new WakeSchedulerController({
      getApi: () => api,
      isFeatureEnabled: () => false,
      getPreference: (k) => prefs[k],
      setPreference: async (k, v) => {
        prefs[k] = v;
      },
    });
    await ctrl.reconcile();
    expect(prefs.keepAwakeEnabled).toBe(true);
    expect(prefs.wakeSchedulerCourtesyFlippedKeepAwake).toBe(false);
  });

  it("uninstall when pref off and status enabled", async () => {
    let status: string = "enabled";
    const ops: string[] = [];
    const prefs: Record<string, unknown> = {
      wakeSchedulerEnabled: false,
      wakeSchedulerApprovedThisCycle: true,
      wakeSchedulerRegisteredAtVersion: "1.0.0",
      wakeSchedulerCourtesyFlippedKeepAwake: true,
      keepAwakeEnabled: false,
    };
    const api: WakeSchedulerNativeApi = {
      status: async () => status,
      cancelWakes: async () => {
        ops.push("cancel");
        return 0;
      },
      uninstall: async () => {
        ops.push("uninstall");
        status = "notFound";
      },
    };
    const ctrl = new WakeSchedulerController({
      getApi: () => api,
      getPreference: (k) => prefs[k],
      setPreference: async (k, v) => {
        prefs[k] = v;
      },
      getAppVersion: () => "1.0.0",
    });
    await ctrl.reconcile();
    expect(ops).toEqual(["cancel", "uninstall"]);
    expect(prefs.wakeSchedulerApprovedThisCycle).toBe(false);
    expect(prefs.wakeSchedulerCourtesyFlippedKeepAwake).toBe(false);
  });

  it("failed install flips wakeSchedulerEnabled off", async () => {
    const prefs: Record<string, unknown> = {
      wakeSchedulerEnabled: true,
      wakeSchedulerApprovedThisCycle: false,
      wakeSchedulerRegisteredAtVersion: "",
      wakeSchedulerCourtesyFlippedKeepAwake: false,
      keepAwakeEnabled: false,
    };
    const api: WakeSchedulerNativeApi = {
      status: async () => "notFound",
      install: async () => ({ success: false, error: "denied" }),
    };
    const ctrl = new WakeSchedulerController({
      getApi: () => api,
      getPreference: (k) => prefs[k],
      setPreference: async (k, v) => {
        prefs[k] = v;
      },
      getAppVersion: () => "9.9.9",
    });
    await ctrl.reconcile();
    expect(prefs.wakeSchedulerEnabled).toBe(false);
  });

  it("scheduleWake delegates to native when present", async () => {
    const api: WakeSchedulerNativeApi = {
      status: async () => "enabled",
      scheduleWake: async (when) => {
        expect(when).toBe(42);
        return 0;
      },
      cancelWakes: async () => 7,
    };
    const ctrl = new WakeSchedulerController({ getApi: () => api });
    expect(await ctrl.scheduleWake(42)).toBe(0);
    expect(await ctrl.cancelWakes()).toBe(7);
  });
});
