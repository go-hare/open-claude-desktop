import { BrowserWindow, app, screen } from "electron";
import type { ElectronShellPaths } from "../paths/electronShellPaths";

export type SecondaryWindowName = "about" | "quick" | "buddy";

export type SecondaryWindowManager = {
  openAboutWindow: () => Promise<BrowserWindow>;
  /**
   * Official yst residual (legacy Electron Quick Entry path when native overlay is off):
   * create/show panel window with quick-window.html; toggle hide when already visible.
   * Returns the window, or null when dismissed (toggle-off residual).
   */
  openQuickWindow: () => Promise<BrowserWindow | null>;
  openBuddyWindow: () => Promise<BrowserWindow>;
  closeQuickWindow: () => void;
  getWindow: (name: SecondaryWindowName) => BrowserWindow | null;
  closeAll: () => void;
};

type SecondaryWindowState = Partial<Record<SecondaryWindowName, BrowserWindow>>;

type SecondaryWindowDefinition = {
  name: SecondaryWindowName;
  title: string;
  html: string;
  preload: string;
  width: number;
  height: number;
  resizable?: boolean;
  alwaysOnTop?: boolean;
  frame?: boolean;
};

/** Official fst/pst residual: 556+50 / 420+50. */
const QUICK_ENTRY_WIDTH = 606;
const QUICK_ENTRY_HEIGHT = 470;

function isAlive(window: BrowserWindow | undefined): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed());
}

function centerOnParent(child: BrowserWindow, parent: BrowserWindow): void {
  const parentBounds = parent.getBounds();
  const childBounds = child.getBounds();
  child.setPosition(
    Math.round(parentBounds.x + (parentBounds.width - childBounds.width) / 2),
    Math.round(parentBounds.y + (parentBounds.height - childBounds.height) / 2),
  );
}

/** Official gEr residual: center on primary workArea. */
function defaultQuickEntryPosition(width: number, height: number): { x: number; y: number } {
  const display = screen.getPrimaryDisplay();
  const { width: aw, height: ah } = display.workAreaSize;
  return {
    x: Math.round((aw - width) / 2 + display.workArea.x),
    y: Math.round((ah - height) / 2 + display.workArea.y),
  };
}

function focusAppForPanel(): void {
  if (process.platform !== "darwin") return;
  try {
    app.focus({ steal: true });
  } catch {
    try {
      app.focus();
    } catch {
      /* ignore */
    }
  }
  try {
    if (app.dock && !app.dock.isVisible()) app.dock.show();
  } catch {
    /* ignore */
  }
}

export function createSecondaryWindowManager(mainWindow: BrowserWindow, paths: ElectronShellPaths): SecondaryWindowManager {
  const state: SecondaryWindowState = {};

  const definitions: Record<SecondaryWindowName, SecondaryWindowDefinition> = {
    about: {
      name: "about",
      title: "About Claude-Deepseek",
      html: paths.aboutWindowHtml,
      preload: paths.aboutWindowPreload,
      width: 420,
      height: 460,
      resizable: false,
    },
    quick: {
      name: "quick",
      title: "Claude Quick Entry",
      html: paths.quickWindowHtml,
      preload: paths.quickWindowPreload,
      width: QUICK_ENTRY_WIDTH,
      height: QUICK_ENTRY_HEIGHT,
      resizable: false,
      alwaysOnTop: true,
      frame: false,
    },
    buddy: {
      name: "buddy",
      title: "Claude Buddy",
      html: paths.buddyWindowHtml,
      preload: paths.buddyPreload,
      width: 520,
      height: 720,
      resizable: true,
    },
  };

  async function openWindow(name: SecondaryWindowName): Promise<BrowserWindow> {
    const existing = state[name];
    if (isAlive(existing)) {
      existing.show();
      existing.focus();
      return existing;
    }

    const definition = definitions[name];
    const child = new BrowserWindow({
      width: definition.width,
      height: definition.height,
      minWidth: Math.min(definition.width, 360),
      minHeight: Math.min(definition.height, 220),
      title: definition.title,
      parent: name === "quick" ? undefined : mainWindow,
      modal: false,
      show: false,
      resizable: definition.resizable ?? true,
      alwaysOnTop: definition.alwaysOnTop ?? false,
      frame: definition.frame ?? true,
      titleBarStyle: process.platform === "darwin" && definition.frame !== false ? "hiddenInset" : undefined,
      backgroundColor: "#ffffff",
      webPreferences: {
        preload: definition.preload,
      },
    });

    state[name] = child;
    child.once("ready-to-show", () => {
      if (child.isDestroyed()) return;
      if (name !== "quick") centerOnParent(child, mainWindow);
      child.show();
      child.focus();
    });
    child.on("closed", () => {
      if (state[name] === child) delete state[name];
    });
    await child.loadFile(definition.html);
    return child;
  }

  /**
   * Official yst residual (legacy Electron path, not native H9i overlay):
   * - if ready && visible → hide (toggle dismiss dmA)
   * - else create/show panel, alwaysOnTop pop-up-menu, center position
   * - return window when shown, null when dismissed
   *
   * Does not invent native Quick Entry success (OSe / H9i remain separate).
   */
  async function openQuickWindow(): Promise<BrowserWindow | null> {
    const existing = state.quick;
    if (isAlive(existing) && existing.isVisible()) {
      // Official: umA && isVisible → dmA(null) dismiss
      existing.hide();
      return null;
    }

    focusAppForPanel();
    const pos = defaultQuickEntryPosition(QUICK_ENTRY_WIDTH, QUICK_ENTRY_HEIGHT);

    if (isAlive(existing)) {
      existing.setPosition(pos.x, pos.y);
      existing.show();
      existing.moveTop();
      existing.focus();
      return existing;
    }

    const definition = definitions.quick;
    const isDarwin = process.platform === "darwin";
    const child = new BrowserWindow({
      width: definition.width,
      height: definition.height,
      x: pos.x,
      y: pos.y,
      title: definition.title,
      // Official yst BrowserWindow residual
      titleBarStyle: "hidden",
      skipTaskbar: true,
      transparent: true,
      frame: false,
      hasShadow: isDarwin,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      // type panel helps stay above on macOS (official sr?"panel":void 0)
      type: isDarwin ? "panel" : undefined,
      show: false,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      webPreferences: {
        preload: definition.preload,
      },
    });

    state.quick = child;
    try {
      child.setAlwaysOnTop(true, "pop-up-menu");
    } catch {
      try {
        child.setAlwaysOnTop(true);
      } catch {
        /* ignore */
      }
    }
    if (isDarwin) {
      try {
        child.setFullScreenable(false);
        child.setHiddenInMissionControl(true);
      } catch {
        /* ignore optional residual */
      }
    }

    child.on("closed", () => {
      if (state.quick === child) delete state.quick;
    });
    // Official blur → dmA(null) dismiss residual for quick entry
    child.on("blur", () => {
      if (!isAlive(child)) return;
      if (child.isVisible()) child.hide();
    });

    await child.loadFile(definition.html);
    if (child.isDestroyed()) return null;
    child.setPosition(pos.x, pos.y);
    child.show();
    child.moveTop();
    child.focus();
    return child;
  }

  return {
    openAboutWindow: () => openWindow("about"),
    openQuickWindow,
    openBuddyWindow: () => openWindow("buddy"),
    closeQuickWindow: () => {
      const quick = state.quick;
      if (isAlive(quick)) {
        // prefer hide (closable:false residual); fall back to close
        try {
          quick.hide();
        } catch {
          try {
            quick.close();
          } catch {
            /* ignore */
          }
        }
      }
    },
    getWindow: (name) => (isAlive(state[name]) ? state[name]! : null),
    closeAll: () => {
      for (const window of Object.values(state)) {
        if (isAlive(window)) window.close();
      }
    },
  };
}
