import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureSessionsBridgePss,
  createBridgeTurnPssAssertion,
  releaseBridgeTurnPssAssertion,
  releaseBridgeTurnPssAssertions,
  resetSessionsBridgePssForTests,
} from "./sessionsBridgePss";

describe("sessionsBridgePss residual", () => {
  afterEach(() => {
    resetSessionsBridgePssForTests();
  });

  it("prefers native createPreventSystemSleepAssertion when isReady", () => {
    const create = vi.fn(() => 42);
    const release = vi.fn();
    const setChainActive = vi.fn();
    configureSessionsBridgePss({
      getNative: () => ({
        isReady: () => true,
        createPreventSystemSleepAssertion: create,
        releaseAssertion: release,
      }),
      setChainActive,
      powerSaveStart: vi.fn(() => 99),
    });
    const id = createBridgeTurnPssAssertion("bridge_turn:test");
    expect(id).toBe(42);
    expect(create).toHaveBeenCalledWith("bridge_turn:test");
    expect(setChainActive).toHaveBeenCalledWith(true);
    releaseBridgeTurnPssAssertion(id);
    expect(release).toHaveBeenCalledWith(42);
  });

  it("falls back to powerSaveBlocker when native not ready", () => {
    const start = vi.fn(() => 7);
    const stop = vi.fn();
    const isStarted = vi.fn(() => true);
    configureSessionsBridgePss({
      getNative: () => ({
        isReady: () => false,
        createPreventSystemSleepAssertion: vi.fn(() => 1),
      }),
      powerSaveStart: start,
      powerSaveStop: stop,
      powerSaveIsStarted: isStarted,
    });
    const id = createBridgeTurnPssAssertion();
    expect(id).toBe(7);
    expect(start).toHaveBeenCalledWith("prevent-app-suspension");
    releaseBridgeTurnPssAssertion(id);
    expect(stop).toHaveBeenCalledWith(7);
  });

  it("returns 0 when native and powerSave unavailable", () => {
    configureSessionsBridgePss({
      getNative: () => null,
      powerSaveStart: () => {
        throw new Error("no electron");
      },
    });
    expect(createBridgeTurnPssAssertion()).toBe(0);
  });

  it("releaseBridgeTurnPssAssertions clears held and Gle(false) when no other held", () => {
    const setChainActive = vi.fn();
    const stop = vi.fn();
    configureSessionsBridgePss({
      setChainActive,
      powerSaveStart: vi.fn(() => 3),
      powerSaveStop: stop,
      powerSaveIsStarted: () => true,
    });
    const held = [createBridgeTurnPssAssertion(), createBridgeTurnPssAssertion()];
    expect(held).toEqual([3, 3]);
    releaseBridgeTurnPssAssertions(held, () => false);
    expect(held).toEqual([]);
    expect(setChainActive).toHaveBeenLastCalledWith(false);
  });

  it("keeps chainActive when anyOtherHeld returns true", () => {
    const setChainActive = vi.fn();
    configureSessionsBridgePss({
      setChainActive,
      powerSaveStart: vi.fn(() => 11),
      powerSaveStop: vi.fn(),
      powerSaveIsStarted: () => true,
    });
    const held = [createBridgeTurnPssAssertion()];
    releaseBridgeTurnPssAssertions(held, () => true);
    expect(setChainActive).toHaveBeenCalledWith(true);
    // no Gle(false)
    expect(setChainActive.mock.calls.filter((c) => c[0] === false)).toHaveLength(
      0,
    );
  });

  it("releaseAssertion no-ops on id 0", () => {
    const release = vi.fn();
    configureSessionsBridgePss({
      getNative: () => ({
        isReady: () => true,
        releaseAssertion: release,
      }),
    });
    releaseBridgeTurnPssAssertion(0);
    expect(release).not.toHaveBeenCalled();
  });
});
