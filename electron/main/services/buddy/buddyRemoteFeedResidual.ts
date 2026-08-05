/**
 * Official BuddyRemoteFeed residual (app.asar Hrr / txt).
 *
 * - sync(sessions): store sessions array; emit remote_sync (void return)
 * - getAllSessions(): current sessions
 * - respondToToolPermission(requestId, decision): dispatch permissionDecision
 *   to registered dispatchers when matching pendingToolPermissions
 *
 * Never invents { ok:true, items:[] }.
 *
 * data-official-source: app.asar class Hrr / bUt / yb / txt.for.setImplementation
 */

export type BuddyRemotePendingToolPermission = {
  requestId: string;
  sessionId: string;
  toolName: string;
  suggestions?: unknown[];
  channel?: string;
  decisionReason?: unknown;
  [key: string]: unknown;
};

export type BuddyRemoteFeedSession = {
  sessionId: string;
  isRunning: boolean;
  pendingToolPermissions: BuddyRemotePendingToolPermission[];
  [key: string]: unknown;
};

/** Official yb residual (required fields only). */
export function isBuddyRemotePendingPermission(
  value: unknown,
): value is BuddyRemotePendingToolPermission {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.requestId === "string" &&
    typeof o.sessionId === "string" &&
    typeof o.toolName === "string"
  );
}

/** Official bUt residual. */
export function isBuddyRemoteFeedSession(
  value: unknown,
): value is BuddyRemoteFeedSession {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (typeof o.sessionId !== "string") return false;
  if (typeof o.isRunning !== "boolean") return false;
  if (!Array.isArray(o.pendingToolPermissions)) return false;
  return o.pendingToolPermissions.every(isBuddyRemotePendingPermission);
}

export function parseBuddyRemoteFeedSessions(
  raw: unknown,
): BuddyRemoteFeedSession[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      'Argument "sessions" at position 0 to method "sync" in interface "BuddyRemoteFeed" failed to pass validation',
    );
  }
  if (!raw.every(isBuddyRemoteFeedSession)) {
    throw new Error(
      'Argument "sessions" at position 0 to method "sync" in interface "BuddyRemoteFeed" failed to pass validation',
    );
  }
  return raw;
}

export type BuddyRemotePermissionDispatcher = {
  dispatchPermissionDecision: (
    sessionId: string,
    requestId: string,
    decision: string,
  ) => void;
};

/**
 * Official Hrr residual body (in-memory sessions + dispatcher set).
 */
export class BuddyRemoteFeedResidual {
  private sessions: BuddyRemoteFeedSession[] = [];
  private dispatchers = new Set<BuddyRemotePermissionDispatcher>();
  private onRemoteSync: (() => void) | null = null;

  setRemoteSyncListener(listener: (() => void) | null): void {
    this.onRemoteSync = listener;
  }

  registerDispatcher(dispatcher: BuddyRemotePermissionDispatcher): () => void {
    this.dispatchers.add(dispatcher);
    return () => {
      this.dispatchers.delete(dispatcher);
      if (this.dispatchers.size === 0) {
        this.sessions = [];
      }
    };
  }

  /** Official sync: store sessions; emit remote_sync; void. */
  sync(raw: unknown): void {
    this.sessions = parseBuddyRemoteFeedSessions(raw);
    this.onRemoteSync?.();
  }

  getAllSessions(): BuddyRemoteFeedSession[] {
    return this.sessions;
  }

  /**
   * Official respondToToolPermission residual:
   * find first session with matching pending requestId → dispatch to all.
   */
  respondToToolPermission(requestId: string, decision: string): boolean {
    if (this.dispatchers.size === 0) return false;
    for (const session of this.sessions) {
      const pending = session.pendingToolPermissions.find(
        (p) => p.requestId === requestId,
      );
      if (pending) {
        console.info(
          `[buddy-remote] forwarding ${decision} for ${pending.toolName} → bridge session ${session.sessionId}`,
        );
        for (const d of this.dispatchers) {
          d.dispatchPermissionDecision(session.sessionId, requestId, decision);
        }
        return true;
      }
    }
    return false;
  }
}

let singleton: BuddyRemoteFeedResidual | null = null;

export function getBuddyRemoteFeedResidual(): BuddyRemoteFeedResidual {
  if (!singleton) singleton = new BuddyRemoteFeedResidual();
  return singleton;
}
