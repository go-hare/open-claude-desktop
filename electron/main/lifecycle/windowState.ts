import type { BrowserWindow, Rectangle } from "electron";
import { app, screen } from "electron";
import fs from "node:fs";
import path from "node:path";

export type DesktopWindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
  isFullScreen?: boolean;
  displayBounds?: Rectangle;
};

export type WindowStateKeeperOptions = {
  stateFile?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  maximize?: boolean;
  fullScreen?: boolean;
  throttleMs?: number;
};

export type WindowStateKeeper = DesktopWindowState & {
  manage: (mainWindow: BrowserWindow) => void;
  unmanage: () => void;
  saveState: (mainWindow?: BrowserWindow | unknown) => void;
  resetStateToDefault: () => void;
};

/**
 * Cold-start / F1t reset defaults.
 * Official Cbe({defaultWidth:1200,defaultHeight:800}) does not pin top-left;
 * electron-window-state-style first launch centers on the primary work area.
 * Prior product default used display origin (x/y = 0) → window opens at 屏幕左上角
 * until LoginRoute jn center resize (and shell never re-centers if already signed in).
 */
export function defaultWindowState(defaultWidth = 1200, defaultHeight = 800, displayBounds?: Rectangle): DesktopWindowState {
  let workArea: Rectangle | undefined;
  try {
    // Prefer live primary workArea (excludes taskbar); fall back to bounds if screen unavailable.
    workArea = screen.getPrimaryDisplay()?.workArea;
  } catch {
    workArea = undefined;
  }
  const area = workArea
    ?? (displayBounds
      ? { x: displayBounds.x, y: displayBounds.y, width: displayBounds.width, height: displayBounds.height }
      : { x: 0, y: 0, width: defaultWidth, height: defaultHeight });
  const width = defaultWidth;
  const height = defaultHeight;
  return {
    width,
    height,
    x: Math.round(area.x + Math.max(0, (area.width - width) / 2)),
    y: Math.round(area.y + Math.max(0, (area.height - height) / 2)),
    displayBounds: displayBounds ?? workArea,
  };
}

export function hasValidWindowBounds(state: Partial<DesktopWindowState> | undefined): state is DesktopWindowState {
  return Boolean(
    state &&
      typeof state.width === "number" &&
      Number.isInteger(state.width) &&
      state.width > 0 &&
      typeof state.height === "number" &&
      Number.isInteger(state.height) &&
      state.height > 0 &&
      (state.x === undefined || Number.isInteger(state.x)) &&
      (state.y === undefined || Number.isInteger(state.y)),
  );
}

export function isWindowInsideDisplay(state: DesktopWindowState, displayBounds: Rectangle): boolean {
  const { x, y, width, height } = state;
  if (x === undefined || y === undefined) return false;
  return (
    x >= displayBounds.x &&
    y >= displayBounds.y &&
    x + width <= displayBounds.x + displayBounds.width &&
    y + height <= displayBounds.y + displayBounds.height
  );
}

export function normalizeWindowState(
  persisted: Partial<DesktopWindowState> | undefined,
  displays: Rectangle[],
  fallback: DesktopWindowState,
): DesktopWindowState {
  if (!hasValidWindowBounds(persisted) && !persisted?.isMaximized && !persisted?.isFullScreen) {
    return { ...fallback };
  }

  const candidate: DesktopWindowState = {
    ...fallback,
    ...persisted,
    width: persisted.width ?? fallback.width,
    height: persisted.height ?? fallback.height,
  };

  // Drop LoginRoute jn 600×600 if it was wrongly persisted from a prior session.
  if (
    candidate.width === 600
    && candidate.height === 600
    && !candidate.isMaximized
    && !candidate.isFullScreen
  ) {
    candidate.width = fallback.width;
    candidate.height = fallback.height;
  }

  if (hasValidWindowBounds(candidate) && displays.length > 0) {
    const insideAnyDisplay = displays.some((bounds) => isWindowInsideDisplay(candidate, bounds));
    if (!insideAnyDisplay && !candidate.isMaximized && !candidate.isFullScreen) return { ...fallback };
  }

  return candidate;
}

function readPersistedState(stateFile: string): Partial<DesktopWindowState> | undefined {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return undefined;
  }
}

function writePersistedState(stateFile: string, state: DesktopWindowState): void {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state));
  } catch {
    // State persistence must never block app startup/shutdown.
  }
}


function isBrowserWindowLike(value: unknown): value is BrowserWindow {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as BrowserWindow).isDestroyed === "function" &&
      typeof (value as BrowserWindow).getBounds === "function",
  );
}

function canCaptureBounds(mainWindow: BrowserWindow): boolean {
  return !mainWindow.isMaximized() && !mainWindow.isMinimized() && !mainWindow.isFullScreen();
}

export function createWindowStateKeeper(options: WindowStateKeeperOptions = {}): WindowStateKeeper {
  const stateFile = options.stateFile ?? path.join(app.getPath("userData"), "window-state.json");
  const primaryDisplay = screen.getPrimaryDisplay().bounds;
  const fallback = defaultWindowState(options.defaultWidth, options.defaultHeight, primaryDisplay);
  const displays = screen.getAllDisplays().map((display) => display.bounds);
  let state = normalizeWindowState(readPersistedState(stateFile), displays, fallback);
  let managedWindow: BrowserWindow | null = null;
  let throttle: NodeJS.Timeout | undefined;

  const captureState = (mainWindow = managedWindow) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    if (canCaptureBounds(mainWindow)) {
      // LoginRoute jn residual resizes the *same* main window to 600×600.
      // Do not persist that transient chooser size as the next cold-start shell
      // (otherwise next launch opens at login size before SPA gate resolves).
      // Keep position; keep last non-login width/height (or Cbe defaults).
      const loginSized =
        bounds.width === 600
        && bounds.height === 600
        && !mainWindow.isMaximized()
        && !mainWindow.isFullScreen();
      if (loginSized) {
        state = {
          ...state,
          x: bounds.x,
          y: bounds.y,
          width: state.width >= 800 ? state.width : fallback.width,
          height: state.height >= 600 && state.height !== 600 ? state.height : fallback.height,
        };
      } else {
        state = { ...state, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      }
    }
    state = {
      ...state,
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
      displayBounds: screen.getDisplayMatching(bounds).bounds,
    };
  };

  const scheduleCapture = () => {
    if (throttle) clearTimeout(throttle);
    throttle = setTimeout(() => captureState(), options.throttleMs ?? 100);
  };
  const captureManagedState = () => captureState();

  const saveState = (mainWindow: BrowserWindow | unknown = managedWindow ?? undefined) => {
    const candidate = isBrowserWindowLike(mainWindow) ? mainWindow : managedWindow;
    if (candidate) captureState(candidate);
    writePersistedState(stateFile, state);
  };

  const unmanage = () => {
    if (!managedWindow) return;
    managedWindow.removeListener("resize", scheduleCapture);
    managedWindow.removeListener("move", scheduleCapture);
    managedWindow.removeListener("close", captureManagedState);
    managedWindow.removeListener("closed", saveState);
    if (throttle) clearTimeout(throttle);
    managedWindow = null;
  };

  const manage = (mainWindow: BrowserWindow) => {
    if (options.maximize !== false && state.isMaximized) mainWindow.maximize();
    if (options.fullScreen !== false && state.isFullScreen) mainWindow.setFullScreen(true);
    mainWindow.on("resize", scheduleCapture);
    mainWindow.on("move", scheduleCapture);
    mainWindow.on("close", captureManagedState);
    mainWindow.on("closed", saveState);
    managedWindow = mainWindow;
  };

  const keeper = {
    get x() {
      return state.x;
    },
    get y() {
      return state.y;
    },
    get width() {
      return state.width;
    },
    get height() {
      return state.height;
    },
    get isMaximized() {
      return state.isMaximized;
    },
    get isFullScreen() {
      return state.isFullScreen;
    },
    get displayBounds() {
      return state.displayBounds;
    },
    manage,
    unmanage,
    saveState,
    resetStateToDefault() {
      state = { ...fallback };
    },
  };

  return keeper;
}
