import { describe, expect, it, vi } from "vitest";
import {
  cancelPendingRestart,
  clearPendingRestartCanceler,
  hasPendingRestart,
  setPendingRestartCanceler,
} from "./pendingRestart";

describe("pendingRestart residual sb/N2", () => {
  it("cancelPendingRestart invokes canceler once", () => {
    const spy = vi.fn();
    setPendingRestartCanceler(spy);
    expect(hasPendingRestart()).toBe(true);
    cancelPendingRestart();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(hasPendingRestart()).toBe(false);
    cancelPendingRestart();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("setPendingRestartCanceler replaces previous (R2A sb first)", () => {
    const first = vi.fn();
    const second = vi.fn();
    setPendingRestartCanceler(first);
    setPendingRestartCanceler(second);
    expect(first).toHaveBeenCalledTimes(1);
    cancelPendingRestart();
    expect(second).toHaveBeenCalledTimes(1);
    clearPendingRestartCanceler();
  });
});
