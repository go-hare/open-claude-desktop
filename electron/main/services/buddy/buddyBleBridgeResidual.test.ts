import { describe, expect, it, vi } from "vitest";
import {
  applyBuddyBleReportStateResidual,
  buddyBleReconnectDelayMs,
  completeBuddyBleScanSessionResidual,
  filterBuddyBleCandidates,
  handleSelectBluetoothDeviceResidual,
  isBuddyBleCandidateName,
  isBuddyBleReportState,
} from "./buddyBleBridgeResidual";

describe("buddyBleBridgeResidual", () => {
  it("filters nibblet/claude names only", () => {
    expect(isBuddyBleCandidateName("Nibblet One")).toBe(true);
    expect(isBuddyBleCandidateName("claude-stick")).toBe(true);
    expect(isBuddyBleCandidateName("AirPods")).toBe(false);
    expect(isBuddyBleCandidateName("")).toBe(false);
    const list = filterBuddyBleCandidates([
      { deviceId: "1", deviceName: "Nibblet A" },
      { deviceId: "2", deviceName: "Phone" },
      { deviceId: "3", deviceName: "Claude Stick" },
    ]);
    expect(list.map((d) => d.deviceId)).toEqual(["1", "3"]);
  });

  it("scan session fills found map without invent", () => {
    const found = new Map<string, string>();
    const session = { found, cb: null as null | ((id: string) => void) };
    const cb = vi.fn();
    const result = handleSelectBluetoothDeviceResidual(
      [
        { deviceId: "a", deviceName: "Nibblet" },
        { deviceId: "b", deviceName: "Watch" },
      ],
      { scanSession: session, pairedId: null },
      cb,
    );
    expect(result).toBe("scan_filled");
    expect(found.get("a")).toBe("Nibblet");
    expect(found.has("b")).toBe(false);
    // Official leaves callback on dQ.cb — does not auto-complete scan pick.
    expect(cb).not.toHaveBeenCalled();
  });

  it("reconnect auto-selects paired id", () => {
    const cb = vi.fn();
    const auto = vi.fn();
    const result = handleSelectBluetoothDeviceResidual(
      [
        { deviceId: "x", deviceName: "Other" },
        { deviceId: "paired-1", deviceName: "Nibblet" },
      ],
      {
        scanSession: null,
        pairedId: "paired-1",
        onAutoSelect: auto,
      },
      cb,
    );
    expect(result).toBe("auto_selected");
    expect(cb).toHaveBeenCalledWith("paired-1");
    expect(auto).toHaveBeenCalledWith("paired-1");
  });

  it("no paired + no scan → empty callback", () => {
    const cb = vi.fn();
    const result = handleSelectBluetoothDeviceResidual(
      [{ deviceId: "1", deviceName: "Nibblet" }],
      { scanSession: null, pairedId: null },
      cb,
    );
    expect(result).toBe("empty");
    expect(cb).toHaveBeenCalledWith("");
  });

  it("reportState only accepts qrt residual", () => {
    expect(isBuddyBleReportState("ready")).toBe(true);
    expect(isBuddyBleReportState("connected")).toBe(true);
    expect(isBuddyBleReportState("disconnected")).toBe(true);
    expect(isBuddyBleReportState("success")).toBe(false);
    expect(isBuddyBleReportState("ok")).toBe(false);

    const set = vi.fn();
    const reconnect = vi.fn();
    applyBuddyBleReportStateResidual("connected", "Nibblet", {
      setTransportConnected: set,
      scheduleReconnect: reconnect,
    });
    expect(set).toHaveBeenCalledWith(true);
    expect(reconnect).not.toHaveBeenCalled();

    set.mockClear();
    applyBuddyBleReportStateResidual("ready", null, {
      setTransportConnected: set,
      scheduleReconnect: reconnect,
    });
    expect(set).toHaveBeenCalledWith(false);

    set.mockClear();
    reconnect.mockClear();
    applyBuddyBleReportStateResidual("disconnected", null, {
      setTransportConnected: set,
      scheduleReconnect: reconnect,
    });
    expect(set).toHaveBeenCalledWith(false);
    expect(reconnect).toHaveBeenCalled();

    expect(
      applyBuddyBleReportStateResidual("success", null, {
        setTransportConnected: set,
      }),
    ).toBeNull();
  });

  it("AaA delay residual is exponential capped at 60s", () => {
    expect(buddyBleReconnectDelayMs(0)).toBe(2_000);
    expect(buddyBleReconnectDelayMs(1)).toBe(4_000);
    expect(buddyBleReconnectDelayMs(2)).toBe(8_000);
    expect(buddyBleReconnectDelayMs(5)).toBe(60_000);
    expect(buddyBleReconnectDelayMs(20)).toBe(60_000);
  });

  it("OtA residual clears abandon + callback and schedules reconnect on empty", () => {
    const cb = vi.fn();
    const abandon = setTimeout(() => undefined, 30_000);
    const session = {
      found: new Map([["a", "Nibblet"]]),
      cb,
      abandon,
    };
    const empty = completeBuddyBleScanSessionResidual(session, "");
    expect(empty.nextSession).toBeNull();
    expect(empty.callback).toBe(cb);
    expect(empty.shouldScheduleReconnect).toBe(true);
    expect(session.abandon).toBeNull();

    const session2 = {
      found: new Map([["a", "Nibblet"]]),
      cb,
      abandon: setTimeout(() => undefined, 30_000),
    };
    const picked = completeBuddyBleScanSessionResidual(session2, "a");
    expect(picked.shouldScheduleReconnect).toBe(false);
    expect(picked.callback).toBe(cb);
  });
});
