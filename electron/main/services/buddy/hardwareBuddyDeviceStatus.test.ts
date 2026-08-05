import { describe, expect, it } from "vitest";
import {
  deviceStatusFromBleAck,
  isBuddyDeviceStatus,
  type BuddyPairedDevice,
} from "./hardwareBuddyService";

const paired: BuddyPairedDevice = { id: "stick-1", name: "Buddy Stick" };

const fullBleData = {
  name: "Stick A",
  owner: "alice",
  sec: true,
  bat: { pct: 64, mV: 3900, mA: -12, usb: false },
  sys: { up: 120, heap: 32_000, fsFree: 800_000, fsTotal: 2_000_000 },
  stats: { appr: 3, deny: 0, vel: 1, nap: 0, lvl: 1 },
};

describe("hardwareBuddy deviceStatus residual (llr / brr)", () => {
  it("accepts full official brr bag from BLE", () => {
    const bag = deviceStatusFromBleAck(paired, fullBleData);
    expect(bag).not.toBeNull();
    expect(isBuddyDeviceStatus(bag)).toBe(true);
    expect(bag?.bat.pct).toBe(64);
    expect(bag?.sys.heap).toBe(32_000);
    expect(bag?.stats.appr).toBe(3);
  });

  it("does not invent bat.pct 87 / heap / stats on sparse BLE ack", () => {
    const sparse = deviceStatusFromBleAck(paired, {
      name: "Stick A",
      // missing bat/sys/stats — official llr would return incomplete data;
      // product residual returns null rather than invent defaults.
    });
    expect(sparse).toBeNull();

    const partialBat = deviceStatusFromBleAck(paired, {
      name: "Stick A",
      bat: { pct: 50 }, // incomplete vrr
      sys: { up: 1, heap: 1 },
      stats: { appr: 0, deny: 0, vel: 0, nap: 0, lvl: 0 },
    });
    expect(partialBat).toBeNull();
  });

  it("fills name from paired only — never invents metrics", () => {
    const bag = deviceStatusFromBleAck(paired, {
      // no name
      bat: fullBleData.bat,
      sys: fullBleData.sys,
      stats: fullBleData.stats,
    });
    expect(bag?.name).toBe("Buddy Stick");
    expect(bag?.bat.pct).toBe(64);
  });

  it("rejects invent seed shape (legacy defaultDeviceStatus)", () => {
    expect(
      isBuddyDeviceStatus({
        name: "x",
        bat: { pct: 87, mV: 4120, mA: 0, usb: false },
        sys: { up: 1, heap: 48_000 },
        stats: { appr: 12, deny: 1, vel: 3, nap: 0, lvl: 2 },
      }),
    ).toBe(true); // shape-valid if device really sent it
    // But sparse path must not synthesize it:
    expect(deviceStatusFromBleAck(paired, {})).toBeNull();
  });
});
