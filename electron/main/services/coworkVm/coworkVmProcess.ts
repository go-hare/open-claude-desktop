/**
 * Official dual-exec long-lived guest process (app.asar `SZe` / `Lu` / `tGi` / `iGi`):
 *   EventEmitter with PassThrough stdin/stdout/stderr
 *   spawn via swift `vm.spawn` + writeStdin after confirmSpawn
 *   exit/output routed from setEventCallbacks (after oneshot handlers)
 *
 * Shared with workspace oneshot bash (YeA/kXe) via ensureCoworkVmEventCallbacks.
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import type {
  SpawnOptions as ClaudeSpawnOptions,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import {
  getCoworkClaudeVmService,
  loadCoworkSwiftVm,
  type CoworkSwiftVmApi,
} from "./coworkClaudeVm";

export type CoworkVmProcessSpawnConfig = {
  additionalMounts: Record<string, unknown>;
  allowedDomains?: readonly string[] | null;
  env?: Record<string, string | undefined>;
  isResume?: boolean;
  mountSkeletonHome?: boolean;
  oneShot?: boolean;
  processName: string;
  sessionId: string;
};

type OneshotHooks = {
  handleDisconnect: () => void;
  handleError: (id: string, message: string) => boolean;
  handleExit: (
    id: string,
    exitCode: number | null | undefined,
    signal: string | null | undefined,
  ) => boolean;
  handleOutput: (id: string, data: string) => boolean;
};

const longLived = new Map<string, CoworkVmProcess>();
let oneshotHooks: OneshotHooks | null = null;
let callbacksInstalled = false;
let installPromise: Promise<void> | null = null;

function defaultLog(message: string, extra?: unknown) {
  if (extra !== undefined) console.info(`[CoworkVmProcess] ${message}`, extra);
  else console.info(`[CoworkVmProcess] ${message}`);
}

/** Official kXe / uE install for oneshot trackers. */
export function registerCoworkVmOneshotHooks(hooks: OneshotHooks | null): void {
  oneshotHooks = hooks;
}

/**
 * Official YTi + kXe: install setEventCallbacks once.
 * Oneshot handlers (uE) win before long-lived Lu map.
 */
export async function ensureCoworkVmEventCallbacks(
  loadSwift: () => Promise<CoworkSwiftVmApi | null> = () => loadCoworkSwiftVm(),
  log: (message: string, extra?: unknown) => void = defaultLog,
): Promise<void> {
  if (callbacksInstalled) return;
  if (installPromise) return installPromise;
  installPromise = (async () => {
    const vm = await loadSwift();
    if (!vm) {
      log("Swift VM addon not available for callbacks");
      return;
    }
    if (typeof vm.setEventCallbacks !== "function") {
      log("setEventCallbacks missing on swift vm");
      callbacksInstalled = true;
      return;
    }
    const onStdout = (id: string, data: string) => {
      if (oneshotHooks?.handleOutput(id, data)) return;
      longLived.get(id)?.pushStdout(data);
    };
    const onStderr = (id: string, data: string) => {
      // Official stderr also routes to oneshot output / long-lived stdout buffer.
      if (oneshotHooks?.handleOutput(id, data)) return;
      longLived.get(id)?.pushStdout(data);
    };
    const onExit = (
      id: string,
      exitCode: number | null | undefined,
      signal: string | null | undefined,
      oomKillCount?: number,
    ) => {
      if (oneshotHooks?.handleExit(id, exitCode, signal)) return;
      longLived.get(id)?.setExited(exitCode, signal, oomKillCount);
    };
    const onError = (id: string, message: string, _fatal?: boolean) => {
      if (oneshotHooks?.handleError(id, message)) return;
      longLived.get(id)?.setError(new Error(message));
    };
    vm.setEventCallbacks(
      onStdout,
      onStderr,
      onExit,
      onError,
      () => {},
      () => {},
      () => {},
    );
    callbacksInstalled = true;
    log("VM event callbacks installed");
  })();
  try {
    await installPromise;
  } finally {
    installPromise = null;
  }
}

/** Test helper */
export function resetCoworkVmProcessRegistryForTests(): void {
  longLived.clear();
  oneshotHooks = null;
  callbacksInstalled = false;
  installPromise = null;
}

export function getCoworkVmLongLivedProcess(
  id: string,
): CoworkVmProcess | undefined {
  return longLived.get(id);
}

/**
 * Official SZe — guest process shaped like SpawnedProcess for Agent SDK.
 */
export class CoworkVmProcess extends EventEmitter implements SpawnedProcess {
  readonly id: string;
  readonly name: string;
  readonly sessionId: string;
  private _killed = false;
  private _exitCode: number | null = null;
  private _wasKilled = false;
  private _spawnConfirmed = false;
  private _stdinBuffer: string[] = [];
  private _hasReceivedStdout = false;
  private readonly _stdin = new PassThrough();
  private readonly _stdout = new PassThrough();
  private readonly _stderr = new PassThrough();
  private readonly loadSwift: () => Promise<CoworkSwiftVmApi | null>;
  private readonly log: (message: string, extra?: unknown) => void;

  constructor(
    id: string,
    name: string,
    sessionId: string,
    options: {
      loadSwift?: () => Promise<CoworkSwiftVmApi | null>;
      log?: (message: string, extra?: unknown) => void;
    } = {},
  ) {
    super();
    this.id = id;
    this.name = name;
    this.sessionId = sessionId;
    this.loadSwift = options.loadSwift ?? (() => loadCoworkSwiftVm());
    this.log = options.log ?? defaultLog;
    longLived.set(id, this);
    this.setupStdinForwarding();
  }

  get stdin() {
    return this._stdin;
  }
  get stdout() {
    return this._stdout;
  }
  get stderr() {
    return this._stderr;
  }
  get killed() {
    return this._killed;
  }
  get exitCode() {
    return this._exitCode;
  }

  async confirmSpawn(): Promise<void> {
    this.log(
      `Spawn confirmed, flushing ${this._stdinBuffer.length} buffered stdin chunks`,
    );
    await this.flushBufferedStdin();
    this._spawnConfirmed = true;
    this.emit("spawnConfirmed");
  }

  async flushBufferedStdin(): Promise<void> {
    const vm = await this.loadSwift();
    if (!vm || typeof vm.writeStdin !== "function") return;
    while (this._stdinBuffer.length > 0) {
      const chunk = this._stdinBuffer.shift()!;
      try {
        await vm.writeStdin(this.id, chunk);
      } catch (error) {
        this.log("failed to flush buffered stdin", error);
      }
    }
  }

  pushStdout(data: string): void {
    if (!this._hasReceivedStdout) {
      this._hasReceivedStdout = true;
      this.emit("firstStdout");
    }
    this._stdout.push(data);
  }

  setExited(
    exitCode: number | null | undefined,
    signal: string | null | undefined,
    _oomKillCount?: number,
  ): void {
    const code = this._wasKilled ? 0 : (exitCode ?? 0);
    const sig = this._wasKilled ? null : (signal ?? null);
    this._exitCode = code;
    this._killed = sig !== null;
    this._stdout.push(null);
    this._stderr.push(null);
    this.cleanup();
    this.emit("exit", code, sig);
  }

  setError(error: Error): void {
    this.log(`Error: ${error.message}`);
    this.emit("error", error);
  }

  kill(signal: NodeJS.Signals | number = "SIGTERM"): boolean {
    const sig =
      typeof signal === "number" ? "SIGTERM" : (signal as string);
    if (this._killed || this._exitCode !== null) return true;
    this._wasKilled = true;
    void this.loadSwift().then((vm) => {
      if (vm && typeof vm.kill === "function") {
        void vm.kill(this.id, sig).catch((error) => {
          this.log("kill failed", error);
        });
        this._killed = true;
      }
    });
    return true;
  }

  private setupStdinForwarding(): void {
    this._stdin.on("data", (buf: Buffer | string) => {
      if (this._exitCode !== null || this._killed) return;
      const text = typeof buf === "string" ? buf : buf.toString();
      if (!this._spawnConfirmed) {
        this._stdinBuffer.push(text);
        return;
      }
      void this.loadSwift().then((vm) => {
        if (vm && typeof vm.writeStdin === "function") {
          void vm.writeStdin(this.id, text).catch((error) => {
            this.log("failed to write stdin", error);
          });
        }
      });
    });
  }

  cleanup(): void {
    if (!longLived.has(this.id)) return;
    longLived.delete(this.id);
  }
}

/**
 * Official iGi — spawn long-lived guest process via swift.
 */
export async function spawnCoworkVmGuestProcess(
  process: CoworkVmProcess,
  command: string,
  args: string[],
  cwd: string | undefined,
  env: Record<string, string>,
  config: CoworkVmProcessSpawnConfig,
  loadSwift: () => Promise<CoworkSwiftVmApi | null> = () => loadCoworkSwiftVm(),
  log: (message: string, extra?: unknown) => void = defaultLog,
  ensureVmStarted: () => Promise<void> = async () => {
    const service = getCoworkClaudeVmService();
    const snap = await service.snapshot();
    if (snap.connected) return;
    if (
      snap.runningStatus === "running"
      || snap.runningStatus === "booting"
      || snap.runningStatus === "starting"
    ) {
      return;
    }
    await service.startVM();
  },
): Promise<void> {
  await ensureCoworkVmEventCallbacks(loadSwift, log);
  const vm = await loadSwift();
  if (!vm) {
    process.setError(new Error("Swift VM addon not available"));
    return;
  }
  if (typeof vm.spawn !== "function") {
    process.setError(new Error("VM spawn is not available on this swift addon"));
    return;
  }

  try {
    // Official dual-exec awaits vmStartPromise before guest Claude spawn.
    await ensureVmStarted();

    let connected = false;
    try {
      const connectedRaw = await vm.isGuestConnected();
      connected =
        typeof connectedRaw === "boolean"
          ? connectedRaw
          : Boolean(
              connectedRaw
                && typeof connectedRaw === "object"
                && (connectedRaw as { connected?: boolean }).connected,
            );
    } catch {
      connected = false;
    }
    if (!connected) {
      // Poll briefly after ensure — startVM may still be booting.
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        try {
          const connectedRaw = await vm.isGuestConnected();
          connected =
            typeof connectedRaw === "boolean"
              ? connectedRaw
              : Boolean(
                  connectedRaw
                    && typeof connectedRaw === "object"
                    && (connectedRaw as { connected?: boolean }).connected,
                );
          if (connected) break;
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!connected) {
      process.setError(
        new Error("VM guest is not connected — cannot spawn dual-exec Claude"),
      );
      return;
    }

    const oauth = env.CLAUDE_CODE_OAUTH_TOKEN;
    if (oauth && typeof vm.addApprovedOauthToken === "function") {
      await vm.addApprovedOauthToken(oauth);
    }

    try {
      await vm.spawn(
        process.id,
        config.processName,
        command,
        args,
        cwd,
        Object.keys(env).length > 0 ? env : undefined,
        config.additionalMounts,
        config.isResume ?? false,
        config.allowedDomains ? [...config.allowedDomains] : undefined,
        config.oneShot ?? false,
        config.mountSkeletonHome,
      );
    } catch (firstError) {
      const msg =
        firstError instanceof Error ? firstError.message : String(firstError);
      const arityHint =
        firstError instanceof TypeError
        || /arguments|arity|is not a function|Cannot read/i.test(msg);
      if (!arityHint) throw firstError;
      await vm.spawn({
        id: process.id,
        name: config.processName,
        command,
        args,
        cwd,
        env: Object.keys(env).length > 0 ? env : undefined,
        additionalMounts: config.additionalMounts,
        isResume: config.isResume ?? false,
        allowedDomains: config.allowedDomains
          ? [...config.allowedDomains]
          : undefined,
        oneShot: config.oneShot ?? false,
        mountSkeletonHome: config.mountSkeletonHome,
      });
    }
    await process.confirmSpawn();
  } catch (error) {
    process.setError(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/**
 * Official tGi — createVMSpawnFunction(config) → (sdkSpawnOptions) => SZe
 */
export function createCoworkVmSpawnFunction(
  config: CoworkVmProcessSpawnConfig,
  options: {
    ensureVmStarted?: () => Promise<void>;
    loadSwift?: () => Promise<CoworkSwiftVmApi | null>;
    log?: (message: string, extra?: unknown) => void;
  } = {},
): (spawnOptions: ClaudeSpawnOptions) => SpawnedProcess {
  const loadSwift = options.loadSwift ?? (() => loadCoworkSwiftVm());
  const log = options.log ?? defaultLog;
  const mountKeys = Object.keys(config.additionalMounts);
  log(
    `Creating spawn function for process=${config.processName}, isResume=${Boolean(config.isResume)}, mounts=${mountKeys.length} (${mountKeys.join(", ")})`,
  );

  return (spawnOptions: ClaudeSpawnOptions) => {
    const id = randomUUID();
    log(
      `id=${id} name=${config.processName} cmd=${spawnOptions.command} args=${spawnOptions.args.join(" ")} cwd=${spawnOptions.cwd ?? "(none)"}`,
    );
    void ensureCoworkVmEventCallbacks(loadSwift, log);
    const proc = new CoworkVmProcess(id, config.processName, config.sessionId, {
      loadSwift,
      log,
    });
    const mergedEnv: Record<string, string> = {};
    const fromConfig = config.env ?? {};
    const fromSpawn = (spawnOptions.env ?? {}) as Record<
      string,
      string | undefined
    >;
    for (const [key, value] of Object.entries({ ...fromConfig, ...fromSpawn })) {
      if (value !== undefined) mergedEnv[key] = value;
    }
    const ensureVm =
      options.ensureVmStarted
      ?? (async () => {
        const service = getCoworkClaudeVmService();
        const snap = await service.snapshot();
        if (snap.connected) return;
        if (
          snap.runningStatus === "running"
          || snap.runningStatus === "booting"
          || snap.runningStatus === "starting"
        ) {
          return;
        }
        await service.startVM();
      });
    void spawnCoworkVmGuestProcess(
      proc,
      spawnOptions.command,
      [...spawnOptions.args],
      spawnOptions.cwd,
      mergedEnv,
      config,
      loadSwift,
      log,
      ensureVm,
    ).catch((error) => {
      log("Failed to spawn", error);
      proc.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
    });
    return proc;
  };
}
