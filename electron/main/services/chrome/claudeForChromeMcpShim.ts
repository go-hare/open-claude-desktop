/**
 * Thin re-export of @ant/claude-for-chrome-mcp for main-process bundling.
 * Package root does not export handleToolCall — provide residual wrapper via
 * SocketClient.callTool (+ switch_browser / set_permission_mode local arms).
 */
export {
  createChromeSocketClient,
  createClaudeForChromeMcpServer,
} from "@ant/claude-for-chrome-mcp";
export type {
  ClaudeForChromeContext,
  Logger,
  LoggerDetail,
  SocketClient,
  PermissionMode,
} from "@ant/claude-for-chrome-mcp";

import type {
  ClaudeForChromeContext,
  PermissionMode,
  SocketClient,
} from "@ant/claude-for-chrome-mcp";
import { toLoggerDetail } from "@ant/claude-for-chrome-mcp";

/** Subset of vendor PermissionOverrides used by SocketClient.callTool. */
export type PermissionOverrides = {
  permissionMode?: PermissionMode;
  allowedDomains?: string[];
};

export type CallToolResult = {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
};

/**
 * Residual of vendor handleToolCall (toolCalls.ts) without deep package import.
 * Socket path only — bridge special-cases still honored when methods exist.
 */
export async function handleToolCall(
  context: ClaudeForChromeContext,
  socketClient: SocketClient,
  name: string,
  args: Record<string, unknown> = {},
  permissionOverrides?: PermissionOverrides,
): Promise<CallToolResult> {
  if (name === "set_permission_mode") {
    return handleSetPermissionMode(socketClient, args);
  }
  if (name === "switch_browser") {
    return handleSwitchBrowser(context, socketClient);
  }

  try {
    const isConnected = await socketClient.ensureConnected();
    context.logger.silly(
      `[${context.serverName}] Server is connected: ${isConnected}. Received tool call: ${name}.`,
    );
    if (!isConnected) {
      return disconnectedResult(context);
    }
    const response = await socketClient.callTool(
      name,
      args,
      permissionOverrides as never,
    );
    return normalizeSocketToolResponse(context, response);
  } catch (error) {
    context.logger.info(
      `[${context.serverName}] Error calling tool:`,
      toLoggerDetail(error),
    );
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name: string }).name === "SocketConnectionError"
    ) {
      return disconnectedResult(context);
    }
    return {
      content: [
        {
          type: "text",
          text: `Error calling tool, please try again. : ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
}

function disconnectedResult(context: ClaudeForChromeContext): CallToolResult {
  const message =
    typeof context.onToolCallDisconnected === "function"
      ? context.onToolCallDisconnected()
      : "Claude in Chrome extension is not connected.";
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function handleSetPermissionMode(
  socketClient: SocketClient,
  args: Record<string, unknown>,
): CallToolResult {
  const mode = args.mode;
  if (
    mode !== "ask" &&
    mode !== "skip_all_permission_checks" &&
    mode !== "follow_a_plan"
  ) {
    return {
      content: [
        {
          type: "text",
          text: `Invalid permission mode: ${String(mode)}`,
        },
      ],
      isError: true,
    };
  }
  const domains = Array.isArray(args.allowedDomains)
    ? (args.allowedDomains.filter((d) => typeof d === "string") as string[])
    : undefined;
  if (typeof socketClient.setPermissionMode === "function") {
    void socketClient.setPermissionMode(mode as PermissionMode, domains);
  }
  return {
    content: [
      {
        type: "text",
        text: `Permission mode set to ${mode}`,
      },
    ],
  };
}

async function handleSwitchBrowser(
  context: ClaudeForChromeContext,
  socketClient: SocketClient,
): Promise<CallToolResult> {
  if (typeof socketClient.switchBrowser !== "function") {
    return {
      content: [
        {
          type: "text",
          text: "switch_browser requires bridge transport (socket residual: use select_browser with deviceId).",
        },
      ],
      isError: true,
    };
  }
  try {
    const result = await socketClient.switchBrowser();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result ?? { ok: true }),
        },
      ],
    };
  } catch (error) {
    context.logger.info(
      `[${context.serverName}] switch_browser failed:`,
      toLoggerDetail(error),
    );
    return {
      content: [
        {
          type: "text",
          text: `switch_browser failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
}

function normalizeSocketToolResponse(
  context: ClaudeForChromeContext,
  response: unknown,
): CallToolResult {
  if (response === null || response === undefined) {
    return {
      content: [{ type: "text", text: "Tool execution completed" }],
    };
  }
  const { result, error } = response as {
    result?: { content: unknown[] | string };
    error?: { content: unknown[] | string };
  };
  const contentData = error || result;
  const isError = !!error;
  if (!contentData) {
    // Some socket responses are already MCP-shaped or plain arrays/objects.
    if (Array.isArray((response as { content?: unknown }).content)) {
      return {
        content: (response as { content: Array<Record<string, unknown>> })
          .content,
        ...((response as { isError?: boolean }).isError
          ? { isError: true as const }
          : {}),
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(response) }],
    };
  }
  if (isError) {
    const text =
      typeof contentData.content === "string"
        ? contentData.content
        : JSON.stringify(contentData.content);
    if (/auth|unauthoriz|401|403/i.test(text)) {
      context.onAuthenticationError();
    }
  }
  const { content } = contentData;
  if (typeof content === "string") {
    return {
      content: [{ type: "text", text: content }],
      ...(isError ? { isError: true as const } : {}),
    };
  }
  if (Array.isArray(content)) {
    return {
      content: content.map((item: unknown) => {
        if (typeof item === "object" && item !== null && "type" in item) {
          return item as Record<string, unknown>;
        }
        return { type: "text", text: String(item) };
      }),
      ...(isError ? { isError: true as const } : {}),
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(contentData) }],
    ...(isError ? { isError: true as const } : {}),
  };
}
