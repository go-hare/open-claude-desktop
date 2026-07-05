import type { IpcHandlerContext } from "./context";
import { dispatchBridgeEvent, registerDirectInvokeHandler } from "./registerIpc";

export const CLAUDE_APP_BINDING_CHANNELS = {
  listMcpServers: "list-mcp-servers",
  connectToMcpServer: "connect-to-mcp-server",
  requestOpenMcpSettings: "request-open-mcp-settings",
} as const;

export function registerAppBindingsHandlers(context: IpcHandlerContext): void {
  registerDirectInvokeHandler(
    CLAUDE_APP_BINDING_CHANNELS.listMcpServers,
    async () => Object.entries(context.settings.getMcpServersConfig()).map(([name, config]) => ({ name, config, status: "configured" })),
    "claudeAppBindings",
  );

  registerDirectInvokeHandler(
    CLAUDE_APP_BINDING_CHANNELS.connectToMcpServer,
    async (_event, serverName) => {
      const name = typeof serverName === "string" ? serverName : "";
      const config = context.settings.getMcpServersConfig()[name];
      const payload = config
        ? { ok: true, serverName: name, uuid: `local-${name}`, status: "configured" }
        : { ok: false, serverName: name, error: "missing_mcp_server_config" };
      dispatchBridgeEvent(context.windows.mainView.webContents, "claude.settings", "MCP", "mcpStatusChanged", name, payload.status, payload);
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
