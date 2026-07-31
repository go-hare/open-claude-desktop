/**
 * Official Gir residual (app.asar): register internal MCP "Claude in Chrome" (LM).
 *
 * Official vir() builds ClaudeForChromeContext with bridgeConfig (OAuth bridge).
 * Product 3p residual: socket-only transport (createChromeSocketClient + getSocketPaths)
 * — do not invent Anthropic OAuth bridge pairing.
 *
 * Socket layout mirrors official Uir/bir + @ant/chrome-native-host:
 *   /tmp/claude-mcp-browser-bridge-<user>/*.sock
 *
 * BrowserUse (officialBridgeAdapter) calls LocalAgentModeSessions.mcpCallTool(
 *   "Claude in Chrome", toolName, input
 * ).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createChromeSocketClient,
  handleToolCall as vendorHandleToolCall,
} from "./claudeForChromeMcpShim";
import type {
  ClaudeForChromeContext,
  Logger,
  SocketClient,
} from "./claudeForChromeMcpShim";
import {
  CHROME_EXTENSION_ID_CURRENT,
  CHROME_EXTENSION_ID_LEGACY,
} from "./chromeNativeHost";

/** Official LM */
export const CLAUDE_IN_CHROME_MCP_SERVER_NAME = "Claude in Chrome";

/** Official Lai — agent tool prefix residual (mcp__Claude_in_Chrome__). */
export const CLAUDE_IN_CHROME_AGENT_SERVER_NAME = "Claude_in_Chrome";

export function isClaudeInChromeMcpServerName(name: unknown): boolean {
  return (
    name === CLAUDE_IN_CHROME_MCP_SERVER_NAME ||
    name === CLAUDE_IN_CHROME_AGENT_SERVER_NAME
  );
}

function defaultLogger(): Logger {
  return {
    info: (message, detail) =>
      console.info(message, detail === undefined ? "" : detail),
    error: (message, detail) =>
      console.error(message, detail === undefined ? "" : detail),
    warn: (message, detail) =>
      console.warn(message, detail === undefined ? "" : detail),
    debug: (message, detail) =>
      console.debug(message, detail === undefined ? "" : detail),
    silly: (message, detail) =>
      console.debug(message, detail === undefined ? "" : detail),
  };
}

/** Official bir() default socket path (legacy single-socket). */
export function defaultChromeBridgeSocketPath(
  username = os.userInfo().username || "default",
  platform: NodeJS.Platform = process.platform,
): string {
  const name = `claude-mcp-browser-bridge-${username}`;
  if (platform === "win32") return `\\\\.\\pipe\\${name}`;
  return path.join("/tmp", name, "0.sock");
}

/**
 * Official Uir() — all candidate socket paths for multi-profile host.
 */
export function listChromeBridgeSocketPaths(
  username = os.userInfo().username || "default",
  platform: NodeJS.Platform = process.platform,
  tmpdir = os.tmpdir(),
): string[] {
  const name = `claude-mcp-browser-bridge-${username}`;
  if (platform === "win32") return [`\\\\.\\pipe\\${name}`];
  const paths: string[] = [];
  const dir = path.join("/tmp", name);
  try {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith(".sock")) paths.push(path.join(dir, file));
      }
    }
  } catch {
    /* ignore */
  }
  const legacyTmpdir = path.join(tmpdir, name);
  if (
    fs.existsSync(legacyTmpdir) &&
    !fs.statSync(legacyTmpdir).isDirectory() &&
    !paths.includes(legacyTmpdir)
  ) {
    paths.push(legacyTmpdir);
  }
  const legacyTmp = path.join("/tmp", name);
  if (
    legacyTmp !== legacyTmpdir &&
    fs.existsSync(legacyTmp) &&
    !fs.statSync(legacyTmp).isDirectory() &&
    !paths.includes(legacyTmp)
  ) {
    paths.push(legacyTmp);
  }
  return paths;
}

export type ClaudeInChromeMcpOptions = {
  /** Official gi("chromeExtensionEnabled") — default true (SSA). */
  isEnabled?: () => boolean;
  logger?: Logger;
  /** Official xn chromeExtension bag — paired device id. */
  getPersistedDeviceId?: () => string | undefined;
  onExtensionPaired?: (deviceId: string, name: string) => void;
  getSocketPaths?: () => string[];
  socketPath?: string;
};

type Runtime = {
  context: ClaudeForChromeContext;
  client: SocketClient;
};

let runtime: Runtime | null = null;

export function buildClaudeForChromeContext(
  options: ClaudeInChromeMcpOptions = {},
): ClaudeForChromeContext {
  const logger = options.logger ?? defaultLogger();
  const getSocketPaths =
    options.getSocketPaths ??
    (() => listChromeBridgeSocketPaths());
  const socketPath =
    options.socketPath ?? defaultChromeBridgeSocketPath();
  return {
    serverName: CLAUDE_IN_CHROME_MCP_SERVER_NAME,
    logger,
    socketPath,
    getSocketPaths,
    clientTypeId: "desktop",
    onToolCallDisconnected: () =>
      "Claude in Chrome extension is not connected. Install the extension, restart Chrome, and open the side panel so the native host can attach.",
    onAuthenticationError: () => {
      logger.warn(
        `[${CLAUDE_IN_CHROME_MCP_SERVER_NAME}] Authentication error from extension (socket path; no OAuth invent)`,
      );
    },
    isDisabled: () => options.isEnabled?.() === false,
    getPersistedDeviceId: options.getPersistedDeviceId,
    onExtensionPaired: options.onExtensionPaired
      ? (deviceId, name) => options.onExtensionPaired?.(deviceId, name)
      : undefined,
  };
}

/**
 * Official Gir() product arm: create singleton socket client (YsA residual).
 * Safe to call multiple times — reuses client.
 *
 * Re-calls may refresh live preference callbacks. Kir init is void/async and
 * mcpCallTool can race it; handlers must pass re-reading getters, and later
 * ensure() must not leave a one-shot prefs snapshot frozen forever.
 */
export function ensureClaudeInChromeMcp(
  options: ClaudeInChromeMcpOptions = {},
): Runtime {
  if (runtime) {
    applyClaudeInChromeMcpOptions(runtime.context, options);
    return runtime;
  }
  const context = buildClaudeForChromeContext(options);
  const client = createChromeSocketClient(context);
  runtime = { context, client };
  context.logger.info(
    `[${CLAUDE_IN_CHROME_MCP_SERVER_NAME}] MCP socket client registered (socket-only residual)`,
  );
  return runtime;
}

/** Refresh preference/pairing hooks on an existing ClaudeForChromeContext. */
function applyClaudeInChromeMcpOptions(
  context: ClaudeForChromeContext,
  options: ClaudeInChromeMcpOptions,
): void {
  if (options.isEnabled) {
    context.isDisabled = () => options.isEnabled?.() === false;
  }
  if (options.getPersistedDeviceId) {
    context.getPersistedDeviceId = options.getPersistedDeviceId;
  }
  if (options.onExtensionPaired) {
    context.onExtensionPaired = (deviceId, name) =>
      options.onExtensionPaired?.(deviceId, name);
  }
  if (options.logger) {
    context.logger = options.logger;
  }
  if (options.getSocketPaths) {
    context.getSocketPaths = options.getSocketPaths;
  }
  if (options.socketPath) {
    context.socketPath = options.socketPath;
  }
}

/** Test/reset hook. */
export function resetClaudeInChromeMcpForTests(): void {
  if (runtime) {
    try {
      runtime.client.disconnect();
    } catch {
      /* ignore */
    }
  }
  runtime = null;
}

export type ClaudeInChromeToolResult = {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
};

/**
 * Call a Claude in Chrome tool via socket client (handleToolCall residual).
 * Returns MCP CallToolResult-shaped object for BrowserUse normalizer.
 */
export async function callClaudeInChromeTool(
  toolName: string,
  args: Record<string, unknown> = {},
  options: ClaudeInChromeMcpOptions = {},
): Promise<ClaudeInChromeToolResult> {
  const { context, client } = ensureClaudeInChromeMcp(options);
  if (context.isDisabled?.()) {
    return {
      content: [
        {
          type: "text",
          text: "Claude in Chrome is disabled (chromeExtensionEnabled=false).",
        },
      ],
      isError: true,
    };
  }
  try {
    const result = await vendorHandleToolCall(
      context,
      client,
      toolName,
      args,
    );
    const content = Array.isArray(result?.content)
      ? (result.content as Array<Record<string, unknown>>)
      : [{ type: "text", text: JSON.stringify(result ?? null) }];
    return {
      content,
      ...(result?.isError ? { isError: true as const } : {}),
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Claude in Chrome tool error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Official Kir() order (product):
 *   1. host binary accessible
 *   2. xir clean non-primary
 *   3. vrt sync primary manifests
 *   4. Jir watch optional
 *   5. Gir register MCP client
 *
 * Enterprise InA local-MCP gate: product treats allowed (no invent deny).
 */
export async function initializeClaudeInChromeBrowserAutomation(options?: {
  isEnabled?: () => boolean;
  userDataPath?: string;
  getPersistedDeviceId?: () => string | undefined;
  onExtensionPaired?: (deviceId: string, name: string) => void;
  enableWatch?: boolean;
  log?: (msg: string) => void;
}): Promise<{
  ok: boolean;
  hostPath: string | null;
  wrote: string[];
  removed: string[];
  reason?: string;
}> {
  const log = options?.log ?? ((m) => console.info(m));
  try {
    const { resolveChromeNativeHostBinaryPath, syncChromeNativeHost } =
      await import("./chromeNativeHost");
    const hostPath = resolveChromeNativeHostBinaryPath({
      userDataPath: options?.userDataPath,
    });
    if (!hostPath) {
      log(
        "[Chrome Extension MCP] Skipping native host setup: binary not found",
      );
      // Still register socket MCP so list_connected can report disconnected honestly.
      ensureClaudeInChromeMcp({
        isEnabled: options?.isEnabled,
        getPersistedDeviceId: options?.getPersistedDeviceId,
        onExtensionPaired: options?.onExtensionPaired,
      });
      return {
        ok: false,
        hostPath: null,
        wrote: [],
        removed: [],
        reason: "binary_not_found",
      };
    }
    try {
      await fs.promises.access(hostPath);
    } catch {
      log(
        `[Chrome Extension MCP] Skipping native host setup: binary not found at ${hostPath}`,
      );
      ensureClaudeInChromeMcp({
        isEnabled: options?.isEnabled,
        getPersistedDeviceId: options?.getPersistedDeviceId,
        onExtensionPaired: options?.onExtensionPaired,
      });
      return {
        ok: false,
        hostPath,
        wrote: [],
        removed: [],
        reason: "binary_not_accessible",
      };
    }

    const sync = await syncChromeNativeHost({
      hostBinaryPath: hostPath,
      userDataPath: options?.userDataPath,
      log,
    });

    ensureClaudeInChromeMcp({
      isEnabled: options?.isEnabled,
      getPersistedDeviceId: options?.getPersistedDeviceId,
      onExtensionPaired: options?.onExtensionPaired,
    });

    if (options?.enableWatch !== false) {
      try {
        const { startChromeExtensionInstallWatcher } = await import(
          "./chromeExtensionWatch"
        );
        startChromeExtensionInstallWatcher({
          userDataPath: options?.userDataPath,
          log,
        });
      } catch (error) {
        log(
          `[Chrome Extension MCP] Watch residual skipped: ${String(error)}`,
        );
      }
    }

    log(
      `[${CLAUDE_IN_CHROME_MCP_SERVER_NAME}] MCP server registered (ids detect ${CHROME_EXTENSION_ID_CURRENT}/${CHROME_EXTENSION_ID_LEGACY})`,
    );
    return { ok: true, ...sync };
  } catch (error) {
    log(
      `[Chrome Extension MCP] Failed to initialize browser automation: ${String(error)}`,
    );
    return {
      ok: false,
      hostPath: null,
      wrote: [],
      removed: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
