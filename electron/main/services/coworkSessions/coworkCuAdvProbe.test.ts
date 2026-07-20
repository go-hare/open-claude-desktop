import { expect, it } from "vitest";
import {
  COWORK_DISPATCH_CU_GRANT_TTL_MS,
  mergeCoworkCuPermissionWriteBack,
  pruneCoworkCuAllowedAppsByTtl,
  pruneCoworkSessionCuGrantsOnTurnStart,
} from "./coworkCuPermissionHelpers";

const app = (id: string, at: number) => ({
  bundleId: id,
  displayName: id,
  grantedAt: at,
});

it("adversarial pwe exact boundary and keep-all identity", () => {
  const now = 1_000_000;
  const ttl = COWORK_DISPATCH_CU_GRANT_TTL_MS;
  expect(ttl).toBe(1_800_000);
  expect(
    pruneCoworkCuAllowedAppsByTtl([app("e", now - ttl)], now, ttl),
  ).toEqual([]);
  expect(
    pruneCoworkCuAllowedAppsByTtl([app("y", now - ttl + 1)], now, ttl),
  ).toEqual([app("y", now - ttl + 1)]);
  const fresh = [app("a", now), app("b", now - 1)];
  const out = pruneCoworkCuAllowedAppsByTtl(fresh, now, ttl);
  expect(out).toEqual(fresh);
  expect(out).not.toBe(fresh);
  expect(pruneCoworkCuAllowedAppsByTtl([], now, ttl)).toEqual([]);
});

it("adversarial cXi parent Map wins + OR false parent", () => {
  const parent = {
    cuAllowedApps: [app("shared", 1)],
    cuGrantFlags: undefined as undefined,
  };
  const m = mergeCoworkCuPermissionWriteBack(
    parent,
    [app("shared", 99), app("new", 2)],
    {
      clipboardRead: true,
      clipboardWrite: false,
      systemKeyCombos: true,
    },
  );
  expect(m.cuAllowedApps.find((a) => a.bundleId === "shared")?.grantedAt).toBe(
    1,
  );
  expect(m.cuAllowedApps.map((a) => a.bundleId).sort()).toEqual([
    "new",
    "shared",
  ]);
  expect(m.cuGrantFlags).toEqual({
    clipboardRead: true,
    clipboardWrite: false,
    systemKeyCombos: true,
  });
});

it("adversarial lifecycle prune agent vs radar vs empty", () => {
  const now = 10_000;
  const agent = {
    sessionType: "agent",
    cuAllowedApps: [app("old", 0), app("new", 9999)],
  };
  expect(pruneCoworkSessionCuGrantsOnTurnStart(agent, now, 1000)).toBe(1);
  expect(agent.cuAllowedApps).toEqual([app("new", 9999)]);
  const radar = {
    sessionType: "radar",
    cuAllowedApps: [app("old", 0)],
  };
  expect(pruneCoworkSessionCuGrantsOnTurnStart(radar, now, 1000)).toBe(0);
  expect(radar.cuAllowedApps).toHaveLength(1);
});
