/**
 * Residual sessions bridge client (app.asar z6i / EQ / X6i / wkA / nTA / IIr).
 *
 * Lifecycle:
 *   start → registerEnvironment → ensureSession → pollLoop
 *   kickPollLoop aborts poll sleep
 *   dispose tears down poll + activeSessions
 *   409 registration → SD({conflict:true, conflictingMachineName})
 *
 * Session work residual (handleSessionWork):
 *   cwe(secret) → activeSessions map → local_ditto binding → M6i transport connect
 *   decode fail → safeStopWork(force)
 *   v1 work (use_code_sessions !== true) logged as unexpected (v2-only bridge)
 *
 * data-official-source: app.asar z6i / pollLoop / handleSessionWork / cwe / M6i / C6i
 */

import { EventEmitter } from "node:events";
import { hostname } from "node:os";
import {
  createSessionsBridgeApiClient,
  SessionsApiFatalError,
  type SessionsBridgeApiClient,
  type SessionsBridgeWorkItem,
} from "./sessionsBridgeApi";
import {
  bridgeLocalSessionId,
  getBridgeStateEntry,
  getSessionsBridgeStatusState,
  patchSessionsBridgeStatus,
  updateBridgeStateEntry,
  type BridgeStateEntry,
} from "./sessionsBridgeResidual";
import {
  createSessionsBridgeTransport,
  type BridgeSessionTransport,
} from "./sessionsBridgeTransport";
import {
  decodeSessionsBridgeWorkSecret,
  parseSessionIngressTokenExp,
  type SessionsBridgeWorkSecret,
} from "./sessionsBridgeWorkSecret";
import {
  SESSIONS_BRIDGE_CAP_REDISPATCH_MAX,
  SESSIONS_BRIDGE_INGRESS_REFRESH_LEAD_MS,
  SESSIONS_BRIDGE_INGRESS_REFRESH_MAX_MS,
  SESSIONS_BRIDGE_POLL_MS,
  SESSIONS_BRIDGE_RECONNECT_BASE_MS,
  SESSIONS_BRIDGE_RECONNECT_MAX_ATTEMPTS,
  SESSIONS_BRIDGE_RECONNECT_MAX_MS,
  SESSIONS_BRIDGE_RECONNECT_STABLE_MS,
  SESSIONS_BRIDGE_SDK_ADAPTER_FEATURE,
  SESSIONS_BRIDGE_STALE_TURN_MS,
} from "./sessionsBridgeConstants";
import {
  buildDispatchSeedAssistantMessages,
  buildDispatchSeedIdleResult,
} from "./sessionsBridgeDispatchSeed";
import { extractInboundUserText } from "./sessionsBridgeInbound";
import {
  createBridgeTurnPssAssertion,
  releaseBridgeTurnPssAssertions,
} from "./sessionsBridgePss";
import {
  getBridgePendingUploadsDir,
  materializeBridgeAttachments,
  parseBridgeFileAttachments,
  prefixBridgeMessageWithAttachmentPaths,
} from "./sessionsBridgeAttachments";
import {
  createBridgePollWakeClaim,
  registerWakeSchedulerClaim,
  rescheduleWakeFromClaims,
  unregisterWakeSchedulerClaim,
  wakeSchedulerEvents,
} from "../settings/wakeSchedulerClaims";

const LOG = "[sessions-bridge]";
/** Official bridge-poll claim id residual. */
const BRIDGE_POLL_CLAIM_ID = "bridge-poll";

/** Official x6i default poll interval */
export const SESSIONS_BRIDGE_DEFAULT_POLL_MS = SESSIONS_BRIDGE_POLL_MS;
/** Official Qwe poll re-register max */
const POLL_REREGISTER_MAX = 3;
/** Official uwe registration 401 max */
const REGISTRATION_401_MAX = 5;

export type ActiveBridgeSession = {
  workId: string;
  workSecret: SessionsBridgeWorkSecret;
  localSessionId: string;
  transport: BridgeSessionTransport | null;
  inboundUserMessages: unknown[];
  pendingTurns: number;
  processedMessageUuids: Set<string>;
  pendingProcessedAcks: Set<string>;
  transportReconnectAttempts: number;
  transportConnectedAt: number | null;
  seedMessagesWritten: boolean;
  /** Official heldPSSAssertions residual (power assert ids; may stay empty). */
  heldPSSAssertions: number[];
  inflightEventIds: string[];
  staleTurnTimer: ReturnType<typeof setTimeout> | null;
  ingressTokenRefreshTimer: ReturnType<typeof setTimeout> | null;
  writeQueue: Promise<void>;
  transportReconnectInFlight: boolean;
  capRedispatchAttempts: number;
  queuedResultMsg: unknown | null;
};

/**
 * Official sessionManager surface residual (inject; no invent full remote manager).
 * Aligns with CoworkSessionManager sendMessage / interruptTurn signatures.
 */
export type SessionsBridgeSessionManagerPort = {
  hasSession?(id: string): boolean;
  sendMessage?(
    localId: string,
    text: string,
    images?: unknown,
    userSelectedFiles?: unknown,
    messageUuid?: string,
    toolStates?: unknown,
  ): void | Promise<void>;
  interruptTurn?(localId: string): void | Promise<void>;
  resolvePendingPermission?(
    requestId: string,
    resolution: { behavior: string; [k: string]: unknown },
  ): void;
  seedWebFetchProvenance?(localId: string, text: string): void;
};

export type SessionsBridgeClientDeps = {
  orgUuid: string;
  accountUuid: string;
  apiHost: string;
  getOAuthToken: () => Promise<string>;
  clearTokenCache?: () => Promise<void> | void;
  getTrustedDeviceToken?: () => string | null | undefined;
  /** Optional inject for tests. */
  apiClient?: SessionsBridgeApiClient;
  pollIntervalMs?: number;
  /**
   * Test inject for official L6i stale-turn window (default SESSIONS_BRIDGE_STALE_TURN_MS).
   * Production must omit — asar uses fixed L6i.
   */
  staleTurnMs?: number;
  userDataDir?: string;
  /**
   * Official handleSessionWork residual hook after bind/transport attempt.
   */
  onSessionWork?: (
    work: SessionsBridgeWorkItem,
    session: ActiveBridgeSession,
  ) => void | Promise<void>;
  onRemoteSessionStart?: (payload: unknown) => void;
  onBridgePermissionPreflight?: (payload: unknown) => void;
  onInboundMessage?: (remoteSessionId: string, message: unknown) => void;
  /** Inject transport factory for tests. */
  createTransport?: typeof createSessionsBridgeTransport;
  /** Optional session manager port for inbound fast-path / interrupt. */
  sessionManager?: SessionsBridgeSessionManagerPort;
  /**
   * Thin analytics residual for lam_bridge_* event names (asar).
   * No invent metrics backend — optional sink only.
   */
  track?: (event: string, props?: Record<string, unknown>) => void;
  /**
   * Official powerMonitor residual inject (resume / isOnBatteryPower).
   * Production uses electron.powerMonitor; tests inject fake.
   */
  powerMonitor?: {
    on?: (event: string, listener: () => void) => void;
    off?: (event: string, listener: () => void) => void;
    removeListener?: (event: string, listener: () => void) => void;
    isOnBatteryPower?: () => boolean;
  };
  /** Inject battery probe for bridge-poll claim (tests / product override). */
  isOnBatteryPower?: () => boolean;
};

type PreflightWaiter = {
  proceed: (value: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export class SessionsBridgeClient extends EventEmitter {
  readonly orgUuid: string;
  readonly accountUuid: string;
  private readonly apiHost: string;
  private readonly getOAuthToken: SessionsBridgeClientDeps["getOAuthToken"];
  private readonly clearTokenCache?: SessionsBridgeClientDeps["clearTokenCache"];
  private readonly apiClient: SessionsBridgeApiClient;
  private readonly pollIntervalMs: number;
  private readonly staleTurnMs: number;
  private readonly userDataDir?: string;
  private readonly onSessionWork?: SessionsBridgeClientDeps["onSessionWork"];
  private readonly onRemoteSessionStart?: SessionsBridgeClientDeps["onRemoteSessionStart"];
  private readonly onBridgePermissionPreflight?: SessionsBridgeClientDeps["onBridgePermissionPreflight"];
  private readonly onInboundMessage?: SessionsBridgeClientDeps["onInboundMessage"];
  private readonly createTransport: typeof createSessionsBridgeTransport;
  private readonly sessionManager?: SessionsBridgeSessionManagerPort;
  private readonly track?: SessionsBridgeClientDeps["track"];
  private readonly powerMonitorInject?: SessionsBridgeClientDeps["powerMonitor"];
  private readonly isOnBatteryPowerInject?: SessionsBridgeClientDeps["isOnBatteryPower"];
  /** Official pendingBridgePermissions residual map */
  private readonly pendingBridgePermissions = new Map<
    string,
    {
      localSessionId: string;
      toolName: string;
      requestedAt: number;
      /** Official isExternal residual (external permission waiters). */
      isExternal?: boolean;
    }
  >();

  private environmentId: string | null = null;
  private environmentSecret: string | null = null;
  private pollAbortController: AbortController | null = null;
  private pollSleepKickController: AbortController | null = null;
  private isDisposed = false;
  private startFailedPermanently = false;
  private backoffAttempt = 0;
  private registration403Retries = 0;
  private registration401Retries = 0;
  private pollReregisterAttempts = 0;
  private pollCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stateWriteQueue: Promise<void> = Promise.resolve();
  private pollLoopPromise: Promise<void> | null = null;
  /** Official system_resumed residual binding flag. */
  private systemResumeBound = false;
  private readonly onSystemResumed = (): void => {
    void this.handleSystemResumed("resume");
  };
  private readonly onDarkWake = (): void => {
    void this.handleSystemResumed("darkwake");
  };

  /** Official activeSessions residual */
  private readonly activeSessions = new Map<string, ActiveBridgeSession>();
  /** Official localToRemoteSessionId residual */
  private readonly localToRemoteSessionId = new Map<string, string>();
  /** Official preflightWaiting residual */
  private readonly preflightWaiting = new Map<string, PreflightWaiter>();
  private dispatchBridgePermissionPreflight:
    | ((payload: unknown) => void)
    | null = null;

  constructor(deps: SessionsBridgeClientDeps) {
    super();
    this.orgUuid = deps.orgUuid;
    this.accountUuid = deps.accountUuid;
    this.apiHost = deps.apiHost.replace(/\/+$/, "");
    this.getOAuthToken = deps.getOAuthToken;
    this.clearTokenCache = deps.clearTokenCache;
    this.pollIntervalMs = deps.pollIntervalMs ?? SESSIONS_BRIDGE_DEFAULT_POLL_MS;
    this.staleTurnMs = deps.staleTurnMs ?? SESSIONS_BRIDGE_STALE_TURN_MS;
    this.userDataDir = deps.userDataDir;
    this.onSessionWork = deps.onSessionWork;
    this.onRemoteSessionStart = deps.onRemoteSessionStart;
    this.onBridgePermissionPreflight = deps.onBridgePermissionPreflight;
    this.onInboundMessage = deps.onInboundMessage;
    this.createTransport = deps.createTransport ?? createSessionsBridgeTransport;
    this.sessionManager = deps.sessionManager;
    this.track = deps.track;
    this.powerMonitorInject = deps.powerMonitor;
    this.isOnBatteryPowerInject = deps.isOnBatteryPower;
    this.apiClient =
      deps.apiClient ??
      createSessionsBridgeApiClient({
        baseUrl: this.apiHost,
        getAccessToken: this.getOAuthToken,
        getTrustedDeviceToken: deps.getTrustedDeviceToken,
        orgUuid: this.orgUuid,
      });
  }

  get startFailed(): boolean {
    return this.startFailedPermanently;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  getEnvironmentId(): string | null {
    return this.environmentId;
  }

  /** Test / diagnostics */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  getActiveSession(remoteSessionId: string): ActiveBridgeSession | undefined {
    return this.activeSessions.get(remoteSessionId);
  }

  kickPollLoop(): void {
    this.pollSleepKickController?.abort();
  }

  setPreflightDispatcher(
    dispatcher: ((payload: unknown) => void) | null,
  ): void {
    this.dispatchBridgePermissionPreflight = dispatcher;
  }

  async setEnabledFlag(enabled: boolean): Promise<void> {
    await this.updateBridgeState((s) => ({ ...s, enabled }));
    const read = await this.readBridgeState();
    if (read.enabled !== enabled) {
      throw new Error(
        `${LOG} Failed to persist Dispatch enable flag (read-back mismatch)`,
      );
    }
  }

  private async readBridgeState(): Promise<BridgeStateEntry> {
    return getBridgeStateEntry(
      this.orgUuid,
      this.accountUuid,
      this.userDataDir,
    );
  }

  private async updateBridgeState(
    mutator: (prev: BridgeStateEntry) => BridgeStateEntry,
  ): Promise<void> {
    this.stateWriteQueue = this.stateWriteQueue.then(async () => {
      if (this.isDisposed) return;
      await updateBridgeStateEntry(
        this.orgUuid,
        this.accountUuid,
        mutator,
        this.userDataDir,
      );
    });
    await this.stateWriteQueue;
  }

  private scheduleRetry(fn: () => void, delayMs = 2_000): void {
    if (this.isDisposed) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.isDisposed) fn();
    }, delayMs);
  }

  async start(): Promise<void> {
    if (this.isDisposed) return;
    const state = await this.readBridgeState();
    if (this.isDisposed) return;

    const agentName = state.dispatchAgentName ?? null;
    patchSessionsBridgeStatus({
      conflict: false,
      conflictingMachineName: undefined,
      dispatchAgentName: agentName,
    });

    await this.updateBridgeState((s) =>
      s.userConsented ? s : { ...s, userConsented: true },
    );
    if (this.isDisposed) return;

    const priorEnv = (await this.readBridgeState()).environmentId ?? null;
    console.info(
      `${LOG} Registering environment${
        priorEnv ? ` (reusing ${priorEnv})` : " (fresh)"
      }...`,
    );

    try {
      const registered = await this.apiClient.registerEnvironment({
        machineName: hostname(),
        directory: "/cowork",
        metadata: { worker_type: "cowork" },
        environmentId: priorEnv ?? undefined,
      });
      if (this.isDisposed) return;
      this.environmentId = registered.environment_id;
      this.environmentSecret = registered.environment_secret;
      await this.updateBridgeState((s) => ({
        ...s,
        userConsented: true,
        enabled: s.enabled ?? true,
        environmentId: this.environmentId ?? undefined,
      }));
      if (priorEnv && registered.environment_id !== priorEnv) {
        console.warn(
          `${LOG} Backend returned different environment_id: requested=${priorEnv}, got=${registered.environment_id}. Max lifetime may have been exceeded.`,
        );
        await this.writePersistedRemoteSessionId(null);
      }
      console.info(`${LOG} Environment registered: ${this.environmentId}`);
      this.startFailedPermanently = false;
      this.registration401Retries = 0;
      this.registration403Retries = 0;
      this.trackSafe("lam_bridge_registration_completed", {
        environmentId: this.environmentId,
        reused: Boolean(priorEnv),
      });
      this.registerBridgePollWakeClaim();
      this.bindSystemResumeListeners();
      await this.ensureSession("start");
      this.pollLoopPromise = this.pollLoop();
    } catch (err) {
      await this.handleRegistrationError(err);
    }
  }

  private async handleRegistrationError(err: unknown): Promise<void> {
    if (err instanceof SessionsApiFatalError) {
      if (err.status === 401) {
        if (this.registration401Retries >= REGISTRATION_401_MAX) {
          console.error(
            `${LOG} Registration 401 after ${this.registration401Retries} retries, giving up: ${err.message}`,
          );
          this.startFailedPermanently = true;
          this.trackSafe("lam_bridge_registration_failed", {
            status: 401,
            permanent: true,
            message: err.message,
          });
          return;
        }
        this.registration401Retries += 1;
        console.warn(
          `${LOG} Registration 401, retrying (attempt ${this.registration401Retries}/${REGISTRATION_401_MAX}): ${err.message}`,
        );
        this.trackSafe("lam_bridge_registration_failed", {
          status: 401,
          permanent: false,
          attempt: this.registration401Retries,
          message: err.message,
        });
        await this.clearTokenCache?.();
        this.scheduleRetry(() => {
          void this.start();
        });
        return;
      }
      if (err.status === 403) {
        if (this.registration403Retries >= 1) {
          console.error(
            `${LOG} Persistent 403 after retry, giving up: ${err.message}`,
          );
          this.startFailedPermanently = true;
          this.trackSafe("lam_bridge_registration_failed", {
            status: 403,
            permanent: true,
            message: err.message,
          });
          return;
        }
        this.registration403Retries += 1;
        console.info(
          `${LOG} Got 403, clearing token cache and retrying: ${err.message}`,
        );
        this.trackSafe("lam_bridge_registration_failed", {
          status: 403,
          permanent: false,
          attempt: this.registration403Retries,
          message: err.message,
        });
        await this.clearTokenCache?.();
        this.scheduleRetry(() => {
          void this.start();
        });
        return;
      }
      if (err.status === 409) {
        if (this.isDisposed) return;
        const match = err.message.match(/already registered on (.+?)\./);
        const machine = match?.[1];
        console.error(`${LOG} Registration conflict (409): ${err.message}`);
        patchSessionsBridgeStatus({
          conflict: true,
          conflictingMachineName: machine,
        });
        this.startFailedPermanently = true;
        this.trackSafe("lam_bridge_registration_failed", {
          status: 409,
          permanent: true,
          conflictingMachineName: machine,
          message: err.message,
        });
        return;
      }
      console.error(
        `${LOG} Fatal error during registration: ${err.message} (status=${err.status})`,
      );
      this.startFailedPermanently = true;
      this.trackSafe("lam_bridge_registration_failed", {
        status: err.status,
        permanent: true,
        message: err.message,
      });
      return;
    }
    console.error(
      `${LOG} Registration failed, will retry: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    this.trackSafe("lam_bridge_registration_failed", {
      permanent: false,
      message: err instanceof Error ? err.message : String(err),
    });
    this.scheduleRetry(() => {
      void this.start();
    });
  }

  private async writePersistedRemoteSessionId(
    remoteSessionId: string | null,
  ): Promise<void> {
    await this.updateBridgeState((s) => ({
      ...s,
      remoteSessionId: remoteSessionId ?? undefined,
    }));
  }

  async ensureSession(trigger: string): Promise<void> {
    if (!this.environmentId) return;
    let remote = (await this.readBridgeState()).remoteSessionId ?? null;
    if (remote) {
      try {
        console.info(`${LOG} Reconnecting persisted session ${remote}`);
        await this.apiClient.reconnectSession(this.environmentId, remote);
        console.info(`${LOG} Session ${remote} reconnected successfully`);
        this.trackSafe("lam_bridge_reconnect_persisted_session", {
          remoteSessionId: remote,
          trigger,
        });
        return;
      } catch (err) {
        const notFound =
          err instanceof SessionsApiFatalError && err.status === 404;
        console.warn(
          `${LOG} Failed to reconnect session ${remote}: ${
            err instanceof Error ? err.message : String(err)
          }${notFound ? " — creating fresh" : ""}`,
        );
        if (!notFound) return;
        await this.writePersistedRemoteSessionId(null);
        remote = null;
      }
    }
    try {
      const id = await this.apiClient.createSession(
        this.environmentId,
        "Dispatch background conversation",
        ["cowork-dispatch-local"],
      );
      await this.writePersistedRemoteSessionId(id);
      console.info(`${LOG} Created session ${id} (trigger=${trigger})`);
      this.trackSafe("lam_bridge_session_created", {
        remoteSessionId: id,
        trigger,
      });
    } catch (err) {
      console.error(
        `${LOG} Failed to create session (trigger=${trigger}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async pollSleep(ms: number): Promise<void> {
    if (ms <= 0 || this.isDisposed) return;
    this.pollSleepKickController = new AbortController();
    const signals: AbortSignal[] = [this.pollSleepKickController.signal];
    if (this.pollAbortController) signals.push(this.pollAbortController.signal);
    const signal =
      signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  private async pollLoop(): Promise<void> {
    if (
      this.isDisposed ||
      !this.environmentId ||
      !this.environmentSecret
    ) {
      return;
    }
    this.pollAbortController = new AbortController();
    this.startFailedPermanently = false;
    while (!this.isDisposed) {
      try {
        this.pollCount += 1;
        if (this.pollCount % 10 === 1) {
          console.debug(
            `${LOG} Polling for work (poll #${this.pollCount}, activeSessions=${this.activeSessions.size}, intervalMs=${this.pollIntervalMs})`,
          );
        }
        const work = await this.apiClient.pollForWork(
          this.environmentId,
          this.environmentSecret,
          this.pollAbortController.signal,
        );
        this.backoffAttempt = 0;
        this.pollReregisterAttempts = 0;
        this.registration403Retries = 0;
        this.registration401Retries = 0;
        if (!work) {
          await this.pollSleep(this.pollIntervalMs);
          continue;
        }
        await this.handleWork(work);
      } catch (err) {
        if (this.isDisposed) return;
        if (err instanceof SessionsApiFatalError) {
          if ([401, 403, 404, 409].includes(err.status)) {
            if (this.pollReregisterAttempts >= POLL_REREGISTER_MAX) {
              console.error(
                `${LOG} Poll ${err.status} after ${this.pollReregisterAttempts} re-register attempt(s), giving up: ${err.message}`,
              );
              this.startFailedPermanently = true;
              this.trackSafe("lam_bridge_poll_reregister_gave_up", {
                status: err.status,
                attempts: this.pollReregisterAttempts,
                message: err.message,
              });
              return;
            }
            this.pollReregisterAttempts += 1;
            console.warn(
              `${LOG} Poll ${err.status}, re-registering (attempt ${this.pollReregisterAttempts}/${POLL_REREGISTER_MAX}): ${err.message}`,
            );
            this.trackSafe("lam_bridge_poll_reregister", {
              status: err.status,
              attempt: this.pollReregisterAttempts,
              message: err.message,
            });
            this.scheduleRetry(() => {
              void this.start();
            });
            return;
          }
        }
        const message = err instanceof Error ? err.message : String(err);
        if (
          err &&
          typeof err === "object" &&
          "name" in err &&
          (err as { name?: string }).name === "AbortError"
        ) {
          if (this.isDisposed) return;
          continue;
        }
        this.backoffAttempt += 1;
        const delay = Math.min(
          this.pollIntervalMs * 2 ** Math.min(this.backoffAttempt, 4),
          60_000,
        );
        console.warn(
          `${LOG} Poll error (backoff ${delay}ms): ${message}`,
        );
        await this.pollSleep(delay);
      }
    }
  }

  private async handleWork(work: SessionsBridgeWorkItem): Promise<void> {
    const type = work.data?.type;
    switch (type) {
      case "session":
        await this.handleSessionWork(work);
        break;
      case "healthcheck":
        console.debug(`${LOG} Received healthcheck, acknowledged`);
        break;
      default:
        console.warn(`${LOG} Unknown work type: ${type}`);
    }
  }

  /** Official safeStopWork */
  private async safeStopWork(workId: string, force: boolean): Promise<void> {
    if (!this.environmentId) return;
    try {
      await this.apiClient.stopWork(this.environmentId, workId, force);
    } catch (err) {
      console.error(`${LOG} Failed to stop work`, {
        workId,
        err,
      });
    }
  }

  /** Official getOrCreateBridgeLocalSessionId / p5 */
  private async getOrCreateBridgeLocalSessionId(): Promise<string> {
    const state = await this.readBridgeState();
    if (state.localSessionId) return state.localSessionId;
    const gen = state.localSessionGen ?? 0;
    const id = bridgeLocalSessionId(this.orgUuid, gen);
    await this.updateBridgeState((s) => ({ ...s, localSessionId: id }));
    return id;
  }

  private drainPreflights(reason: string): void {
    for (const [requestId, waiter] of this.preflightWaiting) {
      clearTimeout(waiter.timeoutId);
      this.preflightWaiting.delete(requestId);
      try {
        waiter.proceed({ denied: true, reason });
      } catch {
        /* ignore */
      }
    }
  }

  private async handleSessionWork(work: SessionsBridgeWorkItem): Promise<void> {
    const remoteSessionId = work.data?.id;
    const workId = work.id;
    if (typeof remoteSessionId !== "string" || !remoteSessionId) {
      console.error(`${LOG} Session work missing data.id work=${workId}`);
      await this.safeStopWork(workId, true);
      return;
    }

    const existing = this.activeSessions.get(remoteSessionId);
    if (existing) {
      let secret: SessionsBridgeWorkSecret;
      try {
        secret = decodeSessionsBridgeWorkSecret(work.secret);
      } catch (err) {
        if (existing.transport) {
          console.info(
            `${LOG} Session ${remoteSessionId} already active, ignoring duplicate work ${workId} (fresh secret decode failed: ${
              err instanceof Error ? err.message : String(err)
            })`,
          );
          return;
        }
        console.error(
          `${LOG} Failed to decode work secret on duplicate-work reconnect for ${remoteSessionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return;
      }
      if (secret.use_code_sessions !== true) {
        console.error(
          `${LOG} Received work ${workId} with use_code_sessions=${secret.use_code_sessions} — v1 transport was removed; backend dispatched v1 work to a v2-only bridge`,
        );
      }
      if (existing.transport) {
        if (
          secret.session_ingress_token !==
          existing.workSecret.session_ingress_token
        ) {
          console.info(
            `${LOG} Session ${remoteSessionId} already active; refreshing session_ingress_token from duplicate work ${workId}`,
          );
          existing.workSecret = secret;
          existing.workId = workId;
          await existing.transport
            .reconnectTransport?.({
              ingressToken: secret.session_ingress_token,
              apiBaseUrl: secret.api_base_url || this.apiHost,
            })
            .catch((err) => {
              console.error(
                `${LOG} reconnectTransport failed for ${remoteSessionId}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
        } else {
          console.info(
            `${LOG} Session ${remoteSessionId} already active, ignoring duplicate work ${workId}`,
          );
        }
        return;
      }
      console.info(
        `${LOG} Session ${remoteSessionId} has no transport; reconnecting from duplicate work ${workId}`,
      );
      existing.workId = workId;
      existing.workSecret = secret;
      existing.transportReconnectAttempts = 0;
      await this.connectSessionTransport(remoteSessionId, secret);
      return;
    }

    console.info(`${LOG} Handling session work`, {
      sessionId: remoteSessionId,
      workId,
    });

    let secret: SessionsBridgeWorkSecret;
    try {
      secret = decodeSessionsBridgeWorkSecret(work.secret);
    } catch (err) {
      console.error(
        `${LOG} Failed to decode work secret: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await this.safeStopWork(workId, true);
      return;
    }

    if (secret.use_code_sessions !== true) {
      console.error(
        `${LOG} Received work ${workId} with use_code_sessions=${secret.use_code_sessions} — v1 transport was removed; backend dispatched v1 work to a v2-only bridge`,
      );
      this.trackSafe("lam_bridge_unexpected_v1_work", {
        work_id: workId,
        session_id: remoteSessionId,
        use_code_sessions: secret.use_code_sessions,
      });
    }

    const localSessionId = await this.getOrCreateBridgeLocalSessionId();
    const priorRemote = this.localToRemoteSessionId.get(localSessionId);
    if (priorRemote && priorRemote !== remoteSessionId) {
      const displaced = this.activeSessions.get(priorRemote);
      console.error(
        `${LOG} Session collision: ${remoteSessionId} is displacing ${priorRemote} (both bound to ${localSessionId}, displaced pendingTurns=${
          displaced?.pendingTurns ?? 0
        })`,
      );
      this.trackSafe("lam_bridge_session_collision", {
        session_id: remoteSessionId,
        displaced_session_id: priorRemote,
        local_session_id: localSessionId,
        displaced_pending_turns: displaced?.pendingTurns ?? 0,
      });
      if (displaced) {
        this.drainPreflights("Session collision");
        this.clearSessionTimers(displaced);
        this.autoDenyPendingPermissionsForSession(
          displaced.localSessionId,
          "Session collision",
          "session_teardown",
          priorRemote,
        );
        this.releaseTurnBlocks(displaced);
        // Delete before close so setOnClose does not schedule reconnect
        const t = displaced.transport;
        displaced.transport = null;
        this.activeSessions.delete(priorRemote);
        t?.close();
      }
    }
    this.localToRemoteSessionId.set(localSessionId, remoteSessionId);

    const state = await this.readBridgeState();
    const isResume = remoteSessionId === state.remoteSessionId;
    this.trackSafe("lam_bridge_session_bound", {
      session_id: remoteSessionId,
      work_id: workId,
      local_session_id: localSessionId,
      is_resume: isResume,
    });
    const seedProcessed = isResume ? state.processedMessageUuids ?? [] : [];
    const seedAcks = isResume ? state.pendingProcessedAcks ?? [] : [];
    if (seedProcessed.length > 0) {
      console.info(
        `${LOG} Seeding ${seedProcessed.length} processedMessageUuids for reconnected session ${remoteSessionId}`,
      );
    }

    const session: ActiveBridgeSession = {
      workId,
      workSecret: secret,
      localSessionId,
      transport: null,
      inboundUserMessages: [],
      pendingTurns: 0,
      processedMessageUuids: new Set(seedProcessed),
      pendingProcessedAcks: new Set(seedAcks),
      transportReconnectAttempts: 0,
      transportConnectedAt: null,
      seedMessagesWritten: isResume,
      heldPSSAssertions: [],
      inflightEventIds: [],
      staleTurnTimer: null,
      ingressTokenRefreshTimer: null,
      writeQueue: Promise.resolve(),
      transportReconnectInFlight: false,
      capRedispatchAttempts: 0,
      queuedResultMsg: null,
    };
    this.activeSessions.set(remoteSessionId, session);

    if (!isResume) {
      await this.updateBridgeState((s) => ({
        ...s,
        remoteSessionId,
        processedMessageUuids: [],
        pendingProcessedAcks: [],
      }));
    }

    try {
      await this.connectSessionTransport(remoteSessionId, secret);
    } catch (err) {
      console.error(
        `${LOG} Failed to connect transport for session ${remoteSessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.activeSessions.delete(remoteSessionId);
      if (!isResume) {
        await this.updateBridgeState((s) =>
          s.remoteSessionId === remoteSessionId
            ? { ...s, remoteSessionId: state.remoteSessionId }
            : s,
        );
      }
      await this.safeStopWork(workId, true);
      return;
    }

    const bound = this.activeSessions.get(remoteSessionId);
    if (bound && seedAcks.length > 0 && bound.transport?.reportDelivery) {
      console.info(
        `${LOG} Acking ${seedAcks.length} pending processed events for session ${remoteSessionId}`,
      );
      for (const eventId of seedAcks) {
        bound.transport.reportDelivery(eventId, "processed");
      }
      bound.pendingProcessedAcks.clear();
    }

    this.emit("session_work", work);
    this.emit("remote_session_start", {
      remoteSessionId,
      workId,
      localSessionId,
    });
    this.onRemoteSessionStart?.({
      remoteSessionId,
      workId,
      localSessionId,
    });
    if (bound) await this.onSessionWork?.(work, bound);

    console.info(
      `${LOG} Session work received, waiting for user message via transport`,
      { sessionId: remoteSessionId, workId },
    );
  }

  private async connectSessionTransport(
    remoteSessionId: string,
    secret: SessionsBridgeWorkSecret,
  ): Promise<void> {
    const reconnectAttempt =
      this.activeSessions.get(remoteSessionId)?.transportReconnectAttempts ?? 0;
    console.info(`${LOG} Connecting transport for session ${remoteSessionId}`);
    const ingress = secret.session_ingress_token;
    // Official M6i: ft(R6i) → h6i inject else CCR. Product wires GrowthBook probe
    // when present; createSdkAdapterTransport inject only if deps supply one
    // (never invent SDK adapter body).
    const transport = await this.createTransport({
      workSecret: secret,
      sessionId: remoteSessionId,
      apiHost: this.apiHost,
      getAuthToken: () =>
        this.activeSessions.get(remoteSessionId)?.workSecret
          .session_ingress_token ?? ingress,
      isSdkAdapterFeatureEnabled: () => {
        try {
          // Lazy require — avoid hard cycle; probe may be unset in tests.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { isCoworkGrowthBookFeatureOn } = require("../coworkHostLoop/coworkGrowthBookFeatures") as {
            isCoworkGrowthBookFeatureOn?: (id: string) => boolean;
          };
          return (
            isCoworkGrowthBookFeatureOn?.(SESSIONS_BRIDGE_SDK_ADAPTER_FEATURE) ===
            true
          );
        } catch {
          return false;
        }
      },
    });

    const session = this.activeSessions.get(remoteSessionId);
    if (!session) {
      transport.close();
      return;
    }
    session.transport = transport;
    session.transportConnectedAt = null;

    transport.setOnData((raw) => {
      const cur = this.activeSessions.get(remoteSessionId);
      if (!cur) return;
      const now = Date.now();
      if (cur.transportConnectedAt === null) {
        cur.transportConnectedAt = now;
      } else if (
        cur.transportReconnectAttempts > 0 &&
        now - cur.transportConnectedAt >= SESSIONS_BRIDGE_RECONNECT_STABLE_MS
      ) {
        // Official F6i: stable uptime resets reconnect + cap counters
        cur.transportReconnectAttempts = 0;
        cur.capRedispatchAttempts = 0;
      }
      try {
        const message = JSON.parse(raw) as unknown;
        this.handleInboundMessage(remoteSessionId, message);
      } catch (err) {
        console.error(
          `${LOG} Failed to parse inbound message for session ${remoteSessionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });

    transport.setOnClose((code) => {
      console.info(
        `${LOG} Transport permanently closed for session ${remoteSessionId} code=${code}`,
      );
      const cur = this.activeSessions.get(remoteSessionId);
      if (!cur) return;
      if (cur.staleTurnTimer) {
        clearTimeout(cur.staleTurnTimer);
        cur.staleTurnTimer = null;
      }
      cur.transport = null;
      cur.transportConnectedAt = null;
      cur.inboundUserMessages = [];
      cur.inflightEventIds = [];
      this.trackSafe("lam_bridge_transport_closed", {
        session_id: remoteSessionId,
        code,
      });
      this.autoDenyPendingPermissionsForSession(
        cur.localSessionId,
        "Transport permanently closed",
        "transport_closed",
        remoteSessionId,
      );
      // Official: reconnectSessionTransport after permanent close
      void this.reconnectSessionTransport(remoteSessionId);
    });

    await transport.connect();
    console.info(
      `${LOG} Transport connected for session ${remoteSessionId} (reconnectAttempt=${reconnectAttempt})`,
    );
    this.trackSafe("lam_bridge_transport_connected", {
      session_id: remoteSessionId,
      reconnect_attempt: reconnectAttempt,
    });
    this.scheduleIngressTokenRefresh(remoteSessionId);
    this.writeDispatchSeedMessages(remoteSessionId);
    // Drain any result queued while transport was down
    const bound = this.activeSessions.get(remoteSessionId);
    if (bound?.queuedResultMsg && bound.transport) {
      const queued = bound.queuedResultMsg;
      bound.queuedResultMsg = null;
      console.info(
        `${LOG} Draining queued result for session ${remoteSessionId} after reconnect`,
      );
      bound.writeQueue = bound.writeQueue.then(async () => {
        if (!bound.transport) {
          bound.queuedResultMsg = queued;
          return;
        }
        try {
          await bound.transport.write(queued);
        } catch (err) {
          console.error(
            `${LOG} Failed to drain queued result for session ${remoteSessionId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          bound.queuedResultMsg = queued;
        }
      });
    }
  }

  /** Official reconnectSessionTransport residual. */
  private async reconnectSessionTransport(
    remoteSessionId: string,
  ): Promise<void> {
    if (this.isDisposed) return;
    const session = this.activeSessions.get(remoteSessionId);
    if (
      !session ||
      session.transport ||
      session.transportReconnectInFlight
    ) {
      return;
    }
    if (
      session.transportReconnectAttempts >= SESSIONS_BRIDGE_RECONNECT_MAX_ATTEMPTS
    ) {
      console.warn(
        `${LOG} Transport reconnect cap reached for session ${remoteSessionId} (${session.transportReconnectAttempts} attempts); triggering backend redispatch`,
      );
      this.trackSafe("lam_bridge_transport_reconnect_capped", {
        session_id: remoteSessionId,
        attempts: session.transportReconnectAttempts,
      });
      await this.redispatchCappedSession(remoteSessionId);
      return;
    }
    session.transportReconnectInFlight = true;
    const attempt = session.transportReconnectAttempts;
    session.transportReconnectAttempts = attempt + 1;
    const delay =
      attempt === 0
        ? 0
        : Math.min(
            SESSIONS_BRIDGE_RECONNECT_BASE_MS * 2 ** (attempt - 1),
            SESSIONS_BRIDGE_RECONNECT_MAX_MS,
          );
    console.info(
      `${LOG} Reconnecting transport for session ${remoteSessionId} (attempt ${attempt + 1}/${SESSIONS_BRIDGE_RECONNECT_MAX_ATTEMPTS}, delay=${delay}ms)`,
    );
    try {
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
        if (this.isDisposed || !this.activeSessions.has(remoteSessionId)) {
          return;
        }
      }
      await this.connectSessionTransport(remoteSessionId, session.workSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `${LOG} Transport reconnect failed for session ${remoteSessionId}: ${message}`,
      );
      session.transport = null;
      if (message.includes("registerWorker: HTTP 401")) {
        if (session.ingressTokenRefreshTimer) {
          clearTimeout(session.ingressTokenRefreshTimer);
          session.ingressTokenRefreshTimer = null;
        }
        await this.forceIngressTokenRedispatch(
          remoteSessionId,
          "reconnect_401",
        );
      }
    } finally {
      const cur = this.activeSessions.get(remoteSessionId);
      if (cur) cur.transportReconnectInFlight = false;
    }
  }

  /** Official redispatchCappedSession residual. */
  private async redispatchCappedSession(
    remoteSessionId: string,
  ): Promise<void> {
    if (this.isDisposed || !this.environmentId) return;
    const session = this.activeSessions.get(remoteSessionId);
    if (!session) return;
    if (session.capRedispatchAttempts >= SESSIONS_BRIDGE_CAP_REDISPATCH_MAX) {
      console.warn(
        `${LOG} Cap-redispatch budget exhausted for ${remoteSessionId} (${session.capRedispatchAttempts}); transport stays dead until app restart or system resume`,
      );
      return;
    }
    session.capRedispatchAttempts += 1;
    console.info(
      `${LOG} Redispatching capped session ${remoteSessionId} (attempt ${session.capRedispatchAttempts}/${SESSIONS_BRIDGE_CAP_REDISPATCH_MAX})`,
    );
    this.trackSafe("lam_bridge_transport_cap_redispatch", {
      session_id: remoteSessionId,
      attempt: session.capRedispatchAttempts,
      max: SESSIONS_BRIDGE_CAP_REDISPATCH_MAX,
    });
    try {
      await this.apiClient.reconnectSession(
        this.environmentId,
        remoteSessionId,
      );
      this.kickPollLoop();
    } catch (err) {
      console.warn(
        `${LOG} reconnectSession failed during cap-redispatch for ${remoteSessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Official scheduleIngressTokenRefresh residual. */
  private scheduleIngressTokenRefresh(remoteSessionId: string): void {
    const session = this.activeSessions.get(remoteSessionId);
    if (!session) return;
    if (session.ingressTokenRefreshTimer) {
      clearTimeout(session.ingressTokenRefreshTimer);
      session.ingressTokenRefreshTimer = null;
    }
    const exp = parseSessionIngressTokenExp(
      session.workSecret.session_ingress_token,
    );
    if (exp === null) {
      console.warn(
        `${LOG} Could not decode session_ingress_token expiry for session ${remoteSessionId}; proactive refresh disabled`,
      );
      return;
    }
    const delay = Math.max(
      0,
      Math.min(
        exp * 1_000 - Date.now() - SESSIONS_BRIDGE_INGRESS_REFRESH_LEAD_MS,
        SESSIONS_BRIDGE_INGRESS_REFRESH_MAX_MS,
      ),
    );
    console.info(
      `${LOG} Scheduled session_ingress_token refresh for ${remoteSessionId} in ${Math.round(delay / 1_000)}s (exp=${new Date(exp * 1_000).toISOString()})`,
    );
    session.ingressTokenRefreshTimer = setTimeout(() => {
      const cur = this.activeSessions.get(remoteSessionId);
      if (cur) cur.ingressTokenRefreshTimer = null;
      void this.forceIngressTokenRedispatch(remoteSessionId, "proactive_timer");
    }, delay);
  }

  /** Official forceIngressTokenRedispatch residual. */
  private async forceIngressTokenRedispatch(
    remoteSessionId: string,
    trigger: string,
  ): Promise<void> {
    if (
      this.isDisposed ||
      !this.environmentId ||
      !this.activeSessions.has(remoteSessionId)
    ) {
      return;
    }
    console.info(
      `${LOG} Forcing session_ingress_token refresh for ${remoteSessionId} (trigger=${trigger})`,
    );
    this.trackSafe("lam_bridge_ingress_token_refresh", {
      session_id: remoteSessionId,
      trigger,
    });
    try {
      await this.apiClient.reconnectSession(
        this.environmentId,
        remoteSessionId,
      );
      this.kickPollLoop();
    } catch (err) {
      console.warn(
        `${LOG} reconnectSession failed during ingress-token refresh for ${remoteSessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Official autoDenyPendingPermissionsForSession residual (minimal).
   * Full permission map resolve lands with Wave C; always drains preflights.
   */
  private autoDenyPendingPermissionsForSession(
    localSessionId: string,
    purpose: string,
    reasonCode: string,
    _remoteSessionId?: string,
  ): void {
    console.info(
      `${LOG} autoDenyPendingPermissions local=${localSessionId} purpose=${purpose} reason=${reasonCode}`,
    );
    // Official residual deny copy when transport unavailable.
    const denyMessage =
      "The sessions bridge transport is unavailable. Unable to request user consent.";
    const toDeny: string[] = [];
    for (const [requestId, pending] of this.pendingBridgePermissions) {
      if (pending.localSessionId === localSessionId) toDeny.push(requestId);
    }
    for (const requestId of toDeny) {
      const pending = this.pendingBridgePermissions.get(requestId);
      this.pendingBridgePermissions.delete(requestId);
      this.sessionManager?.resolvePendingPermission?.(requestId, {
        behavior: "deny",
        message: denyMessage,
        reason: reasonCode,
      });
      this.respondPreflight(requestId, {
        behavior: "deny",
        message: denyMessage,
        reason: reasonCode,
      });
      this.trackSafe("lam_bridge_permission_auto_denied", {
        session_id: _remoteSessionId ?? null,
        local_session_id: localSessionId,
        request_id: requestId,
        tool_name: pending?.toolName,
        purpose,
        reason: reasonCode,
      });
    }
    // Drain remaining preflight waiters for this bridge.
    this.drainPreflights(purpose);
    const session =
      [...this.activeSessions.values()].find(
        (s) => s.localSessionId === localSessionId,
      ) ?? null;
    if (session) this.releaseTurnBlocks(session);
  }

  /**
   * Official hasOutstandingPermissions residual.
   * includeExternal=false skips isExternal entries (stale re-arm path).
   */
  private hasOutstandingPermissions(
    localSessionId: string,
    opts: { includeExternal: boolean },
  ): boolean {
    for (const pending of this.pendingBridgePermissions.values()) {
      if (pending.localSessionId !== localSessionId) continue;
      if (!opts.includeExternal && pending.isExternal) continue;
      return true;
    }
    return false;
  }

  /**
   * Official setBridgeSessionStatus residual — transport.reportState + emit.
   * status is worker status string ("running" | "idle" | …).
   */
  private setBridgeSessionStatus(
    remoteSessionId: string,
    session: ActiveBridgeSession,
    status: string,
    extra?: unknown,
  ): void {
    try {
      session.transport?.reportState?.(
        extra !== undefined
          ? { worker_status: status, ...(typeof extra === "object" && extra ? extra : {}) }
          : { worker_status: status },
      );
    } catch {
      /* transport may be half-closed */
    }
    this.emit("bridge_session_status", {
      sessionId: remoteSessionId,
      status,
    });
  }

  /** Official releaseTurnBlocks residual (PSS + pendingTurns). */
  private releaseTurnBlocks(session: ActiveBridgeSession): void {
    releaseBridgeTurnPssAssertions(session.heldPSSAssertions, () => {
      for (const s of this.activeSessions.values()) {
        if (s !== session && s.heldPSSAssertions.length > 0) return true;
      }
      return false;
    });
    session.pendingTurns = 0;
    if (session.staleTurnTimer) {
      clearTimeout(session.staleTurnTimer);
      session.staleTurnTimer = null;
    }
  }

  /**
   * Official armStaleTurnTimer residual.
   * On fire: re-arm if permissions outstanding; else reset pendingTurns, idle
   * status, release PSS; optional reconnect when reconnectOnFire.
   */
  private armStaleTurnTimer(
    remoteSessionId: string,
    opts: { reconnectOnFire?: boolean } = {},
  ): void {
    const session = this.activeSessions.get(remoteSessionId);
    if (!session) return;
    if (session.staleTurnTimer) clearTimeout(session.staleTurnTimer);
    session.staleTurnTimer = setTimeout(() => {
      const cur = this.activeSessions.get(remoteSessionId);
      if (!cur || cur.pendingTurns === 0) return;
      if (
        this.hasOutstandingPermissions(cur.localSessionId, {
          includeExternal: false,
        })
      ) {
        console.info(
          `${LOG} Stale timer fired for session ${remoteSessionId} but ${cur.pendingTurns} turn(s) blocked on pending permission(s), re-arming`,
        );
        this.trackSafe("lam_bridge_stale_turn_rearm", {
          session_id: remoteSessionId,
          local_session_id: cur.localSessionId,
          pending_turns: cur.pendingTurns,
        });
        this.armStaleTurnTimer(remoteSessionId, opts);
        return;
      }
      const hasTransport = cur.transport !== null;
      const shouldReconnect = opts.reconnectOnFire === true && hasTransport;
      console.warn(
        `${LOG} Stale pendingTurns detected for session ${remoteSessionId} (pendingTurns=${cur.pendingTurns}), resetting counter${
          shouldReconnect
            ? " and reconnecting transport"
            : " and keeping transport open"
        }`,
      );
      this.trackSafe("lam_bridge_stale_turn_reset", {
        session_id: remoteSessionId,
        local_session_id: cur.localSessionId,
        pending_turns: cur.pendingTurns,
        stranded_messages: cur.inboundUserMessages.length,
        reconnect_triggered: shouldReconnect,
      });
      cur.pendingTurns = 0;
      this.setBridgeSessionStatus(remoteSessionId, cur, "idle");
      this.releaseTurnBlocks(cur);
      cur.staleTurnTimer = null;
      // Official: drop stranded inbound uuids from processed set so they can re-drive
      for (const item of cur.inboundUserMessages) {
        const uuid =
          item && typeof item === "object" && typeof (item as { uuid?: unknown }).uuid === "string"
            ? (item as { uuid: string }).uuid
            : null;
        if (uuid) {
          cur.processedMessageUuids.delete(uuid);
          console.info(
            `${LOG} [stale-reset] Removing stranded uuid ${uuid} from processedMessageUuids for session ${remoteSessionId}`,
          );
        }
      }
      if (cur.inboundUserMessages.length > 0) {
        void this.persistProcessedMessageUuids(remoteSessionId, cur);
      }
      cur.inboundUserMessages = [];
      cur.inflightEventIds = [];
      if (shouldReconnect && cur.transport) {
        const t = cur.transport;
        cur.transport = null;
        cur.transportConnectedAt = null;
        this.autoDenyPendingPermissionsForSession(
          cur.localSessionId,
          "Stale-turn transport reconnect",
          "stale_turn_reconnect",
          remoteSessionId,
        );
        t.close();
        void this.reconnectSessionTransport(remoteSessionId);
      }
    }, this.staleTurnMs);
  }

  private clearSessionTimers(session: ActiveBridgeSession): void {
    if (session.staleTurnTimer) {
      clearTimeout(session.staleTurnTimer);
      session.staleTurnTimer = null;
    }
    if (session.ingressTokenRefreshTimer) {
      clearTimeout(session.ingressTokenRefreshTimer);
      session.ingressTokenRefreshTimer = null;
    }
  }

  /** Official writeDispatchSeedMessages residual. */
  private writeDispatchSeedMessages(remoteSessionId: string): void {
    const session = this.activeSessions.get(remoteSessionId);
    if (!session || !session.transport) return;
    if (session.seedMessagesWritten) {
      console.info(
        `${LOG} Dispatch seed skipped for ${remoteSessionId} (already_written)`,
      );
      this.trackSafe("lam_bridge_dispatch_seed_skipped", {
        session_id: remoteSessionId,
        reason: "already_written",
      });
      return;
    }
    session.seedMessagesWritten = true;
    const agentNameEnabled =
      getSessionsBridgeStatusState().agentNameEnabled === true;
    const seeds = buildDispatchSeedAssistantMessages(
      remoteSessionId,
      agentNameEnabled,
    );
    const idleResult = buildDispatchSeedIdleResult(remoteSessionId);
    session.writeQueue = session.writeQueue.then(async () => {
      // Official: yield so pending inbound can land first
      await new Promise<void>((r) => setImmediate(r));
      const cur = this.activeSessions.get(remoteSessionId);
      if (!cur) return;
      if (cur.pendingTurns > 0 || cur.processedMessageUuids.size > 0) {
        console.info(
          `${LOG} Session ${remoteSessionId} already has content; writing idle result only`,
        );
        if (!cur.transport) {
          cur.queuedResultMsg = idleResult;
          return;
        }
        try {
          await cur.transport.write(idleResult);
        } catch (err) {
          cur.queuedResultMsg = idleResult;
          console.warn(
            `${LOG} Dispatch seed result write failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        return;
      }
      console.info(
        `${LOG} Writing ${seeds.length} Dispatch seed message(s) + idle result for session ${remoteSessionId}`,
      );
      this.trackSafe("lam_bridge_dispatch_seed_written", {
        session_id: remoteSessionId,
        seed_count: seeds.length,
      });
      for (const seed of seeds) {
        if (!cur.transport) {
          cur.queuedResultMsg = idleResult;
          return;
        }
        try {
          await cur.transport.write(seed);
        } catch (err) {
          console.warn(
            `${LOG} Dispatch seed write failed (uuid=${seed.uuid}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      if (cur.pendingTurns > 0) return;
      if (!cur.transport) {
        cur.queuedResultMsg = idleResult;
        return;
      }
      try {
        await cur.transport.write(idleResult);
      } catch (err) {
        cur.queuedResultMsg = idleResult;
        console.warn(
          `${LOG} Dispatch seed result write failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
  }

  /**
   * Official handleInboundMessage residual — only three types:
   *   user | control_response | control_request
   */
  private handleInboundMessage(
    remoteSessionId: string,
    message: unknown,
  ): void {
    if (!message || typeof message !== "object") return;
    const rec = message as { type?: unknown };
    const type = rec.type;
    console.debug(
      `${LOG} Inbound message for session ${remoteSessionId}: type=${String(type)}`,
    );
    this.emit("inbound_message", { remoteSessionId, message });
    this.onInboundMessage?.(remoteSessionId, message);

    if (type === "user") {
      void this.handleInboundUserMessage(remoteSessionId, message);
      return;
    }
    if (type === "control_response") {
      this.handleInboundControlResponse(remoteSessionId, message);
      return;
    }
    if (type === "control_request") {
      this.handleInboundControlRequest(remoteSessionId, message);
    }
  }

  /** Official handleInboundUserMessage residual. */
  private async handleInboundUserMessage(
    remoteSessionId: string,
    message: unknown,
  ): Promise<void> {
    const session = this.activeSessions.get(remoteSessionId);
    if (!session) return;
    const rec = message as {
      uuid?: unknown;
      message?: { content?: unknown };
      content?: unknown;
    };
    const uuid = typeof rec.uuid === "string" ? rec.uuid : null;
    if (uuid && session.processedMessageUuids.has(uuid)) {
      console.info(
        `${LOG} Skipping replayed message ${uuid} for session ${remoteSessionId}, sending processed ack`,
      );
      session.transport?.reportDelivery?.(uuid, "processed");
      session.pendingProcessedAcks.delete(uuid);
      return;
    }
    if (session.staleTurnTimer) {
      clearTimeout(session.staleTurnTimer);
      session.staleTurnTimer = null;
    }
    const baseText = extractInboundUserText(message);
    // Official j9i residual — file_attachments before Z9i materialize
    const fileAttachments = parseBridgeFileAttachments(message);
    if (uuid) {
      session.inboundUserMessages.push({ uuid });
      session.processedMessageUuids.add(uuid);
      void this.persistProcessedMessageUuids(remoteSessionId, session);
    }
    console.info(
      `${LOG} Received user message for session ${remoteSessionId} (${baseText.length} chars${
        fileAttachments.length
          ? ` + ${fileAttachments.length} attachment${
              fileAttachments.length === 1 ? "" : "s"
            }`
          : ""
      })`,
    );
    this.trackSafe("lam_bridge_user_message_received", {
      session_id: remoteSessionId,
      message_uuid: uuid,
      local_session_id: session.localSessionId,
      chars: baseText.length,
      attachments: fileAttachments.length,
    });
    // Official PSS residual: createPreventSystemSleepAssertion when ready (else 0)
    const pssId = createBridgeTurnPssAssertion();
    session.heldPSSAssertions.push(pssId);
    session.pendingTurns += 1;
    if (uuid) {
      session.inflightEventIds.push(uuid);
      session.transport?.reportDelivery?.(uuid, "processing");
      session.pendingProcessedAcks.add(uuid);
      void this.persistPendingProcessedAcks(remoteSessionId, session);
    }
    this.setBridgeSessionStatus(remoteSessionId, session, "running");
    this.armStaleTurnTimer(remoteSessionId);

    // Official Z9i residual — materialize attachments then prefix text + send
    let localPaths: string[] = [];
    if (fileAttachments.length > 0) {
      localPaths = await materializeBridgeAttachments(fileAttachments, {
        apiHost: this.apiHost,
        orgUuid: this.orgUuid,
        getAccessToken: this.getOAuthToken,
        pendingUploadsDir: this.userDataDir
          ? getBridgePendingUploadsDir(this.userDataDir)
          : undefined,
      });
    }
    const text = prefixBridgeMessageWithAttachmentPaths(baseText, localPaths);
    const filesArg = localPaths.length > 0 ? localPaths : undefined;

    const localId = session.localSessionId;
    const sm = this.sessionManager;
    if (localId && sm?.hasSession?.(localId) && sm.sendMessage) {
      try {
        sm.seedWebFetchProvenance?.(localId, text);
        // Channel is carried on remote_session_start emit; manager sendMessage
        // residual has no channel arg (images/files/uuid/toolStates only).
        await sm.sendMessage(
          localId,
          text,
          undefined,
          filesArg,
          uuid ?? undefined,
        );
        this.trackSafe("lam_bridge_followup_fast_path", {
          session_id: remoteSessionId,
          message_uuid: uuid,
          local_session_id: localId,
          outcome: "hit",
        });
        return;
      } catch (err) {
        console.warn(
          `${LOG} Fast-path sendMessage threw for session ${remoteSessionId}, falling back to renderer: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.trackSafe("lam_bridge_followup_fast_path", {
          session_id: remoteSessionId,
          message_uuid: uuid,
          local_session_id: localId,
          outcome: "fallback",
        });
      }
    }
    const payload = {
      orchestrationRequestId: session.workId,
      message: text,
      channel: "sessions_api",
      // Official Mc residual: sessionType "agent"
      sessionType: "agent" as const,
      messageUuid: uuid,
      sessionStart: {
        sessionId: localId,
        model: session.workSecret.claude_code_args?.model,
        ...(filesArg ? { userSelectedFiles: filesArg } : {}),
      },
      remoteSessionId,
      workId: session.workId,
      localSessionId: localId,
    };
    this.emit("remote_session_start", payload);
    this.onRemoteSessionStart?.(payload);
    this.trackSafe("lam_bridge_message_forwarded", {
      session_id: remoteSessionId,
      message_uuid: uuid,
      local_session_id: localId,
      path: "remote_session_start",
    });
  }

  /** Official handleInboundControlRequest residual — interrupt only. */
  private handleInboundControlRequest(
    remoteSessionId: string,
    message: unknown,
  ): void {
    const session = this.activeSessions.get(remoteSessionId);
    const rec = message as {
      request_id?: unknown;
      requestId?: unknown;
      request?: { subtype?: unknown; tool_name?: unknown; toolName?: unknown };
    };
    const requestId =
      typeof rec.request_id === "string"
        ? rec.request_id
        : typeof rec.requestId === "string"
          ? rec.requestId
          : null;
    const subtype =
      rec.request && typeof rec.request === "object"
        ? (rec.request as { subtype?: unknown }).subtype
        : undefined;

    // Non-interrupt control_request → preflight surface residual
    if (subtype !== "interrupt") {
      if (requestId && session) {
        const toolName =
          typeof rec.request?.tool_name === "string"
            ? rec.request.tool_name
            : typeof rec.request?.toolName === "string"
              ? rec.request.toolName
              : "unknown";
        this.pendingBridgePermissions.set(requestId, {
          localSessionId: session.localSessionId,
          toolName,
          requestedAt: Date.now(),
          isExternal: false,
        });
        const payload = {
          requestId,
          remoteSessionId,
          localSessionId: session.localSessionId,
          request: message,
        };
        // Park waiter so UI respondPreflight can resolve
        void this.waitPreflight(requestId);
        this.dispatchBridgePermissionPreflight?.(payload);
        this.onBridgePermissionPreflight?.(payload);
        this.emit("bridge_permission_preflight", payload);
        this.trackSafe("lam_bridge_permission_posted", {
          session_id: remoteSessionId,
          local_session_id: session.localSessionId,
          request_id: requestId,
          tool_name: toolName,
        });
      }
      return;
    }

    if (!session) {
      console.info(
        `${LOG} interrupt control_request no_session remote=${remoteSessionId}`,
      );
      this.trackSafe("lam_bridge_interrupt_received", {
        session_id: remoteSessionId,
        local_session_id: null,
        request_id: requestId,
        outcome: "no_session",
      });
      return;
    }
    const local = session.localSessionId;
    if (!local) {
      console.info(
        `${LOG} interrupt control_request no_local_session remote=${remoteSessionId}`,
      );
      this.trackSafe("lam_bridge_interrupt_received", {
        session_id: remoteSessionId,
        local_session_id: null,
        request_id: requestId,
        outcome: "no_local_session",
      });
      return;
    }
    console.info(
      `${LOG} Received interrupt control_request for session ${remoteSessionId} (local=${local})`,
    );
    this.trackSafe("lam_bridge_interrupt_received", {
      session_id: remoteSessionId,
      local_session_id: local,
      request_id: requestId,
      outcome: "interrupted",
    });
    void this.sessionManager?.interruptTurn?.(local);
  }

  /** Official handleInboundControlResponse residual. */
  private handleInboundControlResponse(
    remoteSessionId: string,
    message: unknown,
  ): void {
    const rec = message as {
      response?: {
        request_id?: unknown;
        response?: { behavior?: unknown; [k: string]: unknown };
      };
    };
    const response = rec.response;
    const requestId =
      response && typeof response.request_id === "string"
        ? response.request_id
        : null;
    const inner = response?.response;
    if (!requestId || !inner || typeof inner !== "object") {
      console.warn(
        `${LOG} Malformed control_response for session ${remoteSessionId}`,
      );
      return;
    }
    const pending = this.pendingBridgePermissions.get(requestId);
    if (!pending) return;
    this.pendingBridgePermissions.delete(requestId);
    const behavior =
      typeof (inner as { behavior?: unknown }).behavior === "string"
        ? String((inner as { behavior: string }).behavior)
        : "deny";
    const resolution = { behavior, ...(inner as object) };
    this.sessionManager?.resolvePendingPermission?.(requestId, resolution);
    // Resolve preflight waiter if present
    this.respondPreflight(requestId, resolution);

    const session = this.activeSessions.get(remoteSessionId);
    if (session?.transport) {
      const echo = {
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response: { behavior },
        },
      };
      session.writeQueue = session.writeQueue.then(async () => {
        if (!session.transport) {
          console.warn(
            `${LOG} Transport closed while echo was queued; dropping control_response echo for ${requestId}`,
          );
          return;
        }
        try {
          await session.transport.write(echo);
        } catch (err) {
          console.warn(
            `${LOG} Failed to echo control_response for ${requestId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      });
    }
    this.trackSafe("lam_bridge_permission_resolved", {
      session_id: remoteSessionId,
      local_session_id: pending.localSessionId,
      tool_name: pending.toolName,
      behavior,
      latency_ms: Date.now() - pending.requestedAt,
    });
    // Official restoreRunningStateIfNoPendingPermissions residual
    this.restoreRunningStateIfNoPendingPermissions(remoteSessionId);
  }

  /**
   * Official restoreRunningStateIfNoPendingPermissions residual:
   * if transport still up and no outstanding perms (incl external),
   * report running when pendingTurns>0 else idle.
   */
  private restoreRunningStateIfNoPendingPermissions(
    remoteSessionId: string,
  ): void {
    const session = this.activeSessions.get(remoteSessionId);
    if (!session?.transport) return;
    if (
      this.hasOutstandingPermissions(session.localSessionId, {
        includeExternal: true,
      })
    ) {
      return;
    }
    this.setBridgeSessionStatus(
      remoteSessionId,
      session,
      session.pendingTurns > 0 ? "running" : "idle",
    );
  }

  private async persistProcessedMessageUuids(
    remoteSessionId: string,
    session: ActiveBridgeSession,
  ): Promise<void> {
    await this.updateBridgeState((s) =>
      s.remoteSessionId === remoteSessionId || !s.remoteSessionId
        ? {
            ...s,
            remoteSessionId,
            processedMessageUuids: [...session.processedMessageUuids],
          }
        : s,
    );
  }

  private async persistPendingProcessedAcks(
    remoteSessionId: string,
    session: ActiveBridgeSession,
  ): Promise<void> {
    await this.updateBridgeState((s) =>
      s.remoteSessionId === remoteSessionId || !s.remoteSessionId
        ? {
            ...s,
            remoteSessionId,
            pendingProcessedAcks: [...session.pendingProcessedAcks],
          }
        : s,
    );
  }

  async forceNewLocalSession(): Promise<void> {
    const local = (await this.readBridgeState()).localSessionId;
    if (!local || this.activeSessions.size === 0) {
      console.info(`${LOG} forceNewLocalSession: no active local session, no-op`);
      return;
    }
    this.drainPreflights("Local session was reset");
    const remote = this.localToRemoteSessionId.get(local);
    if (remote) {
      const session = this.activeSessions.get(remote);
      if (session) {
        this.clearSessionTimers(session);
        this.releaseTurnBlocks(session);
        const t = session.transport;
        session.transport = null;
        this.activeSessions.delete(remote);
        t?.close();
      } else {
        this.activeSessions.delete(remote);
      }
      this.localToRemoteSessionId.delete(local);
    }
    await this.updateBridgeState((s) => ({
      ...s,
      localSessionId: undefined,
      localSessionGen: (s.localSessionGen ?? 0) + 1,
      remoteSessionId: undefined,
      processedMessageUuids: undefined,
      pendingProcessedAcks: undefined,
    }));
  }

  async forgetSession(localSessionId: string): Promise<void> {
    const remotes: string[] = [];
    for (const [remote, session] of this.activeSessions) {
      if (session.localSessionId === localSessionId) remotes.push(remote);
    }
    if (remotes.length > 0) {
      this.drainPreflights("Session deleted");
      for (const remote of remotes) {
        const session = this.activeSessions.get(remote);
        if (session) {
          this.clearSessionTimers(session);
          this.autoDenyPendingPermissionsForSession(
            session.localSessionId,
            "Session deleted",
            "session_teardown",
            remote,
          );
          this.releaseTurnBlocks(session);
          const t = session.transport;
          session.transport = null;
          this.activeSessions.delete(remote);
          t?.close();
        } else {
          this.activeSessions.delete(remote);
        }
      }
    }
    this.localToRemoteSessionId.delete(localSessionId);
    await this.updateBridgeState((s) =>
      s.localSessionId === localSessionId
        ? {
            ...s,
            remoteSessionId: undefined,
            localSessionId: undefined,
            localSessionGen: undefined,
            processedMessageUuids: undefined,
            pendingProcessedAcks: undefined,
            dispatchAgentName: undefined,
          }
        : s,
    );
    patchSessionsBridgeStatus({ dispatchAgentName: null });
  }

  async abandonEnvironment(): Promise<void> {
    const env = this.environmentId;
    console.info(
      `${LOG} Abandoning environment ${env ?? "(none)"} — wiping bridge-state for fresh registration`,
    );
    this.trackSafe("lam_bridge_abandon_deregister", {
      environment_id: env,
      active_sessions: this.activeSessions.size,
    });
    const abandonTransports: BridgeSessionTransport[] = [];
    for (const session of this.activeSessions.values()) {
      this.clearSessionTimers(session);
      this.releaseTurnBlocks(session);
      if (session.transport) {
        abandonTransports.push(session.transport);
        session.transport = null;
      }
    }
    this.activeSessions.clear();
    this.localToRemoteSessionId.clear();
    for (const t of abandonTransports) t.close();
    this.drainPreflights("Environment abandoned");
    if (env) {
      try {
        await this.apiClient.deregisterEnvironment(env);
      } catch (err) {
        console.info(
          `${LOG} abandonEnvironment deregister failed (continuing with local wipe): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    this.environmentId = null;
    this.environmentSecret = null;
    await this.updateBridgeState((s) => ({
      ...s,
      environmentId: undefined,
      remoteSessionId: undefined,
      localSessionId: undefined,
      localSessionGen: undefined,
      processedMessageUuids: undefined,
      pendingProcessedAcks: undefined,
    }));
  }

  /** Official respondPreflight / takePreflight residual */
  respondPreflight(requestId: unknown, proceed: unknown): void {
    if (typeof requestId !== "string" || !requestId) return;
    const waiter = this.preflightWaiting.get(requestId);
    if (!waiter) return;
    clearTimeout(waiter.timeoutId);
    this.preflightWaiting.delete(requestId);
    waiter.proceed(proceed);
  }

  /**
   * Park a preflight waiter (product residual for permission bridge).
   * Official takePreflight resolves when UI calls respondPreflight.
   */
  waitPreflight(
    requestId: string,
    timeoutMs = 120_000,
  ): Promise<unknown> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.preflightWaiting.delete(requestId);
        resolve({ denied: true, reason: "timeout" });
      }, timeoutMs);
      this.preflightWaiting.set(requestId, {
        proceed: resolve,
        timeoutId,
      });
    });
  }

  /** Thin analytics residual — never throw into control flow. */
  private trackSafe(event: string, props?: Record<string, unknown>): void {
    try {
      this.track?.(event, props);
    } catch (err) {
      console.warn(
        `${LOG} track failed event=${event}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Official LZe bridge-poll claim residual + woA reschedule.
   * AC 5min / battery 15min defaults via createBridgePollWakeClaim.
   */
  private registerBridgePollWakeClaim(): void {
    if (this.isDisposed) return;
    try {
      registerWakeSchedulerClaim(
        createBridgePollWakeClaim({
          isDisposed: () => this.isDisposed,
          isOnBatteryPower: () => this.probeOnBatteryPower(),
        }),
      );
      void rescheduleWakeFromClaims().then((r) => {
        console.info(
          `${LOG} bridge-poll claim registered; woA scheduledEpoch=${
            r.scheduledEpochMs ?? "null"
          } claims=${r.claimCount}`,
        );
      });
    } catch (err) {
      console.warn(
        `${LOG} bridge-poll claim register failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private unregisterBridgePollWakeClaim(): void {
    try {
      unregisterWakeSchedulerClaim(BRIDGE_POLL_CLAIM_ID);
    } catch {
      /* */
    }
  }

  private probeOnBatteryPower(): boolean {
    if (this.isOnBatteryPowerInject) {
      try {
        return this.isOnBatteryPowerInject() === true;
      } catch {
        return false;
      }
    }
    const pm = this.resolvePowerMonitor();
    try {
      return pm?.isOnBatteryPower?.() === true;
    } catch {
      return false;
    }
  }

  private resolvePowerMonitor(): SessionsBridgeClientDeps["powerMonitor"] | null {
    if (this.powerMonitorInject) return this.powerMonitorInject;
    try {
      // Lazy require — vitest / non-electron hosts may lack powerMonitor.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require("electron") as {
        powerMonitor?: SessionsBridgeClientDeps["powerMonitor"];
      };
      return electron.powerMonitor ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Official powerMonitor resume + j_A darkwake residual.
   * Reset cap counters; restart if permanently failed else kick poll;
   * re-arm ingress refresh; woA reschedule.
   */
  async handleSystemResumed(
    source: "resume" | "darkwake" | string = "resume",
  ): Promise<void> {
    if (this.isDisposed) return;
    console.info(`${LOG} system_resumed source=${source}`);
    this.trackSafe("lam_bridge_system_resumed", {
      source,
      startFailedPermanently: this.startFailedPermanently,
      activeSessions: this.activeSessions.size,
    });
    for (const session of this.activeSessions.values()) {
      session.capRedispatchAttempts = 0;
    }
    for (const remoteId of this.activeSessions.keys()) {
      this.scheduleIngressTokenRefresh(remoteId);
    }
    void rescheduleWakeFromClaims().catch(() => undefined);
    if (this.startFailedPermanently) {
      this.startFailedPermanently = false;
      void this.start();
      return;
    }
    this.kickPollLoop();
  }

  private bindSystemResumeListeners(): void {
    if (this.systemResumeBound || this.isDisposed) return;
    this.systemResumeBound = true;
    const pm = this.resolvePowerMonitor();
    try {
      pm?.on?.("resume", this.onSystemResumed);
    } catch (err) {
      console.warn(
        `${LOG} powerMonitor resume bind failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    try {
      wakeSchedulerEvents.on("darkwake", this.onDarkWake);
    } catch {
      /* */
    }
  }

  private unbindSystemResumeListeners(): void {
    if (!this.systemResumeBound) return;
    this.systemResumeBound = false;
    const pm = this.resolvePowerMonitor();
    try {
      pm?.off?.("resume", this.onSystemResumed) ??
        pm?.removeListener?.("resume", this.onSystemResumed);
    } catch {
      /* */
    }
    try {
      wakeSchedulerEvents.off("darkwake", this.onDarkWake);
    } catch {
      /* */
    }
  }

  async dispose(): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;
    console.info(`${LOG} Disposing...`);
    this.unbindSystemResumeListeners();
    this.unregisterBridgePollWakeClaim();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.pollAbortController?.abort();
    this.pollAbortController = null;
    this.pollSleepKickController?.abort();
    this.pollSleepKickController = null;
    this.drainPreflights("Bridge disposed");
    const disposeTransports: BridgeSessionTransport[] = [];
    for (const session of this.activeSessions.values()) {
      this.clearSessionTimers(session);
      this.releaseTurnBlocks(session);
      if (session.transport) {
        disposeTransports.push(session.transport);
        session.transport = null;
      }
    }
    this.activeSessions.clear();
    this.localToRemoteSessionId.clear();
    for (const t of disposeTransports) t.close();
    patchSessionsBridgeStatus({ remoteOrchestratorMode: false });
    this.removeAllListeners();
    await this.pollLoopPromise?.catch(() => undefined);
  }
}

/** Official EQ singleton residual */
let activeClient: SessionsBridgeClient | null = null;

export function getSessionsBridgeClient(): SessionsBridgeClient | null {
  return activeClient;
}

/** Official X6i */
export function startSessionsBridgeClient(
  deps: SessionsBridgeClientDeps,
): SessionsBridgeClient {
  if (activeClient) {
    void activeClient.dispose();
  }
  activeClient = new SessionsBridgeClient(deps);
  void activeClient.start();
  return activeClient;
}

/** Official wkA */
export async function disposeSessionsBridgeClient(): Promise<void> {
  const cur = activeClient;
  if (!cur) return;
  await cur.dispose();
  if (activeClient === cur) activeClient = null;
}

export function resetSessionsBridgeClientForTests(): void {
  activeClient = null;
}
