import { ipcRenderer } from "electron";
import { buildIpcChannel } from "../../shared/ipc/channel";

/**
 * Official hybrid DesktopIntl residual:
 *   getInitialLocale → sync (sendSync)
 *   requestLocaleChange → invoke
 *   localeChanged → event
 * Matches hybridBridgeSpec + registerInterfaceSyncHandlers in main.
 */
export const electronIntl = {
  getInitialLocale: () => {
    const channel = buildIpcChannel("claude.hybrid", "DesktopIntl", "getInitialLocale");
    const response = ipcRenderer.sendSync(channel) as { error?: string; result?: unknown };
    if (response?.error) throw new Error(response.error);
    return response?.result;
  },
  requestLocaleChange: (locale: string) =>
    ipcRenderer.invoke(buildIpcChannel("claude.hybrid", "DesktopIntl", "requestLocaleChange"), locale),
  localeChanged: (callback: (...args: unknown[]) => void) => {
    const channel = buildIpcChannel("claude.hybrid", "DesktopIntl", "localeChanged");
    const listener = (_event: unknown, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};
