import type { App } from "electron";

export type QuitState = {
  isQuitting: () => boolean;
  markQuitting: () => void;
  shouldQuitOnClose: () => boolean;
};

export function createQuitState(): QuitState {
  let quitting = false;
  return {
    isQuitting: () => quitting,
    markQuitting: () => {
      quitting = true;
    },
    shouldQuitOnClose: () => quitting,
  };
}

export function installQuitState(app: App, quitState = createQuitState()): QuitState {
  app.on("before-quit", quitState.markQuitting);
  return quitState;
}
