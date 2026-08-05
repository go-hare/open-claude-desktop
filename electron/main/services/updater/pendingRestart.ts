/**
 * Official updater-guard residual (app.asar):
 *
 *   let N2;
 *   function R2A(e, A) {
 *     sb();
 *     if (uG(e) === 0) { A(); return; }
 *     const t = (i) => {
 *       if (i.type !== "message" && uG(e) === 0) { sb(); A(); }
 *     };
 *     for (const i of e) i.on("event", t);
 *     N2 = () => { for (const i of e) i.off("event", t); };
 *   }
 *   function sb() { N2?.(); N2 = undefined; }
 *   cancelPendingRestart: sb
 *
 * Product: track a single canceler; cancelPendingRestart clears deferred restart.
 * restartToUpdateWhenIdle wires schedule via setPendingRestartCanceler.
 *
 * data-official-source: app.asar index.js sb / R2A / cancelPendingRestart
 */

let pendingCanceler: (() => void) | undefined;

export function cancelPendingRestart(): void {
  try {
    pendingCanceler?.();
  } finally {
    pendingCanceler = undefined;
  }
}

export function hasPendingRestart(): boolean {
  return typeof pendingCanceler === "function";
}

/**
 * Install deferred-restart canceler (N2 residual).
 * Replaces any previous canceler (R2A calls sb first).
 */
export function setPendingRestartCanceler(canceler: (() => void) | undefined): void {
  cancelPendingRestart();
  pendingCanceler = canceler;
}

/** Clear without invoking (after successful restart path). */
export function clearPendingRestartCanceler(): void {
  pendingCanceler = undefined;
}
