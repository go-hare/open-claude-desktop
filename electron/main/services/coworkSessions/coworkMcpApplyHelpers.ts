/**
 * Official LocalAgentModeSessionManager MCP apply residual (app.asar):
 *   Wl(e) = lifecycleState !== "idle" && !== "archived"
 *   rwA(servers) = ft("2800354941") ? sort entries by key : servers
 *   applyMcpServersIfIdle(session, servers):
 *     if (!query || Wl(session)) {
 *       Wl → mcpServersDirty=true + debug defer
 *       return
 *     }
 *     mcpServersDirty=false; await query.setMcpServers(rwA(servers))
 *   idle-grace arm warm branch:
 *     if mcpServersDirty && activeMcpServers:
 *       dirty=false; query.setMcpServers(rwA(active)).catch(warn)
 *   replaceRemote (query branch):
 *     drop previous remote jC keys not in next; assign createRemoteServers;
 *     activeMcpServers=merged; applyMcpServersIfIdle
 *   replaceEnabled (query branch):
 *     reconcileServers residual → active + applyMcpServersIfIdle
 *   setMcpServers(sessionId, servers[]):
 *     tv skip; createMcpServer residual inject; apply; save; invalidate
 *
 * Residual honesty: full mcpCoordinator / createAllServers / createRemoteServers
 * / reconcileServers / Ii().syncUserToolToggles product stores not invented —
 * injects optional; pure merge/delete + dirty/apply always product.
 */

import {
  isCoworkDispatchSessionType,
  resolveCoworkRemoteMcpServerKey,
  type CoworkEnabledMcpToolsMap,
  type CoworkRemoteMcpServerConfig,
} from "./coworkMcpToolsState";

/** Official Wl — busy for applyMcpServersIfIdle (not idle and not archived). */
export function isCoworkSessionBusyForMcpApply(
  lifecycleState: string | null | undefined,
): boolean {
  return lifecycleState !== "idle" && lifecycleState !== "archived";
}

/**
 * Official rwA — optional key-sort for SDK setMcpServers payload.
 * Statsig ft("2800354941") residual: default false (identity).
 */
export function sortCoworkMcpServersForSet(
  servers: Record<string, unknown>,
  sortKeys = false,
): Record<string, unknown> {
  if (!sortKeys) return servers;
  return Object.fromEntries(
    Object.entries(servers).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export type CoworkApplyMcpServersDecision =
  | { action: "apply"; servers: Record<string, unknown> }
  | { action: "defer"; lifecycleState: string }
  | { action: "skip_no_query" };

/**
 * Official applyMcpServersIfIdle gate (pure decision).
 * Caller sets dirty on defer and invokes query.setMcpServers on apply.
 */
export function resolveCoworkApplyMcpServersIfIdle(input: {
  hasQuery: boolean;
  lifecycleState?: string | null;
  servers: Record<string, unknown>;
  /** Official ft("2800354941") residual. */
  sortKeys?: boolean;
}): CoworkApplyMcpServersDecision {
  const busy = isCoworkSessionBusyForMcpApply(input.lifecycleState);
  if (!input.hasQuery || busy) {
    if (busy) {
      return {
        action: "defer",
        lifecycleState: input.lifecycleState ?? "unknown",
      };
    }
    return { action: "skip_no_query" };
  }
  return {
    action: "apply",
    servers: sortCoworkMcpServersForSet(
      input.servers,
      input.sortKeys === true,
    ),
  };
}

/**
 * Official replaceRemote query branch merge:
 *   c = { ...active }
 *   for prev remote: if !nextKeys.has(jC(prev)) delete c[jC]
 *   Object.assign(c, createRemoteServers(...))
 */
export function mergeCoworkActiveMcpServersAfterRemoteReplace(input: {
  activeMcpServers?: Record<string, unknown> | null;
  createdRemoteServers?: Record<string, unknown> | null;
  localNameList?: readonly string[];
  nextRemoteKeys: ReadonlySet<string>;
  previousRemote: readonly CoworkRemoteMcpServerConfig[];
}): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(input.activeMcpServers ?? {}),
  };
  for (const prev of input.previousRemote) {
    const key = resolveCoworkRemoteMcpServerKey(prev, input.localNameList);
    if (!input.nextRemoteKeys.has(key)) {
      delete next[key];
    }
  }
  Object.assign(next, input.createdRemoteServers ?? {});
  return next;
}

/** Official setMcpServers IPC/item shape (subset used by product residual). */
export type CoworkSetMcpServerItem = {
  enabled: boolean;
  name: string;
  toolKeys?: string[];
  tools?: Array<{ name: string } | string>;
  type?: string;
  uuid: string;
};

export type CoworkSetMcpServersDecision =
  | {
      action: "skip_dispatch";
      enabledMcpTools: CoworkEnabledMcpToolsMap;
    }
  | {
      action: "apply";
      enabledMcpTools: CoworkEnabledMcpToolsMap;
      /** Keys removed from active when disabled (jC). */
      removedActiveKeys: string[];
      remoteMcpServersConfig: CoworkRemoteMcpServerConfig[];
      /** Enabled items that need createMcpServer inject (residual). */
      toCreate: CoworkSetMcpServerItem[];
    };

/**
 * Official setMcpServers(A,t) pure decision before createMcpServer inject:
 *   tv → skip
 *   disabled → drop active jC + drop remote by jC
 *   enabled remote → push remote config if missing
 *   toolKeys → enabledMcpTools[key]=enabled
 * createMcpServer itself remains inject residual.
 */
export function resolveCoworkSetMcpServersChange(input: {
  activeMcpServers?: Record<string, unknown> | null;
  currentEnabledMcpTools?: CoworkEnabledMcpToolsMap | null;
  currentRemoteServers?: CoworkRemoteMcpServerConfig[] | null;
  localNameList?: readonly string[];
  requested: readonly CoworkSetMcpServerItem[];
  sessionType?: string | null;
}): CoworkSetMcpServersDecision {
  const enabled: CoworkEnabledMcpToolsMap = {
    ...(input.currentEnabledMcpTools ?? {}),
  };
  if (isCoworkDispatchSessionType(input.sessionType)) {
    return { action: "skip_dispatch", enabledMcpTools: enabled };
  }

  const remote = [...(input.currentRemoteServers ?? [])];
  const removedActiveKeys: string[] = [];
  const toCreate: CoworkSetMcpServerItem[] = [];
  const localNameList = input.localNameList ?? [];

  for (const item of input.requested) {
    if (item.enabled) {
      toCreate.push(item);
      if (item.type !== "local") {
        const exists = remote.some((r) => r.uuid === item.uuid);
        if (!exists) {
          remote.push({
            name: item.name,
            tools: item.tools ?? [],
            type: item.type,
            uuid: item.uuid,
          });
        }
      }
    } else {
      const key = resolveCoworkRemoteMcpServerKey(item, localNameList);
      removedActiveKeys.push(key);
      if (item.type !== "local") {
        const idx = remote.findIndex(
          (r) =>
            resolveCoworkRemoteMcpServerKey(r, localNameList) ===
            resolveCoworkRemoteMcpServerKey(item, localNameList),
        );
        if (idx !== -1) remote.splice(idx, 1);
      }
    }
    if (item.toolKeys) {
      for (const toolKey of item.toolKeys) {
        enabled[toolKey] = item.enabled;
      }
    }
  }

  return {
    action: "apply",
    enabledMcpTools: enabled,
    removedActiveKeys,
    remoteMcpServersConfig: remote,
    toCreate,
  };
}

/** Apply jC removals to a copy of active servers. */
export function removeCoworkActiveMcpServerKeys(
  active: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  const next = { ...(active ?? {}) };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

/**
 * Whether idle-grace arm warm branch should flush deferred setMcpServers.
 * Official: mcpServersDirty && activeMcpServers (truthy object).
 */
export function shouldFlushCoworkDeferredMcpServers(input: {
  activeMcpServers?: Record<string, unknown> | null;
  mcpServersDirty?: boolean;
}): boolean {
  return (
    input.mcpServersDirty === true &&
    input.activeMcpServers != null &&
    typeof input.activeMcpServers === "object"
  );
}
