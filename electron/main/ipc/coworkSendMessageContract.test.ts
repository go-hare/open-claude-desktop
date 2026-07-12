import { describe, expect, it } from "vitest";
import { parseCoworkSendMessageArgs } from "./coworkSendMessageContract";

describe("LocalAgentModeSessions.sendMessage contract", () => {
  it("accepts the official six argument order", () => {
    const images = [{ base64: "aGVsbG8=", filename: "hello.png", mimeType: "image/png" }];
    const files = ["/tmp/report.txt"];
    const toolStates = [{ tool_name: "example", content: [{ type: "text", text: "ready" }] }];

    expect(parseCoworkSendMessageArgs(["session-1", "hello", images, files, "message-1", toolStates])).toEqual({
      images,
      message: "hello",
      messageUuid: "message-1",
      sessionId: "session-1",
      toolStates,
      userSelectedFiles: files,
    });
  });

  it("accepts undefined optional arguments", () => {
    expect(parseCoworkSendMessageArgs(["session-2", "hello", undefined, undefined, undefined, undefined])).toEqual({
      images: undefined,
      message: "hello",
      messageUuid: undefined,
      sessionId: "session-2",
      toolStates: undefined,
      userSelectedFiles: undefined,
    });
  });

  it("rejects permissionMode in the userSelectedFiles position", () => {
    expect(() => parseCoworkSendMessageArgs(["session-3", "hello", [], "default", "message-3", undefined]))
      .toThrow('Argument "userSelectedFiles" at position 3');
  });

  it("rejects an options object in the toolStates position", () => {
    expect(() => parseCoworkSendMessageArgs(["session-4", "hello", [], [], "message-4", { userSelectedFiles: [] }]))
      .toThrow('Argument "toolStates" at position 5');
  });
});
