import WebSocket from "ws";
import { SocketConnectionError } from "./mcpSocketClient.js";
import {
  localPlatformLabel,
  toLoggerDetail
} from "./types.js";
const DISCOVERY_TIMEOUT_MS = 5e3;
const PEER_WAIT_TIMEOUT_MS = 1e4;
class BridgeClient {
  ws = null;
  connected = false;
  authenticated = false;
  connecting = false;
  reconnectTimer = null;
  reconnectAttempts = 0;
  pendingCalls = /* @__PURE__ */ new Map();
  notificationHandler = null;
  context;
  permissionMode = "ask";
  allowedDomains;
  tabsContextCollectionTimeoutMs = 2e3;
  toolCallTimeoutMs = 12e4;
  connectionStartTime = null;
  connectionEstablishedTime = null;
  /** The device_id of the selected Chrome extension for targeted routing. */
  selectedDeviceId;
  /** True after first discovery attempt completes (success or timeout). */
  discoveryComplete = false;
  /** Shared promise so concurrent callTool invocations join the same discovery. */
  discoveryPromise = null;
  /** Pending discovery response from bridge. */
  pendingDiscovery = null;
  /** The device_id we had selected before a peer_disconnected — for auto-reselect. */
  previousSelectedDeviceId;
  /** Callbacks waiting for the next peer_connected event. Receives `true` on peer arrival, `false` on abort. */
  peerConnectedWaiters = [];
  /** The request_id of the current pending pairing broadcast. */
  pendingPairingRequestId;
  /** Whether a pairing broadcast is in progress (multiple extensions, no persisted selection). */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: state flag — written in multiple places, read planned for future routing logic
  pairingInProgress = false;
  /** The deviceId from a previous persisted pairing. */
  persistedDeviceId;
  /** Resolve callback for a blocking switchBrowser() call. */
  pendingSwitchResolve = null;
  constructor(context) {
    this.context = context;
    if (context.initialPermissionMode) {
      this.permissionMode = context.initialPermissionMode;
    }
  }
  async ensureConnected() {
    const { logger, serverName } = this.context;
    logger.info(
      `[${serverName}] ensureConnected called, connected=${this.connected}, authenticated=${this.authenticated}, wsState=${this.ws?.readyState}`
    );
    if (this.connected && this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
      logger.info(`[${serverName}] Already connected and authenticated`);
      return true;
    }
    if (!this.connecting) {
      logger.info(`[${serverName}] Not connecting, starting connection...`);
      await this.connect();
    } else {
      logger.info(`[${serverName}] Already connecting, waiting...`);
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logger.info(
          `[${serverName}] Connection timeout, connected=${this.connected}, authenticated=${this.authenticated}`
        );
        resolve(false);
      }, 1e4);
      const check = () => {
        if (this.connected && this.authenticated) {
          logger.info(`[${serverName}] Connection successful`);
          clearTimeout(timeout);
          resolve(true);
        } else if (!this.connecting) {
          logger.info(`[${serverName}] No longer connecting, giving up`);
          clearTimeout(timeout);
          resolve(false);
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });
  }
  async callTool(name, args, permissionOverrides) {
    const { logger, serverName, trackEvent } = this.context;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new SocketConnectionError(`[${serverName}] Bridge not connected`);
    }
    if (!this.selectedDeviceId && !this.discoveryComplete) {
      this.discoveryPromise ??= this.discoverAndSelectExtension().finally(
        () => {
          this.discoveryPromise = null;
        }
      );
      await this.discoveryPromise;
    }
    const toolUseId = crypto.randomUUID();
    const isTabsContext = name === "tabs_context_mcp";
    const startTime = Date.now();
    const timeoutMs = isTabsContext ? this.tabsContextCollectionTimeoutMs : this.toolCallTimeoutMs;
    trackEvent?.("chrome_bridge_tool_call_started", {
      tool_name: name,
      tool_use_id: toolUseId
    });
    const effectivePermissionMode = permissionOverrides?.permissionMode ?? this.permissionMode;
    const effectiveAllowedDomains = permissionOverrides?.allowedDomains ?? this.allowedDomains;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pendingCalls.get(toolUseId);
        if (pending) {
          this.pendingCalls.delete(toolUseId);
          const durationMs = Date.now() - pending.startTime;
          if (isTabsContext && pending.results.length > 0) {
            trackEvent?.("chrome_bridge_tool_call_completed", {
              tool_name: name,
              tool_use_id: toolUseId,
              duration_ms: durationMs
            });
            resolve(this.mergeTabsResults(pending.results));
          } else {
            logger.warn(
              `[${serverName}] Tool call timeout: ${name} (${toolUseId.slice(0, 8)}) after ${durationMs}ms, pending calls: ${this.pendingCalls.size}`
            );
            trackEvent?.("chrome_bridge_tool_call_timeout", {
              tool_name: name,
              tool_use_id: toolUseId,
              duration_ms: durationMs,
              timeout_ms: timeoutMs
            });
            reject(
              new SocketConnectionError(
                `[${serverName}] Tool call timed out: ${name}`
              )
            );
          }
        }
      }, timeoutMs);
      this.pendingCalls.set(toolUseId, {
        resolve,
        reject,
        timer,
        results: [],
        isTabsContext,
        onPermissionRequest: permissionOverrides?.onPermissionRequest,
        startTime,
        toolName: name
      });
      const message = {
        type: "tool_call",
        tool_use_id: toolUseId,
        client_type: this.context.clientTypeId,
        tool: name,
        args
      };
      if (this.selectedDeviceId) {
        message.target_device_id = this.selectedDeviceId;
      }
      if (effectivePermissionMode) {
        message.permission_mode = effectivePermissionMode;
      }
      if (effectiveAllowedDomains?.length) {
        message.allowed_domains = effectiveAllowedDomains;
      }
      if (permissionOverrides?.onPermissionRequest) {
        message.handle_permission_prompts = true;
      }
      logger.debug(
        `[${serverName}] Sending tool_call: ${name} (${toolUseId.slice(0, 8)})`
      );
      this.ws.send(JSON.stringify(message));
    });
  }
  isConnected() {
    return this.connected && this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }
  disconnect() {
    this.cleanup();
  }
  setNotificationHandler(handler) {
    this.notificationHandler = handler;
  }
  async setPermissionMode(mode, allowedDomains) {
    this.permissionMode = mode;
    this.allowedDomains = allowedDomains;
  }
  // ===========================================================================
  // Extension discovery and selection
  // ===========================================================================
  /**
   * Discover connected extensions and auto-select one, or broadcast a pairing request.
   * Called lazily on the first tool call.
   */
  async discoverAndSelectExtension() {
    const { logger, serverName } = this.context;
    this.persistedDeviceId ??= this.context.getPersistedDeviceId?.();
    let extensions = await this.queryBridgeExtensions();
    if (extensions.length === 0) {
      logger.info(
        `[${serverName}] No extensions connected, waiting up to ${PEER_WAIT_TIMEOUT_MS}ms for peer_connected`
      );
      const peerArrived = await this.waitForPeerConnected(PEER_WAIT_TIMEOUT_MS);
      if (peerArrived) {
        extensions = await this.queryBridgeExtensions();
      }
    }
    this.discoveryComplete = true;
    if (extensions.length === 0) {
      logger.info(`[${serverName}] No extensions found after waiting`);
      return;
    }
    if (extensions.length === 1) {
      const ext = extensions[0];
      if (!this.isLocalExtension(ext)) {
        this.context.onRemoteExtensionWarning?.(ext);
      }
      this.selectExtension(ext.deviceId);
      return;
    }
    if (this.persistedDeviceId) {
      const persisted = extensions.find(
        (e) => e.deviceId === this.persistedDeviceId
      );
      if (persisted) {
        logger.info(
          `[${serverName}] Auto-connecting to persisted extension: ${persisted.name || persisted.deviceId.slice(0, 8)}`
        );
        this.selectExtension(persisted.deviceId);
        return;
      }
    }
    this.broadcastPairingRequest();
    this.pairingInProgress = true;
  }
  /**
   * Query the bridge for connected extensions. Returns empty array on timeout.
   * Deduplicates by deviceId, keeping the most recent connection — the bridge
   * may report stale duplicates (e.g. after a service worker restart).
   */
  async queryBridgeExtensions() {
    const raw = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingDiscovery = null;
        resolve([]);
      }, DISCOVERY_TIMEOUT_MS);
      this.pendingDiscovery = { resolve, timeout };
      this.ws?.send(JSON.stringify({ type: "list_extensions" }));
    });
    const byDeviceId = /* @__PURE__ */ new Map();
    for (const ext of raw) {
      const existing = byDeviceId.get(ext.deviceId);
      if (!existing || ext.connectedAt > existing.connectedAt) {
        byDeviceId.set(ext.deviceId, ext);
      }
    }
    return [...byDeviceId.values()];
  }
  /**
   * Select an extension by device ID for per-message targeted routing.
   */
  selectExtension(deviceId) {
    const { logger, serverName } = this.context;
    this.selectedDeviceId = deviceId;
    this.previousSelectedDeviceId = void 0;
    logger.info(
      `[${serverName}] Selected Chrome extension: ${deviceId.slice(0, 8)}...`
    );
  }
  /**
   * Check if an extension might be on the same machine as this MCP client
   * by comparing OS platform. Extensions can't provide a real hostname from
   * the service worker sandbox, so platform is a weak heuristic. The profile
   * email is the primary differentiator shown in the selection dialog.
   */
  isLocalExtension(ext) {
    if (!ext.osPlatform) return false;
    return ext.osPlatform === localPlatformLabel();
  }
  /**
   * Returns a promise that resolves to `true` when a peer_connected event
   * fires, or `false` if the timeout elapses first.
   */
  waitForPeerConnected(timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.peerConnectedWaiters = this.peerConnectedWaiters.filter(
          (w) => w !== onPeer
        );
        resolve(false);
      }, timeoutMs);
      const onPeer = (arrived) => {
        clearTimeout(timer);
        resolve(arrived);
      };
      this.peerConnectedWaiters.push(onPeer);
    });
  }
  /**
   * Broadcast a pairing request to all connected extensions.
   * Non-blocking — the pairing_response handler will select the extension.
   */
  broadcastPairingRequest() {
    const requestId = crypto.randomUUID();
    this.pendingPairingRequestId = requestId;
    this.ws?.send(
      JSON.stringify({
        type: "pairing_request",
        request_id: requestId,
        client_type: this.context.clientTypeId
      })
    );
  }
  /**
   * Switch to a different browser. Broadcasts a pairing request and blocks
   * until a response arrives or timeout (120s). Returns the paired extension
   * info, or null on timeout.
   */
  async switchBrowser() {
    const extensions = await this.queryBridgeExtensions();
    const currentDeviceId = this.selectedDeviceId ?? this.previousSelectedDeviceId;
    if (extensions.length === 0 || extensions.length === 1 && (!currentDeviceId || extensions[0].deviceId === currentDeviceId)) {
      return "no_other_browsers";
    }
    this.previousSelectedDeviceId = this.selectedDeviceId;
    this.selectedDeviceId = void 0;
    this.discoveryComplete = false;
    this.pairingInProgress = false;
    const requestId = crypto.randomUUID();
    this.pendingPairingRequestId = requestId;
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return null;
    }
    this.ws.send(
      JSON.stringify({
        type: "pairing_request",
        request_id: requestId,
        client_type: this.context.clientTypeId
      })
    );
    if (this.pendingSwitchResolve) {
      this.pendingSwitchResolve(null);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingPairingRequestId === requestId) {
          this.pendingPairingRequestId = void 0;
        }
        this.pendingSwitchResolve = null;
        resolve(null);
      }, 12e4);
      this.pendingSwitchResolve = (result) => {
        clearTimeout(timer);
        this.pendingSwitchResolve = null;
        resolve(result);
      };
    });
  }
  async connect() {
    const { logger, serverName, bridgeConfig, trackEvent } = this.context;
    if (!bridgeConfig) {
      logger.error(`[${serverName}] No bridge config provided`);
      return;
    }
    if (this.connecting) {
      return;
    }
    this.connecting = true;
    this.authenticated = false;
    this.connectionStartTime = Date.now();
    this.closeSocket();
    let userId;
    let token;
    if (bridgeConfig.devUserId) {
      userId = bridgeConfig.devUserId;
      logger.debug(`[${serverName}] Using dev user ID for bridge connection`);
    } else {
      logger.debug(`[${serverName}] Fetching user ID for bridge connection`);
      const fetchedUserId = await bridgeConfig.getUserId();
      if (!fetchedUserId) {
        const durationMs = Date.now() - this.connectionStartTime;
        logger.error(
          `[${serverName}] No user ID available after ${durationMs}ms`
        );
        trackEvent?.("chrome_bridge_connection_failed", {
          duration_ms: durationMs,
          error_type: "no_user_id",
          reconnect_attempt: this.reconnectAttempts
        });
        this.connecting = false;
        this.context.onAuthenticationError?.();
        return;
      }
      userId = fetchedUserId;
      logger.debug(`[${serverName}] Fetching OAuth token for bridge connection`);
      token = await bridgeConfig.getOAuthToken();
      if (!token) {
        const durationMs = Date.now() - this.connectionStartTime;
        logger.error(
          `[${serverName}] No OAuth token available after ${durationMs}ms`
        );
        trackEvent?.("chrome_bridge_connection_failed", {
          duration_ms: durationMs,
          error_type: "no_oauth_token",
          reconnect_attempt: this.reconnectAttempts
        });
        this.connecting = false;
        this.context.onAuthenticationError?.();
        return;
      }
    }
    const wsUrl = `${bridgeConfig.url}/chrome/${userId}`;
    logger.info(`[${serverName}] Connecting to bridge: ${wsUrl}`);
    trackEvent?.("chrome_bridge_connection_started", {
      bridge_url: wsUrl
    });
    try {
      this.ws = new WebSocket(wsUrl);
    } catch (error) {
      const durationMs = Date.now() - this.connectionStartTime;
      logger.error(
        `[${serverName}] Failed to create WebSocket after ${durationMs}ms:`,
        toLoggerDetail(error)
      );
      trackEvent?.("chrome_bridge_connection_failed", {
        duration_ms: durationMs,
        error_type: "websocket_error",
        reconnect_attempt: this.reconnectAttempts
      });
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }
    this.ws.on("open", () => {
      logger.info(
        `[${serverName}] WebSocket connected, sending connect message`
      );
      const connectMessage = {
        type: "connect",
        client_type: this.context.clientTypeId
      };
      if (bridgeConfig.devUserId) {
        connectMessage.dev_user_id = bridgeConfig.devUserId;
      } else {
        connectMessage.oauth_token = token;
      }
      this.ws?.send(JSON.stringify(connectMessage));
    });
    this.ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        logger.debug(
          `[${serverName}] Bridge received: ${JSON.stringify(message)}`
        );
        this.handleMessage(message);
      } catch (error) {
        logger.error(
          `[${serverName}] Failed to parse bridge message:`,
          toLoggerDetail(error)
        );
      }
    });
    this.ws.on("close", (code) => {
      const durationSinceConnect = this.connectionEstablishedTime ? Date.now() - this.connectionEstablishedTime : 0;
      logger.info(
        `[${serverName}] Bridge connection closed (code: ${code}, duration: ${durationSinceConnect}ms)`
      );
      trackEvent?.("chrome_bridge_disconnected", {
        close_code: code,
        duration_since_connect_ms: durationSinceConnect,
        reconnect_attempt: this.reconnectAttempts + 1
      });
      this.connected = false;
      this.authenticated = false;
      this.connecting = false;
      this.connectionEstablishedTime = null;
      this.scheduleReconnect();
    });
    this.ws.on("error", (error) => {
      const durationMs = this.connectionStartTime ? Date.now() - this.connectionStartTime : 0;
      logger.error(
        `[${serverName}] Bridge WebSocket error after ${durationMs}ms: ${error.message}`
      );
      trackEvent?.("chrome_bridge_connection_failed", {
        duration_ms: durationMs,
        error_type: "websocket_error",
        reconnect_attempt: this.reconnectAttempts
      });
      this.connected = false;
      this.authenticated = false;
      this.connecting = false;
    });
  }
  handleMessage(message) {
    const { logger, serverName, trackEvent } = this.context;
    switch (message.type) {
      case "paired": {
        const durationMs = this.connectionStartTime ? Date.now() - this.connectionStartTime : 0;
        logger.info(
          `[${serverName}] Paired with Chrome extension (duration: ${durationMs}ms)`
        );
        this.connected = true;
        this.authenticated = true;
        this.connecting = false;
        this.reconnectAttempts = 0;
        this.connectionEstablishedTime = Date.now();
        trackEvent?.("chrome_bridge_connection_succeeded", {
          duration_ms: durationMs,
          status: "paired"
        });
        break;
      }
      case "waiting": {
        const durationMs = this.connectionStartTime ? Date.now() - this.connectionStartTime : 0;
        logger.info(
          `[${serverName}] Waiting for Chrome extension to connect (duration: ${durationMs}ms)`
        );
        this.connected = true;
        this.authenticated = true;
        this.connecting = false;
        this.reconnectAttempts = 0;
        this.connectionEstablishedTime = Date.now();
        trackEvent?.("chrome_bridge_connection_succeeded", {
          duration_ms: durationMs,
          status: "waiting"
        });
        break;
      }
      case "peer_connected":
        logger.info(`[${serverName}] Chrome extension connected to bridge`);
        trackEvent?.("chrome_bridge_peer_connected", null);
        if (!this.selectedDeviceId) {
          this.discoveryComplete = false;
        }
        if (this.previousSelectedDeviceId && message.deviceId === this.previousSelectedDeviceId && !this.pendingSwitchResolve) {
          logger.info(
            `[${serverName}] Previously selected extension reconnected, auto-reselecting`
          );
          this.selectExtension(this.previousSelectedDeviceId);
          this.previousSelectedDeviceId = void 0;
        }
        if (this.peerConnectedWaiters.length > 0) {
          const waiters = this.peerConnectedWaiters;
          this.peerConnectedWaiters = [];
          for (const waiter of waiters) {
            waiter(true);
          }
        }
        break;
      case "peer_disconnected":
        logger.info(`[${serverName}] Chrome extension disconnected from bridge`);
        trackEvent?.("chrome_bridge_peer_disconnected", null);
        if (message.deviceId && message.deviceId === this.selectedDeviceId) {
          logger.info(
            `[${serverName}] Selected extension disconnected, clearing selection`
          );
          this.previousSelectedDeviceId = this.selectedDeviceId;
          this.selectedDeviceId = void 0;
          this.discoveryComplete = false;
        }
        break;
      case "extensions_list":
        if (this.pendingDiscovery) {
          clearTimeout(this.pendingDiscovery.timeout);
          this.pendingDiscovery.resolve(
            message.extensions ?? []
          );
          this.pendingDiscovery = null;
        }
        break;
      case "pairing_response": {
        const requestId = message.request_id;
        const responseDeviceId = message.device_id;
        const responseName = message.name;
        if (this.pendingPairingRequestId === requestId && responseDeviceId && responseName) {
          this.pendingPairingRequestId = void 0;
          this.pairingInProgress = false;
          this.selectExtension(responseDeviceId);
          this.context.onExtensionPaired?.(responseDeviceId, responseName);
          logger.info(
            `[${serverName}] Paired with "${responseName}" (${responseDeviceId.slice(0, 8)})`
          );
          if (this.pendingSwitchResolve) {
            this.pendingSwitchResolve({
              deviceId: responseDeviceId,
              name: responseName
            });
            this.pendingSwitchResolve = null;
          }
        }
        break;
      }
      case "ping":
        this.ws?.send(JSON.stringify({ type: "pong" }));
        break;
      case "pong":
        break;
      case "tool_result":
        this.handleToolResult(message);
        break;
      case "permission_request":
        void this.handlePermissionRequest(message);
        break;
      case "notification":
        if (this.notificationHandler) {
          this.notificationHandler({
            method: message.method,
            params: message.params
          });
        }
        break;
      case "error":
        logger.warn(`[${serverName}] Bridge error: ${message.error}`);
        if (this.selectedDeviceId) {
          this.selectedDeviceId = void 0;
          this.discoveryComplete = false;
        }
        break;
      default:
        logger.warn(
          `[${serverName}] Unrecognized bridge message type: ${message.type}`
        );
    }
  }
  async handlePermissionRequest(message) {
    const { logger, serverName } = this.context;
    const toolUseId = message.tool_use_id;
    const requestId = message.request_id;
    if (!toolUseId || !requestId) {
      logger.warn(
        `[${serverName}] permission_request missing tool_use_id or request_id`
      );
      return;
    }
    const pending = this.pendingCalls.get(toolUseId);
    if (!pending?.onPermissionRequest) {
      logger.debug(
        `[${serverName}] Ignoring permission_request for unknown tool_use_id ${toolUseId.slice(0, 8)} (not our call)`
      );
      return;
    }
    const request = {
      toolUseId,
      requestId,
      toolType: message.tool_type ?? "unknown",
      url: message.url ?? "",
      actionData: message.action_data
    };
    try {
      const allowed = await pending.onPermissionRequest(request);
      this.sendPermissionResponse(requestId, allowed);
    } catch (error) {
      logger.error(
        `[${serverName}] Error handling permission request:`,
        toLoggerDetail(error)
      );
      this.sendPermissionResponse(requestId, false);
    }
  }
  sendPermissionResponse(requestId, allowed) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const message = {
        type: "permission_response",
        request_id: requestId,
        allowed
      };
      if (this.selectedDeviceId) {
        message.target_device_id = this.selectedDeviceId;
      }
      this.ws.send(JSON.stringify(message));
    }
  }
  handleToolResult(message) {
    const { logger, serverName, trackEvent } = this.context;
    const toolUseId = message.tool_use_id;
    if (!toolUseId) {
      logger.warn(`[${serverName}] Received tool_result without tool_use_id`);
      return;
    }
    const pending = this.pendingCalls.get(toolUseId);
    if (!pending) {
      logger.debug(
        `[${serverName}] Received tool_result for unknown call: ${toolUseId.slice(0, 8)}`
      );
      return;
    }
    const durationMs = Date.now() - pending.startTime;
    const normalized = this.normalizeBridgeResponse(message);
    const isError = Boolean(message.is_error) || "error" in normalized;
    if (pending.isTabsContext && !this.selectedDeviceId) {
      pending.results.push(normalized);
    } else {
      clearTimeout(pending.timer);
      this.pendingCalls.delete(toolUseId);
      if (isError) {
        const errorContent = normalized.error?.content;
        let errorMessage = "Unknown error";
        if (Array.isArray(errorContent)) {
          const textItem = errorContent.find(
            (item) => typeof item === "object" && item !== null && "text" in item
          );
          if (textItem?.text) {
            errorMessage = textItem.text.slice(0, 200);
          }
        }
        logger.warn(
          `[${serverName}] Tool call error: ${pending.toolName} (${toolUseId.slice(0, 8)}) after ${durationMs}ms`
        );
        trackEvent?.("chrome_bridge_tool_call_error", {
          tool_name: pending.toolName,
          tool_use_id: toolUseId,
          duration_ms: durationMs,
          error_message: errorMessage
        });
      } else {
        logger.debug(
          `[${serverName}] Tool call completed: ${pending.toolName} (${toolUseId.slice(0, 8)}) in ${durationMs}ms`
        );
        trackEvent?.("chrome_bridge_tool_call_completed", {
          tool_name: pending.toolName,
          tool_use_id: toolUseId,
          duration_ms: durationMs
        });
      }
      pending.resolve(normalized);
    }
  }
  normalizeBridgeResponse(message) {
    if (message.result || message.error) {
      return message;
    }
    if (message.content) {
      if (message.is_error) {
        return { error: { content: message.content } };
      }
      return { result: { content: message.content } };
    }
    return message;
  }
  mergeTabsResults(results) {
    const mergedTabs = [];
    for (const result of results) {
      const msg = result;
      const resultData = msg.result;
      const content = resultData?.content;
      if (!content || !Array.isArray(content)) continue;
      for (const item of content) {
        if (item.type === "text" && item.text) {
          try {
            const parsed = JSON.parse(item.text);
            if (Array.isArray(parsed)) {
              mergedTabs.push(...parsed);
            } else if (parsed?.availableTabs && Array.isArray(parsed.availableTabs)) {
              mergedTabs.push(...parsed.availableTabs);
            }
          } catch {
          }
        }
      }
    }
    if (mergedTabs.length > 0) {
      const tabListText = mergedTabs.map((t) => {
        const tab = t;
        return `  \u2022 tabId ${tab.tabId}: "${tab.title}" (${tab.url})`;
      }).join("\n");
      return {
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ availableTabs: mergedTabs })
            },
            {
              type: "text",
              text: `

Tab Context:
- Available tabs:
${tabListText}`
            }
          ]
        }
      };
    }
    return results[0];
  }
  scheduleReconnect() {
    const { logger, serverName, trackEvent } = this.context;
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    if (this.reconnectAttempts > 100) {
      logger.warn(
        `[${serverName}] Giving up bridge reconnection after 100 attempts`
      );
      trackEvent?.("chrome_bridge_reconnect_exhausted", {
        total_attempts: 100
      });
      this.reconnectAttempts = 0;
      return;
    }
    const delay = Math.min(2e3 * 1.5 ** (this.reconnectAttempts - 1), 3e4);
    if (this.reconnectAttempts <= 10 || this.reconnectAttempts % 10 === 0) {
      logger.info(
        `[${serverName}] Bridge reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`
      );
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
  closeSocket() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
    this.selectedDeviceId = void 0;
    this.discoveryComplete = false;
    this.pendingPairingRequestId = void 0;
    this.pairingInProgress = false;
    if (this.pendingSwitchResolve) {
      this.pendingSwitchResolve(null);
      this.pendingSwitchResolve = null;
    }
    if (this.pendingDiscovery) {
      clearTimeout(this.pendingDiscovery.timeout);
      this.pendingDiscovery.resolve([]);
      this.pendingDiscovery = null;
    }
    if (this.peerConnectedWaiters.length > 0) {
      const waiters = this.peerConnectedWaiters;
      this.peerConnectedWaiters = [];
      for (const waiter of waiters) {
        waiter(false);
      }
    }
  }
  cleanup() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [id, pending] of this.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new SocketConnectionError("Bridge client disconnected"));
      this.pendingCalls.delete(id);
    }
    this.closeSocket();
    this.reconnectAttempts = 0;
  }
}
function createBridgeClient(context) {
  return new BridgeClient(context);
}
export {
  BridgeClient,
  createBridgeClient
};
