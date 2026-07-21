import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCoworkVmGuestBashRunner,
  probeCoworkVmReadyStatus,
  resetCoworkVmGuestBashRunnerForTests,
} from "./coworkVmGuestBash";
import { resetCoworkVmProcessRegistryForTests } from "./coworkVmProcess";
import type { CoworkSwiftVmApi } from "./coworkClaudeVm";

afterEach(() => {
  resetCoworkVmGuestBashRunnerForTests();
  resetCoworkVmProcessRegistryForTests();
});

describe("probeCoworkVmReadyStatus (O1i)", () => {
  it("returns ready when promise settles before timeout", async () => {
    await expect(probeCoworkVmReadyStatus(Promise.resolve(), 50)).resolves.toBe(
      "ready",
    );
  });

  it("returns booting when promise is still pending at timeout", async () => {
    await expect(
      probeCoworkVmReadyStatus(new Promise(() => {}), 20),
    ).resolves.toBe("booting");
  });

  it("returns failed when promise rejects", async () => {
    await expect(
      probeCoworkVmReadyStatus(Promise.reject(new Error("nope")), 50),
    ).resolves.toBe("failed");
  });
});

describe("createCoworkVmGuestBashRunner", () => {
  it("runs oneshot bash via spawn + exit callbacks (not host shell)", async () => {
    const spawn = vi.fn(
      async (
        id: string,
        _name?: string,
        _cmd?: string,
        _args?: string[],
      ) => {
        // Emit stdout then exit asynchronously like guest.
        queueMicrotask(() => {
          runner.__testDispatch({ type: "stdout", id, data: "hello-vm\n" });
          runner.__testDispatch({ type: "exit", id, exitCode: 0, signal: null });
        });
      },
    );
    const setEventCallbacks = vi.fn();
    const vm: CoworkSwiftVmApi = {
      startVM: async () => {},
      isRunning: async () => true,
      isGuestConnected: async () => true,
      spawn: spawn as CoworkSwiftVmApi["spawn"],
      kill: vi.fn(async () => {}),
      setEventCallbacks,
    };

    const runner = createCoworkVmGuestBashRunner({
      ensureVmStarted: async () => {},
      loadSwiftVm: async () => vm,
      log: () => {},
    });

    const result = await runner.runBash({
      command: "echo hello-vm",
      mounts: {
        mounts: {
          outputs: { path: "tmp/out", mode: "rw" },
        },
        vmCwd: "/sessions/p1/mnt/outputs",
      },
      processName: "p1",
      timeoutMs: 5_000,
      allowedDomains: ["*"],
    });

    expect(setEventCallbacks).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalled();
    const first = spawn.mock.calls[0];
    expect(first[0]).toMatch(/^oneshot-/);
    expect(first[1]).toBe("p1");
    expect(first[2]).toBe("bash");
    expect(first[3]).toEqual(["-c", "echo hello-vm"]);
    expect(first[4]).toBe("/sessions/p1/mnt/outputs");
    expect(result).toEqual({ exitCode: 0, output: "hello-vm\n" });
  });

  it("retries resume → create → re-resume like Y1i", async () => {
    const spawn = vi.fn(async (id: string, ...rest: unknown[]) => {
      const isResume = rest[6]; // after processName,cmd,args,cwd,env,mounts
      if (isResume === true && spawn.mock.calls.length === 1) {
        throw new Error("resume missing");
      }
      // create (isResume false) succeeds
      expect(isResume).toBe(false);
      queueMicrotask(() => {
        runner.__testDispatch({ type: "stdout", id, data: "ok" });
        runner.__testDispatch({ type: "exit", id, exitCode: 0 });
      });
    });
    const vm: CoworkSwiftVmApi = {
      startVM: async () => {},
      isRunning: async () => true,
      isGuestConnected: async () => true,
      spawn: spawn as CoworkSwiftVmApi["spawn"],
      setEventCallbacks: vi.fn(),
    };
    const runner = createCoworkVmGuestBashRunner({
      ensureVmStarted: async () => {},
      loadSwiftVm: async () => vm,
      log: () => {},
    });
    const result = await runner.runBash({
      command: "true",
      mounts: { mounts: {}, vmCwd: "/sessions/x/mnt/outputs" },
      processName: "x",
      timeoutMs: 5_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("ok");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0][7]).toBe(true);
    expect(spawn.mock.calls[1][7]).toBe(false);
  });

  it("getVmStatus is ready when guest already connected", async () => {
    const vm: CoworkSwiftVmApi = {
      startVM: async () => {},
      isRunning: async () => true,
      isGuestConnected: async () => true,
      setEventCallbacks: vi.fn(),
    };
    const runner = createCoworkVmGuestBashRunner({
      ensureVmStarted: async () => {},
      loadSwiftVm: async () => vm,
      log: () => {},
      readyProbeMs: 2_000,
    });
    await expect(runner.getVmStatus()).resolves.toBe("ready");
  });

  it("getVmStatus is failed when swift missing", async () => {
    const runner = createCoworkVmGuestBashRunner({
      ensureVmStarted: async () => {},
      loadSwiftVm: async () => null,
      log: () => {},
      readyProbeMs: 100,
    });
    await expect(runner.getVmStatus()).resolves.toBe("failed");
  });

  it("does not invent host bash when guest not connected", async () => {
    const spawn = vi.fn();
    const vm: CoworkSwiftVmApi = {
      startVM: async () => {},
      isRunning: async () => false,
      isGuestConnected: async () => false,
      spawn: spawn as CoworkSwiftVmApi["spawn"],
      setEventCallbacks: vi.fn(),
    };
    const runner = createCoworkVmGuestBashRunner({
      ensureVmStarted: async () => {},
      loadSwiftVm: async () => vm,
      log: () => {},
    });
    await expect(
      runner.runBash({
        command: "echo no",
        mounts: { mounts: {}, vmCwd: "/sessions/x/mnt/outputs" },
        processName: "x",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/guest is not connected/i);
    expect(spawn).not.toHaveBeenCalled();
  });
});
