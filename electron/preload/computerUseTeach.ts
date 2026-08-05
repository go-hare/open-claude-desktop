/**
 * Computer Use teach overlay preload.
 * data-official-source: app.asar .vite/build/computerUseTeach.js
 *
 * Residual channels (not EIPC) — no unsubscribe return (official does not return removers):
 *   cu-teach:show / working / hide (events)
 *   cu-teach:next / exit (invoke)
 *   cu-teach:mouse-enter / mouse-leave (send)
 */
import { contextBridge, ipcRenderer } from "electron";

type CuTeachShowPayload = unknown;

contextBridge.exposeInMainWorld("cuTeach", {
  onShow: (callback: (payload: CuTeachShowPayload) => void) => {
    ipcRenderer.on("cu-teach:show", (_event, payload: CuTeachShowPayload) => {
      callback(payload);
    });
  },
  onWorking: (callback: () => void) => {
    ipcRenderer.on("cu-teach:working", () => {
      callback();
    });
  },
  onHide: (callback: () => void) => {
    ipcRenderer.on("cu-teach:hide", () => {
      callback();
    });
  },
  next: () => ipcRenderer.invoke("cu-teach:next"),
  exit: () => ipcRenderer.invoke("cu-teach:exit"),
  mouseEnter: () => ipcRenderer.send("cu-teach:mouse-enter"),
  mouseLeave: () => ipcRenderer.send("cu-teach:mouse-leave"),
});
