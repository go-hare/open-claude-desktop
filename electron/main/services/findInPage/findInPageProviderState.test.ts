import { describe, expect, it, vi } from "vitest";
import {
  clearPendingFindResults,
  getFindInPageProviderState,
  reportFindResult,
  setFindProviderActive,
} from "./findInPageProviderState";

describe("findInPageProviderState residual", () => {
  it("reportFindResult resolves matching requestId", () => {
    const owner = {};
    const state = getFindInPageProviderState(owner);
    const spy = vi.fn();
    state.pending.set(7, spy);
    expect(reportFindResult(state, 7, { activeIndex: 2, total: 5 })).toBe(true);
    expect(spy).toHaveBeenCalledWith({ activeIndex: 2, total: 5 });
    expect(state.pending.has(7)).toBe(false);
  });

  it("setProviderActive false clears pending with empty result", () => {
    const owner = {};
    const state = getFindInPageProviderState(owner);
    const spy = vi.fn();
    state.pending.set(1, spy);
    const stop = vi.fn();
    setFindProviderActive(state, false, stop);
    expect(stop).toHaveBeenCalled();
    expect(state.active).toBe(false);
    expect(spy).toHaveBeenCalledWith({ activeIndex: 0, total: 0 });
    expect(state.pending.size).toBe(0);
  });

  it("clearPendingFindResults empties map", () => {
    const owner = {};
    const state = getFindInPageProviderState(owner);
    const spy = vi.fn();
    state.pending.set(3, spy);
    clearPendingFindResults(state);
    expect(spy).toHaveBeenCalledWith({ activeIndex: 0, total: 0 });
    expect(state.pending.size).toBe(0);
  });
});
