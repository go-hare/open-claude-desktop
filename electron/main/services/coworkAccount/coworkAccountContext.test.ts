import { expect, it, vi } from "vitest";
import { CoworkAccountContext } from "./coworkAccountContext";

it("stores the renderer account details and exposes the Cowork identity", () => {
  const context = new CoworkAccountContext({
    loadBootstrapIdentity: async () => ({
      accountUuid: "fallback-account",
      organizationUuid: "org-1",
    }),
  });

  context.setAccountDetails({
    accountUuid: "account-1",
    emailAddress: "user@example.com",
    isLoggedOut: false,
  });

  expect(context.getIdentity()).toBeNull();
  expect(context.getAccountDetails()).toMatchObject({
    emailAddress: "user@example.com",
  });
});

it("subscribe residual notifies on setAccountDetails", () => {
  const context = new CoworkAccountContext();
  const seen: string[] = [];
  const unsub = context.subscribe((details) => {
    seen.push(details.accountUuid ?? "none");
  });
  context.setAccountDetails({
    accountUuid: "a1",
    isLoggedOut: false,
  });
  expect(seen).toEqual(["a1"]);
  unsub();
  context.setAccountDetails({
    accountUuid: "a2",
    isLoggedOut: false,
  });
  expect(seen).toEqual(["a1"]);
});

it("preserves optional isRaven for official K2 (isRaven ?? true)", () => {
  const context = new CoworkAccountContext();
  context.setAccountDetails({
    accountUuid: "account-1",
    isLoggedOut: false,
  });
  expect(context.getAccountDetails()?.isRaven).toBeUndefined();

  context.setAccountDetails({
    accountUuid: "account-1",
    isLoggedOut: false,
    isRaven: false,
  });
  expect(context.getAccountDetails()?.isRaven).toBe(false);

  context.setAccountDetails({
    accountUuid: "account-1",
    isLoggedOut: false,
    isRaven: true,
  });
  expect(context.getAccountDetails()?.isRaven).toBe(true);
});

it("loads organization identity after the official five second wait", async () => {
  vi.useFakeTimers();
  const context = new CoworkAccountContext({
    loadBootstrapIdentity: async () => ({
      accountUuid: "fallback-account",
      organizationUuid: "org-2",
    }),
  });
  const pending = context.waitForIdentity();

  context.setAccountDetails({
    accountUuid: "account-2",
    isLoggedOut: false,
  });

  await vi.advanceTimersByTimeAsync(5_000);

  await expect(pending).resolves.toEqual({
    accountUuid: "account-2",
    organizationUuid: "org-2",
  });
  vi.useRealTimers();
});

it("resolves null after the official five second account wait", async () => {
  vi.useFakeTimers();
  const context = new CoworkAccountContext({
    loadBootstrapIdentity: async () => null,
  });
  const pending = context.waitForIdentity();

  await vi.advanceTimersByTimeAsync(5_000);

  await expect(pending).resolves.toBeNull();
  vi.useRealTimers();
});
