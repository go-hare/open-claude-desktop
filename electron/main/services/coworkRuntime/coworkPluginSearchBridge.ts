/**
 * Official pluginSearchBridge (app.asar I9e / jxi / $xi / Qde):
 *   plugins_search reverse-RPC
 *   data: JSON.stringify({ requestId, userIntent?, keywords?, userMessageUuid?,
 *                          includeInstalled?, listInstalledOnly? })
 * web responds respondPluginSearch(requestId, JSON.stringify({ results })).
 */
import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { dispatchBridgeEvent } from "../../ipc/registerIpc";

const PLUGIN_TIMEOUT_MS = 10_000;
const EMPTY_RESULTS = JSON.stringify({ results: [] });

type PendingRequest = {
  resolve: (payload: string) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingPlugins = new Map<string, PendingRequest>();

export type CoworkPluginSearchBridgeDispatcher = {
  emit: (event: {
    data: string;
    sessionId: string;
    type: "plugins_search";
  }) => void;
};

let activeDispatcher: CoworkPluginSearchBridgeDispatcher | null = null;

export function setCoworkPluginSearchBridgeDispatcher(
  dispatcher: CoworkPluginSearchBridgeDispatcher | null,
): void {
  activeDispatcher = dispatcher;
}

export function createWebContentsPluginSearchDispatcher(
  getWebContents: () => WebContents | null | undefined,
): CoworkPluginSearchBridgeDispatcher {
  return {
    emit: (event) => {
      const wc = getWebContents();
      if (!wc || wc.isDestroyed()) return;
      dispatchBridgeEvent(wc, "claude.web", "LocalAgentModeSessions", "onEvent", event);
    },
  };
}

/** Official jxi: resolve pending plugin search (raw JSON string). */
export function respondCoworkPluginSearch(
  requestId: string,
  resultsJson: unknown,
): void {
  const pending = pendingPlugins.get(requestId);
  if (!pending) {
    console.warn(
      "[pluginSearchBridge] Received response for unknown request: %s",
      requestId,
    );
    return;
  }
  clearTimeout(pending.timeout);
  pendingPlugins.delete(requestId);
  if (typeof resultsJson === "string" && resultsJson.length > 0) {
    pending.resolve(resultsJson);
    return;
  }
  if (resultsJson && typeof resultsJson === "object") {
    try {
      pending.resolve(JSON.stringify(resultsJson));
      return;
    } catch {
      /* fall through */
    }
  }
  pending.resolve(EMPTY_RESULTS);
}

function requestPlugins(
  sessionId: string,
  payload: Record<string, unknown>,
  label: string,
): Promise<string> {
  const dispatcher = activeDispatcher;
  if (!dispatcher) {
    console.warn("[pluginSearchBridge] No main view for %s", label);
    return Promise.resolve(EMPTY_RESULTS);
  }
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingPlugins.delete(requestId);
      console.warn("[pluginSearchBridge] %s request timed out: %s", label, requestId);
      resolve(EMPTY_RESULTS);
    }, PLUGIN_TIMEOUT_MS);
    pendingPlugins.set(requestId, { resolve, timeout });
    dispatcher.emit({
      data: JSON.stringify({ requestId, ...payload }),
      sessionId,
      type: "plugins_search",
    });
  });
}

/** Official $xi */
export function searchCoworkPlugins(
  sessionId: string,
  userIntent: string | undefined,
  keywords: string[] | undefined,
  userMessageUuid: string | undefined,
  includeInstalled: boolean | undefined,
): Promise<string> {
  return requestPlugins(
    sessionId,
    {
      userIntent,
      keywords: keywords ?? [],
      userMessageUuid,
      includeInstalled: includeInstalled === true,
    },
    "plugin search",
  );
}

/** Official Qde */
export function listInstalledCoworkPlugins(
  sessionId: string,
  keywords: string[] | undefined,
): Promise<string> {
  return requestPlugins(
    sessionId,
    {
      keywords: keywords ?? [],
      listInstalledOnly: true,
    },
    "installed plugin list",
  );
}

export function clearCoworkPluginSearchBridgeForTests(): void {
  for (const pending of pendingPlugins.values()) clearTimeout(pending.timeout);
  pendingPlugins.clear();
  activeDispatcher = null;
}
