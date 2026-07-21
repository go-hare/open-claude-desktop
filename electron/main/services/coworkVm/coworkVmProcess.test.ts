import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CoworkVmProcess,
  createCoworkVmSpawnFunction,
  ensureCoworkVmEventCallbacks,
  getCoworkVmLongLivedProcess,
  resetCoworkVmProcessRegistryForTests,
  spawnCoworkVmGuestProcess,
} from "./coworkVmProcess";
import type { CoworkSwiftVmApi } from "./coworkClaudeVm";

afterEach(() => {
  resetCoworkVmProcessRegistryForTests();
});

describe("CoworkVmProcess (SZe)", () => {
  it("buffers stdin until confirmSpawn then writeStdin", async () => {
    const writeStdin = vi.fn(async () => {});
    const vm: CoworkSwiftVmApi = {
      startVM: async () => {},
      isRunning: async () => true,
      isGuestConnected: async () => true,
      writeStdin,
      setEventCallbacks: vi.fn(),
    };
    const proc = new CoworkVmProcess("pid-1", "vm-name", "sess-1", {
      loadSwift: async () => vm,
      log: () => {},
    });
    proc.stdin.write("hello");
    expect(writeStdin).not.toHaveBeenCalled();
    await proc.confirmSpawn();
    expect(writeStdin).toHaveBeenCalledWith("pid-1", "hello");
  });

  it("routes exit via setExited and removes from registry", () => {
    const proc = new CoworkVmProcess("pid-2", "n", "s", { log: () => {} });
    expect(getCoworkVmLongLivedProcess("pid-2")).toBe(proc);
    const onExit = vi.fn();
    proc.on("exit", onExit);
    proc.setExited(0, null);
    expect(onExit).toHaveBeenCalledWith(0, null);
    expect(getCoworkVmLongLivedProcess("pid-2")).toBeUndefined();
  });
});

describe("createCoworkVmSpawnFunction (tGi)", () => {
  it("spawns guest via multi-arg spawn and confirms", async () => {
    const spawn = vi.fn(async () => {});
    const setEventCallbacks = vi.fn();
    const vm: CoworkSwiftVmApi = {
      startVM: async () => {},
      isRunning: async () => true,
      isGuestConnected: async () => true,
      spawn: spawn as CoworkSwiftVmApi["spawn"],
      writeStdin: vi.fn(async () => {}),
      setEventCallbacks,
    };
    // ensureVmStarted is injected so unit tests never touch Electron startVM.
    const factory = createCoworkVmSpawnFunction(
      {
        additionalMounts: {
          outputs: { path: "tmp/out", mode: "rw" },
        },
        processName: "vm-p",
        sessionId: "s1",
        isResume: false,
      },
      {
        ensureVmStarted: async () => {},
        loadSwift: async () => vm,
        log: () => {},
      },
    );

    const child = factory({
      command: "/usr/local/bin/claude",
      args: ["--print"],
      cwd: "/sessions/vm-p",
      env: { FOO: "1" },
      signal: new AbortController().signal,
    });

    expect(child.stdin).toBeTruthy();
    expect(child.stdout).toBeTruthy();
    // wait microtasks for async spawn
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(setEventCallbacks).toHaveBeenCalled();
    const call = spawn.mock.calls[0];
    expect(call[1]).toBe("vm-p");
    expect(call[2]).toBe("/usr/local/bin/claude");
    expect(call[3]).toEqual(["--print"]);
    expect(call[4]).toBe("/sessions/vm-p");
  });
});

describe("ensureCoworkVmEventCallbacks", () => {
  it("installs callbacks once", async () => {
    const setEventCallbacks = vi.fn();
    const vm: CoworkSwiftVmApi = {
      startVM: async () => {},
      isRunning: async () => true,
      isGuestConnected: async () => true,
      setEventCallbacks,
    };
    await ensureCoworkVmEventCallbacks(async () => vm, () => {});
    await ensureCoworkVmEventCallbacks(async () => vm, () => {});
    expect(setEventCallbacks).toHaveBeenCalledTimes(1);
  });
});

describe("spawnCoworkVmGuestProcess", () => {
  it("sets error when swift missing", async () => {
    const proc = new CoworkVmProcess("x", "n", "s", {
      loadSwift: async () => null,
      log: () => {},
    });
    const onError = vi.fn();
    proc.on("error", onError);
    await spawnCoworkVmGuestProcess(
      proc,
      "bash",
      ["-c", "true"],
      undefined,
      {},
      {
        additionalMounts: {},
        processName: "n",
        sessionId: "s",
      },
      async () => null,
      () => {},
      async () => {},
    );
    expect(onError).toHaveBeenCalled();
  });

  it("does not invent host spawn when ensureVmStarted fails", async () => {
    const spawn = vi.fn();
    const vm: CoworkSwiftVmApi = {
      startVM: async () => {},
      isRunning: async () => true,
      isGuestConnected: async () => false,
      spawn: spawn as CoworkSwiftVmApi["spawn"],
      setEventCallbacks: vi.fn(),
    };
    const proc = new CoworkVmProcess("no-guest", "n", "s", {
      loadSwift: async () => vm,
      log: () => {},
    });
    const onError = vi.fn();
    proc.on("error", onError);
    await spawnCoworkVmGuestProcess(
      proc,
      "/usr/local/bin/claude",
      [],
      "/sessions/n",
      {},
      { additionalMounts: {}, processName: "n", sessionId: "s" },
      async () => vm,
      () => {},
      async () => {
        throw new Error("VM start refused in test");
      },
    );
    expect(onError).toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});
