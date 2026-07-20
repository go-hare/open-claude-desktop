/**
 * Official mcpDirectoryBridge (app.asar wPA / Yxi / c9e):
 * main dispatches LocalAgentModeSessions.onEvent
 *   { type: directory_servers_* | slash_menu_* | plugins_search | addable_skills_search,
 *     sessionId, data: JSON.stringify({ requestId, ...payload }) }
 * web responds via respondDirectoryServers(requestId, servers[]).
 */
import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { dispatchBridgeEvent } from "../../ipc/registerIpc";

export type CoworkDirectoryServer = {
  description?: string;
  enabledInChat?: boolean;
  iconUrl?: string;
  isConnected?: boolean;
  name: string;
  oneLiner?: string;
  toolNames?: string[];
  url?: string;
  uuid: string;
};

type PendingRequest = {
  resolve: (servers: CoworkDirectoryServer[]) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const DIRECTORY_TIMEOUT_MS = 10_000;
const pendingDirectory = new Map<string, PendingRequest>();

export type CoworkDirectoryBridgeDispatcher = {
  emit: (event: {
    data: string;
    sessionId: string;
    type:
      | "directory_servers_search"
      | "directory_servers_lookup"
      | "directory_servers_list_installed";
  }) => void;
};

let activeDispatcher: CoworkDirectoryBridgeDispatcher | null = null;

export function setCoworkDirectoryBridgeDispatcher(
  dispatcher: CoworkDirectoryBridgeDispatcher | null,
): void {
  activeDispatcher = dispatcher;
}

export function createWebContentsDirectoryDispatcher(
  getWebContents: () => WebContents | null | undefined,
): CoworkDirectoryBridgeDispatcher {
  return {
    emit: (event) => {
      const wc = getWebContents();
      if (!wc || wc.isDestroyed()) return;
      dispatchBridgeEvent(wc, "claude.web", "LocalAgentModeSessions", "onEvent", event);
    },
  };
}

/** Official Yxi: resolve pending directory request. */
export function respondCoworkDirectoryServers(
  requestId: string,
  servers: unknown,
): void {
  const pending = pendingDirectory.get(requestId);
  if (!pending) {
    console.warn(
      "[mcpDirectoryBridge] Received response for unknown request: %s",
      requestId,
    );
    return;
  }
  clearTimeout(pending.timeout);
  pendingDirectory.delete(requestId);
  pending.resolve(normalizeDirectoryServers(servers));
}

function normalizeDirectoryServers(value: unknown): CoworkDirectoryServer[] {
  if (!Array.isArray(value)) return [];
  const out: CoworkDirectoryServer[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.uuid !== "string" || typeof raw.name !== "string") continue;
    out.push({
      description: typeof raw.description === "string" ? raw.description : undefined,
      enabledInChat:
        typeof raw.enabledInChat === "boolean" ? raw.enabledInChat : undefined,
      iconUrl: typeof raw.iconUrl === "string" ? raw.iconUrl : undefined,
      isConnected: typeof raw.isConnected === "boolean" ? raw.isConnected : undefined,
      name: raw.name,
      oneLiner: typeof raw.oneLiner === "string" ? raw.oneLiner : undefined,
      toolNames: Array.isArray(raw.toolNames)
        ? raw.toolNames.filter((n): n is string => typeof n === "string")
        : undefined,
      url: typeof raw.url === "string" ? raw.url : undefined,
      uuid: raw.uuid,
    });
  }
  return out;
}

async function requestDirectory(
  sessionId: string,
  type:
    | "directory_servers_search"
    | "directory_servers_lookup"
    | "directory_servers_list_installed",
  payload: Record<string, unknown>,
): Promise<CoworkDirectoryServer[]> {
  const dispatcher = activeDispatcher;
  if (!dispatcher) {
    console.warn("[mcpDirectoryBridge] No dispatcher available");
    return [];
  }
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingDirectory.delete(requestId);
      console.warn("[mcpDirectoryBridge] %s request timed out: %s", type, requestId);
      resolve([]);
    }, DIRECTORY_TIMEOUT_MS);
    pendingDirectory.set(requestId, { resolve, timeout });
    dispatcher.emit({
      data: JSON.stringify({ requestId, ...payload }),
      sessionId,
      type,
    });
  });
}

/** Official xxi */
export function searchCoworkDirectoryServers(
  sessionId: string,
  keywords: string[] | undefined,
): Promise<CoworkDirectoryServer[]> {
  return requestDirectory(sessionId, "directory_servers_search", {
    keywords: keywords ?? [],
  });
}

/** Official Hxi */
export function lookupCoworkDirectoryServers(
  sessionId: string,
  uuids: string[] | undefined,
): Promise<CoworkDirectoryServer[]> {
  return requestDirectory(sessionId, "directory_servers_lookup", {
    uuids: uuids ?? [],
  });
}

/** Official Pxi */
export function listInstalledCoworkDirectoryServers(
  sessionId: string,
  keywords: string[] | undefined,
): Promise<CoworkDirectoryServer[]> {
  return requestDirectory(sessionId, "directory_servers_list_installed", {
    keywords: keywords ?? [],
  });
}

export function clearCoworkDirectoryBridgeForTests(): void {
  for (const pending of pendingDirectory.values()) clearTimeout(pending.timeout);
  pendingDirectory.clear();
  activeDispatcher = null;
}
