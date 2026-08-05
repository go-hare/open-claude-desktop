import { describe, expect, it } from "vitest";
import {
  extractInboundUserAttachments,
  extractInboundUserText,
} from "./sessionsBridgeInbound";

describe("sessionsBridgeInbound extractors", () => {
  it("extracts string content", () => {
    expect(
      extractInboundUserText({
        type: "user",
        message: { content: "hello" },
      }),
    ).toBe("hello");
  });

  it("extracts text blocks from content array", () => {
    expect(
      extractInboundUserText({
        type: "user",
        message: {
          content: [
            { type: "text", text: "line1" },
            { type: "text", text: "line2" },
          ],
        },
      }),
    ).toBe("line1\nline2");
  });

  it("falls back to top-level content", () => {
    expect(
      extractInboundUserText({
        type: "user",
        content: [{ type: "input_text", text: "top" }],
      }),
    ).toBe("top");
  });

  it("returns empty for non-objects", () => {
    expect(extractInboundUserText(null)).toBe("");
    expect(extractInboundUserText("x")).toBe("");
  });

  it("extracts attachments residual", () => {
    expect(
      extractInboundUserAttachments({
        attachments: [{ id: "a" }],
      }),
    ).toEqual([{ id: "a" }]);
    expect(extractInboundUserAttachments({})).toEqual([]);
  });

  it("prefers official file_attachments (j9i shape)", () => {
    expect(
      extractInboundUserAttachments({
        file_attachments: [
          { file_uuid: "u1", file_name: "a.pdf" },
        ],
        attachments: [{ id: "legacy" }],
      }),
    ).toEqual([{ file_uuid: "u1", file_name: "a.pdf" }]);
  });
});
