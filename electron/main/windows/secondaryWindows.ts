import { BrowserWindow } from "electron";
import type { ElectronShellPaths } from "../paths/electronShellPaths";

export type SecondaryWindowName = "about" | "quick" | "buddy";

export type SecondaryWindowManager = {
  openAboutWindow: () => Promise<BrowserWindow>;
  openQuickWindow: () => Promise<BrowserWindow>;
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
      width: 680,
      height: 260,
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

  return {
    openAboutWindow: () => openWindow("about"),
    openQuickWindow: () => openWindow("quick"),
    openBuddyWindow: () => openWindow("buddy"),
    closeQuickWindow: () => {
      const quick = state.quick;
      if (isAlive(quick)) quick.close();
    },
    getWindow: (name) => (isAlive(state[name]) ? state[name]! : null),
    closeAll: () => {
      for (const window of Object.values(state)) {
        if (isAlive(window)) window.close();
      }
    },
  };
}
