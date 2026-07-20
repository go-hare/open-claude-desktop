/**
 * Official LocalMcpServerManager.createSdkServer tool-call path staging (app.asar):
 *
 *   const args = pathCtx
 *     ? XL(rawArgs, `/sessions/${pathCtx.vmProcessName}/mnt/`, pathCtx)
 *     : rawArgs;
 *   const result = await client.callTool({ name, arguments: args });
 *   if (pathCtx && result.content) {
 *     result.content = DeA(result.content, pathCtx, "host-to-vm");
 *   }
 *
 * XL = deepTranslateVMPaths (VM→host for local MCP servers on host).
 * DeA = translateFileUrisInValue (host file:// → VM file:// in tool results).
 */
import {
  deepTranslateVmPaths,
  translateFileUrisInValue,
  type CoworkVmPathContext,
} from "../coworkSessions/coworkVmPathTranslation";

export type CoworkLocalMcpToolResult = {
  content?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

/** Official: XL tool arguments before local MCP callTool. */
export function translateLocalMcpToolArgs(
  args: unknown,
  pathContext: CoworkVmPathContext | null | undefined,
): unknown {
  if (!pathContext) return args;
  const mntPrefix = `/sessions/${pathContext.vmProcessName}/mnt/`;
  return deepTranslateVmPaths(args, mntPrefix, pathContext, false);
}

/**
 * Official: DeA result.content host→vm after local MCP callTool.
 * Mutates a shallow copy when content is present (matches official `f.content = DeA(...)`).
 */
export function translateLocalMcpToolResult(
  result: CoworkLocalMcpToolResult,
  pathContext: CoworkVmPathContext | null | undefined,
): CoworkLocalMcpToolResult {
  if (!pathContext || result.content === undefined) return result;
  return {
    ...result,
    content: translateFileUrisInValue(
      result.content,
      pathContext,
      "host-to-vm",
    ),
  };
}

/**
 * Official createSdkServer tool wrapper path staging only
 * (analytics/reconnect omitted — residual).
 */
export async function withLocalMcpPathTranslation<
  TArgs,
  TResult extends CoworkLocalMcpToolResult,
>(
  args: TArgs,
  pathContext: CoworkVmPathContext | null | undefined,
  call: (translatedArgs: TArgs) => Promise<TResult>,
): Promise<TResult> {
  const translatedArgs = translateLocalMcpToolArgs(args, pathContext) as TArgs;
  const result = await call(translatedArgs);
  return translateLocalMcpToolResult(result, pathContext) as TResult;
}

/**
 * Wrap an in-process createSdkMcpServer tool handler with official XL/DeA.
 * `resolvePathContext` may return null (no-op) when session has no VM mounts.
 */
export function wrapLocalMcpToolHandler<TArgs, TResult extends CoworkLocalMcpToolResult>(
  resolvePathContext: () => CoworkVmPathContext | null | undefined,
  handler: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs) => {
    let pathContext: CoworkVmPathContext | null | undefined;
    try {
      pathContext = resolvePathContext();
    } catch (error) {
      console.warn(
        "[coworkLocalMcpPathTranslate] resolvePathContext failed: %o",
        error,
      );
      pathContext = null;
    }
    return withLocalMcpPathTranslation(args, pathContext, handler);
  };
}
