/**
 * Official account identity side effects (app.asar id() listeners):
 *
 *   // oauth clear on identity diff
 *   id(() => {
 *     const e = qa();
 *     if (!e || (!e.isLoggedOut && e.accountUuid === undefined)) return;
 *     if (wH === null) { wH = e.isLoggedOut; DH = e.accountUuid; return; }
 *     const A = wH !== e.isLoggedOut;
 *     const t = DH !== undefined && e.accountUuid !== undefined && DH !== e.accountUuid;
 *     if (A || t) { Lm(); }
 *     ...
 *   });
 *
 *   // GrowthBook I9t on every account update
 *   id(() => { _0A = I9t().finally(R0A); });
 *
 * Product residual: pure watchers for subscribe(setAccountDetails).
 */

import type { CoworkAccountDetails } from "./coworkAccountContext";
import { clearCoworkOauthTokenCache } from "./coworkOauthTokenCache";

export type CoworkAccountIdentityEffectDeps = {
  clearOauthCache?: () => number | void;
  log?: (message: string, ...args: unknown[]) => void;
  /** Optional trusted-device clear residual when uuid changes. */
  clearTrustedDeviceToken?: () => void | Promise<void>;
};

export type CoworkAccountIdentityChange = {
  loggedOutChanged: boolean;
  uuidChanged: boolean;
  previousLoggedOut: boolean | null;
  previousUuid: string | undefined;
  nextLoggedOut: boolean;
  nextUuid: string | undefined;
};

/**
 * Official identity-diff gate for Lm().
 * First observation seeds baseline without clear.
 */
export function createCoworkAccountOauthIdentityWatcher(
  deps: CoworkAccountIdentityEffectDeps = {},
): (details: CoworkAccountDetails) => CoworkAccountIdentityChange | null {
  let seeded = false;
  let prevLoggedOut: boolean | null = null;
  let prevUuid: string | undefined;

  const clearOauth = deps.clearOauthCache ?? clearCoworkOauthTokenCache;
  const log = deps.log ?? ((...args: unknown[]) => console.info(...args));

  return (details) => {
    // Official: ignore incomplete payloads (logged-in without uuid yet).
    if (!details.isLoggedOut && details.accountUuid === undefined) {
      return null;
    }

    const nextLoggedOut = details.isLoggedOut === true;
    const nextUuid = details.accountUuid;

    if (!seeded) {
      seeded = true;
      prevLoggedOut = nextLoggedOut;
      prevUuid = nextUuid;
      return {
        loggedOutChanged: false,
        uuidChanged: false,
        previousLoggedOut: null,
        previousUuid: undefined,
        nextLoggedOut,
        nextUuid,
      };
    }

    const loggedOutChanged = prevLoggedOut !== nextLoggedOut;
    const uuidChanged =
      prevUuid !== undefined
      && nextUuid !== undefined
      && prevUuid !== nextUuid;

    if (loggedOutChanged || uuidChanged) {
      log(
        `[account] Identity changed (loggedOut: ${prevLoggedOut} → ${nextLoggedOut}, uuid: ${prevUuid ?? "<none>"} → ${nextUuid ?? "<none>"}), clearing oauth cache`,
      );
      clearOauth();
      if (uuidChanged) {
        void Promise.resolve(deps.clearTrustedDeviceToken?.()).catch(() => {
          /* residual optional */
        });
      }
    }

    const change: CoworkAccountIdentityChange = {
      loggedOutChanged,
      uuidChanged,
      previousLoggedOut: prevLoggedOut,
      previousUuid: prevUuid,
      nextLoggedOut,
      nextUuid,
    };

    prevLoggedOut = nextLoggedOut;
    if (nextUuid !== undefined) prevUuid = nextUuid;

    return change;
  };
}

export type CoworkGrowthBookAccountRefresh = {
  refreshForAccountChange: () => Promise<unknown>;
};

/**
 * Official BbA id(() => I9t().finally(R0A)) residual.
 * Runs on every account details update once lifecycle is active.
 */
export function createCoworkGrowthBookAccountRefreshWatcher(
  getLifecycle: () => CoworkGrowthBookAccountRefresh | null | undefined,
  deps: { log?: (message: string, ...args: unknown[]) => void } = {},
): (details: CoworkAccountDetails) => void {
  const log = deps.log ?? ((...args: unknown[]) => console.warn(...args));
  return () => {
    const lifecycle = getLifecycle();
    if (!lifecycle) return;
    void lifecycle.refreshForAccountChange().catch((error) => {
      log("[growthbook] account-change refresh residual failed", error);
    });
  };
}
