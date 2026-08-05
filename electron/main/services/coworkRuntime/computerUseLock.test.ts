import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireComputerUseLock,
  checkComputerUseLock,
  computerUseLock,
  getComputerUseEscapeStateForTests,
  handleComputerUseEscapePressed,
  initComputerUseEsc,
  markModelSynthesizedEscape,
  registerComputerUseEscapeShortcut,
  releaseComputerUseLock,
  resetComputerUseEscForTests,
  setComputerUseEscapeShortcutApiForTests,
  setComputerUseLockStopHandler,
  stopComputerUseLockHolder,
  unregisterComputerUseEscapeShortcut,
} from "./computerUseLock";

describe("computerUseLock residual $ki/vc + cu-esc", () => {
  beforeEach(() => {
    resetComputerUseEscForTests();
  });

  afterEach(() => {
    resetComputerUseEscForTests();
  });

  it("acquire first session holds; second is not self", async () => {
    await acquireComputerUseLock("s1");
    await expect(checkComputerUseLock("s1")).resolves.toEqual({
      holder: "s1",
      isSelf: true,
    });
    await expect(checkComputerUseLock("s2")).resolves.toEqual({
      holder: "s1",
      isSelf: false,
    });
    // Second acquire does not steal (official residual).
    await acquireComputerUseLock("s2");
    expect(computerUseLock.currentHolder).toBe("s1");
  });

  it("release only by holder", async () => {
    await acquireComputerUseLock("s1");
    releaseComputerUseLock("s2");
    expect(computerUseLock.currentHolder).toBe("s1");
    releaseComputerUseLock("s1");
    expect(computerUseLock.currentHolder).toBeUndefined();
  });

  it("stopComputerUseLockHolder invokes stop handler", async () => {
    const stopped: string[] = [];
    setComputerUseLockStopHandler((id) => {
      stopped.push(id);
    });
    await acquireComputerUseLock("s1");
    stopComputerUseLockHolder();
    expect(stopped).toEqual(["s1"]);
  });

  it("Xki/Zki/zki: registers Escape only while lock held", async () => {
    const registered: string[] = [];
    const unregistered: string[] = [];
    setComputerUseEscapeShortcutApiForTests({
      register: (accel, _cb) => {
        registered.push(accel);
        return true;
      },
      unregister: (accel) => {
        unregistered.push(accel);
      },
    });
    const stopped: string[] = [];
    initComputerUseEsc((id) => {
      stopped.push(id);
    });
    expect(getComputerUseEscapeStateForTests().registered).toBe(false);

    await acquireComputerUseLock("s1");
    expect(registered).toEqual(["Escape"]);
    expect(getComputerUseEscapeStateForTests().registered).toBe(true);

    releaseComputerUseLock("s1");
    expect(unregistered).toEqual(["Escape"]);
    expect(getComputerUseEscapeStateForTests().registered).toBe(false);
    expect(stopped).toEqual([]);
  });

  it("Wki: Esc stops holder; zv absorbs model-synthesized Escape", async () => {
    const callbacks: Array<() => void> = [];
    setComputerUseEscapeShortcutApiForTests({
      register: (_accel, cb) => {
        callbacks.push(cb);
        return true;
      },
      unregister: () => undefined,
    });
    const stopped: string[] = [];
    initComputerUseEsc((id) => {
      stopped.push(id);
    });
    await acquireComputerUseLock("s1");
    expect(callbacks.length).toBe(1);

    // Model typed Escape → zv absorb, do not stop.
    markModelSynthesizedEscape();
    callbacks[0]!();
    expect(stopped).toEqual([]);

    // Real user Esc → stop holder.
    callbacks[0]!();
    expect(stopped).toEqual(["s1"]);
  });

  it("handleComputerUseEscapePressed drops when no holder", () => {
    const stopped: string[] = [];
    setComputerUseLockStopHandler((id) => stopped.push(id));
    handleComputerUseEscapePressed();
    expect(stopped).toEqual([]);
  });

  it("register returns false does not mark registered", () => {
    setComputerUseEscapeShortcutApiForTests({
      register: () => false,
      unregister: () => undefined,
    });
    registerComputerUseEscapeShortcut();
    expect(getComputerUseEscapeStateForTests().registered).toBe(false);
    unregisterComputerUseEscapeShortcut();
  });
});
