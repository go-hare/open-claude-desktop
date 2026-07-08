import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
  defersLockAcquire,
  handleToolCall,
  resetMouseButtonHeld
} from "./toolCalls.js";
import { buildComputerUseTools } from "./tools.js";
import { DEFAULT_GRANT_FLAGS } from "./types.js";
const DEFAULT_LOCK_HELD_MESSAGE = "Another Claude session is currently using the computer. Wait for that session to finish, or find a non-computer-use approach.";
function mergePermissionResponse(existing, existingFlags, response) {
  const seen = new Set(existing.map((a) => a.bundleId));
  const apps = [
    ...existing,
    ...response.granted.filter((g) => !seen.has(g.bundleId))
  ];
  const truthyFlags = Object.fromEntries(
    Object.entries(response.flags).filter(([, v]) => v === true)
  );
  const flags = {
    ...DEFAULT_GRANT_FLAGS,
    ...existingFlags,
    ...truthyFlags
  };
  return { apps, flags };
}
function bindSessionContext(adapter, coordinateMode, ctx) {
  const { logger, serverName } = adapter;
  let lastScreenshot;
  const wrapPermission = ctx.onPermissionRequest ? async (req, signal) => {
    const response = await ctx.onPermissionRequest(req, signal);
    const { apps, flags } = mergePermissionResponse(
      ctx.getAllowedApps(),
      ctx.getGrantFlags(),
      response
    );
    logger.debug(
      `[${serverName}] permission result: granted=${response.granted.length} denied=${response.denied.length}`
    );
    ctx.onAllowedAppsChanged?.(apps, flags);
    return response;
  } : void 0;
  const wrapTeachPermission = ctx.onTeachPermissionRequest ? async (req, signal) => {
    const response = await ctx.onTeachPermissionRequest(req, signal);
    logger.debug(
      `[${serverName}] teach permission result: granted=${response.granted.length} denied=${response.denied.length}`
    );
    const { apps } = mergePermissionResponse(
      ctx.getAllowedApps(),
      ctx.getGrantFlags(),
      response
    );
    ctx.onAllowedAppsChanged?.(apps, {
      ...DEFAULT_GRANT_FLAGS,
      ...ctx.getGrantFlags()
    });
    return response;
  } : void 0;
  return async (name, args) => {
    if (ctx.checkCuLock) {
      const lock = await ctx.checkCuLock();
      if (lock.holder !== void 0 && !lock.isSelf) {
        const text = ctx.formatLockHeldMessage?.(lock.holder) ?? DEFAULT_LOCK_HELD_MESSAGE;
        return {
          content: [{ type: "text", text }],
          isError: true,
          telemetry: { error_kind: "cu_lock_held" }
        };
      }
      if (lock.holder === void 0 && !defersLockAcquire(name)) {
        await ctx.acquireCuLock?.();
        const recheck = await ctx.checkCuLock();
        if (recheck.holder !== void 0 && !recheck.isSelf) {
          const text = ctx.formatLockHeldMessage?.(recheck.holder) ?? DEFAULT_LOCK_HELD_MESSAGE;
          return {
            content: [{ type: "text", text }],
            isError: true,
            telemetry: { error_kind: "cu_lock_held" }
          };
        }
        resetMouseButtonHeld();
      }
    }
    const dimsFallback = lastScreenshot ? void 0 : ctx.getLastScreenshotDims?.();
    const dialogAbort = new AbortController();
    const overrides = {
      allowedApps: [...ctx.getAllowedApps()],
      grantFlags: ctx.getGrantFlags(),
      userDeniedBundleIds: ctx.getUserDeniedBundleIds(),
      coordinateMode,
      selectedDisplayId: ctx.getSelectedDisplayId(),
      displayPinnedByModel: ctx.getDisplayPinnedByModel?.(),
      displayResolvedForApps: ctx.getDisplayResolvedForApps?.(),
      lastScreenshot: lastScreenshot ?? (dimsFallback ? { ...dimsFallback, base64: "" } : void 0),
      onPermissionRequest: wrapPermission ? (req) => wrapPermission(req, dialogAbort.signal) : void 0,
      onTeachPermissionRequest: wrapTeachPermission ? (req) => wrapTeachPermission(req, dialogAbort.signal) : void 0,
      onAppsHidden: ctx.onAppsHidden,
      getClipboardStash: ctx.getClipboardStash,
      onClipboardStashChanged: ctx.onClipboardStashChanged,
      onResolvedDisplayUpdated: ctx.onResolvedDisplayUpdated,
      onDisplayPinned: ctx.onDisplayPinned,
      onDisplayResolvedForApps: ctx.onDisplayResolvedForApps,
      onTeachModeActivated: ctx.onTeachModeActivated,
      onTeachStep: ctx.onTeachStep,
      onTeachWorking: ctx.onTeachWorking,
      getTeachModeActive: ctx.getTeachModeActive,
      // Undefined → handleToolCall's sync Gate-3 no-ops. The async gate
      // above already ran.
      checkCuLock: void 0,
      acquireCuLock: void 0,
      isAborted: ctx.isAborted
    };
    logger.debug(
      `[${serverName}] tool=${name} allowedApps=${overrides.allowedApps.length} coordMode=${coordinateMode}`
    );
    try {
      const result = await handleToolCall(adapter, name, args, overrides);
      if (result.screenshot) {
        lastScreenshot = result.screenshot;
        const { base64: _blob, ...dims } = result.screenshot;
        logger.debug(`[${serverName}] screenshot dims: ${JSON.stringify(dims)}`);
        ctx.onScreenshotCaptured?.(dims);
      }
      return result;
    } finally {
      dialogAbort.abort();
    }
  };
}
function createComputerUseMcpServer(adapter, coordinateMode, context) {
  const { serverName, logger } = adapter;
  const server = new Server(
    { name: serverName, version: "0.1.3" },
    { capabilities: { tools: {}, logging: {} } }
  );
  const tools = buildComputerUseTools(
    adapter.executor.capabilities,
    coordinateMode
  );
  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => adapter.isDisabled() ? { tools: [] } : { tools }
  );
  if (context) {
    const dispatch = bindSessionContext(adapter, coordinateMode, context);
    server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const {
          screenshot: _s,
          telemetry: _t,
          ...result
        } = await dispatch(request.params.name, request.params.arguments ?? {});
        return result;
      }
    );
    return server;
  }
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      logger.warn(
        `[${serverName}] tool call "${request.params.name}" reached the stub handler \u2014 no session context bound. Per-session state unavailable.`
      );
      return {
        content: [
          {
            type: "text",
            text: "This computer-use server instance is not wired to a session. Per-session app permissions are not available on this code path."
          }
        ],
        isError: true
      };
    }
  );
  return server;
}
export {
  bindSessionContext,
  createComputerUseMcpServer
};
