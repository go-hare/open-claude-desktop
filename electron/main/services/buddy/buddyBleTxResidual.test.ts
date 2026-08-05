import { describe, expect, it, vi } from "vitest";
import {
  applyBuddyBleRxLineResidual,
  buildBuddyBleNameCmd,
  buildBuddyBleStatusCmd,
  buildBuddyBleTimeSyncLine,
  buildBuddyBleUnpairCmd,
  canBuddyBleDispatchTx,
  type BuddyBlePendingAck,
} from "./buddyBleTxResidual";

describe("buddyBleTxResidual", () => {
  it("builds official cmd lines", () => {
    expect(JSON.parse(buildBuddyBleUnpairCmd())).toEqual({ cmd: "unpair" });
    expect(JSON.parse(buildBuddyBleStatusCmd())).toEqual({ cmd: "status" });
    expect(JSON.parse(buildBuddyBleNameCmd("  too-long-name-over-twenty-chars "))).toEqual({
      cmd: "name",
      name: "  too-long-name-over-".slice(0, 20),
    });
    const t = JSON.parse(buildBuddyBleTimeSyncLine(new Date("2026-08-05T00:00:00Z")));
    expect(Array.isArray(t.time)).toBe(true);
    expect(t.time).toHaveLength(2);
  });

  it("Yq gate requires connected + dispatcher + mainView", () => {
    expect(
      canBuddyBleDispatchTx({
        connected: true,
        hasDispatcher: true,
        mainViewAlive: true,
      }),
    ).toBe(true);
    expect(
      canBuddyBleDispatchTx({
        connected: false,
        hasDispatcher: true,
        mainViewAlive: true,
      }),
    ).toBe(false);
    expect(
      canBuddyBleDispatchTx({
        connected: true,
        hasDispatcher: false,
        mainViewAlive: true,
      }),
    ).toBe(false);
  });

  it("rx ack resolves pending and invalid is ignore", () => {
    const pending = new Map<string, BuddyBlePendingAck>();
    const resolve = vi.fn();
    const reject = vi.fn();
    const timer = setTimeout(() => undefined, 5000);
    pending.set("name", { resolve, reject, timer });
    expect(applyBuddyBleRxLineResidual("not-json", pending)).toBe("ignore");
    expect(applyBuddyBleRxLineResidual(JSON.stringify({ ack: "name", ok: true, n: 1, data: { x: 1 } }), pending)).toBe(
      "ack",
    );
    expect(resolve).toHaveBeenCalledWith({
      ack: "name",
      ok: true,
      n: 1,
      data: { x: 1 },
      error: undefined,
    });
    expect(pending.has("name")).toBe(false);

    const onCmd = vi.fn();
    expect(
      applyBuddyBleRxLineResidual(JSON.stringify({ cmd: "status", pct: 1 }), pending, onCmd),
    ).toBe("cmd");
    expect(onCmd).toHaveBeenCalled();
  });
});
