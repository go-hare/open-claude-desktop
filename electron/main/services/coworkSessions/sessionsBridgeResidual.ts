/**
 * Residual Sessions Bridge shell surface (app.asar custom-3p + 1p yit/QcA / bridge-state.json).
 *
 * Official custom-3p setImplementation (no remote poller):
 *   getBridgeConsent → !shouldEnableSessionsBridge()  (3p shouldEnable=false → true)
 *   getSessionsBridgeEnabled → true
 *   setSessionsBridgeEnabled → no-op void (1p writes bridge-state.json via fwe)
 *   kick/reset/abandon/preflight → void
 *   getInitialSessionsBridgeStatusState → yit() { conflict, dispatchAgentName }
 *   deleteBridgeSession / deleteBridgeAgentMemory → boolean (false without client)
 *
 * Official 1p:
 *   shouldEnableSessionsBridge() → true
 *   getBridgeConsent → Sit(userConsented) when org+account present
 *   getSessionsBridgeEnabled → enabled !== false when identity present
 *   setSessionsBridgeEnabled → fwe (live client setEnabledFlag or bridge-state write)
 *
 * Official QcA status shape (NO invent `status`/`reason`/`enabled` fields):
 *   conflict: boolean
 *   dispatchAgentName: string | null
 *   agentNameEnabled?: boolean
 *   remoteOrchestratorMode?: boolean
 *   conflictingMachineName?: string
 *
 * Storage residual: userData/bridge-state.json keyed `${orgUuid}:${accountUuid}`
 * with { enabled?, userConsented?, environmentId?, remoteSessionId?, localSessionId?,
 * localSessionGen?, dispatchAgentName? }.
 *
 * Live client is productized in sessionsBridgeClient/lifecycle — this module is
 * state + shell residual shapes. Does **not** invent ready without client path.
 *
 * data-official-source: app.asar yit/SD/QcA/RsA/$M/Sit/Rit/fwe / custom-3p setImplementation / z6i
 */

import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { resolveDeploymentModeFromUserData } from "../custom3p/deploymentMode";

const LOG = "[sessions-bridge]";

/** Official j6i */
const BRIDGE_STATE_FILE = "bridge-state.json";

/** Official QcA allowlist — SD must not smuggle invent keys. */
const QCA_STATUS_KEYS = new Set([
  "conflict",
  "dispatchAgentName",
  "agentNameEnabled",
  "remoteOrchestratorMode",
  "conflictingMachineName",
]);

/** Official FK / yit — sessionsBridgeStatus store bag. */
export type SessionsBridgeStatusState = {
  conflict: boolean;
  dispatchAgentName: string | null;
  agentNameEnabled?: boolean;
  remoteOrchestratorMode?: boolean;
  conflictingMachineName?: string;
};

/** Official bridge-state.json entry residual (z6i / fwe / ensureSession). */
export type BridgeStateEntry = {
  enabled?: boolean;
  userConsented?: boolean;
  dispatchAgentName?: string | null;
  environmentId?: string;
  remoteSessionId?: string;
  localSessionId?: string;
  localSessionGen?: number;
  /** Official z6i processed delivery seed */
  processedMessageUuids?: string[];
  pendingProcessedAcks?: string[];
};

type BridgeStateFile = Record<string, BridgeStateEntry>;

let statusState: SessionsBridgeStatusState = {
  conflict: false,
  dispatchAgentName: null,
};

let statusListener: ((state: SessionsBridgeStatusState) => void) | null = null;

/**
 * Test / product override for shouldEnableSessionsBridge.
 * null → resolve from deployment mode (1p true / 3p false).
 */
let shouldEnableOverride: boolean | null = null;

/** Test / wiring: H6i residual. */
export function setSessionsBridgeStatusListener(
  listener: ((state: SessionsBridgeStatusState) => void) | null,
): void {
  statusListener = listener;
}

/** Official yit() */
export function getSessionsBridgeStatusState(): SessionsBridgeStatusState {
  return { ...statusState };
}

function pickQcAPartial(
  partial: Partial<SessionsBridgeStatusState> & Record<string, unknown>,
): Partial<SessionsBridgeStatusState> {
  const out: Partial<SessionsBridgeStatusState> = {};
  for (const key of Object.keys(partial)) {
    if (!QCA_STATUS_KEYS.has(key)) continue;
    const value = partial[key];
    if (key === "dispatchAgentName") {
      if (value === null || typeof value === "string") {
        out.dispatchAgentName = value as string | null;
      }
      continue;
    }
    if (key === "conflict" && typeof value === "boolean") {
      out.conflict = value;
      continue;
    }
    if (key === "agentNameEnabled" && typeof value === "boolean") {
      out.agentNameEnabled = value;
      continue;
    }
    if (key === "remoteOrchestratorMode" && typeof value === "boolean") {
      out.remoteOrchestratorMode = value;
      continue;
    }
    if (key === "conflictingMachineName") {
      if (value === undefined) continue;
      if (typeof value === "string") out.conflictingMachineName = value;
      // allow explicit clear via null-ish → omit (delete key by not setting)
    }
  }
  return out;
}

/** Official SD(partial) — QcA keys only (no invent status/reason/enabled). */
export function patchSessionsBridgeStatus(
  partial: Partial<SessionsBridgeStatusState> & Record<string, unknown>,
): SessionsBridgeStatusState {
  const safe = pickQcAPartial(partial);
  const next: SessionsBridgeStatusState = {
    ...statusState,
    ...safe,
  };
  // dispatchAgentName must stay null | string
  if (safe.dispatchAgentName === undefined) {
    next.dispatchAgentName = statusState.dispatchAgentName;
  }
  // Explicit clear of conflictingMachineName when conflict cleared
  if (safe.conflict === false && partial.conflictingMachineName === undefined) {
    delete next.conflictingMachineName;
  }
  statusState = next;
  statusListener?.(getSessionsBridgeStatusState());
  return getSessionsBridgeStatusState();
}

export function resetSessionsBridgeStatusForTests(): void {
  statusState = { conflict: false, dispatchAgentName: null };
  statusListener = null;
  shouldEnableOverride = null;
}

/**
 * Test helper: force shouldEnable residual (null restores deployment-mode resolve).
 */
export function setShouldEnableSessionsBridgeForTests(
  value: boolean | null,
): void {
  shouldEnableOverride = value;
}

function bridgeStatePath(userDataDir?: string): string {
  const root =
    userDataDir ??
    (typeof app?.getPath === "function" ? app.getPath("userData") : process.cwd());
  return path.join(root, BRIDGE_STATE_FILE);
}

/** Official jM */
export function bridgeStateKey(orgUuid: string, accountUuid: string): string {
  return `${orgUuid}:${accountUuid}`;
}

async function readBridgeStateFile(userDataDir?: string): Promise<BridgeStateFile> {
  try {
    const raw = await fs.readFile(bridgeStatePath(userDataDir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as BridgeStateFile;
    }
    return {};
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code !== "ENOENT") {
      console.warn(
        `${LOG} Failed to read bridge state (resetting to empty): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return {};
  }
}

async function writeBridgeStateFile(
  bag: BridgeStateFile,
  userDataDir?: string,
): Promise<void> {
  const file = bridgeStatePath(userDataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(bag, null, 2), "utf8");
}

/**
 * Official getBridgeState entry for org:account (z6i readBridgeState residual).
 */
export async function getBridgeStateEntry(
  orgUuid: string,
  accountUuid: string,
  userDataDir?: string,
): Promise<BridgeStateEntry> {
  const bag = await readBridgeStateFile(userDataDir);
  return { ...(bag[bridgeStateKey(orgUuid, accountUuid)] ?? {}) };
}

/**
 * Official updateBridgeState mutator residual (queued by client).
 */
export async function updateBridgeStateEntry(
  orgUuid: string,
  accountUuid: string,
  mutator: (prev: BridgeStateEntry) => BridgeStateEntry,
  userDataDir?: string,
): Promise<BridgeStateEntry> {
  const bag = await readBridgeStateFile(userDataDir);
  const key = bridgeStateKey(orgUuid, accountUuid);
  const next = mutator({ ...(bag[key] ?? {}) });
  bag[key] = next;
  await writeBridgeStateFile(bag, userDataDir);
  return { ...next };
}

/**
 * Official:
 *   1p provider: shouldEnableSessionsBridge() → true
 *   custom-3p: shouldEnableSessionsBridge() → false
 *
 * Product: resolve deployment mode (1p → true; 3p/dotClaude shell → false).
 * Override only for tests.
 */
export function shouldEnableSessionsBridge(userDataDir?: string): boolean {
  if (shouldEnableOverride !== null) return shouldEnableOverride;
  try {
    const root =
      userDataDir ??
      (typeof app?.getPath === "function" ? app.getPath("userData") : process.cwd());
    const snap = resolveDeploymentModeFromUserData(root);
    // Official 1p hai → true; 3p Cai → false
    return snap.resolution.mode === "1p";
  } catch {
    // Unresolved userData → custom-3p-safe residual (no invent live bridge).
    return false;
  }
}

export type SessionsBridgeIdentity = {
  orgUuid: string | null;
  accountUuid: string | null;
};

/**
 * Official getBridgeConsent:
 *   if (!shouldEnableSessionsBridge()) return true;
 *   if (!org || !account) return false;
 *   return Sit → userConsented === true
 */
export async function getBridgeConsent(
  identity: SessionsBridgeIdentity,
  userDataDir?: string,
): Promise<boolean> {
  if (!shouldEnableSessionsBridge(userDataDir)) return true;
  const org = identity.orgUuid;
  const account = identity.accountUuid;
  if (!org || !account) return false;
  const entry = await getBridgeStateEntry(org, account, userDataDir);
  return entry.userConsented === true;
}

/**
 * Official getSessionsBridgeEnabled:
 *   custom-3p stub → true
 *   1p: if (!org || !account) return true; else enabled !== false
 */
export async function getSessionsBridgeEnabled(
  identity: SessionsBridgeIdentity,
  userDataDir?: string,
): Promise<boolean> {
  if (!shouldEnableSessionsBridge(userDataDir)) {
    // Official custom-3p setImplementation: async () => true
    return true;
  }
  const org = identity.orgUuid;
  const account = identity.accountUuid;
  if (!org || !account) return true;
  const entry = await getBridgeStateEntry(org, account, userDataDir);
  return entry.enabled !== false;
}

/**
 * Official setSessionsBridgeEnabled / fwe residual (file write path).
 * Live client setEnabledFlag is preferred by lifecycle when EQ() matches identity.
 *
 * IPC return is void (official await A.set… with no result validation).
 */
export async function setSessionsBridgeEnabled(
  identity: SessionsBridgeIdentity,
  enabled: boolean,
  userDataDir?: string,
): Promise<void> {
  const org = identity.orgUuid;
  const account = identity.accountUuid;
  if (!org || !account) {
    // Official: !E||!C → skip write
    return;
  }
  await updateBridgeStateEntry(
    org,
    account,
    (prev) => ({ ...prev, enabled: enabled === true }),
    userDataDir,
  );
  // Shell status push residual (H6i) — only official fields.
  // Do not invent status:"ready".
  patchSessionsBridgeStatus({
    conflict: false,
  });
}

/** Official deleteBridgeSession without client → false */
export async function deleteBridgeSessionResidual(): Promise<boolean> {
  console.info(`${LOG} deleteBridgeSession: no bridge instance`);
  return false;
}

/** Official deleteBridgeAgentMemory without client → false */
export async function deleteBridgeAgentMemoryResidual(): Promise<boolean> {
  return false;
}

/** Official void no-ops when client absent. */
export async function kickBridgePollResidual(): Promise<void> {
  /* no EQ() client */
}

export async function resetBridgeResidual(): Promise<void> {
  /* no-op */
}

export async function resetBridgeSessionResidual(): Promise<void> {
  /* forceNewLocalSession no-op without client */
}

export async function abandonBridgeEnvironmentResidual(
  _deregister?: unknown,
): Promise<void> {
  /* no-op */
}

export async function respondBridgePermissionPreflightResidual(
  _requestId?: unknown,
  _proceed?: unknown,
): Promise<void> {
  /* no-op */
}

/** Resolve identity from settings prefs / bootstrap-ish bags without inventing uuids. */
export function identityFromSettingsPrefs(
  prefs: Record<string, unknown> | null | undefined,
): SessionsBridgeIdentity {
  const p = prefs && typeof prefs === "object" ? prefs : {};
  const account =
    (typeof p.accountUuid === "string" && p.accountUuid) ||
    (typeof p.accountId === "string" && p.accountId) ||
    null;
  const org =
    (typeof p.organizationUuid === "string" && p.organizationUuid) ||
    (typeof p.orgUuid === "string" && p.orgUuid) ||
    (typeof p.orgId === "string" && p.orgId) ||
    null;
  // Nested identity bags used by some product settings writers
  const identity =
    p.identity && typeof p.identity === "object"
      ? (p.identity as Record<string, unknown>)
      : null;
  const nestedAccount =
    identity && typeof identity.accountUuid === "string"
      ? identity.accountUuid
      : null;
  const nestedOrg =
    identity && typeof identity.organizationUuid === "string"
      ? identity.organizationUuid
      : null;
  return {
    accountUuid: account ?? nestedAccount,
    orgUuid: org ?? nestedOrg,
  };
}

/** Official xu + p5 — local bridge session id for org + gen. */
export function bridgeLocalSessionId(orgUuid: string, gen = 0): string {
  const base = `local_ditto_${orgUuid}`;
  return gen > 0 ? `${base}_g${gen}` : base;
}
