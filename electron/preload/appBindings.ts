import { ipcRenderer, webUtils } from "electron";

const SUPPORTED_BINDINGS = new Set(["cmdK", "googleAuthCode"]);

function assertBinding(name: string): void {
  if (!SUPPORTED_BINDINGS.has(name)) throw new Error(`unsupported Claude App binding: "${name}"`);
}

export const claudeAppBindings = {
  /**
   * Official residual (mainView preload): ipcRenderer.on(name, cb).
   * Live SPA ju() prefers a returned unsubscribe function when present:
   *   i = registerBinding(...); cleanup → i ? i() : unregisterBinding(name)
   */
  registerBinding(name: string, callback: (...args: unknown[]) => void) {
    assertBinding(name);
    const listener = callback as never;
    ipcRenderer.on(name, listener);
    return () => {
      ipcRenderer.removeListener(name, listener);
    };
  },
  unregisterBinding(name: string) {
    assertBinding(name);
    ipcRenderer.removeAllListeners(name);
  },
  listMcpServers: () => ipcRenderer.invoke("list-mcp-servers"),
  connectToMcpServer: (serverName: string) => ipcRenderer.invoke("connect-to-mcp-server", serverName),
  openMcpSettings: (serverName?: string) => ipcRenderer.invoke("request-open-mcp-settings", serverName),
};

export const claudeAppSettings = {
  filePickers: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
};
