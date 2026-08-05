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
  // Residual Oc({ name: "direct-mcp-host-shutdown" }) — dispose shared UtilityProcess host.
  // Dispose connection bag first (drops MessagePorts), then host process.
  app.on("before-quit", () => {
    void import("../services/mcp/directMcpConnectionManager")
      .then(({ getDirectMcpConnectionManager }) =>
        getDirectMcpConnectionManager().disposeAll(),
      )
      .catch((error) => {
        console.warn(
          "[custom3p-mcp] disposeAll on quit failed",
          error instanceof Error ? error.message : String(error),
        );
      });
  });
  return quitState;
}
