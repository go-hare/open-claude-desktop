import { SocketConnectionError } from "./mcpSocketClient.js";
import { toLoggerDetail } from "./types.js";
const handleToolCall = async (context, socketClient, name, args, permissionOverrides) => {
  if (name === "set_permission_mode") {
    return handleSetPermissionMode(socketClient, args);
  }
  if (name === "switch_browser") {
    return handleSwitchBrowser(context, socketClient);
  }
  try {
    const isConnected = await socketClient.ensureConnected();
    context.logger.silly(
      `[${context.serverName}] Server is connected: ${isConnected}. Received tool call: ${name} with args: ${JSON.stringify(args)}.`
    );
    if (isConnected) {
      return await handleToolCallConnected(
        context,
        socketClient,
        name,
        args,
        permissionOverrides
      );
    }
    return handleToolCallDisconnected(context);
  } catch (error) {
    context.logger.info(
      `[${context.serverName}] Error calling tool:`,
      toLoggerDetail(error)
    );
    if (error instanceof SocketConnectionError) {
      return handleToolCallDisconnected(context);
    }
    return {
      content: [
        {
          type: "text",
          text: `Error calling tool, please try again. : ${error instanceof Error ? error.message : String(error)}`
        }
      ],
      isError: true
    };
  }
};
async function handleToolCallConnected(context, socketClient, name, args, permissionOverrides) {
  const response = await socketClient.callTool(name, args, permissionOverrides);
  context.logger.silly(
    `[${context.serverName}] Received result from socket bridge: ${JSON.stringify(response)}`
  );
  if (response === null || response === void 0) {
    return {
      content: [{ type: "text", text: "Tool execution completed" }]
    };
  }
  const { result, error } = response;
  const contentData = error || result;
  const isError = !!error;
  if (!contentData) {
    return {
      content: [{ type: "text", text: "Tool execution completed" }]
    };
  }
  if (isError && isAuthenticationError(contentData.content)) {
    context.onAuthenticationError();
  }
  const { content } = contentData;
  if (content && Array.isArray(content)) {
    if (isError) {
      return {
        content: content.map((item) => {
          if (typeof item === "object" && item !== null && "type" in item) {
            return item;
          }
          return { type: "text", text: String(item) };
        }),
        isError: true
      };
    }
    const convertedContent = content.map((item) => {
      if (typeof item === "object" && item !== null && "type" in item && "source" in item) {
        const typedItem = item;
        if (typedItem.type === "image" && typeof typedItem.source === "object" && typedItem.source !== null && "data" in typedItem.source) {
          return {
            type: "image",
            data: typedItem.source.data,
            mimeType: "media_type" in typedItem.source ? typedItem.source.media_type || "image/png" : "image/png"
          };
        }
      }
      if (typeof item === "object" && item !== null && "type" in item) {
        return item;
      }
      return { type: "text", text: String(item) };
    });
    return {
      content: convertedContent,
      isError
    };
  }
  if (typeof content === "string") {
    return {
      content: [{ type: "text", text: content }],
      isError
    };
  }
  context.logger.warn(
    `[${context.serverName}] Unexpected result format from socket bridge: ${JSON.stringify(response)}`
  );
  return {
    content: [{ type: "text", text: JSON.stringify(response) }],
    isError
  };
}
function handleToolCallDisconnected(context) {
  const text = context.onToolCallDisconnected();
  return {
    content: [{ type: "text", text }]
  };
}
async function handleSetPermissionMode(socketClient, args) {
  const validModes = [
    "ask",
    "skip_all_permission_checks",
    "follow_a_plan"
  ];
  const mode = args.mode;
  const permissionMode = mode && validModes.includes(mode) ? mode : "ask";
  if (socketClient.setPermissionMode) {
    await socketClient.setPermissionMode(
      permissionMode,
      args.allowed_domains
    );
  }
  return {
    content: [
      { type: "text", text: `Permission mode set to: ${permissionMode}` }
    ]
  };
}
async function handleSwitchBrowser(context, socketClient) {
  if (!context.bridgeConfig) {
    return {
      content: [
        {
          type: "text",
          text: "Browser switching is only available with bridge connections."
        }
      ],
      isError: true
    };
  }
  const isConnected = await socketClient.ensureConnected();
  if (!isConnected) {
    return handleToolCallDisconnected(context);
  }
  const result = await socketClient.switchBrowser?.() ?? null;
  if (result === "no_other_browsers") {
    return {
      content: [
        {
          type: "text",
          text: "No other browsers available to switch to. Open Chrome with the Claude extension in another browser to switch."
        }
      ],
      isError: true
    };
  }
  if (result) {
    return {
      content: [
        { type: "text", text: `Connected to browser "${result.name}".` }
      ]
    };
  }
  return {
    content: [
      {
        type: "text",
        text: "No browser responded within the timeout. Make sure Chrome is open with the Claude extension installed, then try again."
      }
    ],
    isError: true
  };
}
function isAuthenticationError(content) {
  const errorText = Array.isArray(content) ? content.map((item) => {
    if (typeof item === "string") return item;
    if (typeof item === "object" && item !== null && "text" in item && typeof item.text === "string") {
      return item.text;
    }
    return "";
  }).join(" ") : String(content);
  return errorText.toLowerCase().includes("re-authenticated");
}
export {
  handleToolCall
};
