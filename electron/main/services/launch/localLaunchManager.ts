import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

export type LaunchServerStatus = "starting" | "running" | "error" | "stopped";
export type LaunchServerRecord = {
  serverId: string;
  name: string;
  port: number;
  status: LaunchServerStatus;
  startedAt: string;
  cwd: string;
  filePath?: string;
};
export type LaunchLogLine = { line: string; stream: "stdout" | "stderr"; timestamp: string };

type RunningServer = LaunchServerRecord & { child?: ChildProcessWithoutNullStreams; logs: LaunchLogLine[]; command?: string; args?: string[] };

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

async function readPackageJson(cwd: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function scriptsFromPackageJson(pkg: Record<string, unknown> | null): Record<string, string> {
  const scripts = pkg?.scripts;
  return typeof scripts === "object" && scripts !== null ? scripts as Record<string, string> : {};
}

function inferPort(command: string, fallback: number): number {
  const patterns = [/--port(?:=|\s+)(\d+)/, /-p(?:=|\s+)(\d+)/, /PORT=(\d+)/, /:(\d{4,5})\b/];
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match) return Number(match[1]);
  }
  return fallback;
}

function appendLog(server: RunningServer, stream: "stdout" | "stderr", chunk: Buffer): void {
  const timestamp = new Date().toISOString();
  for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) {
    const port = line.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/)?.[1];
    if (port) {
      server.port = Number(port);
      server.status = "running";
    }
    server.logs.push({ line, stream, timestamp });
  }
  if (server.logs.length > 1000) server.logs.splice(0, server.logs.length - 1000);
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (response) => {
      response.resume();
      resolve(true);
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

export class LocalLaunchManager {
  private readonly servers = new Map<string, RunningServer>();

  async getConfiguredServices(cwd: string): Promise<Array<{ name: string; port?: number }>> {
    const scripts = scriptsFromPackageJson(await readPackageJson(cwd));
    return Object.entries(scripts)
      .filter(([name]) => ["dev", "start", "preview", "serve"].includes(name) || name.startsWith("dev:"))
      .map(([name, command], index) => ({ name, port: inferPort(String(command), 3000 + index) }));
  }

  getActiveServers(): LaunchServerRecord[] {
    return Array.from(this.servers.values()).map(({ child: _child, logs: _logs, command: _command, args: _args, ...server }) => server);
  }

  async startFromConfig(cwd: string, name?: string): Promise<{ serverId?: string; error?: string }> {
    const services = await this.getConfiguredServices(cwd);
    const selected = services.find((service) => service.name === name) ?? services[0];
    if (!selected) return { error: "No runnable package.json script found" };
    return this.startPackageScript(cwd, selected.name, selected.port ?? 3000);
  }

  async startPackageScript(cwd: string, scriptName: string, port: number): Promise<{ serverId?: string; error?: string }> {
    try {
      const serverId = id("server");
      const record: RunningServer = { serverId, name: scriptName, port, status: "starting", startedAt: new Date().toISOString(), cwd, logs: [], command: "/usr/bin/env", args: ["npm", "run", scriptName] };
      const child = spawn(record.command!, record.args!, { cwd, env: { ...process.env, PORT: String(port) } });
      record.child = child;
      child.stdout.on("data", (chunk: Buffer) => appendLog(record, "stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => appendLog(record, "stderr", chunk));
      child.on("exit", (code) => {
        record.status = code === 0 ? "stopped" : "error";
        record.logs.push({ line: `process exited with code ${code ?? "null"}`, stream: "stderr", timestamp: new Date().toISOString() });
      });
      this.servers.set(serverId, record);
      waitForPort(port, 5000).then((ok) => {
        if (this.servers.get(serverId) === record && ok) record.status = "running";
      }).catch(() => undefined);
      return { serverId };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  async stopServer(serverId: string): Promise<boolean> {
    const server = this.servers.get(serverId);
    if (!server) return false;
    server.status = "stopped";
    server.child?.kill("SIGTERM");
    return true;
  }

  async restartServer(serverId: string): Promise<{ serverId?: string; error?: string }> {
    const server = this.servers.get(serverId);
    if (!server) return { error: "server not found" };
    await this.stopServer(serverId);
    return this.startPackageScript(server.cwd, server.name, server.port);
  }

  getLogs(serverId: string): LaunchLogLine[] {
    return this.servers.get(serverId)?.logs ?? [];
  }

  async waitForServer(serverId: string, timeoutMs = 15000): Promise<boolean> {
    const server = this.servers.get(serverId);
    if (!server) return false;
    const ok = await waitForPort(server.port, timeoutMs);
    if (ok) server.status = "running";
    return ok;
  }
}
