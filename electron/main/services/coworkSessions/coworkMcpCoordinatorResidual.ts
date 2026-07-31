/**
 * Residual of official mcpCoordinator inject surface (app.asar LocalMcpServerManager
 * / mcpCoordinator) — not a full createAllServers / proxyManager product invent.
 *
 * Covers:
 * - registerRootsProvider / unregisterRootsProvider (rootsGetters map)
 * - createMcpServer (local config bag → {key, server})
 * - createRemoteServers (remote list → active key bag)
 *
 * Wire as CoworkSessionManager inject defaults so setMcpServers / replaceRemote /
 * start-stop roots are residual-real without inventing isolationExempt / stdio proxy.
 */

import { resolveCoworkRemoteMcpServerKey } from "./coworkMcpToolsState";
import type { CoworkSetMcpServerItem } from "./coworkMcpApplyHelpers";
import type {
  CoworkEnabledMcpToolsMap,
  CoworkRemoteMcpServerConfig,
} from "./coworkMcpToolsState";

export type CoworkMcpRootsGetter = () => Promise<string[]> | string[];

export type CoworkCreateMcpServerResult = {
  key: string;
  server: unknown;
};

/**
 * Official LocalMcpServerManager.rootsGetters residual.
 * notifyRootsChanged / sendRootsListChanged not product (no live MCP roots clients).
 */
export class CoworkMcpRootsRegistry {
  private readonly getters = new Map<string, CoworkMcpRootsGetter>();

  register(sessionId: string, getRoots: CoworkMcpRootsGetter): void {
    this.getters.set(sessionId, getRoots);
  }

  unregister(sessionId: string): void {
    this.getters.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.getters.has(sessionId);
  }

  async getRoots(sessionId: string): Promise<string[]> {
    const getter = this.getters.get(sessionId);
    if (!getter) return [];
    const value = await getter();
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  }

  clear(): void {
    this.getters.clear();
  }
}

/** Process-default registry used by product CoworkSessionManager injects. */
export const defaultCoworkMcpRootsRegistry = new CoworkMcpRootsRegistry();

export function createDefaultRegisterRootsProvider(
  registry: CoworkMcpRootsRegistry = defaultCoworkMcpRootsRegistry,
): (sessionId: string, getRoots: CoworkMcpRootsGetter) => void {
  return (sessionId, getRoots) => {
    registry.register(sessionId, getRoots);
  };
}

export function createDefaultUnregisterRootsProvider(
  registry: CoworkMcpRootsRegistry = defaultCoworkMcpRootsRegistry,
): (sessionId: string) => void {
  return (sessionId) => {
    registry.unregister(sessionId);
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Official createMcpServer residual (local branch):
 *   key = jC(server); look up local mcpServers[name]; return {key, server:config}
 * Internal / direct-MCP OAuth branches not invented — null when no local config.
 */
export function createCoworkMcpServerResidual(
  server: CoworkSetMcpServerItem,
  localConfigs: Record<string, unknown> | null | undefined,
  localNameList: readonly string[] = [],
): CoworkCreateMcpServerResult | null {
  if (!server.enabled) return null;
  const key = resolveCoworkRemoteMcpServerKey(server, localNameList);
  const configs = localConfigs ?? {};
  // Prefer name match for local; also allow uuid key if bag uses uuid.
  const byName = configs[server.name];
  const byUuid = configs[server.uuid];
  const config =
    (typeof byName === "object" && byName !== null
      ? byName
      : typeof byUuid === "object" && byUuid !== null
        ? byUuid
        : null) ??
    // type local with missing bag → honest null (official warns + null)
    null;
  if (!config) {
    // Remote-only enable without local bag: still place a residual descriptor so
    // activeMcpServers tracks the key (query setMcpServers merge residual).
    if (server.type !== "local") {
      return {
        key,
        server: {
          type: server.type ?? "remote",
          name: server.name,
          uuid: server.uuid,
          tools: server.tools ?? [],
        },
      };
    }
    return null;
  }
  return {
    key,
    server: {
      ...asRecord(config),
      name: server.name,
      uuid: server.uuid,
    },
  };
}

/**
 * Official createRemoteServers residual when no directMcpServers / proxyManager:
 * map remote list → bag keyed by jC, values are residual remote descriptors.
 * Does not invent OAuth proxy or syncUserToolToggles product stores.
 */
export function createCoworkRemoteMcpServersResidual(input: {
  enabledMcpTools?: CoworkEnabledMcpToolsMap | null;
  remoteMcpServers: readonly CoworkRemoteMcpServerConfig[];
  localNameList?: readonly string[];
}): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  const localNameList = input.localNameList ?? [];
  for (const remote of input.remoteMcpServers) {
    const key = resolveCoworkRemoteMcpServerKey(remote, localNameList);
    bag[key] = {
      type: remote.type ?? "remote",
      name: remote.name,
      uuid: remote.uuid,
      tools: remote.tools,
    };
  }
  return bag;
}

export type CreateMcpServerInject = (
  sessionId: string,
  server: CoworkSetMcpServerItem,
) =>
  | CoworkCreateMcpServerResult
  | null
  | undefined
  | Promise<CoworkCreateMcpServerResult | null | undefined>;

export type CreateRemoteMcpServersInject = (
  sessionId: string,
  input: {
    enabledMcpTools?: unknown;
    remoteMcpServers: CoworkRemoteMcpServerConfig[];
  },
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/**
 * Build inject trio for CoworkSessionManager options (product defaults).
 * getLocalMcpConfigs: settings.getMcpServersConfig() residual bag.
 */
export function createCoworkMcpCoordinatorInjects(options?: {
  getLocalMcpConfigs?: () => Record<string, unknown>;
  localNameList?: () => readonly string[];
  rootsRegistry?: CoworkMcpRootsRegistry;
}): {
  registerRootsProvider: ReturnType<typeof createDefaultRegisterRootsProvider>;
  unregisterRootsProvider: ReturnType<typeof createDefaultUnregisterRootsProvider>;
  createMcpServer: CreateMcpServerInject;
  createRemoteMcpServers: CreateRemoteMcpServersInject;
  rootsRegistry: CoworkMcpRootsRegistry;
} {
  const registry = options?.rootsRegistry ?? defaultCoworkMcpRootsRegistry;
  return {
    rootsRegistry: registry,
    registerRootsProvider: createDefaultRegisterRootsProvider(registry),
    unregisterRootsProvider: createDefaultUnregisterRootsProvider(registry),
    createMcpServer: async (_sessionId, server) =>
      createCoworkMcpServerResidual(
        server,
        options?.getLocalMcpConfigs?.() ?? {},
        options?.localNameList?.() ?? [],
      ),
    createRemoteMcpServers: async (_sessionId, input) =>
      createCoworkRemoteMcpServersResidual({
        enabledMcpTools: input.enabledMcpTools as CoworkEnabledMcpToolsMap | undefined,
        remoteMcpServers: input.remoteMcpServers,
        localNameList: options?.localNameList?.() ?? [],
      }),
  };
}
