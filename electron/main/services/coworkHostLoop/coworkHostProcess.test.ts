import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import { expect, it, vi } from "vitest";
import {
  CLAUDE_CODE_OAUTH_TOKEN,
  CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR,
  createCoworkHostProcessAdapter,
  createCoworkHostProcessRegistry,
  createMacDisclaimerResolver,
  stageCoworkOAuthToken,
  type CoworkHostNativeSpawnOptions,
} from "./coworkHostProcess";

class FakeChildProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;

  kill(_signal: NodeJS.Signals): boolean {
    this.killed = true;
    return true;
  }
}

it("spawns through the mac disclaimer and passes OAuth on fd 3", () => {
  const child = new FakeChildProcess();
  const closeFileDescriptor = vi.fn();
  const onStderr = vi.fn();
  let spawnCall:
    | {
        args: string[];
        command: string;
        options: CoworkHostNativeSpawnOptions;
      }
    | undefined;
  const registry = createCoworkHostProcessRegistry({
    registerExit: () => undefined,
  });
  const adapter = createCoworkHostProcessAdapter({
    closeFileDescriptor,
    commandResolver: createMacDisclaimerResolver(
      "/Applications/Claude.app/Contents/Helpers/disclaimer",
      "darwin",
    ),
    onStderr,
    platform: "darwin",
    registry,
    spawnProcess: (command, args, options) => {
      spawnCall = { args, command, options };
      return child as unknown as SpawnedProcess & {
        stderr: NodeJS.ReadableStream;
      };
    },
    stageOAuthToken: () => 42,
  });
  const signal = new AbortController().signal;

  const process = adapter?.(spawnOptions(signal));
  child.stderr.write("diagnostic\n");

  expect(process).toBe(child);
  expect(spawnCall).toEqual({
    args: ["/opt/claude", "--verbose"],
    command: "/Applications/Claude.app/Contents/Helpers/disclaimer",
    options: {
      cwd: "/workspace",
      env: {
        [CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR]: "3",
        KEEP: "yes",
      },
      signal,
      stdio: ["pipe", "pipe", "pipe", 42],
      windowsHide: true,
    },
  });
  expect(closeFileDescriptor).toHaveBeenCalledWith(42);
  expect(onStderr).toHaveBeenCalledWith("diagnostic\n");
  expect(registry.size).toBe(1);

  child.emit("exit", 0, null);
  expect(registry.size).toBe(0);
});

it("keeps the OAuth token in env when fd staging fails", () => {
  const child = new FakeChildProcess();
  let nativeOptions: CoworkHostNativeSpawnOptions | undefined;
  const adapter = createCoworkHostProcessAdapter({
    platform: "linux",
    registerExit: () => undefined,
    spawnProcess: (_command, _args, options) => {
      nativeOptions = options;
      return child as unknown as SpawnedProcess;
    },
    stageOAuthToken: () => undefined,
  });

  adapter?.(spawnOptions(new AbortController().signal));

  expect(nativeOptions?.env[CLAUDE_CODE_OAUTH_TOKEN]).toBe("secret-token");
  expect(nativeOptions?.env[CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR]).toBeUndefined();
  expect(nativeOptions?.stdio).toEqual(["pipe", "pipe", "pipe"]);
});

it("does not install the custom process adapter on Windows", () => {
  expect(
    createCoworkHostProcessAdapter({
      platform: "win32",
      registerExit: () => undefined,
    }),
  ).toBeUndefined();
});

it("stages OAuth tokens with mode 0600 and unlinks before returning", () => {
  const writeFile = vi.fn();
  const remove = vi.fn();
  const descriptor = stageCoworkOAuthToken("secret-token", {
    makeTemporaryDirectory: () => "/tmp/hlsp-test",
    openFile: () => 17,
    remove,
    temporaryDirectory: () => "/tmp",
    writeFile,
  });

  expect(descriptor).toBe(17);
  expect(writeFile).toHaveBeenCalledWith("/tmp/hlsp-test/t", "secret-token", {
    encoding: "utf8",
    mode: 0o600,
  });
  expect(remove.mock.calls).toEqual([
    ["/tmp/hlsp-test/t", { force: true }],
    ["/tmp/hlsp-test", { force: true, recursive: true }],
  ]);
});

it("terminates all tracked processes when the registry exit hook runs", () => {
  let exitHook: (() => void) | undefined;
  const child = new FakeChildProcess();
  const registry = createCoworkHostProcessRegistry({
    registerExit: (listener) => {
      exitHook = listener;
    },
  });
  registry.track(child as unknown as SpawnedProcess);

  exitHook?.();

  expect(child.killed).toBe(true);
});

function spawnOptions(signal: AbortSignal): SpawnOptions {
  return {
    args: ["--verbose"],
    command: "/opt/claude",
    cwd: "/workspace",
    env: {
      [CLAUDE_CODE_OAUTH_TOKEN]: "secret-token",
      KEEP: "yes",
    },
    signal,
  };
}
