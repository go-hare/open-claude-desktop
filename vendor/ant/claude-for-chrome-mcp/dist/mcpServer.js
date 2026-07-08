import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { createBridgeClient } from "./bridgeClient.js";
import { BROWSER_TOOLS } from "./browserTools.js";
import { createMcpSocketClient } from "./mcpSocketClient.js";
import { createMcpSocketPool } from "./mcpSocketPool.js";
import { handleToolCall } from "./toolCalls.js";
function createChromeSocketClient(context) {
  return context.bridgeConfig ? createBridgeClient(context) : context.getSocketPaths ? createMcpSocketPool(context) : createMcpSocketClient(context);
}
function createClaudeForChromeMcpServer(context, existingSocketClient) {
  const { serverName, logger } = context;
  const socketClient = existingSocketClient ?? createChromeSocketClient(context);
  const server = new Server(
    {
      name: serverName,
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {},
        logging: {}
      }
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (context.isDisabled?.()) {
      return { tools: [] };
    }
    return {
      tools: context.bridgeConfig ? BROWSER_TOOLS : BROWSER_TOOLS.filter((t) => t.name !== "switch_browser")
    };
  });
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      logger.info(`[${serverName}] Executing tool: ${request.params.name}`);
      return handleToolCall(
        context,
        socketClient,
        request.params.name,
        request.params.arguments || {}
      );
    }
  );
  socketClient.setNotificationHandler((notification) => {
    logger.info(
      `[${serverName}] Forwarding MCP notification: ${notification.method}`
    );
    server.notification({
      method: notification.method,
      params: notification.params
    }).catch((error) => {
      logger.info(
        `[${serverName}] Failed to forward MCP notification: ${error.message}`
      );
    });
  });
  return server;
}
export {
  createChromeSocketClient,
  createClaudeForChromeMcpServer
};
