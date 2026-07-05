import { ipcRenderer } from "electron";
import { buildIpcChannel } from "../../shared/ipc/channel";

export const electronIntl = {
  getInitialLocale: () => ipcRenderer.invoke(buildIpcChannel("claude.hybrid", "DesktopIntl", "getInitialLocale")),
  requestLocaleChange: (locale: string) => ipcRenderer.invoke(buildIpcChannel("claude.hybrid", "DesktopIntl", "requestLocaleChange"), locale),
  localeChanged: (callback: (...args: unknown[]) => void) => {
    const channel = buildIpcChannel("claude.hybrid", "DesktopIntl", "localeChanged");
    const listener = (_event: unknown, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};
