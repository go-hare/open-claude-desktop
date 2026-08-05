import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureSessionsBridgeLifecycle,
  isSessionsBridgeGateOn,
  reconcileSessionsBridge,
  resetSessionsBridgeLifecycleForTests,
  setSessionsBridgeFeatureGate,
  setSessionsBridgeForceGate,
  startSessionsBridgeIfEligible,
} from "./sessionsBridgeLifecycle";
import {
  setShouldEnableSessionsBridgeForTests,
  resetSessionsBridgeStatusForTests,
  updateBridgeStateEntry,
} from "./sessionsBridgeResidual";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("sessionsBridgeLifecycle residual (nTA/lIr)", () => {
  const roots: string[] = [];

  afterEach(() => {
    resetSessionsBridgeLifecycleForTests();
    resetSessionsBridgeStatusForTests();
    setShouldEnableSessionsBridgeForTests(null);
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
    roots.length = 0;
  });

  it("gate off skips nTA start", async () => {
    setSessionsBridgeFeatureGate(false);
    setShouldEnableSessionsBridgeForTests(true);
    const startClient = vi.fn();
    configureSessionsBridgeLifecycle({
      getIdentity: () => ({ orgUuid: "o", accountUuid: "a" }),
      startClient: startClient as never,
      getClient: () => null,
    });
    await startSessionsBridgeIfEligible();
    expect(startClient).not.toHaveBeenCalled();
    expect(isSessionsBridgeGateOn()).toBe(false);
  });

  it("shouldEnable false skips even when gate on", async () => {
    setSessionsBridgeForceGate(true);
    setShouldEnableSessionsBridgeForTests(false);
    const startClient = vi.fn();
    configureSessionsBridgeLifecycle({
      getIdentity: () => ({ orgUuid: "o", accountUuid: "a" }),
      startClient: startClient as never,
      getClient: () => null,
    });
    await startSessionsBridgeIfEligible();
    expect(startClient).not.toHaveBeenCalled();
  });

  it("gate + shouldEnable + consent starts client", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-life-"));
    roots.push(userData);
    setSessionsBridgeForceGate(true);
    setShouldEnableSessionsBridgeForTests(true);
    await updateBridgeStateEntry(
      "o",
      "a",
      (s) => ({ ...s, userConsented: true, enabled: true }),
      userData,
    );
    const startClient = vi.fn(() => {
      const client = {
        startFailed: false,
        disposed: false,
        orgUuid: "o",
        accountUuid: "a",
        on: vi.fn(),
      };
      return client as never;
    });
    configureSessionsBridgeLifecycle({
      getIdentity: () => ({ orgUuid: "o", accountUuid: "a" }),
      startClient: startClient as never,
      getClient: () => null,
      userDataDir: userData,
    });
    await reconcileSessionsBridge();
    expect(startClient).toHaveBeenCalled();
  });

  it("enabled false disposes client", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-life-"));
    roots.push(userData);
    setSessionsBridgeForceGate(true);
    setShouldEnableSessionsBridgeForTests(true);
    await updateBridgeStateEntry(
      "o",
      "a",
      (s) => ({ ...s, userConsented: true, enabled: false }),
      userData,
    );
    const disposeClient = vi.fn(async () => undefined);
    const fake = {
      startFailed: false,
      disposed: false,
      orgUuid: "o",
      accountUuid: "a",
    };
    configureSessionsBridgeLifecycle({
      getIdentity: () => ({ orgUuid: "o", accountUuid: "a" }),
      getClient: () => fake as never,
      disposeClient,
      userDataDir: userData,
    });
    await reconcileSessionsBridge();
    expect(disposeClient).toHaveBeenCalled();
  });
});
