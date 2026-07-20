import { randomUUID } from "node:crypto";
import type {
  CoworkPendingPermission,
  CoworkPermissionDecision,
  CoworkPermissionEvent,
  CoworkPermissionRequestOptions,
  CoworkPermissionResolution,
  CoworkToolPermissionRequest,
} from "./coworkSessionTypes";

export type CoworkPermissionBrokerOptions = {
  createRequestId?: () => string;
  emit: (event: CoworkPermissionEvent) => void;
  now?: () => number;
  /** Official je("lam_tool_permission_requested") after emit request. */
  onRequested?: (pending: CoworkPendingPermission) => void;
  /** Official je("lam_tool_permission_responded") on user decision only. */
  onResponded?: (
    pending: CoworkPendingPermission,
    decision: CoworkPermissionDecision,
    latencyMs: number,
  ) => void;
  /** Official je("lam_tool_permission_stalled") after 300s while still pending. */
  onStalled?: (pending: CoworkPendingPermission) => void;
  persistAlwaysAllow?: (
    pending: CoworkPendingPermission,
    resolution: CoworkPermissionResolution,
  ) => void;
  stalledAfterMs?: number;
};

const requestDirectoryTool = "mcp__cowork__request_cowork_directory";
const defaultStalledAfterMs = 300_000;

function ownerSessionId(permission: CoworkPermissionRequestOptions): string {
  return permission.ownerSessionId ?? permission.sessionId;
}

function inputIdentity(input: unknown): string | undefined {
  return JSON.stringify(input);
}

function isSupersedingTool(toolName: string): boolean {
  return ["browser:", "computer:", "webfetch:"].some((prefix) =>
    toolName.startsWith(prefix),
  );
}

export class CoworkPermissionBroker {
  private readonly createRequestId: () => string;
  private readonly emit: (event: CoworkPermissionEvent) => void;
  private readonly now: () => number;
  private readonly onRequested?: CoworkPermissionBrokerOptions["onRequested"];
  private readonly onResponded?: CoworkPermissionBrokerOptions["onResponded"];
  private readonly onStalled?: CoworkPermissionBrokerOptions["onStalled"];
  private readonly pendingPermissions = new Map<
    string,
    CoworkPendingPermission
  >();
  private readonly persistAlwaysAllow?: CoworkPermissionBrokerOptions["persistAlwaysAllow"];
  private readonly stalledAfterMs: number;

  constructor(options: CoworkPermissionBrokerOptions) {
    this.createRequestId = options.createRequestId ?? randomUUID;
    this.emit = options.emit;
    this.now = options.now ?? Date.now;
    this.onRequested = options.onRequested;
    this.onResponded = options.onResponded;
    this.onStalled = options.onStalled;
    this.persistAlwaysAllow = options.persistAlwaysAllow;
    this.stalledAfterMs = options.stalledAfterMs ?? defaultStalledAfterMs;
  }

  get size(): number {
    return this.pendingPermissions.size;
  }

  requestPermission(
    options: CoworkPermissionRequestOptions,
  ): Promise<CoworkPermissionResolution> {
    const requestId = this.createRequestId();
    this.supersedeMatching(options);
    return new Promise((resolve) => {
      if (options.signal?.aborted) {
        resolve({ behavior: "deny", message: "Request aborted" });
        return;
      }
      const pending = this.createPendingPermission(requestId, options, resolve);
      this.pendingPermissions.set(requestId, pending);
      this.startStalledTimer(pending);
      this.emit({
        request: this.toToolPermissionRequest(pending),
        sessionId: pending.sessionId,
        type: "tool_permission_request",
      });
      this.onRequested?.(pending);
    });
  }

  respondToToolPermission(
    requestId: string,
    decision: CoworkPermissionDecision,
    updatedInput?: unknown,
  ): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return;
    const latencyMs = this.now() - pending.requestedAt;
    const resolution = this.userDecisionResolution(
      pending,
      decision,
      updatedInput,
    );
    if (decision === "always") this.persistAlwaysAllow?.(pending, resolution);
    this.onResponded?.(pending, decision, latencyMs);
    this.finish(requestId, resolution);
  }

  resolvePendingPermission(
    requestId: string,
    resolution: CoworkPermissionResolution,
  ): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return;
    if (resolution.behavior === "allow" && resolution.updatedPermissions) {
      this.persistAlwaysAllow?.(pending, resolution);
    }
    this.finish(requestId, resolution);
  }

  denyPendingPermissionsForSession(sessionId: string, message: string): void {
    const requestIds = [...this.pendingPermissions]
      .filter(([, pending]) => !pending.isExternal)
      .filter(
        ([, pending]) =>
          pending.sessionId === sessionId ||
          pending.ownerSessionId === sessionId,
      )
      .map(([requestId]) => requestId);
    for (const requestId of requestIds) {
      this.resolvePendingPermission(requestId, { behavior: "deny", message });
    }
  }

  getPendingForSession(sessionId: string): CoworkToolPermissionRequest[] {
    return [...this.pendingPermissions.values()]
      .filter(
        (pending) => pending.sessionId === sessionId && !pending.isExternal,
      )
      .map((pending) => this.toToolPermissionRequest(pending));
  }

  private createPendingPermission(
    requestId: string,
    options: CoworkPermissionRequestOptions,
    resolve: (resolution: CoworkPermissionResolution) => void,
  ): CoworkPendingPermission {
    const pending: CoworkPendingPermission = {
      ...options,
      requestId,
      requestedAt: this.now(),
      resolve,
    };
    if (!options.signal) return pending;
    const onAbort = () =>
      this.finish(requestId, { behavior: "deny", message: "Request aborted" });
    options.signal.addEventListener("abort", onAbort, { once: true });
    pending.abortCleanup = () =>
      options.signal?.removeEventListener("abort", onAbort);
    return pending;
  }

  private startStalledTimer(pending: CoworkPendingPermission): void {
    if (!this.onStalled) return;
    const timer = setTimeout(() => {
      // Official: only fire while pendingPermissions still has this requestId.
      if (!this.pendingPermissions.has(pending.requestId)) return;
      this.onStalled?.(pending);
    }, this.stalledAfterMs);
    pending.stalledCleanup = () => clearTimeout(timer);
  }

  private supersedeMatching(options: CoworkPermissionRequestOptions): void {
    if (!isSupersedingTool(options.toolName)) return;
    const ownerId = ownerSessionId(options);
    const inputKey = inputIdentity(options.input);
    for (const [requestId, pending] of [...this.pendingPermissions]) {
      const matchesOwner = ownerSessionId(pending) === ownerId;
      const matchesInput = inputIdentity(pending.input) === inputKey;
      if (
        !matchesOwner ||
        pending.toolName !== options.toolName ||
        !matchesInput
      )
        continue;
      this.finish(
        requestId,
        { behavior: "deny", message: "Superseded by new permission request" },
        options.sessionId,
      );
    }
  }

  private userDecisionResolution(
    pending: CoworkPendingPermission,
    decision: CoworkPermissionDecision,
    updatedInput?: unknown,
  ): CoworkPermissionResolution {
    if (decision === "deny") {
      return {
        behavior: "deny",
        decisionClassification: "user_reject",
        interrupt: false,
        message: `User rejected ${pending.toolName}.`,
      };
    }
    const resolution: CoworkPermissionResolution = {
      behavior: "allow",
      decisionClassification:
        decision === "always" ? "user_permanent" : "user_temporary",
      updatedInput: updatedInput ?? pending.input,
    };
    if (decision === "always" && pending.toolName !== requestDirectoryTool) {
      resolution.updatedPermissions = pending.suggestions;
    }
    return resolution;
  }

  private finish(
    requestId: string,
    resolution: CoworkPermissionResolution,
    eventSessionId?: string,
  ): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;
    this.pendingPermissions.delete(requestId);
    pending.abortCleanup?.();
    pending.stalledCleanup?.();
    this.emitResolved(pending, eventSessionId ?? pending.sessionId);
    pending.resolve(resolution);
    return true;
  }

  private emitResolved(
    pending: CoworkPendingPermission,
    sessionId: string,
  ): void {
    this.emit({
      request: {
        input: pending.input,
        requestId: pending.requestId,
        sessionId,
        toolName: pending.toolName,
      },
      sessionId,
      type: "tool_permission_resolved",
    });
  }

  private toToolPermissionRequest(
    pending: CoworkPendingPermission,
  ): CoworkToolPermissionRequest {
    return {
      channel: pending.channel,
      input: pending.input,
      requestId: pending.requestId,
      sessionId: pending.sessionId,
      suggestions: pending.suggestions,
      toolName: pending.toolName,
    };
  }
}
