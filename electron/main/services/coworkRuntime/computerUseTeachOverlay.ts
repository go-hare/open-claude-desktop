/**
 * Official Ucr / Rcr / Mcr / Ncr / bcr residual (app.asar):
 *   Transparent always-on-top panel BrowserWindow + computerUseTeach preload
 *   IPC: cu-teach:show | working | hide | next | exit | mouse-enter | mouse-leave
 *   teachModeChanged → hide main window (Uq), show overlay on workArea
 *   teachStepRequested → jot/show payload (anchorLogical relative to workArea)
 *   teachStepWorking → working state
 *   exit → resolveTeachStep({action:"exit"}) + stop lock holder
 *   next → resolveTeachStep({action:"next"})
 *
 * Product: product HTML asset + .vite/build/computerUseTeach.js preload.
 * Does not invent SPA multi-turn teach UI claims without desktop actual start.
 */
import { BrowserWindow, ipcMain, screen } from "electron";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync, existsSync } from "node:fs";

/** Official TeachStepRequest residual (package types). */
export type ComputerUseTeachStepPayload = {
  explanation: string;
  nextPreview: string;
  anchorLogical?: { x: number; y: number };
};

export type ComputerUseTeachStepResult =
  | { action: "next" }
  | { action: "exit" };

/** Official HI / manager surface used by Ucr. */
export type ComputerUseTeachOverlayHost = {
  on(
    event: "teachModeChanged",
    listener: (payload: { sessionId: string; active: boolean }) => void,
  ): void;
  on(
    event: "teachStepRequested",
    listener: (payload: {
      sessionId: string;
      payload: ComputerUseTeachStepPayload;
    }) => void,
  ): void;
  on(
    event: "teachStepWorking",
    listener: (payload: { sessionId: string }) => void,
  ): void;
  on(
    event: "cuSelectedDisplayChanged",
    listener: (payload: { sessionId: string; displayId: number }) => void,
  ): void;
  on(
    event: "lifecycleChanged",
    listener: (payload: { sessionId: string; newState: string }) => void,
  ): void;
  resolveTeachStep: (result: ComputerUseTeachStepResult) => void;
  getCuLockHolder: () => string | undefined;
  stopSession: (sessionId: string) => Promise<void>;
  getSession: (
    sessionId: string,
  ) => { cuSelectedDisplayId?: number } | null | undefined;
};

const IPC_NEXT = "cu-teach:next";
const IPC_EXIT = "cu-teach:exit";
const IPC_MOUSE_ENTER = "cu-teach:mouse-enter";
const IPC_MOUSE_LEAVE = "cu-teach:mouse-leave";

/** Official ycr residual — hide fade timeout. */
const HIDE_MS = 320;

let overlayWindow: BrowserWindow | null = null;
let tempHtmlPath: string | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let pendingShowPayload: ComputerUseTeachStepPayload | null = null;
let showGeneration = 0;
let selectedDisplayId: number | null = null;
let hostRef: ComputerUseTeachOverlayHost | null = null;
let mainWindowRef: (() => BrowserWindow | null | undefined) | null = null;
let ipcBound = false;
/** Official Uq — main was visible and hidden for teach. */
let mainWasHiddenForTeach = false;
/** Official OT — active teach session id. */
let activeTeachSessionId: string | undefined;
let controllerInitialized = false;

function resolvePreloadPath(): string {
  const appPath = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require("electron") as typeof import("electron");
      return app.getAppPath();
    } catch {
      return process.cwd();
    }
  })();
  const candidates = [
    join(appPath, ".vite/build/computerUseTeach.js"),
    join(appPath, "resources/shell-secondary/.vite/build/computerUseTeach.js"),
    join(process.cwd(), ".vite/build/computerUseTeach.js"),
    join(
      process.cwd(),
      "resources/shell-secondary/.vite/build/computerUseTeach.js",
    ),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Last resort: same path residual Scr() uses.
  return join(appPath, ".vite/build/computerUseTeach.js");
}

function loadOverlayHtmlSource(): string {
  const candidates = [
    join(__dirname, "computerUseTeachOverlay.html"),
    join(
      process.cwd(),
      "electron/main/services/coworkRuntime/computerUseTeachOverlay.html",
    ),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  // Minimal residual shell if product HTML missing (should not happen in builds).
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Teaching</title></head><body></body></html>`;
}

function displayForId(id: number | null) {
  if (id === null) return screen.getPrimaryDisplay();
  return screen.getAllDisplays().find((d) => d.id === id) ?? screen.getPrimaryDisplay();
}

function workAreaForSelected() {
  return displayForId(selectedDisplayId).workArea;
}

function setSelectedDisplay(displayId: number | null | undefined) {
  selectedDisplayId = displayId ?? null;
  const win = getOverlayWindow();
  if (win && !win.isDestroyed()) {
    win.setBounds(workAreaForSelected());
  }
}

function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null;
}

function sendShow(win: BrowserWindow, payload: ComputerUseTeachStepPayload) {
  win.setIgnoreMouseEvents(true, { forward: true });
  let anchor = payload.anchorLogical;
  if (anchor) {
    const { workArea } = { workArea: workAreaForSelected() };
    anchor = { x: anchor.x - workArea.x, y: anchor.y - workArea.y };
  }
  win.webContents.send("cu-teach:show", {
    ...payload,
    anchorLogical: anchor,
  });
}

async function ensureOverlayWindow(): Promise<BrowserWindow> {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const html = loadOverlayHtmlSource();
  const tmp = join(tmpdir(), `cu-teach-${Date.now()}.html`);
  await writeFile(tmp, html);
  tempHtmlPath = tmp;
  const { workArea } = { workArea: workAreaForSelected() };
  const win = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    movable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    type: process.platform === "darwin" ? "panel" : undefined,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: resolvePreloadPath(),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setFullScreenable(false);
  win.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === "darwin") {
    try {
      win.setHiddenInMissionControl(true);
    } catch {
      /* older electron */
    }
  }
  win.on("closed", () => {
    overlayWindow = null;
    if (tempHtmlPath) {
      void unlink(tempHtmlPath).catch(() => undefined);
      tempHtmlPath = null;
    }
  });
  await win.loadFile(tmp);
  overlayWindow = win;
  return win;
}

function hideOverlay() {
  showGeneration += 1;
  pendingShowPayload = null;
  const win = getOverlayWindow();
  if (!win) return;
  if (hideTimer) return;
  win.webContents.send("cu-teach:hide");
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
  }, HIDE_MS);
}

function showTeachOverlay() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  const gen = ++showGeneration;
  void (async () => {
    try {
      const win = await ensureOverlayWindow();
      if (gen !== showGeneration) {
        pendingShowPayload = null;
        return;
      }
      if (win.isDestroyed()) return;
      win.setBounds(workAreaForSelected());
      win.setIgnoreMouseEvents(true, { forward: true });
      if (!win.isVisible()) win.showInactive();
      if (pendingShowPayload) {
        const payload = pendingShowPayload;
        pendingShowPayload = null;
        sendShow(win, payload);
      }
    } catch (error) {
      console.error("[cu-teach] overlay creation failed, recovering", error);
      pendingShowPayload = null;
      hostRef?.resolveTeachStep({ action: "exit" });
      const holder = hostRef?.getCuLockHolder();
      if (holder) {
        void hostRef?.stopSession(holder).catch(() => undefined);
      }
      activeTeachSessionId = undefined;
      hideOverlay();
      restoreMainWindow();
    }
  })();
}

function showStep(payload: ComputerUseTeachStepPayload) {
  const win = getOverlayWindow();
  if (!win || !win.isVisible()) {
    pendingShowPayload = payload;
    return;
  }
  sendShow(win, payload);
}

function showWorking() {
  const win = getOverlayWindow();
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.send("cu-teach:working");
}

function restoreMainWindow() {
  if (!mainWasHiddenForTeach) return;
  mainWasHiddenForTeach = false;
  const main = mainWindowRef?.();
  if (main && !main.isDestroyed() && !main.isVisible()) {
    main.show();
  }
}

async function handleExit() {
  if (!hostRef) {
    console.debug("[cu-teach] exit pressed but no manager");
    return;
  }
  hostRef.resolveTeachStep({ action: "exit" });
  const holder = hostRef.getCuLockHolder();
  if (holder) {
    console.info(`[cu-teach] exit pressed, stopping ${holder}`);
    await hostRef.stopSession(holder);
  } else {
    console.warn(
      "[cu-teach] exit with no lock holder — cleaning up zombie overlay",
    );
    activeTeachSessionId = undefined;
    hideOverlay();
    restoreMainWindow();
  }
}

function bindIpcOnce() {
  if (ipcBound) return;
  ipcMain.handle(IPC_NEXT, () => {
    hostRef?.resolveTeachStep({ action: "next" });
  });
  ipcMain.handle(IPC_EXIT, () => handleExit());
  ipcMain.on(IPC_MOUSE_ENTER, () => {
    getOverlayWindow()?.setIgnoreMouseEvents(false);
  });
  ipcMain.on(IPC_MOUSE_LEAVE, () => {
    getOverlayWindow()?.setIgnoreMouseEvents(true, { forward: true });
  });
  ipcBound = true;
}

/**
 * Official Ucr(e, A) residual.
 * Call once after CoworkSessionManager + main window exist.
 */
export function initComputerUseTeachOverlay(
  host: ComputerUseTeachOverlayHost,
  getMainWindow: () => BrowserWindow | null | undefined,
): void {
  hostRef = host;
  mainWindowRef = getMainWindow;
  bindIpcOnce();
  if (controllerInitialized) return;
  controllerInitialized = true;

  host.on("teachModeChanged", ({ sessionId, active }) => {
    if (active) {
      activeTeachSessionId = sessionId;
      const session = host.getSession(sessionId);
      let displayId = session?.cuSelectedDisplayId;
      const main = getMainWindow();
      if (
        displayId === undefined &&
        main &&
        !main.isDestroyed()
      ) {
        displayId = screen.getDisplayMatching(main.getBounds()).id;
      }
      if (main && !main.isDestroyed() && main.isVisible()) {
        main.hide();
        mainWasHiddenForTeach = true;
      }
      setSelectedDisplay(displayId);
      showTeachOverlay();
    } else {
      activeTeachSessionId = undefined;
      hideOverlay();
      restoreMainWindow();
    }
  });

  host.on("teachStepRequested", ({ payload }) => {
    showStep(payload);
  });

  host.on("cuSelectedDisplayChanged", ({ sessionId, displayId }) => {
    if (sessionId === activeTeachSessionId) {
      setSelectedDisplay(displayId);
    }
  });

  host.on("teachStepWorking", () => {
    showWorking();
  });

  host.on("lifecycleChanged", ({ sessionId, newState }) => {
    if (
      sessionId === activeTeachSessionId &&
      newState !== "running" &&
      mainWasHiddenForTeach
    ) {
      console.warn(
        "[cu-teach] lifecycleChanged fallback restoring main window",
      );
      hideOverlay();
      restoreMainWindow();
    }
  });

  console.info("[cu-teach] controller initialized");
}

/** Test / teardown helper — does not unregister ipc (process-lifetime residual). */
export function resetComputerUseTeachOverlayForTests(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
  }
  overlayWindow = null;
  pendingShowPayload = null;
  showGeneration = 0;
  selectedDisplayId = null;
  activeTeachSessionId = undefined;
  mainWasHiddenForTeach = false;
  hostRef = null;
  mainWindowRef = null;
  controllerInitialized = false;
  // Keep ipcBound so re-init does not double-handle.
}

/** Expose workArea helper for unit tests without BrowserWindow. */
export function computerUseTeachWorkAreaForDisplay(
  displayId: number | null,
): Electron.Rectangle {
  return displayForId(displayId).workArea;
}

// Silence unused pathToFileURL if loadFile preferred.
void pathToFileURL;
