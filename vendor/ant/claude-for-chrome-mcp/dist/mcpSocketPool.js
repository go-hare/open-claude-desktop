import {
  createMcpSocketClient,
  SocketConnectionError
} from "./mcpSocketClient.js";
class McpSocketPool {
  clients = /* @__PURE__ */ new Map();
  tabRoutes = /* @__PURE__ */ new Map();
  context;
  notificationHandler = null;
  constructor(context) {
    this.context = context;
  }
  setNotificationHandler(handler) {
    this.notificationHandler = handler;
    for (const client of this.clients.values()) {
      client.setNotificationHandler(handler);
    }
  }
  /**
   * Discover available sockets and ensure at least one is connected.
   */
  async ensureConnected() {
    const { logger, serverName } = this.context;
    this.refreshClients();
    const connectPromises = [];
    for (const client of this.clients.values()) {
      if (!client.isConnected()) {
        connectPromises.push(client.ensureConnected().catch(() => false));
      }
    }
    if (connectPromises.length > 0) {
      await Promise.all(connectPromises);
    }
    const connectedCount = this.getConnectedClients().length;
    if (connectedCount === 0) {
      logger.info(`[${serverName}] No connected sockets in pool`);
      return false;
    }
    logger.info(`[${serverName}] Socket pool: ${connectedCount} connected`);
    return true;
  }
  /**
   * Call a tool, routing to the correct socket based on tab ID.
   * For tabs_context_mcp, queries all sockets and merges results.
   */
  async callTool(name, args, _permissionOverrides) {
    if (name === "tabs_context_mcp") {
      return this.callTabsContext(args);
    }
    const tabId = args.tabId;
    if (tabId !== void 0) {
      const socketPath = this.tabRoutes.get(tabId);
      if (socketPath) {
        const client = this.clients.get(socketPath);
        if (client?.isConnected()) {
          return client.callTool(name, args);
        }
      }
    }
    const connected = this.getConnectedClients();
    if (connected.length === 0) {
      throw new SocketConnectionError(
        `[${this.context.serverName}] No connected sockets available`
      );
    }
    return connected[0].callTool(name, args);
  }
  async setPermissionMode(mode, allowedDomains) {
    const connected = this.getConnectedClients();
    await Promise.all(
      connected.map((client) => client.setPermissionMode(mode, allowedDomains))
    );
  }
  isConnected() {
    return this.getConnectedClients().length > 0;
  }
  disconnect() {
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();
    this.tabRoutes.clear();
  }
  getConnectedClients() {
    return [...this.clients.values()].filter((c) => c.isConnected());
  }
  /**
   * Query all connected sockets for tabs and merge results.
   * Updates the tab routing table.
   */
  async callTabsContext(args) {
    const { logger, serverName } = this.context;
    const connected = this.getConnectedClients();
    if (connected.length === 0) {
      throw new SocketConnectionError(
        `[${serverName}] No connected sockets available`
      );
    }
    if (connected.length === 1) {
      const result = await connected[0].callTool("tabs_context_mcp", args);
      this.updateTabRoutes(result, this.getSocketPathForClient(connected[0]));
      return result;
    }
    const results = await Promise.allSettled(
      connected.map(async (client) => {
        const result = await client.callTool("tabs_context_mcp", args);
        const socketPath = this.getSocketPathForClient(client);
        return { result, socketPath };
      })
    );
    const mergedTabs = [];
    this.tabRoutes.clear();
    for (const settledResult of results) {
      if (settledResult.status !== "fulfilled") {
        logger.info(
          `[${serverName}] tabs_context_mcp failed on one socket: ${settledResult.reason}`
        );
        continue;
      }
      const { result, socketPath } = settledResult.value;
      this.updateTabRoutes(result, socketPath);
      const tabs = this.extractTabs(result);
      if (tabs) {
        mergedTabs.push(...tabs);
      }
    }
    if (mergedTabs.length > 0) {
      const tabListText = mergedTabs.map((t) => {
        const tab = t;
        return `  \u2022 tabId ${tab.tabId}: "${tab.title}" (${tab.url})`;
      }).join("\n");
      return {
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ availableTabs: mergedTabs })
            },
            {
              type: "text",
              text: `

Tab Context:
- Available tabs:
${tabListText}`
            }
          ]
        }
      };
    }
    for (const settledResult of results) {
      if (settledResult.status === "fulfilled") {
        return settledResult.value.result;
      }
    }
    throw new SocketConnectionError(
      `[${serverName}] All sockets failed for tabs_context_mcp`
    );
  }
  /**
   * Extract tab objects from a tool response to update routing table.
   */
  updateTabRoutes(result, socketPath) {
    const tabs = this.extractTabs(result);
    if (!tabs) return;
    for (const tab of tabs) {
      if (typeof tab === "object" && tab !== null && "tabId" in tab) {
        const tabId = tab.tabId;
        this.tabRoutes.set(tabId, socketPath);
      }
    }
  }
  extractTabs(result) {
    if (!result || typeof result !== "object") return null;
    const asResponse = result;
    const content = asResponse.result?.content;
    if (!content || !Array.isArray(content)) return null;
    for (const item of content) {
      if (item.type === "text" && item.text) {
        try {
          const parsed = JSON.parse(item.text);
          if (Array.isArray(parsed)) return parsed;
          if (parsed && Array.isArray(parsed.availableTabs)) {
            return parsed.availableTabs;
          }
        } catch {
        }
      }
    }
    return null;
  }
  getSocketPathForClient(client) {
    for (const [path, c] of this.clients.entries()) {
      if (c === client) return path;
    }
    return "";
  }
  /**
   * Scan for available sockets and create/remove clients as needed.
   */
  refreshClients() {
    const socketPaths = this.getAvailableSocketPaths();
    const { logger, serverName } = this.context;
    for (const path of socketPaths) {
      if (!this.clients.has(path)) {
        logger.info(`[${serverName}] Adding socket to pool: ${path}`);
        const clientContext = {
          ...this.context,
          socketPath: path,
          getSocketPath: void 0,
          getSocketPaths: void 0
        };
        const client = createMcpSocketClient(clientContext);
        client.disableAutoReconnect = true;
        if (this.notificationHandler) {
          client.setNotificationHandler(this.notificationHandler);
        }
        this.clients.set(path, client);
      }
    }
    for (const [path, client] of this.clients.entries()) {
      if (!socketPaths.includes(path)) {
        logger.info(`[${serverName}] Removing stale socket from pool: ${path}`);
        client.disconnect();
        this.clients.delete(path);
        for (const [tabId, socketPath] of this.tabRoutes.entries()) {
          if (socketPath === path) {
            this.tabRoutes.delete(tabId);
          }
        }
      }
    }
  }
  getAvailableSocketPaths() {
    return this.context.getSocketPaths?.() ?? [];
  }
}
function createMcpSocketPool(context) {
  return new McpSocketPool(context);
}
export {
  McpSocketPool,
  createMcpSocketPool
};
