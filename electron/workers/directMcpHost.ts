/**
 * UtilityProcess host: remote MCP (SSE / Streamable HTTP) → MessagePort proxy.
 * data-official-source: app.asar .vite/build/mcp-runtime/directMcpHost.js
 *
 * Parent → child (process.parentPort):
 *   { type: "addServer", config } + MessagePort
 * Child → port:
 *   { type: "ready", tools } | { type: "error", message }
 * Port MCP framing:
 *   { type: "mcp", message } both directions (MessagePortServerTransport)
 *
 * Config residual:
 *   { name, url, transport?: "sse" | "http" | …, headers?, appVersion }
 * Client name residual: "custom3p-desktop"
 */
import { net } from "electron/utility";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";

const CONNECT_TIMEOUT_MS = 10_000;
const TOOL_CALL_TIMEOUT_MS = 300_000;

type DirectMcpServerConfig = {
  name: string;
  url: string;
  transport?: string;
  headers?: Record<string, string>;
  appVersion?: string;
};

/**
 * Electron UtilityProcess MessagePort (Node EventEmitter API).
 * At runtime this is MessagePortMain; avoid importing electron types into the
 * worker bundle — structural type is enough for tsc + residual host code.
 */
type UtilityMessagePort = {
  start: () => void;
  close: () => void;
  postMessage: (message: unknown) => void;
  on: (event: "message" | "close", listener: (...args: any[]) => void) => void;
};

type ParentPortLike = {
  on: (
    event: "message",
    listener: (e: {
      data?: { type?: string; config?: DirectMcpServerConfig };
      ports?: UtilityMessagePort[];
    }) => void,
  ) => void;
};

type ToolSummary = {
  name: string;
  description?: string;
  inputSchema: unknown;
  _meta?: unknown;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) {
  throw new Error("directMcpHost must run as Electron UtilityProcess");
}

parentPort.on("message", (e) => {
  // Runtime MessagePortMain is structural-compatible; cast past DOM MessagePort.
  const port = e.ports?.[0] as unknown as UtilityMessagePort | undefined;
  if (e.data?.type !== "addServer" || !port) {
    console.error("[directMcpHost] expected addServer with MessagePort");
    return;
  }
  port.start();
  void addServerConnection(e.data.config as DirectMcpServerConfig, port);
});

async function addServerConnection(
  config: DirectMcpServerConfig,
  port: UtilityMessagePort,
): Promise<void> {
  let remoteClient: Client;
  let tools: ToolSummary[];

  try {
    ({ client: remoteClient, tools } = await connectRemote(config));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    port.postMessage({ type: "error", message });
    port.close();
    return;
  }

  port.postMessage({ type: "ready", tools });

  const proxy = new Server(
    { name: config.name, version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  proxy.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description ?? t.name,
      inputSchema: t.inputSchema as { type: "object"; [key: string]: unknown },
      ...(t._meta != null ? { _meta: t._meta as Record<string, unknown> } : {}),
    })),
  }));

  proxy.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return (await remoteClient.callTool(
        { name, arguments: args ?? {} },
        undefined,
        { timeout: TOOL_CALL_TIMEOUT_MS },
      )) as Awaited<ReturnType<Client["callTool"]>>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[directMcpHost:${config.name}] callTool failed: ${name}: ${message}`);
      return {
        content: [{ type: "text", text: `Tool call failed: ${message}` }],
        isError: true,
      };
    }
  });

  proxy.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      return await remoteClient.listResources(undefined, {
        timeout: TOOL_CALL_TIMEOUT_MS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[directMcpHost:${config.name}] listResources failed: ${message}`);
      return { resources: [] };
    }
  });

  proxy.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      return await remoteClient.readResource(
        { uri: request.params.uri },
        { timeout: TOOL_CALL_TIMEOUT_MS },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[directMcpHost:${config.name}] readResource failed: ${request.params.uri}: ${message}`,
      );
      return { contents: [] };
    }
  });

  let closed = false;
  remoteClient.onclose = () => {
    if (closed) return;
    closed = true;
    console.error(`[directMcpHost:${config.name}] remote closed — closing port`);
    port.close();
    void proxy.close().catch(() => undefined);
  };

  port.on("close", () => {
    if (closed) return;
    closed = true;
    void remoteClient.close().catch(() => undefined);
  });

  await proxy.connect(new MessagePortServerTransport(port));
}

async function connectRemote(config: DirectMcpServerConfig): Promise<{
  client: Client;
  tools: ToolSummary[];
}> {
  const url = new URL(config.url);
  const opts = {
    fetch: (u: string | URL, init?: RequestInit) => net.fetch(String(u), init),
    ...(config.headers ? { requestInit: { headers: config.headers } } : {}),
  };
  const transport =
    config.transport === "sse"
      ? new SSEClientTransport(url, opts)
      : new StreamableHTTPClientTransport(url, opts);

  const client = new Client(
    { name: "custom3p-desktop", version: config.appVersion ?? "0.0.0" },
    { capabilities: {} },
  );

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CONNECT_TIMEOUT_MS);
  try {
    await client.connect(transport, { signal: abort.signal });
    const listed = await client.listTools(undefined, { signal: abort.signal });
    return { client, tools: listed.tools as ToolSummary[] };
  } catch (error) {
    void client.close().catch(() => undefined);
    if (abort.signal.aborted) {
      throw new Error(`connect timeout after ${CONNECT_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Residual MessagePortServerTransport — { type: "mcp", message } framing. */
class MessagePortServerTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  constructor(private readonly port: UtilityMessagePort) {}

  async start(): Promise<void> {
    this.port.on("message", (event: { data?: { type?: string; message?: JSONRPCMessage } }) => {
      const data = event.data;
      if (data?.type === "mcp" && data.message != null) {
        this.onmessage?.(data.message);
      }
    });
    this.port.on("close", () => {
      this.onclose?.();
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.port.postMessage({ type: "mcp", message });
  }

  async close(): Promise<void> {
    this.port.close();
  }
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
