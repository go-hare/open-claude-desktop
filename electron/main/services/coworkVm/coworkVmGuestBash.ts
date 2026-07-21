/**
 * Official dual-exec guest oneshot bash (app.asar `xeA` / `Y1i` / `O1i` / `YeA` / `kXe`):
 *   load swift vm → setEventCallbacks once → spawn(id, processName, "bash", ["-c", cmd], …)
 *   wait for exit via oneshot tracker (stdout/stderr → output; timeout → kill SIGTERM)
 *
 * Does **not** invent host `child_process` bash. Requires Electron + `@ant/claude-swift`.
 */
import { randomUUID } from "node:crypto";
import {
  getCoworkClaudeVmService,
  loadCoworkSwiftVm,
  type CoworkSwiftVmApi,
} from "./coworkClaudeVm";
import {
  ensureCoworkVmEventCallbacks,
  registerCoworkVmOneshotHooks,
} from "./coworkVmProcess";
import {
  COWORK_WORKSPACE_VM_READY_PROBE_MS,
  type CoworkWorkspaceBashRunInput,
  type CoworkWorkspaceBashRunResult,
  type CoworkWorkspaceVmStatus,
} from "../coworkRuntime/coworkWorkspaceMcpServer";

/** Official ZK.MAX_OUTPUT_BYTES */
export const COWORK_VM_ONESHOT_MAX_OUTPUT_BYTES = 1_000_000;
/** Official xeA default timeout when caller omits */
export const COWORK_VM_ONESHOT_DEFAULT_TIMEOUT_MS = 30_000;

export type CoworkVmOneshotExitResult = {
  chunkCount: number;
  exitAt: number;
  exitCode: number;
  firstOutputAt: number | null;
  output: string;
};

type OneshotTracker = {
  cleanup: () => void;
  id: string;
  pushOutput: (chunk: string) => void;
  setError: (error: Error) => void;
  setExited: (exitCode: number | null | undefined, signal?: string | null) => void;
  waitForExit: () => Promise<CoworkVmOneshotExitResult>;
};

export type CoworkVmGuestBashRunnerOptions = {
  /** Injected load for tests. Default: loadCoworkSwiftVm / getCoworkClaudeVmService. */
  ensureVmStarted?: () => Promise<void>;
  loadSwiftVm?: () => Promise<CoworkSwiftVmApi | null>;
  log?: (message: string, extra?: unknown) => void;
  /** Wall-clock now (tests). */
  now?: () => number;
  /** Override ready probe timeout (official G1i = 5000). */
  readyProbeMs?: number;
};

function defaultLog(message: string, extra?: unknown) {
  if (extra !== undefined) console.info(`[CoworkVmGuestBash] ${message}`, extra);
  else console.info(`[CoworkVmGuestBash] ${message}`);
}

function createOneshotTracker(
  id: string,
  timeoutMs: number,
  onTimeout: () => void,
  registry: Map<string, OneshotTracker>,
): OneshotTracker {
  const output: string[] = [];
  let outputBytes = 0;
  let truncated = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let firstOutputAt: number | null = null;
  let resolve!: (value: CoworkVmOneshotExitResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<CoworkVmOneshotExitResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Prevent unhandled rejection if caller abandons wait.
  promise.catch(() => {});

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    registry.delete(id);
  };

  timeoutId = setTimeout(() => {
    cleanup();
    onTimeout();
    reject(new Error(`Command timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const tracker: OneshotTracker = {
    id,
    cleanup,
    pushOutput(chunk: string) {
      if (firstOutputAt === null) firstOutputAt = performance.now();
      if (truncated) return;
      if (outputBytes + chunk.length > COWORK_VM_ONESHOT_MAX_OUTPUT_BYTES) {
        truncated = true;
        output.push(
          `\n[output truncated at ${COWORK_VM_ONESHOT_MAX_OUTPUT_BYTES} bytes]\n`,
        );
        return;
      }
      outputBytes += chunk.length;
      output.push(chunk);
    },
    setExited(exitCode, _signal) {
      const code = exitCode ?? 1;
      const exitAt = performance.now();
      cleanup();
      resolve({
        output: output.join(""),
        exitCode: code,
        chunkCount: output.length,
        firstOutputAt,
        exitAt,
      });
    },
    setError(error) {
      cleanup();
      reject(error);
    },
    waitForExit() {
      return promise;
    },
  };
  return tracker;
}

/**
 * Official O1i(vmReadyPromise, timeoutMs):
 *   race ready vs timeout → booting | ready; catch → failed
 */
export async function probeCoworkVmReadyStatus(
  readyPromise: Promise<unknown>,
  timeoutMs: number = COWORK_WORKSPACE_VM_READY_PROBE_MS,
): Promise<CoworkWorkspaceVmStatus> {
  const booting = Symbol("booting");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race([
      readyPromise,
      new Promise<typeof booting>((resolve) => {
        timer = setTimeout(() => resolve(booting), timeoutMs);
      }),
    ]);
    return raced === booting ? "booting" : "ready";
  } catch {
    return "failed";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type GuestCallbackHooks = {
  handleDisconnect: () => void;
  handleError: (id: string, message: string) => boolean;
  handleExit: (
    id: string,
    exitCode: number | null | undefined,
    signal: string | null | undefined,
  ) => boolean;
  handleOutput: (id: string, data: string) => boolean;
};

/**
 * Process-wide oneshot registry + swift event callback install (official kXe + YTi subset).
 */
export function createCoworkVmGuestBashRunner(
  options: CoworkVmGuestBashRunnerOptions = {},
) {
  const log = options.log ?? defaultLog;
  const loadSwift = options.loadSwiftVm ?? (() => loadCoworkSwiftVm());
  const ensureVmStarted =
    options.ensureVmStarted
    ?? (async () => {
      const service = getCoworkClaudeVmService();
      const snap = await service.snapshot();
      if (snap.connected) return;
      if (snap.runningStatus === "running" || snap.runningStatus === "booting") {
        // Already starting — wait below via ready loop.
        return;
      }
      await service.startVM();
    });
  const readyProbeMs = options.readyProbeMs ?? COWORK_WORKSPACE_VM_READY_PROBE_MS;

  const oneshots = new Map<string, OneshotTracker>();
  let readyPromise: Promise<void> | null = null;

  const hooks: GuestCallbackHooks = {
    handleOutput(id, data) {
      const tracker = oneshots.get(id);
      if (!tracker) return false;
      tracker.pushOutput(data);
      return true;
    },
    handleExit(id, exitCode, signal) {
      const tracker = oneshots.get(id);
      if (!tracker) return false;
      tracker.setExited(exitCode, signal);
      return true;
    },
    handleError(id, message) {
      const tracker = oneshots.get(id);
      if (!tracker) return false;
      tracker.setError(new Error(message));
      return true;
    },
    handleDisconnect() {
      for (const tracker of oneshots.values()) {
        tracker.setError(new Error("VM disconnected unexpectedly."));
      }
    },
  };

  // Official kXe — oneshot hooks before long-lived process map.
  registerCoworkVmOneshotHooks(hooks);

  async function ensureEventCallbacks(_vm?: CoworkSwiftVmApi | null): Promise<void> {
    await ensureCoworkVmEventCallbacks(loadSwift, log);
  }

  /**
   * Promise that settles when guest is connected (starts VM if needed).
   * Official host-loop keeps a background vmReadyPromise; we recreate per ensure.
   */
  function ensureGuestReadyPromise(): Promise<void> {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      await ensureVmStarted();
      const vm = await loadSwift();
      if (!vm) throw new Error("VM is not available.");
      await ensureEventCallbacks(vm);
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        try {
          const connectedRaw = await vm.isGuestConnected();
          const connected =
            typeof connectedRaw === "boolean"
              ? connectedRaw
              : Boolean(
                  connectedRaw
                    && typeof connectedRaw === "object"
                    && (connectedRaw as { connected?: boolean }).connected,
                );
          if (connected) return;
        } catch (error) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("VM connection timeout after 90 seconds.");
    })().finally(() => {
      // Keep resolved promise for subsequent O1i races until disconnect/fail.
    });
    readyPromise = readyPromise.catch((error) => {
      readyPromise = null;
      throw error;
    });
    return readyPromise;
  }

  async function getVmStatus(): Promise<CoworkWorkspaceVmStatus> {
    return probeCoworkVmReadyStatus(ensureGuestReadyPromise(), readyProbeMs);
  }

  /**
   * Official xeA — oneshot spawn + waitForExit.
   * spawn(id, processName, command, args, cwd, env, additionalMounts, isResume, allowedDomains, oneShot)
   */
  async function spawnOneshot(
    input: {
      additionalMounts?: Record<string, unknown>;
      allowedDomains?: readonly string[] | null;
      args: string[];
      command: string;
      cwd?: string;
      env?: Record<string, string>;
      isResume: boolean;
      oneShot?: boolean;
      processName: string;
    },
    timeoutMs: number,
  ): Promise<CoworkVmOneshotExitResult> {
    const id = `oneshot-${randomUUID()}`;
    const vm = await loadSwift();
    if (!vm) throw new Error("VM is not available.");
    await ensureEventCallbacks(vm);

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
    if (!connected) throw new Error("VM guest is not connected.");

    if (typeof vm.spawn !== "function") {
      throw new Error("VM spawn is not available on this swift addon.");
    }

    const tracker = createOneshotTracker(
      id,
      timeoutMs,
      () => {
        if (typeof vm.kill === "function") {
          void vm.kill(id, "SIGTERM").catch((error) => {
            log("Failed to kill timed-out process", error);
          });
        }
      },
      oneshots,
    );
    oneshots.set(id, tracker);

    log(
      `Running: ${input.command} [${input.args.length} arg(s)] as ${input.processName}`,
    );

    try {
      // Prefer multi-arg official client shape (darwin/win vm client).
      // Only fall back to object form on arity/type errors — not guest spawn failures.
      try {
        await vm.spawn(
          id,
          input.processName,
          input.command,
          input.args,
          input.cwd,
          input.env,
          input.additionalMounts,
          input.isResume,
          input.allowedDomains ? [...input.allowedDomains] : undefined,
          input.oneShot ?? false,
        );
      } catch (firstError) {
        const msg =
          firstError instanceof Error ? firstError.message : String(firstError);
        const arityHint =
          firstError instanceof TypeError
          || /arguments|arity|is not a function|Cannot read/i.test(msg);
        if (!arityHint) throw firstError;
        await vm.spawn({
          id,
          name: input.processName,
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          env: input.env,
          additionalMounts: input.additionalMounts,
          isResume: input.isResume,
          allowedDomains: input.allowedDomains
            ? [...input.allowedDomains]
            : undefined,
          oneShot: input.oneShot ?? false,
        });
      }
      return await tracker.waitForExit();
    } catch (error) {
      tracker.cleanup();
      throw error;
    }
  }

  /**
   * Official Y1i — resume → create → re-resume retries.
   */
  async function runGuestProcess(
    input: {
      additionalMounts?: Record<string, unknown>;
      allowedDomains?: readonly string[] | null;
      args: string[];
      command: string;
      cwd?: string;
      env?: Record<string, string>;
      processName: string;
    },
    timeoutMs: number,
  ): Promise<CoworkVmOneshotExitResult> {
    const attempt = (isResume: boolean) =>
      spawnOneshot({ ...input, isResume }, timeoutMs);
    try {
      return await attempt(true);
    } catch (resumeError) {
      const resumeMsg =
        resumeError instanceof Error ? resumeError.message : String(resumeError);
      log(`bash resume failed, retrying with create: ${resumeMsg}`);
      try {
        return await attempt(false);
      } catch (createError) {
        const createMsg =
          createError instanceof Error
            ? createError.message
            : String(createError);
        log(`bash create failed (${createMsg}), retrying resume`);
        try {
          return await attempt(true);
        } catch {
          throw new Error(
            `bash failed on resume, create, and re-resume. resume: ${resumeMsg}; create: ${createMsg}`,
          );
        }
      }
    }
  }

  async function runBash(
    input: CoworkWorkspaceBashRunInput,
  ): Promise<CoworkWorkspaceBashRunResult> {
    const timeoutMs =
      input.timeoutMs > 0
        ? input.timeoutMs
        : COWORK_VM_ONESHOT_DEFAULT_TIMEOUT_MS;
    const result = await runGuestProcess(
      {
        processName: input.processName,
        command: "bash",
        args: ["-c", input.command],
        cwd: input.mounts.vmCwd,
        additionalMounts: input.mounts.mounts as Record<string, unknown>,
        allowedDomains: input.allowedDomains,
      },
      timeoutMs,
    );
    return { exitCode: result.exitCode, output: result.output };
  }

  /** Test helper: inject exit/output as if guest emitted events. */
  function __testDispatch(event: {
    data?: string;
    exitCode?: number | null;
    id: string;
    message?: string;
    signal?: string | null;
    type: "stdout" | "stderr" | "exit" | "error" | "disconnect";
  }) {
    switch (event.type) {
      case "stdout":
      case "stderr":
        hooks.handleOutput(event.id, event.data ?? "");
        break;
      case "exit":
        hooks.handleExit(event.id, event.exitCode, event.signal);
        break;
      case "error":
        hooks.handleError(event.id, event.message ?? "error");
        break;
      case "disconnect":
        hooks.handleDisconnect();
        break;
    }
  }

  return {
    ensureGuestReadyPromise,
    getVmStatus,
    runBash,
    runGuestProcess,
    spawnOneshot,
    __testDispatch,
    /** Visible for tests */
    _oneshots: oneshots,
  };
}

export type CoworkVmGuestBashRunner = ReturnType<
  typeof createCoworkVmGuestBashRunner
>;

let singleton: CoworkVmGuestBashRunner | null = null;

export function getCoworkVmGuestBashRunner(): CoworkVmGuestBashRunner {
  if (!singleton) singleton = createCoworkVmGuestBashRunner();
  return singleton;
}

/** Test helper */
export function resetCoworkVmGuestBashRunnerForTests(): void {
  singleton = null;
}
