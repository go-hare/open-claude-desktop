/**
 * UtilityProcess host for Node entrypoints (MCP node host residual).
 * data-official-source: app.asar .vite/build/mcp-runtime/nodeHost.js
 *
 * Boot: process.argv[2] = entryPoint, rest = args.
 * parentPort init MessagePort:
 *   stdin → { type: "stdin", data }
 *   stdout/stderr → { type: "stdout"|"stderr", content }
 *   fatal → { type: "fatal-error", kind, message, stack }
 *
 * Sibling product worker: electron/workers/directMcpHost.ts →
 * .vite/build/mcp-runtime/directMcpHost.js (remote SSE/HTTP MCP proxy).
 */
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const [entryPoint, ...args] = process.argv.slice(2);

type FatalPayload = {
  type: "fatal-error";
  kind: string;
  message: string;
  stack?: string;
};

/**
 * Electron UtilityProcess MessagePort (MessagePortMain at runtime).
 * Structural type avoids DOM MessagePort vs MessagePortMain tsc clash.
 */
type UtilityMessagePort = {
  start: () => void;
  close: () => void;
  postMessage: (message: unknown) => void;
  on: (event: "message" | "close", listener: (...args: any[]) => void) => void;
};

let messagePort: UtilityMessagePort | undefined;

function reportFatal(kind: string, err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  const payload: FatalPayload = {
    type: "fatal-error",
    kind,
    message: e.message,
    stack: e.stack,
  };
  try {
    messagePort?.postMessage(payload);
  } catch {
    /* ignore */
  }
  console.error(`[nodeHost] ${kind}:`, e.message);
  setImmediate(() => process.exit(1));
}

process.on("uncaughtException", (err) => reportFatal("uncaughtException", err));
process.on("unhandledRejection", (reason) => reportFatal("unhandledRejection", reason));

if (!entryPoint) {
  console.error("Error: No entry point specified");
  process.exit(1);
}

type ParentPortLike = {
  once: (
    event: "message",
    listener: (e: {
      data?: { type?: string };
      ports?: UtilityMessagePort[];
    }) => void,
  ) => void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) {
  throw new Error("nodeHost must run as Electron UtilityProcess");
}

parentPort.once("message", (e) => {
  const port = e.ports?.[0] as unknown as UtilityMessagePort | undefined;
  if (e.data?.type !== "init" || !port) {
    console.error("Error: Expected init message with MessagePort");
    process.exit(1);
  }

  messagePort = port;

  const stdoutWrite = function (
    this: NodeJS.WriteStream,
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
    callback?: (err?: Error | null) => void,
  ): boolean {
    port.postMessage({ type: "stdout", content: chunk.toString() });
    let cb: ((err?: Error | null) => void) | undefined;
    if (typeof encodingOrCallback === "function") {
      cb = encodingOrCallback;
    } else if (callback) {
      cb = callback;
    }
    if (cb) process.nextTick(cb);
    return true;
  };
  process.stdout.write = stdoutWrite as typeof process.stdout.write;

  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const stderrWrite = function (
    this: NodeJS.WriteStream,
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
    callback?: (err?: Error | null) => void,
  ): boolean {
    port.postMessage({ type: "stderr", content: chunk.toString() });
    if (typeof encodingOrCallback === "function") {
      return originalStderrWrite(chunk, encodingOrCallback);
    }
    return originalStderrWrite(chunk, encodingOrCallback as BufferEncoding | undefined, callback);
  };
  process.stderr.write = stderrWrite as typeof process.stderr.write;

  const stdinStream = new Readable({
    read() {
      /* push-driven */
    },
  });

  if (process.stdin) {
    const methods = [
      "read",
      "push",
      "unshift",
      "pause",
      "resume",
      "pipe",
      "unpipe",
      "on",
      "once",
      "removeListener",
      "removeAllListeners",
      "setEncoding",
      "destroy",
      "isPaused",
    ] as const;
    for (const method of methods) {
      const value = (stdinStream as unknown as Record<string, unknown>)[method];
      if (typeof value === "function") {
        (process.stdin as unknown as Record<string, unknown>)[method] = (value as (...a: unknown[]) => unknown).bind(
          stdinStream,
        );
      }
    }
    Object.defineProperty(process.stdin, "readableHighWaterMark", {
      get: () => stdinStream.readableHighWaterMark,
      configurable: true,
    });
    Object.defineProperty(process.stdin, "readableLength", {
      get: () => stdinStream.readableLength,
      configurable: true,
    });
    Object.defineProperty(process.stdin, "destroyed", {
      get: () => stdinStream.destroyed,
      configurable: true,
    });
  }

  port.on("message", (event: { data?: { type?: string; data?: string } }) => {
    const data = event.data as { type?: string; data?: string } | undefined;
    if (data?.type === "stdin") {
      stdinStream.push(`${data.data ?? ""}\n`);
    }
  });
  port.start();

  process.argv = [process.platform === "win32" ? "node.exe" : "node", entryPoint, ...args];

  try {
    const absolutePath = path.resolve(entryPoint);
    delete require.cache[absolutePath];
    import(pathToFileURL(absolutePath).toString()).catch((error) => {
      reportFatal("import-failed", error);
    });
  } catch (error) {
    reportFatal("import-failed", error);
  }
});

process.on("SIGTERM", () => {
  process.exit(0);
});
process.on("SIGINT", () => {
  process.exit(0);
});
