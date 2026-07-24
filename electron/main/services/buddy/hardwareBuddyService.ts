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
import { app, dialog, type BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

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

const MAX_FOLDER_BYTES = 8 * 1024 * 1024;
const MAX_FOLDER_FILES = 200;

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

async function walkFolder(
  root: string,
): Promise<{ files: string[]; totalBytes: number }> {
  const files: string[] = [];
  let totalBytes = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const st = await fs.stat(full);
        totalBytes += st.size;
        files.push(path.relative(root, full));
        if (files.length > MAX_FOLDER_FILES || totalBytes > MAX_FOLDER_BYTES) {
          throw new Error("folder too large");
        }
      }
    }
  }

  await walk(root);
  if (files.length === 0) throw new Error("empty folder");
  return { files, totalBytes };
}

function defaultDeviceStatus(paired: BuddyPairedDevice, connected: boolean): BuddyDeviceStatus {
  const uptimeSec = Math.floor(process.uptime());
  return {
    name: paired.name,
    owner: undefined,
    sec: connected,
    bat: {
      pct: connected ? 87 : 0,
      mV: connected ? 4120 : 0,
      mA: connected ? 0 : 0,
      usb: false,
    },
    sys: {
      up: uptimeSec,
      heap: 48_000,
      fsFree: 1_200_000,
      fsTotal: 2_000_000,
    },
    stats: {
      appr: 12,
      deny: 1,
      vel: 3,
      nap: 0,
      lvl: 2,
    },
  };
}

/**
 * Local/sim residual for Hardware Buddy IPC.
 * When `CLAUDE_BUDDY_MOCK_DEVICES=1`, scan returns a demo stick so the full UI flow is exercisable without BLE.
 */
export class HardwareBuddyService {
  private paired: BuddyPairedDevice | null = null;
  private connected = false;
  private loaded = false;
  private scanInFlight = false;
  private scanFound = new Map<string, string>();
  private installInFlight = false;
  private startedAt = Date.now();
  private onProgress: ProgressSink | null = null;
  private onPairingPrompt: PairingPromptSink | null = null;
  private pendingPinResolve: ((pin: string | null) => void) | null = null;

  setProgressSink(sink: ProgressSink | null): void {
    this.onProgress = sink;
  }

  setPairingPromptSink(sink: PairingPromptSink | null): void {
    this.onPairingPrompt = sink;
  }

  private progress(msg: string): void {
    this.onProgress?.(msg);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const state = await readJsonFile<BuddyStateFile>(statePath(), { paired: null });
    this.paired = state.paired && typeof state.paired.id === "string" && typeof state.paired.name === "string"
      ? { id: state.paired.id, name: state.paired.name }
      : null;
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

  async deviceStatus(): Promise<BuddyDeviceStatus | null> {
    await this.ensureLoaded();
    if (!this.connected || !this.paired) return null;
    const base = defaultDeviceStatus(this.paired, true);
    base.sys.up = Math.floor((Date.now() - this.startedAt) / 1000);
    // tokens-today residual (official buddy-tokens store)
    const tokens = await readJsonFile<{ date: string; tokens: number }>(tokensPath(), { date: "", tokens: 0 });
    const today = todayKey();
    const tokensToday = tokens.date === today ? tokens.tokens : 0;
    // surface level from light activity; keep official stats keys only
    base.stats.lvl = Math.min(99, 1 + Math.floor(tokensToday / 10_000));
    return base;
  }

  /** Official oat: reconnect already-paired stick; returns boolean. */
  async pairDevice(): Promise<boolean> {
    await this.ensureLoaded();
    if (!this.paired) return false;
    // Sim: mark connected (official would execute window.buddyBle.pair()).
    this.connected = true;
    this.startedAt = Date.now();
    this.progress("connected");
    return true;
  }

  /** Official Alr: scan nearby sticks → {id,name}[]. */
  async scanDevices(): Promise<BuddyPairedDevice[]> {
    await this.ensureLoaded();
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

    // No BLE bridge: empty scan (shape-correct). Pair via mock env if needed.
    await new Promise((r) => setTimeout(r, 500));
    this.scanInFlight = false;
    return [...this.scanFound].map(([id, name]) => ({ id, name }));
  }

  /** Official elr(id): user picked device from picker. */
  async pickDevice(deviceId: string): Promise<boolean> {
    await this.ensureLoaded();
    const name = this.scanFound.get(deviceId);
    if (!name && process.env.CLAUDE_BUDDY_MOCK_DEVICES !== "1") {
      // Allow picking only known scan results unless mock invents name.
      return false;
    }
    const deviceName = name ?? `Buddy ${deviceId.slice(0, 6)}`;
    this.paired = { id: deviceId, name: deviceName };
    await this.persistPaired();
    this.scanInFlight = false;

    // Official passkey path: pairingPrompt → submitPin. Sim: auto-bond with prompt for UI.
    if (process.env.CLAUDE_BUDDY_MOCK_DEVICES === "1") {
      this.onPairingPrompt?.(deviceName);
      // Wait briefly for pin UI; auto-accept if no pin submitted.
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

    this.connected = true;
    this.startedAt = Date.now();
    this.progress("connected");
    return true;
  }

  async cancelScan(): Promise<void> {
    this.scanInFlight = false;
    this.scanFound.clear();
    if (this.pendingPinResolve) {
      this.pendingPinResolve(null);
      this.pendingPinResolve = null;
    }
  }

  /** Official A0e(pin|null) */
  async submitPin(pin: string | null): Promise<void> {
    if (this.pendingPinResolve) {
      this.pendingPinResolve(pin);
      return;
    }
    // Late pin after auto-connect: ignore / no-op (official clears UtA).
  }

  /** Official aat */
  async forgetDevice(): Promise<void> {
    await this.ensureLoaded();
    this.connected = false;
    this.paired = null;
    await this.persistPaired();
    this.progress("forgotten");
  }

  /** Official setName → boolean */
  async setName(name: string): Promise<boolean> {
    await this.ensureLoaded();
    if (!this.connected || !this.paired) return false;
    const next = name.trim().slice(0, 20);
    if (!next) return false;
    this.paired = { ...this.paired, name: next };
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

      const inv = await walkFolder(folderPath);
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

  /** Official install(folderPath): throws; progress via sink. */
  async install(folderPath: string): Promise<void> {
    if (this.installInFlight) throw new Error("install already in progress");
    await this.ensureLoaded();
    if (!this.connected) throw new Error("device: not connected");

    this.installInFlight = true;
    try {
      const inv = await walkFolder(folderPath);
      const name = path.basename(folderPath);
      let done = 0;
      for (const file of inv.files) {
        const st = await fs.stat(path.join(folderPath, file));
        done += st.size;
        const pct = Math.min(100, Math.round((done / Math.max(1, inv.totalBytes)) * 100));
        this.progress(`uploading ${file} — ${pct}% (${Math.round(done / 1024)}KB)`);
        await new Promise((r) => setTimeout(r, 20));
      }
      this.progress(`✓ sent ${name} (${Math.round(inv.totalBytes / 1024)}KB)`);

      // bump tokens-today residual lightly
      const tokens = await readJsonFile<{ date: string; tokens: number }>(tokensPath(), { date: "", tokens: 0 });
      const today = todayKey();
      const next = tokens.date === today ? tokens.tokens + inv.totalBytes : inv.totalBytes;
      await writeJsonFile(tokensPath(), { date: today, tokens: next });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.progress(`✗ ${message}`);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      this.installInFlight = false;
    }
  }

  /** BuddyBleTransport residual — accept reports without real radio. */
  async reportBleState(state: unknown): Promise<{ ok: true; state: unknown }> {
    const text = String(state ?? "");
    if (text === "connected" || text === "ready") {
      this.connected = true;
    } else if (text === "disconnected") {
      this.connected = false;
    }
    return { ok: true, state };
  }

  async bleRx(_payload: unknown): Promise<{ ok: true; received: unknown }> {
    return { ok: true, received: _payload };
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
