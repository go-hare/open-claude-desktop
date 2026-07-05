import { ipcRenderer } from "electron";
import { buildIpcChannel } from "../../shared/ipc/channel";

function invoke(method: string, ...args: unknown[]) {
  return ipcRenderer.invoke(buildIpcChannel("claude.web", "WindowControl", method), ...args);
}

export const electronWindowControl = {
  resize: (width: number, height: number, animate?: boolean) => invoke("resize", width, height, animate),
  focus: () => invoke("focus"),
  close: () => invoke("close"),
  captureScreenshot: () => invoke("captureScreenshot"),
  setIncognitoMode: (enabled: boolean) => invoke("setIncognitoMode", enabled),
  setThemeMode: (mode: string) => invoke("setThemeMode", mode),
};
