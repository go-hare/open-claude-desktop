/**
 * Official buddy BLE main-process residual (app.asar ZCr / WCr / zSe / Alr support).
 *
 * - select-bluetooth-device: filter nibblet/claude → fill scan found map
 * - setBluetoothPairingHandler: providePin → pairingPrompt residual
 * - reportState(WCr): Connected → connected=true; else reconnect schedule residual
 *
 * Never invent devices / connected without Electron BLE picker + renderer reportState.
 *
 * data-official-source: app.asar ZCr / WCr / zSe / krr / Nrr / qrt
 */
import type { WebContents, Session } from "electron";

/** Official qrt / Nrr residual. */
export type BuddyBleReportState =
  | "ready"
  | "connected"
  | "disconnected";

export const BUDDY_BLE_REPORT_STATES = new Set<BuddyBleReportState>([
  "ready",
  "connected",
  "disconnected",
]);

export function isBuddyBleReportState(value: unknown): value is BuddyBleReportState {
  return typeof value === "string" && BUDDY_BLE_REPORT_STATES.has(value as BuddyBleReportState);
}

export type BuddyBleDeviceCandidate = {
  deviceId: string;
  deviceName?: string;
};

export type BuddyBleScanSession = {
  found: Map<string, string>;
  /** Official dQ.cb residual — optional completion for picker path. */
  cb?: ((deviceId: string) => void) | null;
  abandon?: ReturnType<typeof setTimeout> | null;
};

export type BuddyBleBridgeHost = {
  /** Official dQ residual during scanDevices/Alr. */
  getScanSession: () => BuddyBleScanSession | null;
  /** Official s_ paired stick for reconnect auto-select. */
  getPairedId: () => string | null;
  getPairedName: () => string | null;
  /** Official dTA pairing prompt. */
  onPairingPrompt?: (deviceName: string) => void;
  /** Official eX state sink (optional). */
  onReportState?: (state: BuddyBleReportState, name: string | null) => void;
  /** Official WCr → py connected flag. */
  setTransportConnected: (connected: boolean) => void;
  /** Official AaA reconnect schedule when disconnected (optional). */
  scheduleReconnect?: () => void;
  log?: (msg: string) => void;
};

export type BuddyBleBridgeHandle = {
  dispose: () => void;
  /** Official UtA residual — submit pin from UI. */
  submitPairingPin: (pin: string | null) => void;
  /** Official UtA non-null check — oat 20s timer must wait when true. */
  hasPendingPairingPin: () => boolean;
  isInstalled: () => boolean;
};

/** Official AaA delay residual: min(2000 * 2**attempt, 60000). */
export function buddyBleReconnectDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(2_000 * 2 ** n, 60_000);
}

/**
 * Official OtA residual body (pure):
 *   clear abandon; take cb; null session; call cb(deviceId); return whether empty → AaA.
 */
export function completeBuddyBleScanSessionResidual(
  session: BuddyBleScanSession | null,
  deviceId: string,
): {
  nextSession: null;
  callback: ((id: string) => void) | null;
  shouldScheduleReconnect: boolean;
} {
  if (!session) {
    return {
      nextSession: null,
      callback: null,
      shouldScheduleReconnect: false,
    };
  }
  if (session.abandon) {
    clearTimeout(session.abandon);
    session.abandon = null;
  }
  const callback = session.cb ?? null;
  session.cb = null;
  return {
    nextSession: null,
    callback,
    shouldScheduleReconnect: !deviceId,
  };
}

type SelectBluetoothHandler = (
  event: { preventDefault: () => void },
  devices: Array<{ deviceId: string; deviceName?: string }>,
  callback: (deviceId: string) => void,
) => void;

type PairingHandler = (
  details: { pairingKind?: string; deviceId?: string },
  callback: (response: { confirmed: boolean; pin?: string }) => void,
) => void;

/**
 * Official name filter residual: nibblet* / claude* (case-insensitive).
 */
export function isBuddyBleCandidateName(name: string | undefined | null): boolean {
  const c = (name || "").toLowerCase();
  return c.startsWith("nibblet") || c.startsWith("claude");
}

/**
 * Pure residual: filter Electron select-bluetooth-device list.
 */
export function filterBuddyBleCandidates(
  devices: BuddyBleDeviceCandidate[],
): BuddyBleDeviceCandidate[] {
  return devices.filter((d) => isBuddyBleCandidateName(d.deviceName));
}

/**
 * Official zSe residual body for one select-bluetooth-device event.
 * Mutates scanSession.found when scanning; auto-selects paired id when reconnecting.
 */
export function handleSelectBluetoothDeviceResidual(
  devices: BuddyBleDeviceCandidate[],
  opts: {
    scanSession: BuddyBleScanSession | null;
    pairedId: string | null;
    onAutoSelect?: (deviceId: string) => void;
    onNeedWait?: (callback: (deviceId: string) => void) => void;
  },
  callback: (deviceId: string) => void,
): "scan_filled" | "auto_selected" | "wait" | "empty" {
  const filtered = filterBuddyBleCandidates(devices);
  if (opts.scanSession) {
    for (const g of filtered) {
      opts.scanSession.found.set(g.deviceId, g.deviceName || "");
    }
    opts.scanSession.cb = callback;
    return filtered.length > 0 ? "scan_filled" : "empty";
  }
  if (!opts.pairedId) {
    callback("");
    return "empty";
  }
  const match = filtered.find((g) => g.deviceId === opts.pairedId);
  if (match) {
    opts.onAutoSelect?.(match.deviceId);
    callback(match.deviceId);
    return "auto_selected";
  }
  opts.onNeedWait?.(callback);
  return "wait";
}

/**
 * Official WCr residual: Connected → transport connected; else schedule reconnect.
 */
export function applyBuddyBleReportStateResidual(
  state: unknown,
  name: unknown,
  host: Pick<
    BuddyBleBridgeHost,
    "setTransportConnected" | "scheduleReconnect" | "onReportState"
  >,
): BuddyBleReportState | null {
  if (!isBuddyBleReportState(state)) return null;
  const deviceName = typeof name === "string" ? name : null;
  const connected = state === "connected";
  host.setTransportConnected(connected);
  if (!connected) {
    host.scheduleReconnect?.();
  }
  host.onReportState?.(state, deviceName);
  return state;
}

/**
 * Install official ZCr residual handlers on mainView webContents.
 * Safe no-op when webContents destroyed.
 */
export function installBuddyBleBridge(
  webContents: WebContents,
  host: BuddyBleBridgeHost,
): BuddyBleBridgeHandle {
  let disposed = false;
  let pendingPinResolve:
    | ((response: { confirmed: boolean; pin?: string }) => void)
    | null = null;
  let reconnectWait: ((deviceId: string) => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectRounds = 0;

  const log = (msg: string) => {
    host.log?.(msg);
  };

  const selectHandler: SelectBluetoothHandler = (event, devices, callback) => {
    try {
      event.preventDefault();
    } catch {
      /* ignore */
    }
    if (disposed) {
      callback("");
      return;
    }
    const list = Array.isArray(devices)
      ? devices.map((d) => ({
          deviceId: String(d.deviceId ?? ""),
          deviceName: d.deviceName,
        }))
      : [];
    const result = handleSelectBluetoothDeviceResidual(
      list,
      {
        scanSession: host.getScanSession(),
        pairedId: host.getPairedId(),
        onAutoSelect: (id) => {
          reconnectRounds = 0;
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
          }
          reconnectWait = null;
          log(`[buddy-ble] auto-selected ${id}`);
        },
        onNeedWait: (cb) => {
          reconnectWait = cb;
          reconnectRounds += 1;
          if (reconnectRounds === 1) {
            const name = host.getPairedName() ?? host.getPairedId() ?? "stick";
            log(`[buddy-ble] scanning for ${name}`);
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              if (reconnectWait) {
                log(
                  `[buddy-ble] scan timeout — saw ${list.length} stick(s), none matched`,
                );
                const g = reconnectWait;
                reconnectWait = null;
                reconnectRounds = 0;
                g("");
              }
            }, 15_000);
          }
        },
      },
      callback,
    );
    if (result === "scan_filled") {
      log(
        `[buddy-ble] scan candidates ${filterBuddyBleCandidates(list).length}`,
      );
    }
  };

  const pairingHandler: PairingHandler = (details, callback) => {
    if (disposed) {
      callback({ confirmed: false });
      return;
    }
    const kind = details?.pairingKind;
    if (kind !== "providePin") {
      callback({ confirmed: kind === "confirm" });
      return;
    }
    if (!host.onPairingPrompt) {
      log("[buddy-ble] passkey requested with no prompt target");
      callback({ confirmed: false });
      return;
    }
    pendingPinResolve = callback;
    const name =
      host.getPairedName() ??
      (typeof details.deviceId === "string" ? details.deviceId : "device");
    host.onPairingPrompt(name);
  };

  try {
    webContents.on(
      "select-bluetooth-device" as Parameters<WebContents["on"]>[0],
      selectHandler as never,
    );
  } catch (err) {
    log(
      `[buddy-ble] select-bluetooth-device bind failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const session = webContents.session as Session & {
      setBluetoothPairingHandler?: (handler: PairingHandler | null) => void;
    };
    session.setBluetoothPairingHandler?.(pairingHandler);
  } catch (err) {
    log(
      `[buddy-ble] setBluetoothPairingHandler failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  log("[buddy] starting bridge");

  return {
    isInstalled: () => !disposed,
    hasPendingPairingPin: () => pendingPinResolve !== null,
    submitPairingPin: (pin) => {
      const resolve = pendingPinResolve;
      pendingPinResolve = null;
      if (!resolve) return;
      if (pin === null || pin === undefined) {
        resolve({ confirmed: false });
        return;
      }
      resolve({ confirmed: true, pin: String(pin) });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try {
        webContents.removeListener(
          "select-bluetooth-device" as Parameters<WebContents["removeListener"]>[0],
          selectHandler as never,
        );
      } catch {
        /* ignore */
      }
      try {
        const session = webContents.session as Session & {
          setBluetoothPairingHandler?: (handler: PairingHandler | null) => void;
        };
        session.setBluetoothPairingHandler?.(null);
      } catch {
        /* ignore */
      }
      if (pendingPinResolve) {
        pendingPinResolve({ confirmed: false });
        pendingPinResolve = null;
      }
    },
  };
}
