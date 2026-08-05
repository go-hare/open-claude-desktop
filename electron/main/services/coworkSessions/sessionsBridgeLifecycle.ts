/**
 * Residual sessions-bridge lifecycle (app.asar nTA / lIr / NJ / IIr / fwe wire).
 *
 * Official:
 *   oKA = RSe (feature 3572572142) || CIr
 *   nTA: if !oKA skip; if !shouldEnable skip; else IIr → X6i start
 *   lIr: if !shouldEnable return; sync W6i agent name; if !(oKA && enabled) dispose; else consent→nTA
 *   NJ: serialize lIr on queue
 *   IIr: resolve org/account + oauth token + apiHost → startSessionsBridgeClient
 *
 * Product residual (post-v2 Waves A–D):
 *   - Gate defaults off until GrowthBook / force sets oKA (no invent on).
 *   - 3p shouldEnable=false → never start client (custom-3p residual).
 *   - Token: only real cowork oauth cache (never invent Anthropic login success).
 *   - Session work: cwe decode + activeSessions + CCR transport residual.
 *   - Keep-alive: reconnectSessionTransport / ingress refresh / cap redispatch.
 *   - Seeds: writeDispatchSeedMessages (GUA/P6i).
 *   - Inbound: user / control_response / control_request(interrupt) + sessionManager port.
 *   - Wire: getBridgeActiveSession + onBridgePermissionPreflight + sessionManager
 *     (deps only — no event double-fire).
 *   - No invent ready/OAuth/connected.
 *   - h6i residual: R6i on → createSdkBridgeTransport (eit attach over CCR wire);
 *     attach fail throws, never soft-true connected.
 *   - OAuth token: IIr residual — UHe (L5t → cache → F5t → O5t) via
 *     getSessionsBridgeOAuthToken; empty cookies/network fail honestly
 *     (no invent Anthropic login / Subscribe / BFF success).
 *   - Live desktop Dispatch E2E is NOT claimed by unit suite; only after
 *     actual app start with real gate+consent+token+apiHost path.
 *
 * data-official-source: app.asar nTA/lIr/NJ/IIr/X6i/wkA/EQ / feature 3572572142
 */

import { app } from "electron";
import { clearCoworkOauthTokenCache } from "../coworkAccount/coworkOauthTokenCache";
import { getSessionsBridgeOAuthToken } from "../coworkAccount/coworkOauthFlow";
import {
  disposeSessionsBridgeClient,
  getSessionsBridgeClient,
  startSessionsBridgeClient,
  type SessionsBridgeClient,
  type SessionsBridgeClientDeps,
} from "./sessionsBridgeClient";
import {
  getBridgeConsent,
  getSessionsBridgeEnabled,
  identityFromSettingsPrefs,
  setSessionsBridgeEnabled,
  shouldEnableSessionsBridge,
  type SessionsBridgeIdentity,
} from "./sessionsBridgeResidual";

const LOG = "[sessions-bridge]";

/** Official yukon_silver_cuttlefish_desktop feature id */
export const SESSIONS_BRIDGE_FEATURE_FLAG_ID = "3572572142";

/** Official production apiHost residual (cbA) */
export const SESSIONS_BRIDGE_DEFAULT_API_HOST = "https://api.anthropic.com";

/** Official oKA / RSe / CIr residual */
let featureGateOn = false;
let forceGateOn = false;
let sessionsBridgeGate = false;

type LifecycleDeps = {
  getIdentity: () => SessionsBridgeIdentity | Promise<SessionsBridgeIdentity>;
  getApiHost?: () => string;
  getOAuthToken?: () => Promise<string>;
  clearTokenCache?: () => Promise<void> | void;
  getTrustedDeviceToken?: () => string | null | undefined;
  userDataDir?: string;
  onRemoteSessionStart?: (payload: unknown) => void;
  onBridgePermissionPreflight?: (payload: unknown) => void;
  /** Official inbound control_request → manager interrupt residual. */
  onInboundMessage?: SessionsBridgeClientDeps["onInboundMessage"];
  onSessionWork?: SessionsBridgeClientDeps["onSessionWork"];
  /** Optional session manager port for fast-path send / interrupt. */
  sessionManager?: SessionsBridgeClientDeps["sessionManager"];
  /** Inject client factory for tests. */
  startClient?: (deps: SessionsBridgeClientDeps) => SessionsBridgeClient;
  disposeClient?: () => Promise<void>;
  getClient?: () => SessionsBridgeClient | null;
};

let deps: LifecycleDeps | null = null;
let reconcileQueue: Promise<void> = Promise.resolve();

function recomputeGate(): void {
  // Official: oKA = RSe || CIr
  sessionsBridgeGate = featureGateOn || forceGateOn;
}

/** Official Cm("3572572142") residual — GrowthBook on flag. */
export function setSessionsBridgeFeatureGate(on: boolean): void {
  featureGateOn = on === true;
  recomputeGate();
}

/**
 * Product/dev residual for CIr-style force. Env CLAUDE_SESSIONS_BRIDGE_GATE=1
 * also enables (local shell testing without inventing default true).
 */
export function setSessionsBridgeForceGate(on: boolean): void {
  forceGateOn = on === true;
  recomputeGate();
}

export function isSessionsBridgeGateOn(): boolean {
  return sessionsBridgeGate;
}

export function resetSessionsBridgeLifecycleForTests(): void {
  featureGateOn = false;
  forceGateOn = false;
  sessionsBridgeGate = false;
  deps = null;
  reconcileQueue = Promise.resolve();
}

function resolveUserData(userDataDir?: string): string | undefined {
  if (userDataDir) return userDataDir;
  try {
    return typeof app?.getPath === "function" ? app.getPath("userData") : undefined;
  } catch {
    return undefined;
  }
}

async function defaultGetOAuthToken(): Promise<string> {
  // Official IIr getOAuthToken residual:
  //   COWORK_OAUTH_CONFIGS + sessions scope → getApiToken (UHe)
  //   UHe: L5t → lastActiveOrg → cache hit → F5t refresh → O5t cookie exchange
  // Empty cookies / failed exchange → throw (bridge start/register fail path).
  // Never invent token strings.
  const apiHost =
    deps?.getApiHost?.() ??
    process.env.CLAUDE_SESSIONS_BRIDGE_API_HOST ??
    SESSIONS_BRIDGE_DEFAULT_API_HOST;
  return getSessionsBridgeOAuthToken({ apiHost });
}

async function defaultClearTokenCache(): Promise<void> {
  clearCoworkOauthTokenCache();
}

/**
 * Wire lifecycle deps once at desktop bootstrap (registerDesktopIpc / main).
 * Safe to call again to update identity provider.
 */
export function configureSessionsBridgeLifecycle(next: LifecycleDeps): void {
  deps = next;
  // Env residual for local shell gate (not default-on invent).
  if (process.env.CLAUDE_SESSIONS_BRIDGE_GATE === "1") {
    forceGateOn = true;
    recomputeGate();
  }
}

/** Official IIr residual (without inventing sessionManager transport). */
export async function initSessionsBridgeClient(
  override?: Partial<LifecycleDeps>,
): Promise<SessionsBridgeClient | null> {
  const d = { ...deps, ...override } as LifecycleDeps;
  if (!d.getIdentity) {
    console.error(`${LOG} init skipped — lifecycle not configured`);
    return null;
  }
  const identity = await d.getIdentity();
  const org = identity.orgUuid;
  const account = identity.accountUuid;
  if (!org || !account) {
    console.error(
      `${LOG} Could not resolve org/account UUID, bridge will not start`,
      { orgUuid: org, accountUuid: account },
    );
    return null;
  }
  const apiHost =
    d.getApiHost?.() ??
    process.env.CLAUDE_SESSIONS_BRIDGE_API_HOST ??
    SESSIONS_BRIDGE_DEFAULT_API_HOST;
  console.info(`${LOG} Initializing bridge`, {
    apiHost,
    orgUuid: org,
  });
  const clientDeps: SessionsBridgeClientDeps = {
    orgUuid: org,
    accountUuid: account,
    apiHost,
    getOAuthToken: d.getOAuthToken ?? defaultGetOAuthToken,
    clearTokenCache: d.clearTokenCache ?? defaultClearTokenCache,
    getTrustedDeviceToken: d.getTrustedDeviceToken,
    userDataDir: resolveUserData(d.userDataDir),
    onSessionWork: d.onSessionWork,
    onRemoteSessionStart: d.onRemoteSessionStart,
    onBridgePermissionPreflight: d.onBridgePermissionPreflight,
    onInboundMessage: d.onInboundMessage,
    sessionManager: d.sessionManager,
  };
  const start = d.startClient ?? startSessionsBridgeClient;
  const client = start(clientDeps);
  // Client invokes onRemoteSessionStart / onBridgePermissionPreflight /
  // onInboundMessage deps directly AND also emits events for diagnostics.
  // Do NOT re-register the same sinks on those events here — that double-fires
  // renderer remote_session_start / preflight / interrupt.
  return client;
}

/** Official nTA residual */
export async function startSessionsBridgeIfEligible(): Promise<void> {
  if (!sessionsBridgeGate) {
    console.info(
      `${LOG} init skipped — gate off (yukon_silver_cuttlefish_desktop)`,
    );
    return;
  }
  const userData = resolveUserData(deps?.userDataDir);
  if (!shouldEnableSessionsBridge(userData)) {
    console.info(
      `[custom-3p] Sessions bridge disabled (no web UI to bridge to)`,
    );
    return;
  }
  const getClient = deps?.getClient ?? getSessionsBridgeClient;
  const existing = getClient();
  if (existing && !existing.startFailed) {
    return;
  }
  await initSessionsBridgeClient();
}

/** Official lIr residual */
export async function reconcileSessionsBridge(): Promise<void> {
  const userData = resolveUserData(deps?.userDataDir);
  if (!shouldEnableSessionsBridge(userData)) {
    return;
  }
  const identity = deps?.getIdentity
    ? await deps.getIdentity()
    : { orgUuid: null, accountUuid: null };
  const org = identity.orgUuid;
  const account = identity.accountUuid;
  const enabled =
    org && account
      ? await getSessionsBridgeEnabled(identity, userData)
      : true;
  const getClient = deps?.getClient ?? getSessionsBridgeClient;
  const dispose = deps?.disposeClient ?? disposeSessionsBridgeClient;
  if (!(sessionsBridgeGate && enabled)) {
    if (getClient()) {
      console.info(`${LOG} Disposing (pref disabled or gate off)`);
      await dispose();
    }
    return;
  }
  if (getClient()) return;
  if (!org || !account) return;
  // Official: await Sit(e,A) && await nTA() — only start if userConsented
  const consented = await getBridgeConsent(identity, userData);
  if (!consented) {
    console.info(`${LOG} init deferred — userConsented not set`);
    return;
  }
  await startSessionsBridgeIfEligible();
}

/** Official NJ residual — serialize reconcile */
export function scheduleSessionsBridgeReconcile(): Promise<void> {
  reconcileQueue = reconcileQueue
    .then(() => reconcileSessionsBridge())
    .catch(() => undefined);
  return reconcileQueue;
}

/**
 * Official fwe / setSessionsBridgeEnabled product wire:
 * live client setEnabledFlag when EQ matches identity, else residual file write;
 * then NJ reconcile (start/dispose).
 */
export async function setSessionsBridgeEnabledLive(
  identity: SessionsBridgeIdentity,
  enabled: boolean,
  userDataDir?: string,
): Promise<void> {
  const org = identity.orgUuid;
  const account = identity.accountUuid;
  const client = (deps?.getClient ?? getSessionsBridgeClient)();
  if (
    client &&
    !client.disposed &&
    org &&
    account &&
    client.orgUuid === org &&
    client.accountUuid === account
  ) {
    await client.setEnabledFlag(enabled);
  } else {
    await setSessionsBridgeEnabled(identity, enabled, userDataDir);
  }
  // Official set then NJ
  await scheduleSessionsBridgeReconcile();
}

/** Official kickBridgePoll → EQ()?.kickPollLoop() */
export async function kickBridgePollLive(): Promise<void> {
  const client = (deps?.getClient ?? getSessionsBridgeClient)();
  client?.kickPollLoop();
}

/** Official resetBridgeSession → forceNewLocalSession residual */
export async function resetBridgeSessionLive(): Promise<void> {
  const client = (deps?.getClient ?? getSessionsBridgeClient)();
  if (!client) return;
  await client.forceNewLocalSession();
}

/** Official abandonBridgeEnvironment */
export async function abandonBridgeEnvironmentLive(
  deregister?: unknown,
): Promise<void> {
  const client = (deps?.getClient ?? getSessionsBridgeClient)();
  if (!client) return;
  if (deregister === true || deregister === undefined) {
    await client.abandonEnvironment();
  }
  await (deps?.disposeClient ?? disposeSessionsBridgeClient)();
  await scheduleSessionsBridgeReconcile();
}

/** Official resetBridge → dispose + optional re-init via NJ */
export async function resetBridgeLive(): Promise<void> {
  await (deps?.disposeClient ?? disposeSessionsBridgeClient)();
  await scheduleSessionsBridgeReconcile();
}

/** Official deleteBridgeSession without full activeSessions map → residual false / forget */
export async function deleteBridgeSessionLive(): Promise<boolean> {
  const client = (deps?.getClient ?? getSessionsBridgeClient)();
  if (!client) {
    console.info(`${LOG} deleteBridgeSession: no bridge instance`);
    return false;
  }
  // Without activeSessions map product cannot target remote delete residual fully.
  // Clear persisted remote binding honestly.
  const stateIdentity = identityFromSettingsPrefs({});
  void stateIdentity;
  await client.forgetSession("");
  return false;
}

export async function respondBridgePermissionPreflightLive(
  requestId?: unknown,
  proceed?: unknown,
): Promise<void> {
  const client = (deps?.getClient ?? getSessionsBridgeClient)();
  client?.respondPreflight(requestId, proceed);
}

/** Account-change residual: dispose then NJ when identity key changes. */
let lastIdentityKey: string | null = null;

export async function onSessionsBridgeAccountChanged(
  identity: SessionsBridgeIdentity,
): Promise<void> {
  const key =
    identity.orgUuid && identity.accountUuid
      ? `${identity.orgUuid}:${identity.accountUuid}`
      : null;
  if (key === lastIdentityKey) return;
  const hadPrior = lastIdentityKey !== null;
  console.info(
    `${LOG} account-change reevaluate: ${lastIdentityKey ?? "<none>"} → ${key ?? "<none>"}`,
  );
  lastIdentityKey = key;
  if (hadPrior && (deps?.getClient ?? getSessionsBridgeClient)()) {
    await (deps?.disposeClient ?? disposeSessionsBridgeClient)();
  }
  await scheduleSessionsBridgeReconcile();
}
