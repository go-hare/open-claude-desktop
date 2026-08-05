/**
 * Official buddy BLE host→device TX residual (app.asar Yq / rm / Clr / Ilr).
 *
 * - Yq(line): only when connected + dispatchTx + mainView alive
 * - rm(line, ack, timeout): wait device ack JSON {ack,ok,data?}
 * - Clr(connected): owner optional + time sync line
 * - setName: {cmd:"name", name}
 * - aat: {cmd:"unpair"} before disconnect when py
 *
 * Never invents write/ack success without dispatchTx + device ack.
 *
 * data-official-source: app.asar Yq / rm / Clr / Elr / aat / setName
 */

export type BuddyBleAckResult = {
  ack: string;
  ok: boolean;
  n: number;
  data?: unknown;
  error?: unknown;
};

export type BuddyBlePendingAck = {
  resolve: (value: BuddyBleAckResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Official time sync residual after BLE connected. */
export function buildBuddyBleTimeSyncLine(now = new Date()): string {
  return JSON.stringify({
    time: [Math.floor(now.getTime() / 1000), -now.getTimezoneOffset() * 60],
  });
}

export function buildBuddyBleNameCmd(name: string): string {
  return JSON.stringify({ cmd: "name", name: name.slice(0, 20) });
}

export function buildBuddyBleUnpairCmd(): string {
  return JSON.stringify({ cmd: "unpair" });
}

export function buildBuddyBleStatusCmd(): string {
  return JSON.stringify({ cmd: "status" });
}

export function buildBuddyBleOwnerCmd(firstName: string): string {
  return JSON.stringify({ cmd: "owner", name: firstName.slice(0, 20) });
}

/**
 * Official Ilr residual body for one RX line:
 *   JSON.parse → if ack → resolve pending; else if cmd → optional sink.
 * Returns parsed ack key when resolved, or null.
 */
export function applyBuddyBleRxLineResidual(
  line: unknown,
  pending: Map<string, BuddyBlePendingAck>,
  onCmd?: (msg: Record<string, unknown>) => void,
): "ack" | "cmd" | "ignore" {
  if (typeof line !== "string" || !line.trim()) return "ignore";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return "ignore";
  }
  if (!parsed || typeof parsed !== "object") return "ignore";
  if (typeof parsed.ack === "string" && parsed.ack) {
    const wait = pending.get(parsed.ack);
    if (wait) {
      pending.delete(parsed.ack);
      clearTimeout(wait.timer);
      wait.resolve({
        ack: parsed.ack,
        ok: Boolean(parsed.ok),
        n: typeof parsed.n === "number" ? parsed.n : 0,
        data: parsed.data,
        error: parsed.error,
      });
      return "ack";
    }
    return "ignore";
  }
  if (typeof parsed.cmd === "string" && parsed.cmd) {
    onCmd?.(parsed);
    return "cmd";
  }
  return "ignore";
}

/**
 * Official Yq gate residual (pure): need connected + dispatcher + mainView alive.
 */
export function canBuddyBleDispatchTx(opts: {
  connected: boolean;
  hasDispatcher: boolean;
  mainViewAlive: boolean;
}): boolean {
  return opts.connected && opts.hasDispatcher && opts.mainViewAlive;
}
