import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type JsonRpcResponse = {
  id?: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type McpServerConfig = {
  args?: unknown;
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
  headers?: unknown;
  type?: unknown;
  url?: unknown;
};

type McpRequestOptions = {
  serverName: string;
  config: unknown;
  method: string;
  params?: unknown;
};

const PROTOCOL_VERSION = "2024-11-05";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(asRecord(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function normalizeConfig(config: unknown): McpServerConfig {
  const raw = asRecord(config);
  const nested = asRecord(raw.config);
  return { ...raw, ...nested };
}

function stdioCommand(config: McpServerConfig): { command: string; args: string[]; cwd?: string; env: Record<string, string> } | null {
  const command = asString(config.command);
  if (!command) return null;
  return {
    command,
    args: stringList(config.args),
    cwd: asString(config.cwd),
    env: stringRecord(config.env),
  };
}

function httpUrl(config: McpServerConfig): string | null {
  const url = asString(config.url) ?? asString(asRecord(config).endpoint) ?? asString(asRecord(config).httpUrl) ?? asString(asRecord(config).sseUrl);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function initializeParams() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "claude-deepseek-desktop", version: "1.0.0" },
  };
}

function jsonRpc(id: number, method: string, params?: unknown) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

function initializedNotification() {
  return { jsonrpc: "2.0", method: "notifications/initialized" };
}

function parseMessages(buffer: string): { messages: JsonRpcResponse[]; rest: string } {
  const messages: JsonRpcResponse[] = [];
  let rest = buffer;
  for (;;) {
    const headerMatch = rest.match(/^Content-Length:\s*(\d+)\r?\n\r?\n/i);
    if (headerMatch?.[1]) {
      const headerLength = headerMatch[0].length;
      const contentLength = Number(headerMatch[1]);
      if (rest.length < headerLength + contentLength) break;
      const payload = rest.slice(headerLength, headerLength + contentLength);
      rest = rest.slice(headerLength + contentLength);
      try { messages.push(JSON.parse(payload)); } catch { /* ignore malformed payload */ }
      continue;
    }

    const newline = rest.indexOf("\n");
    if (newline < 0) break;
    const line = rest.slice(0, newline).trim();
    rest = rest.slice(newline + 1);
    if (!line) continue;
    try { messages.push(JSON.parse(line)); } catch { /* ignore non-JSON server logs */ }
  }
  return { messages, rest };
}

async function requestStdio(options: McpRequestOptions): Promise<unknown> {
  const config = normalizeConfig(options.config);
  const command = stdioCommand(config);
  if (!command) return { ok: false, serverName: options.serverName, error: "missing_mcp_command" };

  return new Promise((resolve) => {
    const pending = new Map<number, (response: JsonRpcResponse) => void>();
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    let buffer = "";
    let stderr = "";
    let nextId = 1;
    let settled = false;

    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve(value);
    };

    const send = (method: string, params?: unknown): Promise<JsonRpcResponse> => {
      const id = nextId;
      nextId += 1;
      child.stdin.write(`${JSON.stringify(jsonRpc(id, method, params))}\n`);
      return new Promise((responseResolve) => pending.set(id, responseResolve));
    };

    const handleResponse = (response: JsonRpcResponse) => {
      if (typeof response.id !== "number") return;
      const resolver = pending.get(response.id);
      if (!resolver) return;
      pending.delete(response.id);
      resolver(response);
    };

    child.stdout.on("data", (data: Buffer) => {
      const parsed = parseMessages(buffer + data.toString("utf8"));
      buffer = parsed.rest;
      for (const message of parsed.messages) handleResponse(message);
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    child.on("error", (error) => finish({ ok: false, serverName: options.serverName, error: error.message }));
    child.on("exit", (code) => {
      if (!settled && code !== 0) finish({ ok: false, serverName: options.serverName, code, error: stderr.trim() || "mcp_server_exited" });
    });

    const timeout = setTimeout(() => finish({ ok: false, serverName: options.serverName, error: "mcp_request_timed_out", stderr: stderr.trim() }), 30_000);
    timeout.unref?.();

    void (async () => {
      const init = await send("initialize", initializeParams());
      if (init.error) return finish({ ok: false, serverName: options.serverName, error: init.error.message ?? "mcp_initialize_failed", details: init.error });
      child.stdin.write(`${JSON.stringify(initializedNotification())}\n`);
      const response = await send(options.method, options.params);
      clearTimeout(timeout);
      if (response.error) return finish({ ok: false, serverName: options.serverName, error: response.error.message ?? "mcp_request_failed", details: response.error });
      finish(response.result ?? null);
    })().catch((error) => finish({ ok: false, serverName: options.serverName, error: error instanceof Error ? error.message : String(error) }));
  });
}

async function requestHttp(options: McpRequestOptions): Promise<unknown> {
  const config = normalizeConfig(options.config);
  const url = httpUrl(config);
  if (!url) return { ok: false, serverName: options.serverName, error: "missing_mcp_url" };
  const headers = { "content-type": "application/json", accept: "application/json", ...stringRecord(config.headers) };
  const init = await fetch(url, { method: "POST", headers, body: JSON.stringify(jsonRpc(1, "initialize", initializeParams())) });
  if (!init.ok) return { ok: false, serverName: options.serverName, error: `mcp_initialize_http_${init.status}` };
  await fetch(url, { method: "POST", headers, body: JSON.stringify(initializedNotification()) }).catch(() => undefined);
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(jsonRpc(2, options.method, options.params)) });
  const data = await response.json().catch(() => null) as JsonRpcResponse | null;
  if (!response.ok) return { ok: false, serverName: options.serverName, error: `mcp_http_${response.status}`, data };
  if (data?.error) return { ok: false, serverName: options.serverName, error: data.error.message ?? "mcp_request_failed", details: data.error };
  return data?.result ?? null;
}

export async function requestMcpServer(options: McpRequestOptions): Promise<unknown> {
  const config = normalizeConfig(options.config);
  if (stdioCommand(config)) return requestStdio(options);
  if (httpUrl(config)) return requestHttp(options);
  return { ok: false, serverName: options.serverName, error: "unsupported_mcp_server_config" };
}

export function describeMcpServer(serverName: string, config: unknown): Record<string, unknown> {
  const normalized = normalizeConfig(config);
  return {
    name: serverName,
    command: asString(normalized.command),
    url: httpUrl(normalized),
    status: stdioCommand(normalized) || httpUrl(normalized) ? "configured" : "unsupported",
  };
}

export function mcpConfigEntries(rawConfig: Record<string, unknown>): Array<[string, unknown]> {
  const nested = asRecord(rawConfig.mcpServers);
  const config = Object.keys(nested).length > 0 ? nested : rawConfig;
  return Object.entries(config).filter(([name, value]) => typeof name === "string" && typeof value === "object" && value !== null);
}
