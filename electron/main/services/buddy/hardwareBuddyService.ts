/**
 * Hardware Buddy residual aligned to official app.asar validators + setImplementation:
 * - status → { connected, error, paired: {id,name}|null }
 * - deviceStatus → null | { name, owner?, sec?, bat, sys, stats }
 * - scanDevices → {id,name}[]
 * - pairDevice() → boolean (no arg)
 * - pickDevice(id) → boolean
 * - setName(name) → boolean
 * - preview(folderPath) → gif|text|null
 * - install(folderPath) → void + progress events
 * - buddy-state JSON persistence (paired device)
 *
 * Real BLE still goes through mainView window.buddyBle in the official app.
 * This service provides shape-correct state machine + local folder preview/install
 * so the official BuddyWindow UI can drive Connect / stats / Send without schema errors.
 */
import { app, dialog, type BrowserWindow, type WebContents } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  applyBuddyBleReportStateResidual,
  buddyBleReconnectDelayMs,
  completeBuddyBleScanSessionResidual,
  installBuddyBleBridge,
  type BuddyBleBridgeHandle,
  type BuddyBleScanSession,
} from "./buddyBleBridgeResidual";
import {
  formatBuddyBleInstallFailLine,
  formatBuddyBleInstallProgressLine,
  formatBuddyBleInstallSentLine,
  inventoryBuddyBleInstallFolder,
  runBuddyBleInstallResidual,
} from "./buddyBleInstallResidual";
import {
  applyBuddyBleRxLineResidual,
  buildBuddyBleNameCmd,
  buildBuddyBleStatusCmd,
  buildBuddyBleTimeSyncLine,
  buildBuddyBleUnpairCmd,
  canBuddyBleDispatchTx,
  type BuddyBleAckResult,
  type BuddyBlePendingAck,
} from "./buddyBleTxResidual";

/** Official ge.webContents residual for oat pair / aat disconnect. */
export type BuddyMainViewExecutor = {
  isDestroyed: () => boolean;
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
  /** Optional: real WebContents for select-bluetooth-device residual (ZCr). */
  webContents?: WebContents | null;
};

export type BuddyPairedDevice = {
  id: string;
  name: string;
};

/** Official Trr(status) */
export type BuddyConnStatus = {
  connected: boolean;
  error: string | null;
  paired: BuddyPairedDevice | null;
};

/** Official vrr / Grr / Lrr / brr */
export type BuddyDeviceStatus = {
  name: string;
  owner?: string;
  sec?: boolean;
  bat: { pct: number; mV: number; mA: number; usb: boolean };
  sys: { up: number; heap: number; fsFree?: number; fsTotal?: number };
  stats: { appr: number; deny: number; vel: number; nap: number; lvl: number };
};

/** Official Orr(preview) */
export type BuddyPreview =
  | { kind: "gif"; dataUrl: string }
  | { kind: "text"; frames: string[]; delay: number; color: string };

type BuddyStateFile = {
  paired: BuddyPairedDevice | null;
};

type ProgressSink = (msg: string) => void;
type PairingPromptSink = (deviceName: string) => void;

function statePath(): string {
  return path.join(app.getPath("userData"), "buddy-state.json");
}

function tokensPath(): string {
  return path.join(app.getPath("userData"), "buddy-tokens.json");
}

function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

/** Official vrr residual. */
function isBuddyBatStatus(
  value: unknown,
): value is BuddyDeviceStatus["bat"] {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.pct === "number" &&
    typeof o.mV === "number" &&
    typeof o.mA === "number" &&
    typeof o.usb === "boolean"
  );
}

/** Official Grr residual. */
function isBuddySysStatus(
  value: unknown,
): value is BuddyDeviceStatus["sys"] {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (typeof o.up !== "number" || typeof o.heap !== "number") return false;
  if (o.fsFree !== undefined && typeof o.fsFree !== "number") return false;
  if (o.fsTotal !== undefined && typeof o.fsTotal !== "number") return false;
  return true;
}

/** Official Lrr residual. */
function isBuddyStatsStatus(
  value: unknown,
): value is BuddyDeviceStatus["stats"] {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.appr === "number" &&
    typeof o.deny === "number" &&
    typeof o.vel === "number" &&
    typeof o.nap === "number" &&
    typeof o.lvl === "number"
  );
}

/**
 * Official brr residual validator for deviceStatus bags.
 * data-official-source: app.asar vrr / Grr / Lrr / brr
 */
export function isBuddyDeviceStatus(
  value: unknown,
): value is BuddyDeviceStatus {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (typeof o.name !== "string") return false;
  if (o.owner !== undefined && typeof o.owner !== "string") return false;
  if (o.sec !== undefined && typeof o.sec !== "boolean") return false;
  return isBuddyBatStatus(o.bat) && isBuddySysStatus(o.sys) && isBuddyStatsStatus(o.stats);
}

/**
 * Official llr residual: return BLE status ack data as-is when brr-valid.
 * Never invent bat.pct / heap / stats defaults (e.g. pct:87) for sparse ACKs.
 * Only identity residual: if name missing, use paired.name (not metrics).
 * data-official-source: app.asar llr → e.ok ? e.data : null
 */
export function deviceStatusFromBleAck(
  paired: BuddyPairedDevice,
  data: Record<string, unknown>,
): BuddyDeviceStatus | null {
  const name =
    typeof data.name === "string" && data.name.length > 0
      ? data.name
      : paired.name;
  const candidate: Record<string, unknown> = { ...data, name };
  return isBuddyDeviceStatus(candidate) ? candidate : null;
}

/**
 * Local/sim residual for Hardware Buddy IPC.
 * When `CLAUDE_BUDDY_MOCK_DEVICES=1`, scan returns a demo stick so the full UI flow is exercisable without BLE.
 * Official oat residual: pairDevice → mainView executeJavaScript("window.buddyBle?.pair?.() ?? false").
 */
export class HardwareBuddyService {
  private paired: BuddyPairedDevice | null = null;
  private connected = false;
  private loaded = false;
  private scanInFlight = false;
  private scanFound = new Map<string, string>();
  /** Official mmA residual — install already in progress guard. */
  private installInFlight = false;
  /**
   * Official YtA residual (Blr/Qlr): install-busy suppresses status poll residual.
   * Distinct from mmA so mid-transfer Qlr does not clear the in-progress guard.
   */
  private installBusy = false;
  private startedAt = Date.now();
  private onProgress: ProgressSink | null = null;
  private onPairingPrompt: PairingPromptSink | null = null;
  private pendingPinResolve: ((pin: string | null) => void) | null = null;
  /** Official ge.webContents residual for oat pair / disconnect. */
  private mainViewExecutor: BuddyMainViewExecutor | null = null;
  private pairInFlight = false;
  /** Official dQ residual during Alr scan. */
  private scanSession: BuddyBleScanSession | null = null;
  /** Official ZCr bridge handle (select-bluetooth-device + pairing). */
  private bleBridge: BuddyBleBridgeHandle | null = null;
  private bleBridgeWebContents: WebContents | null = null;
  /** Official pG residual — reconnect attempt counter for AaA. */
  private reconnectAttempts = 0;
  /** Official _Q residual — pending AaA timer. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Official Oq residual — bridge installed / BLE path available. */
  private blePathEnabled = true;
  /**
   * Official $Cr / gi("hardwareBuddyEnabled") residual.
   * rat(e) → xn("hardwareBuddyEnabled", e!==null).
   * In-memory mirror; optional preference inject can dual-write.
   */
  private hardwareBuddyEnabled = false;
  private setHardwareBuddyEnabledPref:
    | ((enabled: boolean) => void)
    | null = null;
  /**
   * Official uTA residual — BuddyBleTransport.setImplementation host handle
   * with dispatchTx (main → mainView preload Kr write).
   */
  private txDispatcher: ((line: string) => void) | null = null;
  /** Official a_ residual — pending rm(ack) waiters. */
  private pendingAcks = new Map<string, BuddyBlePendingAck>();
  /** Official hTA residual — consecutive status timeouts. */
  private statusTimeouts = 0;

  setProgressSink(sink: ProgressSink | null): void {
    this.onProgress = sink;
  }

  setPairingPromptSink(sink: PairingPromptSink | null): void {
    this.onPairingPrompt = sink;
  }

  /**
   * Optional dual-write for official xn("hardwareBuddyEnabled", …).
   * Product residual keeps in-memory $Cr even without settings inject.
   */
  setHardwareBuddyEnabledWriter(
    writer: ((enabled: boolean) => void) | null,
  ): void {
    this.setHardwareBuddyEnabledPref = writer;
  }

  /**
   * Official uTA.dispatchTx residual inject (events.buddyBleTx / mainView Kr).
   * Without this, Yq returns false — never invent BLE write success.
   */
  setTxDispatcher(dispatcher: ((line: string) => void) | null): void {
    this.txDispatcher = dispatcher;
  }

  /**
   * Wire mainView webContents for official oat residual:
   *   executeJavaScript("window.buddyBle?.pair?.() ?? false")
   * + ZCr select-bluetooth-device / pairing handlers when WebContents given.
   * Without this (or when destroyed), pair returns false — no invent connected.
   */
  setMainViewExecutor(executor: BuddyMainViewExecutor | null): void {
    this.mainViewExecutor = executor;
    const wc = executor?.webContents ?? null;
    if (wc && !wc.isDestroyed()) {
      this.ensureBleBridge(wc);
    }
  }

  /**
   * Official ZCr residual install — once per mainView webContents.
   */
  private ensureBleBridge(webContents: WebContents): void {
    if (this.bleBridge && this.bleBridgeWebContents === webContents) {
      return;
    }
    this.bleBridge?.dispose();
    this.bleBridgeWebContents = webContents;
    this.bleBridge = installBuddyBleBridge(webContents, {
      getScanSession: () => this.scanSession,
      getPairedId: () => this.paired?.id ?? null,
      getPairedName: () => this.paired?.name ?? null,
      onPairingPrompt: (deviceName) => {
        this.onPairingPrompt?.(deviceName);
      },
      setTransportConnected: (connected) => {
        this.connected = connected;
        if (connected) {
          this.startedAt = Date.now();
          this.progress("connected");
        } else {
          this.progress("disconnected");
        }
      },
      scheduleReconnect: () => {
        this.scheduleBuddyBleReconnect();
      },
      onReportState: (state, name) => {
        this.progress(`ble_state:${state}${name ? `:${name}` : ""}`);
      },
      log: (msg) => {
        console.log(msg);
      },
    });
  }

  private progress(msg: string): void {
    this.onProgress?.(msg);
  }

  /** Official clear of _Q reconnect timer. */
  private clearBuddyBleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Official rat residual: s_ + hardwareBuddyEnabled preference.
   */
  private rat(device: BuddyPairedDevice | null): void {
    this.paired = device;
    this.hardwareBuddyEnabled = device !== null;
    try {
      this.setHardwareBuddyEnabledPref?.(this.hardwareBuddyEnabled);
    } catch {
      /* ignore preference write failures */
    }
  }

  /**
   * Official AaA residual:
   *   if (!$Cr() || _Q || nM || py || !Oq) return
   *   delay = min(2000 * 2**pG, 60000)
   *   then pG++; oat(); success → pG=0 else AaA()
   */
  private scheduleBuddyBleReconnect(): void {
    if (
      !this.hardwareBuddyEnabled ||
      !this.blePathEnabled ||
      this.reconnectTimer ||
      this.pairInFlight ||
      this.scanInFlight ||
      this.scanSession ||
      this.connected ||
      !this.paired
    ) {
      return;
    }
    const delay = buddyBleReconnectDelayMs(this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.connected || !this.blePathEnabled || !this.paired) return;
      this.reconnectAttempts += 1;
      void this.pairDevice().then((ok) => {
        if (ok) {
          this.reconnectAttempts = 0;
        } else {
          this.scheduleBuddyBleReconnect();
        }
      });
    }, delay);
  }

  /**
   * Official OtA residual:
   *   clear abandon; call dQ.cb(deviceId); null dQ; nM=false;
   *   empty deviceId → AaA().
   */
  private completeScanSession(deviceId: string): void {
    const session = this.scanSession;
    const result = completeBuddyBleScanSessionResidual(session, deviceId);
    this.scanSession = result.nextSession;
    this.scanInFlight = false;
    this.pairInFlight = false;
    try {
      result.callback?.(deviceId);
    } catch {
      /* ignore */
    }
    if (result.shouldScheduleReconnect) {
      this.scheduleBuddyBleReconnect();
    }
  }

  /**
   * Official oat residual:
   *   race pair JS vs 20s; if UtA pending at 20s → keep waiting (no invent false).
   */
  private async invokeBuddyBlePair(): Promise<boolean> {
    const exec = this.mainViewExecutor;
    if (!exec || exec.isDestroyed()) {
      console.warn("[buddy-ble] no mainView, can't pair");
      return false;
    }
    let hangTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      const result = await Promise.race([
        exec.executeJavaScript("window.buddyBle?.pair?.() ?? false", true),
        new Promise<false>((resolve) => {
          hangTimer = setTimeout(() => {
            // Official: if UtA (pending pin) still set, wait — do not resolve false.
            if (this.bleBridge?.hasPendingPairingPin?.()) {
              console.info("[buddy-ble] pair: 20s elapsed, waiting on passkey");
              return;
            }
            console.warn("[buddy-ble] pair: renderer hung past 20s");
            resolve(false);
          }, 20_000);
        }),
      ]);
      console.info(`[buddy-ble] pair: result=${Boolean(result)}`);
      return Boolean(result);
    } catch (err) {
      console.warn(
        `[buddy-ble] pair failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      if (hangTimer) clearTimeout(hangTimer);
    }
  }

  /**
   * Official Alr residual:
   *   dQ = { found: Map, abandon: 30s → OtA("") }
   *   executeJavaScript buddyBle.pair() (opens Web Bluetooth picker)
   *   select-bluetooth-device fills dQ.found (nibblet/claude only)
   *   wait 5s → return found map (may be empty — no invent)
   *   empty → OtA("")
   */
  private async invokeBuddyBleScan(): Promise<BuddyPairedDevice[]> {
    const exec = this.mainViewExecutor;
    if (!exec || exec.isDestroyed()) return [];
    // Ensure ZCr handlers installed if webContents available.
    if (exec.webContents && !exec.webContents.isDestroyed()) {
      this.ensureBleBridge(exec.webContents);
    }

    this.clearBuddyBleReconnect();
    this.scanSession = {
      found: this.scanFound,
      cb: null,
      abandon: setTimeout(() => {
        console.warn("[buddy-ble] picker abandoned");
        this.completeScanSession("");
      }, 30_000),
    };

    // Official: fire pair() for picker; ignore hang (scan window is 5s).
    void exec
      .executeJavaScript("window.buddyBle?.pair?.() ?? false", true)
      .catch((err) => {
        console.warn(
          `[buddy-ble] scan pair() failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    const session = this.scanSession;
    await new Promise((r) => setTimeout(r, 5_000));
    if (this.scanSession !== session) {
      return [];
    }
    const devices = [...this.scanFound].map(([id, name]) => ({
      id,
      name: name || id,
    }));
    // Official: keep dQ until elr/OtA; only OtA("") when empty after 5s.
    if (devices.length === 0) {
      this.completeScanSession("");
    }
    return devices;
  }

  private invokeBuddyBleDisconnect(): void {
    const exec = this.mainViewExecutor;
    if (!exec || exec.isDestroyed()) return;
    void exec
      .executeJavaScript("window.buddyBle?.disconnect?.()", true)
      .catch(() => undefined);
  }

  private mainViewAlive(): boolean {
    const exec = this.mainViewExecutor;
    return Boolean(exec && !exec.isDestroyed());
  }

  /**
   * Official Yq residual:
   *   !py || !uTA || !mainView → false
   *   else uTA.dispatchTx(line); true
   */
  private writeBleLine(line: string): boolean {
    if (
      !canBuddyBleDispatchTx({
        connected: this.connected,
        hasDispatcher: Boolean(this.txDispatcher),
        mainViewAlive: this.mainViewAlive(),
      })
    ) {
      return false;
    }
    try {
      this.txDispatcher?.(line);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Official rm residual — write + wait ack key (timeout reject).
   * No invent ok when write fails / timeout / not connected.
   */
  private requestBleAck(
    line: string,
    ack: string,
    timeoutMs = 5_000,
  ): Promise<BuddyBleAckResult> {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error("device: not connected"));
        return;
      }
      const prev = this.pendingAcks.get(ack);
      if (prev) {
        clearTimeout(prev.timer);
        prev.reject(new Error(`device: ${ack} superseded`));
        this.pendingAcks.delete(ack);
      }
      const entry: BuddyBlePendingAck = {
        resolve,
        reject,
        timer: setTimeout(() => {
          if (this.pendingAcks.get(ack) === entry) {
            this.pendingAcks.delete(ack);
          }
          reject(new Error(`device: ${ack} ack timeout`));
        }, timeoutMs),
      };
      this.pendingAcks.set(ack, entry);
      if (!this.writeBleLine(line)) {
        this.pendingAcks.delete(ack);
        clearTimeout(entry.timer);
        reject(new Error("device: BLE write failed"));
      }
    });
  }

  /**
   * Official Clr residual on connected:
   *   Elr owner best-effort (skip without account inject)
   *   Yq time sync
   */
  private onBleConnectedClr(): void {
    this.statusTimeouts = 0;
    console.info("[buddy] BLE connected");
    // Official Elr needs qa() account — product skips without invent owner.
    void this.writeBleLine(buildBuddyBleTimeSyncLine());
  }

  private onBleDisconnectedClr(): void {
    console.info("[buddy] BLE disconnected");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const state = await readJsonFile<BuddyStateFile>(statePath(), { paired: null });
    const paired =
      state.paired &&
      typeof state.paired.id === "string" &&
      typeof state.paired.name === "string"
        ? { id: state.paired.id, name: state.paired.name }
        : null;
    // Official rat on boot from store — enables $Cr when previously paired.
    this.rat(paired);
    // Official: paired does not imply connected; reconnect is explicit (pairDevice).
    this.connected = false;
  }

  private async persistPaired(): Promise<void> {
    await writeJsonFile(statePath(), { paired: this.paired } satisfies BuddyStateFile);
  }

  async status(): Promise<BuddyConnStatus> {
    await this.ensureLoaded();
    return {
      connected: this.connected,
      error: null,
      paired: this.paired,
    };
  }

  /**
   * Official llr residual: rm({cmd:"status"},"status",3s) → data or null.
   * On write/ack failure: hTA++; after 3 timeouts warn; return null (no invent).
   * Without TX dispatcher: null (official llr only talks BLE; no invent bat/heap/stats).
   */
  async deviceStatus(): Promise<BuddyDeviceStatus | null> {
    await this.ensureLoaded();
    if (!this.connected || !this.paired) return null;
    // Official YtA: status poll residual suppressed while install transfer busy.
    if (this.installBusy) return null;

    if (this.txDispatcher && this.mainViewAlive()) {
      try {
        const res = await this.requestBleAck(
          buildBuddyBleStatusCmd(),
          "status",
          3_000,
        );
        this.statusTimeouts = 0;
        if (res.ok && res.data && typeof res.data === "object") {
          // Official llr: e.ok ? e.data : null — no invent merge of bat/heap/stats.
          return deviceStatusFromBleAck(
            this.paired,
            res.data as Record<string, unknown>,
          );
        }
        return null;
      } catch {
        this.statusTimeouts += 1;
        if (this.statusTimeouts >= 3) {
          console.warn("[buddy] 3 status timeouts");
        }
        return null;
      }
    }

    // Official llr only talks BLE via rm; without TX there is no status residual body.
    // Never invent bat/heap/stats (e.g. bat.pct:87) when device ACK is unavailable.
    return null;
  }

  /**
   * Official oat: reconnect already-paired stick via window.buddyBle.pair().
   * Order:
   *   1. mock env may force connected (dev residual)
   *   2. mainView executeJavaScript buddyBle.pair (official path)
   *   3. else false — never soft-true connected
   */
  async pairDevice(): Promise<boolean> {
    await this.ensureLoaded();
    if (!this.paired) return false;
    // Official nM covers both pair + Alr scan session.
    if (this.pairInFlight || this.scanInFlight || this.scanSession) {
      this.progress("pair_in_flight");
      return false;
    }
    if (process.env.CLAUDE_BUDDY_MOCK_DEVICES === "1") {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.clearBuddyBleReconnect();
      this.startedAt = Date.now();
      this.progress("connected");
      return true;
    }
    this.pairInFlight = true;
    this.clearBuddyBleReconnect();
    try {
      console.info("[buddy-ble] pair: invoking renderer");
      const ok = await this.invokeBuddyBlePair();
      this.connected = ok;
      if (ok) {
        this.reconnectAttempts = 0;
        this.startedAt = Date.now();
        this.progress("connected");
      } else {
        this.progress("pair_unavailable");
      }
      return ok;
    } finally {
      this.pairInFlight = false;
    }
  }

  /**
   * Official Alr residual: scan nearby sticks → {id,name}[].
   *
   * Official path: dQ.found + buddyBle.pair() + select-bluetooth-device filter.
   * Product residual:
   *   1. mock env → demo devices (dev only)
   *   2. Alr via mainView pair + ZCr found map
   *   3. empty [] when no BLE / no sticks — never invent
   */
  async scanDevices(): Promise<BuddyPairedDevice[]> {
    await this.ensureLoaded();
    if (this.scanInFlight || this.pairInFlight) return [];
    this.scanInFlight = true;
    this.scanFound.clear();
    this.progress("scanning");

    const mock = process.env.CLAUDE_BUDDY_MOCK_DEVICES === "1";
    if (mock) {
      const demo: BuddyPairedDevice[] = [
        { id: "mock-nibblet-001", name: "Nibblet Demo" },
        { id: "mock-claude-stick", name: "Claude Stick" },
      ];
      for (const d of demo) this.scanFound.set(d.id, d.name);
      await new Promise((r) => setTimeout(r, 400));
      this.scanInFlight = false;
      return demo;
    }

    try {
      const devices = await this.invokeBuddyBleScan();
      // Official: when devices found, dQ stays open until elr/OtA — keep nM-equivalent true.
      if (devices.length === 0 && !this.scanSession) {
        this.scanInFlight = false;
      }
      return devices;
    } catch (err) {
      this.scanInFlight = false;
      throw err;
    }
  }

  /**
   * Official elr(id):
   *   if !dQ return false
   *   name = dQ.found.get(id); if undefined return false
   *   rat({id,name}); OtA(id); return true
   * Note: official elr does **not** re-call oat — picker already running pair().
   */
  async pickDevice(deviceId: string): Promise<boolean> {
    await this.ensureLoaded();
    const name = this.scanFound.get(deviceId);
    if (!name && process.env.CLAUDE_BUDDY_MOCK_DEVICES !== "1") {
      // Official: only known scan results.
      return false;
    }
    if (!this.scanSession && process.env.CLAUDE_BUDDY_MOCK_DEVICES !== "1") {
      // Official elr requires active dQ scan session.
      return false;
    }
    const deviceName = name ?? `Buddy ${deviceId.slice(0, 6)}`;
    // Official rat({id,name}) before OtA.
    this.rat({ id: deviceId, name: deviceName });
    await this.persistPaired();
    this.progress(`picked:${deviceName}`);

    // Official passkey path: pairingPrompt → submitPin. Sim: auto-bond with prompt for UI.
    if (process.env.CLAUDE_BUDDY_MOCK_DEVICES === "1") {
      this.onPairingPrompt?.(deviceName);
      // Wait briefly for pin UI; auto-accept if no pin submitted (mock only).
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.pendingPinResolve = null;
          this.connected = true;
          this.startedAt = Date.now();
          this.progress("connected");
          resolve();
        }, 50);
        this.pendingPinResolve = (pin) => {
          clearTimeout(timer);
          this.pendingPinResolve = null;
          if (pin === null) {
            // cancel
            this.connected = false;
            resolve();
            return;
          }
          this.connected = true;
          this.startedAt = Date.now();
          this.progress("connected");
          resolve();
        };
      });
      return this.connected;
    }

    // Official: OtA(selectedId) completes picker callback; connection via ongoing pair()/reportState.
    this.completeScanSession(deviceId);
    return true;
  }

  /** Official gat residual → OtA(""). */
  async cancelScan(): Promise<void> {
    this.scanFound.clear();
    if (this.scanSession) {
      this.completeScanSession("");
    } else {
      this.scanInFlight = false;
    }
    if (this.pendingPinResolve) {
      this.pendingPinResolve(null);
      this.pendingPinResolve = null;
    }
    this.bleBridge?.submitPairingPin(null);
  }

  /** Official A0e(pin|null) + UtA residual for Electron BLE pairing handler. */
  async submitPin(pin: string | null): Promise<void> {
    if (this.pendingPinResolve) {
      this.pendingPinResolve(pin);
    }
    // Official UtA: forward to setBluetoothPairingHandler callback.
    this.bleBridge?.submitPairingPin(pin);
  }

  /**
   * Official aat residual:
   *   if py → Yq(unpair); rat(null); clear reconnect; if py → disconnect
   */
  async forgetDevice(): Promise<void> {
    await this.ensureLoaded();
    this.clearBuddyBleReconnect();
    this.reconnectAttempts = 0;
    const wasConnected = this.connected;
    if (wasConnected) {
      // Best-effort unpair cmd; official does not wait ack before rat(null).
      void this.writeBleLine(buildBuddyBleUnpairCmd());
    }
    this.connected = false;
    // Official rat(null) → hardwareBuddyEnabled false.
    this.rat(null);
    await this.persistPaired();
    console.info("[buddy-ble] paired device forgotten");
    if (wasConnected) {
      this.invokeBuddyBleDisconnect();
    }
    this.progress("forgotten");
  }

  /**
   * Official setName residual:
   *   rm({cmd:"name",name:slice0..20},"name",3s).then(r=>r.ok).catch(()=>false)
   * Local rat update only after device ack ok (or when no TX path — local-only residual).
   */
  async setName(name: string): Promise<boolean> {
    await this.ensureLoaded();
    if (!this.connected || !this.paired) return false;
    const next = String(name ?? "").slice(0, 20);
    if (!next.trim()) return false;

    if (this.txDispatcher && this.mainViewAlive()) {
      try {
        const res = await this.requestBleAck(
          buildBuddyBleNameCmd(next),
          "name",
          3_000,
        );
        if (!res.ok) return false;
      } catch {
        return false;
      }
    }

    this.rat({ ...this.paired, name: next.trim() || next });
    await this.persistPaired();
    return true;
  }

  async pickFolder(parent?: BrowserWindow | null): Promise<string | null> {
    const options = {
      title: "Choose Data Folder",
      message: "Pick a folder to send to your device",
      properties: ["openDirectory" as const],
    };
    const result = parent && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  }

  /** Official preview(folderPath) */
  async preview(folderPath: string): Promise<BuddyPreview | null> {
    try {
      const manifestPath = path.join(folderPath, "manifest.json");
      try {
        const raw = await fs.readFile(manifestPath, "utf8");
        const o = JSON.parse(raw) as {
          mode?: string;
          states?: Record<string, { frames?: string[]; delay?: number } | string[] | string>;
          colors?: { body?: string };
        };
        const idle = o.states?.idle ?? (o.states ? Object.values(o.states)[0] : undefined);
        if (idle && o.mode === "text") {
          const a = idle as { frames?: string[]; delay?: number };
          if (a.frames?.length) {
            return {
              kind: "text",
              frames: a.frames,
              delay: a.delay ?? 200,
              color: o.colors?.body ?? "#C05630",
            };
          }
        } else if (idle) {
          const a = Array.isArray(idle) ? idle[0] : idle;
          if (typeof a === "string" && a === path.basename(a)) {
            const buf = await fs.readFile(path.join(folderPath, a));
            return { kind: "gif", dataUrl: `data:image/gif;base64,${buf.toString("base64")}` };
          }
        }
      } catch {
        /* fall through to inventory summary */
      }

      // Official preview fallback uses Bat inventory (flat, e0e).
      const inv = await inventoryBuddyBleInstallFolder(folderPath);
      const kb = Math.round(inv.totalBytes / 1024);
      const label = inv.files.length === 1 ? "file" : "files";
      return {
        kind: "text",
        frames: [`${inv.files.length} ${label}`, `${kb} KB`],
        delay: 0,
        color: "#888",
      };
    } catch {
      return null;
    }
  }

  /**
   * Official install residual (plr → hlr/flr):
   *   mmA guard; hlr(Bat+Blr+flr+Qlr) via rm/Yq; progress strings from bytesDone.
   * Fail closed when !connected or TX/ack fails — never invent ✓ sent.
   */
  async install(folderPath: string): Promise<void> {
    // Official mmA: set immediately after guard (before any await) so concurrent
    // install cannot both pass the in-progress check.
    if (this.installInFlight) throw new Error("install already in progress");
    this.installInFlight = true;
    try {
      await this.ensureLoaded();
      if (!this.connected) throw new Error("device: not connected");
      if (!this.txDispatcher || !this.mainViewAlive()) {
        throw new Error("device: BLE TX unavailable");
      }

      const result = await runBuddyBleInstallResidual(
        folderPath,
        (line, ack, timeoutMs) => this.requestBleAck(line, ack, timeoutMs),
        (p) => this.progress(formatBuddyBleInstallProgressLine(p)),
        {
          // Official Blr/Qlr: YtA only — does not clear mmA mid-transfer.
          setInstallBusy: (busy) => {
            this.installBusy = busy;
          },
        },
      );
      this.progress(formatBuddyBleInstallSentLine(result.name, result.bytes));

      // bump tokens-today residual lightly
      const tokens = await readJsonFile<{ date: string; tokens: number }>(
        tokensPath(),
        { date: "", tokens: 0 },
      );
      const today = todayKey();
      const next =
        tokens.date === today
          ? tokens.tokens + result.bytes
          : result.bytes;
      await writeJsonFile(tokensPath(), { date: today, tokens: next });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.progress(formatBuddyBleInstallFailLine(message));
      throw error instanceof Error ? error : new Error(message);
    } finally {
      this.installInFlight = false;
      this.installBusy = false;
    }
  }

  /**
   * Official BuddyBleTransport.reportState residual (WCr / krr):
   *   only ready|connected|disconnected accepted
   *   connected → py true; else reconnect schedule residual (no invent)
   * Second arg is device name when connected (optional).
   */
  async reportBleState(
    state: unknown,
    name?: unknown,
  ): Promise<{ ok: true; state: unknown }> {
    // Official WCr:
    //   py = (state === Connected)
    //   connected → pG=0 + clear _Q
    //   else → pG=0 + AaA()
    // Official also wires XCr(Clr): connected → Elr + time Yq; disconnected log.
    const applied = applyBuddyBleReportStateResidual(state, name, {
      setTransportConnected: (connected) => {
        this.connected = connected;
        if (connected) {
          this.reconnectAttempts = 0;
          this.clearBuddyBleReconnect();
          this.startedAt = Date.now();
          this.progress("connected");
          this.onBleConnectedClr();
        } else if (state === "ready") {
          this.reconnectAttempts = 0;
          this.progress("ble_ready");
        } else {
          this.reconnectAttempts = 0;
          this.progress("disconnected");
          this.onBleDisconnectedClr();
        }
      },
      scheduleReconnect: () => {
        this.reconnectAttempts = 0;
        this.scheduleBuddyBleReconnect();
      },
      onReportState: (s, n) => {
        this.progress(`ble_state:${s}${n ? `:${n}` : ""}`);
      },
    });
    return { ok: true, state: applied ?? state };
  }

  /**
   * Official BuddyBleTransport.rx → AX/Ilr residual.
   * Parses JSON ack to resolve rm waiters; cmd lines optional progress.
   */
  async bleRx(payload: unknown): Promise<{ ok: true; received: unknown }> {
    applyBuddyBleRxLineResidual(payload, this.pendingAcks, (msg) => {
      const cmd = typeof msg.cmd === "string" ? msg.cmd : "cmd";
      this.progress(`ble_rx:${cmd}`);
    });
    return { ok: true, received: payload };
  }

  isScanInFlight(): boolean {
    return this.scanInFlight;
  }
}

let singleton: HardwareBuddyService | null = null;

export function getHardwareBuddyService(): HardwareBuddyService {
  if (!singleton) singleton = new HardwareBuddyService();
  return singleton;
}
