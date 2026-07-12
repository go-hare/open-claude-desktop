export type CoworkImagePayload = {
  base64: string;
  filename?: string;
  mimeType: string;
};

export type CoworkToolStateContent = {
  data?: string;
  media_type?: string;
  text?: string;
  type: string;
};

export type CoworkToolState = {
  content: CoworkToolStateContent[];
  tool_name: string;
};

export type CoworkSendMessageRequest = {
  images: CoworkImagePayload[] | undefined;
  message: string;
  messageUuid: string | undefined;
  sessionId: string;
  toolStates: CoworkToolState[] | undefined;
  userSelectedFiles: string[] | undefined;
};

const validationPrefix = "in interface \"LocalAgentModeSessions\" failed to pass validation";

function validationError(name: string, position: number): Error {
  return new Error(`Argument \"${name}\" at position ${position} to method \"sendMessage\" ${validationPrefix}`);
}

function isImagePayload(value: unknown): value is CoworkImagePayload {
  if (!value || typeof value !== "object") return false;
  const image = value as Record<string, unknown>;
  return typeof image.base64 === "string"
    && typeof image.mimeType === "string"
    && (image.filename === undefined || typeof image.filename === "string");
}

function isToolStateContent(value: unknown): value is CoworkToolStateContent {
  if (!value || typeof value !== "object") return false;
  const content = value as Record<string, unknown>;
  return typeof content.type === "string"
    && (content.text === undefined || typeof content.text === "string")
    && (content.data === undefined || typeof content.data === "string")
    && (content.media_type === undefined || typeof content.media_type === "string");
}

function isToolState(value: unknown): value is CoworkToolState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return typeof state.tool_name === "string"
    && Array.isArray(state.content)
    && state.content.every(isToolStateContent);
}

export function parseCoworkSendMessageArgs(args: readonly unknown[]): CoworkSendMessageRequest {
  const [sessionId, message, images, userSelectedFiles, messageUuid, toolStates] = args;
  if (typeof sessionId !== "string") throw validationError("sessionId", 0);
  if (typeof message !== "string") throw validationError("message", 1);
  if (images !== undefined && (!Array.isArray(images) || !images.every(isImagePayload))) {
    throw validationError("images", 2);
  }
  if (userSelectedFiles !== undefined && (!Array.isArray(userSelectedFiles) || !userSelectedFiles.every((file) => typeof file === "string"))) {
    throw validationError("userSelectedFiles", 3);
  }
  if (messageUuid !== undefined && typeof messageUuid !== "string") {
    throw validationError("messageUuid", 4);
  }
  if (toolStates !== undefined && (!Array.isArray(toolStates) || !toolStates.every(isToolState))) {
    throw validationError("toolStates", 5);
  }
  return { images, message, messageUuid, sessionId, toolStates, userSelectedFiles };
}
