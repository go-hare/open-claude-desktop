/**
 * Official app.asar MCP enable-map helpers for LocalAgentModeSessionManager:
 *   jC  — remote/local server key for replaceRemoteMcpServers
 *   jMA — server tools all-disabled under enabledMcpTools map
 *   kJi — per-tool enable flip within a server prefix
 *   d6e — reconcile diff plan (toCreate / toDelete)
 *   tv  — dispatch session types skip replaceEnabledMcpTools
 *
 * Full mcpCoordinator.reconcileServers / createAllServers / Ii().syncUserToolToggles
 * remain product residuals. applyMcpServersIfIdle + setMcpServers dirty/defer are
 * product (#126) via coworkMcpApplyHelpers (createMcpServer inject residual).
 */

/** Official Mc / DE — tv() session types that skip replaceEnabledMcpTools. */
export const COWORK_DISPATCH_SESSION_TYPES = Object.freeze([
  "agent",
  "dispatch_child",
] as const);

export type CoworkEnabledMcpToolsMap = Record<string, boolean | undefined>;

export type CoworkRemoteMcpServerConfig = {
  name: string;
  tools: Array<{ name: string } | string>;
  type?: string;
  uuid: string;
};

export type CoworkMcpReconcilePlan = {
  toCreate: {
    internal: string[];
    local: string[];
    remote: CoworkRemoteMcpServerConfig[];
  };
  toDelete: Array<{ key: string; name: string }>;
};

/** Official tv — agent | dispatch_child. */
export function isCoworkDispatchSessionType(
  sessionType: string | null | undefined,
): boolean {
  return (
    sessionType === "agent" || sessionType === "dispatch_child"
  );
}

/**
 * Official jC — server identity for remote replace equality:
 *   local type or reserved p1 names → name; else uuid.
 * Product p1 residual: only treat type==="local" as name key when no list inject.
 */
export function resolveCoworkRemoteMcpServerKey(
  server: Pick<CoworkRemoteMcpServerConfig, "name" | "type" | "uuid">,
  localNameList: readonly string[] = [],
): string {
  if (server.type === "local" || localNameList.includes(server.name)) {
    return server.name;
  }
  return server.uuid;
}

/**
 * Official jMA(e,A) — true when map has keys under `${server}:` and every value is false.
 * Missing map / no prefix keys → false (not "disabled").
 */
export function isCoworkMcpServerToolsDisabled(
  serverKey: string,
  enabledMap: CoworkEnabledMcpToolsMap | null | undefined,
): boolean {
  if (!enabledMap) return false;
  const prefix = `${serverKey}:`;
  const entries = Object.entries(enabledMap).filter(([key]) =>
    key.startsWith(prefix),
  );
  if (entries.length === 0) return false;
  return entries.every(([, value]) => value === false);
}

/**
 * Official kJi(e,A,t) — true when any tool under `${server}:` flipped
 * between previous/new maps (enabled = value !== false).
 */
export function hasCoworkMcpServerToolToggleDiff(
  serverKey: string,
  previous: CoworkEnabledMcpToolsMap | null | undefined,
  next: CoworkEnabledMcpToolsMap,
): boolean {
  const prefix = `${serverKey}:`;
  const keys = new Set<string>();
  for (const key of Object.keys(previous ?? {})) {
    if (key.startsWith(prefix)) keys.add(key);
  }
  for (const key of Object.keys(next)) {
    if (key.startsWith(prefix)) keys.add(key);
  }
  for (const key of keys) {
    const prevOn = (previous?.[key] ?? undefined) !== false;
    const nextOn = next[key] !== false;
    if (prevOn !== nextOn) return true;
  }
  return false;
}

/**
 * Official d6e — build create/delete plan for local/remote/internal servers.
 * Action per server key g with toggle prefix c:
 *   jMA(prev) && !jMA(next) → create
 *   !jMA(prev) && jMA(next) → delete
 *   !jMA(next) && (!active.has(g) || kJi) → create
 *   else noop
 */
export function diffCoworkEnabledMcpTools(input: {
  currentActiveServerKeys?: ReadonlySet<string> | null;
  internalServerNames?: readonly string[];
  localServerNames?: readonly string[];
  newEnabledMcpTools: CoworkEnabledMcpToolsMap;
  previousEnabledMcpTools?: CoworkEnabledMcpToolsMap | null;
  remoteServers?: readonly CoworkRemoteMcpServerConfig[];
}): CoworkMcpReconcilePlan {
  const previous = input.previousEnabledMcpTools ?? null;
  const next = input.newEnabledMcpTools;
  const active = input.currentActiveServerKeys ?? new Set<string>();
  const plan: CoworkMcpReconcilePlan = {
    toCreate: { internal: [], local: [], remote: [] },
    toDelete: [],
  };

  const action = (
    serverId: string,
    toggleKey: string,
  ): "create" | "delete" | "noop" => {
    const prevDisabled = isCoworkMcpServerToolsDisabled(toggleKey, previous);
    const nextDisabled = isCoworkMcpServerToolsDisabled(toggleKey, next);
    if (prevDisabled && !nextDisabled) return "create";
    if (!prevDisabled && nextDisabled) return "delete";
    if (
      !nextDisabled &&
      (!active.has(serverId) ||
        hasCoworkMcpServerToolToggleDiff(toggleKey, previous, next))
    ) {
      return "create";
    }
    return "noop";
  };

  for (const name of input.localServerNames ?? []) {
    const result = action(name, `local:${name}`);
    if (result === "create") plan.toCreate.local.push(name);
    else if (result === "delete") plan.toDelete.push({ key: name, name });
  }
  for (const server of input.remoteServers ?? []) {
    const result = action(server.uuid, server.uuid);
    if (result === "create") plan.toCreate.remote.push(server);
    else if (result === "delete") {
      plan.toDelete.push({ key: server.uuid, name: server.name });
    }
  }
  for (const name of input.internalServerNames ?? []) {
    const result = action(name, `local:${name}`);
    if (result === "create") plan.toCreate.internal.push(name);
    else if (result === "delete") plan.toDelete.push({ key: name, name });
  }
  return plan;
}

/** Official early equality: same keys and same values. */
export function coworkEnabledMcpToolsEqual(
  previous: CoworkEnabledMcpToolsMap | null | undefined,
  next: CoworkEnabledMcpToolsMap,
): boolean {
  const prevKeys = Object.keys(previous ?? {});
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  return nextKeys.every((key) => (previous ?? {})[key] === next[key]);
}

/**
 * Official replaceEnabledMcpTools decision (pre-reconcile):
 *   tv(sessionType) → skip
 *   equality → noop return current
 *   else apply
 */
export function resolveCoworkReplaceEnabledMcpToolsChange(input: {
  currentEnabledMcpTools?: CoworkEnabledMcpToolsMap | null;
  requested: unknown;
  sessionType?: string | null;
}):
  | { action: "skip_dispatch"; enabledMcpTools: CoworkEnabledMcpToolsMap }
  | { action: "noop"; enabledMcpTools: CoworkEnabledMcpToolsMap }
  | {
      action: "apply";
      nextEnabledMcpTools: CoworkEnabledMcpToolsMap;
      previousEnabledMcpTools: CoworkEnabledMcpToolsMap | null;
    } {
  const current =
    (input.currentEnabledMcpTools as CoworkEnabledMcpToolsMap | null) ?? null;
  const currentSafe: CoworkEnabledMcpToolsMap = current ?? {};

  if (isCoworkDispatchSessionType(input.sessionType)) {
    return { action: "skip_dispatch", enabledMcpTools: currentSafe };
  }

  const next = coerceCoworkEnabledMcpToolsArg(input.requested);
  if (coworkEnabledMcpToolsEqual(current, next)) {
    return { action: "noop", enabledMcpTools: currentSafe };
  }
  return {
    action: "apply",
    nextEnabledMcpTools: next,
    previousEnabledMcpTools: current,
  };
}

/**
 * Official t.tools object. Accepts:
 *   { tools: Record }  (IPC payload)
 *   Record             (already the tools map)
 */
export function coerceCoworkEnabledMcpToolsArg(
  value: unknown,
): CoworkEnabledMcpToolsMap {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const tools =
    record.tools && typeof record.tools === "object" && !Array.isArray(record.tools)
      ? (record.tools as Record<string, unknown>)
      : record;
  // Array form is non-official (legacy product); treat as empty map honesty.
  if (Array.isArray(tools)) return {};
  const out: CoworkEnabledMcpToolsMap = {};
  for (const [key, raw] of Object.entries(tools)) {
    if (typeof raw === "boolean") out[key] = raw;
    else if (raw === undefined) out[key] = undefined;
  }
  return out;
}

/** Official remote tool names: tools.map(c => c.name).sort() (objects); string form product honesty. */
export function coworkRemoteMcpToolNames(
  tools: CoworkRemoteMcpServerConfig["tools"] | unknown,
): string[] {
  if (!Array.isArray(tools)) return [];
  const names: string[] = [];
  for (const item of tools) {
    if (typeof item === "string" && item.length > 0) names.push(item);
    else if (
      item &&
      typeof item === "object" &&
      typeof (item as { name?: unknown }).name === "string" &&
      (item as { name: string }).name.length > 0
    ) {
      names.push((item as { name: string }).name);
    }
  }
  return names.sort();
}

/**
 * Official replaceRemoteMcpServers equality (before assign):
 *   same jC key set size + every next key in prev
 *   and for each next server, sorted tool names equal prev map entry.
 * Double-negated asar: if !(sizeDiff || missingKey || toolDiff) → equal/noop.
 */
export function coworkRemoteMcpServersEqual(
  previous: readonly CoworkRemoteMcpServerConfig[] | null | undefined,
  next: readonly CoworkRemoteMcpServerConfig[],
  localNameList: readonly string[] = [],
): boolean {
  const prev = previous ?? [];
  const prevKeys = new Set(
    prev.map((server) => resolveCoworkRemoteMcpServerKey(server, localNameList)),
  );
  const nextKeys = new Set(
    next.map((server) => resolveCoworkRemoteMcpServerKey(server, localNameList)),
  );
  if (prevKeys.size !== nextKeys.size) return false;
  for (const key of nextKeys) {
    if (!prevKeys.has(key)) return false;
  }
  const prevToolsByKey = new Map(
    prev.map((server) => [
      resolveCoworkRemoteMcpServerKey(server, localNameList),
      coworkRemoteMcpToolNames(server.tools),
    ]),
  );
  for (const server of next) {
    const key = resolveCoworkRemoteMcpServerKey(server, localNameList);
    const prevNames = prevToolsByKey.get(key);
    const nextNames = coworkRemoteMcpToolNames(server.tools);
    if (
      !prevNames ||
      prevNames.length !== nextNames.length ||
      prevNames.some((name, index) => name !== nextNames[index])
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Official assign shape: t.map(g => ({ uuid, name, tools })).
 * Coerce unknown IPC array into sanitized configs; drop invalid entries.
 * MUe also requires toolKeys string[] on the wire — product keeps tools only
 * (official save strips to uuid/name/tools).
 */
export function coerceCoworkRemoteMcpServersArg(
  value: unknown,
): CoworkRemoteMcpServerConfig[] {
  if (!Array.isArray(value)) return [];
  const out: CoworkRemoteMcpServerConfig[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.uuid !== "string" || record.uuid.length === 0) continue;
    if (typeof record.name !== "string" || record.name.length === 0) continue;
    if (!Array.isArray(record.tools)) continue;
    const tools: CoworkRemoteMcpServerConfig["tools"] = [];
    for (const tool of record.tools) {
      if (typeof tool === "string" && tool.length > 0) tools.push(tool);
      else if (
        tool &&
        typeof tool === "object" &&
        typeof (tool as { name?: unknown }).name === "string" &&
        (tool as { name: string }).name.length > 0
      ) {
        tools.push({ name: (tool as { name: string }).name });
      }
    }
    const server: CoworkRemoteMcpServerConfig = {
      name: record.name,
      tools,
      uuid: record.uuid,
    };
    if (typeof record.type === "string") server.type = record.type;
    out.push(server);
  }
  return out;
}

/**
 * Official replaceRemoteMcpServers decision (pre-live-reconcile):
 *   equality → noop return current enabledMcpTools
 *   else apply (assign remote config residual of createRemoteServers)
 */
export function resolveCoworkReplaceRemoteMcpServersChange(input: {
  currentEnabledMcpTools?: CoworkEnabledMcpToolsMap | null;
  currentRemoteServers?: readonly CoworkRemoteMcpServerConfig[] | null;
  localNameList?: readonly string[];
  requested: unknown;
}):
  | {
      action: "noop";
      enabledMcpTools: CoworkEnabledMcpToolsMap;
    }
  | {
      action: "apply";
      enabledMcpTools: CoworkEnabledMcpToolsMap;
      nextRemoteServers: CoworkRemoteMcpServerConfig[];
      previousRemoteServers: CoworkRemoteMcpServerConfig[];
    } {
  const enabled: CoworkEnabledMcpToolsMap =
    (input.currentEnabledMcpTools as CoworkEnabledMcpToolsMap | null) ?? {};
  const previous = [...(input.currentRemoteServers ?? [])];
  const next = coerceCoworkRemoteMcpServersArg(input.requested);
  if (
    coworkRemoteMcpServersEqual(
      previous,
      next,
      input.localNameList ?? [],
    )
  ) {
    return { action: "noop", enabledMcpTools: enabled };
  }
  // Official assign: only uuid/name/tools (type optional residual for jC).
  const nextRemoteServers = next.map((server) => ({
    name: server.name,
    tools: server.tools,
    uuid: server.uuid,
    ...(server.type !== undefined ? { type: server.type } : {}),
  }));
  return {
    action: "apply",
    enabledMcpTools: enabled,
    nextRemoteServers,
    previousRemoteServers: previous,
  };
}
