import { ipcRenderer } from "electron";
import { buildIpcChannel } from "../../shared/ipc/channel";

function invoke(method: string, ...args: unknown[]) {
  return ipcRenderer.invoke(buildIpcChannel("claude.web", "WindowControl", method), ...args);
}

export const electronWindowControl = {
  // Official LoginRoute: resize(600, 600, { center: true })
  resize: (
    width: number,
    height: number,
    opts?: boolean | { center?: boolean },
  ) => invoke("resize", width, height, opts),
  focus: () => invoke("focus"),
  close: () => invoke("close"),
  captureScreenshot: () => invoke("captureScreenshot"),
  setIncognitoMode: (enabled: boolean) => invoke("setIncognitoMode", enabled),
  setThemeMode: (mode: string) => invoke("setThemeMode", mode),
};
