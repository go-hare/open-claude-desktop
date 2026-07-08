import type { IpcHandlerContext } from "./context";
import { describeMcpServer, mcpConfigEntries } from "../services/mcp/mcpRuntime";
import { dispatchBridgeEvent, registerDirectInvokeHandler } from "./registerIpc";

export const CLAUDE_APP_BINDING_CHANNELS = {
  listMcpServers: "list-mcp-servers",
  connectToMcpServer: "connect-to-mcp-server",
  requestOpenMcpSettings: "request-open-mcp-settings",
  mcpServerConnected: "mcp-server-connected",
  mcpServerAutoReconnect: "mcp-server-auto-reconnect",
} as const;

export function dispatchMcpServerAutoReconnect(context: IpcHandlerContext, serverName: string): void {
  if (context.windows.mainView.webContents.isDestroyed()) return;
  context.windows.mainView.webContents.send(CLAUDE_APP_BINDING_CHANNELS.mcpServerAutoReconnect, serverName);
}

export function registerAppBindingsHandlers(context: IpcHandlerContext): void {
  registerDirectInvokeHandler(
    CLAUDE_APP_BINDING_CHANNELS.listMcpServers,
    async () => mcpConfigEntries(context.settings.getMcpServersConfig()).map(([name, config]) => ({ ...describeMcpServer(name, config), config })),
    "claudeAppBindings",
  );

  registerDirectInvokeHandler(
    CLAUDE_APP_BINDING_CHANNELS.connectToMcpServer,
    async (_event, serverName) => {
      const name = typeof serverName === "string" ? serverName : "";
      const config = mcpConfigEntries(context.settings.getMcpServersConfig()).find(([candidate]) => candidate === name)?.[1];
      const payload = config
        ? { ok: true, serverName: name, uuid: `local-${name}`, ...describeMcpServer(name, config) }
        : { ok: false, serverName: name, error: "missing_mcp_server_config" };
      const status = "status" in payload && typeof payload.status === "string" ? payload.status : "missing";
      dispatchBridgeEvent(context.windows.mainView.webContents, "claude.settings", "MCP", "mcpStatusChanged", name, status, payload);
      if (payload.ok) context.windows.mainView.webContents.send(CLAUDE_APP_BINDING_CHANNELS.mcpServerConnected, payload);
      return payload;
    },
    "claudeAppBindings",
  );

  registerDirectInvokeHandler(
    CLAUDE_APP_BINDING_CHANNELS.requestOpenMcpSettings,
    async () => {
      dispatchBridgeEvent(context.windows.mainView.webContents, "claude.settings", "MCP", "revealMcpServerSettingsRequested");
      return true;
    },
    "claudeAppBindings",
  );
}
