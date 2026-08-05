import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureWakeSchedulerClaims,
  createBridgePollWakeClaim,
  emitWakeSchedulerDarkWake,
  isWakeChainActive,
  listWakeSchedulerClaimIds,
  registerWakeSchedulerClaim,
  rescheduleWakeFromClaims,
  resetWakeSchedulerClaimsForTests,
  setWakeChainActive,
  unregisterWakeSchedulerClaim,
  wakeSchedulerEvents,
  WAKE_SCHEDULER_MIN_LEAD_MS,
} from "./wakeSchedulerClaims";

describe("wakeSchedulerClaims residual (LZe/Evi/woA/Gle)", () => {
  afterEach(() => {
    resetWakeSchedulerClaimsForTests();
  });

  it("register/unregister claim (LZe/Evi)", () => {
    registerWakeSchedulerClaim({
      id: "bridge-poll",
      nextWakeAt: () => new Date(Date.now() + 600_000),
    });
    expect(listWakeSchedulerClaimIds()).toEqual(["bridge-poll"]);
    unregisterWakeSchedulerClaim("bridge-poll");
    expect(listWakeSchedulerClaimIds()).toEqual([]);
  });

  it("woA schedules min claim after minLead when ready", async () => {
    const scheduleWakeFn = vi.fn(async () => 0);
    const now = 1_000_000;
    configureWakeSchedulerClaims({
      isReady: () => true,
      isFeatureEnabled: () => true,
      minLeadTimeMs: 90_000,
      scheduleWakeFn,
      now: () => now,
    });
    registerWakeSchedulerClaim({
      id: "a",
      nextWakeAt: () => new Date(now + 200_000),
    });
    registerWakeSchedulerClaim({
      id: "b",
      nextWakeAt: () => new Date(now + 300_000),
    });
    // too soon — filtered by minLead
    registerWakeSchedulerClaim({
      id: "c",
      nextWakeAt: () => new Date(now + 10_000),
    });
    const r = await rescheduleWakeFromClaims(now);
    expect(r.scheduledEpochMs).toBe(now + 200_000);
    expect(r.claimCount).toBe(2);
    expect(scheduleWakeFn).toHaveBeenCalledWith(now + 200_000);
  });

  it("woA does not invent success when scheduleWake returns non-zero", async () => {
    const scheduleWakeFn = vi.fn(async () => 3758097095);
    configureWakeSchedulerClaims({
      isReady: () => true,
      scheduleWakeFn,
      now: () => 0,
      minLeadTimeMs: 0,
    });
    registerWakeSchedulerClaim({
      id: "x",
      nextWakeAt: () => new Date(60_000),
    });
    const r = await rescheduleWakeFromClaims(0);
    expect(r.scheduledEpochMs).toBeNull();
    expect(scheduleWakeFn).toHaveBeenCalled();
  });

  it("woA skips when controller not ready", async () => {
    const scheduleWakeFn = vi.fn(async () => 0);
    configureWakeSchedulerClaims({
      isReady: () => false,
      scheduleWakeFn,
    });
    registerWakeSchedulerClaim({
      id: "x",
      nextWakeAt: () => new Date(Date.now() + WAKE_SCHEDULER_MIN_LEAD_MS + 60_000),
    });
    const r = await rescheduleWakeFromClaims();
    expect(r.scheduledEpochMs).toBeNull();
    expect(scheduleWakeFn).not.toHaveBeenCalled();
  });

  it("Gle true→false triggers reschedule when ready", async () => {
    const scheduleWakeFn = vi.fn(async () => 0);
    configureWakeSchedulerClaims({
      isReady: () => true,
      scheduleWakeFn,
      minLeadTimeMs: 0,
      now: () => 0,
    });
    registerWakeSchedulerClaim({
      id: "bridge-poll",
      nextWakeAt: () => new Date(120_000),
    });
    setWakeChainActive(true);
    expect(isWakeChainActive()).toBe(true);
    setWakeChainActive(false);
    expect(isWakeChainActive()).toBe(false);
    // async reschedule
    await new Promise((r) => setTimeout(r, 20));
    expect(scheduleWakeFn).toHaveBeenCalled();
  });

  it("createBridgePollWakeClaim respects dispose + battery interval", () => {
    let disposed = false;
    const claim = createBridgePollWakeClaim({
      isDisposed: () => disposed,
      isOnBatteryPower: () => true,
      batteryIntervalMs: 15_000,
      acIntervalMs: 5_000,
    });
    expect(claim.id).toBe("bridge-poll");
    const d1 = claim.nextWakeAt();
    expect(d1).toBeInstanceOf(Date);
    expect(d1!.getTime()).toBeGreaterThan(Date.now() + 10_000);
    disposed = true;
    expect(claim.nextWakeAt()).toBeNull();
  });

  it("darkwake emitter residual", () => {
    const spy = vi.fn();
    wakeSchedulerEvents.on("darkwake", spy);
    emitWakeSchedulerDarkWake();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
