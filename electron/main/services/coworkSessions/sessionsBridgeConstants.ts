/**
 * Official sessions-bridge timing/cap constants (app.asar z6i block).
 *
 *   L6i=5*6e4, b6i=1e3, U6i=3e4, lwe=6, F6i=3e4, Bwe=2,
 *   O6i=5*6e4, Y6i=720*6e4, x6i=15e3, Qwe=3, uwe=5, dwe=50
 *   _6i=4090, R6i="583857784"
 *
 * data-official-source: app.asar index.js z6i constants near activeSessions
 */

/** Official L6i — stale-turn window (ms). */
export const SESSIONS_BRIDGE_STALE_TURN_MS = 5 * 60_000;
/** Official b6i — reconnect exponential backoff base (ms). */
export const SESSIONS_BRIDGE_RECONNECT_BASE_MS = 1_000;
/** Official U6i — reconnect backoff cap (ms). */
export const SESSIONS_BRIDGE_RECONNECT_MAX_MS = 30_000;
/** Official lwe — max transportReconnectAttempts before cap redispatch. */
export const SESSIONS_BRIDGE_RECONNECT_MAX_ATTEMPTS = 6;
/** Official F6i — connected uptime before resetting reconnect counters (ms). */
export const SESSIONS_BRIDGE_RECONNECT_STABLE_MS = 30_000;
/** Official Bwe — max capRedispatchAttempts. */
export const SESSIONS_BRIDGE_CAP_REDISPATCH_MAX = 2;
/** Official O6i — schedule ingress refresh this long before JWT exp (ms). */
export const SESSIONS_BRIDGE_INGRESS_REFRESH_LEAD_MS = 5 * 60_000;
/** Official Y6i — max delay for scheduled ingress refresh (ms). */
export const SESSIONS_BRIDGE_INGRESS_REFRESH_MAX_MS = 720 * 60_000;
/** Official x6i — default poll interval (also SESSIONS_BRIDGE_DEFAULT_POLL_MS). */
export const SESSIONS_BRIDGE_POLL_MS = 15_000;
/** Official _6i — epoch superseded close code. */
export const SESSIONS_BRIDGE_EPOCH_SUPERSEDED_CLOSE = 4090;
/** Official R6i — h6i SDK adapter feature gate (product always CCR; inject-only). */
export const SESSIONS_BRIDGE_SDK_ADAPTER_FEATURE = "583857784";
