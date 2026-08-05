/**
 * Main-process host for product directMcpHost UtilityProcess.
 * data-official-source: app.asar index.js gni / Ini / cni / mUA / Eni / Cni
 *   (module export: spawnUtilityClient, disposeDirectMcpHost)
 *
 * Residual protocol:
 *   path: .vite/build/mcp-runtime/directMcpHost.js
 *   serviceName: "Custom 3P MCP Host"
 *   parent → child: { type: "addServer", config } + MessagePort
 *   child → port: { type: "ready", tools } | { type: "error", message }
 *   port MCP framing: { type: "mcp", message } both directions
 *
 * Timeouts residual: spawn 5s (ani), addServer ready 15s (Sse).
 *
 * Non-goals (not invented here):
 *   - OAuth probe / safeStorage tokens / loopback authorize (SUA / N2e / M2e)
 *   - headersHelper subprocess cache (m2e) — callers may pass headers directly
 *   - full custom3p-mcp enterprise connection manager / pendingOAuth park
 */
import { app, utilityProcess, MessageChannelMain } from "electron";
import type { MessagePortMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const SPAWN_TIMEOUT_MS = 5_000;
const ADD_SERVER_READY_TIMEOUT_MS = 15_000;
const HOST_EXIT_GRACE_MS = 5_000;

export type DirectMcpServerConnectConfig = {
  name: string;
  url: string;
  transport?: string;
  headers?: Record<string, string>;
  appVersion?: string;
};

export type DirectMcpToolSummary = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  _meta?: unknown;
  [key: string]: unknown;
};

export type SpawnUtilityClientResult = {
  client: Client;
  tools: DirectMcpToolSummary[];
  dispose: () => Promise<void>;
};

type HostHandle = {
  addServer: (
    config: DirectMcpServerConnectConfig,
    extraHeaders?: Record<string, string>,
  ) => Promise<SpawnUtilityClientResult>;
  disposeHost: () => Promise<void>;
};

function resolveDirectMcpHostWorkerPath(): string {
  // residual gni: packaged → resources/app.asar/.vite/build/mcp-runtime/directMcpHost.js
  const segments = [".vite", "build", "mcp-runtime", "directMcpHost.js"] as const;
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar", ...segments);
  }
  return path.join(app.getAppPath(), ...segments);
}

/** Residual Cni — MessagePort client transport with { type: "mcp", message } framing. */
class MessagePortClientTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  private closed = false;

  constructor(
    private readonly port: MessagePortMain,
    private readonly onDispose: () => Promise<void> | void,
  ) {}

  async start(): Promise<void> {
    this.port.on("message", (event) => {
      const data = event.data as { type?: string; message?: JSONRPCMessage } | undefined;
      if (data?.type === "mcp" && data.message != null) {
        this.onmessage?.(data.message);
      }
    });
    this.port.on("close", () => {
      this.fireClose();
    });
  }

  fireClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.port.postMessage({ type: "mcp", message });
  }

  async close(): Promise<void> {
    await this.onDispose();
  }
}

let hostPromise: Promise<HostHandle> | null = null;

async function spawnHost(): Promise<HostHandle> {
  const workerPath = resolveDirectMcpHostWorkerPath();
  if (!fs.existsSync(workerPath)) {
    throw new Error(`directMcpHost worker not found at: ${workerPath}`);
  }

  const child = utilityProcess.fork(workerPath, [], {
    serviceName: "Custom 3P MCP Host",
    stdio: "pipe",
    env: { ...process.env },
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.info(`[custom3p-mcp host] ${line}`);
  });
  child.stdout?.on("data", () => {
    /* residual swallows stdout */
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error("utility process spawn timeout"));
    }, SPAWN_TIMEOUT_MS);

    const onExit = (code: number) => {
      clearTimeout(timer);
      reject(new Error(`utility process exited during spawn: ${code}`));
    };

    child.once("spawn", () => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve();
    });
    child.once("exit", onExit);
  });

  const connections = new Set<MessagePortClientTransport>();
  let disposing: Promise<void> | undefined;

  const disposeHost = (): Promise<void> => {
    if (disposing) return disposing;
    hostPromise = null;
    disposing = (async () => {
      for (const conn of [...connections]) {
        conn.fireClose();
      }
      connections.clear();
      if (child.pid !== undefined) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            console.warn("[custom3p-mcp] host graceful-exit timeout");
            try {
              child.kill();
            } catch {
              /* ignore */
            }
            resolve();
          }, HOST_EXIT_GRACE_MS);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
          try {
            child.kill();
          } catch {
            clearTimeout(timer);
            resolve();
          }
        });
      }
    })();
    return disposing;
  };

  child.on("exit", (code) => {
    if (disposing) return;
    console.error("[custom3p-mcp] utility process host exited unexpectedly", {
      code,
      activeConnections: connections.size,
    });
    for (const conn of [...connections]) {
      conn.fireClose();
    }
    connections.clear();
    disposing = Promise.resolve();
    hostPromise = null;
  });

  return {
    disposeHost,
    addServer: async (config, extraHeaders) => {
      const { port1, port2 } = new MessageChannelMain();
      const mergedHeaders =
        config.headers || extraHeaders
          ? { ...config.headers, ...extraHeaders }
          : undefined;
      const payload = {
        name: config.name,
        url: config.url,
        transport: config.transport,
        headers: mergedHeaders,
        appVersion: config.appVersion ?? app.getVersion(),
      };

      child.postMessage({ type: "addServer", config: payload }, [port2]);
      port1.start();

      const tools = await new Promise<DirectMcpToolSummary[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.off("exit", onExit);
          port1.close();
          reject(
            new Error(
              `addServer ready timeout after ${ADD_SERVER_READY_TIMEOUT_MS}ms: ${config.name}`,
            ),
          );
        }, ADD_SERVER_READY_TIMEOUT_MS);

        const onExit = (code: number) => {
          clearTimeout(timer);
          port1.off("message", onMessage);
          port1.close();
          reject(new Error(`host exited before ready: ${code}`));
        };

        const onMessage = (event: { data?: { type?: string; tools?: DirectMcpToolSummary[]; message?: string } }) => {
          const data = event.data;
          if (data?.type === "ready") {
            clearTimeout(timer);
            child.off("exit", onExit);
            port1.off("message", onMessage);
            resolve(Array.isArray(data.tools) ? data.tools : []);
          } else if (data?.type === "error") {
            clearTimeout(timer);
            child.off("exit", onExit);
            port1.off("message", onMessage);
            port1.close();
            reject(new Error(data.message || "directMcpHost addServer error"));
          }
        };

        child.once("exit", onExit);
        port1.on("message", onMessage);
      });

      console.info("[custom3p-mcp] server connected", {
        name: config.name,
        toolCount: tools.length,
        hostPid: child.pid,
      });

      let disposed: Promise<void> | undefined;
      const disposeConnection = (): Promise<void> => {
        if (disposed) return disposed;
        disposed = Promise.resolve().then(() => {
          connections.delete(transport);
          transport.fireClose();
          port1.close();
        });
        return disposed;
      };

      const transport = new MessagePortClientTransport(port1, disposeConnection);
      connections.add(transport);

      const client = new Client(
        { name: "custom3p-main", version: app.getVersion() },
        { capabilities: {} },
      );
      await client.connect(transport);

      return {
        client,
        tools,
        dispose: disposeConnection,
      };
    },
  };
}

function ensureHost(): Promise<HostHandle> {
  if (!hostPromise) {
    hostPromise = spawnHost().catch((error) => {
      hostPromise = null;
      throw error;
    });
  }
  return hostPromise;
}

/** Residual mUA / spawnUtilityClient — connect one remote MCP via shared UtilityProcess host. */
export async function spawnUtilityClient(
  config: DirectMcpServerConnectConfig,
  extraHeaders?: Record<string, string>,
): Promise<SpawnUtilityClientResult> {
  const host = await ensureHost();
  return host.addServer(config, extraHeaders);
}

/** Residual Eni / disposeDirectMcpHost — tear down shared host and all connections. */
export async function disposeDirectMcpHost(): Promise<void> {
  if (!hostPromise) return;
  const host = await hostPromise.catch(() => null);
  await host?.disposeHost();
}

export function getDirectMcpHostWorkerPathForTests(): string {
  return resolveDirectMcpHostWorkerPath();
}
