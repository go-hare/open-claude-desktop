import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bridgeLocalSessionId,
  bridgeStateKey,
  deleteBridgeSessionResidual,
  getBridgeConsent,
  getBridgeStateEntry,
  getSessionsBridgeEnabled,
  getSessionsBridgeStatusState,
  identityFromSettingsPrefs,
  kickBridgePollResidual,
  patchSessionsBridgeStatus,
  resetSessionsBridgeStatusForTests,
  setSessionsBridgeEnabled,
  setSessionsBridgeStatusListener,
  setShouldEnableSessionsBridgeForTests,
  shouldEnableSessionsBridge,
  updateBridgeStateEntry,
} from "./sessionsBridgeResidual";

describe("sessionsBridgeResidual shell 1:1 (yit/QcA/custom-3p + 1p)", () => {
  const roots: string[] = [];

  afterEach(() => {
    resetSessionsBridgeStatusForTests();
    setShouldEnableSessionsBridgeForTests(null);
    for (const r of roots) {
      fs.rmSync(r, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  function tempUserData(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-state-"));
    roots.push(dir);
    return dir;
  }

  it("yit default status is conflict+dispatchAgentName only (no invent reason)", () => {
    const s = getSessionsBridgeStatusState();
    expect(s).toEqual({ conflict: false, dispatchAgentName: null });
    expect("reason" in s).toBe(false);
    expect("status" in s).toBe(false);
    expect("enabled" in s).toBe(false);
  });

  it("bridgeLocalSessionId matches p5 residual", () => {
    expect(bridgeLocalSessionId("org-a")).toBe("local_ditto_org-a");
    expect(bridgeLocalSessionId("org-a", 0)).toBe("local_ditto_org-a");
    expect(bridgeLocalSessionId("org-a", 2)).toBe("local_ditto_org-a_g2");
  });

  it("custom-3p residual: shouldEnable false → consent true, enabled true", async () => {
    setShouldEnableSessionsBridgeForTests(false);
    expect(shouldEnableSessionsBridge()).toBe(false);
    const id = { orgUuid: null, accountUuid: null };
    await expect(getBridgeConsent(id)).resolves.toBe(true);
    await expect(getSessionsBridgeEnabled(id)).resolves.toBe(true);
  });

  it("1p residual: shouldEnable true without identity → consent false, enabled true", async () => {
    setShouldEnableSessionsBridgeForTests(true);
    await expect(
      getBridgeConsent({ orgUuid: null, accountUuid: null }),
    ).resolves.toBe(false);
    await expect(
      getSessionsBridgeEnabled({ orgUuid: null, accountUuid: null }),
    ).resolves.toBe(true);
  });

  it("1p getBridgeConsent reads userConsented from bridge-state", async () => {
    setShouldEnableSessionsBridgeForTests(true);
    const userData = tempUserData();
    const id = { orgUuid: "org-1", accountUuid: "acct-1" };
    await expect(getBridgeConsent(id, userData)).resolves.toBe(false);
    await updateBridgeStateEntry(
      "org-1",
      "acct-1",
      (s) => ({ ...s, userConsented: true }),
      userData,
    );
    await expect(getBridgeConsent(id, userData)).resolves.toBe(true);
  });

  it("getBridgeConsent returns boolean not invent bag", async () => {
    setShouldEnableSessionsBridgeForTests(false);
    const v = await getBridgeConsent({ orgUuid: "o", accountUuid: "a" });
    expect(typeof v).toBe("boolean");
    expect(v).toBe(true);
  });

  it("setSessionsBridgeEnabled writes bridge-state.json when identity present", async () => {
    setShouldEnableSessionsBridgeForTests(false);
    const userData = tempUserData();
    const id = { orgUuid: "org-1", accountUuid: "acct-1" };
    await setSessionsBridgeEnabled(id, false, userData);
    const file = path.join(userData, "bridge-state.json");
    expect(fs.existsSync(file)).toBe(true);
    const bag = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      { enabled?: boolean }
    >;
    expect(bag[bridgeStateKey("org-1", "acct-1")].enabled).toBe(false);

    // shouldEnable false → getSessionsBridgeEnabled still true (custom-3p stub)
    await expect(getSessionsBridgeEnabled(id, userData)).resolves.toBe(true);
  });

  it("1p getSessionsBridgeEnabled respects enabled flag", async () => {
    setShouldEnableSessionsBridgeForTests(true);
    const userData = tempUserData();
    const id = { orgUuid: "org-1", accountUuid: "acct-1" };
    await setSessionsBridgeEnabled(id, false, userData);
    await expect(getSessionsBridgeEnabled(id, userData)).resolves.toBe(false);
    await setSessionsBridgeEnabled(id, true, userData);
    await expect(getSessionsBridgeEnabled(id, userData)).resolves.toBe(true);
  });

  it("set without identity is no-op write", async () => {
    const userData = tempUserData();
    await setSessionsBridgeEnabled(
      { orgUuid: null, accountUuid: null },
      true,
      userData,
    );
    expect(fs.existsSync(path.join(userData, "bridge-state.json"))).toBe(false);
  });

  it("get/update BridgeStateEntry persists environmentId/remoteSessionId", async () => {
    const userData = tempUserData();
    await updateBridgeStateEntry(
      "o",
      "a",
      (s) => ({
        ...s,
        environmentId: "env-x",
        remoteSessionId: "rs-1",
      }),
      userData,
    );
    const entry = await getBridgeStateEntry("o", "a", userData);
    expect(entry.environmentId).toBe("env-x");
    expect(entry.remoteSessionId).toBe("rs-1");
  });

  it("deleteBridgeSession residual false without client", async () => {
    await expect(deleteBridgeSessionResidual()).resolves.toBe(false);
  });

  it("kick/void ops resolve without soft-true ready invent", async () => {
    await expect(kickBridgePollResidual()).resolves.toBeUndefined();
  });

  it("status listener receives SD patches; invent keys stripped", () => {
    const seen: unknown[] = [];
    setSessionsBridgeStatusListener((s) => seen.push(s));
    patchSessionsBridgeStatus({
      dispatchAgentName: "Agent",
      status: "ready",
      reason: "x",
    } as never);
    expect(seen).toEqual([
      { conflict: false, dispatchAgentName: "Agent" },
    ]);
  });

  it("identityFromSettingsPrefs does not invent uuids", () => {
    expect(identityFromSettingsPrefs({})).toEqual({
      accountUuid: null,
      orgUuid: null,
    });
    expect(
      identityFromSettingsPrefs({
        accountUuid: "a",
        organizationUuid: "o",
      }),
    ).toEqual({ accountUuid: "a", orgUuid: "o" });
  });
});
