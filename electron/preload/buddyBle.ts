/**
 * Official mainView buddyBle residual (app.asar Xr / Yr / Qr / Jr / Kr).
 *
 * Exposed as window.buddyBle = { pair, disconnect } via contextBridge.
 * Transport IPC: claude.buddy.BuddyBleTransport (rx / reportState / log / onTx).
 *
 * Web Bluetooth Nordic UART Service (NUS):
 *   service  6e400001-b5a3-f393-e0a9-e50e24dcca9e
 *   RX char  6e400002-… (host → device write)
 *   TX char  6e400003-… (device → host notify)
 *
 * States (qrt residual): ready | connected | disconnected
 * Never invent pair success when Web Bluetooth missing / user cancels.
 *
 * data-official-source: app.asar mainView.js Xr/Yr/Qr/Jr/Kr/oe
 */
import { contextBridge, ipcRenderer } from "electron";
import { buildIpcChannel } from "../../shared/ipc/channel";

/** Official NUS UUIDs (ea / Br / Gr residual). */
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

type BleState = "ready" | "connected" | "disconnected";

type BluetoothDeviceLike = {
  id?: string;
  name?: string | null;
  gatt?: {
    connect: () => Promise<BluetoothRemoteGATTServerLike>;
  };
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

type BluetoothRemoteGATTServerLike = {
  getPrimaryService: (uuid: string) => Promise<BluetoothRemoteGATTServiceLike>;
  disconnect: () => void;
  connected?: boolean;
};

type BluetoothRemoteGATTServiceLike = {
  getCharacteristic: (
    uuid: string,
  ) => Promise<BluetoothRemoteGATTCharacteristicLike>;
};

type BluetoothRemoteGATTCharacteristicLike = {
  startNotifications: () => Promise<unknown>;
  addEventListener: (
    type: string,
    listener: (ev: { target?: { value?: DataView } }) => void,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: (ev: { target?: { value?: DataView } }) => void,
  ) => void;
  writeValueWithoutResponse: (data: BufferSource) => Promise<void>;
};

const RX_CHANNEL = buildIpcChannel("claude.buddy", "BuddyBleTransport", "rx");
const REPORT_CHANNEL = buildIpcChannel(
  "claude.buddy",
  "BuddyBleTransport",
  "reportState",
);
const LOG_CHANNEL = buildIpcChannel("claude.buddy", "BuddyBleTransport", "log");
const TX_CHANNEL = buildIpcChannel("claude.buddy", "BuddyBleTransport", "tx");

let writeChar: BluetoothRemoteGATTCharacteristicLike | null = null;
let notifyChar: BluetoothRemoteGATTCharacteristicLike | null = null;
let gattServer: BluetoothRemoteGATTServerLike | null = null;
let device: BluetoothDeviceLike | null = null;
let disconnectListener: (() => void) | null = null;
let lineBuf = "";
const textDecoder = new TextDecoder("utf-8");
let writeQueue: Promise<void> = Promise.resolve();
let removeTxListener: (() => void) | null = null;

function log(line: string): void {
  void ipcRenderer.invoke(LOG_CHANNEL, line).catch(() => undefined);
}

function reportState(state: BleState, name: string | null = null): void {
  void ipcRenderer.invoke(REPORT_CHANNEL, state, name).catch(() => undefined);
}

function onNotify(ev: { target?: { value?: DataView } }): void {
  const value = ev.target?.value;
  if (!value) return;
  const bytes = new Uint8Array(
    value.buffer,
    value.byteOffset,
    value.byteLength,
  );
  lineBuf += textDecoder.decode(bytes, { stream: true });
  let nl: number;
  while ((nl = lineBuf.indexOf("\n")) >= 0) {
    const line = lineBuf.slice(0, nl).replace(/\r$/, "");
    lineBuf = lineBuf.slice(nl + 1);
    if (line) void ipcRenderer.invoke(RX_CHANNEL, line).catch(() => undefined);
  }
}

function cleanup(): void {
  if (device && disconnectListener) {
    try {
      device.removeEventListener?.("gattserverdisconnected", disconnectListener);
    } catch {
      /* ignore */
    }
  }
  try {
    notifyChar?.removeEventListener?.("characteristicvaluechanged", onNotify);
  } catch {
    /* ignore */
  }
  try {
    gattServer?.disconnect();
  } catch {
    /* ignore */
  }
  writeChar = null;
  notifyChar = null;
  gattServer = null;
  device = null;
  disconnectListener = null;
  lineBuf = "";
}

/** Official Qr residual. */
function disconnect(): void {
  cleanup();
  reportState("disconnected");
}

/** Official Jr residual — connect NUS on selected device. */
async function connectDevice(dev: BluetoothDeviceLike): Promise<void> {
  cleanup();
  device = dev;
  disconnectListener = () => {
    if (device === dev) {
      cleanup();
      reportState("disconnected");
    }
  };
  dev.addEventListener?.("gattserverdisconnected", disconnectListener);
  if (!dev.gatt) throw new Error("gatt unavailable");
  gattServer = await dev.gatt.connect();
  const service = await gattServer.getPrimaryService(NUS_SERVICE);
  writeChar = await service.getCharacteristic(NUS_RX);
  notifyChar = await service.getCharacteristic(NUS_TX);
  try {
    await notifyChar.startNotifications();
  } catch (err) {
    log(
      `startNotifications: ${err instanceof Error ? err.message : String(err)}; retrying after pair`,
    );
    await new Promise((r) => setTimeout(r, 1500));
    await notifyChar.startNotifications();
  }
  notifyChar.addEventListener("characteristicvaluechanged", onNotify);
  reportState("connected", dev.name ?? "Nibblet");
}

/**
 * Official Yr residual:
 *   !navigator.bluetooth → log + false
 *   requestDevice(acceptAllDevices, optionalServices:[NUS]) → Jr → true
 *   catch → log + false
 */
async function pair(): Promise<boolean> {
  const nav = globalThis.navigator as
    | {
        bluetooth?: {
          requestDevice: (opts: Record<string, unknown>) => Promise<BluetoothDeviceLike>;
        };
      }
    | undefined;
  if (!nav?.bluetooth) {
    log("Web Bluetooth not available");
    return false;
  }
  try {
    const selected = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [NUS_SERVICE],
    });
    await connectDevice(selected);
    return true;
  } catch (err) {
    log(`pair failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Official Kr residual — serial write queue, 180-byte chunks. */
function writeTxLine(line: string): void {
  writeQueue = writeQueue
    .then(async () => {
      if (!writeChar) return;
      const data = new TextEncoder().encode(`${line}\n`);
      const chunk = 180;
      for (let i = 0; i < data.length; i += chunk) {
        await writeChar.writeValueWithoutResponse(data.slice(i, i + chunk));
      }
    })
    .catch((err) => {
      log(`write failed: ${err instanceof Error ? err.message : String(err)}`);
    });
}

/**
 * Official Xr residual: subscribe BuddyBleTransport.tx → Kr; expose buddyBle; report ready.
 */
export function setupBuddyBle(): void {
  try {
    if (removeTxListener) {
      removeTxListener();
      removeTxListener = null;
    }
    const listener = (_event: unknown, line: unknown) => {
      writeTxLine(String(line ?? ""));
    };
    ipcRenderer.on(TX_CHANNEL, listener);
    removeTxListener = () => {
      ipcRenderer.removeListener(TX_CHANNEL, listener);
    };
    contextBridge.exposeInMainWorld("buddyBle", {
      pair,
      disconnect,
    });
    reportState("ready");
  } catch (err) {
    console.error("[buddyBle setup]", err);
  }
}
