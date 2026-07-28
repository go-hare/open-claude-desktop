import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  getLaunchPreviewSession,
  hashLaunchPreviewWorkspace,
  launchPreviewPartitionName,
  recordLaunchPreviewPersistedWorkspace,
  type LaunchPreviewPersistStore,
} from "./launchPreviewPersist";

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

/**
 * Official fm / parseLaunchJson residual (app.asar):
 * configurations[] entry → buildCommand:
 *   runtimeExecutable + runtimeArgs + optional program/args
 * Port from configuration.port when present.
 */
export type LaunchJsonConfiguration = {
  name: string;
  port?: number;
  command: string;
  args: string[];
  cwd?: string;
};

type RunningServer = LaunchServerRecord & {
  child?: ChildProcessWithoutNullStreams;
  logs: LaunchLogLine[];
  command?: string;
  args?: string[];
};

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Official buildCommand residual:
 * runtimeExecutable + runtimeArgs (+ program/args) → { command, args }
 */
export function parseLaunchConfiguration(
  raw: Record<string, unknown>,
  workingDirectory: string,
  index: number,
): LaunchJsonConfiguration | null {
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `server-${index + 1}`;
  const runtimeExecutable = typeof raw.runtimeExecutable === "string" ? raw.runtimeExecutable : undefined;
  const runtimeArgs = asStringArray(raw.runtimeArgs);
  const program = typeof raw.program === "string" ? raw.program : undefined;
  const programArgs = asStringArray(raw.args);

  let command: string | undefined;
  let args: string[] = [];
  if (runtimeExecutable) {
    command = runtimeExecutable;
    args = [...runtimeArgs];
    if (program) args.push(program);
    args.push(...programArgs);
  } else if (program) {
    command = program;
    args = [...programArgs];
  } else {
    return null;
  }

  let entryCwd = workingDirectory;
  if (typeof raw.cwd === "string" && raw.cwd.trim()) {
    entryCwd = path.isAbsolute(raw.cwd) ? raw.cwd : path.join(workingDirectory, raw.cwd);
  }

  const portRaw = raw.port;
  const port =
    typeof portRaw === "number" && Number.isFinite(portRaw)
      ? portRaw
      : typeof portRaw === "string" && /^\d+$/.test(portRaw)
        ? Number(portRaw)
        : inferPort([command, ...args].join(" "), 3000 + index);

  return { name, port, command, args, cwd: entryCwd };
}

/** Official fromClaudeConfig / parseLaunchJson residual. */
export async function readLaunchJsonConfigurations(
  cwd: string,
): Promise<LaunchJsonConfiguration[]> {
  const filePath = path.join(cwd, ".claude", "launch.json");
  let rawText: string;
  try {
    rawText = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const configurations = (parsed as { configurations?: unknown }).configurations;
  if (!Array.isArray(configurations)) return [];
  const out: LaunchJsonConfiguration[] = [];
  configurations.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    // Official skips non-runnable types (e.g. framebuffer) via parseConfiguration null.
    const type = (entry as { type?: unknown }).type;
    if (typeof type === "string" && type !== "node" && type !== "chrome" && type !== "server") {
      // Still allow plain entries without type (official runtimeExecutable configs).
      if (type === "framebuffer" || type === "vnc") return;
    }
    const cfg = parseLaunchConfiguration(entry as Record<string, unknown>, cwd, index);
    if (cfg) out.push(cfg);
  });
  return out;
}

export class LocalLaunchManager {
  private readonly servers = new Map<string, RunningServer>();
  /**
   * Official gi("launchEnabled") residual — MCP/tool isEnabled + start gate.
   * Default true (SSA). Injected from SettingsStore so startCommand cannot bypass IPC.
   */
  private isLaunchEnabled: () => boolean = () => true;
  /**
   * Official gi("launchPreviewPersistSession") residual — partition + workspace list.
   */
  private isPreviewPersistEnabled: () => boolean = () => false;
  private previewPersistStore: LaunchPreviewPersistStore | null = null;

  setLaunchEnabledReader(reader: () => boolean): void {
    this.isLaunchEnabled = reader;
  }

  /**
   * Official launchPreviewPersistSession + launchPreviewPersistedWorkspaces residual.
   */
  setPreviewPersistAccess(opts: {
    isPersistEnabled: () => boolean;
    store: LaunchPreviewPersistStore;
  }): void {
    this.isPreviewPersistEnabled = opts.isPersistEnabled;
    this.previewPersistStore = opts.store;
  }

  /**
   * Official L4/D5e residual after a server starts: create/cache partition session
   * and optionally append workspace key to launchPreviewPersistedWorkspaces.
   */
  attachPreviewPersistContext(cwd: string): {
    workspaceKey: string;
    persist: boolean;
    partition: string;
  } {
    const workspaceKey = hashLaunchPreviewWorkspace(cwd);
    const persist = this.isPreviewPersistEnabled() === true;
    getLaunchPreviewSession(workspaceKey, persist);
    if (persist && this.previewPersistStore) {
      recordLaunchPreviewPersistedWorkspace(workspaceKey, this.previewPersistStore);
    }
    return {
      workspaceKey,
      persist,
      partition: launchPreviewPartitionName(workspaceKey, persist),
    };
  }

  /**
   * Official Launch / MCP isEnabled residual (preference, not capability).
   * isAvailable stays true; Ea() = launchEnabled && isAvailable on settings.
   */
  isEnabled(): boolean {
    return this.isLaunchEnabled() !== false;
  }

  private denyIfDisabled(): { error: string } | null {
    if (this.isEnabled()) return null;
    return { error: "launch_disabled" };
  }

  /**
   * Official Launch.getConfiguredServices residual:
   *   new fm(cwd).getConfig() → servers from .claude/launch.json only.
   * Empty / missing file → [] (renderer shows no-config + Set up). Never invent package.json scripts.
   * Still readable when launchEnabled is off (UI can show no-config vs has-config; start is gated).
   */
  async getConfiguredServices(cwd: string): Promise<Array<{ name: string; port?: number }>> {
    const configs = await readLaunchJsonConfigurations(cwd);
    return configs.map((cfg) => ({ name: cfg.name, port: cfg.port }));
  }

  getActiveServers(): LaunchServerRecord[] {
    return Array.from(this.servers.values()).map(
      ({ child: _child, logs: _logs, command: _command, args: _args, ...server }) => server,
    );
  }

  getServer(serverId?: string): LaunchServerRecord | null {
    const server = serverId
      ? this.servers.get(serverId)
      : Array.from(this.servers.values()).find((item) => item.status !== "stopped");
    if (!server) return null;
    const { child: _child, logs: _logs, command: _command, args: _args, ...record } = server;
    return record;
  }

  getPreviewUrl(serverId?: string): string | null {
    const server = this.getServer(serverId);
    return server ? `http://127.0.0.1:${server.port}` : null;
  }

  async startFromConfig(cwd: string, name?: string): Promise<{ serverId?: string; error?: string }> {
    const denied = this.denyIfDisabled();
    if (denied) return denied;
    const configs = await readLaunchJsonConfigurations(cwd);
    const selected = configs.find((cfg) => cfg.name === name) ?? configs[0];
    if (!selected) {
      // Official startFromConfig with no config → {} (deny); product returns empty-ish error for start-failed path honesty.
      return {};
    }
    return this.startCommand(
      selected.cwd ?? cwd,
      selected.name,
      selected.command,
      selected.args,
      selected.port ?? 3000,
    );
  }

  async startCommand(
    cwd: string,
    name: string,
    command: string,
    args: string[],
    port: number,
  ): Promise<{ serverId?: string; error?: string }> {
    const denied = this.denyIfDisabled();
    if (denied) return denied;
    try {
      const serverId = id("server");
      const record: RunningServer = {
        serverId,
        name,
        port,
        status: "starting",
        startedAt: new Date().toISOString(),
        cwd,
        logs: [],
        command,
        args,
      };
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, PORT: String(port) },
        shell: false,
      });
      record.child = child;
      child.stdout.on("data", (chunk: Buffer) => appendLog(record, "stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => appendLog(record, "stderr", chunk));
      child.on("exit", (code) => {
        record.status = code === 0 ? "stopped" : "error";
        record.logs.push({
          line: `process exited with code ${code ?? "null"}`,
          stream: "stderr",
          timestamp: new Date().toISOString(),
        });
      });
      this.servers.set(serverId, record);
      // Official D5e residual: on start, create preview partition context for cwd.
      try {
        this.attachPreviewPersistContext(cwd);
      } catch {
        /* partition residual best-effort */
      }
      waitForPort(port, 5000)
        .then((ok) => {
          if (this.servers.get(serverId) === record && ok) record.status = "running";
        })
        .catch(() => undefined);
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
    const denied = this.denyIfDisabled();
    if (denied) return denied;
    const server = this.servers.get(serverId);
    if (!server?.command) return { error: "server not found" };
    await this.stopServer(serverId);
    return this.startCommand(server.cwd, server.name, server.command, server.args ?? [], server.port);
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
