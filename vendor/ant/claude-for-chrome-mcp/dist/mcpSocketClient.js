import { promises as fsPromises } from "fs";
import { createConnection } from "net";
import { platform } from "os";
import { dirname } from "path";
import { toLoggerDetail } from "./types.js";
class SocketConnectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "SocketConnectionError";
  }
}
function isToolResponse(message) {
  return "result" in message || "error" in message;
}
function isNotification(message) {
  return "method" in message && typeof message.method === "string";
}
class McpSocketClient {
  socket = null;
  connected = false;
  connecting = false;
  responseCallback = null;
  notificationHandler = null;
  responseBuffer = Buffer.alloc(0);
  reconnectAttempts = 0;
  maxReconnectAttempts = 10;
  reconnectDelay = 1e3;
  reconnectTimer = null;
  context;
  // When true, disables automatic reconnection. Used by McpSocketPool which
  // manages reconnection externally by rescanning available sockets.
  disableAutoReconnect = false;
  constructor(context) {
    this.context = context;
  }
  async connect() {
    const { serverName, logger } = this.context;
    if (this.connecting) {
      logger.info(
        `[${serverName}] Already connecting, skipping duplicate attempt`
      );
      return;
    }
    this.closeSocket();
    this.connecting = true;
    const socketPath = this.context.getSocketPath?.() ?? this.context.socketPath;
    logger.info(`[${serverName}] Attempting to connect to: ${socketPath}`);
    try {
      await this.validateSocketSecurity(socketPath);
    } catch (error) {
      this.connecting = false;
      logger.info(
        `[${serverName}] Security validation failed:`,
        toLoggerDetail(error)
      );
      return;
    }
    this.socket = createConnection(socketPath);
    const connectTimeout = setTimeout(() => {
      if (!this.connected) {
        logger.info(`[${serverName}] Connection attempt timed out after 5000ms`);
        this.closeSocket();
        this.scheduleReconnect();
      }
    }, 5e3);
    this.socket.on("connect", () => {
      clearTimeout(connectTimeout);
      this.connected = true;
      this.connecting = false;
      this.reconnectAttempts = 0;
      logger.info(`[${serverName}] Successfully connected to bridge server`);
    });
    this.socket.on("data", (data) => {
      this.responseBuffer = Buffer.concat([this.responseBuffer, data]);
      while (this.responseBuffer.length >= 4) {
        const length = this.responseBuffer.readUInt32LE(0);
        if (this.responseBuffer.length < 4 + length) {
          break;
        }
        const messageBytes = this.responseBuffer.slice(4, 4 + length);
        this.responseBuffer = this.responseBuffer.slice(4 + length);
        try {
          const message = JSON.parse(
            messageBytes.toString("utf-8")
          );
          if (isNotification(message)) {
            logger.info(
              `[${serverName}] Received notification: ${message.method}`
            );
            if (this.notificationHandler) {
              this.notificationHandler(message);
            }
          } else if (isToolResponse(message)) {
            logger.info(`[${serverName}] Received tool response: ${message}`);
            this.handleResponse(message);
          } else {
            logger.info(`[${serverName}] Received unknown message: ${message}`);
          }
        } catch (error) {
          logger.info(
            `[${serverName}] Failed to parse message:`,
            toLoggerDetail(error)
          );
        }
      }
    });
    this.socket.on("error", (error) => {
      clearTimeout(connectTimeout);
      logger.info(
        `[${serverName}] Socket error (code: ${error.code}):`,
        toLoggerDetail(error)
      );
      this.connected = false;
      this.connecting = false;
      if (error.code && [
        "ECONNREFUSED",
        // Native host not listening (stale socket)
        "ECONNRESET",
        // Connection reset by peer
        "EPIPE",
        // Broken pipe (native host died mid-write)
        "ENOENT",
        // Socket file was deleted
        "EOPNOTSUPP",
        // Socket file exists but is not a valid socket
        "ECONNABORTED"
        // Connection aborted
      ].includes(error.code)) {
        this.scheduleReconnect();
      }
    });
    this.socket.on("close", () => {
      clearTimeout(connectTimeout);
      this.connected = false;
      this.connecting = false;
      this.scheduleReconnect();
    });
  }
  scheduleReconnect() {
    const { serverName, logger } = this.context;
    if (this.disableAutoReconnect) {
      return;
    }
    if (this.reconnectTimer) {
      logger.info(`[${serverName}] Reconnect already scheduled, skipping`);
      return;
    }
    this.reconnectAttempts++;
    const maxTotalAttempts = 100;
    if (this.reconnectAttempts > maxTotalAttempts) {
      logger.info(
        `[${serverName}] Giving up after ${maxTotalAttempts} attempts. Will retry on next tool call.`
      );
      this.reconnectAttempts = 0;
      return;
    }
    const delay = Math.min(
      this.reconnectDelay * 1.5 ** (this.reconnectAttempts - 1),
      3e4
    );
    if (this.reconnectAttempts <= this.maxReconnectAttempts) {
      logger.info(
        `[${serverName}] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`
      );
    } else if (this.reconnectAttempts % 10 === 0) {
      logger.info(
        `[${serverName}] Still polling for native host (attempt ${this.reconnectAttempts})`
      );
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
  handleResponse(response) {
    if (this.responseCallback) {
      const callback = this.responseCallback;
      this.responseCallback = null;
      callback(response);
    }
  }
  setNotificationHandler(handler) {
    this.notificationHandler = handler;
  }
  async ensureConnected() {
    const { serverName } = this.context;
    if (this.connected && this.socket) {
      return true;
    }
    if (!this.socket && !this.connecting) {
      await this.connect();
    }
    return new Promise((resolve, reject) => {
      let checkTimeoutId = null;
      const timeout = setTimeout(() => {
        if (checkTimeoutId) {
          clearTimeout(checkTimeoutId);
        }
        reject(
          new SocketConnectionError(
            `[${serverName}] Connection attempt timed out after 5000ms`
          )
        );
      }, 5e3);
      const checkConnection = () => {
        if (this.connected) {
          clearTimeout(timeout);
          resolve(true);
        } else {
          checkTimeoutId = setTimeout(checkConnection, 500);
        }
      };
      checkConnection();
    });
  }
  async sendRequest(request, timeoutMs = 3e4) {
    const { serverName } = this.context;
    if (!this.socket) {
      throw new SocketConnectionError(
        `[${serverName}] Cannot send request: not connected`
      );
    }
    const socket = this.socket;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseCallback = null;
        reject(
          new SocketConnectionError(
            `[${serverName}] Tool request timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
      this.responseCallback = (response) => {
        clearTimeout(timeout);
        resolve(response);
      };
      const requestJson = JSON.stringify(request);
      const requestBytes = Buffer.from(requestJson, "utf-8");
      const lengthPrefix = Buffer.allocUnsafe(4);
      lengthPrefix.writeUInt32LE(requestBytes.length, 0);
      const message = Buffer.concat([lengthPrefix, requestBytes]);
      socket.write(message);
    });
  }
  async callTool(name, args, _permissionOverrides) {
    const request = {
      method: "execute_tool",
      params: {
        client_id: this.context.clientTypeId,
        tool: name,
        args
      }
    };
    return this.sendRequestWithRetry(request);
  }
  /**
   * Send a request with automatic retry on connection errors.
   *
   * On connection error or timeout, the native host may be a zombie (connected
   * to dead Chrome). Force reconnect to pick up a fresh native host process
   * and retry once.
   */
  async sendRequestWithRetry(request) {
    const { serverName, logger } = this.context;
    try {
      return await this.sendRequest(request);
    } catch (error) {
      if (!(error instanceof SocketConnectionError)) {
        throw error;
      }
      logger.info(
        `[${serverName}] Connection error, forcing reconnect and retrying: ${error.message}`
      );
      this.closeSocket();
      await this.ensureConnected();
      return await this.sendRequest(request);
    }
  }
  async setPermissionMode(_mode, _allowedDomains) {
  }
  isConnected() {
    return this.connected;
  }
  closeSocket() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.connecting = false;
  }
  cleanup() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSocket();
    this.reconnectAttempts = 0;
    this.responseBuffer = Buffer.alloc(0);
    this.responseCallback = null;
  }
  disconnect() {
    this.cleanup();
  }
  async validateSocketSecurity(socketPath) {
    const { serverName, logger } = this.context;
    if (platform() === "win32") {
      return;
    }
    try {
      const dirPath = dirname(socketPath);
      const dirBasename = dirPath.split("/").pop() || "";
      const isSocketDir = dirBasename.startsWith("claude-mcp-browser-bridge-");
      if (isSocketDir) {
        try {
          const dirStats = await fsPromises.stat(dirPath);
          if (dirStats.isDirectory()) {
            const dirMode = dirStats.mode & 511;
            if (dirMode !== 448) {
              throw new Error(
                `[${serverName}] Insecure socket directory permissions: ${dirMode.toString(
                  8
                )} (expected 0700). Directory may have been tampered with.`
              );
            }
            const currentUid2 = process.getuid?.();
            if (currentUid2 !== void 0 && dirStats.uid !== currentUid2) {
              throw new Error(
                `Socket directory not owned by current user (uid: ${currentUid2}, dir uid: ${dirStats.uid}). Potential security risk.`
              );
            }
          }
        } catch (dirError) {
          if (dirError.code !== "ENOENT") {
            throw dirError;
          }
        }
      }
      const stats = await fsPromises.stat(socketPath);
      if (!stats.isSocket()) {
        throw new Error(
          `[${serverName}] Path exists but it's not a socket: ${socketPath}`
        );
      }
      const mode = stats.mode & 511;
      if (mode !== 384) {
        throw new Error(
          `[${serverName}] Insecure socket permissions: ${mode.toString(
            8
          )} (expected 0600). Socket may have been tampered with.`
        );
      }
      const currentUid = process.getuid?.();
      if (currentUid !== void 0 && stats.uid !== currentUid) {
        throw new Error(
          `Socket not owned by current user (uid: ${currentUid}, socket uid: ${stats.uid}). Potential security risk.`
        );
      }
      logger.info(`[${serverName}] Socket security validation passed`);
    } catch (error) {
      if (error.code === "ENOENT") {
        logger.info(
          `[${serverName}] Socket not found, will be created by server`
        );
        return;
      }
      throw error;
    }
  }
}
function createMcpSocketClient(context) {
  return new McpSocketClient(context);
}
export {
  SocketConnectionError,
  createMcpSocketClient
};
