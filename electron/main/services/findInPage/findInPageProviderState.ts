/**
 * Official FindInPageProvider residual (app.asar ecr / NtA / lmA / icr):
 *
 *   setProviderActive(t) {
 *     e.webContents.stopFindInPage("clearSelection");
 *     A.active = t;
 *     if (!t) lmA(A); // resolve all pending with {activeIndex:0,total:0}
 *   }
 *   reportFindResult(t, i) {
 *     const r = A.pending.get(t);
 *     if (r) { A.pending.delete(t); r(i); }
 *   }
 *
 * Product wires the pending map for provider-active custom find path.
 * Electron native found-in-page path remains the default when provider inactive.
 *
 * data-official-source: app.asar index.js ecr / setProviderActive / reportFindResult
 */

export type FindInPageResult = {
  activeIndex: number;
  total: number;
};

type PendingResolver = (result: FindInPageResult) => void;

export type FindInPageProviderState = {
  active: boolean;
  nextRequestId: number;
  pending: Map<number, PendingResolver>;
};

const states = new WeakMap<object, FindInPageProviderState>();

export function getFindInPageProviderState(owner: object): FindInPageProviderState {
  let state = states.get(owner);
  if (!state) {
    state = { active: false, nextRequestId: 1, pending: new Map() };
    states.set(owner, state);
  }
  return state;
}

/** Official lmA — fail all pending with empty result. */
export function clearPendingFindResults(state: FindInPageProviderState): void {
  for (const resolve of state.pending.values()) {
    resolve({ activeIndex: 0, total: 0 });
  }
  state.pending.clear();
}

export function setFindProviderActive(
  state: FindInPageProviderState,
  active: boolean,
  stopFind: () => void,
): void {
  try {
    stopFind();
  } catch {
    /* webContents may be destroyed */
  }
  state.active = active;
  if (!active) clearPendingFindResults(state);
}

export function reportFindResult(
  state: FindInPageProviderState,
  requestId: number,
  result: unknown,
): boolean {
  const resolve = state.pending.get(requestId);
  if (!resolve) return false;
  state.pending.delete(requestId);
  const bag =
    typeof result === "object" && result !== null
      ? (result as Record<string, unknown>)
      : {};
  const activeIndex =
    typeof bag.activeIndex === "number"
      ? bag.activeIndex
      : typeof bag.activeMatchOrdinal === "number"
        ? bag.activeMatchOrdinal
        : 0;
  const total =
    typeof bag.total === "number"
      ? bag.total
      : typeof bag.matches === "number"
        ? bag.matches
        : 0;
  resolve({ activeIndex, total });
  return true;
}

export function registerPendingFind(
  state: FindInPageProviderState,
  resolve: PendingResolver,
): number {
  const id = state.nextRequestId++;
  state.pending.set(id, resolve);
  return id;
}
