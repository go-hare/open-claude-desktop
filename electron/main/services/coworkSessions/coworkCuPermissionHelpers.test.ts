import { expect, it } from "vitest";
import {
  COWORK_DISPATCH_CU_GRANT_TTL_MS,
  isCoworkSessionTurnAborted,
  mergeCoworkCuPermissionWriteBack,
  pruneCoworkCuAllowedAppsByTtl,
  pruneCoworkSessionCuGrantsOnTurnStart,
} from "./coworkCuPermissionHelpers";
import type {
  CoworkCuAllowedApp,
  CoworkCuGrantFlags,
} from "./coworkSessionTypes";

const flags = (
  partial: Partial<CoworkCuGrantFlags> = {},
): CoworkCuGrantFlags => ({
  clipboardRead: false,
  clipboardWrite: false,
  systemKeyCombos: false,
  ...partial,
});

const app = (
  bundleId: string,
  grantedAt: number,
  displayName = bundleId,
): CoworkCuAllowedApp => ({
  bundleId,
  displayName,
  grantedAt,
});

it("BTi default TTL is 1800*1e3", () => {
  expect(COWORK_DISPATCH_CU_GRANT_TTL_MS).toBe(1_800_000);
});

it("pwe pruneCoworkCuAllowedAppsByTtl keeps all when none expired", () => {
  const now = 10_000_000;
  const apps = [app("a", now - 1000), app("b", now - 500)];
  const out = pruneCoworkCuAllowedAppsByTtl(apps, now, 5_000);
  expect(out).toEqual(apps);
  // isolation: filter path vs keep-all both copy
  expect(out).not.toBe(apps);
});

it("pwe filters only when some grant is expired", () => {
  const now = 10_000_000;
  const ttl = 5_000;
  const fresh = app("fresh", now - 1_000);
  const expired = app("old", now - 10_000);
  const out = pruneCoworkCuAllowedAppsByTtl([fresh, expired], now, ttl);
  expect(out).toEqual([fresh]);
});

it("pwe keep-all when boundary is exclusive (A-grantedAt >= t)", () => {
  const now = 10_000;
  const ttl = 1_000;
  // age == ttl → expired (≥)
  const boundary = app("edge", now - ttl);
  const younger = app("ok", now - ttl + 1);
  expect(pruneCoworkCuAllowedAppsByTtl([boundary, younger], now, ttl)).toEqual([
    younger,
  ]);
});

it("cXi mergeCoworkCuPermissionWriteBack Map parent-first + OR flags", () => {
  const parentApp = app("com.parent", 1, "Parent");
  const childSame = app("com.parent", 99, "ChildSame");
  const childNew = app("com.child", 2, "Child");
  const parent = {
    cuAllowedApps: [parentApp],
    cuGrantFlags: flags({ clipboardRead: true }),
  };
  const merged = mergeCoworkCuPermissionWriteBack(
    parent,
    [childSame, childNew],
    flags({ clipboardWrite: true, systemKeyCombos: true }),
  );
  // parent bundle wins (Map already has key → skip child)
  expect(merged.cuAllowedApps).toEqual([parentApp, childNew]);
  expect(merged.cuGrantFlags).toEqual({
    clipboardRead: true,
    clipboardWrite: true,
    systemKeyCombos: true,
  });
});

it("cXi missing parent flags treat as false before OR", () => {
  const merged = mergeCoworkCuPermissionWriteBack(
    {},
    [app("x", 1)],
    flags({ clipboardRead: true }),
  );
  expect(merged.cuAllowedApps).toEqual([app("x", 1)]);
  expect(merged.cuGrantFlags).toEqual({
    clipboardRead: true,
    clipboardWrite: false,
    systemKeyCombos: false,
  });
});

it("lifecycle prune only for agent/dispatch_child with non-empty apps", () => {
  const now = 1_000_000;
  const ttl = 100;
  const session = {
    sessionType: "dispatch_child" as const,
    cuAllowedApps: [app("a", now - 200), app("b", now - 10)],
  };
  expect(pruneCoworkSessionCuGrantsOnTurnStart(session, now, ttl)).toBe(1);
  expect(session.cuAllowedApps).toEqual([app("b", now - 10)]);

  const plain = {
    sessionType: "scheduled" as const,
    cuAllowedApps: [app("a", now - 200)],
  };
  expect(pruneCoworkSessionCuGrantsOnTurnStart(plain, now, ttl)).toBe(0);
  expect(plain.cuAllowedApps).toHaveLength(1);

  const empty = {
    sessionType: "agent" as const,
    cuAllowedApps: [] as CoworkCuAllowedApp[],
  };
  expect(pruneCoworkSessionCuGrantsOnTurnStart(empty, now, ttl)).toBe(0);
});

it("isCoworkSessionTurnAborted matches official CU isAborted inject", () => {
  // Official: _turnInterruptRequested===true || lifecycleState!=="running"
  // Missing session → true (undefined lifecycle !== "running").
  expect(isCoworkSessionTurnAborted(undefined)).toBe(true);
  expect(isCoworkSessionTurnAborted(null)).toBe(true);
  expect(isCoworkSessionTurnAborted({ lifecycleState: "running" })).toBe(false);
  expect(
    isCoworkSessionTurnAborted({
      lifecycleState: "running",
      _turnInterruptRequested: true,
    }),
  ).toBe(true);
  expect(isCoworkSessionTurnAborted({ lifecycleState: "idle" })).toBe(true);
  expect(isCoworkSessionTurnAborted({ lifecycleState: "stopping" })).toBe(true);
  expect(
    isCoworkSessionTurnAborted({
      lifecycleState: "idle",
      _turnInterruptRequested: false,
    }),
  ).toBe(true);
});
