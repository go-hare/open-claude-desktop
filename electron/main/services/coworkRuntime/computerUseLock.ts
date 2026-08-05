/**
 * Official $ki / vc residual (app.asar) + cu-esc residual:
 *   class $ki { check; acquire; release; currentHolder; emit cuLockChanged }
 *   const vc = new $ki
 *   zv()  — model-synthesized Escape absorb counter ($_)
 *   Wki() — Escape globalShortcut handler: absorb or stop holder via x_A
 *   Zki() — register Escape when lock acquired
 *   zki() — unregister Escape when lock released
 *   Xki(e) — init: x_A=e; vc.on("cuLockChanged", holder?Zki:zki)
 *
 * Product Mac: process-wide CU lock for host-loop sessions.
 * Win32 not productized here.
 */
import { EventEmitter } from "node:events";

export type CuLockCheck = {
  holder: string | undefined;
  isSelf: boolean;
};

type CuLockEvents = {
  cuLockChanged: [{ holder: string | undefined }];
};

/**
 * Official $ki residual.
 */
class ComputerUseLockManager extends EventEmitter {
  private holder: string | undefined;

  check(sessionId: string): CuLockCheck {
    return {
      holder: this.holder,
      isSelf: this.holder === sessionId,
    };
  }

  acquire(sessionId: string): void {
    if (this.holder === undefined) {
      this.holder = sessionId;
      this.emit("cuLockChanged", { holder: sessionId });
      // Official UrA() = refreshGrowthBook on acquire — product does not invent GB.
    }
  }

  release(sessionId: string): void {
    if (this.holder === sessionId) {
      this.holder = undefined;
      this.emit("cuLockChanged", { holder: undefined });
    }
  }

  get currentHolder(): string | undefined {
    return this.holder;
  }

  /** Test helper */
  resetForTests(): void {
    this.holder = undefined;
  }
}

/** Official vc singleton residual. */
export const computerUseLock = new ComputerUseLockManager();

/**
 * Official IFi checkCuLock for a session: async () => e.checkCuLock()
 * Product: sync check wrapped async to match bindSessionContext.
 */
export async function checkComputerUseLock(
  sessionId: string,
): Promise<CuLockCheck> {
  return computerUseLock.check(sessionId);
}

/** Official IFi acquireCuLock residual. */
export async function acquireComputerUseLock(sessionId: string): Promise<void> {
  computerUseLock.acquire(sessionId);
}

/** Release on leavingRunning / stop — official releases when session ends holding. */
export function releaseComputerUseLock(sessionId: string): void {
  computerUseLock.release(sessionId);
}

// ─── Official cu-esc residual (zv / Wki / Zki / zki / Xki) ───────────────────

/** Official $_ — Escape absorb counter. */
let escapeAbsorbCounter = 0;
/** Official reA — Escape globalShortcut registered. */
let escapeShortcutRegistered = false;
/** Official x_A — stop holder callback. */
let stopHolder: ((sessionId: string) => void) | null = null;
/** Official Xki once-init guard for cuLockChanged listener. */
let escInitialized = false;

/** Optional injects for unit tests (avoid real globalShortcut). */
type EscapeShortcutApi = {
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
};

let escapeShortcutApi: EscapeShortcutApi | null = null;

function getEscapeShortcutApi(): EscapeShortcutApi {
  if (escapeShortcutApi) return escapeShortcutApi;
  // Lazy require so vitest without electron mock can still import lock helpers.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { globalShortcut } = require("electron") as {
    globalShortcut: EscapeShortcutApi;
  };
  return globalShortcut;
}

/**
 * Official zv residual: model-synthesized Escape should not stop the session.
 * Called from Darwin executor key/holdKey when sequence is Escape/Esc.
 */
export function markModelSynthesizedEscape(): void {
  escapeAbsorbCounter += 1;
  setTimeout(() => {
    if (escapeAbsorbCounter > 0) escapeAbsorbCounter -= 1;
  }, 100);
}

/** @deprecated alias — executor may import markModelEscape name. */
export const markModelEscape = markModelSynthesizedEscape;

/**
 * Official Wki residual (Esc pressed):
 *   if $_>0 → absorb; else stop current holder via x_A.
 */
export function handleComputerUseEscapePressed(): void {
  if (escapeAbsorbCounter > 0) {
    escapeAbsorbCounter -= 1;
    console.debug("[cu-esc] escape absorbed (model-synthesized)");
    return;
  }
  const holder = computerUseLock.currentHolder;
  if (!holder || !stopHolder) {
    console.debug("[cu-esc] escape with no holder, dropping");
    return;
  }
  console.info(`[cu-esc] escape pressed, stopping ${holder}`);
  stopHolder(holder);
}

/** Official Wki alias used by stopComputerUseLockHolder tests / callers. */
export function stopComputerUseLockHolder(): void {
  // Direct stop path (no absorb) — used by tests / programmatic stop.
  // Official Esc path is handleComputerUseEscapePressed (Wki).
  const holder = computerUseLock.currentHolder;
  if (!holder || !stopHolder) return;
  stopHolder(holder);
}

/**
 * Official Zki residual: register Escape globalShortcut while CU lock held.
 */
export function registerComputerUseEscapeShortcut(): void {
  if (escapeShortcutRegistered) return;
  escapeAbsorbCounter = 0;
  try {
    const api = getEscapeShortcutApi();
    const ok = api.register("Escape", handleComputerUseEscapePressed);
    if (!ok) {
      console.warn("[cu-esc] globalShortcut.register returned false");
      return;
    }
    escapeShortcutRegistered = true;
    console.debug("[cu-esc] registered");
  } catch (error) {
    console.warn("[cu-esc] register threw", error);
  }
}

/**
 * Official zki residual: unregister Escape when no CU lock holder.
 */
export function unregisterComputerUseEscapeShortcut(): void {
  if (!escapeShortcutRegistered) return;
  try {
    getEscapeShortcutApi().unregister("Escape");
  } catch (error) {
    console.warn("[cu-esc] unregister threw", error);
  }
  escapeShortcutRegistered = false;
  escapeAbsorbCounter = 0;
  console.debug("[cu-esc] unregistered");
}

/**
 * Official Xki residual: wire stop-holder + register Escape only while lock held.
 * Call once from desktop IPC bootstrap after CoworkSessionManager exists.
 */
export function initComputerUseEsc(
  onStopHolder: (sessionId: string) => void,
): void {
  stopHolder = onStopHolder;
  if (escInitialized) {
    console.info("[cu-esc] re-bound stop handler");
    return;
  }
  escInitialized = true;
  computerUseLock.on("cuLockChanged", ({ holder }: { holder: string | undefined }) => {
    if (holder) registerComputerUseEscapeShortcut();
    else unregisterComputerUseEscapeShortcut();
  });
  // If lock already held (hot reload residual), register immediately.
  if (computerUseLock.currentHolder) {
    registerComputerUseEscapeShortcut();
  }
  console.info("[cu-esc] initialized");
}

/**
 * Optional stop-holder callback setter (official x_A without full Xki).
 * Prefer initComputerUseEsc in production.
 */
export function setComputerUseLockStopHandler(
  handler: ((sessionId: string) => void) | null,
): void {
  stopHolder = handler;
}

/** Test / probe helpers */
export function getComputerUseEscapeStateForTests(): {
  absorbCounter: number;
  registered: boolean;
  initialized: boolean;
  hasStopHandler: boolean;
} {
  return {
    absorbCounter: escapeAbsorbCounter,
    registered: escapeShortcutRegistered,
    initialized: escInitialized,
    hasStopHandler: Boolean(stopHolder),
  };
}

export function setComputerUseEscapeShortcutApiForTests(
  api: EscapeShortcutApi | null,
): void {
  escapeShortcutApi = api;
}

export function resetComputerUseEscForTests(): void {
  if (escapeShortcutRegistered) {
    try {
      getEscapeShortcutApi().unregister("Escape");
    } catch {
      // ignore
    }
  }
  escapeShortcutRegistered = false;
  escapeAbsorbCounter = 0;
  stopHolder = null;
  escInitialized = false;
  escapeShortcutApi = null;
  computerUseLock.removeAllListeners("cuLockChanged");
  computerUseLock.resetForTests();
}

export type { ComputerUseLockManager, CuLockEvents };
